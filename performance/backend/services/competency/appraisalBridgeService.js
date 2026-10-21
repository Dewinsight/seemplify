'use strict';
const Appraisal = require('../../models/Appraisal');
const Assessment = require('../../models/CompetencyAssessment');
const { canManageAppraisal } = require('../appraisalAccessService');
const auth = require('./authorizationService');
const { DomainError, id, cleanObject, hash } = require('../../contracts/competency');
async function parent(ctx, appraisalId, manage = false) {
  const record = await Appraisal.findOne({ _id: id(appraisalId), organizationId: ctx.organizationId, removedAt: null }).lean();
  if (!record) throw new DomainError(404, 'APPRAISAL_NOT_FOUND', 'This appraisal is unavailable.');
  const own = String(record.employee?.userId) === ctx.actor.userId;
  const managing = await canManageAppraisal(ctx.req, record);
  if (manage ? !managing : !own && !managing) throw new DomainError(403, 'APPRAISAL_ACCESS_DENIED', 'You do not have access to this appraisal.');
  return record;
}
async function validatePlan(ctx, input) {
  auth.requireAction(ctx, 'assessment.launch');
  cleanObject(input, ['cycleId', 'cycleRevision', 'assignments']);
  if (!Array.isArray(input.assignments) || !input.assignments.length || input.assignments.length > 100) throw new DomainError(422, 'ASSIGNMENTS_REQUIRED', 'Choose participants and their assessment roles.');
  const seen = new Set();
  for (const assignment of input.assignments) {
    cleanObject(assignment, ['participantId', 'roleVersionId', 'assessorIds', 'cvRequested']);
    require('./assessmentService').validateCvRequested(assignment.cvRequested);
    const person = auth.assertParticipant(ctx, assignment.participantId);
    if (seen.has(person.userId)) throw new DomainError(422, 'DUPLICATE_PARTICIPANT', 'Choose each participant once.'); seen.add(person.userId);
    if (!Array.isArray(assignment.assessorIds) || !assignment.assessorIds.length) throw new DomainError(422, 'ASSESSOR_REQUIRED', 'Select an eligible reviewer.');
    for (const userId of assignment.assessorIds) {
      const reviewer = ctx.directory.reviewers.find(row => row.userId === userId);
      if (userId === person.userId || !reviewer || !(reviewer.organizationWide || reviewer.eligibleTeamIds.some(teamId => (person.teamIds || []).includes(teamId)))) throw new DomainError(422, 'ASSESSOR_NOT_ELIGIBLE', 'Choose an eligible reviewer for each participant.');
    }
    await require('./libraryService').getPublishedDefinition({ organizationId: ctx.organizationId, cycleId: input.cycleId, cycleRevision: input.cycleRevision, roleVersionId: assignment.roleVersionId });
  }
  return { valid: true, participants: seen.size };
}
async function links(ctx, appraisalId) {
  await parent(ctx, appraisalId); auth.requireAction(ctx, 'assessment.view');
  const records = await Assessment.find({ organizationId: ctx.organizationId, appraisalId }).sort({ createdAt: -1 }).lean();
  return { appraisalId, assessments: records.filter(record => auth.canAccessAssessment(ctx, record)).map(record => ({ id: String(record._id), assessmentId: String(record._id), status: record.status, cvRequested: record.definitionSnapshot.cvRequested === true, role: { name: record.definitionSnapshot.role.name, version: record.definitionSnapshot.role.version }, participant: record.participant, createdAt: record.createdAt, currentResultNumber: record.currentResultNumber || null, allowedActions: require('./assessmentService').actions(ctx, record) })) };
}
async function link(ctx, input, key) {
  cleanObject(input, ['appraisalId', 'cycleId', 'cycleRevision', 'roleVersionId', 'assessorIds', 'cvRequested']);
  require('./assessmentService').validateCvRequested(input.cvRequested);
  const appraisal = await parent(ctx, input.appraisalId, true);
  if (['completed', 'employee_acknowledged', 'cancelled'].includes(appraisal.status)) throw new DomainError(409, 'APPRAISAL_CLOSED', 'Add the assessment role before this appraisal is finalised.');
  if (!Array.isArray(input.assessorIds) || input.assessorIds.length !== 1 || String(input.assessorIds[0]) !== String(appraisal.manager?.userId)) throw new DomainError(422, 'REVIEWER_MISMATCH', 'Use the reviewer selected for this appraisal.');
  return require('./assessmentService').launch(ctx, { cycleId: input.cycleId, cycleRevision: input.cycleRevision, assignments: [{ participantId: appraisal.employee.userId, roleVersionId: input.roleVersionId, assessorIds: input.assessorIds, appraisalId: input.appraisalId, ...(input.cvRequested !== undefined ? {cvRequested: input.cvRequested} : {}) }] }, key);
}
async function guardFinalOutcome(req, res, next) {
  try {
    const appraisalId = req.params.appraisalId;
    const existing = await Assessment.findOne({ appraisalId, organizationId: String(require('../tenantPolicy').resolveOrganizationId(req) || '') }).lean();
    if (!existing) return next();
    const ctx = await auth.context(req); await parent(ctx, appraisalId, true);
    const current = existing.results?.find(result => result.number === existing.currentResultNumber);
    const source = await require('./assessmentService').sourceFeedback(existing);
    if (existing.status !== 'published' || !current || current.managerSource.sourceHash !== source.sourceHash) return res.status(409).json({ success: false, code: 'ROLE_ASSESSMENT_REQUIRED', error: 'Finish and finalise the linked role assessment using the current submitted reviewer feedback before completing this appraisal.', assessmentId: String(existing._id) });
    next();
  } catch (error) { res.status(error.status || 503).json({ success: false, code: error.code || 'ROLE_ASSESSMENT_UNAVAILABLE', error: error instanceof DomainError ? error.message : 'We could not check the linked role assessment. Please retry.' }); }
}
function reviewerContent(value) {
  const record = value.toObject ? value.toObject({ depopulate: true }) : value;
  const event = (record.auditLog || []).filter(row => ['manager_review_submitted', 'review_submitted'].includes(row.action)).at(-1);
  return hash({
    review: record.managerReview,
    responses: (record.customResponses || []).filter(row => row.respondentRole === 'manager' && row.submittedAt).map(row => ({ sectionId: row.sectionId, questionId: row.questionId, value: row.value, respondentId: row.respondentId, submittedAt: row.submittedAt, score: row.score })),
    actor: event?.performedBy?.userId ? { userId: event.performedBy.userId, name: event.performedBy.name || 'Not recorded' } : null,
    reviewerStep: record.cycleConfigurationSnapshot?.appraisalFlow || record.cycleConfigurationSnapshot?.workflowDefinition?.stages?.managerReview || null
  });
}
async function saveFinalOutcome(req, appraisal) {
  const organizationId = String(require('../tenantPolicy').resolveOrganizationId(req) || '');
  if (!organizationId || String(appraisal.organizationId) !== organizationId) throw new DomainError(403, 'APPRAISAL_ACCESS_DENIED', 'This appraisal is outside your organisation.');
  const filter = { appraisalId: String(appraisal._id), organizationId };
  const originalVersion = appraisal.__v || 0;
  const priorWhere = appraisal.$where;
  // Preserve the existing ordinary-appraisal save path, including standalone
  // Mongo installations. A concurrent first role-link transaction also touches
  // the parent's version, so this CAS cannot finish from the earlier no-link read.
  if (!await Assessment.exists(filter)) {
    appraisal.$where = { ...priorWhere, organizationId, __v: originalVersion, removedAt: null };
    appraisal.increment();
    try { return await appraisal.save(); }
    catch (error) {
      if (error.name === 'VersionError' || error.name === 'DocumentNotFoundError') throw new DomainError(409, 'APPRAISAL_CHANGED', 'This appraisal changed while you were finalising it. Reload and review its current result.');
      throw error;
    } finally { appraisal.$where = priorWhere; }
  }
  const originalContent = reviewerContent(appraisal);
  try {
    await Appraisal.db.transaction(async session => {
      const linked = await Assessment.findOne(filter).session(session).lean();
      const published = linked?.results?.find(row => row.number === linked.currentResultNumber);
      if (!linked || linked.status !== 'published' || linked.mutationLock || !published) throw new DomainError(409, 'ROLE_ASSESSMENT_REQUIRED', 'Finalise the linked role assessment before completing this appraisal.');
      const current = await Appraisal.findOne({ _id: appraisal._id, organizationId, removedAt: null }).session(session).lean();
      const source = await require('./assessmentService').sourceFeedback(linked, session);
      if (!current || (current.__v || 0) !== originalVersion || reviewerContent(current) !== originalContent || published.managerSource?.sourceHash !== source.sourceHash) throw new DomainError(409, 'ROLE_ASSESSMENT_SOURCE_CHANGED', 'The submitted reviewer feedback changed. Review and finalise the linked role assessment again before completing this appraisal.');
      // Touch the assessment in the same transaction as the parent save. A
      // simultaneous reopen/evidence mutation conflicts at commit, then the
      // retry sees its new state rather than finalising against a stale read.
      const fenced = await Assessment.updateOne({ ...filter, _id: linked._id, revision: linked.revision, status: 'published', currentResultNumber: linked.currentResultNumber, mutationLock: null }, { $inc: { __v: 1 } }, { session });
      if (fenced.matchedCount !== 1) throw new DomainError(409, 'ROLE_ASSESSMENT_CHANGED', 'The linked role assessment changed. Reload before completing this appraisal.');
      appraisal.competencyResultReference = { assessmentId: String(linked._id), number: published.number, reportHash: published.reportHash };
      appraisal.$where = { ...priorWhere, organizationId, __v: originalVersion, removedAt: null };
      appraisal.increment();
      await appraisal.save({ session });
    });
    return appraisal;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error.name === 'VersionError' || error.name === 'DocumentNotFoundError') throw new DomainError(409, 'APPRAISAL_CHANGED', 'This appraisal changed while you were finalising it. Reload and review its current result.');
    if (error.code === 20 || /replica set|mongos/i.test(error.message || '')) throw new DomainError(503, 'FINALISATION_REQUIRES_TRANSACTION', 'Linked appraisal completion requires transactional database support. Your assessment is saved.');
    throw error;
  } finally {
    appraisal.$where = priorWhere;
    // Do not leave a completed/aborted transaction attached to the response doc.
    appraisal.$session(null);
  }
}
module.exports = { validatePlan, links, link, guardFinalOutcome, saveFinalOutcome };
