'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const principals = require('../services/aiRuntime/sharedIdentityService');
const nylas = require('../services/nylasV3Service');
const Meeting = require('../models/PerformanceMeeting');
const service = require('../services/performanceMeetingService');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');
let mongo;
const identity = { sub: 'calendar-owner', email: 'owner@example.test', organizationId: 'org-a' };
const input = () => ({ externalId: new mongoose.Types.ObjectId().toString(), scheduledDate: new Date(Date.now() + 3600000), duration: 30, participants: [{ email: 'owner@example.test' }], record: true });
test.before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Meeting.createIndexes(); });
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.afterEach(() => test.mock.restoreAll());
function setup(t, options = {}) {
  t.mock.method(principals, 'resolveSharedPrincipal', async raw => ({ identity: raw, user: { email: raw.email, nylasGrantId: options.noGrant ? null : 'personal-grant', nylasGrantStatus: 'active' } }));
  const createEvent = t.mock.fn(async () => { if (options.eventFailure) throw new Error('Ambiguous provider timeout'); return { data: { id: 'provider-event', conferencing: { details: { url: 'https://meet.google.com/aaa-bbbb-ccc' } } } }; });
  t.mock.method(nylas, 'getNylasInstance', () => ({ events: { create: createEvent }, grants: { find: async () => ({ data: { provider: 'google', email: 'calendar@example.test', grantStatus: 'valid' } }) } }));
  t.mock.method(nylas, 'getCalendars', async () => [{ id: 'calendar', isPrimary: true }]);
  t.mock.method(nylas, 'createStandaloneNotetaker', async () => { if (options.botFailure) throw new Error('Notetaker disabled'); return { notetakerId: 'notetaker' }; });
  return createEvent;
}
test('calendar and recording creation reuse the organizer grant and are idempotent', async t => {
  const provider = setup(t); const data = input();
  const first = await service.create(identity, data); const second = await service.create(identity, data);
  assert.equal(first.eventId, second.eventId); assert.equal(provider.mock.callCount(), 1); assert.equal(first.recordingState, 'scheduled');
  assert.equal(provider.mock.calls[0].arguments[0].identifier, 'personal-grant');
  assert.equal(provider.mock.calls[0].arguments[0].queryParams.notifyParticipants, true);
  assert.equal(JSON.stringify(first).includes('personal-grant'), false);
  const otherTenant = await service.create({ ...identity, organizationId: 'org-b' }, data); assert.equal(otherTenant.state, 'scheduled'); assert.equal(provider.mock.callCount(), 2);
});
test('missing personal grant never falls back to a system or another user calendar', async t => {
  const provider = setup(t, { noGrant: true });
  await assert.rejects(service.create(identity, input()), { code: 'CALENDAR_CONNECTION_REQUIRED' }); assert.equal(provider.mock.callCount(), 0);
});
test('ambiguous event errors do not send duplicate invitations on retry', async t => {
  const provider = setup(t, { eventFailure: true }); const data = input();
  await assert.rejects(service.create(identity, data), { code: 'CALENDAR_CREATION_UNCERTAIN' });
  await assert.rejects(service.create(identity, data), { code: 'CALENDAR_CREATION_UNCERTAIN' }); assert.equal(provider.mock.callCount(), 1);
});
test('recording failure preserves the confirmed calendar event and is visible separately', async t => {
  const provider = setup(t, { botFailure: true }); const data = input();
  const result = await service.create(identity, data); assert.equal(result.state, 'scheduled'); assert.equal(result.recordingState, 'failed');
  await service.create(identity, data); assert.equal(provider.mock.callCount(), 1);
});

function deferredInput() { return { ...input(), record: false, recordingPolicyVersion: 'calendar-recording-v1', participantSubjects: ['calendar-owner', 'employee'] }; }
function sourceConsent() { return { noticeVersion: 'calendar-recording-v1', manager: { userId: 'calendar-owner', acceptedAt: new Date().toISOString(), recording: true, transcription: true }, employee: { userId: 'employee', acceptedAt: new Date().toISOString(), recording: true, transcription: true } }; }
test('prospective participant consent defers recording and concurrent start calls schedule only one bot', async t => {
  setup(t); const data = deferredInput();
  let bots = 0;
  t.mock.method(nylas, 'createStandaloneNotetaker', async () => { bots++; await new Promise(resolve => setTimeout(resolve, 20)); return { notetakerId: 'consented-bot' }; });
  assert.equal((await service.create(identity, data)).recordingState, 'awaiting_consent'); assert.equal(bots, 0);
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: { ...sourceConsent(), employee: undefined } }), { code: 'RECORDING_CONSENT_REQUIRED' });
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: { ...sourceConsent(), employee: { userId: 'stranger', acceptedAt: new Date() } } }), { code: 'RECORDING_CONSENT_REQUIRED' });
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: { ...sourceConsent(), employee: { ...sourceConsent().employee, transcription: false } } }), { code: 'RECORDING_CONSENT_REQUIRED' });
  const starts = await Promise.allSettled([service.startRecording(identity, { ...data, recordingConsent: sourceConsent() }), service.startRecording(identity, { ...data, recordingConsent: sourceConsent() })]);
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1); assert.equal(bots, 1);
  assert.equal((await service.startRecording(identity, { ...data, recordingConsent: sourceConsent() })).recordingState, 'scheduled'); assert.equal(bots, 1);
});
test('legacy, past and cross-organizer recording requests cannot be upgraded or dispatched', async t => {
  setup(t); const legacy = input(); await service.create(identity, legacy);
  await assert.rejects(service.startRecording(identity, { ...legacy, recordingConsent: sourceConsent() }), { code: 'LEGACY_RECORDING_UNVERIFIED' });
  const data = deferredInput(); await service.create(identity, data);
  await assert.rejects(service.startRecording({ ...identity, sub: 'other' }, { ...data, recordingConsent: sourceConsent() }), { code: 'MEETING_NOT_FOUND' });
  await Meeting.updateOne({ externalId: data.externalId }, { $set: { scheduledDate: new Date(Date.now() - 31 * 60000) } });
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: sourceConsent() }), { code: 'RECORDING_WINDOW_CLOSED' });
});
test('uncertain recording creation is not repeated and withdrawal preserves the calendar invitation', async t => {
  setup(t); const data = deferredInput(); await service.create(identity, data);
  const bot = t.mock.method(nylas, 'createStandaloneNotetaker', async () => { throw new Error('Ambiguous provider response'); });
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: sourceConsent() }), { code: 'RECORDING_CREATION_UNCERTAIN' });
  await assert.rejects(service.startRecording(identity, { ...data, recordingConsent: sourceConsent() }), { code: 'RECORDING_CREATION_UNCERTAIN' }); assert.equal(bot.mock.callCount(), 1);
  await assert.rejects(service.stopRecording(identity, data), { code: 'RECORDING_CANCELLATION_PENDING' });
  await assert.rejects(service.stopRecording(identity, data), { code: 'RECORDING_CANCELLATION_PENDING' });
  const stopped = await Meeting.findOne({ externalId: data.externalId }); assert.equal(stopped.recordingState, 'revoked'); assert.equal(stopped.eventId, 'provider-event');
});
test('withdrawal racing an external bot response cancels that bot and blocks transcript retrieval', async t => {
  setup(t); const data = deferredInput(); await service.create(identity, data);
  let entered, release; const started = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; });
  t.mock.method(nylas, 'createStandaloneNotetaker', async () => { entered(); await wait; return { notetakerId: 'racing-bot' }; });
  const cancel = t.mock.method(nylas, 'cancelStandaloneNotetaker', async () => {});
  const pending = service.startRecording(identity, { ...data, recordingConsent: sourceConsent() }); await started;
  await assert.rejects(service.stopRecording(identity, data), { code: 'RECORDING_CANCELLATION_PENDING' }); release(); await assert.rejects(pending, { code: 'RECORDING_CONSENT_REVOKED' });
  assert.equal(cancel.mock.callCount(), 1);
  const status = t.mock.method(nylas, 'getStandaloneNotetakerStatus', async () => { throw new Error('Must not fetch media'); });
  assert.equal((await service.sync(identity, data)).recordingState, 'revoked'); assert.equal(status.mock.callCount(), 0);
});
test('withdrawal during transcript provider response cannot restore ready state or return transcript', async t => {
  setup(t); const data = deferredInput(); await service.create(identity, data); await service.startRecording(identity, { ...data, recordingConsent: sourceConsent() });
  t.mock.method(nylas, 'cancelStandaloneNotetaker', async () => {});
  t.mock.method(nylas, 'getStandaloneNotetakerStatus', async () => ({ state: 'completed' }));
  t.mock.method(nylas, 'getStandaloneNotetakerMedia', async () => { await service.stopRecording(identity, data); return { transcript: { url: 'https://example.nylas.com/transcript' } }; });
  t.mock.method(global, 'fetch', async () => new Response('Synthetic private transcript sentinel'));
  const result = await service.sync(identity, data);
  assert.equal(result.recordingState, 'revoked'); assert.equal(result.transcript, undefined);
  assert.equal((await Meeting.findOne({ externalId: data.externalId })).recordingState, 'revoked');
});
test('cancellation is organizer scoped, notetaker first, and safe to repeat', async t => {
  setup(t); const data = input(); await service.create(identity, data);
  const calls = [];
  t.mock.method(nylas, 'cancelStandaloneNotetaker', async () => { calls.push('notetaker'); });
  t.mock.method(nylas, 'getNylasInstance', () => ({ events: { destroy: async () => { calls.push('event'); } } }));
  await assert.rejects(service.cancel({ ...identity, sub: 'other-person' }, data), { code: 'MEETING_NOT_FOUND' });
  assert.equal((await service.cancel(identity, data)).state, 'cancelled');
  await service.cancel(identity, data); assert.deepEqual(calls, ['notetaker', 'event']);
});
test('meeting links reject lookalike hosts, credentials, arbitrary destinations and unsupported protocols', () => {
  for (const link of ['https://meet.google.com.evil.test/call', 'https://evil.test/zoom.us', 'http://meet.google.com/call', 'https://user:pass@meet.google.com/call', 'javascript:alert(1)']) assert.throws(() => service.meetingUrl(link));
  assert.equal(service.meetingUrl('https://company.zoom.us/j/123'), 'https://company.zoom.us/j/123');
});
test('transcript downloads reject untrusted URLs and oversized responses', async t => {
  await assert.rejects(service.boundedTranscript('https://127.0.0.1/transcript'));
  t.mock.method(global, 'fetch', async () => new Response('x'.repeat(2_000_001)));
  await assert.rejects(service.boundedTranscript('https://example.nylas.com/transcript'), { code: 'TRANSCRIPT_TOO_LARGE' });
});
test('Performance Terra default is applied before personal choices and leaves other apps unchanged', async () => {
  for (const personal of [null, 'gpt-5.6-luna']) {
    let inherited;
    const runtime = new AIRuntimeService({ resolveUserRoute: async (_actor, _activity, route) => { inherited = route.codexModel; return { ...route, codexModel: personal || route.codexModel }; } });
    runtime.getSettings = async () => ({});
    runtime.resolveRoute = () => ({ provider: 'chatgpt-connect', model: 'chatgpt-connected-account', codexModel: 'gpt-5.6-sol', reasoningEffort: 'medium' });
    runtime.attachChatGptSubject = async route => route;
    runtime.gatewayRequest = async ({ route }) => ({ content: 'Synthetic notes', model: route.codexModel });
    const response = await runtime.complete('performance.meeting.analysis', { messages: [{ role: 'user', content: 'Synthetic meeting' }] }, { requiredRuntime: 'chatgpt', defaultCodexModel: 'gpt-5.6-terra' });
    assert.equal(inherited, 'gpt-5.6-terra'); assert.equal(response.model, personal || 'gpt-5.6-terra');
    if (!personal) assert.equal((await runtime.complete('recruiter.general', {}, { requiredRuntime: 'chatgpt' })).model, 'gpt-5.6-sol');
  }
});


test('connection reports the verified personal grant email rather than the Seemplify login', async t => {
  setup(t);
  const result = await service.connection(identity);
  assert.equal(result.email, 'calendar@example.test'); assert.equal(result.connected, true);
  assert.equal(result.provider, 'google'); assert.equal(JSON.stringify(result).includes('personal-grant'), false);
  t.mock.method(nylas, 'getNylasInstance', () => ({ grants: { find: async () => { throw Object.assign(new Error('gone'), { statusCode: 404 }); } } }));
  assert.equal((await service.connection(identity)).connected, false);
});

test('active-call consent invites immediately without sending a past join_time', async t => {
  setup(t); const data = deferredInput(); await service.create(identity, data);
  await Meeting.updateOne({ externalId: data.externalId }, { $set: { scheduledDate: new Date(Date.now() - 60000) } });
  const bot = t.mock.method(nylas, 'createStandaloneNotetaker', async () => ({ notetakerId: 'live-bot' }));
  await service.startRecording(identity, { ...data, recordingConsent: sourceConsent() });
  assert.equal(bot.mock.calls[0].arguments[2], null);
  await service.startRecording(identity, { ...data, recordingConsent: sourceConsent() });
  assert.equal(bot.mock.callCount(), 1);
});

test('manual add dispatches the existing scheduled bot once under concurrent requests', async t => {
  setup(t); const data = deferredInput(); await service.create(identity, data);
  await service.startRecording(identity, { ...data, recordingConsent: sourceConsent() });
  await Meeting.updateOne({ externalId: data.externalId }, { $set: { scheduledDate: new Date(Date.now() - 60000) } });
  t.mock.method(nylas, 'getStandaloneNotetakerStatus', async () => ({ data: { state: 'scheduled' } }));
  const dispatch = t.mock.method(nylas, 'dispatchStandaloneNotetakerNow', async () => {});
  const results = await Promise.allSettled([1, 2].map(() => service.startRecording(identity, { ...data, joinNow: true, recordingConsent: sourceConsent() })));
  assert.equal(dispatch.mock.callCount(), 1); assert.ok(results.some(r => r.status === 'fulfilled'));
  const saved = await Meeting.findOne({ externalId: data.externalId }); assert.equal(saved.notetakerId, 'notetaker'); assert.equal(saved.recordingState, 'joining');
  t.mock.method(nylas, 'cancelStandaloneNotetaker', async () => {});
  await service.stopRecording(identity, data);
  await assert.rejects(service.startRecording(identity, { ...data, joinNow: true, recordingConsent: sourceConsent() }), { code: 'RECORDING_CONSENT_REVOKED' });
});
