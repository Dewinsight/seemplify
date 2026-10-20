'use strict';
// Real feedback/appraisal routes and models with disposable Mongo. No provider
// or identity transport is replaced: this workflow requires neither service.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Feedback = require('../models/Feedback');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const feedbackRoutes = require('../routes/feedback');
const appraisalRoutes = require('../routes/appraisals');
const ORG = 'feedback-evidence-org';
let mongo, app, cycle, appraisal, feedback;
const actor = label => {
  const id = label === 'foreign' ? 'employee' : label;
  const organization = { id: label === 'foreign' ? 'foreign-org' : ORG,
    role: label === 'hr' ? 'hr_manager' : 'staff', appAccess: { mode: 'all', appIds: [] } };
  return { id, sub: id, name: `Synthetic ${id}`, email: `${id}@example.test`, currentOrganization: organization, organizations: [organization],
    idpTeams: [{ id: 'evidence-team', organizationId: organization.id, role: label === 'manager' ? 'line_manager' : 'member',
      ...(label === 'manager' ? { directReports: ['employee'] } : {}) }] };
};
const call = (method, path, who = 'employee') => request(app)[method](`/api${path}`).set('x-evidence-actor', who);
const select = (included = true, who = 'employee', appraisalId = appraisal._id, feedbackId = feedback._id) =>
  call('post', `/feedback/${feedbackId}/appraisal-evidence`, who).send({ included, appraisalId: String(appraisalId) });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = actor(req.get('x-evidence-actor') || 'employee');
    req.session = { user, currentOrganizationId: user.currentOrganization.id }; next(); });
  app.use('/api/feedback', feedbackRoutes); app.use('/api/appraisals', appraisalRoutes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  cycle = await Cycle.create({ organizationId: ORG, name: 'Synthetic selected-feedback exercise', status: 'active',
    periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'manager' },
    settings: { enableAiAssist: false, requireOkrAlignment: false, enablePeerFeedback: true, enable360Feedback: true } });
  appraisal = await Appraisal.create({ organizationId: ORG, cycleId: cycle._id, status: 'self_assessment_pending',
    employee: { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test' },
    manager: { userId: 'manager', name: 'Synthetic manager', email: 'manager@example.test' } });
  feedback = await Feedback.create({ organizationId: ORG, senderId: 'reviewer', receiverId: 'employee',
    senderInfo: { name: 'Synthetic reviewer', email: 'reviewer@example.test' }, receiverInfo: { name: 'Synthetic employee' },
    content: 'Original synthetic delivery evidence.', type: 'general', visibility: 'private', contextType: 'project', contextLabel: 'Synthetic project' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('recipient attaches one typed snapshot, reloads it as employee and reviewer, and removes it from the same active appraisal', async () => {
  const added = await select().expect(200);
  expect(added.body.data.appraisalEvidence).toMatchObject({ included: true, appraisalId: String(appraisal._id), selectedBy: 'employee' });
  await select().expect(200);
  const stored = await Appraisal.findById(appraisal._id);
  expect(stored.feedbackEvidence).toHaveLength(1);
  expect(stored.feedbackEvidence[0]).toMatchObject({ type: 'general', content: feedback.content, contextType: 'project',
    contextLabel: 'Synthetic project', senderDisplay: 'Synthetic reviewer', selectedBy: 'employee' });
  expect(String(stored.feedbackEvidence[0].feedbackId)).toBe(String(feedback._id));
  expect(stored.feedbackEvidence[0].selectedAt).toBeInstanceOf(Date);
  expect(stored.feedbackEvidence[0].receivedAt).toEqual(feedback.createdAt);
  expect(stored.auditLog.filter(row => row.action === 'feedback_evidence_added')).toHaveLength(1);
  for (const who of ['employee', 'manager']) {
    const loaded = await call('get', `/appraisals/${appraisal._id}`, who).expect(200);
    expect(loaded.body.data.feedbackEvidence).toHaveLength(1);
    expect(loaded.body.data.feedbackEvidence[0]).toMatchObject({ feedbackId: String(feedback._id), content: feedback.content, type: 'general' });
  }
  expect((await call('get', '/feedback/received').expect(200)).body.data[0].appraisalEvidence.included).toBe(true);
  await select(false).expect(200);
  expect((await Appraisal.findById(appraisal._id)).feedbackEvidence).toHaveLength(0);
  expect((await Feedback.findById(feedback._id)).appraisalEvidence.included).toBe(false);
  expect((await call('get', `/appraisals/${appraisal._id}`).expect(200)).body.data.feedbackEvidence).toEqual([]);
});

test('selected feedback remains a frozen snapshot after source changes and publication without changing report ratings', async () => {
  await select().expect(200);
  const snapshot = JSON.parse(JSON.stringify((await Appraisal.findById(appraisal._id)).feedbackEvidence));
  await Feedback.updateOne({ _id: feedback._id }, { $set: { content: 'Later source text must not rewrite the selected snapshot.', type: 'coaching' } });
  // Publication is an explicit fixture prerequisite here; finalization workflow
  // is covered elsewhere. This checks snapshot retention and the write fence.
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'completed', 'finalRating.overall': 4, 'finalRating.ratingLabel': 'Synthetic outcome' } });
  const parent = await call('get', `/appraisals/${appraisal._id}`, 'manager').expect(200);
  expect(parent.body.data.feedbackEvidence).toEqual(snapshot);
  const report = await call('get', `/appraisals/${appraisal._id}/report`).expect(200);
  expect(report.body.data).toMatchObject({ published: true, finalRating: { overall: 4, ratingLabel: 'Synthetic outcome' } });
  await select(false).expect(409);
  expect(JSON.parse(JSON.stringify((await Appraisal.findById(appraisal._id)).feedbackEvidence))).toEqual(snapshot);
});

test('only the feedback recipient can attach to their own same-tenant appraisal', async () => {
  for (const who of ['manager', 'hr', 'outsider']) await select(true, who).expect(403);
  await select(true, 'foreign').expect(403);
  const other = await Appraisal.create({ organizationId: ORG, cycleId: cycle._id, status: 'self_assessment_pending',
    employee: { userId: 'outsider', name: 'Synthetic outsider', email: 'outsider@example.test' }, manager: appraisal.manager.toObject() });
  await select(true, 'employee', other._id).expect(400);
  const foreignCycle = await Cycle.create({ ...cycle.toObject(), _id: new mongoose.Types.ObjectId(), organizationId: 'foreign-org' });
  const foreign = await Appraisal.create({ organizationId: 'foreign-org', cycleId: foreignCycle._id, status: 'self_assessment_pending',
    employee: appraisal.employee.toObject(), manager: appraisal.manager.toObject() });
  await select(true, 'employee', foreign._id).expect(400);
  for (const id of [appraisal._id, other._id, foreign._id]) expect((await Appraisal.findById(id)).feedbackEvidence).toHaveLength(0);
  expect((await Feedback.findById(feedback._id)).appraisalEvidence.included).toBe(false);
});

test('anonymous evidence and disabled feedback sources remain blocked before snapshot persistence', async () => {
  await Feedback.updateOne({ _id: feedback._id }, { $set: { anonymity: 'anonymous' } });
  await select().expect(409);
  await Feedback.updateOne({ _id: feedback._id }, { $set: { anonymity: 'named', contextType: 'peer' } });
  await Cycle.updateOne({ _id: cycle._id }, { $set: { 'settings.enablePeerFeedback': false, 'settings.enable360Feedback': false } });
  await select().expect(409);
  await Feedback.updateOne({ _id: feedback._id }, { $set: { contextType: '360' } });
  await select().expect(409);
  expect((await Appraisal.findById(appraisal._id)).feedbackEvidence).toHaveLength(0);
});

test('confidential recipient selection never restores the hidden source timestamp in appraisal evidence', async () => {
  await Feedback.updateOne({ _id: feedback._id }, { $set: { anonymity: 'confidential' } });
  const received = await call('get', '/feedback/received').expect(200);
  expect(received.body.data[0]).toMatchObject({ sender: 'Anonymous', senderId: null });
  expect(received.body.data[0]).not.toHaveProperty('date');
  await select().expect(200);
  const saved = (await Appraisal.findById(appraisal._id)).feedbackEvidence[0];
  expect(saved.senderDisplay).toBe('Anonymous');
  expect(saved.receivedAt).toBeUndefined();
  expect(saved.selectedAt).toBeInstanceOf(Date);
  for (const who of ['employee', 'manager']) {
    const loaded = await call('get', `/appraisals/${appraisal._id}`, who).expect(200);
    expect(loaded.body.data.feedbackEvidence[0]).not.toHaveProperty('receivedAt');
    expect(loaded.body.data.feedbackEvidence[0].content).toBe(feedback.content);
  }
});

test('validation failures never return the raw snapshot or internal cast diagnostics', async () => {
  const error = new mongoose.Error.ValidationError();
  error.addError('feedbackEvidence', new mongoose.Error.CastError('string', { content: 'PRIVATE_FEEDBACK_SENTINEL' }, 'feedbackEvidence'));
  jest.spyOn(Appraisal.prototype, 'save').mockRejectedValueOnce(error);
  const response = await select().expect(400);
  expect(response.body).toMatchObject({ success: false, code: 'INVALID_APPRAISAL_EVIDENCE' });
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_FEEDBACK_SENTINEL|Cast to|feedbackEvidence|ObjectId/);
  const invalidReference = await select(true, 'employee', appraisal._id, 'not-a-valid-feedback-id').expect(400);
  expect(invalidReference.body).toEqual({ success: false, code: 'INVALID_EVIDENCE_REFERENCE', error: 'Choose valid feedback and an appraisal.' });
});

test('failed feedback marker save has a safe error and retry repairs metadata without duplicating the appraisal snapshot', async () => {
  jest.spyOn(Feedback.prototype, 'save').mockRejectedValueOnce(new Error('PRIVATE_DATABASE_CONNECTION_STRING'));
  const failed = await select().expect(500);
  expect(failed.body).toMatchObject({ success: false, code: 'FEEDBACK_EVIDENCE_SAVE_FAILED' });
  expect(JSON.stringify(failed.body)).not.toMatch(/PRIVATE_DATABASE_CONNECTION_STRING|Original synthetic delivery evidence/);
  expect((await Appraisal.findById(appraisal._id)).feedbackEvidence).toHaveLength(1);
  await select().expect(200);
  expect((await Appraisal.findById(appraisal._id)).feedbackEvidence).toHaveLength(1);
  expect((await Feedback.findById(feedback._id)).appraisalEvidence.included).toBe(true);
});
