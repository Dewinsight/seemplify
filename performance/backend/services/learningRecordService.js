const LearningRecord = require('../models/LearningRecord');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const User = require('../models/User');

const text = (value) => String(value || '').trim();
const numberInRange = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const asDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function isLearningEvent(event) {
  return /^learning\.enrollment\.(?:assigned|started|progressed|completed|snapshot)$/.test(text(event));
}

function validateLearningEvent(event, data, envelope) {
  if (!isLearningEvent(event)) return null;
  const organizationId = text(data.organizationId || envelope.organizationId);
  const subjectId = text(data.subjectId || data.userId || envelope.subjectId);
  const enrollmentId = text(data.enrollmentId);
  const courseId = text(data.courseId);
  const courseTitle = text(data.courseTitle);
  if (!organizationId || !subjectId || !enrollmentId || !courseId || !courseTitle) {
    const error = new Error('Learning events require organization, subject, enrollment, and course identity');
    error.statusCode = 400;
    throw error;
  }
  if (text(envelope.organizationId) !== organizationId) {
    const error = new Error('Learning event organization does not match its signed envelope');
    error.statusCode = 400;
    throw error;
  }
  return { organizationId, subjectId, enrollmentId, courseId, courseTitle };
}

async function resolvePerformanceUserId({ organizationId, subjectId, learnerEmail }) {
  const identities = [{ idpSub: subjectId }];
  if (learnerEmail) identities.push({ email: learnerEmail });
  const user = await User.findOne({
    $and: [
      { $or: identities },
      {
        $or: [
          { currentOrganization: organizationId },
          { currentOrganizationId: organizationId },
          { 'organizationMemberships.organization': organizationId },
          { 'idpOrganizations.id': organizationId }
        ]
      }
    ]
  }).select('_id idpSub').lean();
  return user ? text(user._id) : '';
}

const activityStatus = (record) => {
  if (record.status === 'completed' || Number(record.progressPercent) >= 100) return 'completed';
  if (record.status === 'in_progress' || Number(record.progressPercent) > 0) return 'in_progress';
  return 'not_started';
};

async function synchronizeLinkedDevelopmentPlans(record) {
  const plans = await DevelopmentPlan.find({
    organizationId: record.organizationId,
    'learningActivities.learningEnrollmentId': record.enrollmentId
  });
  for (const plan of plans) {
    let changed = false;
    for (const activity of plan.learningActivities) {
      if (text(activity.learningEnrollmentId) !== record.enrollmentId) continue;
      activity.title = record.courseTitle;
      activity.status = activityStatus(record);
      activity.progressPercent = record.progressPercent;
      activity.courseUrl = record.courseUrl;
      activity.lastSyncedAt = new Date();
      activity.completedAt = activity.status === 'completed' ? record.completedAt || new Date() : undefined;
      activity.evidence = activity.status === 'completed' ? record.courseUrl : activity.evidence;
      changed = true;
    }

    const normalizedTags = new Set((record.courseTags || []).map((tag) => text(tag).toLowerCase()));
    if (normalizedTags.size > 0) {
      for (const skill of plan.skillDevelopment) {
        if (!normalizedTags.has(text(skill.skillName).toLowerCase())) continue;
        skill.progress = Math.max(Number(skill.progress || 0), Number(record.progressPercent || 0));
        changed = true;
      }
    }
    if (changed) await plan.save();
  }
}

async function upsertLearningRecordFromEvent(event, data = {}, envelope = {}) {
  const identity = validateLearningEvent(event, data, envelope);
  if (!identity) return null;

  const learnerEmail = text(data.learnerEmail).toLowerCase();
  const incomingSourceUpdatedAt = asDate(data.lastActivityAt || envelope.occurredAt) || new Date();
  let record = await LearningRecord.findOne({
    organizationId: identity.organizationId,
    enrollmentId: identity.enrollmentId
  });
  if (record?.sourceUpdatedAt && record.sourceUpdatedAt > incomingSourceUpdatedAt) return record;

  const performanceUserId = await resolvePerformanceUserId({
    organizationId: identity.organizationId,
    subjectId: identity.subjectId,
    learnerEmail
  });
  const status = ['assigned', 'in_progress', 'completed'].includes(text(data.status))
    ? text(data.status)
    : (event.endsWith('.completed') ? 'completed' : 'assigned');
  const updates = {
    ...identity,
    performanceUserId,
    learningAccountId: text(data.learningAccountId),
    learnerEmail,
    learnerName: text(data.learnerName),
    courseUrl: text(data.courseUrl),
    courseCategory: text(data.courseCategory),
    courseLevel: text(data.courseLevel),
    courseTags: Array.isArray(data.courseTags) ? data.courseTags.map(text).filter(Boolean) : [],
    lessonCount: Math.max(0, Number(data.lessonCount) || 0),
    completedLessonCount: Math.max(0, Number(data.completedLessonCount) || 0),
    status,
    progressPercent: status === 'completed' ? 100 : numberInRange(data.progressPercent, 0, 100),
    latestQuizScore: Math.max(0, Number(data.latestQuizScore) || 0),
    assignmentType: text(data.assignmentType),
    assignmentSource: text(data.assignmentSource),
    assignedAt: asDate(data.assignedAt),
    dueAt: asDate(data.dueAt),
    startedAt: asDate(data.startedAt),
    completedAt: asDate(data.completedAt),
    lastActivityAt: asDate(data.lastActivityAt),
    sourceUpdatedAt: incomingSourceUpdatedAt,
    lastEventId: text(envelope.eventId),
    source: 'seemplify_learning'
  };

  if (record) {
    Object.assign(record, updates);
    await record.save();
  } else {
    record = await LearningRecord.create(updates);
  }
  await synchronizeLinkedDevelopmentPlans(record);
  return record;
}

module.exports = {
  activityStatus,
  isLearningEvent,
  synchronizeLinkedDevelopmentPlans,
  upsertLearningRecordFromEvent,
  validateLearningEvent
};
