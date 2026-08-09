const crypto = require('crypto');
const express = require('express');
const OKR = require('../models/OKR');
const GoalPeriod = require('../models/GoalPeriod');
const GoalCheckIn = require('../models/GoalCheckIn');
const GoalChangeRequest = require('../models/GoalChangeRequest');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const {
  buildGoalVisibilityQuery,
  canAcknowledgeGoal,
  canAlignGoal,
  canAssignGoal,
  canCheckInGoal,
  canDecideGoal,
  canEditGoal,
  canRequestGoalChange,
  canSubmitGoal,
  canViewGoal,
  getActor,
  getDirectReportIds,
  getGoalPermissionFlags,
  getManagedTeamIds,
  isHr,
  isOwner,
  normalizeId,
  resolveOrganizationId,
  resolveUserId
} = require('../services/goalPermissionService');
const { calculateGoalScore, isPresent, toNumber } = require('../services/goalScoringService');

const router = express.Router();
const HEALTH_VALUES = new Set(['not_set', 'on_track', 'at_risk', 'off_track', 'complete']);
const DECISIONS = new Set(['approve', 'request_changes', 'reject']);

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendError(res, error, fallback) {
  const status = error?.status || (error?.name === 'ValidationError' ? 400 : (error?.name === 'CastError' ? 404 : 500));
  return res.status(status).json({
    success: false,
    error: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {})
  });
}

async function recordEvent(event) {
  try {
    // Optional until the shared transactional outbox is available.
    // eslint-disable-next-line global-require, import/no-unresolved
    const outboxService = require('../services/outboxService');
    if (outboxService && typeof outboxService.recordEvent === 'function') {
      await outboxService.recordEvent(event);
    }
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      console.warn('Goal event recording failed:', error.message);
    }
  }
}

function recipientFrom(value, fallback = {}) {
  if (!value && !fallback.userId) return null;
  const source = typeof value === 'object' && value !== null ? value : {};
  const userId = normalizeId(
    typeof value === 'string' || typeof value === 'number'
      ? value
      : (source.userId || source.id || source.sub || source.accountId || fallback.userId)
  );
  if (!userId) return null;
  const email = source.email || fallback.email;
  return {
    userId,
    name: source.name || source.displayName || fallback.name,
    email,
    channels: email ? ['in_app', 'email'] : ['in_app']
  };
}

function uniqueRecipients(recipients, actorId) {
  const byUserId = new Map();
  recipients.filter(Boolean).forEach((recipient) => {
    if (recipient.userId && recipient.userId !== actorId) byUserId.set(recipient.userId, recipient);
  });
  return Array.from(byUserId.values());
}

function managerRecipientsFromRequest(req) {
  const user = req?.session?.user || {};
  const userinfo = user.userinfo || {};
  const organizationId = resolveOrganizationId(req);
  const recipients = [
    recipientFrom(user.manager || user.lineManager),
    recipientFrom(userinfo.manager || userinfo.line_manager),
    recipientFrom(user.managerId || user.managerUserId, {
      name: user.managerName,
      email: user.managerEmail
    }),
    recipientFrom(userinfo.managerId || userinfo.manager_id, {
      name: userinfo.managerName || userinfo.manager_name,
      email: userinfo.managerEmail || userinfo.manager_email
    })
  ];

  const teams = req?.userTeams || user.idpTeams || user.teams || userinfo.teams || [];
  teams
    .filter((team) => !organizationId || !team.organizationId || normalizeId(team.organizationId) === organizationId)
    .forEach((team) => {
      recipients.push(recipientFrom(team.manager || team.lineManager));
      recipients.push(recipientFrom(team.managerId || team.managerUserId || team.managerAccountId, {
        name: team.managerName,
        email: team.managerEmail
      }));
      (team.managers || []).forEach((manager) => recipients.push(recipientFrom(manager)));
    });

  return uniqueRecipients(recipients, resolveUserId(req));
}

function inferGoalEventRecipients(req, goal, eventType) {
  const actorId = resolveUserId(req);
  // `owner.email` can originate in a request payload, so goal notifications
  // use the trusted user ID for in-app delivery. Email is used only for actors
  // and managers sourced from the authenticated identity claims.
  const ownerIdentityWasCapturedFromSelf = normalizeId(goal.createdBy?.userId) === normalizeId(goal.ownerId);
  const owner = recipientFrom(goal.ownerId, {
    name: goal.owner?.name,
    email: ownerIdentityWasCapturedFromSelf ? goal.owner?.email : undefined
  });
  const assignedBy = recipientFrom(goal.assignment?.assignedBy);
  const notifyOwner = new Set([
    'goal.assigned',
    'goal.assigned_without_acknowledgement',
    'goal.approved',
    'goal.changes_requested',
    'goal.rejected',
    'goal.change_request_approved',
    'goal.change_request_rejected'
  ]);
  const notifyManager = new Set([
    'goal.submitted',
    'goal.assignment_acknowledged',
    'goal.change_requested'
  ]);

  if (notifyOwner.has(eventType)) return uniqueRecipients([owner], actorId);
  if (notifyManager.has(eventType)) {
    return uniqueRecipients([assignedBy, ...managerRecipientsFromRequest(req)], actorId);
  }
  if (eventType === 'goal.checked_in' || eventType === 'goal.updated' || eventType === 'goal.cancelled') {
    return isOwner(req, goal)
      ? uniqueRecipients([assignedBy, ...managerRecipientsFromRequest(req)], actorId)
      : uniqueRecipients([owner], actorId);
  }
  return [];
}

function periodForGoal(goal, override) {
  if (override?.startDate || override?.endDate) return override;
  if (goal?.periodId && typeof goal.periodId === 'object' && (goal.periodId.startDate || goal.periodId.endDate)) {
    return goal.periodId;
  }
  return null;
}

function workflowDueAt(goal, periodOverride) {
  const period = periodForGoal(goal, periodOverride);
  const now = new Date();
  const planningEnd = period?.planningEndDate ? new Date(period.planningEndDate) : null;
  const startDate = period?.startDate ? new Date(period.startDate) : null;
  const endDate = period?.endDate ? new Date(period.endDate) : null;
  if (planningEnd && planningEnd > now) return planningEnd;
  if (startDate && startDate > now) return startDate;
  const defaultDue = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  return endDate && endDate > now && endDate < defaultDue ? endDate : defaultDue;
}

function nextCheckInDueAt(goal, periodOverride) {
  const period = periodForGoal(goal, periodOverride);
  if (period?.checkInCadence === 'none') return null;
  const now = new Date();
  const periodStart = period?.startDate ? new Date(period.startDate) : null;
  const base = periodStart && periodStart > now ? periodStart : now;
  let dueAt;
  switch (period?.checkInCadence) {
    case 'weekly':
      dueAt = new Date(base.getTime() + (7 * 24 * 60 * 60 * 1000));
      break;
    case 'biweekly':
      dueAt = new Date(base.getTime() + (14 * 24 * 60 * 60 * 1000));
      break;
    case 'quarterly':
      dueAt = new Date(base.getTime() + (90 * 24 * 60 * 60 * 1000));
      break;
    case 'custom':
      dueAt = new Date(base.getTime() + ((Number(period?.checkInIntervalDays) || 30) * 24 * 60 * 60 * 1000));
      break;
    case 'monthly':
    default:
      dueAt = new Date(base.getTime() + (30 * 24 * 60 * 60 * 1000));
      break;
  }
  const periodEnd = period?.endDate ? new Date(period.endDate) : null;
  if (periodEnd && periodEnd <= now) return null;
  if (periodEnd && dueAt > periodEnd) return periodEnd;
  return dueAt;
}

async function updateGoalReminders(req, goal, eventType, recipients, payload = {}) {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const reminderScheduler = require('../services/reminderScheduler');
    if (!reminderScheduler) return;
    const cancel = async (targetType, targetId = String(goal._id), reason = eventType) => {
      if (typeof reminderScheduler.cancelRemindersForTarget !== 'function') return;
      await reminderScheduler.cancelRemindersForTarget({
        organizationId: goal.organizationId,
        targetType,
        targetId,
        reason
      });
    };
    const schedule = async ({
      targetType,
      targetId = String(goal._id),
      reminderEventType,
      users,
      dueAt,
      title,
      message,
      action
    }) => {
      if (!dueAt || typeof reminderScheduler.scheduleReminderSequence !== 'function') return;
      await Promise.all((users || []).map((user) => reminderScheduler.scheduleReminderSequence({
        organizationId: goal.organizationId,
        eventType: reminderEventType || eventType,
        target: { type: targetType, id: targetId },
        user,
        dueAt,
        notification: {
          category: 'goal',
          title,
          message,
          deepLink: `/okrs?goal=${encodeURIComponent(String(goal._id))}`,
          priority: 'normal',
          action
        }
      })));
    };

    const ownerIdentityWasCapturedFromSelf = normalizeId(goal.createdBy?.userId) === normalizeId(goal.ownerId);
    const owner = recipientFrom(goal.ownerId, {
      name: goal.owner?.name,
      email: ownerIdentityWasCapturedFromSelf ? goal.owner?.email : undefined
    });
    const period = payload.period;
    const actionDueAt = payload.dueAt || workflowDueAt(goal, period);
    if (eventType === 'goal.assigned') {
      await schedule({
        targetType: 'goal_assignment',
        reminderEventType: 'goal.acknowledgement_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal acknowledgement due',
        message: 'Review and acknowledge your assigned goal.',
        action: { kind: 'acknowledge', label: 'Review goal' }
      });
    } else if (eventType === 'goal.submitted') {
      await cancel('goal_submission');
      await cancel('goal_changes');
      await schedule({
        targetType: 'goal_approval',
        reminderEventType: 'goal.approval_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal review due',
        message: 'Review the submitted goal and record a decision.',
        action: { kind: 'approve', label: 'Review goal' }
      });
    } else if (eventType === 'goal.changes_requested') {
      await cancel('goal_approval');
      await schedule({
        targetType: 'goal_changes',
        reminderEventType: 'goal.changes_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal changes due',
        message: 'Update and resubmit the goal.',
        action: { kind: 'review', label: 'Update goal' }
      });
    } else if (eventType === 'goal.change_requested') {
      await cancel('goal_assignment');
      await schedule({
        targetType: 'goal_change_request',
        reminderEventType: 'goal.change_request_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal change review due',
        message: 'Review the employee\'s proposed goal change.',
        action: { kind: 'review', label: 'Review request' }
      });
    } else if (eventType === 'goal.assignment_acknowledged') {
      await cancel('goal_assignment');
    } else if (['goal.approved', 'goal.rejected'].includes(eventType)) {
      await cancel('goal_approval');
      await cancel('goal_changes');
    } else if (['goal.change_request_approved', 'goal.change_request_rejected'].includes(eventType)) {
      await cancel('goal_change_request');
    } else if (eventType === 'goal.checked_in') {
      await cancel('goal_check_in');
    } else if (eventType === 'goal.updated' && goal.lifecycle?.state === 'pending_approval') {
      await schedule({
        targetType: 'goal_approval',
        reminderEventType: 'goal.approval_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal review due',
        message: 'Review the updated goal and record a decision.',
        action: { kind: 'approve', label: 'Review goal' }
      });
    } else if (eventType === 'goal.updated' && goal.lifecycle?.state === 'pending_acknowledgement') {
      await schedule({
        targetType: 'goal_assignment',
        reminderEventType: 'goal.acknowledgement_due',
        users: recipients,
        dueAt: actionDueAt,
        title: 'Goal acknowledgement due',
        message: 'Review and acknowledge the updated assigned goal.',
        action: { kind: 'acknowledge', label: 'Review goal' }
      });
    } else if (eventType === 'goal.cancelled' || goal.lifecycle?.state === 'closed') {
      await Promise.all([
        cancel('goal_submission'),
        cancel('goal_assignment'),
        cancel('goal_approval'),
        cancel('goal_changes'),
        cancel('goal_change_request'),
        cancel('goal_check_in')
      ]);
      return;
    }

    const shouldScheduleCheckIn = [
      'goal.created',
      'goal.assigned_without_acknowledgement',
      'goal.approved',
      'goal.assignment_acknowledged',
      'goal.change_request_approved',
      'goal.checked_in'
    ].includes(eventType) && goal.lifecycle?.state === 'active';
    if (shouldScheduleCheckIn && owner) {
      await schedule({
        targetType: 'goal_check_in',
        reminderEventType: 'goal.check_in_due',
        users: [owner],
        dueAt: nextCheckInDueAt(goal, period),
        title: 'Goal check-in due',
        message: 'Add progress, health, blockers, and evidence for your goal.',
        action: { kind: 'complete', label: 'Check in' }
      });
    }

    if (eventType === 'goal.created' && goal.lifecycle?.state === 'draft' && owner) {
      await schedule({
        targetType: 'goal_submission',
        reminderEventType: 'goal.submission_due',
        users: [owner],
        dueAt: actionDueAt,
        title: 'Goal submission due',
        message: 'Finish and submit your draft goal for review.',
        action: { kind: 'complete', label: 'Open draft' }
      });
    }

    if (eventType === 'goal.change_request_rejected' && goal.lifecycle?.state === 'pending_acknowledgement' && owner) {
      await schedule({
        targetType: 'goal_assignment',
        reminderEventType: 'goal.acknowledgement_due',
        users: [owner],
        dueAt: actionDueAt,
        title: 'Goal acknowledgement due',
        message: 'Review the manager decision and acknowledge your assigned goal.',
        action: { kind: 'acknowledge', label: 'Review goal' }
      });
    }
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      console.warn('Goal reminder scheduling failed:', error.message);
    }
  }
}

async function goalEvent(req, goal, eventType, payload = {}) {
  const { reminderPeriod, ...eventPayload } = payload;
  const discriminator = eventPayload.checkInId || eventPayload.changeRequestId || goal.version || goal.updatedAt?.getTime() || 'event';
  const recipients = inferGoalEventRecipients(req, goal, eventType);
  const actionEvents = new Set([
    'goal.assigned',
    'goal.submitted',
    'goal.changes_requested',
    'goal.change_requested'
  ]);
  const hasPendingAction = actionEvents.has(eventType) ||
    (eventType === 'goal.change_request_rejected' && goal.lifecycle?.state === 'pending_acknowledgement');
  const dueAt = eventPayload.dueAt || (hasPendingAction ? workflowDueAt(goal, reminderPeriod) : undefined);
  await recordEvent({
    eventId: `goal:${goal._id}:${eventType}:${discriminator}`,
    eventType,
    aggregateType: 'goal',
    aggregateId: String(goal._id),
    organizationId: goal.organizationId,
    actor: getActor(req),
    recipients,
    occurredAt: new Date(),
    payload: {
      ...eventPayload,
      ...(dueAt ? { dueAt } : {}),
      deepLink: `/okrs?goal=${encodeURIComponent(String(goal._id))}`
    }
  });
  await updateGoalReminders(req, goal, eventType, recipients, {
    ...eventPayload,
    period: reminderPeriod,
    dueAt
  });
}

function combineQuery(scope, filters = {}) {
  if (!scope) return null;
  const hasFilters = Object.keys(filters).length > 0;
  return hasFilters ? { $and: [scope, filters] } : scope;
}

function defaultPeriodLabel() {
  const now = new Date();
  return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
}

function normalizeHealth(value, fallback = 'not_set') {
  return HEALTH_VALUES.has(value) ? value : fallback;
}

function assertValidHealth(value) {
  if (isPresent(value) && !HEALTH_VALUES.has(value)) {
    throw httpError(400, `health must be one of: ${Array.from(HEALTH_VALUES).join(', ')}`, 'INVALID_HEALTH');
  }
}

function normalizeObjectives(body = {}) {
  const suppliedObjectives = Array.isArray(body.objectives) && body.objectives.length > 0
    ? body.objectives
    : [{
      title: body.title || body.objective || 'Untitled Objective',
      description: body.objective || '',
      keyResults: Array.isArray(body.keyResults) ? body.keyResults : []
    }];

  const objectives = suppliedObjectives.map((objective) => ({
    title: String(objective?.title || '').trim(),
    description: String(objective?.description || '').trim(),
    weight: objective?.weight ?? 1,
    aiGenerated: Boolean(objective?.aiGenerated),
    aiConfidence: objective?.aiConfidence,
    keyResults: (Array.isArray(objective?.keyResults) ? objective.keyResults : []).map((rawKeyResult) => {
      const keyResult = typeof rawKeyResult === 'string' ? { title: rawKeyResult } : (rawKeyResult || {});
      const normalized = {
        ...(keyResult._id ? { _id: keyResult._id } : {}),
        title: String(keyResult.title || '').trim(),
        description: String(keyResult.description || '').trim(),
        metricType: keyResult.metricType || 'percentage',
        unit: keyResult.unit,
        weight: keyResult.weight ?? 1,
        startValue: keyResult.startValue ?? 0,
        targetValue: keyResult.targetValue ?? 100,
        direction: keyResult.direction || 'auto',
        dueDate: keyResult.dueDate,
        health: normalizeHealth(keyResult.health),
        lastUpdated: keyResult.lastUpdated
      };
      if (isPresent(keyResult.currentValue)) normalized.currentValue = keyResult.currentValue;
      return normalized;
    })
  }));

  if (objectives.length === 0 || objectives.some((objective) => !objective.title)) {
    throw httpError(400, 'Every objective requires a title', 'INVALID_OBJECTIVES');
  }
  if (objectives.some((objective) => objective.keyResults.some((keyResult) => !keyResult.title))) {
    throw httpError(400, 'Every key result requires a title', 'INVALID_KEY_RESULTS');
  }
  const explicitObjectiveWeights = suppliedObjectives.filter((objective) => isPresent(objective?.weight));
  if (explicitObjectiveWeights.length > 0) {
    const total = suppliedObjectives.reduce((sum, objective) => sum + Number(objective?.weight || 0), 0);
    if (explicitObjectiveWeights.length !== suppliedObjectives.length || Math.abs(total - 100) > 0.01) {
      throw httpError(400, 'When objective weights are supplied, every objective must be weighted and the total must equal 100', 'INVALID_OBJECTIVE_WEIGHTS');
    }
  }
  suppliedObjectives.forEach((objective, objectiveIndex) => {
    const keyResults = Array.isArray(objective?.keyResults) ? objective.keyResults : [];
    const explicit = keyResults.filter((keyResult) => typeof keyResult === 'object' && isPresent(keyResult?.weight));
    if (explicit.length === 0) return;
    const total = keyResults.reduce((sum, keyResult) =>
      sum + Number(typeof keyResult === 'object' ? keyResult?.weight || 0 : 0), 0);
    if (explicit.length !== keyResults.length || Math.abs(total - 100) > 0.01) {
      throw httpError(400, `Key-result weights for objective ${objectiveIndex + 1} must all be supplied and total 100`, 'INVALID_KEY_RESULT_WEIGHTS');
    }
  });
  return objectives;
}

function serializeGoal(goal, req) {
  const data = typeof goal?.toObject === 'function' ? goal.toObject({ virtuals: true }) : { ...goal };
  // Version snapshots are intentionally fetched from /:id/history. Keeping
  // them out of list/detail payloads prevents an unbounded response as a goal
  // accumulates changes.
  delete data.versionHistory;
  return {
    ...data,
    title: data.title || data.objectives?.[0]?.title || 'Untitled OKR',
    objective: data.objectives?.[0]?.description || '',
    teamId: data.teamHierarchy?.teamId || null,
    keyResults: data.objectives?.[0]?.keyResults?.map((keyResult) => keyResult.title) || [],
    permissions: req ? getGoalPermissionFlags(req, goal) : undefined
  };
}

function serializeCheckIn(checkIn, req, goal) {
  const data = typeof checkIn?.toObject === 'function' ? checkIn.toObject() : { ...checkIn };
  const canSeeEmployeeManagerEvidence = canCheckInGoal(req, goal);
  data.evidence = (data.evidence || []).filter((item) => {
    if (item.visibility === 'hr_only') return isHr(req);
    if (item.visibility === 'employee_manager') return canSeeEmployeeManagerEvidence;
    return true;
  });
  return data;
}

async function resolvePeriod(req, periodId, periodLabel) {
  const organizationId = resolveOrganizationId(req);
  let period = null;
  if (periodId) {
    period = await GoalPeriod.findOne({ _id: periodId, organizationId });
  } else if (periodLabel) {
    period = await GoalPeriod.findOne({
      organizationId,
      $or: [{ name: periodLabel }, { code: periodLabel }],
      status: { $nin: ['closed', 'archived'] }
    });
  } else {
    const now = new Date();
    const planningWindow = {
      organizationId,
      status: { $in: ['upcoming', 'open'] },
      endDate: { $gte: now },
      $and: [
        { $or: [{ planningStartDate: { $exists: false } }, { planningStartDate: null }, { planningStartDate: { $lte: now } }] },
        { $or: [{ planningEndDate: { $exists: false } }, { planningEndDate: null }, { planningEndDate: { $gte: now } }] }
      ]
    };
    period = await GoalPeriod.findOne({ ...planningWindow, startDate: { $gte: now } }).sort({ startDate: 1 });
    if (!period) period = await GoalPeriod.findOne(planningWindow).sort({ startDate: -1 });
    if (!period) return { period: null, label: defaultPeriodLabel() };
  }
  if (!period) throw httpError(400, 'Goal period not found in the active organization', 'INVALID_GOAL_PERIOD');
  if (['closed', 'archived'].includes(period.status)) {
    throw httpError(409, 'Goals cannot be created in a closed goal period', 'GOAL_PERIOD_CLOSED');
  }
  if (period.startDate > new Date() && period.settings?.allowFutureGoalCreation === false) {
    throw httpError(409, 'This future goal period is not open for goal creation', 'FUTURE_GOALS_DISABLED');
  }
  if (period.status === 'draft' && !isHr(req)) {
    throw httpError(403, 'This goal period has not been published', 'GOAL_PERIOD_NOT_PUBLISHED');
  }
  return { period, label: period.name || period.code };
}

function samePeriod(goal, parent) {
  if (goal.periodId && parent.periodId) return String(goal.periodId) === String(parent.periodId);
  return String(goal.period || '') === String(parent.period || '');
}

async function validateAlignment(req, goal, parentOKRId, parentObjectiveIndex = 0) {
  if (!parentOKRId) return null;
  const organizationId = resolveOrganizationId(req);
  const parent = await OKR.findOne({ _id: parentOKRId, organizationId });
  if (!parent) throw httpError(404, 'Parent goal not found', 'PARENT_GOAL_NOT_FOUND');
  if (!canViewGoal(req, parent)) {
    throw httpError(404, 'Parent goal not found', 'PARENT_GOAL_NOT_FOUND');
  }
  if (String(parent._id) === String(goal._id)) {
    throw httpError(400, 'A goal cannot be aligned to itself', 'INVALID_ALIGNMENT');
  }
  if (!samePeriod(goal, parent)) {
    throw httpError(400, 'Parent and child goals must belong to the same goal period', 'PERIOD_MISMATCH');
  }
  if (goal.type === 'organization') {
    throw httpError(400, 'Organization goals cannot have parents', 'INVALID_ALIGNMENT');
  }
  if (goal.type === 'department' && parent.type !== 'organization') {
    throw httpError(400, 'Department goals must align to organization goals', 'INVALID_ALIGNMENT');
  }
  if (goal.type === 'team' && !['department', 'organization'].includes(parent.type)) {
    throw httpError(400, 'Team goals must align to department or organization goals', 'INVALID_ALIGNMENT');
  }
  if (goal.type === 'individual' && !['team', 'department', 'organization'].includes(parent.type)) {
    throw httpError(400, 'Individual goals must align to team, department, or organization goals', 'INVALID_ALIGNMENT');
  }
  if (!parent.objectives?.[Number(parentObjectiveIndex) || 0]) {
    throw httpError(400, 'Parent objective does not exist', 'INVALID_PARENT_OBJECTIVE');
  }

  // Walk ancestors to prevent indirect cycles. Tenant scope is retained at
  // every hop.
  let cursor = parent;
  const visited = new Set([String(goal._id)]);
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (visited.has(String(cursor._id))) {
      throw httpError(400, 'Goal alignment would create a cycle', 'ALIGNMENT_CYCLE');
    }
    visited.add(String(cursor._id));
    if (!cursor.alignment?.parentOKRId) break;
    cursor = await OKR.findOne({ _id: cursor.alignment.parentOKRId, organizationId })
      .select('_id alignment.parentOKRId');
    if (!cursor) {
      throw httpError(400, 'The parent goal has an invalid alignment chain', 'INVALID_ALIGNMENT_CHAIN');
    }
  }
  return parent;
}

async function syncParentChildren(goal, oldParentId, newParentId) {
  if (oldParentId && String(oldParentId) !== String(newParentId || '')) {
    await OKR.updateOne(
      { _id: oldParentId, organizationId: goal.organizationId },
      { $pull: { childOKRIds: goal._id } }
    );
  }
  if (newParentId) {
    await OKR.updateOne(
      { _id: newParentId, organizationId: goal.organizationId },
      { $addToSet: { childOKRIds: goal._id } }
    );
  }
}

async function createGoalDocument(req, body = {}, options = {}) {
  const organizationId = resolveOrganizationId(req);
  const actor = getActor(req);
  if (!organizationId) throw httpError(400, 'No active organization selected', 'ORGANIZATION_REQUIRED');

  const type = body.type || 'individual';
  if (!['individual', 'team', 'department', 'organization'].includes(type)) {
    throw httpError(400, 'Goal type is invalid', 'INVALID_GOAL_TYPE');
  }
  const ownerId = normalizeId(body.ownerId || actor.userId);
  const teamId = normalizeId(body.teamId || body.teamHierarchy?.teamId);
  const departmentId = normalizeId(body.departmentId || body.teamHierarchy?.departmentId);
  if (!ownerId) throw httpError(400, 'Goal owner is required', 'OWNER_REQUIRED');
  if (!canAssignGoal(req, { ownerId, type, teamId, departmentId })) {
    throw httpError(403, 'Goal owner is outside your permitted assignment scope', 'GOAL_ASSIGNMENT_DENIED');
  }

  const { period, label } = await resolvePeriod(req, body.periodId, body.period);
  const assignedToOther = type === 'individual' && ownerId !== actor.userId;
  const lateCreated = Boolean(period?.planningEndDate && new Date() > new Date(period.planningEndDate));
  const requestedLateScoring = lateCreated && body.scoreInAppraisal === true;
  const lateScoringReason = String(body.scoringReason || '').trim();
  if (requestedLateScoring && lateScoringReason.length < 10) {
    throw httpError(400, 'A reason of at least 10 characters is required to score a goal added after planning closed', 'LATE_GOAL_REASON_REQUIRED');
  }
  const scoringMode = lateCreated && !requestedLateScoring ? 'evidence_only' : 'scored';
  const requiresAcknowledgement = assignedToOther &&
    (requestedLateScoring || period?.settings?.managerAssignedRequiresAcknowledgement !== false);
  const requiresManagerApproval = type === 'individual' && !assignedToOther &&
    (requestedLateScoring || period?.settings?.requiresManagerApproval !== false);
  const autoActive = ['team', 'department', 'organization'].includes(type) ||
    (assignedToOther && !requiresAcknowledgement) ||
    (type === 'individual' && !assignedToOther && !requiresManagerApproval);
  const creationSource = options.creationSource || (
    isHr(req) ? 'hr' : (assignedToOther ? 'manager' : 'employee')
  );

  const lifecycleState = requiresAcknowledgement
    ? 'pending_acknowledgement'
    : (autoActive ? 'active' : 'draft');
  const status = lifecycleState === 'active' ? 'active' : 'draft';
  const approvalStatus = assignedToOther
    ? 'approved'
    : (autoActive ? 'not_required' : 'draft');
  const objectives = normalizeObjectives(body);

  const goal = new OKR({
    type,
    ownerId,
    owner: assignedToOther
      ? { name: body.owner?.name || body.ownerName }
      : { name: actor.name, email: actor.email },
    organizationId,
    period: label,
    periodId: period?._id,
    title: body.title || objectives[0]?.title,
    status,
    approvalStatus,
    approvedBy: approvalStatus === 'approved' ? actor.userId : undefined,
    approvedAt: approvalStatus === 'approved' ? new Date() : undefined,
    creationSource,
    createdBy: actor,
    updatedBy: actor,
    scoringEligibility: {
      mode: scoringMode,
      lateCreated,
      reason: requestedLateScoring ? lateScoringReason : (lateCreated ? 'Created after the planning window; evidence only by default.' : undefined),
      decidedBy: requestedLateScoring ? actor : undefined,
      decidedAt: requestedLateScoring ? new Date() : undefined
    },
    assignment: assignedToOther ? {
      assignedBy: actor,
      assignedAt: new Date(),
      acknowledgementStatus: requiresAcknowledgement ? 'pending' : 'not_required',
      idempotencyKey: options.idempotencyKey,
      bulkBatchKey: options.bulkBatchKey
    } : {
      acknowledgementStatus: 'not_required',
      idempotencyKey: options.idempotencyKey,
      bulkBatchKey: options.bulkBatchKey
    },
    lifecycle: {
      state: lifecycleState,
      activatedAt: lifecycleState === 'active' ? new Date() : undefined
    },
    objectives,
    teamHierarchy: {
      teamId: teamId || undefined,
      teamName: body.teamName || body.teamHierarchy?.teamName,
      departmentId: departmentId || undefined,
      departmentName: body.departmentName || body.teamHierarchy?.departmentName,
      teamPath: body.teamHierarchy?.teamPath || [],
      managedTeams: body.teamHierarchy?.managedTeams || []
    },
    alignment: body.parentOKRId ? {
      parentOKRId: body.parentOKRId,
      parentObjectiveIndex: body.parentObjectiveIndex ?? 0,
      alignmentType: body.alignmentType || 'cascade',
      alignmentNotes: body.alignmentNotes,
      contributionWeight: body.contributionWeight
    } : undefined
  });

  let parent = null;
  if (body.parentOKRId) {
    parent = await validateAlignment(req, goal, body.parentOKRId, body.parentObjectiveIndex ?? 0);
  }
  goal.captureVersion('created', actor, { creationSource });
  await goal.save();
  if (parent) await syncParentChildren(goal, null, parent._id);
  const createdEventType = assignedToOther
    ? (requiresAcknowledgement ? 'goal.assigned' : 'goal.assigned_without_acknowledgement')
    : 'goal.created';
  await goalEvent(req, goal, createdEventType, {
    lifecycleState,
    periodId: goal.periodId || null,
    assignedBy: assignedToOther ? actor.userId : null,
    reminderPeriod: period
  });
  return goal;
}

async function findTenantGoal(req, goalId) {
  const organizationId = resolveOrganizationId(req);
  if (!organizationId) throw httpError(400, 'No active organization selected', 'ORGANIZATION_REQUIRED');
  const goal = await OKR.findOne({ _id: goalId, organizationId }).populate('periodId');
  if (!goal) throw httpError(404, 'Goal not found', 'GOAL_NOT_FOUND');
  return goal;
}

function assertView(req, goal) {
  if (!canViewGoal(req, goal)) throw httpError(403, 'Access denied to this goal', 'GOAL_ACCESS_DENIED');
}

function sanitizeChangeProposal(proposedChanges = {}) {
  const proposal = {};
  if (proposedChanges.title !== undefined) proposal.title = String(proposedChanges.title).trim();
  if (proposedChanges.objectives !== undefined) proposal.objectives = normalizeObjectives({ objectives: proposedChanges.objectives });
  if (proposedChanges.periodId !== undefined) proposal.periodId = proposedChanges.periodId;
  if (proposedChanges.period !== undefined) proposal.period = proposedChanges.period;
  if (Object.keys(proposal).length === 0) {
    throw httpError(400, 'At least one supported proposed change is required', 'EMPTY_CHANGE_REQUEST');
  }
  return proposal;
}

async function applyProposal(req, goal, proposal) {
  if (proposal.title !== undefined) goal.title = proposal.title;
  if (proposal.objectives !== undefined) goal.objectives = proposal.objectives;
  if (proposal.periodId !== undefined || proposal.period !== undefined) {
    const resolved = await resolvePeriod(req, proposal.periodId, proposal.period || goal.period);
    goal.periodId = resolved.period?._id;
    goal.period = resolved.label;
  }
}

function locateObjective(goal, update) {
  if (update.objectiveId && goal.objectives?.id) {
    const byId = goal.objectives.id(update.objectiveId);
    if (byId) return { objective: byId, objectiveIndex: goal.objectives.indexOf(byId) };
  }
  const objectiveIndex = Number(update.objectiveIndex ?? 0);
  return { objective: goal.objectives?.[objectiveIndex], objectiveIndex };
}

function locateKeyResult(objective, update) {
  if (update.keyResultId && objective?.keyResults?.id) {
    const byId = objective.keyResults.id(update.keyResultId);
    if (byId) return { keyResult: byId, keyResultIndex: objective.keyResults.indexOf(byId) };
  }
  const keyResultIndex = Number(update.keyResultIndex);
  return { keyResult: objective?.keyResults?.[keyResultIndex], keyResultIndex };
}

async function assertCheckInWindow(req, goal) {
  if (!['active', 'closed'].includes(goal.lifecycle?.state) && goal.status !== 'active') {
    throw httpError(409, 'Check-ins are only available for active goals', 'GOAL_NOT_ACTIVE');
  }
  if (!goal.periodId) return;
  const period = await GoalPeriod.findOne({ _id: goal.periodId, organizationId: goal.organizationId });
  if (!period) return;
  const now = new Date();
  if (now < period.startDate && period.settings?.allowCheckInsBeforeStart !== true) {
    throw httpError(409, 'Check-ins are not open for this future goal period', 'CHECK_IN_NOT_OPEN');
  }
  if ((now > period.endDate || ['closed', 'archived'].includes(period.status)) &&
      period.settings?.allowCheckInsAfterEnd !== true) {
    throw httpError(409, 'This goal period is closed for check-ins', 'CHECK_IN_CLOSED');
  }
}

async function createCheckIn(req, goal, payload = {}) {
  if (!canCheckInGoal(req, goal)) {
    throw httpError(403, 'You do not have permission to check in on this goal', 'CHECK_IN_DENIED');
  }
  await assertCheckInWindow(req, goal);

  const idempotencyKey = String(payload.idempotencyKey || req.headers['idempotency-key'] || '').trim() || undefined;
  if (idempotencyKey && idempotencyKey.length > 128) {
    throw httpError(400, 'idempotencyKey cannot exceed 128 characters', 'INVALID_IDEMPOTENCY_KEY');
  }
  assertValidHealth(payload.health);
  if (idempotencyKey) {
    const existing = await GoalCheckIn.findOne({
      organizationId: goal.organizationId,
      goalId: goal._id,
      idempotencyKey
    });
    if (existing) return { checkIn: existing, goal, replayed: true };
  }

  const updates = Array.isArray(payload.keyResultUpdates) ? payload.keyResultUpdates : [];
  if (updates.length === 0 && !payload.summary && !payload.health &&
      !payload.blockers?.length && !payload.evidence?.length) {
    throw httpError(400, 'A check-in requires progress, health, evidence, blockers, or a summary', 'EMPTY_CHECK_IN');
  }

  const normalizedUpdates = updates.map((update) => {
    assertValidHealth(update.health);
    const { objective, objectiveIndex } = locateObjective(goal, update);
    if (!objective) throw httpError(400, 'Check-in objective was not found', 'OBJECTIVE_NOT_FOUND');
    const { keyResult, keyResultIndex } = locateKeyResult(objective, update);
    if (!keyResult) throw httpError(400, 'Check-in key result was not found', 'KEY_RESULT_NOT_FOUND');
    const numericValue = toNumber(update.currentValue);
    if (numericValue === null) throw httpError(400, 'currentValue must be a number or boolean', 'INVALID_CURRENT_VALUE');
    const previousValue = isPresent(keyResult.currentValue) ? Number(keyResult.currentValue) : undefined;
    keyResult.currentValue = numericValue;
    keyResult.lastUpdated = new Date();
    if (update.health) keyResult.health = normalizeHealth(update.health);
    return {
      objectiveId: String(objective._id),
      objectiveIndex,
      keyResultId: String(keyResult._id),
      keyResultIndex,
      previousValue,
      currentValue: numericValue,
      health: normalizeHealth(update.health || keyResult.health),
      note: update.note
    };
  });

  if (payload.health) goal.health = normalizeHealth(payload.health, goal.health);
  goal.lastCheckInAt = new Date();
  goal.lastCheckInBy = getActor(req);
  const scoreSnapshot = calculateGoalScore(goal);
  const latest = await GoalCheckIn.findOne({ organizationId: goal.organizationId, goalId: goal._id })
    .sort({ sequence: -1 })
    .select('sequence');

  const checkIn = new GoalCheckIn({
    organizationId: goal.organizationId,
    goalId: goal._id,
    periodId: goal.periodId?._id || goal.periodId,
    ownerId: goal.ownerId,
    sequence: Number(latest?.sequence || 0) + 1,
    idempotencyKey,
    checkedInBy: getActor(req),
    summary: payload.summary,
    health: normalizeHealth(payload.health || goal.health),
    confidence: payload.confidence,
    keyResultUpdates: normalizedUpdates,
    blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
    evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
    scoreSnapshot
  });

  let saved = false;
  let saveError;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    try {
      await checkIn.save();
      saved = true;
    } catch (error) {
      saveError = error;
      if (error?.code === 11000 && idempotencyKey) {
        const existing = await GoalCheckIn.findOne({
          organizationId: goal.organizationId,
          goalId: goal._id,
          idempotencyKey
        });
        if (existing) {
          const persistedGoal = await findTenantGoal(req, String(goal._id));
          return { checkIn: existing, goal: persistedGoal, replayed: true };
        }
      }
      if (error?.code !== 11000 || attempt === 2) throw error;
      const newest = await GoalCheckIn.findOne({ organizationId: goal.organizationId, goalId: goal._id })
        .sort({ sequence: -1 })
        .select('sequence');
      checkIn.sequence = Number(newest?.sequence || checkIn.sequence) + 1;
    }
  }
  if (!saved) throw saveError;

  await goal.save();
  await goalEvent(req, goal, 'goal.checked_in', {
    checkInId: String(checkIn._id),
    sequence: checkIn.sequence,
    health: checkIn.health,
    score: scoreSnapshot.progress
  });
  return { checkIn, goal, replayed: false };
}

// ============================================================================
// STATIC ROUTES — these intentionally precede every /:id route.
// ============================================================================

router.get('/', requireAuth, async (req, res) => {
  try {
    const scope = buildGoalVisibilityQuery(req);
    if (!scope) return res.status(400).json({ success: false, error: 'No active organization selected' });
    const filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    else filters.status = { $ne: 'cancelled' };
    if (req.query.period) filters.period = req.query.period;
    if (req.query.periodId) filters.periodId = req.query.periodId;
    if (req.query.ownerId) filters.ownerId = req.query.ownerId;
    if (req.query.teamId) filters['teamHierarchy.teamId'] = req.query.teamId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const goals = await OKR.find(combineQuery(scope, filters))
      .populate('periodId', 'name code type startDate endDate status settings')
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.json({
      success: true,
      data: goals.map((goal) => serializeGoal(goal, req)),
      count: goals.length,
      userRole: req.userRole
    });
  } catch (error) {
    console.error('List goals error:', error);
    return sendError(res, error, 'Failed to fetch goals');
  }
});

router.get('/direct-reports', requirePermission('okr:view:direct_reports'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const directReports = getDirectReportIds(req);
    if (directReports.length === 0) {
      return res.json({ success: true, data: [], directReportCount: 0 });
    }
    const query = {
      organizationId,
      ownerId: { $in: directReports },
      status: { $ne: 'cancelled' }
    };
    if (req.query.periodId) query.periodId = req.query.periodId;
    if (req.query.period) query.period = req.query.period;
    const goals = await OKR.find(query)
      .populate('periodId', 'name code type startDate endDate status settings')
      .sort({ createdAt: -1 });
    return res.json({
      success: true,
      data: goals.map((goal) => serializeGoal(goal, req)),
      directReportCount: directReports.length
    });
  } catch (error) {
    console.error('Direct report goals error:', error);
    return sendError(res, error, 'Failed to fetch direct report goals');
  }
});

router.get('/hierarchy', requireAuth, async (req, res) => {
  try {
    const scope = buildGoalVisibilityQuery(req);
    if (!scope) return res.status(400).json({ success: false, error: 'No active organization selected' });
    const filters = { status: { $nin: ['cancelled', 'rejected'] } };
    if (req.query.periodId) filters.periodId = req.query.periodId;
    if (req.query.period) filters.period = req.query.period;
    const goals = await OKR.find(combineQuery(scope, filters)).sort({ type: 1, createdAt: 1 });
    const byId = new Map(goals.map((goal) => [String(goal._id), { ...serializeGoal(goal, req), children: [] }]));
    const roots = [];
    byId.forEach((node) => {
      const parentId = normalizeId(node.alignment?.parentOKRId);
      if (parentId && byId.has(parentId)) byId.get(parentId).children.push(node);
      else roots.push(node);
    });
    const all = Array.from(byId.values());
    const organization = all.filter((goal) => goal.type === 'organization');
    const unalignedDepartment = all.filter((goal) => goal.type === 'department' && !goal.alignment?.parentOKRId);
    const unalignedTeam = all.filter((goal) => goal.type === 'team' && !goal.alignment?.parentOKRId);
    const unalignedIndividual = all.filter((goal) => goal.type === 'individual' && !goal.alignment?.parentOKRId);
    return res.json({
      success: true,
      data: { organization, unalignedDepartment, unalignedTeam, unalignedIndividual, tree: roots },
      summary: {
        total: goals.length,
        organization: organization.length,
        department: goals.filter((goal) => goal.type === 'department').length,
        team: goals.filter((goal) => goal.type === 'team').length,
        individual: goals.filter((goal) => goal.type === 'individual').length,
        aligned: goals.filter((goal) => goal.alignment?.parentOKRId).length
      }
    });
  } catch (error) {
    console.error('Goal hierarchy error:', error);
    return sendError(res, error, 'Failed to fetch goal hierarchy');
  }
});

router.get('/alignable/list', requireAuth, async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) return res.status(400).json({ success: false, error: 'No active organization selected' });
    const childType = req.query.childType || 'individual';
    const parentTypes = childType === 'department'
      ? ['organization']
      : childType === 'team'
        ? ['organization', 'department']
        : ['organization', 'department', 'team'];
    const query = {
      organizationId,
      status: { $in: ['draft', 'pending', 'active'] },
      type: { $in: parentTypes }
    };
    if (req.query.periodId) query.periodId = req.query.periodId;
    if (req.query.period) query.period = req.query.period;
    const goals = await OKR.find(query)
      .select('_id organizationId type title objectives ownerId createdBy.userId teamHierarchy.teamId period periodId lifecycle scoring')
      .sort({ type: 1, createdAt: -1 });
    const visibleGoals = goals.filter((goal) => canViewGoal(req, goal));
    return res.json({
      success: true,
      data: visibleGoals.map((goal) => ({
        id: goal._id,
        type: goal.type,
        title: goal.title || goal.objectives?.[0]?.title || 'Untitled',
        ownerId: goal.ownerId,
        period: goal.period,
        periodId: goal.periodId,
        lifecycle: goal.lifecycle,
        score: goal.scoring
      }))
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch alignable goals');
  }
});

router.post('/bulk-assign', requirePermission('okr:bulk_assign'), async (req, res) => {
  try {
    const idempotencyKey = String(req.body?.idempotencyKey || req.headers['idempotency-key'] || '').trim();
    const assignments = req.body?.assignments || req.body?.targets;
    const template = req.body?.template || {};
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ success: false, error: 'A stable idempotencyKey of at most 128 characters is required' });
    }
    if (!Array.isArray(assignments) || assignments.length === 0 || assignments.length > 1000) {
      return res.status(400).json({ success: false, error: 'assignments must contain between 1 and 1,000 entries' });
    }

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const created = [];
    const replayed = [];
    const errors = [];
    const processAssignment = async (assignment) => {
      const ownerId = normalizeId(assignment?.ownerId || assignment?.userId);
      const assignmentKey = crypto
        .createHash('sha256')
        .update(`${idempotencyKey}:${assignment?.externalKey || ownerId}`)
        .digest('hex');
      try {
        const existing = await OKR.findOne({
          organizationId,
          'assignment.idempotencyKey': assignmentKey
        });
        if (existing) {
          replayed.push(existing);
          return;
        }
        const body = {
          ...template,
          ...(assignment.goal || {}),
          ...assignment,
          ownerId,
          periodId: assignment.periodId || template.periodId || req.body.periodId,
          period: assignment.period || template.period || req.body.period,
          objectives: assignment.objectives || assignment.goal?.objectives || template.objectives,
          type: assignment.type || template.type || 'individual'
        };
        const goal = await createGoalDocument(req, body, {
          creationSource: 'bulk',
          idempotencyKey: assignmentKey,
          bulkBatchKey: idempotencyKey
        });
        created.push(goal);
      } catch (error) {
        if (error?.code === 11000) {
          const existing = await OKR.findOne({ organizationId, 'assignment.idempotencyKey': assignmentKey });
          if (existing) {
            replayed.push(existing);
            return;
          }
        }
        errors.push({ ownerId, error: error.message, code: error.code });
      }
    };
    // Keep database/outbox pressure bounded while allowing 1,000-person
    // assignments to finish substantially faster than a fully serial loop.
    for (let index = 0; index < assignments.length; index += 20) {
      await Promise.all(assignments.slice(index, index + 20).map(processAssignment));
    }

    await recordEvent({
      eventId: `goal-bulk:${organizationId}:${crypto.createHash('sha256').update(idempotencyKey).digest('hex')}`,
      eventType: 'goal.bulk_assigned',
      aggregateType: 'goal_assignment_batch',
      aggregateId: idempotencyKey,
      organizationId,
      actor: getActor(req),
      occurredAt: new Date(),
      payload: { created: created.length, replayed: replayed.length, failed: errors.length }
    });
    const responseStatus = created.length > 0 ? 201 : (replayed.length > 0 ? 200 : 400);
    return res.status(responseStatus).json({
      success: errors.length === 0,
      data: {
        idempotencyKey,
        created: created.length,
        replayed: replayed.length,
        failed: errors.length,
        goals: created.concat(replayed).map((goal) => serializeGoal(goal, req)),
        errors
      },
      message: `Assigned ${created.length} goals${replayed.length ? ` (${replayed.length} idempotent replays)` : ''}`
    });
  } catch (error) {
    console.error('Bulk assign goals error:', error);
    return sendError(res, error, 'Failed to bulk assign goals');
  }
});

router.post('/', requirePermission('goal:create:self'), async (req, res) => {
  try {
    const goal = await createGoalDocument(req, req.body || {});
    return res.status(201).json({
      success: true,
      data: serializeGoal(goal, req),
      message: goal.lifecycle.state === 'pending_acknowledgement'
        ? 'Goal assigned and awaiting employee acknowledgement'
        : 'Goal created successfully'
    });
  } catch (error) {
    console.error('Create goal error:', error);
    return sendError(res, error, 'Failed to create goal');
  }
});

// ============================================================================
// GOAL-SPECIFIC ROUTES
// ============================================================================

router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    assertView(req, goal);
    const checkIns = await GoalCheckIn.find({ organizationId: goal.organizationId, goalId: goal._id })
      .sort({ sequence: -1 })
      .limit(Math.min(Number(req.query.checkInLimit) || 50, 100));
    return res.json({
      success: true,
      data: {
        version: goal.version,
        versions: goal.versionHistory || [],
        checkIns: checkIns.map((checkIn) => serializeCheckIn(checkIn, req, goal))
      }
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch goal history');
  }
});

router.get('/:id/check-ins', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    assertView(req, goal);
    const query = { organizationId: goal.organizationId, goalId: goal._id };
    if (req.query.beforeSequence) query.sequence = { $lt: Number(req.query.beforeSequence) };
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const checkIns = await GoalCheckIn.find(query).sort({ sequence: -1 }).limit(limit);
    return res.json({
      success: true,
      data: checkIns.map((checkIn) => serializeCheckIn(checkIn, req, goal)),
      count: checkIns.length
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch goal check-ins');
  }
});

router.post('/:id/check-ins', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    const result = await createCheckIn(req, goal, req.body || {});
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      data: {
        checkIn: serializeCheckIn(result.checkIn, req, result.goal),
        goal: serializeGoal(result.goal, req),
        replayed: result.replayed
      },
      message: result.replayed ? 'Check-in already recorded' : 'Goal check-in recorded'
    });
  } catch (error) {
    console.error('Create goal check-in error:', error);
    return sendError(res, error, 'Failed to record goal check-in');
  }
});

router.get('/:id/change-requests', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!isOwner(req, goal) && !canDecideGoal(req, goal)) {
      throw httpError(403, 'Only the assignee or their manager can view change requests', 'CHANGE_REQUEST_ACCESS_DENIED');
    }
    const requests = await GoalChangeRequest.find({
      organizationId: goal.organizationId,
      goalId: goal._id
    }).sort({ createdAt: -1 });
    return res.json({ success: true, data: requests, count: requests.length });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch goal change requests');
  }
});

router.post('/:id/change-requests', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canRequestGoalChange(req, goal)) {
      throw httpError(403, 'Only the assignee can request changes to a manager-assigned goal', 'CHANGE_REQUEST_DENIED');
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw httpError(400, 'A reason is required', 'CHANGE_REASON_REQUIRED');
    const pending = await GoalChangeRequest.findOne({
      organizationId: goal.organizationId,
      goalId: goal._id,
      status: 'pending'
    });
    if (pending) {
      return res.status(409).json({ success: false, error: 'A change request is already pending', data: pending });
    }
    const proposedChanges = sanitizeChangeProposal(req.body?.proposedChanges || {});
    const request = new GoalChangeRequest({
      organizationId: goal.organizationId,
      goalId: goal._id,
      ownerId: goal.ownerId,
      requestedBy: getActor(req),
      reason,
      proposedChanges,
      previousLifecycleState: goal.lifecycle.state
    });
    await request.save();
    goal.assignment.acknowledgementStatus = 'change_requested';
    if (goal.lifecycle.state === 'pending_acknowledgement') {
      goal.lifecycle.state = 'changes_requested';
      goal.status = 'draft';
    }
    goal.updatedBy = getActor(req);
    goal.captureVersion('change_requested_by_assignee', getActor(req), { changeRequestId: request._id });
    await goal.save();
    await goalEvent(req, goal, 'goal.change_requested', { changeRequestId: String(request._id), reason });
    return res.status(201).json({
      success: true,
      data: { request, goal: serializeGoal(goal, req) },
      message: 'Goal change request submitted'
    });
  } catch (error) {
    console.error('Create goal change request error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: 'A change request is already pending' });
    }
    return sendError(res, error, 'Failed to request goal changes');
  }
});

router.post('/:id/change-requests/:requestId/decision', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canDecideGoal(req, goal)) {
      throw httpError(403, 'You cannot decide change requests for this goal', 'CHANGE_DECISION_DENIED');
    }
    const decision = req.body?.decision;
    if (!['approve', 'reject'].includes(decision)) {
      throw httpError(400, 'decision must be approve or reject', 'INVALID_DECISION');
    }
    const request = await GoalChangeRequest.findOne({
      _id: req.params.requestId,
      organizationId: goal.organizationId,
      goalId: goal._id
    });
    if (!request) throw httpError(404, 'Change request not found', 'CHANGE_REQUEST_NOT_FOUND');
    if (request.status !== 'pending') throw httpError(409, 'Change request has already been decided', 'CHANGE_REQUEST_DECIDED');

    if (decision === 'approve') {
      await applyProposal(req, goal, request.proposedChanges || {});
      request.status = 'approved';
      goal.assignment.acknowledgementStatus = 'acknowledged';
      goal.assignment.acknowledgedAt = new Date();
      goal.lifecycle.state = 'active';
      goal.lifecycle.activatedAt = goal.lifecycle.activatedAt || new Date();
      goal.status = 'active';
      goal.approvalStatus = 'approved';
    } else {
      request.status = 'rejected';
      const wasActive = request.previousLifecycleState === 'active';
      goal.assignment.acknowledgementStatus = wasActive ? 'acknowledged' : 'pending';
      goal.lifecycle.state = wasActive ? 'active' : 'pending_acknowledgement';
      goal.status = wasActive ? 'active' : 'draft';
    }
    request.decidedBy = getActor(req);
    request.decisionComment = req.body?.comment;
    request.decidedAt = new Date();
    goal.updatedBy = getActor(req);
    goal.captureVersion(`change_request_${request.status}`, getActor(req), {
      changeRequestId: request._id,
      comment: req.body?.comment
    });
    await request.save();
    await goal.save();
    await goalEvent(req, goal, `goal.change_request_${request.status}`, { changeRequestId: String(request._id) });
    return res.json({
      success: true,
      data: { request, goal: serializeGoal(goal, req) },
      message: `Goal change request ${request.status}`
    });
  } catch (error) {
    console.error('Decide goal change request error:', error);
    return sendError(res, error, 'Failed to decide goal change request');
  }
});

router.post('/:id/submit', requirePermission('okr:submit:own'), async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canSubmitGoal(req, goal)) {
      throw httpError(403, 'Only the owner can submit this draft goal', 'GOAL_SUBMIT_DENIED');
    }
    if (!goal.objectives?.length) throw httpError(400, 'At least one objective is required', 'OBJECTIVES_REQUIRED');
    goal.lifecycle.state = 'pending_approval';
    goal.lifecycle.submittedAt = new Date();
    goal.lifecycle.submittedBy = getActor(req);
    goal.status = 'pending';
    goal.approvalStatus = 'pending';
    goal.updatedBy = getActor(req);
    goal.captureVersion('submitted_for_approval', getActor(req));
    await goal.save();
    await goalEvent(req, goal, 'goal.submitted', { ownerId: goal.ownerId });
    return res.json({ success: true, data: serializeGoal(goal, req), message: 'Goal submitted for manager approval' });
  } catch (error) {
    return sendError(res, error, 'Failed to submit goal');
  }
});

async function decideGoal(req, res, forcedDecision) {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canDecideGoal(req, goal)) {
      throw httpError(403, 'You cannot decide this employee goal', 'GOAL_DECISION_DENIED');
    }
    const decision = forcedDecision || req.body?.decision;
    if (!DECISIONS.has(decision)) {
      throw httpError(400, 'decision must be approve, request_changes, or reject', 'INVALID_DECISION');
    }
    const isPending = goal.lifecycle?.state === 'pending_approval' || goal.approvalStatus === 'pending';
    if (!isPending) throw httpError(409, 'Goal is not awaiting a manager decision', 'GOAL_NOT_PENDING');

    goal.lifecycle.decidedAt = new Date();
    goal.lifecycle.decidedBy = getActor(req);
    goal.lifecycle.decision = decision;
    goal.lifecycle.decisionComment = req.body?.comment;
    if (decision === 'approve') {
      goal.lifecycle.state = 'active';
      goal.lifecycle.activatedAt = new Date();
      goal.status = 'active';
      goal.approvalStatus = 'approved';
      goal.approvedBy = resolveUserId(req);
      goal.approvedAt = new Date();
    } else if (decision === 'request_changes') {
      goal.lifecycle.state = 'changes_requested';
      goal.status = 'draft';
      goal.approvalStatus = 'changes_requested';
    } else {
      goal.lifecycle.state = 'rejected';
      goal.status = 'rejected';
      goal.approvalStatus = 'rejected';
    }
    goal.updatedBy = getActor(req);
    goal.captureVersion(`manager_${decision}`, getActor(req), { comment: req.body?.comment });
    await goal.save();
    const eventType = {
      approve: 'goal.approved',
      request_changes: 'goal.changes_requested',
      reject: 'goal.rejected'
    }[decision];
    await goalEvent(req, goal, eventType, {
      comment: req.body?.comment
    });
    return res.json({ success: true, data: serializeGoal(goal, req), message: `Goal decision recorded: ${decision}` });
  } catch (error) {
    return sendError(res, error, 'Failed to decide goal');
  }
}

router.post('/:id/decision', requirePermission('okr:decide:direct_reports'), (req, res) => decideGoal(req, res));

// Backwards-compatible manager approval endpoint.
router.patch('/:id/approve', requirePermission('okr:decide:direct_reports'), (req, res) => decideGoal(req, res, 'approve'));

router.post('/:id/acknowledge', requirePermission('okr:acknowledge:own'), async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canAcknowledgeGoal(req, goal)) {
      throw httpError(403, 'Only the assignee can acknowledge this goal', 'ACKNOWLEDGEMENT_DENIED');
    }
    goal.assignment.acknowledgementStatus = 'acknowledged';
    goal.assignment.acknowledgedAt = new Date();
    goal.assignment.acknowledgementComment = req.body?.comment;
    goal.lifecycle.state = 'active';
    goal.lifecycle.activatedAt = new Date();
    goal.status = 'active';
    goal.approvalStatus = 'approved';
    goal.updatedBy = getActor(req);
    goal.captureVersion('assignment_acknowledged', getActor(req), { comment: req.body?.comment });
    await goal.save();
    await goalEvent(req, goal, 'goal.assignment_acknowledged');
    return res.json({ success: true, data: serializeGoal(goal, req), message: 'Assigned goal acknowledged' });
  } catch (error) {
    return sendError(res, error, 'Failed to acknowledge goal');
  }
});

// Compatibility endpoint: progress updates now create immutable check-ins.
router.put('/:id/progress', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    const result = await createCheckIn(req, goal, {
      idempotencyKey: req.body?.idempotencyKey,
      summary: req.body?.summary || 'Progress updated',
      health: req.body?.health,
      confidence: req.body?.confidence,
      evidence: req.body?.evidence,
      keyResultUpdates: [{
        objectiveIndex: req.body?.objectiveIndex ?? 0,
        keyResultIndex: req.body?.keyResultIndex,
        currentValue: req.body?.currentValue,
        health: req.body?.health,
        note: req.body?.note
      }]
    });
    return res.json({
      success: true,
      data: serializeGoal(result.goal, req),
      checkIn: serializeCheckIn(result.checkIn, req, result.goal),
      replayed: result.replayed
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update goal progress');
  }
});

router.put('/:id/align', requirePermission('okr:align'), async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canAlignGoal(req, goal)) throw httpError(403, 'You cannot align this goal', 'ALIGNMENT_DENIED');
    const oldParentId = goal.alignment?.parentOKRId;
    const parentOKRId = req.body?.parentOKRId || null;
    if (parentOKRId) {
      await validateAlignment(req, goal, parentOKRId, req.body?.parentObjectiveIndex ?? 0);
      goal.alignment = {
        parentOKRId,
        parentObjectiveIndex: req.body?.parentObjectiveIndex ?? 0,
        alignmentType: req.body?.alignmentType || 'cascade',
        alignmentNotes: req.body?.alignmentNotes,
        contributionWeight: req.body?.contributionWeight
      };
    } else {
      goal.alignment = undefined;
    }
    goal.updatedBy = getActor(req);
    goal.captureVersion(parentOKRId ? 'goal_aligned' : 'goal_unaligned', getActor(req), {
      previousParentOKRId: oldParentId || null,
      parentOKRId
    });
    await goal.save();
    await syncParentChildren(goal, oldParentId, parentOKRId);
    await goalEvent(req, goal, parentOKRId ? 'goal.aligned' : 'goal.unaligned', { parentOKRId });
    return res.json({
      success: true,
      data: serializeGoal(goal, req),
      message: parentOKRId ? 'Goal aligned successfully' : 'Goal unaligned'
    });
  } catch (error) {
    return sendError(res, error, 'Failed to align goal');
  }
});

router.get('/:id/children', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    assertView(req, goal);
    const children = await OKR.find({
      organizationId: goal.organizationId,
      'alignment.parentOKRId': goal._id,
      status: { $ne: 'cancelled' }
    });
    const visible = children.filter((child) => canViewGoal(req, child));
    return res.json({ success: true, data: visible.map((child) => serializeGoal(child, req)), count: visible.length });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch child goals');
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canEditGoal(req, goal)) throw httpError(403, 'You cannot edit this goal', 'GOAL_EDIT_DENIED');
    const actor = getActor(req);
    const ownerEditingManagerAssigned = isOwner(req, goal) && Boolean(goal.assignment?.assignedBy?.userId);
    if (ownerEditingManagerAssigned && ['active', 'pending_acknowledgement'].includes(goal.lifecycle.state)) {
      throw httpError(409, 'Use a change request to propose edits to a manager-assigned goal', 'CHANGE_REQUEST_REQUIRED');
    }

    const changes = {};
    if (req.body?.title !== undefined) {
      goal.title = String(req.body.title).trim();
      changes.title = goal.title;
    }
    if (req.body?.objectives !== undefined || req.body?.keyResults !== undefined || req.body?.objective !== undefined) {
      goal.objectives = normalizeObjectives(req.body);
      changes.objectives = true;
    }
    if (req.body?.periodId !== undefined || req.body?.period !== undefined) {
      const resolved = await resolvePeriod(req, req.body.periodId, req.body.period || goal.period);
      goal.periodId = resolved.period?._id;
      goal.period = resolved.label;
      changes.period = goal.period;
    }
    if (req.body?.status === 'closed') {
      goal.status = 'closed';
      goal.lifecycle.state = 'closed';
      goal.lifecycle.closedAt = new Date();
      changes.status = 'closed';
    }

    const parentWasProvided = req.body?.parentOKRId !== undefined;
    const oldParentId = goal.alignment?.parentOKRId;
    if (parentWasProvided) {
      const nextParentId = req.body.parentOKRId || null;
      if (nextParentId) {
        await validateAlignment(req, goal, nextParentId, req.body?.parentObjectiveIndex ?? 0);
        goal.alignment = {
          parentOKRId: nextParentId,
          parentObjectiveIndex: req.body?.parentObjectiveIndex ?? 0,
          alignmentType: req.body?.alignmentType || 'cascade',
          alignmentNotes: req.body?.alignmentNotes
        };
      } else {
        goal.alignment = undefined;
      }
      changes.parentOKRId = nextParentId;
    }

    const isStructureChange = Object.keys(changes).some((key) => key !== 'status');
    if (isStructureChange && goal.lifecycle.state === 'active' && goal.type === 'individual') {
      if (isOwner(req, goal) && !goal.assignment?.assignedBy?.userId) {
        goal.lifecycle.state = 'pending_approval';
        goal.status = 'pending';
        goal.approvalStatus = 'pending';
        goal.lifecycle.submittedAt = new Date();
        goal.lifecycle.submittedBy = actor;
      } else {
        goal.lifecycle.state = 'pending_acknowledgement';
        goal.status = 'draft';
        goal.approvalStatus = 'approved';
        goal.assignment.assignedBy = actor;
        goal.assignment.assignedAt = new Date();
        goal.assignment.acknowledgementStatus = 'pending';
      }
    }

    goal.updatedBy = actor;
    goal.captureVersion('goal_updated', actor, changes);
    await goal.save();
    if (parentWasProvided) await syncParentChildren(goal, oldParentId, req.body.parentOKRId || null);
    await goalEvent(req, goal, 'goal.updated', { changes });
    return res.json({ success: true, data: serializeGoal(goal, req), message: 'Goal updated successfully' });
  } catch (error) {
    console.error('Update goal error:', error);
    return sendError(res, error, 'Failed to update goal');
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    if (!canEditGoal(req, goal)) throw httpError(403, 'You cannot cancel this goal', 'GOAL_CANCEL_DENIED');
    const oldParentId = goal.alignment?.parentOKRId;
    goal.status = 'cancelled';
    goal.lifecycle.state = 'cancelled';
    goal.lifecycle.cancelledAt = new Date();
    goal.updatedBy = getActor(req);
    goal.captureVersion('goal_cancelled', getActor(req), { reason: req.body?.reason });
    await goal.save();
    if (oldParentId) await syncParentChildren(goal, oldParentId, null);
    await goalEvent(req, goal, 'goal.cancelled', { reason: req.body?.reason });
    return res.json({ success: true, data: serializeGoal(goal, req), message: 'Goal cancelled successfully' });
  } catch (error) {
    return sendError(res, error, 'Failed to cancel goal');
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const goal = await findTenantGoal(req, req.params.id);
    assertView(req, goal);
    return res.json({ success: true, data: serializeGoal(goal, req) });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch goal');
  }
});

module.exports = router;
