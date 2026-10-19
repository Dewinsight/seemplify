'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const Meeting = require('../models/OneOnOne');
const Call = require('../models/AppraisalCall');
const User = require('../models/User');
const org = { id: 'relay-recovery-org', role: 'staff', appAccess: { mode: 'all' } };
let mongo, app, cycle;
const actor = who => ({ id: who, sub: who, email: `${who}@example.test`, name: who,
  organizations: [org], currentOrganization: org,
  idpTeams: [{ id: 'team', organizationId: org.id, role: who === 'reviewer' ? 'line_manager' : 'member', directReports: who === 'reviewer' ? ['employee'] : [] }] });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: actor(req.get('x-actor') || 'reviewer'), currentOrganizationId: org.id }; next(); });
  app.use('/api/appraisals', require('../routes/appraisals'));
  app.use('/api/one-on-ones', require('../routes/oneOnOnes'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await Call.createIndexes();
  cycle = await Cycle.create({ organizationId: org.id, name: 'Relay recovery', periodStart: '2026-01-01', periodEnd: '2026-03-31', createdBy: { userId: 'reviewer', name: 'Reviewer' } });
  for (const who of ['reviewer', 'employee']) await User.create({ idpSub: who, email: actor(who).email, idpTeams: actor(who).idpTeams, currentOrganizationId: org.id });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
async function fixture(linked) {
  const appraisal = linked ? await Appraisal.create({ cycleId: cycle._id, organizationId: org.id,
    employee: { userId: 'employee', name: 'Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Reviewer', email: 'reviewer@example.test' }, status: 'self_assessment_pending' }) : null;
  const meeting = await Meeting.create({ organizationId: org.id, managerId: 'reviewer', employeeId: 'employee',
    ...(appraisal ? { appraisalId: appraisal._id } : {}), scheduledDate: new Date(Date.now() + 60000), status: 'scheduled',
    appraisalMeeting: { mode: 'in_app', ...(linked ? {} : { source: 'one_on_one' }), recordingRequested: false } });
  const other = { id: randomUUID(), seenAt: new Date(), consentAt: new Date() };
  const saved = await Call.create({ meetingId: meeting._id, employee: other,
    offer: { retained: 'offer' }, answer: { retained: 'answer' }, recordingPeer: 'retained', recordingActive: false,
    expiresAt: new Date(Date.now() + 86400000) });
  const path = linked ? `/api/appraisals/${appraisal._id}/meetings/${meeting._id}/native/join` : `/api/one-on-ones/${meeting._id}/call/native/join`;
  return { appraisal, meeting, saved, path };
}
const validRelay = () => ({ ok: true, json: async () => ({ urls: ['turn:127.0.0.1:3478'], username: 'synthetic-user', credential: 'synthetic-credential' }) });
const join = (fixture, peerId = randomUUID()) => request(app).post(fixture.path).send({ peerId });
for (const linked of [true, false]) for (const failure of ['timeout', 'http', 'json', 'credentials']) {
  test(`${linked ? 'appraisal' : 'standalone'} ${failure} relay failure releases only its lease and permits immediate fresh-peer retry`, async () => {
    const f = await fixture(linked);
    const fetchRelay = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      if (failure === 'timeout') throw new DOMException('synthetic-secret-timeout', 'TimeoutError');
      if (failure === 'http') return { ok: false, status: 502 };
      if (failure === 'json') return { ok: true, json: async () => { throw new Error('synthetic-secret-body'); } };
      return { ok: true, json: async () => ({ urls: [], username: '', credential: 'synthetic-secret' }) };
    });
    const failed = await join(f).expect(503);
    const after = await Call.findById(f.saved._id).lean();
    expect(after.manager).toBeUndefined();
    expect(JSON.stringify(failed.body)).not.toContain('synthetic-secret');
    expect(failed.body.code).toBe('CALL_RELAY_UNAVAILABLE');
    for (const field of ['employee', 'offer', 'answer', 'recordingPeer', 'recordingActive', 'expiresAt']) expect(after[field]).toEqual(f.saved.toObject()[field]);
    expect((await Meeting.findById(f.meeting._id)).status).toBe('scheduled');
    fetchRelay.mockResolvedValue(validRelay());
    const nextPeer = randomUUID(); const joined = await join(f, nextPeer).expect(200);
    expect(JSON.stringify(joined.body)).not.toContain('claimId');
    const statePath = f.path.replace(/\/join$/, '/state');
    const state = await request(app).get(statePath).query({ peerId: nextPeer }).expect(200);
    expect(JSON.stringify(state.body)).not.toContain('claimId');
    expect((await Call.findById(f.saved._id)).manager.id).toBe(nextPeer);
    expect((await Meeting.findById(f.meeting._id)).status).toBe('in_progress');
  });
}
test('failed older join cannot remove a replacement peer lease', async () => {
  const f = await fixture(true), replacement = { id: randomUUID(), seenAt: new Date(Date.now() + 1000) };
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    await Call.updateOne({ _id: f.saved._id }, { $set: { manager: replacement } });
    throw new Error('relay failure');
  });
  await join(f).expect(503);
  expect((await Call.findById(f.saved._id)).manager.toObject()).toEqual(replacement);
});
test('failed older join cannot remove a refreshed same-peer lease', async () => {
  const f = await fixture(true), peerId = randomUUID(), seenAt = new Date(Date.now() + 1000);
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    await Call.updateOne({ _id: f.saved._id, 'manager.id': peerId }, { $set: { 'manager.seenAt': seenAt } });
    throw new Error('relay failure');
  });
  await join(f, peerId).expect(503);
  const call = await Call.findById(f.saved._id); expect(call.manager.id).toBe(peerId); expect(call.manager.seenAt).toEqual(seenAt);
});
test('parent fence write failure cleans its lease without disclosing relay credentials', async () => {
  const f = await fixture(true);
  jest.spyOn(Appraisal, 'updateOne').mockRejectedValueOnce(new Error('synthetic-secret-db'));
  const fetchRelay = jest.spyOn(global, 'fetch');
  const failed = await join(f).expect(503);
  expect(JSON.stringify(failed.body)).not.toContain('synthetic-secret');
  expect((await Call.findById(f.saved._id)).manager).toBeUndefined();
  expect(fetchRelay).not.toHaveBeenCalled();
});
test('meeting status write failure cleans the lease while retaining the existing meeting', async () => {
  const f = await fixture(false);
  jest.spyOn(global, 'fetch').mockResolvedValue(validRelay());
  jest.spyOn(Meeting, 'updateOne').mockRejectedValueOnce(new Error('synthetic-secret-db'));
  const failed = await join(f).expect(503);
  expect(JSON.stringify(failed.body)).not.toContain('synthetic-secret');
  expect((await Call.findById(f.saved._id)).manager).toBeUndefined();
  expect((await Meeting.findById(f.meeting._id)).status).toBe('scheduled');
});

test('same-millisecond same-peer successful reacquisition survives an older failed request', async () => {
  const f = await fixture(true), peerId = randomUUID(), fixedNow = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
  let attempts = 0, firstClaim;
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    if (++attempts === 1) {
      firstClaim = (await Call.findById(f.saved._id)).manager.toObject();
      await join(f, peerId).expect(200);
      throw new Error('Older relay request failed');
    }
    return validRelay();
  });
  await join(f, peerId).expect(503);
  const after = await Call.findById(f.saved._id);
  expect(after.manager.id).toBe(peerId);
  expect(after.manager.seenAt).toEqual(firstClaim.seenAt);
  expect(after.manager.claimId).not.toBe(firstClaim.claimId);
  expect(after.employee.toObject()).toEqual(f.saved.employee.toObject());
  expect((await Meeting.findById(f.meeting._id)).status).toBe('in_progress');
});
test('cleanup database failure stays closed and gives a bounded retry message without leaking its cause', async () => {
  const f = await fixture(true), original = Call.updateOne.bind(Call);
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('synthetic-secret-relay'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Call, 'updateOne').mockImplementation((filter, update, ...args) => {
    if (update.$unset?.manager) return Promise.reject(new Error('synthetic-secret-db'));
    return original(filter, update, ...args);
  });
  const failed = await join(f).expect(503);
  expect(failed.body).toMatchObject({ code: 'CALL_RELAY_UNAVAILABLE' });
  expect(failed.body.error).toMatch(/Wait 30 seconds/);
  expect(JSON.stringify(failed.body)).not.toContain('synthetic-secret');
  expect((await Meeting.findById(f.meeting._id)).status).toBe('scheduled');
});
