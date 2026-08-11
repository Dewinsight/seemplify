const express = require('express');
const mongoose = require('mongoose');
const OKR = require('../models/OKR');
const PerformanceCheckIn = require('../models/PerformanceCheckIn');
const OneOnOne = require('../models/OneOnOne');
const Feedback = require('../models/Feedback');
const Recognition = require('../models/Recognition');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const Appraisal = require('../models/Appraisal');
const PerformanceSupportPlan = require('../models/PerformanceSupportPlan');
const User = require('../models/User');
const { requirePermission } = require('../middleware/rbac');
const { getActorId, tenantFilter } = require('../services/tenantPolicy');

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY);
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

router.get('/practices', requirePermission('manager_practice:view:team'), async (req, res) => {
  try {
    const actorId = getActorId(req);
    let employeeIds = req.userRole === 'hr_admin' && req.query.scope === 'organization'
      ? unique((await Appraisal.find(tenantFilter(req)).select('employee.userId').lean()).map(item => item.employee?.userId))
      : unique(req.directReports || []);
    if (req.query.employeeId) {
      const requested = String(req.query.employeeId);
      if (!employeeIds.includes(requested)) return res.status(403).json({ success: false, error: 'That employee is outside your coaching scope' });
      employeeIds = [requested];
    }
    if (employeeIds.length === 0) {
      return res.json({ success: true, data: { scope: { employeeCount: 0 }, summary: {}, attention: [], definitions: [] } });
    }

    const organizationId = tenantFilter(req).organizationId;
    const objectIds = employeeIds.filter(employeeId => mongoose.Types.ObjectId.isValid(employeeId));
    const [goals, checkIns, meetings, feedback, recognition, developmentPlans, appraisals, supportPlans, people] = await Promise.all([
      OKR.find(tenantFilter(req, { ownerId: { $in: employeeIds }, type: 'individual', status: { $in: ['active', 'pending'] } })).select('ownerId title progress objectives updatedAt').lean(),
      PerformanceCheckIn.find(tenantFilter(req, { employeeId: { $in: employeeIds }, status: 'submitted', visibility: 'employee_manager', periodEnd: { $gte: daysAgo(45) } })).select('employeeId periodEnd managerResponse blockers supportNeeded').lean(),
      OneOnOne.find(tenantFilter(req, { employeeId: { $in: employeeIds }, scheduledDate: { $gte: daysAgo(90) } })).select('employeeId scheduledDate status actionItems').lean(),
      Feedback.find(tenantFilter(req, { receiverId: { $in: employeeIds }, deletedAt: null, createdAt: { $gte: daysAgo(90) } })).select('receiverId createdAt').lean(),
      Recognition.find(tenantFilter(req, { 'recipient.userId': { $in: employeeIds }, status: 'active', createdAt: { $gte: daysAgo(90) } })).select('recipient.userId createdAt').lean(),
      DevelopmentPlan.find(tenantFilter(req, { userId: { $in: employeeIds }, status: { $in: ['active', 'draft'] } })).select('userId status milestones targetDate').lean(),
      Appraisal.find(tenantFilter(req, { 'employee.userId': { $in: employeeIds }, status: { $nin: ['completed', 'employee_acknowledged', 'cancelled'] } })).select('employee status cycleId').lean(),
      PerformanceSupportPlan.find(tenantFilter(req, { 'employee.userId': { $in: employeeIds }, state: { $in: ['active', 'review_due', 'extended', 'hr_review'] } })).select('employee state reviewDates milestones').lean(),
      User.find({
        isActive: { $ne: false },
        $and: [
          { $or: [{ idpSub: { $in: employeeIds } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
          {
            $or: [
              { 'idpTeams.organizationId': organizationId },
              { organizationMemberships: { $elemMatch: { organization: organizationId, isActive: true } } }
            ]
          }
        ]
      }).select('idpSub email profile').lean()
    ]);

    const personName = new Map();
    for (const person of people) {
      const displayName = person.profile?.displayName
        || [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ')
        || person.email;
      if (person.idpSub) personName.set(String(person.idpSub), displayName);
      personName.set(String(person._id), displayName);
    }
    for (const item of appraisals) {
      const employeeId = String(item.employee?.userId || '');
      if (employeeId && !personName.has(employeeId)) personName.set(employeeId, item.employee?.name || item.employee?.email);
    }
    const attention = [];
    for (const employeeId of employeeIds) {
      const employeeGoals = goals.filter(item => String(item.ownerId) === employeeId);
      const atRisk = employeeGoals.filter(goal => (goal.objectives || []).some(objective => (objective.keyResults || []).some(result => ['at_risk', 'off_track'].includes(result.health))));
      const recentCheckIn = checkIns.filter(item => String(item.employeeId) === employeeId).sort((a, b) => b.periodEnd - a.periodEnd)[0];
      const lastMeeting = meetings.filter(item => String(item.employeeId) === employeeId && item.status === 'completed').sort((a, b) => b.scheduledDate - a.scheduledDate)[0];
      const overdueActions = meetings.flatMap(item => item.actionItems || []).filter(item => item.assignedTo === 'manager' && ['pending', 'in_progress'].includes(item.status) && item.dueDate && item.dueDate < new Date()).length;
      const recentFeedbackCount = feedback.filter(item => String(item.receiverId) === employeeId).length;
      const recognitionCount = recognition.filter(item => String(item.recipient?.userId) === employeeId).length;
      const plans = developmentPlans.filter(item => String(item.userId) === employeeId);
      const support = supportPlans.filter(item => String(item.employee?.userId) === employeeId);
      const openAppraisals = appraisals.filter(item => String(item.employee?.userId) === employeeId);
      const employeeName = personName.get(employeeId) || `Employee ${employeeId.slice(-6)}`;

      if (atRisk.length) attention.push({ type: 'goal_risk', priority: 'high', employeeId, employeeName, count: atRisk.length, message: `${atRisk.length} goal${atRisk.length === 1 ? '' : 's'} need a progress conversation`, href: `/okrs?view=team&employee=${encodeURIComponent(employeeId)}` });
      if (!recentCheckIn || recentCheckIn.periodEnd < daysAgo(21)) attention.push({ type: 'check_in_gap', priority: 'medium', employeeId, employeeName, message: 'No submitted check-in in the last 21 days', href: `/check-ins?employee=${encodeURIComponent(employeeId)}` });
      else if (!recentCheckIn.managerResponse?.respondedAt) attention.push({ type: 'check_in_response', priority: 'medium', employeeId, employeeName, message: 'A check-in is waiting for your response', href: `/check-ins?id=${recentCheckIn._id}` });
      if (!lastMeeting || lastMeeting.scheduledDate < daysAgo(45)) attention.push({ type: 'one_on_one_gap', priority: 'medium', employeeId, employeeName, message: 'No completed 1:1 in the last 45 days', href: `/one-on-ones/new?employee=${encodeURIComponent(employeeId)}` });
      if (overdueActions) attention.push({ type: 'overdue_action', priority: 'high', employeeId, employeeName, count: overdueActions, message: `${overdueActions} manager-owned 1:1 action${overdueActions === 1 ? '' : 's'} overdue`, href: '/one-on-ones' });
      if (recentFeedbackCount === 0) attention.push({ type: 'feedback_gap', priority: 'low', employeeId, employeeName, message: 'No feedback recorded in the last 90 days', href: `/feedback/new?receiverId=${encodeURIComponent(employeeId)}` });
      if (recognitionCount === 0) attention.push({ type: 'recognition_gap', priority: 'low', employeeId, employeeName, message: 'No recognition recorded in the last 90 days', href: `/recognition?recipient=${encodeURIComponent(employeeId)}` });
      if (plans.length === 0) attention.push({ type: 'development_gap', priority: 'low', employeeId, employeeName, message: 'No active development plan', href: '/development' });
      if (support.some(item => ['review_due', 'hr_review'].includes(item.state))) attention.push({ type: 'support_plan_due', priority: 'high', employeeId, employeeName, message: 'A support plan needs review', href: `/support-plans?view=team&employee=${encodeURIComponent(employeeId)}` });
      if (openAppraisals.length) attention.push({ type: 'appraisal_open', priority: 'medium', employeeId, employeeName, count: openAppraisals.length, message: 'Appraisal work is still open', href: `/appraisals?view=team&employee=${encodeURIComponent(employeeId)}` });
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    attention.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.employeeName.localeCompare(b.employeeName));
    const checkInCovered = new Set(checkIns.map(item => String(item.employeeId))).size;
    const oneOnOneCovered = new Set(meetings.filter(item => item.status === 'completed' && item.scheduledDate >= daysAgo(45)).map(item => String(item.employeeId))).size;
    const feedbackCovered = new Set(feedback.map(item => String(item.receiverId))).size;
    const recognitionCovered = new Set(recognition.map(item => String(item.recipient?.userId))).size;
    return res.json({
      success: true,
      data: {
        generatedAt: new Date(),
        scope: { employeeCount: employeeIds.length, managerId: actorId, organizationWide: req.userRole === 'hr_admin' && req.query.scope === 'organization' },
        summary: {
          atRiskGoals: goals.filter(goal => (goal.objectives || []).some(objective => (objective.keyResults || []).some(result => ['at_risk', 'off_track'].includes(result.health)))).length,
          checkInCoverage: Math.round((checkInCovered / employeeIds.length) * 100),
          oneOnOneCoverage: Math.round((oneOnOneCovered / employeeIds.length) * 100),
          feedbackCoverage: Math.round((feedbackCovered / employeeIds.length) * 100),
          recognitionCoverage: Math.round((recognitionCovered / employeeIds.length) * 100),
          openAppraisals: appraisals.length,
          supportPlansDue: supportPlans.filter(item => ['review_due', 'hr_review'].includes(item.state)).length
        },
        attention,
        definitions: [
          { key: 'checkInCoverage', label: 'Check-in coverage', definition: 'Direct reports with a submitted check-in in the last 45 days.' },
          { key: 'oneOnOneCoverage', label: '1:1 coverage', definition: 'Direct reports with a completed 1:1 in the last 45 days.' },
          { key: 'feedbackCoverage', label: 'Feedback coverage', definition: 'Direct reports with feedback recorded in the last 90 days.' },
          { key: 'recognitionCoverage', label: 'Recognition coverage', definition: 'Direct reports with recognition recorded in the last 90 days.' }
        ],
        safeguards: ['These signals organize manager follow-up; they do not score or rank employees.', 'Private check-in content and feedback analysis are excluded.']
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load manager practices' });
  }
});

module.exports = router;
