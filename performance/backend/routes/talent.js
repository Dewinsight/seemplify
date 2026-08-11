const express = require('express');
const mongoose = require('mongoose');
const TalentReviewCycle = require('../models/TalentReviewCycle');
const TalentReviewEntry = require('../models/TalentReviewEntry');
const SuccessionPlan = require('../models/SuccessionPlan');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const User = require('../models/User');
const { requirePermission, requireHRAdmin } = require('../middleware/rbac');
const { getActorId, tenantFilter } = require('../services/tenantPolicy');
const aiGatewayService = require('../services/aiGatewayService');
const { AI_ACTIVITIES } = require('../config/aiActivityCatalog');

const router = express.Router();
const FINAL_STATUSES = ['completed', 'employee_acknowledged'];
const EDITABLE_STATES = ['open', 'calibration'];

function text(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function list(value, maxItems = 12) {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, 500))
    .filter(Boolean)
    .slice(0, maxItems);
}

function audit(target, req, action, details) {
  target.audit.push({ action, actorId: getActorId(req), actorRole: req.userRole || 'employee', details });
}

function performanceBand(finalRating) {
  const rating = Number(finalRating);
  if (rating >= 4) return 'strong';
  if (rating >= 3) return 'effective';
  return 'developing';
}

function managerEmployeeIds(req) {
  return new Set((req.directReports || []).map(String));
}

function canManageEntry(req, entry) {
  return req.userRole === 'hr_admin' || managerEmployeeIds(req).has(String(entry.employee?.userId));
}

async function visibleCycle(cycle, req) {
  const plain = cycle.toObject ? cycle.toObject() : cycle;
  const query = tenantFilter(req, { cycleId: plain._id });
  if (req.userRole !== 'hr_admin') query['employee.userId'] = { $in: [...managerEmployeeIds(req)] };
  const entries = await TalentReviewEntry.find(query).sort({ 'employee.name': 1 }).lean();
  return { ...plain, entries };
}

async function loadCycle(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ success: false, error: 'Talent review not found' });
    return null;
  }
  const cycle = await TalentReviewCycle.findOne(tenantFilter(req, { _id: req.params.id }));
  if (!cycle) {
    res.status(404).json({ success: false, error: 'Talent review not found' });
    return null;
  }
  if (req.userRole !== 'hr_admin' && !await TalentReviewEntry.exists(tenantFilter(req, { cycleId: cycle._id, 'employee.userId': { $in: [...managerEmployeeIds(req)] } }))) {
    res.status(403).json({ success: false, error: 'This talent review is outside your team scope' });
    return null;
  }
  return cycle;
}

async function tenantPerson(req, userId) {
  const safeId = text(userId, 240);
  if (!safeId) return null;
  const identifier = [{ idpSub: safeId }];
  if (mongoose.isValidObjectId(safeId)) identifier.push({ _id: safeId });
  return User.findOne({
    isActive: { $ne: false },
    $and: [
      { $or: identifier },
      {
        $or: [
          { 'idpTeams.organizationId': req.organizationId },
          { 'idpOrganizations.id': req.organizationId },
          { organizationMemberships: { $elemMatch: { organization: req.organizationId, isActive: true } } }
        ]
      }
    ]
  }).lean();
}

function personIdentity(person, requestedId, organizationId) {
  const organization = (person.idpOrganizations || []).find((item) => String(item.id) === String(organizationId))
    || person.idpOrganizations?.[0] || {};
  const team = (person.idpTeams || []).find((item) => String(item.organizationId) === String(organizationId))
    || person.idpTeams?.[0] || {};
  return {
    userId: String(person.idpSub || person._id || requestedId),
    name: person.profile?.displayName || [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ') || person.email,
    email: person.email,
    jobTitle: person.profile?.title || organization.designation || '',
    teamId: team.id || '',
    teamName: team.name || ''
  };
}

async function recordEvent(input) {
  try {
    const { recordEvent: publish } = require('../services/outboxService');
    await publish(input);
  } catch (error) {
    console.warn('Talent event was not recorded:', error.message);
  }
}

router.get('/reviews', requirePermission('talent_review:view:team'), async (req, res) => {
  try {
    const query = tenantFilter(req);
    if (req.userRole !== 'hr_admin') {
      const cycleIds = await TalentReviewEntry.distinct('cycleId', tenantFilter(req, { 'employee.userId': { $in: [...managerEmployeeIds(req)] } }));
      query._id = { $in: cycleIds };
    }
    if (req.query.state) query.state = text(req.query.state, 40);
    const cycles = await TalentReviewCycle.find(query).sort({ updatedAt: -1 }).limit(100);
    const data = await Promise.all(cycles.map((cycle) => visibleCycle(cycle, req)));
    return res.json({ success: true, data, count: cycles.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load talent reviews' });
  }
});

router.post('/reviews', requireHRAdmin, async (req, res) => {
  try {
    const sourceCycleId = text(req.body.sourceAppraisalCycleId, 80);
    if (!mongoose.isValidObjectId(sourceCycleId)) return res.status(400).json({ success: false, error: 'Select a valid appraisal cycle' });
    const sourceCycle = await AppraisalCycle.findOne(tenantFilter(req, { _id: sourceCycleId })).lean();
    if (!sourceCycle) return res.status(404).json({ success: false, error: 'Appraisal cycle not found' });
    if (await TalentReviewCycle.exists(tenantFilter(req, { sourceAppraisalCycleId: sourceCycleId }))) {
      return res.status(409).json({ success: false, error: 'A talent review already exists for this appraisal cycle' });
    }
    const appraisals = await Appraisal.find(tenantFilter(req, {
      cycleId: sourceCycleId,
      status: { $in: FINAL_STATUSES },
      'finalRating.overall': { $gte: 1, $lte: 5 },
      'finalRating.finalizedAt': { $ne: null }
    })).select('employee manager finalRating goalEvidenceSummary').lean();
    if (appraisals.length === 0) {
      return res.status(409).json({ success: false, error: 'This appraisal cycle has no finalized employee results to snapshot' });
    }
    const cycle = await TalentReviewCycle.create({
      organizationId: req.organizationId,
      name: text(req.body.name, 240) || `${sourceCycle.name} talent review`,
      description: text(req.body.description, 2000),
      sourceAppraisalCycleId: sourceCycle._id,
      sourceCycle: { name: sourceCycle.name, periodStart: sourceCycle.periodStart, periodEnd: sourceCycle.periodEnd },
      createdBy: getActorId(req),
      stats: { participants: appraisals.length },
      audit: [{ action: 'created', actorId: getActorId(req), actorRole: req.userRole, details: { sourceAppraisalCycleId: sourceCycleId, participants: appraisals.length } }]
    });
    try {
      await TalentReviewEntry.insertMany(appraisals.map((appraisal) => ({
        organizationId: req.organizationId,
        cycleId: cycle._id,
        employee: appraisal.employee,
        managerId: appraisal.manager?.userId,
        sourceAppraisalId: appraisal._id,
        evidenceSnapshot: {
          finalRating: appraisal.finalRating.overall,
          ratingLabel: appraisal.finalRating.ratingLabel,
          goalAchievement: appraisal.goalEvidenceSummary?.rated ? appraisal.goalEvidenceSummary?.score : undefined,
          competencyScore: appraisal.finalRating.competencyScore,
          finalizedAt: appraisal.finalRating.finalizedAt
        },
        performanceBand: performanceBand(appraisal.finalRating.overall),
        audit: [{ action: 'evidence_snapshotted', actorId: getActorId(req), actorRole: req.userRole, details: { sourceAppraisalId: String(appraisal._id) } }]
      })));
    } catch (entryError) {
      await TalentReviewCycle.deleteOne({ _id: cycle._id, organizationId: req.organizationId });
      throw entryError;
    }
    return res.status(201).json({ success: true, data: await visibleCycle(cycle, req) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, error: 'A talent review already exists for this appraisal cycle' });
    console.error('Create talent review failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create talent review' });
  }
});

router.get('/reviews/:id', requirePermission('talent_review:view:team'), async (req, res) => {
  try {
    const cycle = await loadCycle(req, res);
    if (!cycle) return;
    return res.json({ success: true, data: await visibleCycle(cycle, req) });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load talent review' });
  }
});

router.post('/reviews/:id/transition', requireHRAdmin, async (req, res) => {
  try {
    const cycle = await loadCycle(req, res);
    if (!cycle) return;
    const next = text(req.body.state, 40);
    const allowed = { draft: ['open', 'cancelled'], open: ['calibration', 'cancelled'], calibration: ['closed', 'open'], closed: [], cancelled: [] };
    if (!allowed[cycle.state]?.includes(next)) return res.status(409).json({ success: false, error: `Cannot move a ${cycle.state} review to ${next || 'that state'}` });
    if (next === 'closed') {
      const unresolved = await TalentReviewEntry.countDocuments(tenantFilter(req, { cycleId: cycle._id, decisionState: { $ne: 'hr_calibrated' } }));
      if (unresolved > 0) return res.status(409).json({ success: false, error: `${unresolved} talent decision${unresolved === 1 ? '' : 's'} still require HR calibration` });
    }
    cycle.state = next;
    if (next === 'open') cycle.openedAt = new Date();
    if (next === 'calibration') cycle.calibrationStartedAt = new Date();
    if (next === 'closed') cycle.closedAt = new Date();
    audit(cycle, req, `state_${next}`);
    await cycle.save();
    const managerIds = next === 'open'
      ? await TalentReviewEntry.distinct('managerId', tenantFilter(req, { cycleId: cycle._id, managerId: { $nin: [null, ''] } }))
      : [];
    await recordEvent({
      organizationId: req.organizationId,
      type: `talent_review.${next}`,
      aggregateType: 'TalentReviewCycle', aggregateId: String(cycle._id), actorId: getActorId(req),
      recipients: managerIds,
      data: { deepLink: `/talent?review=${cycle._id}`, title: 'Talent review updated', message: 'A talent review workflow has moved to its next stage.' }
    });
    return res.json({ success: true, data: cycle });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update talent review state' });
  }
});

router.patch('/reviews/:id/entries/:employeeId', requirePermission('talent_review:manage:team'), async (req, res) => {
  try {
    const cycle = await loadCycle(req, res);
    if (!cycle) return;
    if (!EDITABLE_STATES.includes(cycle.state)) return res.status(409).json({ success: false, error: 'Entries can only be updated while the review is open or in calibration' });
    if (cycle.state === 'calibration' && req.userRole !== 'hr_admin') return res.status(409).json({ success: false, error: 'Manager proposals are locked while HR calibration is in progress' });
    const entry = await TalentReviewEntry.findOne(tenantFilter(req, { cycleId: cycle._id, 'employee.userId': String(req.params.employeeId) }));
    if (!entry) return res.status(404).json({ success: false, error: 'Employee is not part of this talent review' });
    if (!canManageEntry(req, entry)) return res.status(403).json({ success: false, error: 'You can only update direct reports in this review' });
    const potential = text(req.body.potential, 40);
    const readiness = text(req.body.readiness, 40);
    if (!['limited', 'moderate', 'high'].includes(potential)) return res.status(400).json({ success: false, error: 'Potential assessment is required' });
    if (!['ready_now', 'ready_1_2_years', 'ready_3_plus_years'].includes(readiness)) return res.status(400).json({ success: false, error: 'Readiness assessment is required' });
    const rationale = text(req.body.rationale, 4000);
    if (rationale.length < 20) return res.status(400).json({ success: false, error: 'Add an evidence-based rationale of at least 20 characters' });
    entry.potential = potential;
    entry.readiness = readiness;
    entry.nextRole = text(req.body.nextRole, 240);
    entry.criticalRole = req.body.criticalRole === true;
    entry.rationale = rationale;
    entry.strengths = list(req.body.strengths);
    entry.developmentPriorities = list(req.body.developmentPriorities);
    if (req.userRole === 'hr_admin' && cycle.state === 'calibration') {
      entry.decisionState = 'hr_calibrated';
      entry.calibratedBy = getActorId(req);
      entry.calibratedAt = new Date();
    } else {
      entry.decisionState = 'manager_proposed';
      entry.proposedBy = getActorId(req);
      entry.proposedAt = new Date();
    }
    entry.audit.push({ action: entry.decisionState, actorId: getActorId(req), actorRole: req.userRole, details: { potential, readiness } });
    await entry.save();
    const [managerProposed, hrCalibrated] = await Promise.all([
      TalentReviewEntry.countDocuments(tenantFilter(req, { cycleId: cycle._id, decisionState: 'manager_proposed' })),
      TalentReviewEntry.countDocuments(tenantFilter(req, { cycleId: cycle._id, decisionState: 'hr_calibrated' }))
    ]);
    cycle.stats.managerProposed = managerProposed;
    cycle.stats.hrCalibrated = hrCalibrated;
    audit(cycle, req, 'entry_updated', { employeeId: entry.employee.userId, decisionState: entry.decisionState });
    await cycle.save();
    return res.json({ success: true, data: await visibleCycle(cycle, req) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to update talent assessment' });
  }
});

router.post('/reviews/:id/entries/:employeeId/ai-brief', requirePermission('talent_review:manage:team'), async (req, res) => {
  try {
    const cycle = await loadCycle(req, res);
    if (!cycle) return;
    const entry = await TalentReviewEntry.findOne(tenantFilter(req, { cycleId: cycle._id, 'employee.userId': String(req.params.employeeId) }));
    if (!entry) return res.status(404).json({ success: false, error: 'Employee is not part of this talent review' });
    if (!canManageEntry(req, entry)) return res.status(403).json({ success: false, error: 'You can only request evidence briefs for direct reports' });
    const appraisal = await Appraisal.findOne(tenantFilter(req, { _id: entry.sourceAppraisalId }))
      .select('goalEvidenceSummary managerReview.overallSummary managerReview.competencyRatings discussion.notes feedbackEvidence finalRating')
      .lean();
    if (!appraisal) return res.status(409).json({ success: false, error: 'The source appraisal evidence is unavailable' });
    const evidence = {
      goalEvidence: appraisal.goalEvidenceSummary,
      managerSummary: appraisal.managerReview?.overallSummary,
      competencies: (appraisal.managerReview?.competencyRatings || []).map((item) => ({ name: item.competencyName, rating: item.managerRating, comment: item.managerComments })),
      agreedDiscussion: appraisal.discussion?.notes,
      selectedFeedback: (appraisal.feedbackEvidence || []).map((item) => ({ type: item.type, content: item.content, context: item.contextLabel })),
      finalizedRating: appraisal.finalRating?.overall
    };
    const result = await aiGatewayService.getChatCompletions([
      { role: 'system', content: 'Summarize only the supplied, authorized performance evidence for a human talent-review conversation. Do not infer potential, readiness, retention risk, protected traits, promotion, succession, or a new rating. Do not rank people. Return JSON only.' },
      { role: 'user', content: JSON.stringify(evidence) }
    ], {
      activity: AI_ACTIVITIES.TALENT_EVIDENCE_BRIEF,
      temperature: 0.1,
      jsonSchema: {
        type: 'object', additionalProperties: false,
        required: ['summary', 'evidenceHighlights', 'evidenceGaps', 'discussionQuestions'],
        properties: {
          summary: { type: 'string' },
          evidenceHighlights: { type: 'array', maxItems: 6, items: { type: 'string' } },
          evidenceGaps: { type: 'array', maxItems: 6, items: { type: 'string' } },
          discussionQuestions: { type: 'array', maxItems: 6, items: { type: 'string' } }
        }
      }
    });
    const raw = String(result?.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let output;
    try { output = JSON.parse(raw); } catch { return res.status(502).json({ success: false, error: 'The AI evidence brief was invalid. Continue with the source evidence.', code: 'AI_RESPONSE_INVALID' }); }
    entry.aiBriefs.push({ output, provider: result.provider, requestedBy: getActorId(req) });
    entry.audit.push({ action: 'ai_brief_requested', actorId: getActorId(req), actorRole: req.userRole });
    await entry.save();
    const saved = entry.aiBriefs[entry.aiBriefs.length - 1];
    return res.json({ success: true, data: saved, advisory: true, forbiddenDecisions: ['potential', 'readiness', 'promotion', 'succession', 'rating'] });
  } catch (error) {
    return res.status(Number(error.statusCode) || 503).json({ success: false, error: error.message || 'AI evidence brief is unavailable', code: error.code || 'AI_UNAVAILABLE', manualCompletionAvailable: true });
  }
});

router.post('/reviews/:id/entries/:employeeId/ai-briefs/:briefId/review', requirePermission('talent_review:manage:team'), async (req, res) => {
  try {
    const cycle = await loadCycle(req, res);
    if (!cycle) return;
    const entry = await TalentReviewEntry.findOne(tenantFilter(req, { cycleId: cycle._id, 'employee.userId': String(req.params.employeeId) }));
    if (!entry || !canManageEntry(req, entry)) return res.status(403).json({ success: false, error: 'Access denied' });
    const brief = entry.aiBriefs.id(req.params.briefId);
    if (!brief) return res.status(404).json({ success: false, error: 'AI evidence brief not found' });
    const decision = text(req.body.decision, 20);
    if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ success: false, error: 'Decision must be accepted or rejected' });
    brief.status = decision;
    brief.reviewedBy = getActorId(req);
    brief.reviewedAt = new Date();
    entry.audit.push({ action: `ai_brief_${decision}`, actorId: getActorId(req), actorRole: req.userRole });
    await entry.save();
    return res.json({ success: true, data: brief });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to record the AI brief decision' });
  }
});

router.get('/succession-plans', requirePermission('succession:manage'), async (req, res) => {
  try {
    const data = await SuccessionPlan.find(tenantFilter(req)).sort({ 'role.criticality': -1, updatedAt: -1 }).lean();
    return res.json({ success: true, data, count: data.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load succession coverage' });
  }
});

router.post('/succession-plans', requirePermission('succession:manage'), async (req, res) => {
  try {
    const title = text(req.body.role?.title, 240);
    if (!title) return res.status(400).json({ success: false, error: 'Role title is required' });
    let incumbent;
    if (req.body.role?.incumbent?.userId) {
      const incumbentPerson = await tenantPerson(req, req.body.role.incumbent.userId);
      if (!incumbentPerson) return res.status(400).json({ success: false, error: 'The incumbent must be an active employee in this organization' });
      const incumbentIdentity = personIdentity(incumbentPerson, req.body.role.incumbent.userId, req.organizationId);
      incumbent = { userId: incumbentIdentity.userId, name: incumbentIdentity.name };
    }
    const plan = await SuccessionPlan.create({
      organizationId: req.organizationId,
      role: {
        title,
        departmentId: text(req.body.role?.departmentId, 240),
        departmentName: text(req.body.role?.departmentName, 240),
        teamId: text(req.body.role?.teamId, 240),
        teamName: text(req.body.role?.teamName, 240),
        criticality: ['standard', 'important', 'critical'].includes(req.body.role?.criticality) ? req.body.role.criticality : 'standard',
        incumbent
      },
      state: req.body.state === 'active' ? 'active' : 'draft',
      reviewDate: req.body.reviewDate || undefined,
      ownerId: getActorId(req),
      audit: [{ action: 'created', actorId: getActorId(req), details: { title } }]
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, error: 'A succession plan already exists for this role and department' });
    return res.status(500).json({ success: false, error: error.message || 'Failed to create succession plan' });
  }
});

router.patch('/succession-plans/:id', requirePermission('succession:manage'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    const plan = await SuccessionPlan.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!plan) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    const previous = { state: plan.state, reviewDate: plan.reviewDate, criticality: plan.role.criticality };
    if (req.body.state !== undefined) {
      const state = text(req.body.state, 30);
      if (!['draft', 'active', 'closed'].includes(state)) return res.status(400).json({ success: false, error: 'Succession plan state is invalid' });
      plan.state = state;
    }
    if (req.body.reviewDate !== undefined) plan.reviewDate = req.body.reviewDate || undefined;
    if (req.body.criticality !== undefined) {
      if (!['standard', 'important', 'critical'].includes(req.body.criticality)) return res.status(400).json({ success: false, error: 'Criticality is invalid' });
      plan.role.criticality = req.body.criticality;
    }
    audit(plan, req, 'plan_updated', { previous, next: { state: plan.state, reviewDate: plan.reviewDate, criticality: plan.role.criticality } });
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to update succession plan' });
  }
});

router.post('/succession-plans/:id/candidates', requirePermission('succession:manage'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    const plan = await SuccessionPlan.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!plan) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    if (plan.state === 'closed') return res.status(409).json({ success: false, error: 'Closed succession plans cannot be changed' });
    const person = await tenantPerson(req, req.body.employeeId);
    if (!person) return res.status(400).json({ success: false, error: 'Select an active employee in this organization' });
    const employee = personIdentity(person, req.body.employeeId, req.organizationId);
    if (plan.candidates.some((candidate) => candidate.state !== 'removed' && String(candidate.employee.userId) === employee.userId)) {
      return res.status(409).json({ success: false, error: 'This employee is already on the succession slate' });
    }
    const readiness = text(req.body.readiness, 40);
    if (!['ready_now', 'ready_1_2_years', 'ready_3_plus_years'].includes(readiness)) return res.status(400).json({ success: false, error: 'Readiness is required' });
    const rationale = text(req.body.rationale, 4000);
    if (rationale.length < 20) return res.status(400).json({ success: false, error: 'Add an evidence-based rationale of at least 20 characters' });
    plan.candidates.push({ employee, readiness, rationale, strengths: list(req.body.strengths), developmentGaps: list(req.body.developmentGaps), developmentPlanId: mongoose.isValidObjectId(req.body.developmentPlanId) ? req.body.developmentPlanId : undefined, nominatedBy: getActorId(req) });
    audit(plan, req, 'candidate_nominated', { employeeId: employee.userId, readiness });
    await plan.save();
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to add succession candidate' });
  }
});

router.patch('/succession-plans/:id/candidates/:candidateId', requirePermission('succession:manage'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    const plan = await SuccessionPlan.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!plan) return res.status(404).json({ success: false, error: 'Succession plan not found' });
    const candidate = plan.candidates.id(req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, error: 'Candidate not found' });
    const state = text(req.body.state, 30);
    if (!['confirmed', 'removed'].includes(state)) return res.status(400).json({ success: false, error: 'Candidate decision must be confirmed or removed' });
    candidate.state = state;
    candidate.confirmedBy = getActorId(req);
    candidate.confirmedAt = new Date();
    audit(plan, req, `candidate_${state}`, { employeeId: candidate.employee.userId });
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update succession candidate' });
  }
});

router.get('/signals', requirePermission('talent_review:view:team'), async (req, res) => {
  try {
    const query = tenantFilter(req, { status: { $nin: [...FINAL_STATUSES, 'cancelled'] } });
    if (req.userRole !== 'hr_admin') query['employee.userId'] = { $in: [...managerEmployeeIds(req)] };
    const appraisals = await Appraisal.find(query).select('employee status cycleId selfAssessment.submittedAt managerReview.submittedAt updatedAt').lean();
    const now = Date.now();
    const signals = appraisals.map((appraisal) => {
      const ageDays = Math.max(0, Math.floor((now - new Date(appraisal.updatedAt).getTime()) / 86400000));
      const reasons = [];
      if (!appraisal.selfAssessment?.submittedAt && ageDays >= 7) reasons.push(`Self-assessment has had no completion for ${ageDays} days`);
      if (appraisal.selfAssessment?.submittedAt && !appraisal.managerReview?.submittedAt && ageDays >= 7) reasons.push(`Manager review has had no completion for ${ageDays} days`);
      if (['calibration_pending', 'calibration_in_progress', 'final_review_pending'].includes(appraisal.status) && ageDays >= 5) reasons.push(`Review has remained in ${appraisal.status.replaceAll('_', ' ')} for ${ageDays} days`);
      return reasons.length ? {
        type: 'cycle_completion_risk',
        severity: ageDays >= 14 ? 'high' : 'medium',
        employee: appraisal.employee,
        appraisalId: String(appraisal._id),
        status: appraisal.status,
        reasons,
        definition: 'Deterministic workflow-age signal. It is not a prediction or employee score.'
      } : null;
    }).filter(Boolean);
    return res.json({
      success: true,
      data: {
        signals,
        methodology: 'Explainable rules use workflow state and elapsed time only. No protected characteristics, sentiment, attendance, leave, or hidden productivity data are used.',
        machineLearning: { enabled: false, reason: 'Predictive models require organization-specific validation, drift monitoring, privacy review, and an approved rollback plan.' },
        refreshedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load talent workflow signals' });
  }
});

module.exports = router;
