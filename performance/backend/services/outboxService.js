const crypto = require('crypto');
const mongoose = require('mongoose');
const DomainEvent = require('../models/DomainEvent');
const { formatMailAddress } = require('./mailClient');

const DEFAULT_EVENT_LEASE_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 8;
const SAFE_CHANNELS = new Set(['in_app', 'email', 'chat']);
const SAFE_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const SAFE_ACTION_KINDS = new Set(['open', 'acknowledge', 'review', 'approve', 'complete', 'view']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u2028\u2029]/gu;
const HTML_TAGS = /<[^>]*>/g;
const SENSITIVE_METADATA_KEY = /(password|secret|token|authorization|cookie|assessment|comment|feedback|reason|content|transcript|document)/i;

class DomainEventConflictError extends Error {
  constructor(eventId) {
    super(`Domain event "${eventId}" already exists with different content.`);
    this.name = 'DomainEventConflictError';
    this.code = 'DOMAIN_EVENT_CONFLICT';
    this.retryable = false;
  }
}

function requireString(value, label, maxLength = 240) {
  const normalized = String(value == null ? '' : value)
    .replace(CONTROL_CHARACTERS, ' ')
    .trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  if (normalized.length > maxLength) throw new TypeError(`${label} is too long.`);
  return normalized;
}

function sanitizePlainText(value, { label = 'Text', maxLength = 1000, required = true } = {}) {
  const normalized = String(value == null ? '' : value)
    .replace(HTML_TAGS, ' ')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (required && !normalized) throw new TypeError(`${label} is required.`);
  return normalized.slice(0, maxLength);
}

function sanitizeDeepLink(value) {
  const raw = requireString(value, 'Notification deep link', 1000);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /%0d|%0a/i.test(raw)) {
    throw new TypeError('Notification deep link must be an application-relative path.');
  }

  const base = new URL('https://seemplify.invalid');
  const parsed = new URL(raw, base);
  if (parsed.origin !== base.origin) {
    throw new TypeError('Notification deep link must stay within the application.');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function sanitizeEmail(value) {
  if (!value) return '';
  try {
    return formatMailAddress(String(value).trim());
  } catch (error) {
    // An invalid optional email must not prevent the mandatory in-app action.
    return '';
  }
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 3 || value == null) return undefined;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizePlainText(value, { required: false, maxLength: 300 });
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 30)
      .map(item => sanitizeMetadata(item, depth + 1))
      .filter(item => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;

  const result = {};
  for (const key of Object.keys(value).sort().slice(0, 30)) {
    if (SENSITIVE_METADATA_KEY.test(key)) continue;
    const safeKey = sanitizePlainText(key, { required: false, maxLength: 80 });
    if (!safeKey) continue;
    const safeValue = sanitizeMetadata(value[key], depth + 1);
    if (safeValue !== undefined) result[safeKey] = safeValue;
  }
  return result;
}

function normalizeChannels(channels) {
  const requested = Array.isArray(channels) ? channels : [];
  const normalized = requested
    .map(channel => String(channel || '').trim().toLowerCase())
    .filter(channel => SAFE_CHANNELS.has(channel));
  // In-app delivery is mandatory for a reliable Action Centre. External
  // channels remain optional and are evaluated again against the recipient's
  // tenant-scoped preferences by the delivery worker.
  return Array.from(new Set(['in_app', ...normalized]));
}

function normalizeRecipients(recipients) {
  if (recipients == null) return [];
  if (!Array.isArray(recipients)) throw new TypeError('Notification recipients must be an array.');

  const byUser = new Map();
  for (const recipient of recipients) {
    const userId = requireString(recipient?.userId, 'Recipient user ID');
    const existing = byUser.get(userId);
    const channels = normalizeChannels(recipient?.channels);
    byUser.set(userId, {
      userId,
      name: sanitizePlainText(recipient?.name, { required: false, maxLength: 160 }),
      email: sanitizeEmail(recipient?.email),
      channels: Array.from(new Set([...(existing?.channels || []), ...channels]))
    });
  }

  if (byUser.size > 500) throw new TypeError('A domain event cannot have more than 500 recipients.');
  return Array.from(byUser.values()).sort((left, right) => left.userId.localeCompare(right.userId));
}

function normalizeNotification(notification = {}) {
  const priority = String(notification.priority || 'normal').toLowerCase();
  const actionKind = String(notification.action?.kind || 'open').toLowerCase();
  const dueAt = notification.dueAt ? new Date(notification.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new TypeError('Notification dueAt must be a valid date.');

  return {
    category: sanitizePlainText(notification.category || 'performance', {
      label: 'Notification category',
      maxLength: 80
    }),
    title: sanitizePlainText(notification.title, { label: 'Notification title', maxLength: 180 }),
    message: sanitizePlainText(notification.message, { label: 'Notification message', maxLength: 1000 }),
    deepLink: sanitizeDeepLink(notification.deepLink),
    priority: SAFE_PRIORITIES.has(priority) ? priority : 'normal',
    isAction: notification.isAction !== false,
    action: {
      kind: SAFE_ACTION_KINDS.has(actionKind) ? actionKind : 'open',
      label: sanitizePlainText(notification.action?.label || 'Open', {
        label: 'Notification action label',
        maxLength: 80
      })
    },
    ...(notification.target?.type && notification.target?.id ? {
      target: {
        type: requireString(notification.target.type, 'Notification target type', 80),
        id: requireString(notification.target.id, 'Notification target ID')
      }
    } : {}),
    ...(dueAt ? { dueAt } : {})
  };
}

function normalizeDomainEvent(input = {}) {
  const availableAt = input.availableAt ? new Date(input.availableAt) : new Date();
  if (Number.isNaN(availableAt.getTime())) throw new TypeError('Domain event availableAt must be a valid date.');
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new TypeError('Domain event occurredAt must be a valid date.');

  const eventId = input.eventId
    ? requireString(input.eventId, 'Domain event ID', 240)
    : crypto.randomUUID();
  const eventType = requireString(input.eventType || input.type, 'Domain event type', 160);
  const organizationId = requireString(input.organizationId, 'Organization ID');
  const aggregate = {
    type: requireString(input.aggregate?.type || input.target?.type, 'Aggregate type', 80),
    id: requireString(input.aggregate?.id || input.target?.id, 'Aggregate ID')
  };
  const notification = normalizeNotification(input.notification);
  const recipients = normalizeRecipients(input.recipients);
  const actorId = input.actor?.userId || input.actor?.id || input.actor?.sub || input.actorId;
  const maxAttempts = Math.max(1, Math.min(30, Number(input.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const metadata = sanitizeMetadata(input.metadata) || {};

  const hashInput = {
    eventType,
    organizationId,
    aggregate,
    actor: actorId ? { userId: requireString(actorId, 'Actor user ID') } : {},
    recipients,
    notification,
    metadata
  };
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

  return {
    eventId,
    contentHash,
    ...hashInput,
    occurredAt,
    status: 'pending',
    availableAt,
    maxAttempts
  };
}

const EVENT_PRESENTATIONS = Object.freeze({
  'appraisal.cycle_launched': {
    title: 'Appraisal cycle started',
    message: 'A new appraisal cycle is ready to view.',
    category: 'appraisal',
    action: { kind: 'view', label: 'View cycle' },
    isAction: false
  },
  'appraisal.self_assessment_due': {
    title: 'Self-assessment due',
    message: 'A self-assessment is ready to complete.',
    category: 'appraisal',
    targetType: 'appraisal_self_assessment',
    action: { kind: 'complete', label: 'Open self-assessment' }
  },
  'appraisal.self_submitted': {
    title: 'Self-assessment submitted',
    message: 'A self-assessment is ready for manager review.',
    category: 'appraisal',
    targetType: 'appraisal_manager_review',
    action: { kind: 'review', label: 'Review assessment' }
  },
  'appraisal.manager_submitted': {
    title: 'Manager review submitted',
    message: 'An appraisal has moved to its next review stage.',
    category: 'appraisal',
    action: { kind: 'view', label: 'View appraisal' },
    isAction: false
  },
  'appraisal.discussion_ready': {
    title: 'Appraisal discussion ready',
    message: 'An appraisal discussion is ready to prepare and complete.',
    category: 'appraisal',
    targetType: 'appraisal_discussion',
    action: { kind: 'complete', label: 'Open discussion' }
  },
  'appraisal.finalized': {
    title: 'Appraisal outcome ready',
    message: 'A finalized appraisal outcome is ready to review securely.',
    category: 'appraisal',
    targetType: 'appraisal_acknowledgement',
    action: { kind: 'acknowledge', label: 'Review outcome' }
  },
  'appraisal.acknowledged': {
    title: 'Appraisal acknowledged',
    message: 'An appraisal acknowledgement has been recorded.',
    category: 'appraisal',
    action: { kind: 'view', label: 'View appraisal' },
    isAction: false
  },
  'development_plan.draft_created': {
    title: 'Development plan draft ready',
    message: 'A development plan draft is ready to review.',
    category: 'development',
    action: { kind: 'review', label: 'Review plan' }
  },
  'feedback.requested': {
    title: 'Feedback requested',
    message: 'A feedback request needs your response.',
    category: 'feedback',
    action: { kind: 'review', label: 'Open request' }
  },
  'feedback.received': {
    title: 'New feedback available',
    message: 'New feedback is ready to view securely in Seemplify.',
    category: 'feedback',
    action: { kind: 'acknowledge', label: 'View feedback' }
  },
  'performance_check_in.submitted': {
    title: 'Check-in submitted',
    message: 'A performance check-in is ready to review.',
    category: 'check_in',
    action: { kind: 'review', label: 'Open check-in' }
  },
  'performance_check_in.manager_responded': {
    title: 'Manager response available',
    message: 'Your manager has responded to a performance check-in.',
    category: 'check_in',
    action: { kind: 'view', label: 'View response' },
    isAction: false
  },
  'one_on_one.scheduled': {
    title: '1:1 meeting scheduled',
    message: 'A 1:1 meeting is ready to prepare for.',
    category: 'one_on_one',
    targetType: 'one_on_one',
    action: { kind: 'review', label: 'Prepare for meeting' }
  },
  'one_on_one.rescheduled': {
    title: '1:1 meeting rescheduled',
    message: 'An updated 1:1 meeting is ready to review.',
    category: 'one_on_one',
    targetType: 'one_on_one',
    action: { kind: 'review', label: 'Review meeting' }
  },
  'one_on_one.cancelled': {
    title: '1:1 meeting cancelled',
    message: 'A 1:1 meeting cancellation has been recorded.',
    category: 'one_on_one',
    action: { kind: 'view', label: 'View 1:1 meetings' },
    isAction: false
  },
  'one_on_one.completed': {
    title: '1:1 meeting completed',
    message: 'A 1:1 meeting has been marked complete.',
    category: 'one_on_one',
    action: { kind: 'view', label: 'View meeting' },
    isAction: false
  },
  'one_on_one.prep_ready': {
    title: '1:1 preparation ready',
    message: 'Preparation suggestions are ready to view securely.',
    category: 'one_on_one',
    action: { kind: 'view', label: 'View preparation' },
    isAction: false
  },
  'one_on_one.action_item_due': {
    title: '1:1 action item due',
    message: 'An action agreed in a 1:1 meeting needs attention.',
    category: 'one_on_one',
    targetType: 'one_on_one_action_item',
    action: { kind: 'complete', label: 'Open action item' }
  },
  'one_on_one.action_item_completed': {
    title: '1:1 action item completed',
    message: 'A 1:1 action item has been marked complete.',
    category: 'one_on_one',
    action: { kind: 'view', label: 'View meeting' },
    isAction: false
  },
  'goal.assigned': {
    title: 'Goal assigned',
    message: 'A new goal is ready for acknowledgement.',
    category: 'goal',
    targetType: 'goal_assignment',
    action: { kind: 'acknowledge', label: 'Review goal' }
  },
  'goal.assigned_without_acknowledgement': {
    title: 'New goal assigned',
    message: 'A new active goal is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.submitted': {
    title: 'Goal awaiting review',
    message: 'A submitted goal is ready for review.',
    category: 'goal',
    targetType: 'goal_approval',
    action: { kind: 'review', label: 'Review goal' }
  },
  'goal.approved': {
    title: 'Goal approved',
    message: 'A goal decision is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.changes_requested': {
    title: 'Goal changes requested',
    message: 'A goal needs changes before it can proceed.',
    category: 'goal',
    targetType: 'goal_changes',
    action: { kind: 'review', label: 'Update goal' }
  },
  'goal.change_requested': {
    title: 'Goal change requested',
    message: 'A proposed goal change is ready for review.',
    category: 'goal',
    targetType: 'goal_change_request',
    action: { kind: 'review', label: 'Review request' }
  },
  'goal.rejected': {
    title: 'Goal decision recorded',
    message: 'A goal decision is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.assignment_acknowledged': {
    title: 'Goal assignment acknowledged',
    message: 'A goal assignment acknowledgement has been recorded.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.change_request_approved': {
    title: 'Goal change approved',
    message: 'A goal change decision is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.change_request_rejected': {
    title: 'Goal change decision recorded',
    message: 'A goal change decision is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  },
  'goal.checked_in': {
    title: 'Goal progress updated',
    message: 'A goal progress update is ready to view.',
    category: 'goal',
    action: { kind: 'view', label: 'View goal' },
    isAction: false
  }
});

function fallbackDeepLink(eventType, aggregateId) {
  const category = String(eventType || '').split('.')[0];
  const encodedId = encodeURIComponent(String(aggregateId || ''));
  if (category === 'goal') return encodedId ? `/okrs?goal=${encodedId}` : '/okrs';
  if (category === 'goal_period') return '/okrs';
  if (category === 'feedback') return '/feedback';
  if (category === 'development_plan') return '/development';
  if (category === 'performance_check_in') return '/check-ins';
  if (category === 'one_on_one') return '/one-on-ones';
  if (category === 'appraisal') return '/appraisals';
  return '/dashboard';
}

function compatibleRecipients(recipients) {
  if (!Array.isArray(recipients)) return [];
  return recipients.map(recipient => {
    if (typeof recipient === 'string' || typeof recipient === 'number') {
      return { userId: String(recipient), channels: ['in_app'] };
    }
    return {
      userId: recipient?.userId || recipient?.id || recipient?.sub,
      name: recipient?.name,
      email: recipient?.email,
      channels: recipient?.channels
    };
  }).filter(recipient => recipient.userId);
}

const SINGLETON_EVENT_TYPES = new Set([
  'appraisal.cycle_launched',
  'appraisal.self_assessment_due',
  'appraisal.self_submitted',
  'appraisal.manager_submitted',
  'appraisal.discussion_ready',
  'appraisal.finalized',
  'appraisal.acknowledged',
  'development_plan.draft_created',
  'feedback.requested',
  'feedback.received',
  'performance_check_in.submitted',
  'goal_period.created',
  'goal_period.opened',
  'goal_period.closed'
]);

function compatibleEventId(input, eventType, aggregateType, aggregateId, dueAt) {
  if (input.eventId || input.idempotencyKey) return input.eventId || input.idempotencyKey;
  if (!SINGLETON_EVENT_TYPES.has(eventType)) return undefined;
  let dueDiscriminator = '';
  if (dueAt) {
    const date = new Date(dueAt);
    if (!Number.isNaN(date.getTime())) dueDiscriminator = `:${date.toISOString()}`;
  }
  return `${eventType}:${aggregateType}:${aggregateId}${dueDiscriminator}`;
}

/**
 * Backwards-friendly adapter used by existing goal, feedback and appraisal
 * hooks. It accepts both `{ eventType, payload, actor }` and the earlier
 * `{ type, data, actorId, recipients }` shape, while generating only generic,
 * safe presentation text. Events without recipients remain durable audit/outbox
 * records and are processed without creating user notifications.
 */
async function recordEvent(input = {}, options = {}) {
  const eventType = input.eventType || input.type;
  const aggregateType = input.aggregateType || input.aggregate?.type || input.target?.type;
  const aggregateId = input.aggregateId || input.aggregate?.id || input.target?.id;
  const data = input.payload || input.data || {};
  const recipients = compatibleRecipients(input.recipients);
  const presentation = EVENT_PRESENTATIONS[eventType] || {
    title: 'Performance update',
    message: 'A performance item has been updated.',
    category: String(eventType || 'performance').split('.')[0].slice(0, 80) || 'performance',
    action: { kind: 'view', label: 'View update' },
    isAction: false
  };
  const suppliedDeepLink = data.deepLink || input.notification?.deepLink;
  let deepLink = fallbackDeepLink(eventType, aggregateId);
  if (suppliedDeepLink) {
    try {
      deepLink = sanitizeDeepLink(suppliedDeepLink);
    } catch (error) {
      // A malformed external link must not block durable event capture.
    }
  }
  const dueAt = data.dueAt || data.dueDate || input.notification?.dueAt;

  return publishDomainEvent({
    eventId: compatibleEventId(input, eventType, aggregateType, aggregateId, dueAt),
    eventType,
    organizationId: input.organizationId,
    aggregate: { type: aggregateType, id: aggregateId },
    actor: {
      userId: input.actorId
        || input.actor?.userId
        || input.actor?.id
        || input.actor?.sub
    },
    recipients,
    occurredAt: input.occurredAt,
    availableAt: input.availableAt,
    maxAttempts: input.maxAttempts,
    notification: {
      category: presentation.category,
      title: presentation.title,
      message: presentation.message,
      deepLink,
      priority: input.notification?.priority || (String(eventType).includes('overdue') ? 'urgent' : 'normal'),
      isAction: recipients.length > 0 && (input.notification?.isAction ?? presentation.isAction ?? true),
      action: input.notification?.action || presentation.action,
      target: {
        type: presentation.targetType || aggregateType,
        id: aggregateId
      },
      ...(dueAt ? { dueAt } : {})
    },
    metadata: data
  }, options);
}

/**
 * Persist a durable outbox event. Passing a Mongo session lets the caller save
 * its business record and this event in the same transaction. Without a
 * session, the unique eventId plus idempotent worker upserts provide the
 * standalone-Mongo fallback.
 */
async function publishDomainEvent(input, { session = null } = {}) {
  const normalized = normalizeDomainEvent(input);
  let query = DomainEvent.findOneAndUpdate(
    { eventId: normalized.eventId },
    { $setOnInsert: normalized },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  if (session) query = query.session(session);

  let event;
  try {
    event = await query.exec();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    let duplicateQuery = DomainEvent.findOne({ eventId: normalized.eventId });
    if (session) duplicateQuery = duplicateQuery.session(session);
    event = await duplicateQuery.exec();
  }

  if (!event || event.contentHash !== normalized.contentHash) {
    throw new DomainEventConflictError(normalized.eventId);
  }
  return event;
}

async function withOutboxTransaction(work, transactionOptions = {}) {
  if (typeof work !== 'function') throw new TypeError('Transaction work must be a function.');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work({
        session,
        publishDomainEvent: input => publishDomainEvent(input, { session })
      });
    }, transactionOptions);
    return result;
  } finally {
    await session.endSession();
  }
}

function calculateBackoffMs(attempt, { baseMs = 5000, maxMs = 60 * 60 * 1000 } = {}) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(maxMs, baseMs * (2 ** Math.min(safeAttempt - 1, 16)));
}

function summarizeError(error) {
  return {
    code: sanitizePlainText(error?.code || error?.name || 'PROCESSING_ERROR', {
      required: false,
      maxLength: 120
    }) || 'PROCESSING_ERROR',
    message: sanitizePlainText(error?.message || 'Domain event processing failed.', {
      required: false,
      maxLength: 500
    }) || 'Domain event processing failed.',
    retryable: error?.retryable !== false
  };
}

async function claimNextDomainEvent({
  workerId,
  now = new Date(),
  leaseMs = DEFAULT_EVENT_LEASE_MS
} = {}) {
  const owner = requireString(workerId || `notification-worker-${process.pid}`, 'Worker ID');
  const leaseUntil = new Date(now.getTime() + Math.max(5000, Number(leaseMs) || DEFAULT_EVENT_LEASE_MS));

  return DomainEvent.findOneAndUpdate(
    {
      status: { $in: ['pending', 'failed', 'processing'] },
      availableAt: { $lte: now },
      $and: [
        {
          $or: [
            { $expr: { $lt: ['$attempts', '$maxAttempts'] } },
            { status: 'processing', 'lease.expiresAt': { $lte: now } }
          ]
        },
        {
          $or: [
            { 'lease.expiresAt': { $exists: false } },
            { 'lease.expiresAt': null },
            { 'lease.expiresAt': { $lte: now } }
          ]
        }
      ]
    },
    {
      $set: {
        status: 'processing',
        lease: { owner, claimedAt: now, expiresAt: leaseUntil }
      },
      $inc: { attempts: 1 }
    },
    { new: true, sort: { availableAt: 1, createdAt: 1 } }
  );
}

async function markDomainEventProcessed(event, now = new Date()) {
  return DomainEvent.updateOne(
    { _id: event._id, 'lease.owner': event.lease?.owner },
    {
      $set: { status: 'processed', processedAt: now },
      $unset: { lease: '', lastError: '' }
    }
  );
}

async function markDomainEventFailed(event, error, now = new Date()) {
  const failure = summarizeError(error);
  const terminal = !failure.retryable || event.attempts >= event.maxAttempts;
  const availableAt = new Date(now.getTime() + calculateBackoffMs(event.attempts));
  return DomainEvent.updateOne(
    { _id: event._id, 'lease.owner': event.lease?.owner },
    {
      $set: {
        status: terminal ? 'dead_letter' : 'failed',
        availableAt,
        lastError: { code: failure.code, message: failure.message, at: now }
      },
      $unset: { lease: '' }
    }
  );
}

async function cancelDomainEventsForTarget({
  organizationId,
  targetType,
  targetId,
  userId = null,
  keepDueAt = null,
  reason = 'target_completed',
  session = null
}) {
  const now = new Date();
  const filter = {
    organizationId: requireString(organizationId, 'Organization ID'),
    $or: [
      {
        'aggregate.type': requireString(targetType, 'Target type', 80),
        'aggregate.id': requireString(targetId, 'Target ID')
      },
      {
        'notification.target.type': requireString(targetType, 'Target type', 80),
        'notification.target.id': requireString(targetId, 'Target ID')
      }
    ],
    status: { $in: ['pending', 'failed', 'processing'] }
  };
  if (userId) filter['recipients.userId'] = requireString(userId, 'Recipient user ID');
  if (keepDueAt) {
    const keepDate = new Date(keepDueAt);
    if (!Number.isNaN(keepDate.getTime())) filter['notification.dueAt'] = { $ne: keepDate };
  }
  let query = DomainEvent.updateMany(
    filter,
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        lastError: {
          code: 'CANCELLED',
          message: sanitizePlainText(reason, { required: false, maxLength: 500 }) || 'Cancelled.',
          at: now
        }
      },
      $unset: { lease: '' }
    }
  );
  if (session) query = query.session(session);
  return query;
}

function makeDeliveryIdempotencyKey(eventId, userId, channel) {
  const safeChannel = requireString(channel, 'Delivery channel', 20).toLowerCase();
  if (!SAFE_CHANNELS.has(safeChannel)) throw new TypeError('Unsupported delivery channel.');
  return `${requireString(eventId, 'Domain event ID', 240)}:${requireString(userId, 'Recipient user ID')}:${safeChannel}`;
}

module.exports = {
  DEFAULT_EVENT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DomainEventConflictError,
  EVENT_PRESENTATIONS,
  calculateBackoffMs,
  cancelDomainEventsForTarget,
  claimNextDomainEvent,
  makeDeliveryIdempotencyKey,
  markDomainEventFailed,
  markDomainEventProcessed,
  normalizeDomainEvent,
  normalizeNotification,
  publishDomainEvent,
  recordEvent,
  requireString,
  sanitizeDeepLink,
  sanitizeMetadata,
  sanitizePlainText,
  summarizeError,
  withOutboxTransaction
};
