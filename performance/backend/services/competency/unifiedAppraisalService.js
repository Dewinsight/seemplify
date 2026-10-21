'use strict';
const mongoose = require('mongoose');
const Cycle = require('../../models/CompetencyCycle');
const Run = require('../../models/AppraisalCycle');
const Appraisal = require('../../models/Appraisal');
const Assessment = require('../../models/CompetencyAssessment');
const { DomainError, cleanObject, id, hash } = require('../../contracts/competency');
const auth = require('./authorizationService');
const library = require('./libraryService');
const policy = require('./cyclePolicy');
const { cloneBuiltInTemplate, normalizeDesign } = require('../appraisalCycleDesignService');
const { validateFlow, defaultSteps } = require('../appraisalFlowService');
const { scheduleReminderSequence } = require('../reminderScheduler');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message, status = 422) => { throw new DomainError(status, code, message); };
function ordinaryCompetencies(design) {
  return design.sections.some(section => section.type === 'competencies') ? [
    { id: 'communication', name: 'Communication', weight: 1 }, { id: 'teamwork', name: 'Teamwork', weight: 1 }, { id: 'problem_solving', name: 'Problem solving', weight: 1 }, { id: 'initiative', name: 'Initiative', weight: 1 }, { id: 'adaptability', name: 'Adaptability', weight: 1 },
  ] : [];
}
function receiptRecord(appraisal) {
  const snapshot = appraisal.cycleConfigurationSnapshot;
  // Persist a bounded receipt, never another reviewer's draft or hundreds of
  // repeated framework snapshots in the idempotency document.
  return { _id: String(appraisal._id), cycleId: String(appraisal.cycleId), employee: { userId: appraisal.employee.userId, name: appraisal.employee.name }, manager: { userId: appraisal.manager.userId, name: appraisal.manager.name }, status: appraisal.status,
    cycleConfigurationSnapshot: { cycleName: snapshot.cycleName, periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd, reviewMode: snapshot.reviewMode, assessmentCycleId: snapshot.assessmentCycleId, occurrenceKey: snapshot.occurrenceKey } };
}

function workflow(cycle, definition) {
  const mode = policy.setup(cycle).reviewMode;
  const template = cloneBuiltInTemplate(cycle.regularTemplateId);
  const design = mode === 'competency' ? { ...template.design, scoring: { goalsWeight: 0, competenciesWeight: 0 }, sections: [] } : policy.regularWorkflow(cycle);
  // Native competency ratings are kept in the competency result. They are not
  // silently treated as ordinary 1–5 appraisal ratings or included twice.
  if (definition) {
    for (let offset = 0; offset < definition.criteria.length; offset += 20) {
      design.sections.push({ id: `role_evidence_${offset / 20}`, title: `${definition.role.name} — evidence`, type: 'custom', respondent: 'both', required: true, scored: false, weight: 0, evidenceRequired: false,
        description: 'Describe work against the published role expectations. The reviewer assesses native levels separately.',
        questions: definition.criteria.slice(offset, offset + 20).map(criterion => ({
          id: `role_${hash(criterion.id).slice(0, 24)}`, responseType: 'long_text', required: criterion.required !== false,
          prompt: `For ${criterion.name}${criterion.code ? ` (${criterion.code})` : ''}, what work did you deliver, what decisions did you make, and what evidence shows the outcome?`.slice(0, 500),
          helpText: `${criterion.sourceName}. Expected: ${criterion.expectedLevel?.label || criterion.evaluationTarget?.value || 'published role expectation'}. ${criterion.expectedLevel?.description || criterion.description || ''}`.slice(0, 500),
        })) });
    }
  }
  if (design.sections.length > 20) fail('TOO_MANY_REVIEW_SECTIONS', 'Reduce the regular appraisal sections so every role evidence question fits within this review.');
  design.stages = { ...design.stages, goalSetting: { enabled: false }, calibration: { enabled: false }, discussion: { enabled: false } };
  return normalizeDesign(design);
}

async function prepare(ctx, cycleId, input) {
  auth.requireAction(ctx, 'assessment.launch');
  cleanObject(input, ['cycleRevision', 'period', 'assignments', 'responseDeadlines', 'appraisalFlow']);
  const cycle = await library.find(Cycle, ctx.organizationId, id(cycleId), { status: 'published' });
  policy.assertUse(ctx, cycle);
  await policy.assertFeature(ctx, cycle);
  if (cycle.revision !== input.cycleRevision) fail('REVISION_CONFLICT', 'This cycle changed. Reload it before starting.', 409);
  const period = policy.periodFor(cycle, input.period);
  const setup = policy.setup(cycle);
  await library.validateCycle(ctx.organizationId, cycle);
  cleanObject(input.responseDeadlines || {}, ['selfAssessmentDue', 'managerReviewDue']);
  const deadlines = input.responseDeadlines || {};
  const selfDue = new Date(deadlines.selfAssessmentDue), managerDue = new Date(deadlines.managerReviewDue);
  if (!Number.isFinite(selfDue.getTime()) || !Number.isFinite(managerDue.getTime()) || selfDue < new Date() || managerDue <= selfDue) fail('INVALID_DEADLINES', 'Set a future employee deadline followed by the reviewer deadline.');
  const defaultFlow = { assessmentMode: 'conversation', steps: defaultSteps() };
  const flow = validateFlow(input.appraisalFlow || defaultFlow);
  if (flow.errors.length) fail('INVALID_FLOW', flow.errors[0]);
  if (!Array.isArray(input.assignments) || !input.assignments.length || input.assignments.length > 100) fail('INVALID_ASSIGNMENTS', 'Choose one to 100 participants.');
  const seen = new Set();
  for (const assignment of input.assignments) {
    cleanObject(assignment, ['participantId', 'reviewerId', 'roleVersionId', 'cvRequested']);
    if (typeof assignment.participantId !== 'string' || typeof assignment.reviewerId !== 'string' || !assignment.reviewerId || assignment.participantId.length > 200 || assignment.reviewerId.length > 200) fail('INVALID_ASSIGNMENTS', 'Choose a valid participant and reviewer.');
    auth.assertParticipant(ctx, assignment.participantId);
    if (seen.has(assignment.participantId)) fail('DUPLICATE_PARTICIPANT', 'Choose each participant once.');
    seen.add(assignment.participantId);
    if (assignment.cvRequested !== undefined && typeof assignment.cvRequested !== 'boolean') fail('INVALID_CV_REQUEST', 'Choose whether to request an optional CV.');
    if (setup.reviewMode === 'regular' && (assignment.roleVersionId || assignment.cvRequested)) fail('REGULAR_ROLE_NOT_ALLOWED', 'Choose combined review to include an occupational role.');
  }
  // The existing reviewer selector enforces the current IdP team hierarchy,
  // eligible reviewer and no-self-review rules; no request identity is trusted.
  const request = { ...ctx.req, body: { reviewerMode: 'selected' } };
  const participants = await require('../colleagueReviewService').resolveColleagueParticipants(request, input.assignments.map(a => ({ userId: a.participantId, reviewerId: a.reviewerId })));
  const assignments = [];
  for (const participant of participants) {
    const selection = input.assignments.find(a => a.participantId === participant.userId);
    const definition = setup.reviewMode === 'regular' ? null : await library.getPublishedDefinition({ organizationId: ctx.organizationId, cycleId, cycleRevision: input.cycleRevision, roleVersionId: String(new mongoose.Types.ObjectId(id(selection.roleVersionId))) });
    const goals = setup.reviewMode === 'competency' || !setup.includeApprovedGoals ? { goalIds: [], snapshots: [], evidenceSummary: {} } : await require('../appraisalGoalSnapshotService').buildGoalSnapshots({ organizationId: ctx.organizationId, employeeId: participant.userId, cycle: { periodStart: new Date(period.start), periodEnd: new Date(`${period.end}T23:59:59.999Z`) } });
    if (setup.reviewMode !== 'competency' && setup.includeApprovedGoals && !goals.snapshots.length) fail('APPROVED_GOALS_REQUIRED', `Approve aligned goals for ${participant.name} in this review period before starting.`);
    assignments.push({ participant, selection, definition, goals });
  }
  return { cycle, setup, period, assignments, deadlines: { selfAssessmentDue: selfDue, managerReviewDue: managerDue }, flow: flow.flow };
}

async function launch(ctx, cycleId, input, key) {
  cycleId = String(new mongoose.Types.ObjectId(id(cycleId)));
  // Re-validate scope even on a completed idempotency receipt.
  const plan = await prepare(ctx, cycleId, input);
  return auth.operation(ctx, `unified.appraisal.launch:${cycleId}`, key, input, async () => {
    const { cycle, setup, period, assignments, deadlines, flow } = plan;
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        // Serialise occurrence creation and final configuration validation.
        const fence = await Cycle.updateOne({ _id: cycle._id, organizationId: ctx.organizationId, status: 'published', revision: input.cycleRevision }, { $inc: { __v: 1 } }, { session });
        if (!fence.matchedCount) fail('REVISION_CONFLICT', 'This cycle changed. Reload it before starting.', 409);
        let run = await Run.findOne({ organizationId: ctx.organizationId, assessmentCycleId: cycleId, assessmentOccurrenceKey: period.key }).session(session);
        if (run && (run.retiredAt || !['active', 'draft'].includes(run.status))) fail('REVIEW_PERIOD_CLOSED', 'This review period is closed. Use the next scheduled period or a new one-time cycle.', 409);
        if (!run) {
          if (await Run.exists({ organizationId: ctx.organizationId, assessmentCycleId: cycleId, periodStart: { $lte: new Date(`${period.end}T23:59:59.999Z`) }, periodEnd: { $gte: new Date(period.start) } }).session(session)) fail('PERIOD_OVERLAP', 'This cycle already has an overlapping review period.', 409);
          run = (await Run.create([{ organizationId: ctx.organizationId, assessmentCycleId: cycleId, assessmentOccurrenceKey: period.key, name: cycle.name,
            cycleType: setup.cadence.type === 'one_time' ? 'adhoc' : ({ monthly: 'adhoc', quarterly: 'quarterly', semi_annual: 'semi-annual', annual: 'annual' }[setup.cadence.frequency]),
            periodStart: new Date(period.start), periodEnd: new Date(`${period.end}T23:59:59.999Z`), scope: { type: ctx.organizationWide ? 'organization' : 'team', targetIds: ctx.organizationWide ? [] : [...new Set(assignments.flatMap(a => a.participant.teamIds || []))] },
            status: 'active', currentPhase: 'selfAssessment', responseDeadlines: deadlines, competencies: ordinaryCompetencies(workflow(cycle, null)), workflowDefinition: workflow(cycle, null), okrWeight: workflow(cycle, null).scoring.goalsWeight, settings: { requireOkrAlignment: setup.reviewMode !== 'competency' && setup.includeApprovedGoals }, createdBy: ctx.actor,
          }], { session }))[0];
        }
        const created = [], existing = [];
        for (const { participant: person, selection, definition, goals } of assignments) {
          const prior = await Appraisal.findOne({ organizationId: ctx.organizationId, cycleId: run._id, 'employee.userId': person.userId }).withRemoved().session(session);
          if (prior) {
            if (prior.removedAt || prior.status === 'cancelled') fail('REVIEW_REMOVED', 'An appraisal for this period was removed or cancelled. An administrator must review it before a replacement is created.', 409);
            if (prior.manager.userId !== person.managerId || (prior.cycleConfigurationSnapshot?.roleDefinition?.role?.versionId || null) !== (definition?.role?.versionId || null)) fail('ASSIGNMENT_CONFLICT', 'This participant already has a different reviewer or role in this period.', 409);
            if (!ctx.organizationWide && !await require('../appraisalAccessService').canManageAppraisal(ctx.req, prior)) fail('REVIEW_ALREADY_ASSIGNED', 'A review is already assigned for this person in this period. Ask an administrator to coordinate it.', 409);
            existing.push(receiptRecord(prior)); continue;
          }
          if (definition && (setup.cadence.type === 'one_time' || period.start === cycle.period.start.slice(0, 10)) && await Assessment.exists({ organizationId: ctx.organizationId, cycleId, cycleVersion: definition.cycleVersion, occurrenceKey: { $in: ['legacy', null] }, 'participant.userId': person.userId }).session(session)) fail('LEGACY_ASSESSMENT_EXISTS', 'This participant already has an assessment in the original cycle. Complete the existing review, or publish a new cycle for a different assessment.', 409);
          const design = workflow(cycle, definition);
          design.stages = { ...design.stages, ...Object.fromEntries(Object.keys(require('../appraisalFlowService').TYPES).map(type => [type, { enabled: flow.steps.some(step => step.type === type) }])) };
          const competencies = ordinaryCompetencies(design);
          const appraisal = (await Appraisal.create([{ cycleId: run._id, organizationId: ctx.organizationId, reviewerInitiated: true,
            launchContext: { method: 'existing_cycle', createdBy: ctx.actor }, employee: { userId: person.userId, name: person.name, email: person.email, department: person.department || person.departmentName, teamId: person.teamId || person.teamIds?.[0], teamName: person.teamName, jobTitle: person.jobTitle },
            manager: { userId: person.managerId, name: person.managerName, email: person.managerEmail }, status: 'self_assessment_pending', deadlines,
            goals: goals.goalIds, goalSnapshots: goals.snapshots, goalEvidenceSummary: goals.evidenceSummary,
            cycleConfigurationSnapshot: { version: 1, cycleId: String(run._id), cycleName: cycle.name, assessmentCycleId: cycleId, occurrenceKey: period.key, reviewMode: setup.reviewMode, cadence: setup.cadence, periodStart: run.periodStart, periodEnd: run.periodEnd, ratingScale: clone(run.ratingScale), competencies, settings: clone(run.settings), workflowDefinition: design, appraisalFlow: flow, sourceTemplate: { id: cycle.regularTemplateId || 'balanced_performance', name: 'Unified appraisal cycle', version: cycle.version }, roleDefinition: definition ? clone(definition) : null, capturedAt: new Date() },
            auditLog: [{ action: 'appraisal_created', performedBy: ctx.actor, timestamp: new Date(), details: { assessmentCycleId: cycleId, occurrenceKey: period.key, reviewMode: setup.reviewMode } }],
          }], { session }))[0];
          if (definition) await Assessment.create([{ organizationId: ctx.organizationId, cycleId, cycleVersion: definition.cycleVersion, cycleRevision: cycle.revision, occurrenceKey: period.key, appraisalId: String(appraisal._id), participant: { userId: person.userId, name: person.name, departmentId: person.departmentId, teamIds: person.teamIds || [] }, assessors: [{ userId: person.managerId, name: person.managerName }], assessorIds: [person.managerId], definitionSnapshot: { ...clone(definition), occurrenceKey: period.key, period: { start: period.start, end: period.end }, cvRequested: selection.cvRequested === true }, items: definition.criteria.map(c => ({ criterionId: c.id, status: 'not_started', rationale: '', evidenceIds: [], reviewedSuggestionIds: [] })), managerFeedback: [], results: [], createdBy: ctx.actor }], { session });
          const employeeAssessment = flow.steps.some(step => step.type === 'selfAssessment');
          for (const eventType of ['appraisal.cycle_launched', ...(employeeAssessment ? ['appraisal.self_assessment_due'] : [])]) await require('../outboxService').recordEvent({
            eventId: `${eventType}:${appraisal._id}`, eventType, organizationId: ctx.organizationId, aggregateType: 'appraisal', aggregateId: String(appraisal._id), actor: ctx.actor,
            recipients: [{ userId: person.userId, name: person.name, email: person.email, channels: person.email ? ['in_app', 'email'] : ['in_app'] }],
            data: { cycleId: String(run._id), ...(eventType === 'appraisal.self_assessment_due' ? { dueAt: deadlines.selfAssessmentDue } : {}), deepLink: `/appraisals/${appraisal._id}` },
          }, { session });
          if (employeeAssessment) await scheduleReminderSequence({ organizationId: ctx.organizationId, target: { type: 'appraisal_self_assessment', id: String(appraisal._id) }, eventType: 'appraisal.self_assessment_due.reminder', dueAt: deadlines.selfAssessmentDue,
            recipient: { userId: person.userId, name: person.name, email: person.email, channels: person.email ? ['in_app', 'email'] : ['in_app'] },
            notification: { category: 'appraisal', title: 'Self-assessment due', message: 'Your self-assessment needs to be completed.', deepLink: `/appraisals/${appraisal._id}`, priority: 'high', action: { kind: 'complete', label: 'Open self-assessment' } },
          }, { session });
          created.push(receiptRecord(appraisal));
        }
        await Run.updateOne({ _id: run._id, organizationId: ctx.organizationId }, { $inc: { 'stats.totalEmployees': created.length, 'stats.pendingSelfAssessment': created.length } }, { session });
        result = { cycleId, occurrenceKey: period.key, runId: String(run._id), launched: created.length, replayed: existing.length, errors: 0, appraisals: created, existingAppraisals: existing };
      });
    } catch (error) {
      if (error.code === 20 || /replica set|mongos/i.test(error.message)) fail('TRANSACTION_REQUIRED', 'Appraisal launch requires a transactional database. No partial review was created.', 503);
      throw error;
    } finally { await session.endSession(); }
    await auth.audit(ctx, 'unified.appraisal.launched', 'cycle', cycleId, { afterHash: hash({ occurrenceKey: period.key, appraisalIds: result.appraisals.map(a => String(a._id)) }) });
    return result;
  });
}
module.exports = { workflow, prepare, launch };
