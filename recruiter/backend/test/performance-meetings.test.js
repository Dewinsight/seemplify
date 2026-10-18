'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const principals = require('../services/aiRuntime/sharedIdentityService');
const nylas = require('../services/nylasV3Service');
const Meeting = require('../models/PerformanceMeeting');
const service = require('../services/performanceMeetingService');
let mongo;
const identity = { sub: 'calendar-owner', email: 'owner@example.test', organizationId: 'org-a' };
const input = () => ({ externalId: new mongoose.Types.ObjectId().toString(), scheduledDate: new Date(Date.now() + 3600000), duration: 30, participants: [{ email: 'owner@example.test' }], record: true });
test.before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await Meeting.createIndexes(); });
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
test.afterEach(() => test.mock.restoreAll());
function setup(t, options = {}) {
  t.mock.method(principals, 'resolveSharedPrincipal', async raw => ({ identity: raw, user: { email: raw.email, nylasGrantId: options.noGrant ? null : 'personal-grant', nylasGrantStatus: 'active' } }));
  const createEvent = t.mock.fn(async () => { if (options.eventFailure) throw new Error('Ambiguous provider timeout'); return { data: { id: 'provider-event', conferencing: { details: { url: 'https://meet.google.com/aaa-bbbb-ccc' } } } }; });
  t.mock.method(nylas, 'getNylasInstance', () => ({ events: { create: createEvent }, grants: { find: async () => ({ data: { provider: 'google' } }) } }));
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
