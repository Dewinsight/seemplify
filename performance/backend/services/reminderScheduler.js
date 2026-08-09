const crypto = require('crypto');
const ScheduledReminder = require('../models/ScheduledReminder');
const Notification = require('../models/Notification');
const NotificationDelivery = require('../models/NotificationDelivery');
const { formatMailAddress } = require('./mailClient');
const {
  calculateBackoffMs,
  cancelDomainEventsForTarget,
  EVENT_PRESENTATIONS,
  normalizeNotification,
  publishDomainEvent,
  requireString,
  sanitizePlainText,
  summarizeError
} = require('./outboxService');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_LEASE_MS = 60 * 1000;
const DEFAULT_SCHEDULER_INTERVAL_MS = 60 * 1000;
const DEFAULT_OVERDUE_AFTER_MS = 60 * 60 * 1000;
const REMINDER_STAGES = Object.freeze([
  { stage: '7d', offsetMs: -7 * DAY_MS, wording: 'Due in 7 days' },
  { stage: '3d', offsetMs: -3 * DAY_MS, wording: 'Due in 3 days' },
  { stage: '1d', offsetMs: -1 * DAY_MS, wording: 'Due tomorrow' },
  { stage: 'overdue', offsetMs: null, wording: 'Overdue' }
]);

function normalizeRecipient(user = {}) {
  let email = '';
  try {
    email = user.email ? formatMailAddress(String(user.email).trim()) : '';
  } catch (error) {
    email = '';
  }
  const requestedChannels = Array.isArray(user.channels)
    ? user.channels
    : (email ? ['email'] : []);
  const channels = Array.from(new Set([
    'in_app',
    ...requestedChannels
  ].filter(channel => ['in_app', 'email', 'chat'].includes(channel))));
  return {
    userId: requireString(user.userId, 'Reminder recipient user ID'),
    name: sanitizePlainText(user.name, { required: false, maxLength: 160 }),
    email,
    channels
  };
}

function stageNotification(base, stage) {
  const stageTitle = stage.stage === 'overdue'
    ? `${base.title} - overdue`
    : `${base.title} - ${stage.wording.toLowerCase()}`;
  const stageMessage = `${base.message} ${stage.wording}.`;
  return {
    category: base.category,
    title: sanitizePlainText(stageTitle, { maxLength: 180 }),
    message: sanitizePlainText(stageMessage, { maxLength: 1000 }),
    deepLink: base.deepLink,
    priority: stage.stage === 'overdue' ? 'urgent' : base.priority,
    action: base.action
  };
}

/**
 * Create an auditable 7/3/1/overdue reminder sequence. Windows that have
 * already elapsed are retained as cancelled records; an already-overdue target
 * receives its overdue reminder on the next scheduler tick.
 */
async function scheduleReminderSequence(input, { session = null } = {}) {
  if (!input.user && !input.recipient && Array.isArray(input.recipients)) {
    const scheduled = [];
    for (const recipient of input.recipients) {
      const items = await scheduleReminderSequence({
        ...input,
        recipients: undefined,
        recipient
      }, { session });
      scheduled.push(...items);
    }
    return scheduled;
  }

  const organizationId = requireString(input.organizationId, 'Organization ID');
  const eventType = requireString(input.eventType, 'Reminder event type', 160);
  const targetInput = input.target || {
    type: input.targetType,
    id: input.targetId
  };
  const target = {
    type: requireString(targetInput?.type, 'Reminder target type', 80),
    id: requireString(targetInput?.id, 'Reminder target ID')
  };
  const recipient = normalizeRecipient(input.user || input.recipient);
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new TypeError('Reminder dueAt must be a valid date.');
  const now = input.now ? new Date(input.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError('Reminder now must be a valid date.');
  const overdueAfterMs = Math.max(
    60 * 1000,
    Number(input.overdueAfterMs) || DEFAULT_OVERDUE_AFTER_MS
  );
  const presentation = EVENT_PRESENTATIONS[eventType] || {
    title: 'Performance action due',
    message: 'A performance action needs your attention.',
    category: 'performance',
    action: { kind: 'open', label: 'Open action' }
  };
  const baseNotification = normalizeNotification({
    category: input.notification?.category || presentation.category,
    title: input.notification?.title || presentation.title,
    message: input.notification?.message || presentation.message,
    deepLink: input.notification?.deepLink || input.deepLink || '/dashboard',
    priority: input.notification?.priority || 'normal',
    action: input.notification?.action || presentation.action,
    isAction: true,
    dueAt
  });

  // Reconcile any previous deadline before upserting this sequence. The
  // keepDueAt predicate preserves an event/action already written for the new
  // deadline while closing older or undated actions for the same target.
  await cancelRemindersForTarget({
    organizationId,
    targetType: target.type,
    targetId: target.id,
    userId: recipient.userId,
    keepDueAt: dueAt,
    reason: 'deadline_rescheduled',
    session
  });

  const reminders = [];
  for (const stage of REMINDER_STAGES) {
    const intendedTime = stage.stage === 'overdue'
      ? new Date(dueAt.getTime() + overdueAfterMs)
      : new Date(dueAt.getTime() + stage.offsetMs);
    const windowElapsed = stage.stage !== 'overdue' && intendedTime <= now;
    const scheduledFor = stage.stage === 'overdue' && intendedTime <= now ? now : intendedTime;
    const seed = {
      organizationId,
      userId: recipient.userId,
      eventType,
      target,
      stage: stage.stage,
      dueAt,
      status: windowElapsed ? 'cancelled' : 'scheduled',
      ...(windowElapsed ? {
        cancelledAt: now,
        cancellationReason: 'reminder_window_elapsed'
      } : {})
    };

    const identityFilter = {
      organizationId,
      'target.type': target.type,
      'target.id': target.id,
      userId: recipient.userId,
      stage: stage.stage,
      dueAt
    };

    // A completed/cancelled target can be deliberately reopened, and a
    // deadline can be moved back to an earlier value. Reactivate only an exact
    // cancelled sequence; already scheduled/emitted reminders remain
    // idempotent. A new persisted emission ID avoids colliding with any event
    // emitted before the target was closed.
    if (!windowElapsed) {
      let reactivateQuery = ScheduledReminder.updateOne(
        { ...identityFilter, status: 'cancelled' },
        {
          $set: {
            status: 'scheduled',
            scheduledFor,
            attempts: 0,
            emittedEventId: `reminder-reactivated:${crypto.randomUUID()}`
          },
          $unset: {
            cancelledAt: '',
            cancellationReason: '',
            emittedAt: '',
            nextAttemptAt: '',
            lease: '',
            lastError: ''
          }
        }
      );
      if (session) reactivateQuery = reactivateQuery.session(session);
      await reactivateQuery;
    }

    let query = ScheduledReminder.findOneAndUpdate(
      identityFilter,
      {
        $set: {
          recipient: {
            name: recipient.name,
            email: recipient.email,
            channels: recipient.channels
          },
          scheduledFor,
          notification: stageNotification(baseNotification, stage)
        },
        $setOnInsert: seed
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    if (session) query = query.session(session);
    reminders.push(await query);
  }
  return reminders;
}

async function cancelRemindersForTarget({
  organizationId,
  targetType,
  targetId,
  userId = null,
  keepDueAt = null,
  reason = 'target_completed',
  session = null
}) {
  const safeOrganizationId = requireString(organizationId, 'Organization ID');
  const safeTargetType = requireString(targetType, 'Target type', 80);
  const safeTargetId = requireString(targetId, 'Target ID');
  const now = new Date();
  const filter = {
    organizationId: safeOrganizationId,
    'target.type': safeTargetType,
    'target.id': safeTargetId,
    status: { $in: ['scheduled', 'processing', 'failed', 'emitted'] }
  };
  if (userId) filter.userId = requireString(userId, 'Recipient user ID');
  const keepDate = keepDueAt ? new Date(keepDueAt) : null;
  if (keepDate && !Number.isNaN(keepDate.getTime())) filter.dueAt = { $ne: keepDate };

  let query = ScheduledReminder.updateMany(
    filter,
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancellationReason: sanitizePlainText(reason, { required: false, maxLength: 160 }) || 'target_completed'
      },
      $unset: { lease: '' }
    }
  );
  if (session) query = query.session(session);
  const result = await query;

  const notificationFilter = {
    organizationId: safeOrganizationId,
    'target.type': safeTargetType,
    'target.id': safeTargetId,
    isAction: true,
    actionStatus: { $in: ['open', 'snoozed'] }
  };
  if (userId) notificationFilter.userId = requireString(userId, 'Recipient user ID');
  if (keepDate && !Number.isNaN(keepDate.getTime())) notificationFilter.dueAt = { $ne: keepDate };
  let notificationQuery = Notification.find(notificationFilter).select('_id').lean();
  if (session) notificationQuery = notificationQuery.session(session);
  const notifications = await notificationQuery;
  const notificationIds = notifications.map(item => item._id);

  let notificationsClosed = 0;
  let deliveriesCancelled = 0;
  if (notificationIds.length > 0) {
    let closeQuery = Notification.updateMany(
      { _id: { $in: notificationIds }, ...notificationFilter },
      {
        $set: { actionStatus: 'completed', completedAt: now, readAt: now },
        $unset: { snoozedUntil: '' }
      }
    );
    if (session) closeQuery = closeQuery.session(session);
    const closeResult = await closeQuery;
    notificationsClosed = closeResult.modifiedCount || 0;

    let deliveryQuery = NotificationDelivery.updateMany(
      {
        notificationId: { $in: notificationIds },
        organizationId: safeOrganizationId,
        channel: { $in: ['email', 'chat'] },
        status: { $in: ['pending', 'processing', 'deferred', 'failed'] }
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          lastError: {
            code: 'ACTION_CANCELLED',
            message: 'Delivery cancelled because the related action is no longer active.',
            retryable: false,
            at: now
          }
        },
        $unset: { lease: '' }
      }
    );
    if (session) deliveryQuery = deliveryQuery.session(session);
    const deliveryResult = await deliveryQuery;
    deliveriesCancelled = deliveryResult.modifiedCount || 0;
  }

  // Also stop any matching outbox event that has not yet materialized. Closed
  // in-app actions remain in the user's history for traceability.
  await cancelDomainEventsForTarget({
    organizationId: safeOrganizationId,
    targetType: safeTargetType,
    targetId: safeTargetId,
    userId,
    keepDueAt: keepDate,
    reason,
    session
  });
  return {
    acknowledged: result.acknowledged,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    notificationsClosed,
    deliveriesCancelled
  };
}

function firstBusinessReminderAfter(value) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(9, 0, 0, 0);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

async function pauseRemindersForUserLeave({ organizationId, userId, startAt, endAt, reason = 'approved_leave' }) {
  const safeOrganizationId = requireString(organizationId, 'Organization ID');
  const safeUserId = requireString(userId, 'User ID');
  const leaveStart = new Date(startAt);
  const leaveEnd = new Date(endAt);
  if (Number.isNaN(leaveStart.getTime()) || Number.isNaN(leaveEnd.getTime()) || leaveEnd < leaveStart) {
    throw new TypeError('Approved leave requires a valid start and end date.');
  }

  const reminders = await ScheduledReminder.find({
    organizationId: safeOrganizationId,
    userId: safeUserId,
    status: { $in: ['scheduled', 'failed'] },
    $or: [
      { scheduledFor: { $gte: leaveStart, $lte: leaveEnd } },
      { nextAttemptAt: { $gte: leaveStart, $lte: leaveEnd } },
      { dueAt: { $gte: leaveStart, $lte: leaveEnd } }
    ]
  });
  const resumeAt = firstBusinessReminderAfter(leaveEnd);
  const now = new Date();

  for (const reminder of reminders) {
    reminder.pause = {
      reason: sanitizePlainText(reason, { required: false, maxLength: 160 }) || 'approved_leave',
      startAt: leaveStart,
      endAt: leaveEnd,
      originalScheduledFor: reminder.pause?.originalScheduledFor || reminder.scheduledFor,
      pausedAt: now,
      resumedAt: undefined
    };
    reminder.scheduledFor = resumeAt;
    if (reminder.nextAttemptAt) reminder.nextAttemptAt = resumeAt;
    await reminder.save();
  }
  return { paused: reminders.length, resumeAt };
}

async function resumeRemindersForUserLeave({ organizationId, userId, reason = 'leave_cancelled' }) {
  const safeOrganizationId = requireString(organizationId, 'Organization ID');
  const safeUserId = requireString(userId, 'User ID');
  const reminders = await ScheduledReminder.find({
    organizationId: safeOrganizationId,
    userId: safeUserId,
    status: { $in: ['scheduled', 'failed'] },
    'pause.reason': { $exists: true },
    'pause.resumedAt': null
  });
  const now = new Date();
  for (const reminder of reminders) {
    const original = reminder.pause?.originalScheduledFor
      ? new Date(reminder.pause.originalScheduledFor)
      : now;
    reminder.scheduledFor = original > now ? original : now;
    if (reminder.nextAttemptAt) reminder.nextAttemptAt = reminder.scheduledFor;
    reminder.pause.resumedAt = now;
    reminder.pause.reason = sanitizePlainText(reason, { required: false, maxLength: 160 }) || 'leave_cancelled';
    await reminder.save();
  }
  return { resumed: reminders.length };
}

function targetResolverConfig(targetType) {
  const normalized = String(targetType || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  const configurations = {
    appraisal: {
      load: () => require('../models/Appraisal'),
      completed: ['completed', 'cancelled']
    },
    appraisal_self_assessment: {
      load: () => require('../models/Appraisal'),
      select: 'status selfAssessment.submittedAt',
      isComplete: target => Boolean(target.selfAssessment?.submittedAt)
        || !['self_assessment_pending', 'self_assessment_in_progress'].includes(target.status)
    },
    appraisal_manager_review: {
      load: () => require('../models/Appraisal'),
      select: 'status managerReview.submittedAt',
      isComplete: target => Boolean(target.managerReview?.submittedAt)
        || !['manager_review_pending', 'manager_review_in_progress', 'self_assessment_submitted'].includes(target.status)
    },
    appraisal_discussion: {
      load: () => require('../models/Appraisal'),
      select: 'status discussion.completedDate',
      isComplete: target => Boolean(target.discussion?.completedDate)
        || !['manager_review_submitted', 'discussion_scheduled'].includes(target.status)
    },
    appraisal_acknowledgement: {
      load: () => require('../models/Appraisal'),
      select: 'status discussion.employeeAcknowledged',
      isComplete: target => Boolean(target.discussion?.employeeAcknowledged)
        || target.status === 'employee_acknowledged'
    },
    appraisal_cycle: {
      load: () => require('../models/AppraisalCycle'),
      completed: ['completed', 'cancelled']
    },
    okr: {
      load: () => require('../models/OKR'),
      completed: ['closed', 'cancelled', 'rejected']
    },
    goal: {
      load: () => require('../models/OKR'),
      completed: ['closed', 'cancelled', 'rejected']
    },
    feedback_request: {
      load: () => require('../models/FeedbackRequest'),
      select: 'state',
      isComplete: target => ['fulfilled', 'declined', 'cancelled'].includes(target.state)
    },
    feedback: {
      load: () => require('../models/Feedback'),
      select: 'acknowledgedAt deletedAt',
      isComplete: target => Boolean(target.acknowledgedAt || target.deletedAt)
    },
    goal_submission: {
      load: () => require('../models/OKR'),
      select: 'status lifecycle.state',
      isComplete: target => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || target.lifecycle?.state !== 'draft'
    },
    goal_assignment: {
      load: () => require('../models/OKR'),
      select: 'status lifecycle.state assignment.acknowledgementStatus',
      isComplete: target => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || target.assignment?.acknowledgementStatus !== 'pending'
    },
    goal_approval: {
      load: () => require('../models/OKR'),
      select: 'status lifecycle.state',
      isComplete: target => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || target.lifecycle?.state !== 'pending_approval'
    },
    goal_changes: {
      load: () => require('../models/OKR'),
      select: 'status lifecycle.state',
      isComplete: target => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || target.lifecycle?.state !== 'changes_requested'
    },
    goal_change_request: {
      load: () => require('../models/OKR'),
      select: 'status assignment.acknowledgementStatus',
      isComplete: target => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || target.assignment?.acknowledgementStatus !== 'change_requested'
    },
    goal_check_in: {
      load: () => require('../models/OKR'),
      select: 'status lastCheckInAt',
      isComplete: (target, context) => ['closed', 'cancelled', 'rejected'].includes(target.status)
        || (target.lastCheckInAt && context.reminder?.createdAt
          && new Date(target.lastCheckInAt) >= new Date(context.reminder.createdAt))
    },
    one_on_one: {
      load: () => require('../models/OneOnOne'),
      completed: ['completed', 'cancelled', 'no_show']
    },
    development_plan: {
      load: () => require('../models/DevelopmentPlan'),
      completed: ['completed', 'cancelled']
    }
  };
  return configurations[normalized] || null;
}

/** Unknown target types are left active and must be cancelled by their domain service. */
async function isTargetComplete({ organizationId, targetType, targetId, reminder = null }) {
  if (String(targetType || '').trim().toLowerCase() === 'one_on_one_action_item') {
    const separator = String(targetId || '').indexOf(':');
    if (separator <= 0 || separator === String(targetId).length - 1) return true;
    const meetingId = String(targetId).slice(0, separator);
    const actionItemId = String(targetId).slice(separator + 1);
    const OneOnOne = require('../models/OneOnOne');
    try {
      const meeting = await OneOnOne.findOne({
        _id: meetingId,
        organizationId
      }).select('status actionItems').lean();
      if (!meeting || ['cancelled', 'no_show'].includes(meeting.status)) return true;
      const item = (meeting.actionItems || []).find(candidate =>
        String(candidate.id || candidate._id) === actionItemId
      );
      return !item || ['completed', 'cancelled'].includes(item.status);
    } catch (error) {
      if (error?.name === 'CastError') return true;
      throw error;
    }
  }

  const configuration = targetResolverConfig(targetType);
  if (!configuration) return false;
  const Model = configuration.load();
  try {
    const target = await Model.findOne({
      _id: targetId,
      organizationId
    }).select(configuration.select || 'status').lean();
    // A deleted supported target cannot still require an action.
    return !target
      || (typeof configuration.isComplete === 'function'
        ? configuration.isComplete(target, { reminder })
        : configuration.completed.includes(target.status));
  } catch (error) {
    if (error?.name === 'CastError') return true;
    throw error;
  }
}

async function claimNextReminder({
  workerId,
  now = new Date(),
  leaseMs = DEFAULT_REMINDER_LEASE_MS
}) {
  const owner = requireString(workerId, 'Reminder worker ID');
  const lease = {
    owner,
    claimedAt: now,
    expiresAt: new Date(now.getTime() + Math.max(5000, Number(leaseMs) || DEFAULT_REMINDER_LEASE_MS))
  };
  return ScheduledReminder.findOneAndUpdate(
    {
      status: { $in: ['scheduled', 'failed', 'processing'] },
      scheduledFor: { $lte: now },
      $and: [
        {
          $or: [
            { $expr: { $lt: ['$attempts', '$maxAttempts'] } },
            { status: 'processing', 'lease.expiresAt': { $lte: now } }
          ]
        },
        {
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: null },
            { nextAttemptAt: { $lte: now } }
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
      $set: { status: 'processing', lease },
      $inc: { attempts: 1 }
    },
    { new: true, sort: { scheduledFor: 1, createdAt: 1 } }
  );
}

async function markReminderFailed(reminder, error, now = new Date()) {
  const failure = summarizeError(error);
  const terminal = !failure.retryable || reminder.attempts >= reminder.maxAttempts;
  return ScheduledReminder.updateOne(
    { _id: reminder._id, 'lease.owner': reminder.lease?.owner },
    {
      $set: {
        status: terminal ? 'dead_letter' : 'failed',
        nextAttemptAt: new Date(now.getTime() + calculateBackoffMs(reminder.attempts)),
        lastError: { code: failure.code, message: failure.message, at: now }
      },
      $unset: { lease: '' }
    }
  );
}

async function processReminder(reminder, { completionResolver = isTargetComplete } = {}) {
  const completed = await completionResolver({
    organizationId: reminder.organizationId,
    targetType: reminder.target.type,
    targetId: reminder.target.id,
    reminder
  });
  if (completed) {
    await cancelRemindersForTarget({
      organizationId: reminder.organizationId,
      targetType: reminder.target.type,
      targetId: reminder.target.id,
      reason: 'target_completed'
    });
    return { cancelled: true };
  }

  const emittedEventId = reminder.emittedEventId || `reminder:${reminder._id}`;
  const reminderNotification = typeof reminder.notification?.toObject === 'function'
    ? reminder.notification.toObject()
    : reminder.notification;
  const reminderEventType = String(reminder.eventType).endsWith('.reminder')
    ? `${reminder.eventType}.${reminder.stage}`
    : `${reminder.eventType}.reminder.${reminder.stage}`;
  await publishDomainEvent({
    eventId: emittedEventId,
    eventType: reminderEventType,
    organizationId: reminder.organizationId,
    aggregate: reminder.target,
    recipients: [{
      userId: reminder.userId,
      name: reminder.recipient?.name,
      email: reminder.recipient?.email,
      channels: reminder.recipient?.channels
    }],
    notification: {
      ...reminderNotification,
      isAction: true,
      dueAt: reminder.dueAt
    },
    metadata: { reminderStage: reminder.stage, dueAt: reminder.dueAt }
  });

  const now = new Date();
  await ScheduledReminder.updateOne(
    { _id: reminder._id, 'lease.owner': reminder.lease?.owner },
    {
      $set: { status: 'emitted', emittedEventId, emittedAt: now },
      $unset: { lease: '', lastError: '', nextAttemptAt: '' }
    }
  );
  return { emitted: true, eventId: emittedEventId };
}

async function runReminderSchedulerOnce({
  workerId = `reminder-scheduler-${process.pid}`,
  batchSize = 100,
  completionResolver = isTargetComplete,
  now = new Date()
} = {}) {
  const stats = { emitted: 0, cancelled: 0, failed: 0 };
  for (let index = 0; index < batchSize; index += 1) {
    const reminder = await claimNextReminder({ workerId, now });
    if (!reminder) break;
    try {
      const result = await processReminder(reminder, { completionResolver });
      if (result.cancelled) stats.cancelled += 1;
      if (result.emitted) stats.emitted += 1;
    } catch (error) {
      await markReminderFailed(reminder, error, new Date());
      stats.failed += 1;
      console.error('Reminder scheduler item failed:', sanitizePlainText(error.message, {
        required: false,
        maxLength: 300
      }));
    }
  }
  return stats;
}

function startReminderScheduler(options = {}) {
  const workerId = options.workerId || `reminder-scheduler-${process.pid}-${crypto.randomUUID()}`;
  const intervalMs = Math.max(5000, Number(options.intervalMs) || DEFAULT_SCHEDULER_INTERVAL_MS);
  let running = false;
  let stopped = false;

  const runNow = async () => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runReminderSchedulerOnce({ ...options, workerId });
    } catch (error) {
      console.error('Reminder scheduler tick failed:', sanitizePlainText(error.message, {
        required: false,
        maxLength: 300
      }));
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void runNow(); }, intervalMs);
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
  DEFAULT_OVERDUE_AFTER_MS,
  DEFAULT_REMINDER_LEASE_MS,
  DEFAULT_SCHEDULER_INTERVAL_MS,
  REMINDER_STAGES,
  cancelRemindersForTarget,
  claimNextReminder,
  isTargetComplete,
  markReminderFailed,
  pauseRemindersForUserLeave,
  processReminder,
  resumeRemindersForUserLeave,
  runReminderSchedulerOnce,
  scheduleReminderSequence,
  startReminderScheduler
};
