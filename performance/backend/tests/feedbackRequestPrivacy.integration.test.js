'use strict';
// Real route/model persistence and tenant claims in disposable Mongo. Synthetic
// users have no delegated IdP token; the real nonproduction directory validates
// their active same-organization membership. No provider transport is needed.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Feedback = require('../models/Feedback');
const FeedbackRequest = require('../models/FeedbackRequest');
const User = require('../models/User');
const DomainEvent = require('../models/DomainEvent');
const Notification = require('../models/Notification');
const ScheduledReminder = require('../models/ScheduledReminder');
const { materializeDomainEvent } = require('../services/notificationWorker');
const actionRoutes = require('../routes/actions');
const notificationRoutes = require('../routes/notifications');
const routes = require('../routes/feedback');
const ORG = 'feedback-privacy-org';
const reviewers = ['reviewer-a', 'reviewer-b', 'reviewer-c', 'reviewer-d', 'reviewer-e'];
let mongo, app;
afterEach(() => jest.restoreAllMocks());
const call = (method, path, actor = 'subject', org = ORG) => request(app)[method](`/api/feedback${path}`)
  .set('x-privacy-actor', actor).set('x-privacy-org', org);
const payload = (extra = {}) => ({ subjectId: 'subject', reviewerIds: reviewers, contextType: '360', anonymity: 'anonymous',
  visibility: 'private', dueDate: new Date(Date.now() + 86400000).toISOString(), questions: ['What helped the team?'], ...extra });
async function ownRequest(actor) {
  const response = await call('get', '/requests?view=reviewer', actor).expect(200);
  expect(response.body.data).toHaveLength(1);
  return response.body.data[0];
}
async function respond(actor) {
  const invitation = await ownRequest(actor);
  return call('post', '/', actor).send({ requestId: invitation._id, receiverId: invitation.subjectId,
    content: `Synthetic helpful observation from ${actor}`, type: 'general' }).expect(201);
}
function expectSummaryOnly(data) {
  expect(data).toHaveLength(1);
  for (const field of ['_id', 'id', 'requestId', 'reviewerId', 'reviewerInfo', 'fulfilledByFeedbackId', 'createdBy',
    'decisionComment', 'decidedAt', 'fulfilledAt', 'createdAt', 'updatedAt']) expect(data[0]).not.toHaveProperty(field);
  const text = JSON.stringify(data);
  for (const actor of reviewers) expect(text).not.toContain(actor);
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get('x-privacy-actor') || 'subject';
    if (actor === 'logged-out') return next();
    const org = req.get('x-privacy-org') || ORG;
    const organization = { id: org, role: actor === 'hr' ? 'hr_manager' : 'staff', appAccess: { mode: 'all', appIds: [] } };
    const user = { id: actor, sub: actor, name: `Synthetic ${actor}`, email: `${actor}@example.test`,
      currentOrganization: organization, organizations: [organization],
      idpTeams: [{ id: 'privacy-team', organizationId: org, role: actor === 'manager' ? 'line_manager' : 'member',
        ...(actor === 'manager' ? { directReports: ['subject'] } : {}) }] };
    req.session = { user, currentOrganizationId: org }; next();
  });
  app.use('/api/feedback', routes);
  app.use('/api/actions', actionRoutes); app.use('/api/notifications', notificationRoutes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await User.create(['subject', 'manager', 'hr', ...reviewers].map(idpSub => ({ idpSub, email: `${idpSub}@example.test`,
    profile: { displayName: `Synthetic ${idpSub}` }, isActive: true,
    organizationMemberships: [{ organization: ORG, role: 'staff', isActive: true }] })));
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('anonymous creation and subject/requester reads disclose only cohort progress, never a reviewer-to-response map', async () => {
  const created = await call('post', '/requests', 'manager').send(payload()).expect(201);
  expect(created.body.count).toBe(1); expectSummaryOnly(created.body.data);
  expect(created.body.data[0]).toMatchObject({ kind: 'cohort', anonymity: 'anonymous', minimumCohortSize: 5,
    reviewerCount: 5, reportable: false, responseCount: null, state: 'collecting' });
  const before = (await call('get', '/requests?view=subject&state=fulfilled').expect(200)).body;
  expectSummaryOnly(before.data);
  const responseIds = [];
  for (const actor of reviewers.slice(0, 4)) responseIds.push((await respond(actor)).body.data._id);
  for (const [actor, view] of [['subject', 'subject'], ['manager', 'requested']]) {
    const loaded = await call('get', `/requests?view=${view}&state=fulfilled`, actor).expect(200);
    expectSummaryOnly(loaded.body.data);
    expect(loaded.body.data[0]).toMatchObject({ reportable: false, responseCount: null, state: 'collecting' });
    expect(loaded.body.data).toEqual(before.data);
    for (const id of responseIds) expect(JSON.stringify(loaded.body)).not.toContain(id);
  }
  expect((await call('get', '/received').expect(200)).body.data).toEqual([]);
  await call('post', `/${responseIds[0]}/acknowledge`).send({}).expect(404);
  expect((await Feedback.findById(responseIds[0])).acknowledgedAt).toBeUndefined();
  // The requester has progress access, not a new grant to private responses.
  await call('get', `/${responseIds[0]}`, 'manager').expect(403);
  await respond(reviewers[4]);
  const released = await call('get', '/received').expect(200);
  expect(released.body.data).toHaveLength(5);
  for (const item of released.body.data) {
    expect(item).toMatchObject({ sender: 'Anonymous', senderId: null });
    expect(item).not.toHaveProperty('requestId'); expect(item).not.toHaveProperty('date');
    const detail = await call('get', `/${item._id}`).expect(200);
    expect(detail.body.data).not.toHaveProperty('requestId'); expect(detail.body.data).not.toHaveProperty('date');
  }
  const complete = await call('get', '/requests?view=requested', 'manager').expect(200);
  expectSummaryOnly(complete.body.data);
  expect(complete.body.data[0]).toMatchObject({ reviewerCount: 5, reportable: true, responseCount: 5, state: 'reportable' });
  const acknowledged = await call('post', `/${responseIds[0]}/acknowledge`).send({}).expect(200);
  expect(acknowledged.body.data.acknowledgedAt).toBeTruthy();
  expect(acknowledged.body.data).not.toHaveProperty('requestId'); expect(acknowledged.body.data).not.toHaveProperty('date');
});

test('reviewer owns only their actionable invitation, decision, and sent-response metadata', async () => {
  await call('post', '/requests', 'subject').send(payload()).expect(201);
  const own = await ownRequest(reviewers[0]);
  expect(own).toMatchObject({ reviewerId: reviewers[0], subjectId: 'subject', state: 'requested' });
  const decision = await call('post', `/requests/${own._id}/decision`, reviewers[0]).send({ decision: 'accept', comment: 'Private response intent' }).expect(200);
  expect(decision.body.data).toMatchObject({ _id: own._id, state: 'accepted', decisionComment: 'Private response intent' });
  await call('post', `/requests/${own._id}/decision`, reviewers[1]).send({ decision: 'accept' }).expect(403);
  const sent = await respond(reviewers[0]);
  expect(sent.body.data).toMatchObject({ sender: `Synthetic ${reviewers[0]}`, senderId: reviewers[0], requestId: own._id });
  expect(sent.body.data.date).toBeTruthy();
  const ownSent = await call('get', '/sent', reviewers[0]).expect(200);
  expect(ownSent.body.data[0]).toMatchObject({ requestId: own._id, senderId: reviewers[0] });
  const requested = await call('get', '/requests?view=requested', 'subject').expect(200);
  expectSummaryOnly(requested.body.data);
  expect(requested.body.data[0]).toMatchObject({ responseCount: null, state: 'collecting' });
  expect(JSON.stringify(requested.body)).not.toContain('Private response intent');
});

test('foreign, deleted, and unrelated-cohort responses do not unlock anonymous reporting for subject or HR', async () => {
  const created = await call('post', '/requests', 'hr').send(payload({ visibility: 'manager-only' })).expect(201);
  const cohortId = created.body.data[0].cohortId;
  for (const actor of reviewers.slice(0, 4)) await respond(actor);
  const base = { receiverId: 'subject', senderId: 'extra', content: 'Synthetic excluded response', type: 'general',
    anonymity: 'anonymous', contextType: '360', visibility: 'manager-only', minimumCohortSize: 5 };
  await Feedback.create([{ ...base, organizationId: 'foreign-org', cohortId },
    { ...base, organizationId: ORG, cohortId, deletedAt: new Date() },
    { ...base, organizationId: ORG, cohortId, receiverId: 'unrelated-subject' },
    { ...base, organizationId: ORG, cohortId: 'different-cohort' }]);
  for (const [actor, view] of [['subject', 'subject'], ['hr', 'requested']]) {
    const loaded = await call('get', `/requests?view=${view}`, actor).expect(200);
    expectSummaryOnly(loaded.body.data);
    expect(loaded.body.data[0]).toMatchObject({ reportable: false, responseCount: null });
    const visible = await call('get', actor === 'hr' ? '/?userId=subject' : '/received', actor).expect(200);
    expect(visible.body.data).toEqual([]);
  }
  await respond(reviewers[4]);
  const hr = await call('get', '/?userId=subject', 'hr').expect(200);
  const manager = await call('get', '/direct-reports', 'manager').expect(200);
  for (const response of [hr, manager]) {
    expect(response.body.data).toHaveLength(5);
    for (const item of response.body.data) {
      expect(item.senderId).toBeNull(); expect(item).not.toHaveProperty('requestId'); expect(item).not.toHaveProperty('date');
    }
  }
});

test('named/project requests keep existing invitation identities, decisions and report links', async () => {
  const created = await call('post', '/requests', 'manager').send(payload({ anonymity: 'named', contextType: 'project', reviewerIds: [reviewers[0]] })).expect(201);
  const own = created.body.data[0];
  expect(own).toMatchObject({ reviewerId: reviewers[0], reviewerInfo: { name: `Synthetic ${reviewers[0]}` } });
  const sent = await respond(reviewers[0]);
  const received = await call('get', '/received').expect(200);
  expect(received.body.data[0]).toMatchObject({ requestId: own._id, senderId: reviewers[0], _id: sent.body.data._id });
  expect(received.body.data[0].date).toBeTruthy();
  const requested = await call('get', '/requests?view=requested', 'manager').expect(200);
  expect(requested.body.data[0]).toMatchObject({ _id: own._id, state: 'fulfilled', fulfilledByFeedbackId: sent.body.data._id });
});

test('employee reviewers inherit the validated manager-only invitation audience without gaining standalone manager-only authority', async () => {
  await call('post', '/requests', 'manager').send(payload({ visibility: 'manager-only' })).expect(201);
  const first = await ownRequest(reviewers[0]);
  const second = await ownRequest(reviewers[1]);
  const submit = (actor, invitation, extra = {}) => call('post', '/', actor).send({ requestId: invitation._id,
    receiverId: 'subject', content: 'Synthetic scoped requested observation', type: 'general', visibility: 'manager-only', ...extra });
  const answered = await submit(reviewers[0], first).expect(201);
  expect(answered.body.data.visibility).toBe('manager-only');
  await submit(reviewers[2], second).expect(409);
  await submit(reviewers[1], second, { receiverId: 'outsider' }).expect(409);
  const inherited = await submit(reviewers[1], second, { visibility: 'public' }).expect(201);
  expect(inherited.body.data.visibility).toBe('manager-only');
  expect((await Feedback.findById(inherited.body.data._id)).visibility).toBe('manager-only');
  const replay = await submit(reviewers[0], first).expect(201);
  expect(replay.body.data._id).toBe(answered.body.data._id);
  await call('post', '/', reviewers[0]).send({ receiverId: 'subject', content: 'Standalone restricted audience', visibility: 'manager-only' }).expect(403);
  expect(await Feedback.countDocuments({ organizationId: ORG })).toBe(2);
});

test('duplicate historical responses from one author cannot count as five anonymous reviewers', async () => {
  await call('post', '/requests', 'manager').send(payload()).expect(201);
  for (const actor of reviewers.slice(0, 4)) await respond(actor);
  const first = await Feedback.findOne({ senderId: reviewers[0] }).lean();
  delete first._id; delete first.__v;
  await Feedback.create({ ...first, content: 'Synthetic duplicate historical persistence' });
  expect(await Feedback.countDocuments({ organizationId: ORG })).toBe(5);
  expect((await call('get', '/received').expect(200)).body.data).toEqual([]);
  const before = await call('get', '/requests?view=requested', 'manager').expect(200);
  expect(before.body.data[0]).toMatchObject({ reportable: false, responseCount: null, state: 'collecting' });
  await respond(reviewers[4]);
  const after = await call('get', '/requests?view=requested', 'manager').expect(200);
  expect(after.body.data[0]).toMatchObject({ reportable: true, responseCount: 5, state: 'reportable' });
});

test('concurrent requested-response retries preserve one first-captured response and do not widen the invitation audience', async () => {
  await call('post', '/requests', 'manager').send(payload({ anonymity: 'named', reviewerIds: [reviewers[0]], visibility: 'manager-only' })).expect(201);
  const invitation = await ownRequest(reviewers[0]);
  const value = { requestId: invitation._id, receiverId: 'subject', content: 'First captured requested evidence', type: 'general', visibility: 'public' };
  const submit = content => call('post', '/', reviewers[0]).send({ ...value, content });
  const responses = await Promise.all(Array.from({ length: 4 }, () => submit(value.content)));
  for (const response of responses) expect(response.status).toBe(201);
  expect(new Set(responses.map(response => response.body.data._id)).size).toBe(1);
  expect(await Feedback.countDocuments({ organizationId: ORG })).toBe(1);
  expect(await DomainEvent.countDocuments({ organizationId: ORG, eventType: 'feedback.received' })).toBe(1);
  const stored = await Feedback.findOne({ organizationId: ORG });
  expect(stored).toMatchObject({ content: value.content, senderId: reviewers[0], visibility: 'manager-only' });
  const replay = await submit(value.content).expect(201);
  expect(replay.body.data._id).toBe(String(stored._id));
  await submit('A different response must not replace captured evidence').expect(409);
  expect((await Feedback.findById(stored._id)).content).toBe(value.content);
});

test('response persistence followed by a request-receipt failure resumes without duplicating feedback or replacing its payload', async () => {
  await call('post', '/requests', 'manager').send(payload({ anonymity: 'named', reviewerIds: [reviewers[0]] })).expect(201);
  const invitation = await ownRequest(reviewers[0]);
  const value = { requestId: invitation._id, receiverId: 'subject', content: 'Captured before metadata interruption', type: 'general' };
  const originalReceipt = FeedbackRequest.findOneAndUpdate.bind(FeedbackRequest);
  const interrupted = jest.spyOn(FeedbackRequest, 'findOneAndUpdate').mockImplementation((...args) => {
    if (args[1]?.$set?.state === 'fulfilled') throw new Error('SYNTHETIC response receipt interruption');
    return originalReceipt(...args);
  });
  const failed = await call('post', '/', reviewers[0]).send(value).expect(500);
  expect(failed.body.error).not.toContain('SYNTHETIC');
  interrupted.mockRestore();
  const first = await Feedback.findOne({ organizationId: ORG });
  expect(first).not.toBeNull();
  await call('post', '/', reviewers[0]).send({ ...value, content: 'Changed replay' }).expect(409);
  const replay = await call('post', '/', reviewers[0]).send(value).expect(201);
  expect(replay.body.data._id).toBe(String(first._id));
  expect(await Feedback.countDocuments({ organizationId: ORG })).toBe(1);
  expect((await FeedbackRequest.findById(invitation._id)).state).toBe('fulfilled');
});

test('a decline and a response claim cannot both win, and the losing path creates no extra response', async () => {
  await call('post', '/requests', 'manager').send(payload({ anonymity: 'named', reviewerIds: [reviewers[0], reviewers[1]] })).expect(201);
  const declined = await ownRequest(reviewers[0]);
  await call('post', `/requests/${declined._id}/decision`, reviewers[0]).send({ decision: 'decline' }).expect(200);
  await call('post', '/', reviewers[0]).send({ requestId: declined._id, receiverId: 'subject', content: 'Must not persist after decline' }).expect(409);
  expect(await Feedback.countDocuments()).toBe(0);
  const invitation = await ownRequest(reviewers[1]);
  let ready, release;
  const reached = new Promise(resolve => { ready = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const persist = Feedback.findOneAndUpdate.bind(Feedback);
  // Hold the actual model write after the invitation claim, so the competing
  // decision request exercises a real interleaving rather than a timing guess.
  jest.spyOn(Feedback, 'findOneAndUpdate').mockImplementationOnce(async (...args) => { ready(); await held; return persist(...args); });
  const pending = call('post', '/', reviewers[1]).send({ requestId: invitation._id, receiverId: 'subject', content: 'First claimed response' }).then(response => response);
  await reached;
  try {
    await call('post', `/requests/${invitation._id}/decision`, reviewers[1]).send({ decision: 'decline' }).expect(409);
  } finally { release(); }
  expect((await pending).status).toBe(201);
  expect((await FeedbackRequest.findById(invitation._id)).state).toBe('fulfilled');
  expect(await Feedback.countDocuments()).toBe(1);
});

test('completed legacy invitations replay their captured response ID and never replace removed feedback', async () => {
  await call('post', '/requests', 'manager').send(payload({ anonymity: 'named', reviewerIds: [reviewers[0]] })).expect(201);
  const invitation = await ownRequest(reviewers[0]);
  const original = await Feedback.create({ organizationId: ORG, requestId: invitation._id, senderId: reviewers[0], receiverId: 'subject',
    content: 'Historical captured response', type: 'general', visibility: 'private', anonymity: 'named' });
  await FeedbackRequest.updateOne({ _id: invitation._id }, { $set: { state: 'fulfilled', fulfilledByFeedbackId: original._id, fulfilledAt: new Date() } });
  const value = { requestId: invitation._id, receiverId: 'subject', content: original.content, type: 'general' };
  const replay = await call('post', '/', reviewers[0]).send(value).expect(201);
  expect(replay.body.data._id).toBe(String(original._id));
  expect(await Feedback.countDocuments()).toBe(1);
  await Feedback.updateOne({ _id: original._id }, { $set: { deletedAt: new Date() } });
  await call('post', '/', reviewers[0]).send(value).expect(409);
  expect((await Feedback.findById(original._id)).deletedAt).toBeInstanceOf(Date);
});

test('confidential subject and non-HR requester cannot correlate authors; the HR exception and reviewer action remain', async () => {
  const created = await call('post', '/requests', 'manager').send(payload({ anonymity: 'confidential', contextType: 'peer', reviewerIds: [reviewers[0]] })).expect(201);
  expectSummaryOnly(created.body.data);
  expect(created.body.data[0]).toMatchObject({ kind: 'confidential_summary', reportable: true, reviewerCount: 1 });
  expect(created.body.data[0]).not.toHaveProperty('cohortId');
  const sent = await respond(reviewers[0]);
  const subject = await call('get', '/received').expect(200);
  expect(subject.body.data[0]).toMatchObject({ sender: 'Anonymous', senderId: null });
  expect(subject.body.data[0]).not.toHaveProperty('requestId'); expect(subject.body.data[0]).not.toHaveProperty('date');
  const requested = await call('get', '/requests?view=requested', 'manager').expect(200);
  expectSummaryOnly(requested.body.data);
  expect(JSON.stringify(requested.body)).not.toContain(sent.body.data._id);
  const hr = await call('get', `/${sent.body.data._id}`, 'hr').expect(200);
  expect(hr.body.data).toMatchObject({ senderId: reviewers[0], requestId: sent.body.data.requestId });
  await call('post', '/requests', 'hr').send(payload({ subjectId: 'hr', anonymity: 'confidential', contextType: 'peer', reviewerIds: [reviewers[1]] })).expect(201);
  const hrRequest = await call('get', '/requests?view=subject', 'hr').expect(200);
  expect(hrRequest.body.data[0]).toMatchObject({ reviewerId: reviewers[1], state: 'requested' });
});

test('request summaries retain tenant, own-view and authentication boundaries', async () => {
  await call('post', '/requests', 'manager').send(payload()).expect(201);
  for (const view of ['reviewer', 'requested', 'subject']) {
    expect((await call('get', `/requests?view=${view}`, 'outsider').expect(200)).body.data).toEqual([]);
    expect((await call('get', `/requests?view=${view}`, 'subject', 'foreign-org').expect(200)).body.data).toEqual([]);
    await call('get', `/requests?view=${view}`, 'logged-out').expect(401);
  }
  expect(await FeedbackRequest.countDocuments({ organizationId: ORG })).toBe(5);
});

test('anonymous responses retain private audit, publish one cohort notification at five, and never disclose individual response timing', async () => {
  const sixth = 'reviewer-f';
  await User.create({ idpSub: sixth, email: `${sixth}@example.test`, isActive: true,
    profile: { displayName: `Synthetic ${sixth}` }, organizationMemberships: [{ organization: ORG, role: 'staff', isActive: true }] });
  const created = await call('post', '/requests', 'manager').send(payload({ reviewerIds: [...reviewers, sixth] })).expect(201);
  const cohortId = created.body.data[0].cohortId;
  const reminders = await ScheduledReminder.find({ organizationId: ORG }).lean();
  expect(reminders.length).toBeGreaterThan(0);
  expect(new Set(reminders.map(reminder => reminder.userId))).toEqual(new Set([...reviewers, sixth]));
  const invitationEvents = await DomainEvent.find({ organizationId: ORG, eventType: 'feedback.requested' });
  for (const event of invitationEvents) await materializeDomainEvent(event);
  const reviewerActions = await request(app).get('/api/actions').set('x-privacy-actor', reviewers[0]).expect(200);
  expect(reviewerActions.body.data.items).toHaveLength(1);
  expect(reviewerActions.body.data.items[0].target).toMatchObject({ type: 'FeedbackRequest', id: (await ownRequest(reviewers[0]))._id });
  const ids = [];
  for (const actor of reviewers.slice(0, 4)) {
    ids.push((await respond(actor)).body.data._id);
    const events = await DomainEvent.find({ organizationId: ORG, eventType: 'feedback.received' });
    for (const event of events) await materializeDomainEvent(event);
    expect(await Notification.countDocuments({ organizationId: ORG, userId: 'subject' })).toBe(0);
    const actions = await request(app).get('/api/actions').set('x-privacy-actor', 'subject').expect(200);
    expect(actions.body.data.items).toEqual([]);
    const counts = await request(app).get('/api/actions/counts').set('x-privacy-actor', 'subject').expect(200);
    expect(counts.body.data.open).toBe(0);
  }
  const audits = await DomainEvent.find({ organizationId: ORG, eventType: 'feedback.received', 'aggregate.type': 'Feedback' }).lean();
  expect(audits).toHaveLength(4);
  expect(audits.map(event => event.aggregate.id).sort()).toEqual([...ids].sort());
  for (const event of audits) expect(event.recipients).toEqual([]);
  ids.push((await respond(reviewers[4])).body.data._id);
  const available = await DomainEvent.find({ organizationId: ORG, eventType: 'feedback.received', 'aggregate.type': 'FeedbackCohort' });
  expect(available).toHaveLength(1);
  expect(available[0].aggregate.id).toBe(cohortId);
  expect(available[0].recipients.map(recipient => recipient.userId)).toEqual(['subject']);
  expect(available[0].actor.userId).toBeUndefined();
  expect(available[0].notification).toMatchObject({ deepLink: '/feedback', target: { type: 'FeedbackCohort', id: cohortId } });
  const safeEvent = JSON.stringify(available[0]);
  for (const value of [...reviewers, ...ids]) expect(safeEvent).not.toContain(value);
  await materializeDomainEvent(available[0]); await materializeDomainEvent(available[0]);
  const first = (await Notification.findOne({ organizationId: ORG, userId: 'subject' })).toObject();
  expect(first).toMatchObject({ deepLink: '/feedback', target: { type: 'FeedbackCohort', id: cohortId } });
  const actions = await request(app).get('/api/actions').set('x-privacy-actor', 'subject').expect(200);
  expect(actions.body.data.items).toHaveLength(1);
  expect(actions.body.data.items[0].target).toMatchObject({ type: 'FeedbackCohort', id: cohortId });
  const originalTimestamp = available[0].createdAt;
  ids.push((await respond(sixth)).body.data._id);
  const replay = await DomainEvent.find({ organizationId: ORG, 'aggregate.type': 'FeedbackCohort' });
  expect(replay).toHaveLength(1); expect(replay[0].createdAt).toEqual(originalTimestamp);
  await materializeDomainEvent(replay[0]);
  expect(await Notification.countDocuments({ organizationId: ORG, userId: 'subject' })).toBe(1);
  expect((await Notification.findOne({ organizationId: ORG, userId: 'subject' })).createdAt).toEqual(first.createdAt);
  expect(await DomainEvent.countDocuments({ organizationId: ORG, eventType: 'feedback.received', 'aggregate.type': 'Feedback', recipients: { $size: 0 } })).toBe(6);
});
