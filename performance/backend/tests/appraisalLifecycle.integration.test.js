const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const OneOnOne = require('../models/OneOnOne');
const Call = require('../models/AppraisalCall');
const User = require('../models/User');
const ScheduledReminder = require('../models/ScheduledReminder');
const reminders = require('../services/reminderScheduler');
const shared = require('../services/sharedAIAccountService');
const routes = require('../routes/appraisals');
const org = { id: 'lifecycle-org', name: 'Lifecycle QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
function actor(who) {
  const organization = { ...org, ...(who === 'hr' ? { role: 'hr_manager' } : {}), ...(who === 'foreign' ? { id: 'foreign-org', role: 'owner' } : {}) };
  return { id: who, sub: who, name: who, email: `${who}@example.test`, organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: who === 'outsider' ? 'outside' : 'team', name: 'Product', organizationId: organization.id, role: who === 'reviewer' ? 'line_manager' : 'member' }] };
}
let mongo, app, cycle;
const api = (method, url, who = 'reviewer') => request(app)[method](`/api/appraisals${url}`).set('x-actor', who);
async function appraisal(overrides = {}) {
  return Appraisal.create({ cycleId: cycle._id, organizationId: org.id, employee: { userId: 'employee', name: 'Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Reviewer', email: 'reviewer@example.test' }, status: 'self_assessment_pending', ...overrides });
}
async function meeting(record, overrides = {}) {
  return OneOnOne.create({ organizationId: org.id, appraisalId: record._id, managerId: 'reviewer', employeeId: 'employee', managerInfo: record.manager, employeeInfo: record.employee, scheduledDate: new Date(Date.now() + 3600000), status: 'scheduled', title: 'Review call', createdBy: 'reviewer', appraisalMeeting: { mode: 'in_app', ownerIdentity: { sub: 'reviewer', email: 'reviewer@example.test' }, recordingRequested: false }, ...overrides });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => { const who = req.get('x-actor') || 'reviewer'; if (who !== 'anonymous') req.session = { user: actor(who), currentOrganizationId: actor(who).currentOrganization.id }; next(); }); app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await Appraisal.createIndexes(); await AppraisalCycle.createIndexes();
  cycle = await AppraisalCycle.create({ name: 'Lifecycle review', organizationId: org.id, periodStart: '2026-01-01', periodEnd: '2026-03-31', status: 'active', createdBy: { userId: 'reviewer', name: 'Reviewer' } });
  for (const who of ['reviewer', 'employee', 'outsider', 'hr']) await User.create({ idpSub: who, email: actor(who).email, profile: { displayName: who }, currentOrganizationId: org.id, idpTeams: actor(who).idpTeams });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('lifecycle controls require current management authority, tenant scope and explicit confirmation', async () => {
  const record = await appraisal();
  for (const action of ['cancel', 'remove', 'restore', 'retry']) {
    await api('post', `/lifecycle/${record._id}/${action}`, 'anonymous').send({ confirm: true }).expect(401);
    await api('post', `/lifecycle/${record._id}/${action}`, 'employee').send({ confirm: true }).expect(403);
    await api('post', `/lifecycle/${record._id}/${action}`, 'outsider').send({ confirm: true }).expect(403);
    await api('post', `/lifecycle/${record._id}/${action}`, 'foreign').send({ confirm: true, organizationId: org.id }).expect(404);
  }
  await api('get', '/lifecycle/removed', 'employee').expect(403);
  await api('get', '/lifecycle/not-an-id', 'hr').expect(404);
  await api('post', `/lifecycle/${record._id}/cancel`).send({}).expect(400);
  expect((await Appraisal.findById(record._id)).status).toBe('self_assessment_pending');
});

test('cancellation preserves evidence, ends reminders and calls, is idempotent, and blocks all workflow writes', async () => {
  const record = await appraisal({ selfAssessment: { overallSummary: { achievements: 'Retained achievement' } }, cycleConfigurationSnapshot: { appraisalFlow: { version: 1, assessmentMode: 'form', steps: [{ id: 'self', type: 'selfAssessment', label: 'Employee assessment' }, { id: 'outcome', type: 'finalReview', label: 'Final outcome' }] } } });
  const call = await meeting(record, { sharedNotes: 'Retained meeting notes', transcript: { content: 'Retained transcript', status: 'ready' } });
  await ScheduledReminder.create({ organizationId: org.id, userId: 'employee', target: { type: 'appraisal_acknowledgement', id: String(record._id) }, eventType: 'appraisal.acknowledgement_due', stage: '1d', dueAt: new Date(), scheduledFor: new Date(), notification: { category: 'appraisal', title: 'Review', message: 'Review outcome', deepLink: `/appraisals/${record._id}` } });
  const response = await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true, reason: 'Started by mistake', status: 'completed' }).expect(200);
  expect(response.body.data.status).toBe('cancelled'); expect(response.body.data.cleanupPending).toBe(false);
  const saved = await Appraisal.findById(record._id);
  expect(saved.lifecycle.cancelledBy.userId).toBe('reviewer'); expect(saved.lifecycle.reason).toBe('Started by mistake');
  expect(saved.selfAssessment.overallSummary.achievements).toBe('Retained achievement');
  expect((await OneOnOne.findById(call._id)).transcript.content).toBe('Retained transcript');
  expect(saved.auditLog.filter(item => item.action === 'appraisal_cancelled')).toHaveLength(1);
  expect((await OneOnOne.findById(call._id)).status).toBe('cancelled');
  expect((await ScheduledReminder.findOne()).status).toBe('cancelled');
  expect(await reminders.isTargetComplete({ organizationId: org.id, targetType: 'appraisal_acknowledgement', targetId: String(record._id) })).toBe(true);
  await api('get', `/${record._id}`, 'employee').expect(200);
  for (const path of ['start', 'reset', 'self-assessment', 'manager-review/start', 'conversation/start', 'finalize', 'acknowledge', 'chat']) await api('post', `/${record._id}/${path}`).send({}).expect(409);
  await api('put', `/${record._id}/custom-responses`).send({}).expect(409);
  await api('post', `/${record._id}/meetings/${call._id}/native/join`, 'employee').send({}).expect(409);
  await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200);
  expect((await Appraisal.findById(record._id)).auditLog.filter(item => item.action === 'appraisal_cancelled')).toHaveLength(1);
  expect((await AppraisalCycle.findById(cycle._id)).status).not.toBe('cancelled');
});

test('a live native call prevents cancellation or removal before changing review state', async () => {
  const record = await appraisal(); const call = await meeting(record);
  await Call.create({ meetingId: call._id, expiresAt: new Date(Date.now() + 86400000), manager: { id: 'host', seenAt: new Date() } });
  for (const action of ['cancel', 'remove']) await api('post', `/lifecycle/${record._id}/${action}`).send({ confirm: true }).expect(409);
  expect((await Appraisal.findById(record._id)).status).toBe('self_assessment_pending');
});

test('provider cancellation failures close local access, stay visible and retry under the original organizer', async () => {
  const record = await appraisal(); const call = await meeting(record, { nylas: { eventId: 'event' }, appraisalMeeting: { mode: 'calendar', ownerIdentity: { sub: 'original-owner', email: 'owner@example.test' }, calendarState: 'scheduled' } });
  const provider = jest.spyOn(shared, 'request').mockRejectedValue(new Error('Synthetic provider outage'));
  const cancelled = await api('post', `/lifecycle/${record._id}/cancel`, 'hr').send({ confirm: true }).expect(200);
  expect(cancelled.body.data.cleanupPending).toBe(true); expect((await OneOnOne.findById(call._id)).status).toBe('cancelled');
  expect(provider).toHaveBeenCalledWith('meetings/cancel', expect.objectContaining({ sub: 'original-owner' }), { externalId: String(call._id) });
  await api('post', `/lifecycle/${record._id}/remove`, 'hr').send({ confirm: true }).expect(503);
  expect((await Appraisal.findById(record._id)).removedAt).toBeNull();
  provider.mockResolvedValue({ state: 'cancelled' });
  const retry = await api('post', `/lifecycle/${record._id}/cancel`, 'hr').send({ confirm: true }).expect(200);
  expect(retry.body.data.cleanupPending).toBe(false);
  expect((await OneOnOne.findById(call._id)).appraisalMeeting.calendarState).toBe('cancelled');
});

test('removal hides reviews from lists, lookups, counts and analytics; restoration returns closed evidence without restarting calls', async () => {
  const record = await appraisal({ sharedNotes: 'retained' }); const call = await meeting(record);
  await api('post', `/lifecycle/${record._id}/remove`).send({ confirm: true }).expect(200);
  expect(await Appraisal.findById(record._id)).toBeNull(); expect(await Appraisal.countDocuments()).toBe(0);
  expect(await Appraisal.aggregate([{ $count: 'total' }])).toEqual([]); expect(await Appraisal.distinct('_id')).toEqual([]);
  await api('get', `/${record._id}`, 'employee').expect(404);
  await api('get', `/${record._id}/meetings`, 'employee').expect(404);
  const removed = await api('get', '/lifecycle/removed').expect(200);
  expect(removed.body.data.map(item => item._id)).toEqual([String(record._id)]);
  expect((await api('get', '/lifecycle/removed', 'foreign').expect(200)).body.data).toEqual([]);
  await api('post', `/lifecycle/${record._id}/restore`).send({ confirm: true }).expect(200);
  const restored = await Appraisal.findById(record._id); expect(restored.status).toBe('cancelled'); expect(restored.removedAt).toBeNull();
  expect(restored.auditLog.map(item => item.action)).toEqual(expect.arrayContaining(['appraisal_cancelled', 'appraisal_removed', 'appraisal_restored']));
  expect((await OneOnOne.findById(call._id)).status).toBe('cancelled');
  expect((await api('get', '/lifecycle/removed').expect(200)).body.data).toEqual([]);
});

test('completed reviews require HR removal and restore keeps final results unchanged', async () => {
  const record = await appraisal({ status: 'completed', finalRating: { overall: 4, finalizedAt: new Date() } });
  await api('post', `/lifecycle/${record._id}/cancel`, 'hr').send({ confirm: true }).expect(409);
  await api('post', `/lifecycle/${record._id}/remove`).send({ confirm: true }).expect(403);
  await api('post', `/lifecycle/${record._id}/remove`, 'hr').send({ confirm: true }).expect(200);
  await api('post', `/lifecycle/${record._id}/restore`).send({ confirm: true }).expect(403);
  await api('post', `/lifecycle/${record._id}/restore`, 'hr').send({ confirm: true }).expect(200);
  const restored = await Appraisal.findById(record._id); expect(restored.status).toBe('completed'); expect(restored.finalRating.overall).toBe(4);
});

test('stale evidence saves and legacy calibration batches cannot reopen cancelled reviews', async () => {
  const record = await appraisal(); const stale = await Appraisal.findById(record._id);
  await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200);
  stale.status = 'manager_review_pending'; await expect(stale.save()).rejects.toThrow(/cancelled|modified/i);
  const cancelled = await Appraisal.findById(record._id);
  cancelled.selfAssessment.overallSummary = { achievements: 'Attempt to rewrite cancelled evidence' };
  await expect(cancelled.save()).rejects.toThrow(/read-only/);
  await Appraisal.updateMany({ _id: record._id }, { $set: { status: 'final_review_pending' } });
  expect((await Appraisal.findById(record._id)).status).toBe('cancelled');
  const other = await appraisal({ employee: { userId: 'other', name: 'Other', email: 'other@example.test' }, status: 'self_assessment_pending' });
  await Appraisal.updateMany({ status: 'calibration_pending' }, { $set: { status: 'final_review_pending' } });
  expect((await Appraisal.findById(other._id)).status).toBe('self_assessment_pending');
});

test('HR can retry cancellation cleanup for a completed review without cancelling its result', async () => {
  const record = await appraisal({ status: 'completed', finalRating: { overall: 4, finalizedAt: new Date() } });
  await meeting(record, { nylas: { eventId: 'event' }, appraisalMeeting: { mode: 'calendar', ownerIdentity: { sub: 'reviewer', email: 'reviewer@example.test' } } });
  const provider = jest.spyOn(shared, 'request').mockRejectedValue(new Error('Synthetic outage'));
  await api('post', `/lifecycle/${record._id}/remove`, 'hr').send({ confirm: true }).expect(503);
  await api('post', `/lifecycle/${record._id}/retry`).send({ confirm: true }).expect(403);
  provider.mockResolvedValue({ state: 'cancelled' });
  await api('post', `/lifecycle/${record._id}/retry`, 'hr').send({ confirm: true }).expect(200);
  const saved = await Appraisal.findById(record._id); expect(saved.status).toBe('completed'); expect(saved.finalRating.overall).toBe(4); expect(saved.lifecycle.cleanupPending).toBe(false);
});

test('cancelled native state reads cannot renew a stale signaling lease', async () => {
  const record = await appraisal(); const call = await meeting(record);
  await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200);
  const seenAt = new Date();
  await Call.create({ meetingId: call._id, expiresAt: new Date(Date.now() + 86400000), employee: { id: '00000000-0000-4000-8000-000000000002', seenAt } });
  await api('get', `/${record._id}/meetings/${call._id}/native/state?peerId=00000000-0000-4000-8000-000000000002`, 'employee').expect(409);
  expect((await Call.findOne({ meetingId: call._id })).employee.seenAt).toEqual(seenAt);
});

test('cancellation winning during native join cannot create a usable lease or disclose relay credentials', async () => {
  const record = await appraisal(); const call = await meeting(record);
  const original = Call.init.bind(Call); let cancelled = false;
  jest.spyOn(Call, 'init').mockImplementation(async (...args) => { const result = await original(...args); if (!cancelled) { cancelled = true; await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200); } return result; });
  const relay = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ urls: ['turn:synthetic.example.test'], username: 'synthetic-relay', credential: 'synthetic-credential' }) });
  const joined = await api('post', `/${record._id}/meetings/${call._id}/native/join`).send({ peerId: '00000000-0000-4000-8000-000000000001' }).expect(409);
  expect(cancelled).toBe(true); expect(relay).not.toHaveBeenCalled(); expect(JSON.stringify(joined.body)).not.toContain('synthetic-credential');
  expect((await Call.findOne({ meetingId: call._id }))?.manager?.id).toBeUndefined();
});

test('cleanup retry capability reflects finished-review HR restriction', async () => {
  const record = await appraisal({ status: 'completed', finalRating: { overall: 4, finalizedAt: new Date() }, lifecycle: { cleanupPending: true } });
  expect((await api('get', `/lifecycle/${record._id}`).expect(200)).body.data.canRetry).toBe(false);
  expect((await api('get', `/lifecycle/${record._id}`, 'hr').expect(200)).body.data.canRetry).toBe(true);
});

test('cancelled or removed linked appraisals block new competency work while preserving historical records and retention authority', async () => {
  const assessments = require('../services/competency/assessmentService'); const Assessment = require('../models/CompetencyAssessment');
  const record = await appraisal({ managerReview: { submittedAt: new Date(), overallSummary: { strengths: 'Retained submitted source' } } });
  const linked = await Assessment.create({ organizationId: org.id, cycleId: String(new mongoose.Types.ObjectId()), cycleVersion: 1, appraisalId: String(record._id), participant: { userId: 'employee' }, assessorIds: ['reviewer'], definitionSnapshot: {}, status: 'draft', results: [{ number: 1, reportHash: 'historical-hash' }] });
  const ctx = { organizationId: org.id, actor: { userId: 'reviewer', name: 'Reviewer' }, organizationWide: true, permissions: new Set(require('../services/competency/authorizationService').ACTIONS), directory: { members: [{ userId: 'employee' }] } };
  const staleEvidence = await assessments.get(ctx, String(linked._id), 'evidence.create');
  await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200);
  const lateWork = jest.fn();
  await expect(assessments.withMutation(ctx, staleEvidence, lateWork)).rejects.toMatchObject({ code: 'APPRAISAL_CLOSED' });
  expect(lateWork).not.toHaveBeenCalled();
  for (const permission of ['assessment.edit', 'assessment.finalise', 'assessment.reopen', 'evidence.create', 'ai.use']) await expect(assessments.get(ctx, String(linked._id), permission)).rejects.toMatchObject({ code: 'APPRAISAL_CLOSED', status: 409 });
  expect((await assessments.sourceFeedback(linked)).state).toBe('unavailable');
  const history = await assessments.get(ctx, String(linked._id), 'report.view'); expect(history.results[0].reportHash).toBe('historical-hash');
  expect(assessments.actions(ctx, history)).not.toContain('competency.assessment.edit');
  await expect(assessments.get(ctx, String(linked._id), 'retention.manage')).resolves.toBeTruthy();
  await expect(assessments.get(ctx, String(linked._id), 'evidence.delete')).resolves.toBeTruthy();
  const retentionWork = jest.fn().mockResolvedValue('retention-complete');
  await expect(assessments.withMutation(ctx, history, retentionWork, { allowPublished: true })).resolves.toBe('retention-complete');
  await api('post', `/lifecycle/${record._id}/remove`).send({ confirm: true }).expect(200);
  await expect(assessments.get(ctx, String(linked._id), 'assessment.edit')).rejects.toMatchObject({ code: 'APPRAISAL_CLOSED' });
  expect((await assessments.get(ctx, String(linked._id), 'report.view')).results[0].reportHash).toBe('historical-hash');
});

test('a calendar response arriving after cancellation is compensated instead of reviving its invitation', async () => {
  const record = await appraisal({ cycleConfigurationSnapshot: { appraisalFlow: { version: 1, assessmentMode: 'form', steps: [{ id: 'call', type: 'oneOnOne', label: 'Review discussion' }, { id: 'final', type: 'finalReview', label: 'Final outcome' }] } } });
  let cancelled = 0;
  jest.spyOn(shared, 'request').mockImplementation(async endpoint => {
    if (endpoint === 'meetings/create') { await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200); return { eventId: 'late-event', calendarId: 'calendar', conferenceUrl: 'https://meet.google.com/synthetic', state: 'scheduled' }; }
    if (endpoint === 'meetings/cancel') { cancelled += 1; return { state: 'cancelled' }; }
    throw new Error('Unexpected synthetic provider request');
  });
  await api('post', `/${record._id}/meetings`).send({ mode: 'calendar', stepId: 'call', scheduledDate: new Date(Date.now() + 3600000), duration: 30, record: false }).expect(409);
  expect(cancelled).toBe(2);
  expect((await OneOnOne.findOne({ appraisalId: record._id })).appraisalMeeting.calendarState).toBe('cancelled');
  expect((await Appraisal.findById(record._id)).lifecycle.cleanupPending).toBe(false);
});


test('failed compensation for a late calendar response remains closed with a retryable cleanup warning', async () => {
  const record = await appraisal({ cycleConfigurationSnapshot: { appraisalFlow: { version: 1, assessmentMode: 'form', steps: [{ id: 'call', type: 'oneOnOne', label: 'Review discussion' }, { id: 'final', type: 'finalReview', label: 'Final outcome' }] } } });
  let cancellations = 0;
  const provider = jest.spyOn(shared, 'request').mockImplementation(async endpoint => {
    if (endpoint === 'meetings/create') { await api('post', `/lifecycle/${record._id}/cancel`).send({ confirm: true }).expect(200); return { eventId: 'late-event', calendarId: 'calendar', conferenceUrl: 'https://meet.google.com/synthetic', state: 'scheduled' }; }
    if (endpoint === 'meetings/cancel') { if (++cancellations > 1) throw new Error('Synthetic cancellation outage'); return { state: 'cancelled' }; }
    throw new Error('Unexpected synthetic provider request');
  });
  await api('post', `/${record._id}/meetings`).send({ mode: 'calendar', stepId: 'call', scheduledDate: new Date(Date.now() + 3600000), duration: 30, record: false }).expect(503);
  const closed = await Appraisal.findById(record._id);
  expect(closed.status).toBe('cancelled'); expect(closed.lifecycle.cleanupPending).toBe(true);
  expect((await OneOnOne.findOne({ appraisalId: record._id })).appraisalMeeting.calendarState).toBe('cancellation_pending');
  expect((await api('get', `/lifecycle/${record._id}`).expect(200)).body.data.canRetry).toBe(true);
  provider.mockResolvedValue({ state: 'cancelled' });
  await api('post', `/lifecycle/${record._id}/retry`).send({ confirm: true }).expect(200);
  expect((await Appraisal.findById(record._id)).lifecycle.cleanupPending).toBe(false);
});
