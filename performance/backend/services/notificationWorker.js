const crypto = require('crypto');
const Notification = require('../models/Notification');
const NotificationDelivery = require('../models/NotificationDelivery');
const NotificationPreference = require('../models/NotificationPreference');
const notificationService = require('./notificationService');
const zulipService = require('./zulipService');
const { getOrganizationFeatureState } = require('./organizationFeatureService');
const {
  calculateBackoffMs,
  claimNextDomainEvent,
  EVENT_PRESENTATIONS,
  makeDeliveryIdempotencyKey,
  markDomainEventFailed,
  markDomainEventProcessed,
  sanitizePlainText,
  summarizeError
} = require('./outboxService');

const DEFAULT_DELIVERY_LEASE_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DIGEST_COLLECTION_GRACE_MS = 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EXTERNAL_CHANNELS = ['email', 'chat'];

async function notificationsEnabledForOrganization(organizationId) {
  const state = await getOrganizationFeatureState(organizationId);
  return state.features.notifications === true;
}

function defaultPreference(organizationId, userId) {
  return {
    organizationId,
    userId,
    channels: { inApp: true, email: false, chat: false },
    digest: { frequency: 'immediate', time: '09:00', dayOfWeek: 1 },
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    timezone: 'UTC',
    eventOverrides: []
  };
}

async function loadPreference(organizationId, userId) {
  return (await NotificationPreference.findOne({ organizationId, userId })
    .select('+chat.recipientEmail')
    .lean())
    || defaultPreference(organizationId, userId);
}

function channelEnabled(preference, eventType, channel) {
  if (channel === 'inApp') return true;
  const override = (preference.eventOverrides || []).find(item => item.eventType === eventType);
  if (override && typeof override[channel] === 'boolean') return override[channel];
  return Boolean(preference.channels?.[channel]);
}

function validateTimezone(timezone) {
  const candidate = String(timezone || 'UTC');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (error) {
    return 'UTC';
  }
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validateTimezone(timezone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    weekday: Math.max(0, WEEKDAYS.indexOf(values.weekday)),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function parseTime(value, fallback) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || fallback));
  const hour = Number(match?.[1] || fallback.slice(0, 2));
  const minute = Number(match?.[2] || fallback.slice(3, 5));
  return (hour * 60) + minute;
}

function quietHoursDeferral(preference, now = new Date()) {
  if (!preference.quietHours?.enabled) return null;
  const current = zonedParts(now, preference.timezone);
  const currentMinute = (current.hour * 60) + current.minute;
  const start = parseTime(preference.quietHours.start, '22:00');
  const end = parseTime(preference.quietHours.end, '07:00');
  if (start === end) return null;

  const spansMidnight = start > end;
  const isQuiet = spansMidnight
    ? currentMinute >= start || currentMinute < end
    : currentMinute >= start && currentMinute < end;
  if (!isQuiet) return null;

  const daysAhead = spansMidnight && currentMinute >= start ? 1 : 0;
  const targetWeekday = (current.weekday + daysAhead) % 7;
  const secondsToDiscard = (now.getUTCSeconds() * 1000) + now.getUTCMilliseconds();
  let candidate = new Date(
    now.getTime() - secondsToDiscard + (((daysAhead * 1440) + end - currentMinute) * 60 * 1000)
  );

  // A nominal minute delta is an hour early/late when quiet hours cross a DST
  // boundary. Correct it against the requested local weekday and clock time.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const candidateParts = zonedParts(candidate, preference.timezone);
    const candidateMinute = (candidateParts.hour * 60) + candidateParts.minute;
    let dayDelta = (targetWeekday - candidateParts.weekday + 7) % 7;
    if (dayDelta > 3) dayDelta -= 7;
    const adjustmentMinutes = (dayDelta * 1440) + end - candidateMinute;
    if (adjustmentMinutes === 0) break;
    candidate = new Date(candidate.getTime() + (adjustmentMinutes * 60 * 1000));
  }
  // Add one minute so boundary rounding cannot immediately reclaim the job.
  return new Date(candidate.getTime() + (60 * 1000));
}

function nextDigestAt(preference, now = new Date()) {
  const frequency = preference.digest?.frequency;
  if (frequency !== 'daily' && frequency !== 'weekly') return now;

  const current = zonedParts(now, preference.timezone);
  const currentMinute = (current.hour * 60) + current.minute;
  const targetMinute = parseTime(preference.digest?.time, '09:00');
  let daysAhead = targetMinute > currentMinute ? 0 : 1;
  let targetWeekday = (current.weekday + daysAhead) % 7;

  if (frequency === 'weekly') {
    targetWeekday = Math.max(0, Math.min(6, Number(preference.digest?.dayOfWeek) || 0));
    daysAhead = (targetWeekday - current.weekday + 7) % 7;
    if (daysAhead === 0 && targetMinute <= currentMinute) daysAhead = 7;
  }

  const secondsToDiscard = (now.getUTCSeconds() * 1000) + now.getUTCMilliseconds();
  let candidate = new Date(
    now.getTime() - secondsToDiscard + (((daysAhead * 1440) + targetMinute - currentMinute) * 60 * 1000)
  );

  // Correct the approximate UTC delta for a timezone offset change at a DST
  // boundary. Rechecking twice is enough for the supported one-hour shifts.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const candidateParts = zonedParts(candidate, preference.timezone);
    const candidateMinute = (candidateParts.hour * 60) + candidateParts.minute;
    let dayDelta = (targetWeekday - candidateParts.weekday + 7) % 7;
    if (dayDelta > 3) dayDelta -= 7;
    const adjustmentMinutes = (dayDelta * 1440) + targetMinute - candidateMinute;
    if (adjustmentMinutes === 0) break;
    candidate = new Date(candidate.getTime() + (adjustmentMinutes * 60 * 1000));
  }

  if (candidate <= now) {
    candidate = new Date(candidate.getTime() + (frequency === 'weekly' ? 7 : 1) * 24 * 60 * 60 * 1000);
  }
  return candidate;
}

function deliverySeed({ event, notification, recipient, channel, now, preference }) {
  const idempotencyKey = makeDeliveryIdempotencyKey(event.eventId, recipient.userId, channel);
  const common = {
    organizationId: event.organizationId,
    userId: recipient.userId,
    eventId: event.eventId,
    notificationId: notification._id,
    channel,
    idempotencyKey,
    maxAttempts: event.maxAttempts || 8
  };

  if (channel === 'in_app') {
    return {
      ...common,
      deliveryMode: 'immediate',
      status: 'delivered',
      nextAttemptAt: now,
      attemptCount: 1,
      deliveredAt: now,
      attempts: [{
        attempt: 1,
        startedAt: now,
        finishedAt: now,
        outcome: 'delivered',
        providerMessageId: `in-app:${notification._id}`
      }],
      providerMessageId: `in-app:${notification._id}`
    };
  }

  const isEmail = channel === 'email';
  const prefix = isEmail ? 'EMAIL' : 'CHAT';
  // Email remains an event-requested channel for backwards compatibility.
  // Chat is materialized from the user's own tenant-scoped opt-in, so domain
  // routes never need to know about or call the Zulip transport.
  const requested = isEmail ? recipient.channels.includes('email') : true;
  const enabled = requested && channelEnabled(preference, event.eventType, channel);
  const destination = isEmail ? recipient.email : preference.chat?.recipientEmail;
  const configured = isEmail ? notificationService.isConfigured() : zulipService.isConfigured();
  if (!requested || !enabled || !destination || !configured || preference.digest?.frequency === 'off') {
    const reason = !requested ? `${prefix}_NOT_REQUESTED`
      : !enabled || preference.digest?.frequency === 'off' ? `${prefix}_DISABLED`
        : !destination ? `${prefix}_ADDRESS_MISSING` : `${prefix}_NOT_CONFIGURED`;
    return {
      ...common,
      destination: destination || undefined,
      deliveryMode: 'immediate',
      status: 'skipped',
      nextAttemptAt: now,
      skippedAt: now,
      lastError: {
        code: reason,
        message: `Optional ${isEmail ? 'email' : 'chat'} delivery was skipped.`,
        retryable: false,
        at: now
      }
    };
  }

  const digestFrequency = preference.digest?.frequency;
  const digestMode = digestFrequency === 'daily' || digestFrequency === 'weekly';
  const scheduledAt = digestMode ? nextDigestAt(preference, now) : now;
  return {
    ...common,
    destination,
    deliveryMode: digestMode ? 'digest' : 'immediate',
    status: digestMode ? 'deferred' : 'pending',
    // Wait one minute after the local digest boundary. Events created at or
    // after the boundary are assigned to the next bucket, so a claimed batch
    // cannot miss a late insert and then replay an already-sent digest key.
    nextAttemptAt: digestMode
      ? new Date(scheduledAt.getTime() + DIGEST_COLLECTION_GRACE_MS)
      : scheduledAt,
    ...(digestMode ? {
      digest: {
        frequency: digestFrequency,
        bucketKey: `${digestFrequency}:${scheduledAt.toISOString()}`
      }
    } : {})
  };
}

async function materializeDomainEvent(event, now = new Date()) {
  if (!await notificationsEnabledForOrganization(event.organizationId)) {
    await markDomainEventProcessed(event, now);
    return;
  }

  for (const recipient of event.recipients) {
    const notification = await Notification.findOneAndUpdate(
      {
        organizationId: event.organizationId,
        eventId: event.eventId,
        userId: recipient.userId
      },
      {
        $setOnInsert: {
          organizationId: event.organizationId,
          userId: recipient.userId,
          eventId: event.eventId,
          eventType: event.eventType,
          category: event.notification.category,
          priority: event.notification.priority,
          title: event.notification.title,
          message: event.notification.message,
          deepLink: event.notification.deepLink,
          target: event.notification.target?.type && event.notification.target?.id
            ? event.notification.target
            : event.aggregate,
          isAction: event.notification.isAction,
          action: event.notification.action,
          actionStatus: 'open',
          dueAt: event.notification.dueAt
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    const preference = await loadPreference(event.organizationId, recipient.userId);
    for (const channel of ['in_app', ...EXTERNAL_CHANNELS]) {
      const seed = deliverySeed({ event, notification, recipient, channel, now, preference });
      await NotificationDelivery.findOneAndUpdate(
        { idempotencyKey: seed.idempotencyKey },
        { $setOnInsert: seed },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }
  }
  await markDomainEventProcessed(event, now);
}

function claimableDeliveryFilter({ now, deliveryMode, channel = null }) {
  return {
    channel: channel || { $in: EXTERNAL_CHANNELS },
    deliveryMode,
    status: { $in: ['pending', 'failed', 'deferred', 'processing'] },
    nextAttemptAt: { $lte: now },
    $expr: { $lt: ['$attemptCount', '$maxAttempts'] },
    $or: [
      { 'lease.expiresAt': { $exists: false } },
      { 'lease.expiresAt': null },
      { 'lease.expiresAt': { $lte: now } }
    ]
  };
}

async function claimImmediateDelivery({ workerId, now = new Date(), leaseMs = DEFAULT_DELIVERY_LEASE_MS }) {
  const lease = {
    owner: workerId,
    claimedAt: now,
    expiresAt: new Date(now.getTime() + Math.max(5000, leaseMs))
  };
  return NotificationDelivery.findOneAndUpdate(
    claimableDeliveryFilter({ now, deliveryMode: 'immediate' }),
    { $set: { status: 'processing', lease } },
    { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } }
  );
}

async function claimDigestBatch({ workerId, now = new Date(), leaseMs = DEFAULT_DELIVERY_LEASE_MS }) {
  const batchOwner = `${workerId}:${crypto.randomUUID()}`.slice(0, 240);
  const lease = {
    owner: batchOwner,
    claimedAt: now,
    expiresAt: new Date(now.getTime() + Math.max(5000, leaseMs))
  };
  const seed = await NotificationDelivery.findOneAndUpdate(
    claimableDeliveryFilter({ now, deliveryMode: 'digest' }),
    { $set: { status: 'processing', lease } },
    { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } }
  );
  if (!seed) return [];

  await NotificationDelivery.updateMany(
    {
      _id: { $ne: seed._id },
      organizationId: seed.organizationId,
      userId: seed.userId,
      destination: seed.destination,
      channel: seed.channel,
      deliveryMode: 'digest',
      'digest.bucketKey': seed.digest?.bucketKey,
      ...claimableDeliveryFilter({ now, deliveryMode: 'digest', channel: seed.channel })
    },
    { $set: { status: 'processing', lease } }
  );
  return NotificationDelivery.find({ 'lease.owner': batchOwner }).sort({ createdAt: 1 });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteDeepLink(deepLink) {
  const base = String(process.env.FRONTEND_URL || '').trim();
  const relative = String(deepLink || '');
  if (!base || !relative.startsWith('/') || relative.startsWith('//') || relative.includes('\\')) return '';
  try {
    const baseUrl = new URL(`${base.replace(/\/+$/, '')}/`);
    if (!['http:', 'https:'].includes(baseUrl.protocol)) return '';
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && baseUrl.protocol !== 'https:') {
      return '';
    }
    const resolved = new URL(relative, baseUrl);
    return resolved.origin === baseUrl.origin ? resolved.toString() : '';
  } catch (error) {
    return '';
  }
}

function escapeZulipMarkdown(value) {
  return sanitizePlainText(value, { required: false, maxLength: 180 })
    .replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1');
}

function genericChatTitle(notification = {}) {
  const eventType = String(notification.eventType || '');
  const baseEventType = eventType.split('.reminder')[0];
  return EVENT_PRESENTATIONS[eventType]?.title
    || EVENT_PRESENTATIONS[baseEventType]?.title
    || 'Performance action ready';
}

function buildImmediateChatMessage(notification) {
  const url = absoluteDeepLink(notification.deepLink);
  if (!url) return '';
  return `**${escapeZulipMarkdown(genericChatTitle(notification))}**\n\n[Open securely in Seemplify](${url})`;
}

function buildDigestChatMessage(notifications) {
  const visible = notifications.slice(0, 25);
  const items = visible.map((notification) => (
    `- [${escapeZulipMarkdown(genericChatTitle(notification))}](${absoluteDeepLink(notification.deepLink)})`
  )).join('\n');
  const remainder = notifications.length - visible.length;
  return `**Your Seemplify performance digest (${notifications.length})**\n\n${items}${remainder > 0 ? `\n\nAnd ${remainder} more.` : ''}`;
}

function buildImmediateEmail(notification) {
  const url = absoluteDeepLink(notification.deepLink);
  const title = escapeHtml(notification.title);
  const message = escapeHtml(notification.message);
  const actionLabel = escapeHtml(notification.action?.label || 'Open');
  const link = url
    ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#2563eb;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">${actionLabel}</a></p>`
    : '';
  return {
    subject: notification.title,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2>${title}</h2><p>${message}</p>${link}<p style="color:#667085;font-size:12px">Open Seemplify to view details. Sensitive performance information is not included in this email.</p></div>`,
    text: `${notification.title}\n\n${notification.message}${url ? `\n\n${url}` : ''}\n\nOpen Seemplify to view details.`
  };
}

function buildDigestEmail(notifications) {
  const visible = notifications.slice(0, 25);
  const items = visible.map(notification => {
    const url = absoluteDeepLink(notification.deepLink);
    const linkedTitle = url
      ? `<a href="${escapeHtml(url)}">${escapeHtml(notification.title)}</a>`
      : escapeHtml(notification.title);
    return `<li style="margin-bottom:12px"><strong>${linkedTitle}</strong><br>${escapeHtml(notification.message)}</li>`;
  }).join('');
  const remainder = notifications.length - visible.length;
  const extra = remainder > 0 ? `<p>And ${remainder} more item${remainder === 1 ? '' : 's'}.</p>` : '';
  const textItems = visible.map(item => `- ${item.title}: ${item.message}`).join('\n');
  return {
    subject: `Your Seemplify performance digest (${notifications.length})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2>Your performance action digest</h2><ul>${items}</ul>${extra}<p style="color:#667085;font-size:12px">Open Seemplify to view details. Sensitive performance information is not included in this email.</p></div>`,
    text: `Your performance action digest\n\n${textItems}${remainder > 0 ? `\nAnd ${remainder} more.` : ''}\n\nOpen Seemplify to view details.`
  };
}

function attemptEntry(delivery, outcome, startedAt, finishedAt, details = {}) {
  return {
    attempt: delivery.attemptCount + 1,
    startedAt,
    finishedAt,
    outcome,
    ...(details.providerMessageId ? { providerMessageId: details.providerMessageId } : {}),
    ...(details.error ? { error: details.error } : {})
  };
}

async function markDelivered(delivery, result, startedAt, finishedAt = new Date()) {
  const providerMessageId = result.messageId || '';
  return NotificationDelivery.updateOne(
    { _id: delivery._id, 'lease.owner': delivery.lease?.owner },
    {
      $set: {
        status: 'delivered',
        deliveredAt: finishedAt,
        providerMessageId
      },
      $unset: { lease: '', lastError: '' },
      $inc: { attemptCount: 1 },
      $push: {
        attempts: {
          $each: [attemptEntry(delivery, 'delivered', startedAt, finishedAt, { providerMessageId })],
          $slice: -30
        }
      }
    }
  );
}

async function markSkipped(delivery, code, message, now = new Date()) {
  return NotificationDelivery.updateOne(
    { _id: delivery._id, 'lease.owner': delivery.lease?.owner },
    {
      $set: {
        status: 'skipped',
        skippedAt: now,
        lastError: {
          code: sanitizePlainText(code, { required: false, maxLength: 120 }) || 'SKIPPED',
          message: sanitizePlainText(message, { required: false, maxLength: 500 }) || 'Delivery skipped.',
          retryable: false,
          at: now
        }
      },
      $unset: { lease: '' }
    }
  );
}

async function markDeferred(delivery, nextAttemptAt) {
  return NotificationDelivery.updateOne(
    { _id: delivery._id, 'lease.owner': delivery.lease?.owner },
    {
      $set: { status: 'deferred', nextAttemptAt },
      $unset: { lease: '' }
    }
  );
}

async function markFailed(delivery, result, startedAt, finishedAt = new Date()) {
  const failure = summarizeError({
    code: result.code || `${String(delivery.channel || 'external').toUpperCase()}_DELIVERY_FAILED`,
    message: result.error || 'External notification delivery failed.',
    retryable: result.retryable
  });
  const nextAttempt = delivery.attemptCount + 1;
  const terminal = !failure.retryable || nextAttempt >= delivery.maxAttempts;
  const nextAttemptAt = new Date(finishedAt.getTime() + calculateBackoffMs(nextAttempt));
  const error = { code: failure.code, message: failure.message, retryable: failure.retryable };
  return NotificationDelivery.updateOne(
    { _id: delivery._id, 'lease.owner': delivery.lease?.owner },
    {
      $set: {
        status: terminal ? 'dead_letter' : 'failed',
        nextAttemptAt,
        lastError: { ...error, at: finishedAt }
      },
      $unset: { lease: '' },
      $inc: { attemptCount: 1 },
      $push: {
        attempts: {
          $each: [attemptEntry(delivery, 'failed', startedAt, finishedAt, { error })],
          $slice: -30
        }
      }
    }
  );
}

async function processImmediateDelivery(delivery, now = new Date()) {
  if (!await notificationsEnabledForOrganization(delivery.organizationId)) {
    return markSkipped(
      delivery,
      'ORGANIZATION_FEATURE_DISABLED',
      'Notifications are disabled for this organization.',
      now
    );
  }

  const notification = await Notification.findOne({
    _id: delivery.notificationId,
    organizationId: delivery.organizationId,
    userId: delivery.userId
  }).lean();
  if (!notification) return markSkipped(delivery, 'NOTIFICATION_NOT_FOUND', 'Notification no longer exists.', now);
  if (notification.isAction && ['completed', 'dismissed'].includes(notification.actionStatus)) {
    return markSkipped(delivery, 'ACTION_CLOSED', 'The related action is already closed.', now);
  }

  const preference = await loadPreference(delivery.organizationId, delivery.userId);
  const channel = delivery.channel;
  const prefix = String(channel || 'external').toUpperCase();
  if (!EXTERNAL_CHANNELS.includes(channel)) {
    return markSkipped(delivery, 'CHANNEL_UNSUPPORTED', 'The delivery channel is unsupported.', now);
  }
  if (!channelEnabled(preference, notification.eventType, channel) || preference.digest?.frequency === 'off') {
    return markSkipped(delivery, `${prefix}_DISABLED`, `${channel} notifications are disabled.`, now);
  }
  if (!delivery.destination) {
    return markSkipped(delivery, `${prefix}_ADDRESS_MISSING`, `No ${channel} destination is available.`, now);
  }
  if (channel === 'chat' && delivery.destination !== preference.chat?.recipientEmail) {
    return markSkipped(delivery, 'CHAT_DESTINATION_CHANGED', 'The chat destination is no longer active.', now);
  }
  if (channel === 'email' && !notificationService.isConfigured()) {
    return markSkipped(delivery, 'EMAIL_NOT_CONFIGURED', 'Optional email delivery is not configured.', now);
  }
  if (channel === 'chat' && !zulipService.isConfigured()) {
    return markSkipped(delivery, 'CHAT_NOT_CONFIGURED', 'Optional chat delivery is not configured.', now);
  }
  const deferredUntil = quietHoursDeferral(preference, now);
  if (deferredUntil) return markDeferred(delivery, deferredUntil);

  const startedAt = new Date();
  let result;
  if (channel === 'email') {
    const content = buildImmediateEmail(notification);
    result = await notificationService.sendEmail(
      delivery.destination,
      content.subject,
      content.html,
      content.text,
      { idempotencyKey: delivery.idempotencyKey, tag: 'performance_action' }
    );
  } else {
    const content = buildImmediateChatMessage(notification);
    if (!content) {
      return markSkipped(
        delivery,
        'SECURE_DEEP_LINK_UNAVAILABLE',
        'Chat delivery requires a secure application deep link.',
        now
      );
    }
    result = await zulipService.sendPrivateMessage(delivery.destination, content);
  }
  if (result.success) return markDelivered(delivery, result, startedAt);
  if (channel === 'email' && result.error === 'Email service not configured') {
    return markSkipped(delivery, 'EMAIL_NOT_CONFIGURED', 'Optional email delivery is not configured.');
  }
  if (channel === 'chat' && result.code === 'ZULIP_NOT_CONFIGURED') {
    return markSkipped(delivery, 'CHAT_NOT_CONFIGURED', 'Optional chat delivery is not configured.');
  }
  return markFailed(delivery, result, startedAt);
}

async function processDigestBatch(deliveries, now = new Date()) {
  if (!deliveries.length) return;
  const first = deliveries[0];
  if (!await notificationsEnabledForOrganization(first.organizationId)) {
    await Promise.all(deliveries.map(delivery => markSkipped(
      delivery,
      'ORGANIZATION_FEATURE_DISABLED',
      'Notifications are disabled for this organization.',
      now
    )));
    return;
  }

  const channel = first.channel;
  const prefix = String(channel || 'external').toUpperCase();
  if (!EXTERNAL_CHANNELS.includes(channel)) {
    await Promise.all(deliveries.map(delivery => markSkipped(
      delivery,
      'CHANNEL_UNSUPPORTED',
      'The delivery channel is unsupported.',
      now
    )));
    return;
  }
  const preference = await loadPreference(first.organizationId, first.userId);
  if (preference.digest?.frequency === 'off') {
    await Promise.all(deliveries.map(delivery => markSkipped(
      delivery,
      `${prefix}_DISABLED`,
      `${channel} notifications are disabled.`,
      now
    )));
    return;
  }
  if (channel === 'email' && !notificationService.isConfigured()) {
    await Promise.all(deliveries.map(delivery => markSkipped(
      delivery,
      'EMAIL_NOT_CONFIGURED',
      'Optional email delivery is not configured.',
      now
    )));
    return;
  }
  if (channel === 'chat' && !zulipService.isConfigured()) {
    await Promise.all(deliveries.map(delivery => markSkipped(
      delivery,
      'CHAT_NOT_CONFIGURED',
      'Optional chat delivery is not configured.',
      now
    )));
    return;
  }
  const deferredUntil = quietHoursDeferral(preference, now);
  if (deferredUntil) {
    await Promise.all(deliveries.map(delivery => markDeferred(delivery, deferredUntil)));
    return;
  }

  const notifications = await Notification.find({
    _id: { $in: deliveries.map(delivery => delivery.notificationId) },
    organizationId: first.organizationId,
    userId: first.userId
  }).lean();
  const notificationById = new Map(notifications.map(item => [String(item._id), item]));
  const active = [];
  for (const delivery of deliveries) {
    const notification = notificationById.get(String(delivery.notificationId));
    if (!notification) {
      await markSkipped(delivery, 'NOTIFICATION_NOT_FOUND', 'Notification no longer exists.', now);
    } else if (notification.isAction && ['completed', 'dismissed'].includes(notification.actionStatus)) {
      await markSkipped(delivery, 'ACTION_CLOSED', 'The related action is already closed.', now);
    } else if (!channelEnabled(preference, notification.eventType, channel)) {
      await markSkipped(delivery, `${prefix}_DISABLED`, `${channel} notifications are disabled.`, now);
    } else if (!delivery.destination) {
      await markSkipped(delivery, `${prefix}_ADDRESS_MISSING`, `No ${channel} destination is available.`, now);
    } else if (channel === 'chat' && delivery.destination !== preference.chat?.recipientEmail) {
      await markSkipped(delivery, 'CHAT_DESTINATION_CHANGED', 'The chat destination is no longer active.', now);
    } else if (channel === 'chat' && !absoluteDeepLink(notification.deepLink)) {
      await markSkipped(
        delivery,
        'SECURE_DEEP_LINK_UNAVAILABLE',
        'Chat delivery requires a secure application deep link.',
        now
      );
    } else {
      active.push({ delivery, notification });
    }
  }
  if (!active.length) return;

  const notificationsForDelivery = active.map(item => item.notification);
  const bucket = first.digest?.bucketKey || first.nextAttemptAt?.toISOString() || 'unscheduled';
  const digestEventId = `digest-${crypto.createHash('sha256')
    .update(`${first.organizationId}|${first.userId}|${channel}|${first.destination || ''}|${bucket}`)
    .digest('hex')
    .slice(0, 32)}`;
  const idempotencyKey = `${digestEventId}:${first.userId}:${channel}`;
  const startedAt = new Date();
  let result;
  if (channel === 'email') {
    const content = buildDigestEmail(notificationsForDelivery);
    result = await notificationService.sendEmail(
      active[0].delivery.destination,
      content.subject,
      content.html,
      content.text,
      { idempotencyKey, tag: 'performance_digest' }
    );
  } else {
    result = await zulipService.sendPrivateMessage(
      active[0].delivery.destination,
      buildDigestChatMessage(notificationsForDelivery)
    );
  }
  if (result.success) {
    await Promise.all(active.map(({ delivery }) => markDelivered(delivery, result, startedAt)));
  } else {
    await Promise.all(active.map(({ delivery }) => markFailed(delivery, result, startedAt)));
  }
}

async function runNotificationWorkerOnce({
  workerId = `notification-worker-${process.pid}`,
  eventBatchSize = 25,
  deliveryBatchSize = 50,
  now = new Date()
} = {}) {
  const stats = {
    eventsProcessed: 0,
    eventsFailed: 0,
    immediateDeliveriesProcessed: 0,
    digestBatchesProcessed: 0
  };

  for (let index = 0; index < eventBatchSize; index += 1) {
    const event = await claimNextDomainEvent({ workerId, now });
    if (!event) break;
    try {
      await materializeDomainEvent(event, new Date());
      stats.eventsProcessed += 1;
    } catch (error) {
      await markDomainEventFailed(event, error, new Date());
      stats.eventsFailed += 1;
      console.error('Notification event processing failed:', sanitizePlainText(error.message, {
        required: false,
        maxLength: 300
      }));
    }
  }

  for (let index = 0; index < deliveryBatchSize; index += 1) {
    const deliveries = await claimDigestBatch({ workerId, now });
    if (!deliveries.length) break;
    await processDigestBatch(deliveries, new Date());
    stats.digestBatchesProcessed += 1;
  }

  for (let index = 0; index < deliveryBatchSize; index += 1) {
    const delivery = await claimImmediateDelivery({ workerId, now });
    if (!delivery) break;
    await processImmediateDelivery(delivery, new Date());
    stats.immediateDeliveriesProcessed += 1;
  }
  return stats;
}

function startNotificationWorker(options = {}) {
  const workerId = options.workerId || `notification-worker-${process.pid}-${crypto.randomUUID()}`;
  const pollIntervalMs = Math.max(1000, Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  let running = false;
  let stopped = false;

  const runNow = async () => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runNotificationWorkerOnce({ ...options, workerId });
    } catch (error) {
      console.error('Notification worker tick failed:', sanitizePlainText(error.message, {
        required: false,
        maxLength: 300
      }));
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void runNow(); }, pollIntervalMs);
  timer.unref?.();
  if (options.runImmediately !== false) void runNow();

  return {
    workerId,
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

module.exports = {
  DEFAULT_DELIVERY_LEASE_MS,
  DIGEST_COLLECTION_GRACE_MS,
  buildDigestChatMessage,
  buildDigestEmail,
  buildImmediateChatMessage,
  buildImmediateEmail,
  channelEnabled,
  defaultPreference,
  loadPreference,
  materializeDomainEvent,
  nextDigestAt,
  processDigestBatch,
  processImmediateDelivery,
  quietHoursDeferral,
  runNotificationWorkerOnce,
  startNotificationWorker,
  validateTimezone
};
