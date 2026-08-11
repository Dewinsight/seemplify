const express = require('express');
const mongoose = require('mongoose');
const PerformanceSupportPlan = require('../models/PerformanceSupportPlan');
const User = require('../models/User');
const { requirePermission, requireHRAdmin } = require('../middleware/rbac');
const { getActorId, canAccessEmployee, tenantFilter } = require('../services/tenantPolicy');
const { requireOrganizationFeature } = require('../services/organizationFeatureService');
const aiGatewayService = require('../services/aiGatewayService');
const { AI_ACTIVITIES } = require('../config/aiActivityCatalog');

const router = express.Router();

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function identity(value = {}, fallbackId = '') {
  return {
    userId: text(value.userId || value.id || fallbackId, 240),
    name: text(value.name, 240),
    email: text(value.email, 320),
    ...(value.jobTitle ? { jobTitle: text(value.jobTitle, 240) } : {}),
    ...(value.teamId ? { teamId: text(value.teamId, 240) } : {}),
    ...(value.teamName ? { teamName: text(value.teamName, 240) } : {})
  };
}

function audit(plan, req, action, details) {
  plan.audit.push({
    action,
    actorId: getActorId(req),
    actorRole: req.userRole || 'employee',
    details
  });
}

async function recordEvent(input) {
  try {
    const { recordEvent: publish } = require('../services/outboxService');
    await publish(input);
  } catch (error) {
    console.warn('Support-plan event was not recorded:', error.message);
  }
}

async function organizationHrRecipients(organizationId) {
  const users = await User.find({
    isActive: { $ne: false },
    $or: [
      { currentOrganizationId: organizationId, 'idpOrganizations': { $elemMatch: { id: organizationId, role: { $in: ['owner', 'admin', 'hr_manager'] } } } },
      { 'idpOrganizations': { $elemMatch: { id: organizationId, role: { $in: ['owner', 'admin', 'hr_manager'] } } } },
      { 'organizationMemberships': { $elemMatch: { organization: organizationId, role: { $in: ['owner', 'admin', 'hr_manager'] }, isActive: true } } }
    ]
  }).select('idpSub').lean();
  return users.map(user => ({ userId: String(user.idpSub || user._id) }));
}

async function cancelActions(plan) {
  try {
    const { cancelRemindersForTarget } = require('../services/reminderScheduler');
    await Promise.all(['PerformanceSupportPlan', 'support_plan_hr_review', 'support_plan_employee_response', 'support_plan_review'].map(targetType => cancelRemindersForTarget({
      organizationId: plan.organizationId, targetType, targetId: String(plan._id)
    })));
  } catch (error) {
    console.warn('Support-plan actions were not closed:', error.message);
  }
}

async function schedulePlanAction({ plan, eventType, recipient, targetType, dueAt, label }) {
  if (!recipient?.userId || !dueAt) return;
  try {
    const { scheduleReminderSequence } = require('../services/reminderScheduler');
    await scheduleReminderSequence({
      organizationId: plan.organizationId,
      eventType,
      target: { type: targetType, id: String(plan._id) },
      recipient,
      dueAt,
      deepLink: `/support-plans?plan=${plan._id}`,
      notification: { category: 'support_plan', title: label, message: 'A support-plan action needs attention.', action: { kind: 'review', label: 'Open plan' } }
    });
  } catch (error) {
    console.warn('Support-plan reminders were not scheduled:', error.message);
  }
}

function canView(req, plan) {
  const actorId = getActorId(req);
  const employeeCanView = plan.employee.userId === actorId
    && !['draft', 'hr_review', 'changes_requested'].includes(plan.state);
  return req.userRole === 'hr_admin'
    || employeeCanView
    || plan.manager.userId === actorId
    || (req.directReports || []).map(String).includes(String(plan.employee.userId));
}

function canManage(req, plan) {
  const actorId = getActorId(req);
  return req.userRole === 'hr_admin'
    || plan.manager.userId === actorId
    || (req.directReports || []).map(String).includes(String(plan.employee.userId));
}

async function loadPlan(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ success: false, error: 'Support plan not found' });
    return null;
  }
  const plan = await PerformanceSupportPlan.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!plan) {
    res.status(404).json({ success: false, error: 'Support plan not found' });
    return null;
  }
  if (!canView(req, plan)) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return null;
  }
  return plan;
}

router.get('/', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const query = tenantFilter(req);
    const requestedView = String(req.query.view || 'mine');
    if (requestedView === 'hr_review') {
      if (req.userRole !== 'hr_admin') return res.status(403).json({ success: false, error: 'HR access is required' });
      query.state = { $in: ['hr_review', 'review_due', 'escalated'] };
    } else if (requestedView === 'team') {
      if (!['line_manager', 'team_lead', 'hr_admin'].includes(req.userRole)) {
        return res.status(403).json({ success: false, error: 'Manager access is required' });
      }
      if (req.userRole !== 'hr_admin') {
        const reportIds = (req.directReports || []).map(String);
        query.$or = [{ 'manager.userId': actorId }, { 'employee.userId': { $in: reportIds } }];
      }
    } else {
      query.$or = [
        { 'employee.userId': actorId, state: { $nin: ['draft', 'hr_review', 'changes_requested'] } },
        { 'manager.userId': actorId }
      ];
    }
    if (req.query.state) query.state = String(req.query.state);
    const data = await PerformanceSupportPlan.find(query).sort({ updatedAt: -1 }).limit(200).lean();
    return res.json({ success: true, data, count: data.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load support plans' });
  }
});

router.post('/ai-draft', requirePermission('support_plan:manage:direct_reports'), requireOrganizationFeature('continuousCoachingAi'), async (req, res) => {
  try {
    const context = {
      planType: ['informal_support', 'formal_improvement'].includes(req.body.planType) ? req.body.planType : 'informal_support',
      concern: text(req.body.concern, 3000),
      expectedStandard: text(req.body.expectedStandard, 3000),
      timeframeDays: Math.min(180, Math.max(7, Number(req.body.timeframeDays) || 30)),
      availableSupport: (Array.isArray(req.body.availableSupport) ? req.body.availableSupport : []).map(item => text(item, 500)).filter(Boolean).slice(0, 10)
    };
    if (!context.concern || !context.expectedStandard) {
      return res.status(400).json({ success: false, error: 'Describe the concern and expected standard first' });
    }
    const result = await aiGatewayService.getChatCompletions([
      {
        role: 'system',
        content: 'You help a manager draft a fair workplace support plan. Produce neutral, observable, measurable language. Do not diagnose, rank, recommend dismissal, infer protected traits, or make an employment decision. Return JSON only.'
      },
      { role: 'user', content: JSON.stringify(context) }
    ], {
      activity: AI_ACTIVITIES.SUPPORT_PLAN_DRAFT,
      temperature: 0.2,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'objectives', 'supportCommitments', 'reviewCadence'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          objectives: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['title', 'measure', 'target'], properties: { title: { type: 'string' }, measure: { type: 'string' }, target: { type: 'string' } } } },
          supportCommitments: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
          reviewCadence: { type: 'string' }
        }
      }
    });
    const content = String(result?.choices?.[0]?.message?.content || '').trim();
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let draft;
    try { draft = JSON.parse(jsonText); } catch { return res.status(502).json({ success: false, error: 'The AI draft was not valid JSON. Try again or continue manually.', code: 'AI_RESPONSE_INVALID' }); }
    return res.json({
      success: true,
      data: {
        suggestionId: String(result.id || new mongoose.Types.ObjectId()),
        draft,
        advisory: true,
        requiresHumanReview: true,
        exclusions: ['No employee rating', 'No disciplinary outcome', 'No protected-characteristic inference'],
        provider: result.provider,
        activity: AI_ACTIVITIES.SUPPORT_PLAN_DRAFT
      }
    });
  } catch (error) {
    return res.status(Number(error.statusCode) || 503).json({
      success: false,
      error: error.message || 'AI drafting is unavailable. Continue manually.',
      code: error.code || 'AI_UNAVAILABLE',
      manualCompletionAvailable: true
    });
  }
});

router.post('/', requirePermission('support_plan:manage:direct_reports'), async (req, res) => {
  try {
    const actorId = getActorId(req);
    let employee = identity(req.body.employee);
    if (!employee.userId) return res.status(400).json({ success: false, error: 'Employee is required' });
    const employeeRecord = await User.findOne({
        isActive: { $ne: false },
        $and: [
          { $or: [{ idpSub: employee.userId }, ...(/^[a-f\d]{24}$/i.test(employee.userId) ? [{ _id: employee.userId }] : [])] },
          { $or: [{ 'idpTeams.organizationId': req.organizationId }, { organizationMemberships: { $elemMatch: { organization: req.organizationId, isActive: true } } }] }
        ]
      }).select('idpSub email profile idpTeams').lean();
    if (req.userRole === 'hr_admin' && !employeeRecord) {
      return res.status(400).json({ success: false, error: 'Choose an employee in the active organization' });
    }
    if (employeeRecord) {
      const team = (employeeRecord.idpTeams || []).find(item => String(item.organizationId) === req.organizationId);
      employee = identity({
        userId: String(employeeRecord.idpSub || employeeRecord._id),
        name: employeeRecord.profile?.displayName || [employeeRecord.profile?.firstName, employeeRecord.profile?.lastName].filter(Boolean).join(' ') || employee.name,
        email: employeeRecord.email || employee.email,
        jobTitle: employeeRecord.profile?.title,
        teamId: team?.id,
        teamName: team?.name
      });
    }
    if (!canAccessEmployee(req, employee.userId) || employee.userId === actorId) {
      return res.status(403).json({ success: false, error: 'Choose an employee you are authorized to support' });
    }
    const planType = ['informal_support', 'formal_improvement'].includes(req.body.planType)
      ? req.body.planType
      : 'informal_support';
    const manager = identity(req.body.manager, actorId);
    manager.userId = actorId;
    const objectives = Array.isArray(req.body.objectives) ? req.body.objectives.slice(0, 20).map(item => ({
      title: text(item.title, 240),
      measure: text(item.measure, 1000),
      target: text(item.target, 1000),
      dueDate: item.dueDate,
      status: 'not_started'
    })) : [];
    const supportCommitments = Array.isArray(req.body.supportCommitments)
      ? req.body.supportCommitments.slice(0, 20).map(item => ({
        description: text(item.description, 1200),
        ownerType: ['manager', 'hr', 'organization'].includes(item.ownerType) ? item.ownerType : 'manager',
        ownerId: text(item.ownerId || actorId, 240),
        dueDate: item.dueDate,
        status: 'open'
      }))
      : [];
    const suggestedDraft = req.body.aiAssistance?.draft;
    const aiAssistance = req.body.aiAssistance?.suggestionId && suggestedDraft && typeof suggestedDraft === 'object'
      ? [{
        activity: AI_ACTIVITIES.SUPPORT_PLAN_DRAFT,
        status: 'accepted',
        evidenceSummary: 'The manager supplied a de-identified concern and expected standard, then reviewed the generated wording before saving.',
        output: {
          suggestionId: text(req.body.aiAssistance.suggestionId, 240),
          title: text(suggestedDraft.title, 240),
          summary: text(suggestedDraft.summary, 5000),
          objectives: (Array.isArray(suggestedDraft.objectives) ? suggestedDraft.objectives : []).slice(0, 5).map(item => ({
            title: text(item.title, 240), measure: text(item.measure, 1000), target: text(item.target, 1000)
          })),
          supportCommitments: (Array.isArray(suggestedDraft.supportCommitments) ? suggestedDraft.supportCommitments : []).slice(0, 5).map(item => text(item, 1200))
        },
        requestedBy: actorId,
        reviewedBy: actorId,
        reviewedAt: new Date()
      }]
      : [];
    const plan = await PerformanceSupportPlan.create({
      organizationId: req.organizationId,
      employee,
      manager,
      planType,
      title: text(req.body.title, 240),
      summary: text(req.body.summary),
      concerns: (Array.isArray(req.body.concerns) ? req.body.concerns : []).slice(0, 20).map(item => ({
        description: text(item.description, 2000),
        expectedStandard: text(item.expectedStandard, 2000)
      })),
      objectives,
      supportCommitments,
      milestones: (Array.isArray(req.body.milestones) ? req.body.milestones : []).slice(0, 20).map(item => ({
        title: text(item.title, 240), dueDate: item.dueDate, status: 'upcoming'
      })),
      reviewDates: (Array.isArray(req.body.reviewDates) ? req.body.reviewDates : []).slice(0, 20),
      aiAssistance,
      audit: [
        { action: 'created', actorId, actorRole: req.userRole },
        ...(aiAssistance.length ? [{ action: 'ai_suggestion_accepted', actorId, actorRole: req.userRole, details: { activity: AI_ACTIVITIES.SUPPORT_PLAN_DRAFT, suggestionId: aiAssistance[0].output.suggestionId } }] : [])
      ]
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to create support plan' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load support plan' });
  }
});

router.patch('/:id', requirePermission('support_plan:manage:direct_reports'), async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (!canManage(req, plan)) return res.status(403).json({ success: false, error: 'Access denied' });
    if (!['draft', 'changes_requested'].includes(plan.state)) {
      return res.status(409).json({ success: false, error: 'Only draft plans can be edited' });
    }
    ['title', 'summary'].forEach((field) => {
      if (req.body[field] !== undefined) plan[field] = text(req.body[field], field === 'title' ? 240 : 5000);
    });
    if (Array.isArray(req.body.objectives)) plan.objectives = req.body.objectives.slice(0, 20);
    if (Array.isArray(req.body.supportCommitments)) plan.supportCommitments = req.body.supportCommitments.slice(0, 20);
    if (Array.isArray(req.body.milestones)) plan.milestones = req.body.milestones.slice(0, 20);
    if (Array.isArray(req.body.reviewDates)) plan.reviewDates = req.body.reviewDates.slice(0, 20);
    audit(plan, req, 'updated');
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to update support plan' });
  }
});

router.post('/:id/submit-for-hr-review', requirePermission('support_plan:manage:direct_reports'), async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (!canManage(req, plan)) return res.status(403).json({ success: false, error: 'Access denied' });
    if (!['draft', 'changes_requested'].includes(plan.state)) {
      return res.status(409).json({ success: false, error: 'This plan is not ready for HR review' });
    }
    plan.state = 'hr_review';
    audit(plan, req, 'submitted_for_hr_review');
    await plan.save();
    const hrRecipients = await organizationHrRecipients(plan.organizationId);
    await recordEvent({
      organizationId: plan.organizationId,
      type: 'support_plan.hr_review_requested',
      aggregateType: 'PerformanceSupportPlan',
      aggregateId: String(plan._id),
      actorId: getActorId(req),
      recipients: hrRecipients,
      data: { deepLink: `/support-plans?plan=${plan._id}&view=hr_review`, dueAt: new Date(Date.now() + 7 * 86400000) }
    });
    await Promise.all(hrRecipients.map(recipient => schedulePlanAction({ plan, eventType: 'support_plan.hr_review_due', recipient, targetType: 'support_plan_hr_review', dueAt: new Date(Date.now() + 7 * 86400000), label: 'Support plan HR review due' })));
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to submit support plan' });
  }
});

router.post('/:id/hr-decision', requireHRAdmin, async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (plan.state !== 'hr_review') return res.status(409).json({ success: false, error: 'This plan is not awaiting HR review' });
    const decision = String(req.body.decision || '');
    if (!['approve', 'request_changes'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'Choose approve or request changes' });
    }
    const comment = text(req.body.comment, 4000);
    if (decision === 'request_changes' && !comment) {
      return res.status(400).json({ success: false, error: 'Explain the changes required' });
    }
    plan.hrReview = {
      reviewerId: getActorId(req),
      decision: decision === 'approve' ? 'approved' : 'changes_requested',
      comment,
      decidedAt: new Date()
    };
    plan.state = decision === 'approve' ? 'employee_review' : 'changes_requested';
    audit(plan, req, decision === 'approve' ? 'hr_approved' : 'hr_requested_changes', { comment });
    await plan.save();
    await cancelActions(plan);
    await recordEvent({
      organizationId: plan.organizationId,
      type: decision === 'approve' ? 'support_plan.employee_review_requested' : 'support_plan.changes_requested',
      aggregateType: 'PerformanceSupportPlan',
      aggregateId: String(plan._id),
      actorId: getActorId(req),
      recipients: [{ userId: decision === 'approve' ? plan.employee.userId : plan.manager.userId }],
      data: { deepLink: `/support-plans?plan=${plan._id}`, ...(decision === 'approve' ? { dueAt: new Date(Date.now() + 5 * 86400000) } : {}) }
    });
    if (decision === 'approve') await schedulePlanAction({ plan, eventType: 'support_plan.employee_response_due', recipient: { userId: plan.employee.userId, name: plan.employee.name, email: plan.employee.email }, targetType: 'support_plan_employee_response', dueAt: new Date(Date.now() + 5 * 86400000), label: 'Support plan response due' });
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to record HR decision' });
  }
});

router.post('/:id/employee-response', async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (plan.employee.userId !== getActorId(req)) return res.status(403).json({ success: false, error: 'Only the employee can respond' });
    if (plan.state !== 'employee_review') return res.status(409).json({ success: false, error: 'This plan is not awaiting your response' });
    const acknowledgement = String(req.body.acknowledgement || '');
    if (!['acknowledged', 'acknowledged_with_comments'].includes(acknowledgement)) {
      return res.status(400).json({ success: false, error: 'Choose an acknowledgement response' });
    }
    const comment = text(req.body.comment, 4000);
    if (acknowledgement === 'acknowledged_with_comments' && !comment) {
      return res.status(400).json({ success: false, error: 'Add your comments before continuing' });
    }
    plan.employeeResponse = { acknowledgement, comment, respondedAt: new Date() };
    plan.state = 'active';
    audit(plan, req, 'employee_acknowledged', { acknowledgement });
    await plan.save();
    await cancelActions(plan);
    await recordEvent({
      organizationId: plan.organizationId,
      type: 'support_plan.activated',
      aggregateType: 'PerformanceSupportPlan',
      aggregateId: String(plan._id),
      actorId: getActorId(req),
      recipients: [{ userId: plan.manager.userId }],
      data: { deepLink: `/support-plans?plan=${plan._id}` }
    });
    const nextReviewDate = (plan.reviewDates || []).filter(date => new Date(date) > new Date()).sort((a, b) => new Date(a) - new Date(b))[0];
    if (nextReviewDate) await schedulePlanAction({ plan, eventType: 'support_plan.review_due', recipient: { userId: plan.manager.userId, name: plan.manager.name, email: plan.manager.email }, targetType: 'support_plan_review', dueAt: nextReviewDate, label: 'Support plan review due' });
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to record employee response' });
  }
});

router.post('/:id/check-ins', async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (!['active', 'review_due', 'extended'].includes(plan.state)) {
      return res.status(409).json({ success: false, error: 'Check-ins are available only while a plan is active' });
    }
    const actorId = getActorId(req);
    if (actorId !== plan.employee.userId && !canManage(req, plan)) return res.status(403).json({ success: false, error: 'Access denied' });
    const update = text(req.body.update);
    if (!update) return res.status(400).json({ success: false, error: 'A check-in update is required' });
    plan.checkIns.push({
      authorId: actorId,
      authorRole: actorId === plan.employee.userId ? 'employee' : req.userRole,
      progress: req.body.progress,
      update,
      blockers: text(req.body.blockers, 3000),
      supportNeeded: text(req.body.supportNeeded, 3000)
    });
    audit(plan, req, 'check_in_added');
    await plan.save();
    const recipientId = actorId === plan.employee.userId ? plan.manager.userId : plan.employee.userId;
    await recordEvent({
      organizationId: plan.organizationId,
      type: 'support_plan.check_in_added',
      aggregateType: 'PerformanceSupportPlan',
      aggregateId: String(plan._id),
      actorId,
      recipients: [{ userId: recipientId }],
      data: { deepLink: `/support-plans?plan=${plan._id}` }
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to add check-in' });
  }
});

router.patch('/:id/milestones/:milestoneId', async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    const actorId = getActorId(req);
    if (actorId !== plan.employee.userId && !canManage(req, plan)) return res.status(403).json({ success: false, error: 'Access denied' });
    const milestone = plan.milestones.id(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ success: false, error: 'Milestone not found' });
    if (actorId === plan.employee.userId) milestone.employeeUpdate = text(req.body.employeeUpdate, 4000);
    else milestone.managerResponse = text(req.body.managerResponse, 4000);
    if (req.body.status && ['upcoming', 'due', 'completed', 'missed'].includes(req.body.status)) milestone.status = req.body.status;
    milestone.updatedAt = new Date();
    audit(plan, req, 'milestone_updated', { milestoneId: String(milestone._id) });
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to update milestone' });
  }
});

router.post('/:id/outcome', requirePermission('support_plan:manage:direct_reports'), async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    if (!canManage(req, plan)) return res.status(403).json({ success: false, error: 'Access denied' });
    if (!['active', 'review_due', 'extended'].includes(plan.state)) return res.status(409).json({ success: false, error: 'This plan cannot be closed from its current state' });
    const decision = String(req.body.decision || '');
    if (!['completed', 'extended', 'escalated', 'cancelled'].includes(decision)) return res.status(400).json({ success: false, error: 'Choose a valid outcome' });
    const reason = text(req.body.reason);
    if (!reason) return res.status(400).json({ success: false, error: 'An outcome reason is required' });
    if (plan.planType === 'formal_improvement' && req.userRole !== 'hr_admin' && ['escalated', 'cancelled'].includes(decision)) {
      return res.status(403).json({ success: false, error: 'HR must make this formal-plan decision' });
    }
    plan.outcome = { decision, reason, decidedBy: getActorId(req), decidedAt: new Date(), nextReviewDate: req.body.nextReviewDate };
    plan.state = decision;
    audit(plan, req, `outcome_${decision}`, { reason });
    await plan.save();
    await cancelActions(plan);
    await recordEvent({
      organizationId: plan.organizationId,
      type: `support_plan.${decision}`,
      aggregateType: 'PerformanceSupportPlan',
      aggregateId: String(plan._id),
      actorId: getActorId(req),
      recipients: [{ userId: plan.employee.userId }],
      data: { deepLink: `/support-plans?plan=${plan._id}` }
    });
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to record outcome' });
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    const plan = await loadPlan(req, res);
    if (!plan) return;
    return res.json({ success: true, data: plan.audit.slice().sort((a, b) => b.at - a.at) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load history' });
  }
});

module.exports = router;
