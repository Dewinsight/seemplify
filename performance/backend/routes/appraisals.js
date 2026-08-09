const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const AppraisalCycle = require('../models/AppraisalCycle');
const Appraisal = require('../models/Appraisal');
const AppraisalDocument = require('../models/AppraisalDocument');
const OKR = require('../models/OKR');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const { requireAuth, requireHRAdmin, requireManager } = require('../middleware/rbac');
const documentExtractionService = require('../services/documentExtractionService');
const appraisalAIService = require('../services/appraisalAIService');
const {
  getStatusAfterManagerReview,
  getStatusAfterDiscussion
} = require('../services/appraisalWorkflowService');
const notificationService = require('../services/notificationService');
const { getOrganizationFeatureState } = require('../services/organizationFeatureService');
const { findManagerForEmployee } = require('../services/idpService');
const User = require('../models/User');
const { fetchAttendanceContext } = require('../services/attendanceContextService');
const { buildGoalSnapshots } = require('../services/appraisalGoalSnapshotService');
const {
  canAppraiseEmployee,
  canManageAppraisal,
  isAppraisalManagerRole,
  resolveAppraisalAccessScope
} = require('../services/appraisalAccessService');

function getRequesterIdentity(req) {
  const userIds = Array.from(
    new Set(
      [req.session?.user?.id, req.session?.user?.sub]
        .filter(Boolean)
        .map((value) => String(value))
    )
  );

  return {
    userId: userIds[0] || null,
    userIds,
    userEmail: normalizeIdentityEmail(req.session?.user?.email)
  };
}

function resolveOrganizationId(req) {
  return (
    req.currentOrganization?.id ||
    req.currentOrganization?._id?.toString?.() ||
    req.session?.currentOrganizationId ||
    req.session?.user?.currentOrganization?.id ||
    req.session?.user?.currentOrganization?._id?.toString?.() ||
    req.session?.user?.userinfo?.current_organization?.id ||
    req.session?.user?.userinfo?.currentOrganization?.id ||
    req.session?.user?.organizations?.[0]?.id ||
    req.session?.user?.userinfo?.organizations?.[0]?.id ||
    null
  );
}

function tenantAppraisalIdFilter(req, appraisalId) {
  const organizationId = resolveOrganizationId(req);
  return {
    _id: appraisalId,
    organizationId: organizationId ? String(organizationId) : '__no_active_organization__'
  };
}

function tenantCycleIdFilter(req, cycleId) {
  const organizationId = resolveOrganizationId(req);
  return {
    _id: cycleId,
    organizationId: organizationId ? String(organizationId) : '__no_active_organization__'
  };
}

function tenantCyclePopulate(req, select = null) {
  const organizationId = resolveOrganizationId(req);
  return {
    path: 'cycleId',
    match: {
      organizationId: organizationId ? String(organizationId) : '__no_active_organization__'
    },
    ...(select ? { select } : {})
  };
}

function normalizeIdentityEmail(value) {
  if (!value || typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function buildManagerIdentityFilters(identity = {}) {
  const filters = [];
  const userIds = Array.isArray(identity.userIds)
    ? identity.userIds
    : (identity.userId ? [identity.userId] : []);

  userIds.forEach((id) => {
    filters.push({ 'manager.userId': String(id) });
  });

  const userEmail = normalizeIdentityEmail(identity.userEmail);
  if (userEmail) {
    filters.push(
      { 'manager.email': userEmail },
      { 'manager.email': { $regex: `^${escapeRegex(userEmail)}$`, $options: 'i' } }
    );
  }

  return filters;
}

function buildEmployeeIdentityMatch(employee = {}) {
  const filters = [];
  const userId = employee?.userId ? String(employee.userId) : null;
  const email = normalizeIdentityEmail(employee?.email);

  if (userId) {
    filters.push({ 'employee.userId': userId });
  }

  if (email) {
    filters.push(
      { 'employee.email': email },
      { 'employee.email': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } }
    );
  }

  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { $or: filters };
}

function isAppraisalEmployee(req, appraisal) {
  const { userIds, userEmail } = getRequesterIdentity(req);
  const appraisalUserId = appraisal?.employee?.userId ? String(appraisal.employee.userId) : null;
  if (appraisalUserId && userIds.includes(appraisalUserId)) {
    return true;
  }

  const appraisalEmail = normalizeIdentityEmail(appraisal?.employee?.email);
  return Boolean(appraisalEmail && userEmail && appraisalEmail === userEmail);
}

function requesterEmployeeIdentityFilters(req) {
  const { userIds, userEmail } = getRequesterIdentity(req);
  const filters = userIds.map((id) => ({ 'employee.userId': id }));
  if (userEmail) {
    filters.push(
      { 'employee.email': userEmail },
      { 'employee.email': { $regex: `^${escapeRegex(userEmail)}$`, $options: 'i' } }
    );
  }
  return filters;
}

async function canViewAppraisalCycle(req, cycle) {
  const organizationId = resolveOrganizationId(req);
  if (!organizationId || !cycle || String(cycle.organizationId) !== String(organizationId)) return false;
  if (req.userRole === 'hr_admin') return true;

  if (isAppraisalManagerRole(req.userRole)) {
    const requester = getRequesterIdentity(req);
    const isCreator = requester.userIds.includes(String(cycle.createdBy?.userId || ''));
    if (isCreator || cycle.scope?.type === 'organization') return true;

    const scope = await resolveAppraisalAccessScope(req);
    const accessibleTeamIds = new Set((scope.accessibleTeamIds || []).map(String));
    const targetIds = (cycle.scope?.targetIds || []).map(String);
    if (targetIds.some((targetId) => accessibleTeamIds.has(targetId))) return true;

    const managerFilters = buildManagerIdentityFilters(requester);
    if (managerFilters.length > 0) {
      return Boolean(await Appraisal.exists({
        organizationId: String(organizationId),
        cycleId: cycle._id,
        $or: managerFilters
      }));
    }
    return false;
  }

  if (cycle.scope?.type === 'organization') return true;
  const employeeFilters = requesterEmployeeIdentityFilters(req);
  if (employeeFilters.length === 0) return false;
  return Boolean(await Appraisal.exists({
    organizationId: String(organizationId),
    cycleId: cycle._id,
    $or: employeeFilters
  }));
}

async function canManageAppraisalCycle(req, cycle) {
  const organizationId = resolveOrganizationId(req);
  if (!organizationId || !cycle || String(cycle.organizationId) !== String(organizationId)) return false;
  if (req.userRole === 'hr_admin') return true;
  if (!isAppraisalManagerRole(req.userRole)) return false;

  const requester = getRequesterIdentity(req);
  if (requester.userIds.includes(String(cycle.createdBy?.userId || ''))) return true;
  if (cycle.scope?.type === 'organization') return true;

  const scope = await resolveAppraisalAccessScope(req);
  const accessibleTeamIds = new Set((scope.accessibleTeamIds || []).map(String));
  const targetIds = (cycle.scope?.targetIds || []).map(String);
  if (targetIds.some((targetId) => accessibleTeamIds.has(targetId))) return true;

  const managerFilters = buildManagerIdentityFilters(requester);
  if (managerFilters.length === 0) return false;
  return Boolean(await Appraisal.exists({
    organizationId: String(organizationId),
    cycleId: cycle._id,
    $or: managerFilters
  }));
}

function toPlainObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value.toObject === 'function') return value.toObject();
  if (typeof value === 'object') return value;
  return fallback;
}

function normalizeOptionalObjectId(value) {
  if (!value) return null;

  if (looksLikeObjectId(String(value))) {
    return String(value);
  }

  if (typeof value === 'object') {
    const nestedId = value._id || value.id;
    if (nestedId && looksLikeObjectId(String(nestedId))) {
      return String(nestedId);
    }
  }

  return null;
}

function normalizeNumberInRange(value, minimum, maximum, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, numericValue));
}

function normalizeManagerReviewPayload(managerReview = {}, appraisal = null) {
  const allowedPromotionReadiness = new Set(['not_ready', 'developing', 'ready', 'overdue']);
  const currentManagerReview = toPlainObject(appraisal?.managerReview);
  const currentSummary = toPlainObject(currentManagerReview?.overallSummary);
  const nextSummary = toPlainObject(managerReview?.overallSummary);
  const selfCompetencyRatings = Array.isArray(appraisal?.selfAssessment?.competencyRatings)
    ? appraisal.selfAssessment.competencyRatings
    : [];

  const normalizedPromotionReadiness = allowedPromotionReadiness.has(nextSummary?.promotionReadiness)
    ? nextSummary.promotionReadiness
    : (
      allowedPromotionReadiness.has(currentSummary?.promotionReadiness)
        ? currentSummary.promotionReadiness
        : 'developing'
    );

  const competencyRatings = Array.isArray(managerReview?.competencyRatings)
    ? managerReview.competencyRatings
      .map((rawRating) => {
        const competencyId = rawRating?.competencyId ? String(rawRating.competencyId) : null;
        if (!competencyId) return null;

        const managerRating = normalizeNumberInRange(rawRating?.managerRating, 1, 5, null);
        const selfRating = selfCompetencyRatings.find((entry) => entry?.competencyId === competencyId);
        const selfRatingValue = normalizeNumberInRange(selfRating?.selfRating, 1, 5, null);

        return {
          competencyId,
          competencyName: typeof rawRating?.competencyName === 'string' ? rawRating.competencyName.trim() : '',
          ...(managerRating !== null ? { managerRating } : {}),
          managerComments: typeof rawRating?.managerComments === 'string' ? rawRating.managerComments.trim() : '',
          gapFromSelf: managerRating !== null && selfRatingValue !== null
            ? managerRating - selfRatingValue
            : null
        };
      })
      .filter(Boolean)
    : (Array.isArray(currentManagerReview?.competencyRatings) ? currentManagerReview.competencyRatings : []);

  const okrAssessment = Array.isArray(managerReview?.okrAssessment)
    ? managerReview.okrAssessment
      .map((rawOkr) => {
        const okrId = normalizeOptionalObjectId(rawOkr?.okrId);
        const okrTitle = typeof rawOkr?.okrTitle === 'string' ? rawOkr.okrTitle.trim() : '';
        const managerVerifiedCompletion = normalizeNumberInRange(rawOkr?.managerVerifiedCompletion, 0, 100, 0);
        const qualityRating = normalizeNumberInRange(rawOkr?.qualityRating, 1, 5, 3);

        if (!okrId && !okrTitle) return null;

        return {
          ...(okrId ? { okrId } : {}),
          okrTitle,
          managerVerifiedCompletion,
          managerComments: typeof rawOkr?.managerComments === 'string' ? rawOkr.managerComments.trim() : '',
          qualityRating
        };
      })
      .filter(Boolean)
    : (Array.isArray(currentManagerReview?.okrAssessment) ? currentManagerReview.okrAssessment : []);

  const overallManagerRating = normalizeNumberInRange(
    managerReview?.overallManagerRating,
    1,
    5,
    normalizeNumberInRange(currentManagerReview?.overallManagerRating, 1, 5, 3)
  );

  return {
    overallSummary: {
      achievements: typeof nextSummary?.achievements === 'string' ? nextSummary.achievements.trim() : (currentSummary?.achievements || ''),
      strengths: typeof nextSummary?.strengths === 'string' ? nextSummary.strengths.trim() : (currentSummary?.strengths || ''),
      improvements: typeof nextSummary?.improvements === 'string' ? nextSummary.improvements.trim() : (currentSummary?.improvements || ''),
      recommendations: typeof nextSummary?.recommendations === 'string' ? nextSummary.recommendations.trim() : (currentSummary?.recommendations || ''),
      promotionReadiness: normalizedPromotionReadiness
    },
    competencyRatings,
    okrAssessment,
    overallManagerRating
  };
}

function normalizeConversationText(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function isLowSignalConversationText(value) {
  const normalized = normalizeConversationText(value).toLowerCase();
  if (!normalized) return true;
  return /^(?:n\/a|na|none|nothing|nil|no|nope|idk|i(?:\s+do)?n'?t know|not sure|skip|pass|same|none yet|nothing yet|no comment)$/i.test(normalized);
}

function hasMeaningfulConversationText(value, options = {}) {
  const {
    minLength = 12,
    minWords = 3,
    allowSingleWord = false
  } = options;

  const normalized = normalizeConversationText(value);
  if (!normalized || isLowSignalConversationText(normalized)) return false;

  if (allowSingleWord) {
    return normalized.length >= minLength;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  return normalized.length >= minLength && words.length >= minWords;
}

function sanitizeConversationExtraction(type, data) {
  if (!type || !data) return null;

  switch (type) {
    case 'achievement': {
      const text = normalizeConversationText(data.text);
      if (!hasMeaningfulConversationText(text, { minLength: 8, minWords: 2 })) return null;
      return { text };
    }
    case 'challenge': {
      const text = normalizeConversationText(data.text);
      if (!hasMeaningfulConversationText(text, { minLength: 8, minWords: 2 })) return null;
      return {
        text,
        resolution: normalizeConversationText(data.resolution),
        learnings: normalizeConversationText(data.learnings)
      };
    }
    case 'learning':
    case 'skill': {
      const skill = normalizeConversationText(data.text || data.skill);
      if (!hasMeaningfulConversationText(skill, { minLength: 3, allowSingleWord: true })) return null;
      return {
        skill,
        evidence: normalizeConversationText(data.context || data.evidence)
      };
    }
    case 'goal': {
      const goal = normalizeConversationText(data.text || data.goal);
      if (!hasMeaningfulConversationText(goal, { minLength: 6, minWords: 2 })) return null;
      return {
        goal,
        measurable: Boolean(data.measurable),
        timeframe: normalizeConversationText(data.timeframe)
      };
    }
    default:
      return null;
  }
}

function hasMeaningfulSummaryText(value, options = {}) {
  const { minLength = 20, minWords = 4 } = options;
  const normalized = normalizeConversationText(value);
  if (!normalized || isLowSignalConversationText(normalized) || /^not provided\.?$/i.test(normalized)) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return normalized.length >= minLength && words.length >= minWords;
}

function getMissingSelfAssessmentSections(summary = {}) {
  const missing = [];
  if (!hasMeaningfulSummaryText(summary.achievements, { minLength: 20, minWords: 4 })) {
    missing.push('Key achievements (with examples/metrics)');
  }
  if (!hasMeaningfulSummaryText(summary.challenges, { minLength: 16, minWords: 3 })) {
    missing.push('Challenges faced');
  }
  if (!hasMeaningfulSummaryText(summary.learnings, { minLength: 16, minWords: 3 })) {
    missing.push('Key learnings');
  }
  if (!hasMeaningfulSummaryText(summary.goals, { minLength: 16, minWords: 3 })) {
    missing.push('Goals for next period');
  }
  return missing;
}

function normalizeSelfAssessmentSummary(summary = {}) {
  const fallbackText = 'Not provided.';
  return {
    achievements: normalizeConversationText(summary?.achievements) || fallbackText,
    challenges: normalizeConversationText(summary?.challenges) || fallbackText,
    learnings: normalizeConversationText(summary?.learnings) || fallbackText,
    improvements: normalizeConversationText(summary?.improvements) || fallbackText,
    goals: normalizeConversationText(summary?.goals) || fallbackText
  };
}

function ensureConversationAssessmentState(appraisal) {
  if (!appraisal) return;

  appraisal.conversationAssessment = appraisal.conversationAssessment || {};
  appraisal.conversationAssessment.mode = appraisal.conversationAssessment.mode || 'conversation';
  appraisal.conversationAssessment.currentPhase = appraisal.conversationAssessment.currentPhase || 'initialized';
  appraisal.conversationAssessment.currentOkrIndex = Number.isInteger(appraisal.conversationAssessment.currentOkrIndex)
    ? appraisal.conversationAssessment.currentOkrIndex
    : 0;
  appraisal.conversationAssessment.completedPhases = Array.isArray(appraisal.conversationAssessment.completedPhases)
    ? appraisal.conversationAssessment.completedPhases
    : [];
  appraisal.conversationAssessment.extractedData = appraisal.conversationAssessment.extractedData || {};
  appraisal.conversationAssessment.extractedData.achievements = Array.isArray(appraisal.conversationAssessment.extractedData.achievements)
    ? appraisal.conversationAssessment.extractedData.achievements
    : [];
  appraisal.conversationAssessment.extractedData.challenges = Array.isArray(appraisal.conversationAssessment.extractedData.challenges)
    ? appraisal.conversationAssessment.extractedData.challenges
    : [];
  appraisal.conversationAssessment.extractedData.skills = Array.isArray(appraisal.conversationAssessment.extractedData.skills)
    ? appraisal.conversationAssessment.extractedData.skills
    : [];
  appraisal.conversationAssessment.extractedData.goals = Array.isArray(appraisal.conversationAssessment.extractedData.goals)
    ? appraisal.conversationAssessment.extractedData.goals
    : [];
  appraisal.conversationAssessment.startedAt = appraisal.conversationAssessment.startedAt || new Date();
  appraisal.conversationAssessment.lastActivityAt = appraisal.conversationAssessment.lastActivityAt || new Date();
  appraisal.conversationAssessment.totalTokensUsed = typeof appraisal.conversationAssessment.totalTokensUsed === 'number'
    ? appraisal.conversationAssessment.totalTokensUsed
    : 0;
  appraisal.conversationAssessment.messageCount = typeof appraisal.conversationAssessment.messageCount === 'number'
    ? appraisal.conversationAssessment.messageCount
    : 0;
}

function isCalibrationEnabledForCycle(cycle) {
  if (!cycle) return false;
  const calibrationPhase = cycle?.phases?.calibration;
  if (!calibrationPhase) return false;

  return Boolean(
    calibrationPhase.isActive ||
    calibrationPhase.isCompleted ||
    calibrationPhase.startDate ||
    calibrationPhase.endDate ||
    cycle.currentPhase === 'calibration'
  );
}

function isAiAssistEnabledForCycle(cycle) {
  return cycle?.settings?.enableAiAssist !== false;
}

async function isAiAssistEnabledForAppraisal(appraisal) {
  if (!appraisal) return true;

  const cycleRef = appraisal.cycleId;
  if (cycleRef && typeof cycleRef === 'object' && cycleRef.settings) {
    return isAiAssistEnabledForCycle(cycleRef);
  }

  const cycleId = cycleRef?._id || cycleRef;
  if (!cycleId) return true;

  const cycle = await AppraisalCycle.findOne({
    _id: cycleId,
    organizationId: appraisal.organizationId
  }).select('settings.enableAiAssist');
  return isAiAssistEnabledForCycle(cycle);
}

async function isChatEnabledForAppraisal(appraisal) {
  if (!appraisal) return false;
  const cycleRef = appraisal.cycleId;
  if (cycleRef && typeof cycleRef === 'object' && cycleRef.settings) {
    return cycleRef.settings.enableChat !== false;
  }
  const cycleId = cycleRef?._id || cycleRef;
  if (!cycleId) return false;
  const cycle = await AppraisalCycle.findOne({
    _id: cycleId,
    organizationId: appraisal.organizationId
  }).select('settings.enableChat');
  return cycle?.settings?.enableChat !== false;
}

function hasStatus(statusCounts, statuses = []) {
  return statuses.some((status) => (statusCounts[status] || 0) > 0);
}

async function syncCycleProgress(cycleId, organizationId) {
  if (!cycleId || !organizationId) return;

  const cycle = await AppraisalCycle.findOne({ _id: cycleId, organizationId: String(organizationId) });
  if (!cycle || cycle.status === 'cancelled') return;

  const appraisals = await Appraisal.find({
    cycleId: cycle._id,
    organizationId: String(organizationId)
  }).select('status');
  if (!Array.isArray(appraisals) || appraisals.length === 0) return;

  const statusCounts = appraisals.reduce((acc, appraisal) => {
    const status = appraisal?.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const allCompleted = appraisals.every((appraisal) =>
    APPRAISAL_COMPLETED_STATUSES.includes(appraisal.status)
  );

  const selfStatuses = ['not_started', 'goal_setting', 'goal_approval_pending', 'self_assessment_pending', 'self_assessment_in_progress'];
  const managerStatuses = ['self_assessment_submitted', 'manager_review_pending', 'manager_review_in_progress', 'manager_review_submitted', 'discussion_scheduled'];
  const calibrationStatuses = ['calibration_pending', 'calibration_in_progress'];
  const finalStatuses = ['calibration_completed', 'final_review_pending', 'discussion_scheduled', 'discussion_completed', ...APPRAISAL_COMPLETED_STATUSES];

  const calibrationEnabled = isCalibrationEnabledForCycle(cycle);

  let nextPhase = cycle.currentPhase || 'selfAssessment';
  if (allCompleted) {
    nextPhase = 'completed';
  } else if (hasStatus(statusCounts, selfStatuses)) {
    nextPhase = 'selfAssessment';
  } else if (hasStatus(statusCounts, managerStatuses)) {
    nextPhase = 'managerReview';
  } else if (calibrationEnabled && hasStatus(statusCounts, calibrationStatuses)) {
    nextPhase = 'calibration';
  } else if (hasStatus(statusCounts, finalStatuses) || (!calibrationEnabled && hasStatus(statusCounts, calibrationStatuses))) {
    nextPhase = 'finalReview';
  }

  const phaseOrder = ['goalSetting', 'selfAssessment', 'managerReview', 'calibration', 'finalReview'];
  const currentIndex = phaseOrder.indexOf(nextPhase);

  phaseOrder.forEach((phase, index) => {
    if (!cycle.phases?.[phase]) return;
    cycle.phases[phase].isActive = false;
    cycle.phases[phase].isCompleted = nextPhase === 'completed' ? true : (currentIndex >= 0 && index < currentIndex);
  });

  if (nextPhase !== 'completed' && cycle.phases?.[nextPhase]) {
    cycle.phases[nextPhase].isActive = true;
  }

  cycle.currentPhase = nextPhase;
  cycle.status = nextPhase === 'completed' ? 'completed' : 'active';
  cycle.markModified('phases');
  await cycle.save();
}

function isSelfAssessmentEditable(appraisal) {
  if (!appraisal) return false;
  if (appraisal?.selfAssessment?.submittedAt) return false;
  return SELF_ASSESSMENT_EDITABLE_STATUSES.includes(appraisal.status);
}

function addManagerNotification(appraisal, message, type = 'self_assessment_submitted') {
  if (!appraisal || !message) return;

  appraisal.notifications = Array.isArray(appraisal.notifications) ? appraisal.notifications : [];

  const now = new Date();
  const dedupeWindowMs = 15 * 60 * 1000;
  const normalizedMessage = message.toString().trim();

  const hasRecentDuplicate = appraisal.notifications.some((notification) => {
    if (!notification) return false;
    if (notification.type !== type) return false;
    if (notification.readAt) return false;
    if ((notification.message || '').toString().trim() !== normalizedMessage) return false;
    if (!notification.sentAt) return true;

    const sentAt = new Date(notification.sentAt).getTime();
    if (Number.isNaN(sentAt)) return false;
    return Math.abs(now.getTime() - sentAt) <= dedupeWindowMs;
  });

  if (hasRecentDuplicate) return;

  appraisal.notifications.unshift({
    type,
    message: normalizedMessage,
    sentAt: now
  });

  if (appraisal.notifications.length > 100) {
    appraisal.notifications = appraisal.notifications.slice(0, 100);
  }
}

function markManagerNotificationsRead(appraisal, options = {}) {
  if (!appraisal || !Array.isArray(appraisal.notifications) || appraisal.notifications.length === 0) {
    return 0;
  }

  const allowedTypes = Array.isArray(options.types) && options.types.length > 0
    ? new Set(options.types)
    : null;

  const readAt = new Date();
  let markedCount = 0;

  appraisal.notifications.forEach((notification) => {
    if (!notification || notification.readAt) return;
    if (allowedTypes && !allowedTypes.has(notification.type)) return;
    notification.readAt = readAt;
    markedCount += 1;
  });

  return markedCount;
}

async function recordAppraisalEvent(appraisal, eventType, actor, options = {}) {
  try {
    const outboxService = require('../services/outboxService');
    const recipients = (options.recipients || []).filter((recipient) => recipient?.userId);
    const dueAt = options.dueAt ? new Date(options.dueAt) : null;
    await outboxService.recordEvent({
      eventType,
      organizationId: appraisal.organizationId,
      aggregateType: 'appraisal',
      aggregateId: String(appraisal._id),
      actor,
      recipients: recipients.map((recipient) => ({
        userId: String(recipient.userId),
        name: recipient.name,
        email: recipient.email,
        channels: recipient.email ? ['in_app', 'email'] : ['in_app']
      })),
      data: {
        deepLink: `/appraisals/${appraisal._id}`,
        ...(dueAt && !Number.isNaN(dueAt.getTime()) ? { dueAt } : {}),
        ...options.data
      }
    });

    if (dueAt && !Number.isNaN(dueAt.getTime()) && recipients.length > 0) {
      const { scheduleReminderSequence } = require('../services/reminderScheduler');
      const reminderPresentation = {
        category: 'appraisal',
        title: options.reminderTitle || 'Appraisal action due',
        message: options.reminderMessage || 'An appraisal action needs your attention.',
        deepLink: `/appraisals/${appraisal._id}`,
        priority: 'high',
        action: {
          kind: options.actionKind || 'open',
          label: options.actionLabel || 'Open appraisal'
        }
      };

      for (const recipient of recipients) {
        await scheduleReminderSequence({
          organizationId: appraisal.organizationId,
          target: {
            type: options.reminderTargetType || 'appraisal_action',
            id: String(appraisal._id)
          },
          eventType: `${eventType}.reminder`,
          dueAt,
          recipient: {
            userId: String(recipient.userId),
            name: recipient.name,
            email: recipient.email,
            channels: recipient.email ? ['in_app', 'email'] : ['in_app']
          },
          notification: reminderPresentation
        });
      }
    }
  } catch (error) {
    console.warn('Appraisal event was not recorded:', error.message);
  }
}

async function cancelAppraisalReminders(appraisal, reminderTargetType, userId = null, reason = 'action_completed') {
  try {
    const { cancelRemindersForTarget } = require('../services/reminderScheduler');
    await cancelRemindersForTarget({
      organizationId: appraisal.organizationId,
      targetType: reminderTargetType,
      targetId: String(appraisal._id),
      userId: userId ? String(userId) : null,
      reason
    });
  } catch (error) {
    console.warn('Appraisal reminders were not cancelled:', error.message);
  }
}

const APPRAISAL_COMPLETED_STATUSES = ['completed', 'employee_acknowledged'];
const SELF_ASSESSMENT_EDITABLE_STATUSES = ['self_assessment_pending', 'self_assessment_in_progress'];
const SELF_ASSESSMENT_PENDING_STATUSES = ['self_assessment_pending', 'self_assessment_in_progress'];
const MANAGER_REVIEW_EDITABLE_STATUSES = ['manager_review_pending', 'manager_review_in_progress', 'self_assessment_submitted'];
const MANAGER_REVIEW_PENDING_STATUSES = ['manager_review_pending', 'manager_review_in_progress', 'self_assessment_submitted'];
const CALIBRATION_EDITABLE_STATUSES = ['calibration_pending', 'calibration_in_progress'];
const CALIBRATION_PENDING_STATUSES = ['calibration_pending', 'calibration_in_progress'];
const FINAL_REVIEW_ALLOWED_STATUSES = ['final_review_pending', 'calibration_completed'];
const FINAL_REVIEW_PENDING_STATUSES = ['final_review_pending', 'calibration_completed'];

function validateCycleConfiguration(input = {}) {
  const errors = [];
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) {
    errors.push('Evaluation period start and end dates are invalid');
    return errors;
  }

  const orderedPhases = ['goalSetting', 'selfAssessment', 'managerReview', 'calibration', 'finalReview'];
  let previousEnd = null;
  for (const phaseName of orderedPhases) {
    const phase = input.phases?.[phaseName];
    if (!phase?.startDate && !phase?.endDate) continue;
    const start = new Date(phase.startDate);
    const end = new Date(phase.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      errors.push(`${phaseName} requires a valid start date before its end date`);
      continue;
    }
    if (previousEnd && start < previousEnd) {
      errors.push(`${phaseName} cannot overlap the preceding phase`);
    }
    previousEnd = end;
  }

  const selfStartsAt = input.phases?.selfAssessment?.startDate
    ? new Date(input.phases.selfAssessment.startDate)
    : null;
  if (selfStartsAt && !Number.isNaN(selfStartsAt.getTime()) && periodEnd > selfStartsAt) {
    errors.push('The evaluation period must end before self-assessment opens so goal evidence has a stable cutoff');
  }

  const okrWeight = Number(input.okrWeight ?? 40);
  if (!Number.isFinite(okrWeight) || okrWeight < 0 || okrWeight > 100) {
    errors.push('OKR weight must be between 0 and 100');
  }
  return errors;
}

function phaseHasOpened(cycle, phaseName) {
  const startDate = cycle?.phases?.[phaseName]?.startDate;
  if (!startDate) return true;
  const start = new Date(startDate);
  return !Number.isNaN(start.getTime()) && start <= new Date();
}

const DEFAULT_CYCLE_STATS = {
  totalEmployees: 0,
  completedAppraisals: 0,
  pendingSelfAssessment: 0,
  pendingManagerReview: 0,
  pendingCalibration: 0,
  pendingFinalReview: 0,
  selfAssessmentSubmitted: 0,
  managerReviewSubmitted: 0,
  finalized: 0,
  overdueAppraisals: 0,
  averageRating: null
};

function toSafeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function roundTo(value, decimals = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mergeCycleStats(storedStats = {}, computedStats = {}) {
  const merged = {
    ...DEFAULT_CYCLE_STATS,
    ...(storedStats || {}),
    ...(computedStats || {})
  };

  merged.totalEmployees = toSafeNumber(merged.totalEmployees, 0);
  merged.completedAppraisals = toSafeNumber(merged.completedAppraisals, 0);
  merged.pendingSelfAssessment = toSafeNumber(merged.pendingSelfAssessment, 0);
  merged.pendingManagerReview = toSafeNumber(merged.pendingManagerReview, 0);
  merged.pendingCalibration = toSafeNumber(merged.pendingCalibration, 0);
  merged.pendingFinalReview = toSafeNumber(merged.pendingFinalReview, 0);
  merged.selfAssessmentSubmitted = toSafeNumber(merged.selfAssessmentSubmitted, 0);
  merged.managerReviewSubmitted = toSafeNumber(merged.managerReviewSubmitted, 0);
  merged.finalized = toSafeNumber(merged.finalized, 0);
  merged.overdueAppraisals = toSafeNumber(merged.overdueAppraisals, 0);
  merged.averageRating = roundTo(merged.averageRating, 2);

  return merged;
}

function buildOverdueExpression(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const safeReference = Number.isNaN(reference.getTime()) ? new Date() : reference;

  return {
    $or: [
      {
        $and: [
          { $in: ['$status', SELF_ASSESSMENT_PENDING_STATUSES] },
          { $ne: ['$deadlines.selfAssessmentDue', null] },
          { $lt: ['$deadlines.selfAssessmentDue', safeReference] }
        ]
      },
      {
        $and: [
          { $in: ['$status', MANAGER_REVIEW_PENDING_STATUSES] },
          { $ne: ['$deadlines.managerReviewDue', null] },
          { $lt: ['$deadlines.managerReviewDue', safeReference] }
        ]
      }
    ]
  };
}

async function buildCycleStatsMap(cycleIds = [], orgId = null, referenceDate = new Date()) {
  if (!Array.isArray(cycleIds) || cycleIds.length === 0) {
    return new Map();
  }

  const normalizedCycleIds = cycleIds.filter(Boolean);
  if (normalizedCycleIds.length === 0) {
    return new Map();
  }

  const matchQuery = {
    cycleId: { $in: normalizedCycleIds }
  };
  if (orgId) {
    matchQuery.organizationId = orgId;
  }

  const overdueExpression = buildOverdueExpression(referenceDate);

  const statsRows = await Appraisal.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$cycleId',
        totalEmployees: { $sum: 1 },
        completedAppraisals: {
          $sum: {
            $cond: [{ $in: ['$status', APPRAISAL_COMPLETED_STATUSES] }, 1, 0]
          }
        },
        pendingSelfAssessment: {
          $sum: {
            $cond: [{ $in: ['$status', SELF_ASSESSMENT_PENDING_STATUSES] }, 1, 0]
          }
        },
        pendingManagerReview: {
          $sum: {
            $cond: [{ $in: ['$status', MANAGER_REVIEW_PENDING_STATUSES] }, 1, 0]
          }
        },
        pendingCalibration: {
          $sum: {
            $cond: [{ $in: ['$status', CALIBRATION_PENDING_STATUSES] }, 1, 0]
          }
        },
        pendingFinalReview: {
          $sum: {
            $cond: [{ $in: ['$status', FINAL_REVIEW_PENDING_STATUSES] }, 1, 0]
          }
        },
        selfAssessmentSubmitted: {
          $sum: {
            $cond: [{ $ne: ['$selfAssessment.submittedAt', null] }, 1, 0]
          }
        },
        managerReviewSubmitted: {
          $sum: {
            $cond: [{ $ne: ['$managerReview.submittedAt', null] }, 1, 0]
          }
        },
        finalized: {
          $sum: {
            $cond: [{ $ne: ['$finalRating.overall', null] }, 1, 0]
          }
        },
        overdueAppraisals: {
          $sum: {
            $cond: [overdueExpression, 1, 0]
          }
        },
        averageRating: { $avg: '$finalRating.overall' }
      }
    }
  ]);

  const statsMap = new Map();
  for (const row of statsRows) {
    const key = String(row._id);
    statsMap.set(key, mergeCycleStats({}, row));
  }

  return statsMap;
}

function normalizeLaunchEmployee(employee = {}) {
  const normalizedTeamIds = Array.from(
    new Set(
      [
        ...(Array.isArray(employee.teamIds) ? employee.teamIds : []),
        employee.teamId
      ]
        .filter(Boolean)
        .map((value) => String(value))
    )
  );

  return {
    userId: employee?.userId ? String(employee.userId) : null,
    name: typeof employee?.name === 'string' ? employee.name.trim() : '',
    email: typeof employee?.email === 'string' ? employee.email.trim() : '',
    department: typeof employee?.department === 'string' ? employee.department.trim() : '',
    departmentId: employee?.departmentId ? String(employee.departmentId) : null,
    departmentName: typeof employee?.departmentName === 'string' ? employee.departmentName.trim() : '',
    jobTitle: typeof employee?.jobTitle === 'string' ? employee.jobTitle.trim() : '',
    teamId: employee?.teamId ? String(employee.teamId) : (normalizedTeamIds[0] || null),
    teamIds: normalizedTeamIds,
    teamName: typeof employee?.teamName === 'string' ? employee.teamName.trim() : '',
    teamRole: typeof employee?.teamRole === 'string' ? employee.teamRole.trim() : '',
    isSelf: Boolean(employee?.isSelf),
    managerId: employee?.managerId ? String(employee.managerId) : null,
    managerName: typeof employee?.managerName === 'string' ? employee.managerName.trim() : '',
    managerEmail: typeof employee?.managerEmail === 'string' ? employee.managerEmail.trim() : ''
  };
}

function normalizeLaunchEmployees(employees = []) {
  return Array.from(
    new Map(
      (Array.isArray(employees) ? employees : [])
        .map((employee) => normalizeLaunchEmployee(employee))
        .filter((employee) => employee.userId || employee.email)
        .map((employee) => {
          const key = employee.userId || normalizeIdentityEmail(employee.email);
          return key ? [key, employee] : null;
        })
        .filter(Boolean)
    ).values()
  );
}

function buildCycleScopeFromEmployees(userRole, employees = []) {
  const targetIds = Array.from(
    new Set(
      employees.flatMap((employee) => {
        const teamIds = Array.isArray(employee.teamIds) ? employee.teamIds : [];
        return [...teamIds, employee.teamId].filter(Boolean).map((value) => String(value));
      })
    )
  );

  if (userRole === 'hr_admin') {
    if (targetIds.length === 1) {
      return { type: 'team', targetIds };
    }

    return { type: 'organization', targetIds: [] };
  }

  return { type: 'team', targetIds };
}

function employeeHasRealManager(employee = {}) {
  const managerId = employee?.managerId ? String(employee.managerId) : null;
  const managerEmail = normalizeIdentityEmail(employee?.managerEmail);
  const employeeId = employee?.userId ? String(employee.userId) : null;
  const employeeEmail = normalizeIdentityEmail(employee?.email);

  if (managerId && employeeId && managerId === employeeId) {
    return false;
  }

  if (managerEmail && employeeEmail && managerEmail === employeeEmail) {
    return false;
  }

  return Boolean(managerId || managerEmail);
}

async function resolveManagerIdentityForLaunch(employee, req) {
  const organizationId = resolveOrganizationId(req);
  const requestedTeamIds = Array.from(
    new Set(
      [
        ...(Array.isArray(employee?.teamIds) ? employee.teamIds : []),
        employee?.teamId
      ]
        .filter(Boolean)
        .map((value) => String(value))
    )
  );

  let managerUserId = employee?.managerId ? String(employee.managerId) : null;
  let managerName = typeof employee?.managerName === 'string' ? employee.managerName.trim() : '';
  let managerEmail = typeof employee?.managerEmail === 'string' ? employee.managerEmail.trim() : '';

  if (!employeeHasRealManager({
    userId: employee?.userId,
    email: employee?.email,
    managerId: managerUserId,
    managerEmail
  })) {
    managerUserId = null;
    managerName = '';
    managerEmail = '';
  }

  if (!managerUserId || !managerEmail || !managerName) {
    const employeeLookupOr = [];
    if (employee?.userId) {
      employeeLookupOr.push({ idpSub: String(employee.userId) });
      if (looksLikeObjectId(String(employee.userId))) {
        employeeLookupOr.push({ _id: String(employee.userId) });
      }
    }
    if (employee?.email) {
      employeeLookupOr.push({ email: employee.email });
    }

    if (employeeLookupOr.length > 0) {
      const employeeUser = await User.findOne({ $or: employeeLookupOr })
        .select('idpSub email idpTeams')
        .lean();

      const employeeTeams = Array.isArray(employeeUser?.idpTeams)
        ? employeeUser.idpTeams
        : [];
      const employeeTeamsInOrg = Array.isArray(employeeUser?.idpTeams)
        ? employeeUser.idpTeams.filter((team) => {
          const teamOrgId = team?.organizationId ? String(team.organizationId) : null;
          return !organizationId || !teamOrgId || teamOrgId === organizationId;
        })
        : [];
      const prioritizedTeams = employeeTeamsInOrg.length > 0 ? employeeTeamsInOrg : employeeTeams;
      const teamWithManager = prioritizedTeams.find((team) => {
        if (!team?.managerId && !team?.managerEmail) return false;
        const teamId = team?.id ? String(team.id) : null;
        if (requestedTeamIds.length === 0) return true;
        return !teamId || requestedTeamIds.includes(teamId);
      }) || prioritizedTeams.find((team) => team?.managerId || team?.managerEmail);

      if (teamWithManager) {
        managerUserId = managerUserId || (teamWithManager.managerId ? String(teamWithManager.managerId) : null);
        managerName = managerName || teamWithManager.managerName || '';
        managerEmail = managerEmail || teamWithManager.managerEmail || '';
      }
    }
  }

  if ((!managerUserId || !managerName) && employee?.userId) {
    const teams = req.session?.user?.idpTeams || req.session?.user?.teams || [];
    const matchedManager = findManagerForEmployee(employee.userId, teams);

    if (matchedManager) {
      managerUserId = managerUserId || (matchedManager.userId ? String(matchedManager.userId) : null);
      managerName = managerName || matchedManager.name || '';
      managerEmail = managerEmail || matchedManager.email || '';
    }
  }

  if (managerUserId && !managerEmail) {
    const managerLookupOr = [{ email: String(managerUserId) }, { idpSub: String(managerUserId) }];
    if (looksLikeObjectId(String(managerUserId))) {
      managerLookupOr.unshift({ _id: String(managerUserId) });
    }

    const managerUser = await User.findOne({ $or: managerLookupOr }).select('email').lean();
    if (managerUser?.email) {
      managerEmail = managerUser.email;
    }
  }

  if (!managerName && managerEmail) {
    managerName = managerEmail.split('@')[0];
  }

  if (!employeeHasRealManager({
    userId: employee?.userId,
    email: employee?.email,
    managerId: managerUserId,
    managerEmail
  }) || !managerUserId || !managerEmail || !managerName) {
    return {
      error: 'This employee cannot be included because no line manager is assigned in the reporting hierarchy.'
    };
  }

  return {
    manager: {
      userId: String(managerUserId),
      name: managerName,
      email: managerEmail
    }
  };
}

async function createAppraisalsForCycle(cycle, employees = [], req) {
  const normalizedEmployees = normalizeLaunchEmployees(employees);
  const createdAppraisals = [];
  const existingAppraisals = [];
  const errors = [];

  const processEmployee = async (employee) => {
    try {
      if (!employee?.userId || !employee?.email || !employee?.name) {
        errors.push({
          userId: employee?.userId || null,
          email: employee?.email || null,
          error: 'Employee userId, name, and email are required.'
        });
        return;
      }

      const existingQuery = { cycleId: cycle._id, organizationId: cycle.organizationId };
      const employeeIdentityMatch = buildEmployeeIdentityMatch(employee);
      if (employeeIdentityMatch?.$or) {
        existingQuery.$or = employeeIdentityMatch.$or;
      } else if (employeeIdentityMatch) {
        Object.assign(existingQuery, employeeIdentityMatch);
      }

      const existing = await Appraisal.findOne(existingQuery);
      if (existing) {
        existingAppraisals.push(existing);
        return;
      }

      const managerIdentity = await resolveManagerIdentityForLaunch(employee, req);
      if (managerIdentity?.error) {
        errors.push({ userId: employee.userId, error: managerIdentity.error });
        return;
      }

      const goalSnapshot = await buildGoalSnapshots({
        organizationId: cycle.organizationId,
        employeeId: employee.userId,
        cycle
      });

      const appraisal = new Appraisal({
        cycleId: cycle._id,
        organizationId: cycle.organizationId,
        goals: goalSnapshot.goalIds,
        goalSnapshots: goalSnapshot.snapshots,
        goalEvidenceSummary: goalSnapshot.evidenceSummary,
        employee: {
          userId: employee.userId,
          name: employee.name,
          email: employee.email,
          department: employee.department || employee.departmentName,
          teamId: employee.teamId || employee.primaryTeamId,
          teamName: employee.teamName || employee.primaryTeamName,
          jobTitle: employee.jobTitle
        },
        manager: managerIdentity.manager,
        status: 'self_assessment_pending',
        deadlines: {
          selfAssessmentDue: cycle.phases?.selfAssessment?.endDate,
          managerReviewDue: cycle.phases?.managerReview?.endDate
        }
      });

      await appraisal.save();
      createdAppraisals.push(appraisal);

      appraisal.addAuditLog('appraisal_created', req.session.user, {
        cycleId: cycle._id,
        cycleName: cycle.name,
        goalSnapshotCount: goalSnapshot.snapshots.length,
        goalSnapshotCutoff: goalSnapshot.evidenceSummary.cutoffAt
      });
      await appraisal.save();

      const employeeRecipient = [{
        userId: appraisal.employee.userId,
        name: appraisal.employee.name,
        email: appraisal.employee.email
      }];
      await recordAppraisalEvent(appraisal, 'appraisal.cycle_launched', req.session.user, {
        recipients: employeeRecipient,
        data: { cycleId: String(cycle._id) }
      });
      await recordAppraisalEvent(appraisal, 'appraisal.self_assessment_due', req.session.user, {
        recipients: employeeRecipient,
        dueAt: appraisal.deadlines?.selfAssessmentDue,
        reminderTargetType: 'appraisal_self_assessment',
        reminderTitle: 'Self-assessment due',
        reminderMessage: 'Your self-assessment needs to be completed.',
        actionKind: 'complete',
        actionLabel: 'Open self-assessment'
      });
    } catch (employeeError) {
      if (employeeError?.code === 11000 && employee?.userId) {
        const replay = await Appraisal.findOne({
          cycleId: cycle._id,
          organizationId: cycle.organizationId,
          'employee.userId': String(employee.userId)
        });
        if (replay) {
          existingAppraisals.push(replay);
          return;
        }
      }
      console.error(`Error creating appraisal for ${employee?.userId || employee?.email}:`, employeeError);
      errors.push({
        userId: employee?.userId || null,
        email: employee?.email || null,
        error: employeeError.message
      });
    }
  }

  // Keep launch work bounded while allowing large organizations to launch in
  // practical time. The tenant-scoped cycle/employee lookup makes retries
  // idempotent without serializing the full launch.
  for (let index = 0; index < normalizedEmployees.length; index += 20) {
    await Promise.all(normalizedEmployees.slice(index, index + 20).map(processEmployee));
  }

  if (createdAppraisals.length > 0) {
    await syncCycleProgress(cycle._id, cycle.organizationId);
  }

  return {
    launched: createdAppraisals.length,
    replayed: existingAppraisals.length,
    errors: errors.length,
    appraisals: createdAppraisals,
    existingAppraisals,
    errorDetails: errors
  };
}

async function ensureDraftDevelopmentPlan(appraisal, cycle, actor) {
  const startDate = new Date();
  const targetDate = new Date(startDate);
  targetDate.setUTCMonth(targetDate.getUTCMonth() + 6);
  const firstReview = new Date(startDate);
  firstReview.setUTCMonth(firstReview.getUTCMonth() + 1);
  const secondReview = new Date(startDate);
  secondReview.setUTCMonth(secondReview.getUTCMonth() + 3);

  const competencyRatings = appraisal.managerReview?.competencyRatings || [];
  const skillDevelopment = competencyRatings
    .filter((rating) => Number.isFinite(Number(rating.managerRating)) && Number(rating.managerRating) < 3)
    .map((rating) => ({
      skillName: rating.competencyName || rating.competencyId || 'Development area',
      currentLevel: 'intermediate',
      targetLevel: 'advanced',
      category: 'soft_skills',
      notes: rating.managerComments || rating.comments || undefined,
      progress: 0
    }));
  const statedGoal = String(appraisal.selfAssessment?.overallSummary?.goals || '').trim();
  const careerGoals = statedGoal
    ? [{ title: statedGoal.slice(0, 160), description: statedGoal, timeframe: '6 months', progress: 0 }]
    : [];

  const plan = await DevelopmentPlan.findOneAndUpdate(
    {
      organizationId: appraisal.organizationId,
      linkedAppraisalId: appraisal._id
    },
    {
      $setOnInsert: {
        userId: appraisal.employee.userId,
        managerId: appraisal.manager.userId,
        organizationId: appraisal.organizationId,
        title: `${cycle?.name || 'Performance'} development plan`,
        description: 'A co-owned draft created from the completed appraisal. Employee and manager should agree owners, milestones, and review dates before activation.',
        startDate,
        targetDate,
        status: 'draft',
        source: 'appraisal',
        linkedAppraisalId: appraisal._id,
        linkedOKRs: (appraisal.goalSnapshots || []).map((snapshot) => snapshot.sourceGoalId),
        careerGoals,
        skillDevelopment,
        learningActivities: [],
        stretchAssignments: [],
        milestones: [],
        reviewDates: [firstReview, secondReview]
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  try {
    const outboxService = require('../services/outboxService');
    if (typeof outboxService.recordEvent === 'function') {
      await outboxService.recordEvent({
        organizationId: appraisal.organizationId,
        type: 'development_plan.draft_created',
        aggregateType: 'DevelopmentPlan',
        aggregateId: String(plan._id),
        actorId: actor?.id || actor?.sub || actor?.userId,
        recipients: [appraisal.employee.userId, appraisal.manager.userId],
        data: {
          employeeId: appraisal.employee.userId,
          appraisalId: String(appraisal._id),
          title: plan.title,
          deepLink: `/development?plan=${plan._id}`
        }
      });
    }
  } catch (eventError) {
    console.warn('Development-plan notification event was not recorded:', eventError.message);
  }

  try {
    const OneOnOne = require('../models/OneOnOne');
    const nextMeeting = await OneOnOne.findOne({
      organizationId: appraisal.organizationId,
      employeeId: appraisal.employee.userId,
      managerId: appraisal.manager.userId,
      status: { $in: ['scheduled', 'rescheduled'] },
      scheduledDate: { $gte: new Date() }
    }).sort({ scheduledDate: 1 });
    if (nextMeeting) {
      const marker = `development-plan:${plan._id}`;
      const alreadyAdded = (nextMeeting.agendaItems || []).some((item) =>
        String(item.description || '').includes(marker)
      );
      if (!alreadyAdded) {
        nextMeeting.agendaItems.push({
          topic: `Review development plan: ${plan.title}`,
          description: `Agree milestones, owners, and review dates. ${marker}`,
          addedBy: 'manager',
          priority: 'high',
          discussed: false
        });
        await nextMeeting.save();
      }
    }
  } catch (agendaError) {
    console.warn('Development-plan agenda item was not added:', agendaError.message);
  }

  return plan;
}

// Configure multer for file uploads
const APPRAISAL_UPLOAD_DIR = path.resolve(__dirname, '../uploads/appraisals');

function removeRejectedUpload(file) {
  if (!file?.path) return;
  const resolvedPath = path.resolve(file.path);
  const expectedPrefix = `${APPRAISAL_UPLOAD_DIR}${path.sep}`;
  if (!resolvedPath.startsWith(expectedPrefix)) return;
  fs.unlink(resolvedPath, () => {});
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(APPRAISAL_UPLOAD_DIR)) {
      fs.mkdirSync(APPRAISAL_UPLOAD_DIR, { recursive: true });
    }
    cb(null, APPRAISAL_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = path.basename(file.originalname || 'document')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(-180);
    cb(null, `${uniqueSuffix}-${safeName || 'document'}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOCX, TXT, PPTX'));
    }
  }
});

// =============================================
// APPRAISAL CYCLE ROUTES (HR Admin)
// =============================================

// Get all cycles for organization (Filtered for Managers)
router.get('/cycles', requireAuth, async (req, res) => {
  try {
    const orgId = resolveOrganizationId(req);
    const { status, year } = req.query;
    const userRole = req.userRole;
    const userId = req.session?.user?.id || req.session?.user?.sub;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }

    const query = { organizationId: orgId };
    if (status) query.status = status;
    if (year) {
      query.periodStart = { $gte: new Date(`${year}-01-01`) };
      query.periodEnd = { $lte: new Date(`${year}-12-31`) };
    }

    // FILTER FOR MANAGERS
    if (isAppraisalManagerRole(userRole) && userRole !== 'hr_admin') {
      const scope = await resolveAppraisalAccessScope(req);
      const managedTeamIds = scope.accessibleTeamIds || [];

      query.$or = [
        { 'createdBy.userId': userId }, // Created by me
        { 'scope.type': 'organization' }, // Org-wide (visible)
        { 'scope.type': 'team', 'scope.targetIds': { $in: managedTeamIds } } // Targeted to my team
      ];
    } else if (userRole !== 'hr_admin') {
      const employeeFilters = requesterEmployeeIdentityFilters(req);
      const relatedAppraisals = employeeFilters.length > 0
        ? await Appraisal.find({ organizationId: orgId, $or: employeeFilters }).select('cycleId').lean()
        : [];
      query.$or = [
        { 'scope.type': 'organization' },
        { _id: { $in: relatedAppraisals.map((appraisal) => appraisal.cycleId).filter(Boolean) } }
      ];
    }

    const cycles = await AppraisalCycle.find(query).sort({ createdAt: -1 }).lean();
    const cycleStatsMap = await buildCycleStatsMap(cycles.map((cycle) => cycle._id), orgId);
    const enrichedCycles = cycles.map((cycle) => ({
      ...cycle,
      stats: mergeCycleStats(cycle.stats, cycleStatsMap.get(String(cycle._id)))
    }));

    res.json({ success: true, data: enrichedCycles });
  } catch (error) {
    console.error('Get cycles error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisal cycles' });
  }
});

// Create new cycle (HR Admin or Manager)
router.post('/cycles', requireAuth, requireManager, async (req, res) => {
  try {
    const orgId = resolveOrganizationId(req);
    const userId = req.session?.user?.id || req.session?.user?.sub;
    const userName = req.session?.user?.name;
    const userRole = req.userRole;
    const normalizedEmployees = normalizeLaunchEmployees(req.body?.employees);
    const shouldLaunchImmediately = Boolean(req.body?.launchNow || normalizedEmployees.length > 0);
    const derivedScope = shouldLaunchImmediately ? buildCycleScopeFromEmployees(userRole, normalizedEmployees) : null;
    const requestedScope = req.body?.scope || derivedScope;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }

    if (shouldLaunchImmediately && normalizedEmployees.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Select at least one employee to launch the cycle immediately.'
      });
    }

    const configurationErrors = validateCycleConfiguration(req.body);
    if (configurationErrors.length > 0) {
      return res.status(400).json({ success: false, error: configurationErrors[0], errors: configurationErrors });
    }

    // SCOPE VALIDATION
    // If not HR Admin, enforce team scope
    if (isAppraisalManagerRole(userRole) && userRole !== 'hr_admin') {
      if (!requestedScope || requestedScope.type !== 'team') {
        return res.status(403).json({
          success: false,
          error: 'Managers can only create appraisal cycles for their teams'
        });
      }

      // Verify managed teams (including hierarchy descendants)
      const accessScope = await resolveAppraisalAccessScope(req);
      const managedTeamIds = accessScope.accessibleTeamIds || [];

      const targetIds = requestedScope.targetIds || [];
      const invalidTargets = targetIds.filter(id => !managedTeamIds.includes(id));

      if (invalidTargets.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'You can only create cycles for teams you manage'
        });
      }
    }

    const cycle = new AppraisalCycle({
      ...req.body,
      scope: requestedScope || req.body?.scope,
      organizationId: orgId,
      createdBy: { userId, name: userName, role: userRole }
    });

    await cycle.save();

    if (!shouldLaunchImmediately) {
      return res.status(201).json({ success: true, data: cycle });
    }

    const launchSummary = await createAppraisalsForCycle(cycle, normalizedEmployees, req);

    if (launchSummary.launched <= 0 && launchSummary.replayed <= 0) {
      await AppraisalCycle.findOneAndDelete({ _id: cycle._id, organizationId: orgId });
      const firstError = Array.isArray(launchSummary.errorDetails) && launchSummary.errorDetails.length > 0
        ? launchSummary.errorDetails[0]?.error
        : null;

      return res.status(400).json({
        success: false,
        error: firstError || 'Failed to launch the cycle for the selected employees.',
        data: launchSummary
      });
    }

    const refreshedCycle = await AppraisalCycle.findOne({ _id: cycle._id, organizationId: orgId }).lean();
    return res.status(201).json({
      success: true,
      data: {
        cycle: refreshedCycle,
        launchSummary
      },
      message: `Cycle created and launched for ${launchSummary.launched} employee${launchSummary.launched === 1 ? '' : 's'}.`
    });
  } catch (error) {
    console.error('Create cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to create appraisal cycle' });
  }
});

// Get cycle by ID
router.get('/cycles/:cycleId', requireAuth, async (req, res) => {
  try {
    if (req.params.cycleId === 'new') {
      return res.status(400).json({ success: false, error: 'Invalid cycle ID' });
    }
    const orgId = resolveOrganizationId(req);
    const cycle = await AppraisalCycle.findOne(tenantCycleIdFilter(req, req.params.cycleId)).lean();
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    if (!(await canViewAppraisalCycle(req, cycle))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const cycleStatsMap = await buildCycleStatsMap([cycle._id], orgId);
    const enrichedCycle = {
      ...cycle,
      stats: mergeCycleStats(cycle.stats, cycleStatsMap.get(String(cycle._id)))
    };

    res.json({ success: true, data: enrichedCycle });
  } catch (error) {
    console.error('Get cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cycle' });
  }
});

// Update cycle (HR Admin or Owner Manager)
router.put('/cycles/:cycleId', requireAuth, requireManager, async (req, res) => {
  try {
    const { name, description, periodStart, periodEnd, phases, okrWeight, settings, cycleType, scope } = req.body;

    const orgId = resolveOrganizationId(req);
    const cycle = await AppraisalCycle.findOne({ _id: req.params.cycleId, organizationId: orgId });
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    // Permission Check
    const requesterIds = getRequesterIdentity(req).userIds;
    const isOwner = requesterIds.includes(String(cycle.createdBy?.userId || ''));
    if (req.userRole !== 'hr_admin' && !isOwner) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // If Manager, prevent changing scope to organization
    if (req.userRole !== 'hr_admin' && isAppraisalManagerRole(req.userRole) && scope && scope.type === 'organization') {
      return res.status(403).json({ success: false, error: 'Managers cannot set organization scope' });
    }

    if (cycle.status === 'completed' || cycle.status === 'cancelled') {
      return res.status(400).json({ success: false, error: 'Cannot update completed or cancelled cycles' });
    }

    const proposedConfiguration = {
      periodStart: periodStart || cycle.periodStart,
      periodEnd: periodEnd || cycle.periodEnd,
      phases: phases || cycle.phases,
      okrWeight: okrWeight !== undefined ? okrWeight : cycle.okrWeight
    };
    const configurationErrors = validateCycleConfiguration(proposedConfiguration);
    if (configurationErrors.length > 0) {
      return res.status(400).json({ success: false, error: configurationErrors[0], errors: configurationErrors });
    }

    // Update fields
    if (name) cycle.name = name;
    if (description !== undefined) cycle.description = description;
    if (cycleType) cycle.cycleType = cycleType;
    if (periodStart) cycle.periodStart = periodStart;
    if (periodEnd) cycle.periodEnd = periodEnd;
    if (okrWeight !== undefined) cycle.okrWeight = okrWeight;

    // Update Scope
    if (scope) {
      // Validate again if manager
      if (req.userRole !== 'hr_admin' && isAppraisalManagerRole(req.userRole)) {
        if (scope.type !== 'team') {
          return res.status(403).json({ success: false, error: 'Managers can only set team scope' });
        }
        const accessScope = await resolveAppraisalAccessScope(req);
        const managedTeamIds = accessScope.accessibleTeamIds || [];
        const targetIds = scope.targetIds || [];
        const invalidTargets = targetIds.filter(id => !managedTeamIds.includes(id));
        if (invalidTargets.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'You can only set cycle scope for teams in your hierarchy'
          });
        }
      }
      cycle.scope = scope;
    }

    // Update settings
    if (settings) {
      cycle.settings = { ...cycle.settings, ...settings };
    }

    // Update phases - preserve current phase status
    if (phases) {
      Object.keys(phases).forEach(key => {
        if (cycle.phases[key]) {
          cycle.phases[key].startDate = phases[key].startDate;
          cycle.phases[key].endDate = phases[key].endDate;
        }
      });
    }

    cycle.updatedBy = {
      userId: req.session.user.id || req.session.user.sub,
      name: req.session.user.name,
      email: req.session.user.email
    };

    await cycle.save();
    res.json({ success: true, data: cycle });
  } catch (error) {
    console.error('Update cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to update cycle' });
  }
});

// Update cycle phase (HR Admin)
router.patch('/cycles/:cycleId/phase', requireAuth, requireHRAdmin, async (req, res) => {
  res.status(409).json({
    success: false,
    error: 'Manual phase updates are disabled. Cycle phase now advances automatically from appraisal submissions.'
  });
});

// =============================================
// LAUNCH CYCLE / CREATE APPRAISALS FOR EMPLOYEES
// =============================================

/**
 * POST /api/appraisals/cycles/:cycleId/launch
 * HR Admin launches a cycle - creates appraisals for specified employees
 * This is the starting point of the appraisal flow!
 */
router.post('/cycles/:cycleId/launch', requireAuth, requireManager, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findOne({ _id: req.params.cycleId, organizationId: resolveOrganizationId(req) });
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    if (!(await canManageAppraisalCycle(req, cycle))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const employees = normalizeLaunchEmployees(req.body?.employees);

    // Permission check for non-HR appraisers (line managers and team leads).
    if (req.userRole !== 'hr_admin' && isAppraisalManagerRole(req.userRole)) {
      if (employees.length === 0) {
        return res.status(400).json({ error: 'Employee list required' });
      }

      const inaccessibleEmployees = [];
      for (const employee of employees) {
        const canAppraise = await canAppraiseEmployee(req, {
          targetUserId: employee.userId,
          targetEmail: employee.email
        });
        if (!canAppraise) {
          inaccessibleEmployees.push(employee);
        }
      }

      if (inaccessibleEmployees.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'You can only launch appraisals for employees in your team scope and sub-team hierarchy.',
          inaccessibleEmployees: inaccessibleEmployees.map((employee) => ({
            userId: employee.userId,
            email: employee.email
          }))
        });
      }
    }

    if (cycle.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Cannot launch a completed cycle' });
    }

    if (employees.length === 0) {
      return res.status(400).json({ success: false, error: 'Employee list required to launch cycle' });
    }

    const launchSummary = await createAppraisalsForCycle(cycle, employees, req);

    if (launchSummary.launched <= 0 && launchSummary.replayed <= 0) {
      const firstError = Array.isArray(launchSummary.errorDetails) && launchSummary.errorDetails.length > 0
        ? launchSummary.errorDetails[0]?.error
        : null;

      return res.status(400).json({
        success: false,
        error: firstError || 'Failed to launch the cycle for the selected employees.',
        data: launchSummary
      });
    }

    res.json({
      success: true,
      data: launchSummary,
      message: `Created ${launchSummary.launched} appraisals${launchSummary.replayed > 0 ? `, replayed ${launchSummary.replayed} existing` : ''}${launchSummary.errors > 0 ? `, ${launchSummary.errors} failed` : ''}`
    });
  } catch (error) {
    console.error('Launch cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to launch cycle' });
  }
});

/**
 * POST /api/appraisals/cycles/:cycleId/launch-for-team
 * Manager can launch appraisals for their direct reports in an active cycle
 */
router.post('/cycles/:cycleId/launch-for-team', requireAuth, requireManager, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findOne({ _id: req.params.cycleId, organizationId: resolveOrganizationId(req) });
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    if (!(await canManageAppraisalCycle(req, cycle))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (cycle.status !== 'active' && cycle.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Cycle is not active' });
    }

    const managerId = req.session?.user?.id || req.session?.user?.sub;
    const managerName = req.session?.user?.name;
    const managerEmail = req.session?.user?.email;

    const { employees } = req.body;
    // employees: array of { userId, name, email, department?, jobTitle? }

    if (!employees || !Array.isArray(employees)) {
      return res.status(400).json({ success: false, error: 'Employee list required' });
    }

    const createdAppraisals = [];
    const errors = [];

    for (const emp of employees) {
      try {
        // Enforce hierarchy-aware appraisal scope
        const canAppraise = await canAppraiseEmployee(req, {
          targetUserId: emp.userId,
          targetEmail: emp.email
        });
        if (!canAppraise) {
          throw new Error('Access denied: employee is outside your appraisal scope');
        }

        const existing = await Appraisal.findOne({
          cycleId: cycle._id,
          organizationId: cycle.organizationId,
          ...(buildEmployeeIdentityMatch(emp) || { 'employee.userId': emp.userId })
        });

        if (existing) {
          errors.push({ userId: emp.userId, error: 'Appraisal already exists' });
        return;
        }

        const goalSnapshot = await buildGoalSnapshots({
          organizationId: cycle.organizationId,
          employeeId: emp.userId,
          cycle
        });

        const appraisal = new Appraisal({
          cycleId: cycle._id,
          organizationId: cycle.organizationId,
          goals: goalSnapshot.goalIds,
          goalSnapshots: goalSnapshot.snapshots,
          goalEvidenceSummary: goalSnapshot.evidenceSummary,
          employee: {
            userId: emp.userId,
            name: emp.name,
            email: emp.email,
            department: emp.department,
            jobTitle: emp.jobTitle
          },
          manager: {
            userId: managerId,
            name: managerName,
            email: managerEmail
          },
          // Skip goal setting, start directly at self-assessment
          status: 'self_assessment_pending',
          deadlines: {
            selfAssessmentDue: cycle.phases?.selfAssessment?.endDate,
            managerReviewDue: cycle.phases?.managerReview?.endDate
          }
        });

        await appraisal.save();
        appraisal.addAuditLog('appraisal_created', req.session.user, {
          cycleId: cycle._id,
          cycleName: cycle.name,
          goalSnapshotCount: goalSnapshot.snapshots.length,
          goalSnapshotCutoff: goalSnapshot.evidenceSummary.cutoffAt
        });
        await appraisal.save();
        createdAppraisals.push(appraisal);

      } catch (empError) {
        errors.push({ userId: emp.userId, error: empError.message });
    }
  };

    res.json({
      success: true,
      data: {
        launched: createdAppraisals.length,
        errors: errors.length,
        appraisals: createdAppraisals
      }
    });
  } catch (error) {
    console.error('Launch for team error:', error);
    res.status(500).json({ success: false, error: 'Failed to launch appraisals for team' });
  }
});

/**
 * GET /api/appraisals/cycles/:cycleId/summary
 * Get summary of appraisals in a cycle (HR Admin view)
 */
router.get('/cycles/:cycleId/summary', requireAuth, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findOne({ _id: req.params.cycleId, organizationId: resolveOrganizationId(req) });
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    if (!(await canManageAppraisalCycle(req, cycle))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const appraisalQuery = {
      cycleId: cycle._id,
      organizationId: cycle.organizationId
    };
    if (req.userRole !== 'hr_admin') {
      const requester = getRequesterIdentity(req);
      const scope = await resolveAppraisalAccessScope(req);
      const relationshipFilters = buildManagerIdentityFilters(requester);
      if (scope.directReportIds.length > 0) {
        relationshipFilters.push({ 'employee.userId': { $in: scope.directReportIds } });
      }
      (scope.directReportEmails || [])
        .map(normalizeIdentityEmail)
        .filter(Boolean)
        .forEach((email) => relationshipFilters.push({
          'employee.email': { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
        }));
      if (relationshipFilters.length === 0) {
        appraisalQuery._id = { $in: [] };
      } else {
        appraisalQuery.$or = relationshipFilters;
      }
    }

    const appraisals = await Appraisal.find(appraisalQuery)
      .select('employee manager status selfAssessment.submittedAt managerReview.submittedAt finalRating');

    const summary = {
      total: appraisals.length,
      byStatus: {},
      selfAssessmentCompleted: 0,
      managerReviewCompleted: 0,
      finalized: 0,
      averageRating: null
    };

    let ratingSum = 0;
    let ratingCount = 0;

    appraisals.forEach(a => {
      summary.byStatus[a.status] = (summary.byStatus[a.status] || 0) + 1;

      if (a.selfAssessment?.submittedAt) summary.selfAssessmentCompleted++;
      if (a.managerReview?.submittedAt) summary.managerReviewCompleted++;
      if (a.finalRating?.overall) {
        summary.finalized++;
        ratingSum += a.finalRating.overall;
        ratingCount++;
      }
    });

    if (ratingCount > 0) {
      summary.averageRating = (ratingSum / ratingCount).toFixed(2);
    }

    res.json({
      success: true,
      data: {
        cycle,
        summary,
        appraisals: req.userRole === 'hr_admin' ? appraisals : undefined
      }
    });
  } catch (error) {
    console.error('Get cycle summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to get cycle summary' });
  }
});

/**
 * GET /api/appraisals/admin/analytics
 * Organization-wide appraisal analytics for HR Admin dashboard
 */
router.get('/admin/analytics', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const orgId = resolveOrganizationId(req);
    if (!orgId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const cycleQuery = { organizationId: String(orgId) };
    const appraisalQuery = { organizationId: String(orgId) };
    const analyticsComputedAt = new Date();
    const overdueExpression = buildOverdueExpression(analyticsComputedAt);

    const trendStart = new Date();
    trendStart.setMonth(trendStart.getMonth() - 11);
    trendStart.setDate(1);
    trendStart.setHours(0, 0, 0, 0);

    const [
      cycles,
      totalAppraisals,
      statusBreakdownRows,
      workflowRows,
      ratingRows,
      ratingDistributionRows,
      ratingGapRows,
      teamRows,
      trendRows,
      uniqueEmployeesRows
    ] = await Promise.all([
      AppraisalCycle.find(cycleQuery)
        .select('_id name status currentPhase periodStart periodEnd stats')
        .sort({ createdAt: -1 })
        .lean(),
      Appraisal.countDocuments(appraisalQuery),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        {
          $group: {
            _id: null,
            selfSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$selfAssessment.submittedAt', null] }, 1, 0]
              }
            },
            managerSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$managerReview.submittedAt', null] }, 1, 0]
              }
            },
            finalized: {
              $sum: {
                $cond: [{ $ne: ['$finalRating.overall', null] }, 1, 0]
              }
            },
            completed: {
              $sum: {
                $cond: [{ $in: ['$status', APPRAISAL_COMPLETED_STATUSES] }, 1, 0]
              }
            },
            overdue: {
              $sum: {
                $cond: [overdueExpression, 1, 0]
              }
            }
          }
        }
      ]),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        {
          $group: {
            _id: null,
            avgSelfRating: { $avg: '$selfAssessment.overallSelfRating' },
            avgManagerRating: { $avg: '$managerReview.overallManagerRating' },
            avgFinalRating: { $avg: '$finalRating.overall' }
          }
        }
      ]),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        {
          $project: {
            ratingValue: {
              $ifNull: [
                '$finalRating.overall',
                {
                  $ifNull: [
                    '$managerReview.overallManagerRating',
                    '$selfAssessment.overallSelfRating'
                  ]
                }
              ]
            }
          }
        },
        { $match: { ratingValue: { $ne: null } } },
        {
          $group: {
            _id: { $round: ['$ratingValue', 0] },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      Appraisal.aggregate([
        {
          $match: {
            ...appraisalQuery,
            'selfAssessment.overallSelfRating': { $ne: null },
            'managerReview.overallManagerRating': { $ne: null }
          }
        },
        {
          $project: {
            gap: {
              $subtract: [
                '$selfAssessment.overallSelfRating',
                '$managerReview.overallManagerRating'
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgGap: { $avg: '$gap' },
            highDisagreements: {
              $sum: {
                $cond: [{ $gte: [{ $abs: '$gap' }, 2] }, 1, 0]
              }
            }
          }
        }
      ]),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        {
          $group: {
            _id: {
              $ifNull: ['$employee.teamName', 'Unassigned']
            },
            total: { $sum: 1 },
            completed: {
              $sum: {
                $cond: [{ $in: ['$status', APPRAISAL_COMPLETED_STATUSES] }, 1, 0]
              }
            },
            selfSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$selfAssessment.submittedAt', null] }, 1, 0]
              }
            },
            managerSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$managerReview.submittedAt', null] }, 1, 0]
              }
            },
            overdue: {
              $sum: {
                $cond: [overdueExpression, 1, 0]
              }
            },
            avgFinalRating: { $avg: '$finalRating.overall' }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 10 }
      ]),
      Appraisal.aggregate([
        {
          $match: {
            ...appraisalQuery,
            createdAt: { $gte: trendStart }
          }
        },
        {
          $group: {
            _id: {
              month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
            },
            launched: { $sum: 1 },
            selfSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$selfAssessment.submittedAt', null] }, 1, 0]
              }
            },
            managerSubmitted: {
              $sum: {
                $cond: [{ $ne: ['$managerReview.submittedAt', null] }, 1, 0]
              }
            },
            completed: {
              $sum: {
                $cond: [{ $in: ['$status', APPRAISAL_COMPLETED_STATUSES] }, 1, 0]
              }
            }
          }
        },
        { $sort: { '_id.month': 1 } }
      ]),
      Appraisal.aggregate([
        { $match: appraisalQuery },
        {
          $project: {
            employeeKey: {
              $ifNull: ['$employee.userId', '$employee.email']
            }
          }
        },
        { $group: { _id: '$employeeKey' } },
        { $count: 'count' }
      ])
    ]);

    const cycleStatsMap = await buildCycleStatsMap(cycles.map((cycle) => cycle._id), orgId, analyticsComputedAt);

    const workflow = workflowRows[0] || {
      selfSubmitted: 0,
      managerSubmitted: 0,
      finalized: 0,
      completed: 0,
      overdue: 0
    };

    const ratings = ratingRows[0] || {
      avgSelfRating: null,
      avgManagerRating: null,
      avgFinalRating: null
    };
    const ratingGap = ratingGapRows[0] || {
      avgGap: null,
      highDisagreements: 0
    };

    const ratingDistributionMap = new Map();
    for (const row of ratingDistributionRows) {
      ratingDistributionMap.set(Number(row._id), row.count || 0);
    }
    const ratingDistribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: ratingDistributionMap.get(rating) || 0
    }));

    const phaseBreakdownMap = cycles.reduce((acc, cycle) => {
      const phase = cycle.currentPhase || 'draft';
      acc[phase] = (acc[phase] || 0) + 1;
      return acc;
    }, {});
    const phaseBreakdown = Object.entries(phaseBreakdownMap).map(([phase, count]) => ({ phase, count }));

    const cycleHealth = cycles.map((cycle) => {
      const stats = mergeCycleStats(cycle.stats, cycleStatsMap.get(String(cycle._id)));
      const completionRate = stats.totalEmployees > 0
        ? roundTo((stats.completedAppraisals / stats.totalEmployees) * 100, 1)
        : 0;
      const daysRemaining = cycle.periodEnd
        ? Math.ceil((new Date(cycle.periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        cycleId: cycle._id,
        name: cycle.name,
        status: cycle.status,
        currentPhase: cycle.currentPhase,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        daysRemaining,
        completionRate,
        stats
      };
    });

    const teamInsights = teamRows.map((team) => ({
      teamName: team._id || 'Unassigned',
      total: team.total || 0,
      completed: team.completed || 0,
      selfSubmitted: team.selfSubmitted || 0,
      managerSubmitted: team.managerSubmitted || 0,
      overdue: team.overdue || 0,
      completionRate: team.total > 0 ? roundTo((team.completed / team.total) * 100, 1) : 0,
      avgFinalRating: roundTo(team.avgFinalRating, 2)
    }));

    const trendMap = new Map(trendRows.map((row) => [row._id.month, row]));
    const monthlyTrend = [];
    const iter = new Date(trendStart);
    const endMonth = new Date();
    endMonth.setDate(1);
    endMonth.setHours(0, 0, 0, 0);
    while (iter <= endMonth) {
      const monthKey = iter.toISOString().slice(0, 7);
      const row = trendMap.get(monthKey);
      monthlyTrend.push({
        month: monthKey,
        launched: row?.launched || 0,
        selfSubmitted: row?.selfSubmitted || 0,
        managerSubmitted: row?.managerSubmitted || 0,
        completed: row?.completed || 0
      });
      iter.setMonth(iter.getMonth() + 1);
    }

    const uniqueEmployees = uniqueEmployeesRows[0]?.count || 0;
    const statusBreakdown = statusBreakdownRows.map((row) => ({
      status: row._id,
      count: row.count
    }));

    const statusBreakdownTotal = statusBreakdown.reduce((sum, row) => sum + (row.count || 0), 0);
    const completedFromStatusBreakdown = statusBreakdown.reduce((sum, row) => (
      APPRAISAL_COMPLETED_STATUSES.includes(row.status) ? sum + (row.count || 0) : sum
    ), 0);
    const teamTotalAppraisals = teamInsights.reduce((sum, team) => sum + (team.total || 0), 0);
    const cycleTotalAppraisals = cycleHealth.reduce((sum, cycle) => sum + (cycle?.stats?.totalEmployees || 0), 0);
    const workflowCompleted = workflow.completed || 0;

    const auditChecks = {
      statusBreakdownMatchesTotal: statusBreakdownTotal === totalAppraisals,
      completedMatchesStatusBreakdown: workflowCompleted === completedFromStatusBreakdown,
      teamTotalsMatchOverall: teamTotalAppraisals === totalAppraisals,
      cycleTotalsMatchOverall: cycleTotalAppraisals === totalAppraisals
    };

    const discrepancies = [];
    if (!auditChecks.statusBreakdownMatchesTotal) {
      discrepancies.push(`Status breakdown total (${statusBreakdownTotal}) does not match appraisals total (${totalAppraisals}).`);
    }
    if (!auditChecks.completedMatchesStatusBreakdown) {
      discrepancies.push(`Completed appraisals in workflow (${workflowCompleted}) does not match status breakdown (${completedFromStatusBreakdown}).`);
    }
    if (!auditChecks.teamTotalsMatchOverall) {
      discrepancies.push(`Team total appraisals (${teamTotalAppraisals}) does not match appraisals total (${totalAppraisals}).`);
    }
    if (!auditChecks.cycleTotalsMatchOverall) {
      discrepancies.push(`Cycle total appraisals (${cycleTotalAppraisals}) does not match appraisals total (${totalAppraisals}).`);
    }

    const analyticsAudit = {
      checkedAt: analyticsComputedAt.toISOString(),
      overdueReferenceDate: analyticsComputedAt.toISOString(),
      checks: auditChecks,
      discrepancies
    };

    const cycleCounts = cycles.reduce((acc, cycle) => {
      acc.total += 1;
      if (cycle.status === 'active') acc.active += 1;
      else if (cycle.status === 'draft') acc.draft += 1;
      else if (cycle.status === 'completed') acc.completed += 1;
      else if (cycle.status === 'cancelled') acc.cancelled += 1;
      return acc;
    }, { total: 0, active: 0, draft: 0, completed: 0, cancelled: 0 });

    const overview = {
      totalCycles: cycleCounts.total,
      activeCycles: cycleCounts.active,
      draftCycles: cycleCounts.draft,
      completedCycles: cycleCounts.completed,
      cancelledCycles: cycleCounts.cancelled,
      totalAppraisals,
      uniqueEmployees,
      completedAppraisals: workflow.completed || 0,
      overdueAppraisals: workflow.overdue || 0,
      completionRate: totalAppraisals > 0
        ? roundTo(((workflow.completed || 0) / totalAppraisals) * 100, 1)
        : 0
    };

    res.json({
      success: true,
      data: {
        overview,
        workflow: {
          selfSubmitted: workflow.selfSubmitted || 0,
          managerSubmitted: workflow.managerSubmitted || 0,
          finalized: workflow.finalized || 0,
          completed: workflow.completed || 0,
          overdue: workflow.overdue || 0,
          selfCompletionRate: totalAppraisals > 0 ? roundTo(((workflow.selfSubmitted || 0) / totalAppraisals) * 100, 1) : 0,
          managerCompletionRate: totalAppraisals > 0 ? roundTo(((workflow.managerSubmitted || 0) / totalAppraisals) * 100, 1) : 0,
          finalizationRate: totalAppraisals > 0 ? roundTo(((workflow.finalized || 0) / totalAppraisals) * 100, 1) : 0,
          statusBreakdown,
          phaseBreakdown
        },
        ratings: {
          averageSelfRating: roundTo(ratings.avgSelfRating, 2),
          averageManagerRating: roundTo(ratings.avgManagerRating, 2),
          averageFinalRating: roundTo(ratings.avgFinalRating, 2),
          averageGap: roundTo(ratingGap.avgGap, 2),
          highDisagreements: ratingGap.highDisagreements || 0,
          distribution: ratingDistribution
        },
        cycleHealth,
        teamInsights,
        monthlyTrend,
        audit: analyticsAudit
      }
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load admin analytics' });
  }
});

// =============================================
// APPRAISAL ROUTES
// =============================================

// Get my appraisals (as employee)
router.get('/my', requireAuth, async (req, res) => {
  try {
    const orgId = resolveOrganizationId(req);
    if (!orgId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const { cycleId, status } = req.query;

    const identityFilters = requesterEmployeeIdentityFilters(req);

    if (identityFilters.length === 0) {
      return res.status(401).json({ success: false, error: 'Unable to resolve user identity' });
    }

    // Query by user IDs and a case-insensitive email fallback to handle ID/email mismatches.
    const query = { organizationId: String(orgId), $or: identityFilters };
    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;

    const appraisals = await Appraisal.find(query)
      .populate(tenantCyclePopulate(req, 'name periodStart periodEnd currentPhase status'))
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals });
  } catch (error) {
    console.error('Get my appraisals error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisals' });
  }
});

// Get team appraisals (as manager) - filtered by currentTeam if set
router.get('/team', requireAuth, requireManager, async (req, res) => {
  try {
    const { userIds, userEmail } = getRequesterIdentity(req);
    const orgId = resolveOrganizationId(req);
    if (!orgId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const { cycleId, status } = req.query;

    const query = { organizationId: String(orgId) };
    if (req.userRole !== 'hr_admin') {
      const scope = await resolveAppraisalAccessScope(req);
      const orFilters = buildManagerIdentityFilters({ userIds, userEmail });
      if (scope.directReportIds.length > 0) {
        orFilters.push({ 'employee.userId': { $in: scope.directReportIds } });
      }
      if (scope.directReportEmails.length > 0) {
        scope.directReportEmails
          .map((email) => normalizeIdentityEmail(email))
          .filter(Boolean)
          .forEach((email) => {
            orFilters.push({ 'employee.email': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
          });
      }

      if (orFilters.length === 0) {
        return res.json({ success: true, data: [] });
      }

      query.$or = orFilters;
    }

    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;

    const appraisals = await Appraisal.find(query)
      .populate(tenantCyclePopulate(req, 'name periodStart periodEnd currentPhase status'))
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals });
  } catch (error) {
    console.error('Get team appraisals error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch team appraisals' });
  }
});

// Get in-portal notifications for managers
router.get('/notifications/manager', requireAuth, requireManager, async (req, res) => {
  try {
    const { userIds, userEmail } = getRequesterIdentity(req);
    const orgId = resolveOrganizationId(req);
    if (!orgId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const unreadOnly = req.query.unreadOnly !== 'false';
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const query = { organizationId: String(orgId) };

    if (req.userRole !== 'hr_admin') {
      const scope = await resolveAppraisalAccessScope(req);
      const orFilters = buildManagerIdentityFilters({ userIds, userEmail });

      if (scope.directReportIds.length > 0) {
        orFilters.push({ 'employee.userId': { $in: scope.directReportIds } });
      }
      if (scope.directReportEmails.length > 0) {
        scope.directReportEmails
          .map((email) => normalizeIdentityEmail(email))
          .filter(Boolean)
          .forEach((email) => {
            orFilters.push({ 'employee.email': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
          });
      }

      if (orFilters.length === 0) {
        return res.json({
          success: true,
          data: {
            notifications: [],
            unreadCount: 0
          }
        });
      }

      query.$or = orFilters;
    }

    query['notifications.0'] = { $exists: true };

    const appraisals = await Appraisal.find(query)
      .select('_id cycleId status employee manager notifications updatedAt')
      .populate(tenantCyclePopulate(req, 'name'))
      .sort({ updatedAt: -1 })
      .limit(300);

    const supportedTypes = new Set(['self_assessment_submitted', 'manager_review_requested']);
    const notifications = [];

    appraisals.forEach((appraisal) => {
      const entries = Array.isArray(appraisal.notifications) ? appraisal.notifications : [];
      entries.forEach((notification) => {
        if (!notification || !supportedTypes.has(notification.type)) return;
        if (unreadOnly && notification.readAt) return;

        notifications.push({
          appraisalId: appraisal._id,
          cycleName: appraisal.cycleId?.name || 'Performance Review',
          appraisalStatus: appraisal.status,
          employee: appraisal.employee,
          manager: appraisal.manager,
          type: notification.type,
          message: notification.message,
          sentAt: notification.sentAt,
          readAt: notification.readAt
        });
      });
    });

    notifications.sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());

    res.json({
      success: true,
      data: {
        notifications: notifications.slice(0, limit),
        unreadCount: notifications.filter((item) => !item.readAt).length
      }
    });
  } catch (error) {
    console.error('Get manager notifications error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch manager notifications' });
  }
});

// Keep static routes ahead of /:appraisalId routes so future dynamic handlers
// cannot reinterpret "ai-suggest" as an appraisal identifier.
router.post('/ai-suggest', requireAuth, async (req, res) => {
  try {
    const { field, context, existingContent, employeeName } = req.body;
    const suggestion = await appraisalAIService.generateSelfAssessmentSuggestion(
      field,
      context,
      existingContent,
      { employeeName }
    );
    return res.json({ success: true, suggestion });
  } catch (error) {
    console.error('AI suggest error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate suggestion' });
  }
});

// Rebuild immutable goal evidence only while the appraisal is still in its
// pre-assessment window. Once self-assessment opens, historical membership is
// deliberately locked.
router.post('/:appraisalId/goal-snapshots/rebuild', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'An audit reason of at least 10 characters is required'
      });
    }

    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    const organizationId = resolveOrganizationId(req);
    if (!organizationId || String(appraisal.organizationId) !== String(organizationId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const cycle = appraisal.cycleId;
    const selfAssessmentStartsAt = cycle?.phases?.selfAssessment?.startDate
      ? new Date(cycle.phases.selfAssessment.startDate)
      : null;
    const preAssessmentStatus = ['not_started', 'goal_setting', 'goal_approval_pending'].includes(appraisal.status);
    const pendingBeforeOpening = appraisal.status === 'self_assessment_pending' &&
      selfAssessmentStartsAt && selfAssessmentStartsAt.getTime() > Date.now();
    const hasAssessmentActivity = Boolean(
      appraisal.selfAssessment?.lastSavedAt || appraisal.selfAssessment?.submittedAt
    );

    if ((!preAssessmentStatus && !pendingBeforeOpening) || hasAssessmentActivity) {
      return res.status(409).json({
        success: false,
        error: 'Goal snapshots are locked after self-assessment opens'
      });
    }

    const previousGoalIds = (appraisal.goalSnapshots || []).map((snapshot) => String(snapshot.sourceGoalId));
    const snapshot = await buildGoalSnapshots({
      organizationId: appraisal.organizationId,
      employeeId: appraisal.employee.userId,
      cycle
    });
    appraisal.goals = snapshot.goalIds;
    appraisal.goalSnapshots = snapshot.snapshots;
    appraisal.goalEvidenceSummary = snapshot.evidenceSummary;
    appraisal.addAuditLog('goal_snapshots_rebuilt', req.session.user, {
      reason,
      previousGoalIds,
      newGoalIds: snapshot.goalIds.map(String),
      cutoffAt: snapshot.evidenceSummary.cutoffAt
    });
    await appraisal.save();

    res.json({
      success: true,
      data: {
        goalSnapshots: appraisal.goalSnapshots,
        goalEvidenceSummary: appraisal.goalEvidenceSummary
      }
    });
  } catch (error) {
    console.error('Rebuild goal snapshots error:', error);
    res.status(500).json({ success: false, error: 'Failed to rebuild goal snapshots' });
  }
});

router.get('/:appraisalId/attendance-context', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req, 'periodStart periodEnd name'));
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const hasManagerAccess = await canManageAppraisal(req, appraisal);
    const isHR = req.userRole === 'hr_admin';
    if (!isEmployee && !hasManagerAccess && !isHR) return res.status(403).json({ success: false, error: 'Access denied' });
    const viewerId = req.session?.user?.id || req.session?.user?.sub;
    const summary = await fetchAttendanceContext({
      organizationId: appraisal.organizationId,
      employeeId: appraisal.employee.userId,
      periodStart: appraisal.cycleId?.periodStart,
      periodEnd: appraisal.cycleId?.periodEnd,
      viewerId,
      viewerRole: isHR ? 'hr' : hasManagerAccess ? 'manager' : 'employee',
      reviewId: appraisal._id.toString(),
      correlationId: `appraisal:${appraisal._id}:attendance-context`,
    });
    res.json({ success: true, data: summary, affectsRating: false });
  } catch (error) {
    console.error('Get attendance context error:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Attendance context is unavailable' });
  }
});

// Get single appraisal
router.get('/:appraisalId', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId))
      .populate(tenantCyclePopulate(req))
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access - compare by userId OR email to handle ID system mismatches
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const hasManagerAccess = await canManageAppraisal(req, appraisal);
    const isHR = req.userRole === 'hr_admin';

    if (!isEmployee && !hasManagerAccess && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Appraisals render immutable goal evidence. The legacy live-goal fallback
    // exists only for appraisals created before snapshots were introduced.
    const okrs = appraisal.goalSnapshots?.length
      ? appraisal.goalSnapshots.map((snapshot) => ({
        _id: snapshot.sourceGoalId,
        title: snapshot.definition?.title,
        objectives: snapshot.definition?.objectives || [],
        period: snapshot.period?.label,
        progress: snapshot.achievement?.score,
        achievement: snapshot.achievement,
        evidence: snapshot.evidence || [],
        isSnapshot: true,
        snapshotCutoffAt: snapshot.cutoffAt
      }))
      : await OKR.find({
        organizationId: appraisal.organizationId,
        ownerId: appraisal.employee.userId,
        status: { $in: ['active', 'closed', 'completed'] }
      });

    res.json({
      success: true,
      data: appraisal,
      okrs,
      accessLevel: isHR ? 'hr' : hasManagerAccess ? 'manager' : 'employee'
    });
  } catch (error) {
    console.error('Get appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisal' });
  }
});

// Mark appraisal notifications as read (manager portal)
router.post('/:appraisalId/notifications/read', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const requestedTypes = Array.isArray(req.body?.types)
      ? req.body.types.filter((type) => typeof type === 'string' && type.trim())
      : [];

    const markedCount = markManagerNotificationsRead(appraisal, {
      types: requestedTypes.length > 0 ? requestedTypes : null
    });

    if (markedCount > 0) {
      await appraisal.save();
    }

    res.json({ success: true, data: { markedCount } });
  } catch (error) {
    console.error('Mark appraisal notifications error:', error);
    res.status(500).json({ success: false, error: 'Failed to update notifications' });
  }
});

// =============================================
// APPRAISAL LIFECYCLE ACTIONS
// =============================================

/**
 * POST /:appraisalId/start - Start the appraisal process
 * Moves appraisal from 'not_started' to 'goal_setting' phase
 * Employee or Manager can start
 */
router.post('/:appraisalId/start', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const isOwner = isAppraisalEmployee(req, appraisal);
    const isManager = await canManageAppraisal(req, appraisal);
    const isHRAdmin = req.userRole === 'hr_admin';

    if (!isOwner && !isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to start this appraisal' });
    }

    // Only allow starting from not_started or goal_setting status
    if (appraisal.status !== 'not_started' && appraisal.status !== 'goal_setting') {
      return res.status(400).json({
        success: false,
        error: `Cannot start appraisal from '${appraisal.status}' status. Already in progress.`
      });
    }

    if (!phaseHasOpened(appraisal.cycleId, 'selfAssessment')) {
      return res.status(409).json({ success: false, error: 'Self-assessment has not opened for this cycle' });
    }

    // Goals are planned and approved independently before an appraisal. The
    // appraisal starts from its immutable evidence snapshot, not a second goal
    // selection workflow.
    const previousStatus = appraisal.status;
    appraisal.status = 'self_assessment_pending';
    appraisal.addAuditLog('appraisal_started', req.session.user, { previousStatus });

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    res.json({
      success: true,
      data: appraisal,
      message: 'Appraisal started successfully. Your approved goal evidence has been attached.'
    });
  } catch (error) {
    console.error('Start appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to start appraisal' });
  }
});

/**
 * POST /:appraisalId/reset - Reset the appraisal to initial state
 * Only Manager or HR Admin can reset
 */
router.post('/:appraisalId/reset', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const isManager = await canManageAppraisal(req, appraisal);
    const isHRAdmin = req.userRole === 'hr_admin';

    if (!isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Only an authorized appraiser can reset this appraisal' });
    }

    // Cannot reset completed appraisals
    if (APPRAISAL_COMPLETED_STATUSES.includes(appraisal.status)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot reset a completed appraisal. Contact HR Admin for assistance.'
      });
    }

    const previousStatus = appraisal.status;
    const { resetLevel = 'full' } = req.body; // 'full' or 'goals_only' or 'self_assessment_only'
    const resetReason = String(req.body.reason || '').trim();
    if (resetReason.length < 10) {
      return res.status(400).json({ success: false, error: 'A reset reason of at least 10 characters is required' });
    }
    if (resetLevel === 'goals_only') {
      return res.status(409).json({
        success: false,
        error: 'Appraisal goal snapshots cannot be reset here. HR may rebuild them before self-assessment opens.'
      });
    }

    if (resetLevel === 'full') {
      // Full reset - back to not_started
      appraisal.status = 'not_started';
      appraisal.selfAssessment = {
        competencyRatings: [],
        achievements: '',
        challenges: '',
        developmentAreas: '',
        comments: ''
      };
      appraisal.managerReview = {
        competencyRatings: [],
        achievements: '',
        areasForImprovement: '',
        comments: ''
      };
    } else if (resetLevel === 'self_assessment_only') {
      // Reset self-assessment
      appraisal.status = 'self_assessment_pending';
      appraisal.selfAssessment = {
        competencyRatings: [],
        achievements: '',
        challenges: '',
        developmentAreas: '',
        comments: ''
      };
    }

    appraisal.addAuditLog('appraisal_reset', req.session.user, {
      previousStatus,
      resetLevel,
      reason: resetReason
    });

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    res.json({
      success: true,
      data: appraisal,
      message: `Appraisal reset successfully (${resetLevel})`
    });
  } catch (error) {
    console.error('Reset appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset appraisal' });
  }
});

// =============================================
// GOAL SETTING
// =============================================

router.post('/:appraisalId/submit-goals', requireAuth, (req, res) => res.status(410).json({
  success: false,
  error: 'Goals are managed in the Goals workspace and are attached to appraisals automatically.'
}));

router.post('/:appraisalId/submit-goals-legacy-disabled', requireAuth, (req, res) => res.status(410).json({
  success: false,
  error: 'This retired appraisal goal writer is unavailable. Use the Goals workspace.'
}));

// Approve goals (Manager)
router.post('/:appraisalId/approve-goals', requireAuth, requireManager, (req, res) => res.status(410).json({
  success: false,
  error: 'Approve employee goals in the Goals approval queue before the appraisal starts.'
}));

router.post('/:appraisalId/approve-goals-legacy-disabled', requireAuth, requireManager, (req, res) => res.status(410).json({
  success: false,
  error: 'This retired appraisal goal writer is unavailable. Use the Goals approval queue.'
}));

// Reject goals (Manager)
router.post('/:appraisalId/reject-goals', requireAuth, requireManager, (req, res) => res.status(410).json({
  success: false,
  error: 'Request goal changes in the Goals approval queue before the appraisal starts.'
}));

router.post('/:appraisalId/reject-goals-legacy-disabled', requireAuth, requireManager, (req, res) => res.status(410).json({
  success: false,
  error: 'This retired appraisal goal writer is unavailable. Use the Goals approval queue.'
}));

// =============================================
// SELF ASSESSMENT
// =============================================

// Save self-assessment (draft or submit)
router.post('/:appraisalId/self-assessment', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee - compare by user IDs and normalized email to handle ID system mismatches.
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can submit self-assessment' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    const aiAssistEnabled = isAiAssistEnabledForCycle(appraisal.cycleId);
    const { selfAssessment = {}, submit } = req.body;

    if (!phaseHasOpened(appraisal.cycleId, 'selfAssessment')) {
      return res.status(409).json({ success: false, error: 'Self-assessment has not opened for this cycle' });
    }

    const normalizedSummary = normalizeSelfAssessmentSummary(selfAssessment.overallSummary || {});
    if (submit) {
      const missingSections = getMissingSelfAssessmentSections(normalizedSummary);
      if (missingSections.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Complete these self-assessment sections: ${missingSections.join(', ')}`,
          missingSections
        });
      }
      if (appraisal.cycleId?.settings?.requireDocumentUpload && (!appraisal.documents || appraisal.documents.length === 0)) {
        return res.status(400).json({ success: false, error: 'At least one evidence document is required for this cycle' });
      }
      if (appraisal.cycleId?.settings?.requireOkrAlignment && (!appraisal.goalSnapshots || appraisal.goalSnapshots.length === 0)) {
        return res.status(400).json({ success: false, error: 'This cycle requires at least one approved aligned goal snapshot' });
      }
    }

    const allowSelfRating = appraisal.cycleId?.settings?.allowSelfRating !== false;
    const competencyRatings = (Array.isArray(selfAssessment.competencyRatings) ? selfAssessment.competencyRatings : []).map((rating) => ({
      competencyId: String(rating.competencyId || ''),
      competencyName: String(rating.competencyName || ''),
      selfRating: allowSelfRating && Number.isFinite(Number(rating.selfRating)) ? Number(rating.selfRating) : undefined,
      selfComments: String(rating.selfComments || '').slice(0, 5000),
      evidenceDocuments: Array.isArray(rating.evidenceDocuments) ? rating.evidenceDocuments : []
    }));
    const submittedOkrAssessments = new Map(
      (Array.isArray(selfAssessment.okrAssessment) ? selfAssessment.okrAssessment : [])
        .filter((assessment) => assessment.okrId)
        .map((assessment) => [String(assessment.okrId), assessment])
    );
    const okrAssessment = (appraisal.goalSnapshots || []).map((snapshot) => {
      const submitted = submittedOkrAssessments.get(String(snapshot.sourceGoalId)) || {};
      return {
        okrId: snapshot.sourceGoalId,
        okrTitle: snapshot.definition?.title,
        targetValue: 100,
        achievedValue: snapshot.achievement?.score,
        completionPercentage: snapshot.achievement?.score,
        selfComments: String(submitted.selfComments || '').slice(0, 5000),
        evidenceDocuments: Array.isArray(submitted.evidenceDocuments) ? submitted.evidenceDocuments : []
      };
    });
    const currentSelfAssessment = toPlainObject(appraisal.selfAssessment);

    // Persist only employee-owned fields. AI metadata, submission timestamps,
    // goal completion and workflow status remain server-owned.
    appraisal.selfAssessment = {
      ...currentSelfAssessment,
      overallSummary: normalizedSummary,
      competencyRatings,
      okrAssessment,
      overallSelfRating: allowSelfRating && Number.isFinite(Number(selfAssessment.overallSelfRating))
        ? Number(selfAssessment.overallSelfRating)
        : undefined,
      lastSavedAt: new Date()
    };

    if (submit) {
      appraisal.selfAssessment.submittedAt = new Date();
      appraisal.status = 'manager_review_pending';

      addManagerNotification(
        appraisal,
        `${appraisal.employee.name} submitted a self-assessment and is ready for your review.`,
        'self_assessment_submitted'
      );

      // Generate AI insights when AI assistance is enabled for this cycle.
      if (aiAssistEnabled) {
        try {
          const aiInsights = await appraisalAIService.analyzeSelfAssessment(
            appraisal.selfAssessment,
            appraisal.selfAssessment.okrAssessment,
            []
          );
          appraisal.selfAssessment.aiInsights = {
            ...aiInsights,
            generatedAt: new Date()
          };
        } catch (aiError) {
          console.error('AI insights error:', aiError);
        }
      }

      appraisal.addAuditLog('self_assessment_submitted', req.session.user, {});
    } else {
      appraisal.status = 'self_assessment_in_progress';
    }

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    // Notify manager (best-effort; do not fail submission if email is not configured)
    if (submit) {
      await cancelAppraisalReminders(
        appraisal,
        'appraisal_self_assessment',
        appraisal.employee?.userId,
        'self_assessment_submitted'
      );
      await recordAppraisalEvent(appraisal, 'appraisal.self_submitted', req.session.user, {
        recipients: appraisal.manager?.userId ? [{
          userId: appraisal.manager.userId,
          name: appraisal.manager.name,
          email: appraisal.manager.email
        }] : [],
        dueAt: appraisal.deadlines?.managerReviewDue,
        reminderTargetType: 'appraisal_manager_review',
        reminderTitle: 'Manager review due',
        reminderMessage: 'A submitted self-assessment is waiting for your review.',
        actionKind: 'review',
        actionLabel: 'Review assessment'
      });
    }

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Save self-assessment error:', error);
    res.status(500).json({ success: false, error: 'Failed to save self-assessment' });
  }
});

// =============================================
// MANAGER REVIEW
// =============================================

// Mark manager review as started and consume pending notification
router.post('/:appraisalId/manager-review/start', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Only an authorized manager can start review' });
    }

    if (!appraisal.selfAssessment?.submittedAt) {
      return res.status(400).json({ success: false, error: 'Self-assessment must be submitted before manager review' });
    }

    if (!phaseHasOpened(appraisal.cycleId, 'managerReview')) {
      return res.status(409).json({ success: false, error: 'Manager review has not opened for this cycle' });
    }

    if (!MANAGER_REVIEW_EDITABLE_STATUSES.includes(appraisal.status)) {
      return res.status(400).json({
        success: false,
        error: `Manager review cannot be started in '${appraisal.status}' status`
      });
    }

    const previousStatus = appraisal.status;
    if (appraisal.status !== 'manager_review_in_progress') {
      appraisal.status = 'manager_review_in_progress';
      appraisal.addAuditLog('manager_review_started', req.session.user, {
        previousStatus
      });
    }

    markManagerNotificationsRead(appraisal, { types: ['self_assessment_submitted', 'manager_review_requested'] });

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Start manager review error:', error);
    res.status(500).json({ success: false, error: 'Failed to start manager review' });
  }
});

// Save manager review (draft or submit)
router.post('/:appraisalId/manager-review', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify manager/appraiser access
    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Only an authorized manager can submit review' });
    }

    if (!appraisal.selfAssessment?.submittedAt) {
      return res.status(400).json({ success: false, error: 'Self-assessment must be submitted before manager review' });
    }

    if (!MANAGER_REVIEW_EDITABLE_STATUSES.includes(appraisal.status)) {
      return res.status(400).json({
        success: false,
        error: `Manager review is not editable in '${appraisal.status}' status`
      });
    }

    const aiAssistEnabled = isAiAssistEnabledForCycle(appraisal.cycleId);
    const { managerReview = {}, submit } = req.body;
    if (!phaseHasOpened(appraisal.cycleId, 'managerReview')) {
      return res.status(409).json({ success: false, error: 'Manager review has not opened for this cycle' });
    }
    const normalizedManagerReview = normalizeManagerReviewPayload(managerReview, appraisal);
    const currentManagerReview = toPlainObject(appraisal.managerReview);

    appraisal.managerReview = {
      ...currentManagerReview,
      ...normalizedManagerReview,
      lastSavedAt: new Date()
    };

    if (submit) {
      appraisal.managerReview.submittedAt = new Date();
      const calibrationRequired = isCalibrationEnabledForCycle(appraisal.cycleId);
      appraisal.status = getStatusAfterManagerReview();

      // Flag rating gaps for follow-up/arbitration in final review
      const selfRating = appraisal.selfAssessment?.overallSelfRating;
      const managerRating = appraisal.managerReview?.overallManagerRating;
      if (selfRating && managerRating && Math.abs(selfRating - managerRating) >= 2) {
        appraisal.flags = appraisal.flags || {};
        appraisal.flags.hasDispute = true;
        appraisal.flags.needsAttention = true;
        appraisal.flags.disputeReason = `Self vs manager rating gap (${selfRating} vs ${managerRating})`;
      }

      // Check for bias only when AI assistance is enabled for this cycle.
      if (aiAssistEnabled) {
        try {
          const biasCheck = await appraisalAIService.checkForBias(
            appraisal.managerReview,
            appraisal.selfAssessment,
            {}
          );
          appraisal.managerReview.aiAssist = {
            ...appraisal.managerReview.aiAssist,
            biasCheck,
            generatedAt: new Date()
          };
        } catch (aiError) {
          console.error('Bias check error:', aiError);
        }
      }

      markManagerNotificationsRead(appraisal, { types: ['self_assessment_submitted', 'manager_review_requested'] });

      appraisal.addAuditLog('manager_review_submitted', req.session.user, {
        nextStatus: appraisal.status,
        calibrationRequired
      });
    } else {
      appraisal.status = 'manager_review_in_progress';
    }

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);
    if (submit) {
      await cancelAppraisalReminders(
        appraisal,
        'appraisal_manager_review',
        appraisal.manager?.userId,
        'manager_review_submitted'
      );
      await recordAppraisalEvent(appraisal, 'appraisal.manager_submitted', req.session.user, {
        recipients: appraisal.employee?.userId ? [{
          userId: appraisal.employee.userId,
          name: appraisal.employee.name,
          email: appraisal.employee.email
        }] : []
      });
    }
    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Save manager review error:', error);
    const validationMessage = error?.name === 'ValidationError'
      ? Object.values(error.errors || {}).map((issue) => issue?.message).filter(Boolean).join('; ')
      : (error?.name === 'CastError' ? error.message : null);

    res.status(validationMessage ? 400 : 500).json({
      success: false,
      error: validationMessage || 'Failed to save manager review'
    });
  }
});

// Get AI assistance for manager review
router.post('/:appraisalId/ai-assist', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle'
      });
    }

    const { managerNotes } = req.body;

    const assistance = await appraisalAIService.assistManagerReview(
      appraisal.selfAssessment,
      managerNotes,
      appraisal.selfAssessment?.okrAssessment || [],
      { employeeName: appraisal.employee.name }
    );

    res.json({ success: true, data: assistance });
  } catch (error) {
    console.error('AI assist error:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI assistance' });
  }
});

// =============================================
// CHAT / DISCUSSION
// =============================================

// Get chat thread
router.get('/:appraisalId/chat', requireAuth, async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) return res.status(403).json({ success: false, error: 'Organization context is required' });
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    }).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);

    if (!isEmployee && !canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!(await isChatEnabledForAppraisal(appraisal))) {
      return res.status(404).json({ success: false, error: 'Appraisal chat is disabled for this cycle' });
    }

    // Mark messages as read
    const role = isEmployee ? 'employee' : 'manager';
    appraisal.chatThread.forEach(msg => {
      if (role === 'employee') msg.isRead.byEmployee = true;
      if (role === 'manager') msg.isRead.byManager = true;
    });
    await appraisal.save();

    res.json({ success: true, data: appraisal.chatThread });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chat' });
  }
});

// Send chat message
router.post('/:appraisalId/chat', requireAuth, async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) return res.status(403).json({ success: false, error: 'Organization context is required' });
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    }).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access
    const userId = req.session?.user?.id || req.session?.user?.sub;
    const userName = req.session?.user?.name;
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);

    if (!isEmployee && !canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!(await isChatEnabledForAppraisal(appraisal))) {
      return res.status(404).json({ success: false, error: 'Appraisal chat is disabled for this cycle' });
    }

    const { message, messageType, requestAI } = req.body;
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    if (!normalizedMessage || normalizedMessage.length > 4000) {
      return res.status(400).json({
        success: false,
        error: 'Message is required and must be 4,000 characters or fewer'
      });
    }
    const senderRole = isEmployee ? 'employee' : 'manager';
    const aiAssistEnabled = await isAiAssistEnabledForAppraisal(appraisal);

    // Add user message
    appraisal.addChatMessage(
      { userId, name: userName, role: senderRole },
      normalizedMessage,
      messageType || 'text'
    );

    // Generate AI response if requested
    if (requestAI) {
      if (!aiAssistEnabled) {
        appraisal.chatThread.push({
          sender: { userId: 'system', name: 'System', role: 'system' },
          message: 'AI assistance is disabled for this appraisal cycle.',
          messageType: 'system',
          createdAt: new Date()
        });
        await appraisal.save();
        return res.json({ success: true, data: appraisal.chatThread });
      }

      try {
        const aiResponse = await appraisalAIService.generateChatResponse(
          appraisal.chatThread,
          normalizedMessage,
          {
            employeeName: appraisal.employee.name,
            currentRating: appraisal.managerReview?.overallManagerRating,
            keyTopics: ['performance', 'development', 'goals']
          },
          senderRole
        );

        appraisal.chatThread.push({
          sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
          message: aiResponse.response,
          messageType: 'ai_insight',
          aiContext: { isAiGenerated: true, modelUsed: aiResponse.modelUsed },
          createdAt: new Date()
        });
      } catch (aiError) {
        console.error('AI response error:', aiError);
      }
    }

    await appraisal.save();
    res.json({ success: true, data: appraisal.chatThread });
  } catch (error) {
    console.error('Send chat error:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// =============================================
// DOCUMENT UPLOAD
// =============================================

// Upload document
router.post('/:appraisalId/documents', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      removeRejectedUpload(req.file);
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    });
    if (!appraisal) {
      removeRejectedUpload(req.file);
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access
    const userId = req.session?.user?.id || req.session?.user?.sub;
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);

    if (!isEmployee && !canManage) {
      removeRejectedUpload(req.file);
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'A document file is required' });
    }
    const fileType = path.extname(file.originalname).slice(1).toLowerCase();
    const allowedVisibility = new Set(['employee_only', 'employee_manager', 'all_reviewers', 'hr_only']);
    const requestedVisibility = allowedVisibility.has(req.body.visibility)
      ? req.body.visibility
      : 'employee_manager';
    if (requestedVisibility === 'hr_only' && req.userRole !== 'hr_admin') {
      removeRejectedUpload(file);
      return res.status(403).json({ success: false, error: 'Only HR can upload HR-only documents' });
    }

    // Create document record
    const document = new AppraisalDocument({
      appraisalId: appraisal._id,
      organizationId: appraisal.organizationId,
      fileName: file.filename,
      originalName: file.originalname,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageProvider: 'local',
      storagePath: file.path,
      category: req.body.category || 'other',
      description: req.body.description,
      visibility: requestedVisibility,
      uploadedBy: {
        userId,
        name: req.session.user.name,
        email: req.session.user.email,
        role: isEmployee ? 'employee' : 'manager'
      }
    });

    // Extract text if supported
    if (documentExtractionService.isSupported(fileType)) {
      try {
        document.textExtraction.status = 'processing';
        const extraction = await documentExtractionService.extractText(file.path, fileType);

        document.textExtraction = {
          status: 'completed',
          extractedText: extraction.text,
          extractedAt: new Date(),
          pageCount: extraction.pageCount,
          wordCount: extraction.wordCount
        };

        // Trigger AI analysis
        if (extraction.text && extraction.text.length > 100) {
          document.aiAnalysis.status = 'processing';
          await document.save();

          // Async AI analysis
          appraisalAIService.analyzeDocument(extraction.text, {
            employeeName: appraisal.employee.name,
            department: appraisal.employee.department
          }).then(async analysis => {
            document.aiAnalysis = {
              status: 'completed',
              analyzedAt: new Date(),
              ...analysis
            };
            await document.save();
          }).catch(err => {
            console.error('AI analysis error:', err);
            document.aiAnalysis.status = 'failed';
            document.aiAnalysis.error = err.message;
            document.save();
          });
        }
      } catch (extractError) {
        console.error('Text extraction error:', extractError);
        document.textExtraction.status = 'failed';
        document.textExtraction.error = extractError.message;
      }
    } else {
      document.textExtraction.status = 'not_applicable';
    }

    await document.save();

    // Link to appraisal
    appraisal.documents.push(document._id);
    await appraisal.save();

    res.status(201).json({ success: true, data: document });
  } catch (error) {
    removeRejectedUpload(req.file);
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

// Get document
router.get('/:appraisalId/documents/:documentId', requireAuth, async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    });
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const document = await AppraisalDocument.findOne({
      _id: req.params.documentId,
      appraisalId: appraisal._id,
      organizationId,
      status: { $ne: 'deleted' }
    });
    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);
    const isHR = req.userRole === 'hr_admin';
    const canView = document.visibility === 'employee_only'
      ? isEmployee
      : document.visibility === 'hr_only'
        ? isHR
        : (isEmployee || canManage || isHR);
    if (!canView) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const safeDocument = document.toObject();
    delete safeDocument.storagePath;
    delete safeDocument.storageUrl;
    delete safeDocument.publicUrl;
    delete safeDocument.fileName;
    delete safeDocument.metadata;
    if (safeDocument.textExtraction) {
      delete safeDocument.textExtraction.extractedText;
      delete safeDocument.textExtraction.error;
    }
    if (safeDocument.aiAnalysis) delete safeDocument.aiAnalysis.error;

    res.json({ success: true, data: safeDocument });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch document' });
  }
});

// =============================================
// DISCUSSION
// =============================================

// Update discussion notes
router.put('/:appraisalId/discussion', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    // Check permission
    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!['manager_review_submitted', 'discussion_scheduled', 'discussion_completed'].includes(appraisal.status)) {
      return res.status(409).json({ success: false, error: `Discussion is not available in '${appraisal.status}' status` });
    }

    // Update fields
    if (req.body.notes) appraisal.discussion.notes = { ...appraisal.discussion.notes, ...req.body.notes };
    if (req.body.scheduledDate) {
      const scheduledDate = new Date(req.body.scheduledDate);
      if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ success: false, error: 'Discussion date is invalid' });
      appraisal.discussion.scheduledDate = scheduledDate;
      if (appraisal.status === 'manager_review_submitted') appraisal.status = 'discussion_scheduled';
    }
    if (req.body.completedDate) appraisal.discussion.completedDate = req.body.completedDate;
    if (req.body.location) appraisal.discussion.location = req.body.location;
    if (req.body.meetingLink) appraisal.discussion.meetingLink = req.body.meetingLink;

    if (req.body.markCompleted) {
      const calibrationRequired = isCalibrationEnabledForCycle(appraisal.cycleId);
      appraisal.status = getStatusAfterDiscussion({ calibrationRequired });
      appraisal.discussion.completedDate = new Date();
      appraisal.addAuditLog('discussion_completed', req.session.user, {
        nextStatus: appraisal.status,
        calibrationRequired
      });
    } else {
      appraisal.addAuditLog('discussion_updated', req.session.user, { status: appraisal.status });
    }

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);
    if (req.body.scheduledDate && !req.body.markCompleted) {
      await recordAppraisalEvent(appraisal, 'appraisal.discussion_ready', req.session.user, {
        recipients: [appraisal.employee, appraisal.manager]
          .filter((participant) => participant?.userId)
          .map((participant) => ({
            userId: participant.userId,
            name: participant.name,
            email: participant.email
          })),
        dueAt: appraisal.discussion?.scheduledDate,
        reminderTargetType: 'appraisal_discussion',
        reminderTitle: 'Appraisal discussion scheduled',
        reminderMessage: 'Your appraisal discussion is approaching.',
        actionKind: 'complete',
        actionLabel: 'Open discussion'
      });
    }
    if (req.body.markCompleted) {
      await cancelAppraisalReminders(appraisal, 'appraisal_discussion', null, 'discussion_completed');
    }
    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Update discussion error:', error);
    res.status(500).json({ success: false, error: 'Failed to update discussion' });
  }
});

// =============================================
// FINALIZATION
// =============================================

// Save calibration decision (draft or submit)
router.post('/:appraisalId/calibration', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!appraisal.selfAssessment?.submittedAt || !appraisal.managerReview?.submittedAt) {
      return res.status(400).json({
        success: false,
        error: 'Calibration can only start after self-assessment and manager review are submitted'
      });
    }

    const cycle = appraisal.cycleId;
    if (!isCalibrationEnabledForCycle(cycle)) {
      return res.status(400).json({ success: false, error: 'Calibration is not enabled for this cycle' });
    }
    if (!phaseHasOpened(cycle, 'calibration')) {
      return res.status(409).json({ success: false, error: 'Calibration has not opened for this cycle' });
    }

    if (!CALIBRATION_EDITABLE_STATUSES.includes(appraisal.status) && appraisal.status !== 'final_review_pending') {
      return res.status(400).json({
        success: false,
        error: `Calibration is not editable in '${appraisal.status}' status`
      });
    }

    const { calibration = {}, submit } = req.body || {};
    const requestedRating = calibration.calibratedRating ?? appraisal.managerReview?.overallManagerRating;
    const minRating = cycle?.ratingScale?.min ?? 1;
    const maxRating = cycle?.ratingScale?.max ?? 5;

    if (requestedRating === undefined || requestedRating === null) {
      return res.status(400).json({ success: false, error: 'Calibrated rating is required' });
    }

    const numericRating = Number(requestedRating);
    if (Number.isNaN(numericRating) || numericRating < minRating || numericRating > maxRating) {
      return res.status(400).json({
        success: false,
        error: `Calibrated rating must be a number from ${minRating} to ${maxRating}`
      });
    }

    const normalizedJustification = typeof calibration.justification === 'string'
      ? calibration.justification.trim()
      : '';

    appraisal.calibration = {
      ...(appraisal.calibration || {}),
      originalRating: Number(appraisal.managerReview?.overallManagerRating ?? numericRating),
      calibratedRating: numericRating,
      calibratedBy: {
        userId: req.session.user.id || req.session.user.sub,
        name: req.session.user.name
      },
      justification: normalizedJustification || undefined
    };

    if (submit) {
      appraisal.calibration.calibratedAt = new Date();
      appraisal.status = 'final_review_pending';
      appraisal.addAuditLog('calibration_submitted', req.session.user, {
        calibratedRating: numericRating,
        justification: normalizedJustification || undefined
      });
    } else if (appraisal.status === 'calibration_pending' || appraisal.status === 'manager_review_submitted') {
      appraisal.status = 'calibration_in_progress';
      appraisal.addAuditLog('calibration_saved', req.session.user, {
        calibratedRating: numericRating
      });
    }

    await appraisal.save();
    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Save calibration error:', error);
    res.status(500).json({ success: false, error: 'Failed to save calibration' });
  }
});

// Finalize appraisal
router.post('/:appraisalId/finalize', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Allow any authorized appraiser in scope (including HR/admin roles).
    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { finalRating, calibratedRating, justification } = req.body;
    const cycle = appraisal.cycleId;
    if (!phaseHasOpened(cycle, 'finalReview')) {
      return res.status(409).json({ success: false, error: 'Final review has not opened for this cycle' });
    }

    if (!appraisal.selfAssessment?.submittedAt) {
      return res.status(400).json({ success: false, error: 'Self-assessment must be submitted first' });
    }

    if (!appraisal.managerReview?.submittedAt) {
      return res.status(400).json({ success: false, error: 'Manager review must be submitted first' });
    }

    const calibrationRequired = isCalibrationEnabledForCycle(cycle);
    if (calibrationRequired && !appraisal.calibration?.calibratedAt) {
      return res.status(400).json({ success: false, error: 'Calibration must be completed before final review' });
    }

    if (!FINAL_REVIEW_ALLOWED_STATUSES.includes(appraisal.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot finalize appraisal while in '${appraisal.status}' status`
      });
    }

    const minRating = cycle?.ratingScale?.min ?? 1;
    const maxRating = cycle?.ratingScale?.max ?? 5;

    // Use the same composite score math as the manager scoring endpoint.
    const scores = appraisalAIService.calculateCompositeScore(appraisal, cycle);

    const requestedRating =
      (calibratedRating ?? finalRating ?? appraisal.managerReview?.overallManagerRating ?? scores?.suggestedRating);

    if (requestedRating === undefined || requestedRating === null) {
      return res.status(400).json({ success: false, error: 'Final rating is required' });
    }

    const numericRating = Number(requestedRating);
    if (Number.isNaN(numericRating) || numericRating < minRating || numericRating > maxRating) {
      return res.status(400).json({ success: false, error: `Final rating must be a number from ${minRating} to ${maxRating}` });
    }

    const overall = Math.round(numericRating * 10) / 10;
    const calculatedRating = Number(scores?.suggestedRating);
    const overrideApplied = Number.isFinite(calculatedRating) && Math.abs(overall - calculatedRating) >= 0.05;
    const overrideReason = String(justification || appraisal.calibration?.justification || '').trim();
    if (overrideApplied && overrideReason.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'A reason of at least 10 characters is required when overriding the calculated evidence rating',
        data: { calculatedRating, selectedRating: overall }
      });
    }

    // Get rating label/color from cycle scale (fallback to generic label if not found).
    const ratingInfo = cycle?.ratingScale?.labels?.find(l => l.value === Math.round(overall)) || {};

    appraisal.finalRating = {
      overall,
      okrScore: scores?.okrScore,
      competencyScore: scores?.competencyScore,
      ratingLabel: ratingInfo.label || scores?.ratingLabel,
      ratingColor: ratingInfo.color,
      justification: justification || undefined,
      breakdown: scores?.breakdown,
      override: {
        applied: overrideApplied,
        calculatedRating: Number.isFinite(calculatedRating) ? calculatedRating : undefined,
        selectedRating: overall,
        reason: overrideApplied ? overrideReason : undefined,
        changedBy: overrideApplied ? {
          userId: req.session.user.id || req.session.user.sub,
          name: req.session.user.name
        } : undefined,
        changedAt: overrideApplied ? new Date() : undefined
      },
      finalizedAt: new Date(),
      finalizedBy: {
        userId: req.session.user.id || req.session.user.sub,
        name: req.session.user.name
      }
    };

    if (calibratedRating !== undefined && calibratedRating !== null) {
      appraisal.calibration = {
        originalRating: Number(finalRating ?? appraisal.managerReview?.overallManagerRating),
        calibratedRating: Number(calibratedRating),
        calibratedBy: { userId: req.session.user.id || req.session.user.sub, name: req.session.user.name },
        calibratedAt: new Date(),
        justification
      };
    }

    appraisal.status = 'completed';
    appraisal.addAuditLog('appraisal_finalized', req.session.user, {
      finalRating: appraisal.finalRating,
      calculatedRating: Number.isFinite(calculatedRating) ? calculatedRating : null,
      overrideApplied,
      overrideReason: overrideApplied ? overrideReason : null
    });

    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    await recordAppraisalEvent(appraisal, 'appraisal.finalized', req.session.user, {
      recipients: appraisal.employee?.userId ? [{
        userId: appraisal.employee.userId,
        name: appraisal.employee.name,
        email: appraisal.employee.email
      }] : [],
      dueAt: cycle?.phases?.finalReview?.endDate,
      reminderTargetType: 'appraisal_acknowledgement',
      reminderTitle: 'Appraisal acknowledgement due',
      reminderMessage: 'Your finalized appraisal is ready to review and acknowledge.',
      actionKind: 'acknowledge',
      actionLabel: 'Review outcome'
    });

    let developmentPlan = null;
    let developmentPlanWarning = null;
    let continuousPerformanceEnabled = false;
    try {
      const organizationFeatureState = await getOrganizationFeatureState(appraisal.organizationId);
      continuousPerformanceEnabled = organizationFeatureState.features.continuousPerformance === true;
      if (continuousPerformanceEnabled) {
        developmentPlan = await ensureDraftDevelopmentPlan(appraisal, cycle, req.session.user);
      }
    } catch (planError) {
      console.error('Unable to create the appraisal development-plan draft:', planError);
      developmentPlanWarning = 'The appraisal was finalized, but the development-plan draft could not be created.';
    }

    // Do not create inaccessible development work when continuous performance
    // is explicitly disabled for the organization.
    if (continuousPerformanceEnabled && isAiAssistEnabledForCycle(cycle)) {
      try {
        const devPlan = await appraisalAIService.suggestDevelopmentPlan(appraisal, appraisal.selfAssessment?.okrAssessment || [], {
          employeeName: appraisal.employee.name,
          jobTitle: appraisal.employee.jobTitle
        });
        if (developmentPlan && devPlan) {
          developmentPlan.aiRecommendations = {
            suggestedSkills: devPlan.suggestedSkills || devPlan.skills || [],
            suggestedResources: devPlan.suggestedResources || devPlan.resources || [],
            careerPathSuggestions: devPlan.careerPathSuggestions || devPlan.careerPaths || [],
            generatedAt: new Date()
          };
          await developmentPlan.save();
        }
        return res.json({
          success: true,
          data: appraisal,
          developmentPlan,
          developmentPlanSuggestions: devPlan,
          warning: developmentPlanWarning
        });
      } catch (aiError) {
        return res.json({ success: true, data: appraisal, developmentPlan, warning: developmentPlanWarning });
      }
    }

    res.json({ success: true, data: appraisal, developmentPlan, warning: developmentPlanWarning });
  } catch (error) {
    console.error('Finalize appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to finalize appraisal' });
  }
});

// Employee acknowledge
router.post('/:appraisalId/acknowledge', requireAuth, async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    });
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can acknowledge' });
    }

    if (appraisal.status !== 'completed' || !appraisal.finalRating?.finalizedAt) {
      return res.status(409).json({
        success: false,
        error: 'Only a finalized appraisal outcome can be acknowledged'
      });
    }

    appraisal.discussion.employeeAcknowledged = true;
    appraisal.discussion.employeeAcknowledgedAt = new Date();
    appraisal.status = 'employee_acknowledged';

    appraisal.addAuditLog('employee_acknowledged', req.session.user, {});
    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);
    await cancelAppraisalReminders(
      appraisal,
      'appraisal_acknowledgement',
      appraisal.employee?.userId,
      'employee_acknowledged'
    );
    await recordAppraisalEvent(appraisal, 'appraisal.acknowledged', req.session.user, {
      recipients: appraisal.manager?.userId ? [{
        userId: appraisal.manager.userId,
        name: appraisal.manager.name,
        email: appraisal.manager.email
      }] : []
    });

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Acknowledge error:', error);
    res.status(500).json({ success: false, error: 'Failed to acknowledge' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/check-bias
 * Check manager review for potential bias
 */
router.post('/:appraisalId/check-bias', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle'
      });
    }

    const { managerReview, selfAssessment } = req.body;

    const biasCheck = await appraisalAIService.checkForBias(
      managerReview,
      selfAssessment || appraisal.selfAssessment,
      {
        employeeName: appraisal.employee.name,
        department: appraisal.employee.department
      }
    );

    res.json({ success: true, ...biasCheck });
  } catch (error) {
    console.error('Bias check error:', error);
    res.status(500).json({ success: false, error: 'Failed to check for bias' });
  }
});

// =============================================
// CONVERSATIONAL SELF-ASSESSMENT ENDPOINTS
// =============================================

/**
 * POST /api/appraisals/:appraisalId/conversation/start
 * Initialize the conversational self-assessment session
 * Returns initial AI greeting with OKR summary
 */
router.post('/:appraisalId/conversation/start', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can start the conversation' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle. Use the manual self-assessment form.'
      });
    }

    // Get employee's OKRs
    const okrs = await OKR.find({
      organizationId: appraisal.organizationId,
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    const existingConversation = (
      appraisal.conversationAssessment?.startedAt &&
      Array.isArray(appraisal.chatThread) &&
      appraisal.chatThread.length > 0
    );

    if (existingConversation) {
      const okrSummary = okrs.map((okr, index) => ({
        id: okr._id,
        title: okr.title || okr.objectives?.[0]?.title || `OKR ${index + 1}`,
        progress: okr.progress || 0,
        objectives: okr.objectives
      }));

      return res.json({
        success: true,
        data: {
          greeting: null,
          okrSummary,
          conversationState: appraisal.conversationAssessment,
          chatThread: appraisal.chatThread.slice(-20)
        }
      });
    }

    // Start conversation via AI service
    const result = await appraisalAIService.startSelfAssessmentConversation(
      appraisal,
      okrs,
      appraisal.employee
    );

    // Initialize conversation state
    appraisal.conversationAssessment = {
      mode: 'conversation',
      currentPhase: result.phase || 'okr_reflection',
      currentOkrIndex: result.currentOkrIndex || 0,
      completedPhases: [],
      extractedData: {
        achievements: [],
        challenges: [],
        skills: [],
        goals: []
      },
      startedAt: new Date(),
      lastActivityAt: new Date(),
      totalTokensUsed: result.tokensUsed || 0,
      messageCount: 1
    };

    // Add initial AI message to chat thread
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: result.greeting,
      messageType: 'prompt',
      phase: result.phase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: result.fallback ? 'guided-fallback' : (result.model || 'seemplify-ai-gateway'),
        tokensUsed: result.tokensUsed
      },
      createdAt: new Date()
    });

    // Update status
    if (appraisal.status === 'self_assessment_pending') {
      appraisal.status = 'self_assessment_in_progress';
    }

    appraisal.addAuditLog('conversation_started', req.session.user, { mode: 'conversation' });
    await appraisal.save();

    res.json({
      success: true,
      data: {
        greeting: result.greeting,
        okrSummary: result.okrSummary,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20), // Last 20 messages
        fallback: result.fallback === true,
        aiAvailable: result.fallback !== true
      }
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({ success: false, error: 'Failed to start conversation' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/message
 * Send a message in the conversation and get AI response
 */
router.post('/:appraisalId/conversation/message', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id || req.session?.user?.sub;
    const userName = req.session?.user?.name;
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can participate in the conversation' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle. Use the manual self-assessment form.'
      });
    }

    ensureConversationAssessmentState(appraisal);

    if (!appraisal.conversationAssessment?.startedAt || (appraisal.chatThread || []).length === 0) {
      return res.status(400).json({ success: false, error: 'Conversation has not been started yet' });
    }

    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // Get employee's OKRs for context
    const okrs = await OKR.find({
      organizationId: appraisal.organizationId,
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'okr_reflection';

    // Add user message to chat thread
    appraisal.chatThread.push({
      sender: { userId, name: userName, role: 'employee' },
      message: message.trim(),
      messageType: 'text',
      phase: currentPhase,
      createdAt: new Date()
    });

    // Get AI response
    const result = await appraisalAIService.continueConversation(
      appraisal,
      message.trim(),
      okrs,
      null // documentContext - can be added later
    );

    // Add AI response to chat thread
    const aiMessage = {
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: result.response,
      messageType: 'prompt',
      phase: result.currentPhase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: result.fallback ? 'guided-fallback' : (result.model || 'seemplify-ai-gateway'),
        tokensUsed: result.tokensUsed,
        confidence: result.confidence
      },
      createdAt: new Date()
    };

    const extractedType = result.extractedData?.type;
    const sanitizedExtraction = sanitizeConversationExtraction(extractedType, result.extractedData?.data);
    const normalizedExtractedData = (sanitizedExtraction && extractedType && extractedType !== 'null')
      ? { type: extractedType, data: sanitizedExtraction }
      : null;

    // Only add structuredData if extractedData is valid and meaningful
    if (normalizedExtractedData) {
      aiMessage.structuredData = normalizedExtractedData;
    }

    appraisal.chatThread.push(aiMessage);

    // Update conversation state
    appraisal.conversationAssessment.currentPhase = result.currentPhase;
    appraisal.conversationAssessment.currentOkrIndex = result.currentOkrIndex;
    appraisal.conversationAssessment.lastActivityAt = new Date();
    appraisal.conversationAssessment.totalTokensUsed = (appraisal.conversationAssessment.totalTokensUsed || 0) + (result.tokensUsed || 0);
    appraisal.conversationAssessment.messageCount = (appraisal.conversationAssessment.messageCount || 0) + 2;

    // Track phase completion
    if (result.currentPhase !== currentPhase) {
      if (!appraisal.conversationAssessment.completedPhases.includes(currentPhase)) {
        appraisal.conversationAssessment.completedPhases.push(currentPhase);
      }
    }

    // Store extracted data
    if (normalizedExtractedData) {
      const dataType = normalizedExtractedData.type;
      const dataValue = normalizedExtractedData.data;

      switch (dataType) {
        case 'achievement':
          appraisal.conversationAssessment.extractedData.achievements.push({
            text: dataValue.text,
            confidence: result.confidence,
            extractedFrom: 'conversation'
          });
          break;
        case 'challenge':
          appraisal.conversationAssessment.extractedData.challenges.push({
            text: dataValue.text,
            resolution: dataValue.resolution,
            learnings: dataValue.learnings
          });
          break;
        case 'learning':
        case 'skill':
          appraisal.conversationAssessment.extractedData.skills.push({
            skill: dataValue.text || dataValue.skill,
            evidence: dataValue.context || dataValue.evidence
          });
          break;
        case 'goal':
          appraisal.conversationAssessment.extractedData.goals.push({
            goal: dataValue.text || dataValue.goal,
            measurable: dataValue.measurable || false,
            timeframe: dataValue.timeframe
          });
          break;
      }
    }

    await appraisal.save();

    res.json({
      success: true,
      data: {
        response: result.response,
        currentPhase: result.currentPhase,
        extractedData: normalizedExtractedData,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20),
        fallback: result.fallback === true,
        aiAvailable: result.fallback !== true
      }
    });
  } catch (error) {
    console.error('Conversation message error:', error);
    res.status(500).json({ success: false, error: 'Failed to process message' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/upload
 * Upload a document mid-conversation
 */
router.post('/:appraisalId/conversation/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      removeRejectedUpload(req.file);
      return res.status(403).json({ success: false, error: 'Organization context is required' });
    }
    const appraisal = await Appraisal.findOne({
      _id: req.params.appraisalId,
      organizationId
    }).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      removeRejectedUpload(req.file);
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id || req.session?.user?.sub;
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      removeRejectedUpload(req.file);
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      removeRejectedUpload(req.file);
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      removeRejectedUpload(req.file);
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle. Use the manual self-assessment form.'
      });
    }

    ensureConversationAssessmentState(appraisal);

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileType = path.extname(file.originalname).slice(1).toLowerCase();

    // Create document record
    const document = new AppraisalDocument({
      appraisalId: appraisal._id,
      organizationId: appraisal.organizationId,
      fileName: file.filename,
      originalName: file.originalname,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageProvider: 'local',
      storagePath: file.path,
      category: req.body.category || 'achievement_evidence',
      description: req.body.description,
      uploadedBy: {
        userId,
        name: req.session.user.name,
        email: req.session.user.email,
        role: 'employee'
      }
    });

    // Extract text
    if (documentExtractionService.isSupported(fileType)) {
      try {
        document.textExtraction.status = 'processing';
        const extraction = await documentExtractionService.extractText(file.path, fileType);

        document.textExtraction = {
          status: 'completed',
          extractedText: extraction.text,
          extractedAt: new Date(),
          pageCount: extraction.pageCount,
          wordCount: extraction.wordCount
        };

        // AI analysis
        if (extraction.text && extraction.text.length > 100) {
          document.aiAnalysis.status = 'processing';
          const analysis = await appraisalAIService.analyzeDocument(extraction.text, {
            employeeName: appraisal.employee.name,
            department: appraisal.employee.department
          });

          document.aiAnalysis = {
            status: 'completed',
            analyzedAt: new Date(),
            ...analysis
          };
        }
      } catch (extractError) {
        console.error('Text extraction error:', extractError);
        document.textExtraction.status = 'failed';
        document.textExtraction.error = extractError.message;
      }
    }

    await document.save();

    // Link to appraisal
    appraisal.documents.push(document._id);

    // Incorporate into conversation
    const incorporationResult = await appraisalAIService.incorporateDocumentIntoConversation(document, appraisal);

    // Add system message about document
    appraisal.chatThread.push({
      sender: { userId: 'system', name: 'System', role: 'system' },
      message: `Document uploaded: ${file.originalname}`,
      messageType: 'document_analysis',
      linkedDocumentId: document._id,
      createdAt: new Date()
    });

    // Add AI response about document
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: incorporationResult.message,
      messageType: 'document_analysis',
      linkedDocumentId: document._id,
      phase: appraisal.conversationAssessment?.currentPhase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: incorporationResult.tokensUsed
      },
      createdAt: new Date()
    });

    // Store document achievements in extracted data
    if (incorporationResult.insights?.extractedAchievements) {
      incorporationResult.insights.extractedAchievements.forEach(achievement => {
        appraisal.conversationAssessment.extractedData.achievements.push({
          text: achievement.description,
          linkedOkrId: null,
          confidence: achievement.confidence,
          extractedFrom: 'document'
        });
      });
    }

    appraisal.conversationAssessment.lastActivityAt = new Date();
    await appraisal.save();

    res.status(201).json({
      success: true,
      data: {
        document,
        aiMessage: incorporationResult.message,
        insights: incorporationResult.insights,
        chatThread: appraisal.chatThread.slice(-20)
      }
    });
  } catch (error) {
    removeRejectedUpload(req.file);
    console.error('Conversation upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/advance
 * Manually advance to the next conversation phase
 */
router.post('/:appraisalId/conversation/advance', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    const aiAssistEnabled = await isAiAssistEnabledForAppraisal(appraisal);
    if (!aiAssistEnabled) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle. Use the manual self-assessment form.'
      });
    }

    ensureConversationAssessmentState(appraisal);

    const { targetPhase } = req.body;
    const phases = ['initialized', 'okr_reflection', 'achievements', 'challenges', 'learnings', 'future_goals', 'competencies', 'report_generation', 'review', 'completed'];

    if (!targetPhase || !phases.includes(targetPhase)) {
      return res.status(400).json({ success: false, error: 'Invalid target phase' });
    }

    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'initialized';
    const currentIndex = phases.indexOf(currentPhase);
    const targetIndex = phases.indexOf(targetPhase);

    if (targetIndex <= currentIndex) {
      return res.status(400).json({ success: false, error: 'Can only advance to future phases' });
    }

    // Mark current phase as completed
    if (!appraisal.conversationAssessment.completedPhases.includes(currentPhase)) {
      appraisal.conversationAssessment.completedPhases.push(currentPhase);
    }

    appraisal.conversationAssessment.currentPhase = targetPhase;
    appraisal.conversationAssessment.lastActivityAt = new Date();

    // Add phase transition message
    const phaseMessages = {
      achievements: "Let's discuss your key achievements and accomplishments during this period.",
      challenges: "Now let's talk about the challenges you faced and how you addressed them.",
      learnings: "What new skills or knowledge did you develop during this period?",
      future_goals: "Let's set some goals for the next period. What do you want to achieve?",
      competencies: "Let's assess your competencies. How would you rate yourself on the key skills for your role?",
      report_generation: "I have enough information to generate your self-assessment report. Let me compile everything we discussed."
    };

    if (phaseMessages[targetPhase]) {
      appraisal.chatThread.push({
        sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
        message: phaseMessages[targetPhase],
        messageType: 'phase_transition',
        phase: targetPhase,
        aiContext: { isAiGenerated: true },
        createdAt: new Date()
      });
    }

    await appraisal.save();

    res.json({
      success: true,
      data: {
        currentPhase: targetPhase,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20)
      }
    });
  } catch (error) {
    console.error('Advance phase error:', error);
    res.status(500).json({ success: false, error: 'Failed to advance phase' });
  }
});

/**
 * GET /api/appraisals/:appraisalId/conversation/context
 * Get full conversation context and state
 */
router.get('/:appraisalId/conversation/context', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId))
      .populate(tenantCyclePopulate(req))
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);

    if (!isEmployee && !canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get OKRs
    const okrs = await OKR.find({
      organizationId: appraisal.organizationId,
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    res.json({
      success: true,
      data: {
        aiAssistEnabled: isAiAssistEnabledForCycle(appraisal.cycleId),
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread,
        okrs,
        documents: appraisal.documents,
        selfAssessment: appraisal.selfAssessment,
        employee: appraisal.employee,
        cycle: appraisal.cycleId
      }
    });
  } catch (error) {
    console.error('Get conversation context error:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversation context' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/generate-report
 * Generate the self-assessment report from conversation data
 */
router.post('/:appraisalId/conversation/generate-report', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId))
      .populate(tenantCyclePopulate(req))
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can generate the report' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle. Use the manual self-assessment form.'
      });
    }

    ensureConversationAssessmentState(appraisal);

    if (!appraisal.conversationAssessment?.startedAt || (appraisal.chatThread || []).length === 0) {
      return res.status(400).json({ success: false, error: 'Conversation has not been started yet' });
    }

    // Get OKRs
    const okrs = await OKR.find({
      organizationId: appraisal.organizationId,
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    // Generate report
    const report = await appraisalAIService.generateSelfAssessmentReport(
      appraisal,
      okrs,
      appraisal.documents
    );

    ensureConversationAssessmentState(appraisal);

    // Update conversation phase
    appraisal.conversationAssessment.currentPhase = 'review';
    if (!appraisal.conversationAssessment.completedPhases.includes('report_generation')) {
      appraisal.conversationAssessment.completedPhases.push('report_generation');
    }
    appraisal.conversationAssessment.lastActivityAt = new Date();

    const reportNeedsMoreDetail = Array.isArray(report?.missingInfo) && report.missingInfo.length > 0;
    const reportDraftMessage = reportNeedsMoreDetail
      ? "I've drafted your self-assessment report. Some sections could use more detail, but you can still refine and submit this draft now."
      : "I've generated your self-assessment report based on our conversation. Please review it below and let me know if you'd like any changes before submitting.";

    // Add report draft message
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: reportDraftMessage,
      messageType: 'report_draft',
      phase: 'review',
      structuredData: {
        type: 'report',
        data: report
      },
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: report.tokensUsed
      },
      createdAt: new Date()
    });

    await appraisal.save();

    res.json({
      success: true,
      data: {
        report,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-5)
      }
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/finalize-report
 * Finalize and submit the generated report
 */
router.post('/:appraisalId/conversation/finalize-report', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can finalize the report' });
    }

    if (!isSelfAssessmentEditable(appraisal)) {
      return res.status(400).json({
        success: false,
        error: `Self-assessment is not editable in '${appraisal.status}' status`
      });
    }

    ensureConversationAssessmentState(appraisal);
    const aiAssistEnabled = isAiAssistEnabledForCycle(appraisal.cycleId);

    const { report, edits } = req.body || {};

    if (!report || typeof report !== 'object') {
      return res.status(400).json({ success: false, error: 'Report data is required' });
    }

    // Apply any edits
    const finalReport = (edits && typeof edits === 'object') ? { ...report, ...edits } : report;

    const normalizedSummary = normalizeSelfAssessmentSummary(finalReport.overallSummary || {});
    const missingSummarySections = getMissingSelfAssessmentSections(normalizedSummary);

    // Employee must provide their own self-rating. AI rating is stored separately.
    const allowSelfRating = appraisal.cycleId?.settings?.allowSelfRating !== false;
    if (allowSelfRating) {
      const ratingRaw = finalReport.overallSelfRating;
      const rating = typeof ratingRaw === 'string' ? Number(ratingRaw) : ratingRaw;
      if (rating === undefined || rating === null) {
        return res.status(400).json({ success: false, error: 'Overall self-rating is required' });
      }
      if (typeof rating !== 'number' || Number.isNaN(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, error: 'Overall self-rating must be a number from 1 to 5' });
      }
      finalReport.overallSelfRating = rating;
    } else if (finalReport.overallSelfRating !== undefined && finalReport.overallSelfRating !== null) {
      const rating = typeof finalReport.overallSelfRating === 'string'
        ? Number(finalReport.overallSelfRating)
        : finalReport.overallSelfRating;
      if (typeof rating === 'number' && !Number.isNaN(rating) && rating >= 1 && rating <= 5) {
        finalReport.overallSelfRating = rating;
      } else {
        finalReport.overallSelfRating = undefined;
      }
    }

    const aiRatingSuggestion = finalReport.aiSuggestedRating || (
      finalReport.suggestedOverallRating || finalReport.ratingJustification ? {
        suggestedRating: finalReport.suggestedOverallRating,
        ratingJustification: finalReport.ratingJustification
      } : null
    );
    const normalizedAiRatingSuggestion = (
      aiRatingSuggestion &&
      typeof aiRatingSuggestion.suggestedRating === 'number' &&
      !Number.isNaN(aiRatingSuggestion.suggestedRating)
    ) ? aiRatingSuggestion : null;

    // Update self-assessment with report data.
    // Avoid writing undefined nested values (e.g., aiInsights) because that can trigger validation errors.
    const nextSelfAssessment = {
      overallSummary: normalizedSummary,
      competencyRatings: appraisal.selfAssessment?.competencyRatings || [],
      okrAssessment: finalReport.okrAssessment || appraisal.selfAssessment?.okrAssessment || [],
      overallSelfRating: finalReport.overallSelfRating,
      aiRatingSuggestion: normalizedAiRatingSuggestion ? {
        ...normalizedAiRatingSuggestion,
        generatedAt: new Date()
      } : null,
      submittedAt: new Date(),
      lastSavedAt: new Date()
    };

    const existingAiInsights = appraisal.selfAssessment?.aiInsights;
    if (existingAiInsights && typeof existingAiInsights.toObject === 'function') {
      nextSelfAssessment.aiInsights = existingAiInsights.toObject();
    } else if (existingAiInsights && typeof existingAiInsights === 'object') {
      nextSelfAssessment.aiInsights = existingAiInsights;
    } else {
      nextSelfAssessment.aiInsights = null;
    }

    appraisal.selfAssessment = nextSelfAssessment;

    // Generate AI insights only when AI assistance is enabled for this cycle.
    if (aiAssistEnabled) {
      try {
        const aiInsights = await appraisalAIService.analyzeSelfAssessment(
          appraisal.selfAssessment,
          appraisal.selfAssessment.okrAssessment || [],
          []
        );
        appraisal.selfAssessment.aiInsights = {
          ...aiInsights,
          generatedAt: new Date()
        };
      } catch (aiError) {
        console.error('AI insights error (finalize report):', aiError);
        // Keep whatever we already have (or none).
      }
    }

    ensureConversationAssessmentState(appraisal);

    // Update conversation state
    appraisal.conversationAssessment.currentPhase = 'completed';
    if (!appraisal.conversationAssessment.completedPhases.includes('review')) {
      appraisal.conversationAssessment.completedPhases.push('review');
    }
    appraisal.conversationAssessment.lastActivityAt = new Date();

    // Update status
    appraisal.status = 'manager_review_pending';

    addManagerNotification(
      appraisal,
      `${appraisal.employee.name} submitted a self-assessment and is ready for your review.`,
      'self_assessment_submitted'
    );

    // Add completion message
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: "Your self-assessment has been submitted successfully! Your manager will be notified to begin their review. Thank you for taking the time to reflect on your performance.",
      messageType: 'system',
      phase: 'completed',
      aiContext: { isAiGenerated: true },
      createdAt: new Date()
    });

    const auditActor = req.session?.user || {
      id: req.session?.user?.id || req.session?.user?.sub || 'unknown',
      name: req.session?.user?.name || req.session?.user?.email || 'Unknown User',
      role: req.userRole || 'employee'
    };

    appraisal.addAuditLog('self_assessment_submitted', auditActor, {
      mode: 'conversation',
      submissionWarnings: missingSummarySections
    });
    await appraisal.save();
    await syncCycleProgress(appraisal.cycleId?._id || appraisal.cycleId, appraisal.organizationId);

    // Notify manager
    await cancelAppraisalReminders(
      appraisal,
      'appraisal_self_assessment',
      appraisal.employee?.userId,
      'self_assessment_submitted'
    );
    await recordAppraisalEvent(appraisal, 'appraisal.self_submitted', auditActor, {
      recipients: appraisal.manager?.userId ? [{
        userId: appraisal.manager.userId,
        name: appraisal.manager.name,
        email: appraisal.manager.email
      }] : [],
      dueAt: appraisal.deadlines?.managerReviewDue,
      reminderTargetType: 'appraisal_manager_review',
      reminderTitle: 'Manager review due',
      reminderMessage: 'A submitted self-assessment is waiting for your review.',
      actionKind: 'review',
      actionLabel: 'Review assessment'
    });
    res.json({
      success: true,
      data: {
        appraisal,
        message: 'Self-assessment submitted successfully',
        warnings: missingSummarySections
      }
    });
  } catch (error) {
    console.error('Finalize report error:', error);
    const validationMessage = error?.name === 'ValidationError'
      ? Object.values(error.errors || {}).map((issue) => issue?.message).filter(Boolean).join('; ')
      : null;

    res.status(validationMessage ? 400 : 500).json({
      success: false,
      error: validationMessage || 'Failed to finalize report'
    });
  }
});

// =============================================
// SCORING ENDPOINTS
// =============================================

/**
 * GET /api/appraisals/:appraisalId/scoring
 * Get calculated scores for an appraisal
 */
router.get('/:appraisalId/scoring', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify access
    const isEmployee = isAppraisalEmployee(req, appraisal);
    const canManage = await canManageAppraisal(req, appraisal);

    if (!isEmployee && !canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Calculate scores
    const scores = appraisalAIService.calculateCompositeScore(appraisal, appraisal.cycleId);

    res.json({
      success: true,
      data: {
        ...scores,
        selfRating: appraisal.selfAssessment?.overallSelfRating,
        managerRating: appraisal.managerReview?.overallManagerRating,
        finalRating: appraisal.finalRating?.overall
      }
    });
  } catch (error) {
    console.error('Get scoring error:', error);
    res.status(500).json({ success: false, error: 'Failed to get scoring' });
  }
});

// Record a human decision on an AI suggestion. This endpoint deliberately
// does not copy suggested values into employee- or manager-owned fields.
router.post('/:appraisalId/ai-suggestions/:suggestionId/review', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId));
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });
    if (!(await canManageAppraisal(req, appraisal))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision must be accept or reject' });
    }
    const comment = String(req.body?.comment || '').trim().slice(0, 2000);
    if (decision === 'reject' && comment.length < 3) {
      return res.status(400).json({ success: false, error: 'A brief rejection reason is required' });
    }

    const review = (appraisal.aiSuggestionReviews || []).find(
      (item) => String(item.suggestionId) === String(req.params.suggestionId)
    );
    if (!review) return res.status(404).json({ success: false, error: 'AI suggestion not found' });
    if (review.status !== 'pending') {
      return res.status(409).json({ success: false, error: 'This AI suggestion has already been reviewed' });
    }

    review.status = decision === 'accept' ? 'accepted' : 'rejected';
    review.reviewedAt = new Date();
    review.reviewedBy = {
      userId: req.session.user.id || req.session.user.sub,
      name: req.session.user.name,
      role: req.userRole
    };
    review.reviewComment = comment || undefined;
    review.applied = false;
    appraisal.addAuditLog('ai_suggestion_reviewed', req.session.user, {
      suggestionId: review.suggestionId,
      suggestionType: review.suggestionType,
      decision,
      applied: false
    });
    await appraisal.save();

    return res.json({
      success: true,
      data: review,
      message: 'AI suggestion review recorded. No appraisal value was changed automatically.'
    });
  } catch (error) {
    console.error('AI suggestion review error:', error);
    return res.status(500).json({ success: false, error: 'Failed to review AI suggestion' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/ai-rating-suggestion
 * Get AI-suggested overall rating with justification
 */
router.post('/:appraisalId/ai-rating-suggestion', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId)).populate(tenantCyclePopulate(req));
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify manager access
    const canManage = await canManageAppraisal(req, appraisal);
    if (!canManage) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!isAiAssistEnabledForCycle(appraisal.cycleId)) {
      return res.status(400).json({
        success: false,
        error: 'AI assistance is disabled for this appraisal cycle'
      });
    }

    // Get OKRs
    const okrs = await OKR.find({
      organizationId: appraisal.organizationId,
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    // Get AI suggestion
    const suggestion = await appraisalAIService.generateAISuggestedRating(appraisal, okrs);

    // Also get calculated score for comparison
    const calculatedScore = appraisalAIService.calculateCompositeScore(appraisal, appraisal.cycleId);

    const suggestionId = crypto.randomUUID();
    appraisal.aiSuggestionReviews = appraisal.aiSuggestionReviews || [];
    appraisal.aiSuggestionReviews.push({
      suggestionId,
      suggestionType: 'manager_rating',
      suggestion,
      evidence: {
        goalSnapshotIds: (appraisal.goalSnapshots || []).map((snapshot) => String(snapshot.sourceGoalId)),
        documentIds: (appraisal.documents || []).map(String),
        selfAssessmentSubmittedAt: appraisal.selfAssessment?.submittedAt,
        managerReviewSubmittedAt: appraisal.managerReview?.submittedAt,
        calculatedScore
      },
      modelUsed: suggestion?.modelUsed,
      status: 'pending',
      generatedAt: new Date(),
      applied: false
    });
    appraisal.addAuditLog('ai_suggestion_generated', req.session.user, {
      suggestionId,
      suggestionType: 'manager_rating',
      evidenceAttached: true,
      advisoryOnly: true
    });
    await appraisal.save();

    res.json({
      success: true,
      data: {
        suggestionId,
        suggestionStatus: 'pending',
        advisoryOnly: true,
        aiSuggestion: suggestion,
        calculatedScore,
        selfRating: appraisal.selfAssessment?.overallSelfRating,
        comparison: {
          aiVsSelf: suggestion.suggestedRating - (appraisal.selfAssessment?.overallSelfRating || 0),
          aiVsCalculated: suggestion.suggestedRating - calculatedScore.suggestedRating
        }
      }
    });
  } catch (error) {
    console.error('AI rating suggestion error:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI rating suggestion' });
  }
});

module.exports = router;
