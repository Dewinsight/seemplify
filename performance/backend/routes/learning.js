const express = require('express');
const LearningRecord = require('../models/LearningRecord');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const { canAccessEmployee, getActorId } = require('../services/tenantPolicy');
const { activityStatus, synchronizeLinkedDevelopmentPlans } = require('../services/learningRecordService');

const router = express.Router();
const text = (value) => String(value || '').trim();

function actorIdentifiers(req) {
  return Array.from(new Set([
    getActorId(req),
    req.session?.user?.id,
    req.session?.user?._id,
    req.session?.user?.sub,
    req.session?.user?.idpSub,
    req.session?.user?.userinfo?.sub
  ].map(text).filter(Boolean)));
}

function recordQueryForEmployee(organizationId, employeeId, identifiers = []) {
  const ids = Array.from(new Set([employeeId, ...identifiers].map(text).filter(Boolean)));
  return {
    organizationId,
    $or: [
      { subjectId: { $in: ids } },
      { performanceUserId: { $in: ids } }
    ]
  };
}

router.get('/team', async (req, res) => {
  try {
    if (!['team_lead', 'line_manager', 'hr_admin'].includes(req.userRole)) {
      return res.status(403).json({ success: false, error: 'Manager access is required' });
    }
    const directReports = (req.directReports || []).map(text).filter(Boolean);
    const query = { organizationId: req.organizationId };
    if (req.userRole !== 'hr_admin') {
      query.$or = [
        { subjectId: { $in: directReports } },
        { performanceUserId: { $in: directReports } }
      ];
    }
    const records = await LearningRecord.find(query)
      .sort({ lastActivityAt: -1, updatedAt: -1 })
      .limit(1000)
      .lean();
    const learnerMap = new Map();
    for (const record of records) {
      const employeeId = text(record.subjectId || record.performanceUserId);
      if (!employeeId) continue;
      const existing = learnerMap.get(employeeId) || {
        employeeId,
        identifiers: Array.from(new Set([record.subjectId, record.performanceUserId].map(text).filter(Boolean))),
        name: record.learnerName || record.learnerEmail || 'Team member',
        email: record.learnerEmail || '',
        total: 0,
        assigned: 0,
        inProgress: 0,
        completed: 0,
        overdue: 0,
        lastActivityAt: record.lastActivityAt || record.updatedAt
      };
      existing.total += 1;
      if (record.status === 'completed') existing.completed += 1;
      else if (record.status === 'in_progress') existing.inProgress += 1;
      else existing.assigned += 1;
      if (record.status !== 'completed' && record.dueAt && new Date(record.dueAt).getTime() < Date.now()) existing.overdue += 1;
      learnerMap.set(employeeId, existing);
    }
    const learners = Array.from(learnerMap.values()).sort((left, right) => left.name.localeCompare(right.name));
    return res.json({ success: true, data: { learners, totalLearners: learners.length } });
  } catch (error) {
    console.error('Error fetching team Learning records:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch team Learning records' });
  }
});

router.get('/records', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const requestedEmployeeId = text(req.query.employeeId || actorId);
    if (!requestedEmployeeId || !canAccessEmployee(req, requestedEmployeeId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const ownRequest = requestedEmployeeId === text(actorId);
    const records = await LearningRecord.find(recordQueryForEmployee(
      req.organizationId,
      requestedEmployeeId,
      ownRequest ? actorIdentifiers(req) : []
    )).sort({ lastActivityAt: -1, updatedAt: -1 }).limit(250).lean();
    const now = Date.now();
    const summary = records.reduce((result, record) => {
      result.total += 1;
      if (record.status === 'completed') result.completed += 1;
      else if (record.status === 'in_progress') result.inProgress += 1;
      else result.assigned += 1;
      if (record.status !== 'completed' && record.dueAt && new Date(record.dueAt).getTime() < now) result.overdue += 1;
      return result;
    }, { total: 0, assigned: 0, inProgress: 0, completed: 0, overdue: 0 });

    return res.json({
      success: true,
      data: {
        records,
        summary,
        employeeId: requestedEmployeeId,
        learningUrl: process.env.LEARNING_APP_URL || 'https://learning.seemplifyai.com'
      }
    });
  } catch (error) {
    console.error('Error fetching synchronized Learning records:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch Learning records' });
  }
});

router.post('/records/:recordId/link-plan', async (req, res) => {
  try {
    const record = await LearningRecord.findOne({
      _id: req.params.recordId,
      organizationId: req.organizationId
    });
    if (!record) return res.status(404).json({ success: false, error: 'Learning record not found' });

    const plan = await DevelopmentPlan.findOne({
      _id: text(req.body.planId),
      organizationId: req.organizationId
    });
    if (!plan) return res.status(404).json({ success: false, error: 'Development plan not found' });
    if (!canAccessEmployee(req, plan.userId) && text(plan.managerId) !== text(getActorId(req))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const recordOwners = new Set([record.subjectId, record.performanceUserId].map(text).filter(Boolean));
    if (!recordOwners.has(text(plan.userId))) {
      return res.status(400).json({ success: false, error: 'This course belongs to a different employee' });
    }

    const existing = plan.learningActivities.find((activity) => (
      text(activity.learningEnrollmentId) === text(record.enrollmentId)
    ));
    if (!existing) {
      plan.learningActivities.push({
        title: record.courseTitle,
        type: 'course',
        description: record.courseCategory ? `${record.courseCategory} course` : 'Seemplify Learning course',
        dueDate: record.dueAt || plan.targetDate,
        status: activityStatus(record),
        completedAt: record.completedAt,
        evidence: record.status === 'completed' ? record.courseUrl : '',
        source: 'seemplify_learning',
        provider: 'Seemplify Learning',
        learningCourseId: record.courseId,
        learningEnrollmentId: record.enrollmentId,
        progressPercent: record.progressPercent,
        courseUrl: record.courseUrl,
        lastSyncedAt: new Date()
      });
      await plan.save();
    }
    await synchronizeLinkedDevelopmentPlans(record);
    const updatedPlan = await DevelopmentPlan.findById(plan._id);
    return res.json({ success: true, data: updatedPlan, alreadyLinked: Boolean(existing) });
  } catch (error) {
    console.error('Error linking Learning record to development plan:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({
      success: false,
      error: 'Failed to link this course to the development plan'
    });
  }
});

module.exports = router;
