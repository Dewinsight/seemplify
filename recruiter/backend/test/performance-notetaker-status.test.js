'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Meeting = require('../models/PerformanceMeeting');
const Account = require('../models/NylasAccount');
const Observation = require('../models/PerformanceNotetakerObservation');
const shared = require('../services/aiRuntime/sharedIdentityService');
const nylas = require('../services/nylasV3Service');
const service = require('../services/performanceNotetakerStatusService');
const identity = { sub: 'manager', email: 'manager@example.test', organizationId: 'org-a' };
const input = { externalId: '507f1f77bcf86cd799439011' };
let mongo, meeting, state, reason, media, provider;
test.before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
test.beforeEach(async t => {
  await mongoose.connection.db.dropDatabase(); await Meeting.createIndexes(); await Observation.createIndexes();
  const account = await Account.create({ name: 'Status QA', clientId: 'synthetic-client', apiKey: 'synthetic-secret', clientSecret: 'synthetic-secret', active: true });
  meeting = await Meeting.create({ ...input, ownerSubject: identity.sub, organizationId: identity.organizationId, accountId: account._id, grantId: 'original-grant', notetakerId: 'original-bot', recordingState: 'scheduled', state: 'scheduled', participantSubjects: ['manager', 'employee'], recordingPolicyVersion: 'calendar-notetaker-v2', scheduledDate: new Date(Date.now() - 60000), duration: 30, conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc' });
  state = 'connecting'; reason = 'waiting_for_entry';
  t.mock.method(shared, 'resolveSharedPrincipal', async raw => ({ identity: raw, user: {} }));
  t.mock.method(nylas, 'getNylasInstance', () => ({ grants: { find: async () => ({ data: { email: 'original-calendar@example.test', provider: 'google' } }) } }));
  provider = t.mock.method(nylas, 'getStandaloneNotetakerStatus', async () => ({ data: { state, meeting_state: reason } }));
  media = t.mock.method(nylas, 'getStandaloneNotetakerMedia', async () => ({ transcript: { url: 'https://storage.googleapis.com/synthetic-transcript' }, recording: { url: 'https://storage.googleapis.com/synthetic-recording' } }));
});
test.afterEach(() => test.mock.restoreAll());
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test('observes lobby, recording and ended states without exposing media URLs or keys', async () => {
  const first = await service.status(identity, input);
  assert.equal(first.calendarEmail, 'original-calendar@example.test'); assert.equal(first.meetingState, 'waiting_for_entry');
  assert.equal(first.realtimeTranscript, false); assert.equal(first.transcriptState, 'after_call');
  await service.status(identity, input);
  assert.equal((await Observation.findOne()).events.length, 1);
  state = 'attending'; reason = 'recording_active';
  assert.equal((await service.status(identity, input)).events.length, 2);
  assert.equal(media.mock.callCount(), 0);
  state = 'disconnected'; reason = 'meeting_ended';
  const ended = await service.status(identity, input);
  assert.equal(ended.transcriptState, 'available'); assert.equal(ended.recordingAvailable, true);
  assert.equal(ended.events.length, 3);
  assert.equal(JSON.stringify(ended).includes('https://storage'), false); assert.equal(JSON.stringify(ended).includes('synthetic-secret'), false);
});
test('status cannot cross organization or owner boundaries', async () => {
  await assert.rejects(service.status({ ...identity, organizationId: 'org-b' }, input), { statusCode: 404 });
  await assert.rejects(service.status({ ...identity, sub: 'another-owner' }, input), { statusCode: 404 });
  assert.equal(provider.mock.callCount(), 0);
});
test('a revoked calendar does not hide the independent bot and no fallback grant is used', async t => {
  t.mock.method(nylas, 'getNylasInstance', () => ({ grants: { find: async () => { throw new Error('Revoked'); } } }));
  const result = await service.status(identity, input);
  assert.equal(result.calendarEmail, null); assert.equal(result.state, 'connecting');
});
test('stop racing media retrieval returns stopped state without media', async () => {
  state = 'disconnected'; reason = 'meeting_ended';
  media.mock.mockImplementation(async () => { await Meeting.updateOne({ _id: meeting._id }, { $set: { recordingState: 'revoked' } }); return { transcript: { url: 'https://storage.googleapis.com/synthetic' } }; });
  const result = await service.status(identity, input);
  assert.equal(result.state, 'revoked'); assert.equal(result.recordingAvailable, false); assert.equal(result.transcriptState, 'not_available');
});
test('concurrent identical observations remain one history entry', async () => {
  await Promise.all(Array.from({ length: 4 }, () => service.status(identity, input)));
  assert.equal(await Observation.countDocuments(), 1); assert.equal((await Observation.findOne()).events.length, 1);
});
const retryInput = () => ({ ...input, recordingAuthorization: { policyVersion: 'calendar-notetaker-v2', requestedBy: 'employee', requestedAt: new Date() } });
test('only confirmed failed entry can be retried; an attending or unknown bot is never duplicated', async t => {
  const created = t.mock.method(nylas, 'createStandaloneNotetaker', async () => ({ notetakerId: 'replacement-bot' }));
  for (state of ['attending', 'connecting', 'disconnected', 'unknown']) await assert.rejects(service.retry(identity, retryInput()), { statusCode: 409 });
  assert.equal(created.mock.callCount(), 0);
  state = 'failed_entry'; reason = 'admission_timeout';
  const results = await Promise.allSettled([service.retry(identity, retryInput()), service.retry(identity, retryInput())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(created.mock.callCount(), 1); assert.equal((await Meeting.findById(meeting._id)).notetakerId, 'replacement-bot');
});
test('stopped, closed and nonparticipant retry requests cannot create a bot', async t => {
  const created = t.mock.method(nylas, 'createStandaloneNotetaker', async () => ({ notetakerId: 'forbidden' }));
  const outsider = retryInput(); outsider.recordingAuthorization.requestedBy = 'outsider';
  await assert.rejects(service.retry(identity, outsider), { statusCode: 403 });
  await Meeting.updateOne({ _id: meeting._id }, { $set: { recordingState: 'revoked' } });
  await assert.rejects(service.retry(identity, retryInput()), { statusCode: 409 });
  await Meeting.updateOne({ _id: meeting._id }, { $set: { recordingState: 'scheduled', scheduledDate: new Date(Date.now() - 3600000) } });
  await assert.rejects(service.retry(identity, retryInput()), { statusCode: 409 });
  assert.equal(created.mock.callCount(), 0);
});
