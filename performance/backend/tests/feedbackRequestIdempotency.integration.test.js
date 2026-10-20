'use strict';
// Real Mongo concurrency and recoverable fault injection, not an HTTP/provider
// substitute. Only the named failure cases interrupt model persistence.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const FeedbackRequest = require('../models/FeedbackRequest');
const Operation = require('../models/CompetencyOperation');
const User = require('../models/User');
const DomainEvent = require('../models/DomainEvent');
const ScheduledReminder = require('../models/ScheduledReminder');
const routes = require('../routes/feedback');
const ORG = 'feedback-idempotent-org';
const reviewers = ['reviewer-1', 'reviewer-2', 'reviewer-3', 'reviewer-4', 'reviewer-5'];
const key = 'synthetic-feedback-request-key';
let app, mongo;
const body = extra => ({ subjectId: 'subject', reviewerIds: reviewers, contextType: '360', anonymity: 'anonymous', visibility: 'private',
  questions: ['What helped?'], dueDate: new Date(Date.now() + 86400000).toISOString(), ...extra });
function send(payload, requestKey = key, actor = 'manager', org = ORG) {
  const call = request(app).post('/api/feedback/requests').set('x-batch-actor', actor).set('x-batch-org', org);
  if (requestKey !== null) call.set('Idempotency-Key', requestKey);
  return call.send(payload);
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  await Promise.all([Operation.init(), FeedbackRequest.init(), DomainEvent.init(), ScheduledReminder.init(), User.init()]);
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get('x-batch-actor') || 'manager';
    const id = actor === 'manager-denied' ? 'manager' : actor;
    const org = req.get('x-batch-org') || ORG;
    const organization = { id: org, role: 'staff', appAccess: { mode: 'all', appIds: [] },
      ...(actor === 'manager-denied' ? { authorization: { permissionsByApp: { 'performance-management': [] } } } : {}) };
    const user = { id, sub: id, email: `${id}@example.test`, name: `Synthetic ${id}`, currentOrganization: organization, organizations: [organization],
      idpTeams: [{ id: 'batch-team', organizationId: org, role: 'line_manager', directReports: ['subject'] }] };
    req.session = { user, currentOrganizationId: org }; next();
  });
  app.use('/api/feedback', routes);
});
beforeEach(async () => {
  await Promise.all([FeedbackRequest.deleteMany({}), Operation.deleteMany({}), User.deleteMany({}), DomainEvent.deleteMany({}), ScheduledReminder.deleteMany({})]);
  await User.create(['subject', 'manager', 'second-manager', ...reviewers].map(idpSub => ({ idpSub, email: `${idpSub}@example.test`, isActive: true,
    profile: { displayName: `Synthetic ${idpSub}` }, organizationMemberships: [ORG, 'second-org'].map(organization => ({ organization, role: 'staff', isActive: true })) })));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('concurrent identical retries create one cohort, one invitation/event/reminder sequence per reviewer using only the primary ledger index', async () => {
  await Operation.collection.dropIndexes();
  expect((await Operation.collection.indexes()).map(index => index.name)).toEqual(['_id_']);
  const payload = body();
  const results = await Promise.all(Array.from({ length: 4 }, () => send(payload)));
  for (const response of results) expect(response.status).toBe(201);
  expect(new Set(results.map(response => response.body.data[0].cohortId)).size).toBe(1);
  expect(await FeedbackRequest.countDocuments()).toBe(5);
  expect(await Operation.countDocuments()).toBe(1);
  expect(await DomainEvent.countDocuments({ eventType: 'feedback.requested' })).toBe(5);
  const reminders = await ScheduledReminder.find().lean();
  expect(reminders.length).toBeGreaterThan(0);
  expect(new Set(reminders.map(item => `${item.userId}:${item.target.id}:${item.stage}`)).size).toBe(reminders.length);
  expect((await Operation.findOne()).expiresAt).toBeUndefined();
  for (const response of results) {
    expect(response.body.data[0]).toMatchObject({ kind: 'cohort', reviewerCount: 5, responseCount: null });
    expect(JSON.stringify(response.body)).not.toContain(key);
    expect(response.body.data[0]).not.toHaveProperty('requestHash');
  }
});

test('a partial persistence failure resumes the same invitation IDs and preserves a reviewer decision without duplicate notifications or reactivated reminders', async () => {
  const payload = body();
  const original = FeedbackRequest.findOneAndUpdate.bind(FeedbackRequest);
  let writes = 0;
  jest.spyOn(FeedbackRequest, 'findOneAndUpdate').mockImplementation((...args) => {
    if (++writes === 2) throw new Error('SYNTHETIC interrupted second invitation');
    return original(...args);
  });
  const failed = await send(payload).expect(500);
  expect(failed.body.error).not.toContain('SYNTHETIC');
  const partial = await FeedbackRequest.findOne(); expect(await FeedbackRequest.countDocuments()).toBe(1);
  await FeedbackRequest.updateOne({ _id: partial._id }, { $set: { state: 'declined', decisionComment: 'Original reviewer decision' } });
  await ScheduledReminder.updateMany({ 'target.id': String(partial._id) }, { $set: { status: 'cancelled' } });
  jest.restoreAllMocks();
  await send(payload).expect(201);
  expect(await FeedbackRequest.countDocuments()).toBe(5);
  expect(await DomainEvent.countDocuments({ eventType: 'feedback.requested' })).toBe(5);
  expect(await FeedbackRequest.findById(partial._id)).toMatchObject({ state: 'declined', decisionComment: 'Original reviewer decision' });
  expect(await ScheduledReminder.countDocuments({ 'target.id': String(partial._id), status: { $ne: 'cancelled' } })).toBe(0);
});

test('a failure after all invitations but before completion safely reconciles the same batch and changed payload conflicts', async () => {
  const payload = body();
  const spy = jest.spyOn(Operation, 'updateOne').mockImplementationOnce(() => { throw new Error('SYNTHETIC receipt persistence failed'); });
  await send(payload).expect(500); spy.mockRestore();
  const ids = (await FeedbackRequest.find().lean()).map(row => String(row._id)).sort();
  expect(ids).toHaveLength(5);
  await send(payload).expect(201);
  expect((await FeedbackRequest.find().lean()).map(row => String(row._id)).sort()).toEqual(ids);
  const conflict = await send({ ...payload, questions: ['Changed request intent'] }).expect(409);
  expect(conflict.body.code).toBe('REQUEST_KEY_CONFLICT');
  expect(await DomainEvent.countDocuments({ eventType: 'feedback.requested' })).toBe(5);
});

test('a directory failure before writes is retryable with the same key, and completed replay still requires current permission', async () => {
  const payload = body();
  const spy = jest.spyOn(User, 'findOne').mockImplementationOnce(() => { throw Object.assign(new Error('SYNTHETIC directory unavailable'), { status: 503 }); });
  await send(payload).expect(503); spy.mockRestore();
  expect(await FeedbackRequest.countDocuments()).toBe(0);
  await send(payload).expect(201);
  await send(payload, key, 'manager-denied').expect(403);
  expect(await FeedbackRequest.countDocuments()).toBe(5);
});

test('completed replay after the due date returns the same persisted cohort without reopening invitations', async () => {
  const payload = body({ dueDate: new Date(Date.now() + 600).toISOString() });
  const initial = await send(payload).expect(201);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(payload.dueDate) - Date.now() + 20)));
  const replay = await send(payload).expect(201);
  expect(replay.body.data).toEqual(initial.body.data);
  expect(await FeedbackRequest.countDocuments()).toBe(5);
  expect(await DomainEvent.countDocuments({ eventType: 'feedback.requested' })).toBe(5);
});

test('the same key in another authorized actor or organization is a different batch; malformed keys write nothing', async () => {
  const payload = body();
  await send(payload, 'short').expect(400);
  expect(await FeedbackRequest.countDocuments()).toBe(0); expect(await Operation.countDocuments()).toBe(0);
  const first = await send(payload).expect(201);
  const otherActor = await send(payload, key, 'second-manager').expect(201);
  const otherOrg = await send(payload, key, 'manager', 'second-org').expect(201);
  expect(new Set([first, otherActor, otherOrg].map(result => result.body.data[0].cohortId)).size).toBe(3);
  expect(await FeedbackRequest.countDocuments({ organizationId: ORG })).toBe(10);
  expect(await FeedbackRequest.countDocuments({ organizationId: 'second-org' })).toBe(5);
  expect(await Operation.countDocuments()).toBe(3);
});
