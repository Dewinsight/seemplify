'use strict';
const mongoose = require('mongoose');
const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Assessment = require('../models/CompetencyAssessment');
const service = require('../services/competency/appraisalBridgeService');
const assessmentService = require('../services/competency/assessmentService');
let mongo;
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); });
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
const req = { currentOrganization: { id: 'org-a' } };
async function fixture({ linked = true } = {}) {
  const appraisal = await Appraisal.create({ organizationId: 'org-a', cycleId: new mongoose.Types.ObjectId(), employee: { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.test' }, status: 'final_review_pending', managerReview: { submittedAt: new Date(), overallSummary: { achievements: 'Original submitted finding' }, overallManagerRating: 4 }, cycleConfigurationSnapshot: { appraisalFlow: { steps: [{ id: 'manager', type: 'managerReview' }, { id: 'final', type: 'finalReview' }, { id: 'ack', type: 'acknowledgement' }] } } });
  let assessment;
  if (linked) {
    assessment = await Assessment.create({ organizationId: 'org-a', cycleId: String(new mongoose.Types.ObjectId()), cycleVersion: 1, appraisalId: String(appraisal._id), participant: { userId: 'employee' }, assessorIds: ['reviewer'], definitionSnapshot: {}, status: 'published', currentResultNumber: 1, results: [] });
    const source = await require('../services/competency/assessmentService').sourceFeedback(assessment.toObject());
    await Assessment.updateOne({ _id: assessment._id }, { $set: { results: [{ number: 1, reportHash: 'published-result-hash', managerSource: source }] } });
  }
  const pending = await Appraisal.findById(appraisal._id);
  pending.status = 'completed'; pending.finalRating = { overall: 4, finalizedAt: new Date(), finalizedBy: { userId: 'reviewer', name: 'Synthetic reviewer' } };
  pending.addAuditLog('appraisal_finalized', { id: 'reviewer', name: 'Synthetic reviewer' }, {});
  return { appraisal, pending, assessment };
}
function linkedLaunch(pending) {
  const directory = { organizationId: 'org-a', scope: 'organization', organizationRole: 'owner', canStartAppraisals: true, members: [{ userId: 'reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.test', teams: [] }, { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test', teams: [], teamIds: [] }], reviewers: [{ userId: 'reviewer', organizationWide: true, eligibleTeamIds: [] }], teams: [] };
  const request = { currentOrganization: { id: 'org-a' }, session: { currentOrganizationId: 'org-a', user: { id: 'reviewer', sub: 'reviewer', name: 'Synthetic reviewer', currentOrganization: { id: 'org-a', role: 'owner' }, organizations: [{ id: 'org-a', role: 'owner' }] } }, _performanceDirectory: directory };
  const ctx = { organizationId: 'org-a', actor: { userId: 'reviewer', name: 'Synthetic reviewer' }, organizationWide: true, permissions: new Set(require('../services/competency/authorizationService').ACTIONS), directory, req: request };
  const cycleId = String(new mongoose.Types.ObjectId()), versionId = String(new mongoose.Types.ObjectId());
  jest.spyOn(require('../services/competency/libraryService'), 'getPublishedDefinition').mockResolvedValue({ cycleVersion: 1, role: { versionId, name: 'Synthetic pinned role', version: 1 }, criteria: [], definitionHash: 'synthetic-definition' });
  const payload = { cycleId, cycleRevision: 1, assignments: [{ participantId: 'employee', roleVersionId: versionId, assessorIds: ['reviewer'], appraisalId: String(pending._id) }] };
  return () => assessmentService.launch(ctx, payload, `race-${new mongoose.Types.ObjectId()}`);
}
test('linked parent final outcome and competency fence commit atomically', async () => {
  const { pending, assessment } = await fixture();
  await service.saveFinalOutcome(req, pending);
  expect((await Appraisal.findById(pending._id)).status).toBe('completed');
  expect((await Appraisal.findById(pending._id)).competencyResultReference.toObject()).toEqual({ assessmentId: String(assessment._id), number: 1, reportHash: 'published-result-hash' });
  expect((await Assessment.findById(assessment._id)).__v).toBe(1);
  expect(pending.$session()).toBeNull();
});
test('concurrent competency reopen after readiness read prevents stale parent finalisation', async () => {
  const { pending, assessment } = await fixture();
  const original = Assessment.updateOne; let raced = false;
  jest.spyOn(Assessment, 'updateOne').mockImplementation(async function (filter, update, options) {
    if (options?.session && !raced) { raced = true; await original.call(this, { _id: assessment._id }, { $set: { status: 'reopened' }, $inc: { revision: 1 } }); }
    return original.call(this, filter, update, options);
  });
  await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 409, code: 'ROLE_ASSESSMENT_REQUIRED' });
  expect(raced).toBe(true);
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
  expect((await Assessment.findById(assessment._id)).status).toBe('reopened');
});
test('concurrent reviewer source change after readiness read prevents stale parent finalisation', async () => {
  const { pending } = await fixture(); const original = Assessment.updateOne; let raced = false;
  jest.spyOn(Assessment, 'updateOne').mockImplementation(async function (filter, update, options) {
    if (options?.session && !raced) { raced = true; await Appraisal.updateOne({ _id: pending._id }, { $set: { 'managerReview.overallSummary.achievements': 'Concurrent amendment' }, $inc: { __v: 1 } }); }
    return original.call(this, filter, update, options);
  });
  await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 409, code: 'ROLE_ASSESSMENT_SOURCE_CHANGED' });
  const saved = await Appraisal.findById(pending._id);
  expect(saved.status).toBe('final_review_pending'); expect(saved.managerReview.overallSummary.achievements).toBe('Concurrent amendment');
});
test('ordinary unlinked appraisal keeps normal save without transaction requirement', async () => {
  const { pending } = await fixture({ linked: false });
  const transaction = jest.spyOn(Appraisal.db, 'transaction').mockRejectedValue(new Error('Must not be used'));
  await service.saveFinalOutcome(req, pending);
  expect(transaction).not.toHaveBeenCalled(); expect((await Appraisal.findById(pending._id)).status).toBe('completed');
});
test('first-link parent version fence invalidates an earlier no-link final outcome read', async () => {
  const { pending } = await fixture({ linked: false });
  jest.spyOn(Assessment, 'exists').mockImplementation(async () => {
    // A role-link transaction has fenced the parent while this finaliser still
    // holds its pre-link document. The link row need not yet be visible.
    await Appraisal.updateOne({ _id: pending._id }, { $inc: { __v: 1 } });
    return null;
  });
  await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 409, code: 'APPRAISAL_CHANGED' });
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
});
test('actual first linked launch loses safely when ordinary finalisation commits before its parent fence', async () => {
  const { pending } = await fixture({ linked: false });
  const launch = linkedLaunch(pending), original = Appraisal.updateOne; let raced = false;
  jest.spyOn(Appraisal, 'updateOne').mockImplementation(async function (filter, update, options) {
    if (options?.session && !raced) { raced = true; await service.saveFinalOutcome(req, pending); }
    return original.call(this, filter, update, options);
  });
  await expect(launch()).rejects.toMatchObject({ status: 409, code: 'APPRAISAL_CLOSED' });
  expect(raced).toBe(true); expect(await Assessment.countDocuments()).toBe(0);
  expect((await Appraisal.findById(pending._id)).status).toBe('completed');
});
test('actual first linked launch wins and stale ordinary no-link save conflicts', async () => {
  const { pending } = await fixture({ linked: false });
  const launch = linkedLaunch(pending), original = Assessment.exists; let raced = false;
  jest.spyOn(Assessment, 'exists').mockImplementation(async function (filter) {
    const found = await original.call(this, filter);
    if (!raced) { raced = true; await launch(); }
    return found;
  });
  await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 409, code: 'APPRAISAL_CHANGED' });
  expect(raced).toBe(true); expect(await Assessment.countDocuments()).toBe(1);
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
});
test('linked completion fails closed on standalone Mongo and preserves draft', async () => {
  const { pending } = await fixture(); const error = new Error('Transaction numbers are only allowed on a replica set member or mongos'); error.code = 20;
  jest.spyOn(Appraisal.db, 'transaction').mockRejectedValue(error);
  await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 503, code: 'FINALISATION_REQUIRES_TRANSACTION' });
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
});
test('tenant mismatch cannot enter either persistence path', async () => {
  const { pending } = await fixture();
  await expect(service.saveFinalOutcome({ currentOrganization: { id: 'org-b' } }, pending)).rejects.toMatchObject({ status: 403 });
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
});
test('real standalone database rejects linked transaction but still saves ordinary appraisals', async () => {
  const standalone = await MongoMemoryServer.create();
  await mongoose.disconnect();
  try {
    await mongoose.connect(standalone.getUri());
    const { pending } = await fixture();
    await expect(service.saveFinalOutcome(req, pending)).rejects.toMatchObject({ status: 503, code: 'FINALISATION_REQUIRES_TRANSACTION' });
    expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
    const ordinary = await fixture({ linked: false });
    await service.saveFinalOutcome(req, ordinary.pending);
    expect((await Appraisal.findById(ordinary.pending._id)).status).toBe('completed');
  } finally {
    await mongoose.disconnect();
    await standalone.stop();
    await mongoose.connect(mongo.getUri());
  }
});
