const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const OneOnOne = require('../models/OneOnOne');
const User = require('../models/User');
const AppraisalCycle = require('../models/AppraisalCycle');
const shared = require('../services/sharedAIAccountService');
const ai = require('../services/aiGatewayService');
const { ensureQuarterlyCycles } = require('../services/quarterlyAppraisalService');
const { processDueMeetings } = require('../services/appraisalMeetingMediaService');
const routes = require('../routes/appraisals');
let mongo, app, cycle;
const org = { id: 'flow-org', role: 'employee', appAccess: { mode: 'all', appIds: [] } };
const actor = name => ({ id: name, sub: name, name, email: `${name}@example.test`, organizations: [org], currentOrganization: org, idpTeams: [{ id: name === 'outsider' ? 'outside' : 'team', name: 'Product', organizationId: org.id, role: 'member' }] });
const call = (method, url, who = 'reviewer') => request(app)[method](`/api/appraisals${url}`).set('x-actor', who);
const flow = types => ({ assessmentMode: 'form', steps: types.map((type, index) => ({ id: `${type}_${index}`, type, label: type })) });
async function launch(types) {
  const result = await call('post', `/cycles/${cycle._id}/launch`).send({ employees: [{ userId: 'employee' }], reviewerMode: 'initiator', responseDeadlines: { selfAssessmentDue: '2099-01-01', managerReviewDue: '2099-01-10' }, appraisalFlow: flow(types) }).expect(200);
  return result.body.data.appraisals[0];
}
test('native calls enforce two-party consent, private signaling, leases and recording access', async () => {
  const appraisal = await launch(['oneOnOne', 'finalReview']); const base = `/${appraisal._id}/meetings`;
  const provider = jest.spyOn(shared, 'request');
  const payload = { mode: 'in_app', stepId: 'oneOnOne_0', scheduledDate: new Date(Date.now() + 3600000), record: true, recordingNoticeAccepted: true };
  const created = await call('post', base).send(payload).expect(201); const native = `${base}/${created.body.data._id}/native`;
  expect(created.body.data.mode).toBe('in_app'); expect(provider).not.toHaveBeenCalled();
  await call('post', base).send(payload).expect(201); expect(await OneOnOne.countDocuments()).toBe(1);
  const turn = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ urls: ['turn:turn.example.test'], username: 'ephemeral', credential: 'credential' }) });
  const manager = '00000000-0000-4000-8000-000000000001', employee = '00000000-0000-4000-8000-000000000002';
  await call('post', `${native}/join`, 'outsider').send({ peerId: manager, consent: true }).expect(403);
  await call('post', `${native}/join`).send({ peerId: manager }).expect(400);
  await call('post', `${native}/join`).send({ peerId: manager, consent: true }).expect(200);
  await call('post', `${native}/join`).send({ peerId: employee, consent: true }).expect(409);
  await call('post', `${native}/record`).send({ peerId: manager }).expect(409);
  await call('post', `${native}/join`, 'employee').send({ peerId: employee, consent: true }).expect(200);
  await call('post', `${native}/signal`).send({ peerId: manager, target: employee, description: { type: 'answer', sdp: 'invalid' } }).expect(400);
  await call('post', `${native}/signal`).send({ peerId: manager, target: employee, description: { type: 'offer', sdp: 'test-offer' } }).expect(200);
  const state = await call('get', `${native}/state?peerId=${employee}`, 'employee').expect(200); expect(state.body.offer.description.sdp).toBe('test-offer');
  await call('post', `${native}/record`, 'employee').send({ peerId: employee }).expect(403);
  await call('post', `${native}/record`).send({ peerId: manager }).expect(200);
  await call('post', `${native}/record`).send({ peerId: manager }).expect(409);
  const saved = await call('post', `${native}/upload?peerId=${manager}`).attach('recording', Buffer.alloc(100, 1), { filename: 'call.webm', contentType: 'video/webm' }).expect(201);
  expect(saved.body.data.integration.recordingAvailable).toBe(true); expect(JSON.stringify(saved.body)).not.toMatch(/recordingFileId|ownerIdentity|credential/);
  const bytes = await call('get', `${native}/recording`, 'employee').expect(200); expect(bytes.body.length).toBe(100);
  await call('get', `${native}/recording`, 'outsider').expect(403);
  await call('post', `${native}/leave`).send({ peerId: manager }).expect(200);
  await call('get', `${native}/state?peerId=${manager}`).expect(409);
  turn.mockRestore();
});

test('raw Nylas transcript JSON is displayed as readable text', () => {
  expect(require('../services/appraisalMeetingMediaService').readableTranscript(JSON.stringify({ type: 'raw', transcript: 'We agreed to write the handover.' }))).toBe('We agreed to write the handover.');
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.get('x-actor') !== 'anonymous') req.session = { user: actor(req.get('x-actor') || 'reviewer'), currentOrganizationId: org.id }; next(); }); app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await Appraisal.createIndexes(); await OneOnOne.createIndexes(); await AppraisalCycle.createIndexes();
  for (const name of ['reviewer', 'employee', 'outsider']) await User.create({ idpSub: name, email: actor(name).email, currentOrganizationId: org.id, profile: { displayName: name }, idpTeams: actor(name).idpTeams });
  await ensureQuarterlyCycles(org.id); cycle = await AppraisalCycle.findOne({ periodEnd: { $lt: new Date() } }).sort({ periodEnd: -1 });
  cycle.settings.enableAiAssist = false; cycle.settings.allowSelfRating = false; await cycle.save();
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('manual mode is immutable, blocks conversation APIs and cannot skip the configured current step', async () => {
  const appraisal = await launch(['selfAssessment', 'managerReview', 'finalReview']);
  expect(appraisal.status).toBe('self_assessment_pending');
  await call('post', `/${appraisal._id}/conversation/start`, 'employee').send({}).expect(409);
  await call('post', `/${appraisal._id}/manager-review`).send({ submit: true }).expect(409);
  await call('post', `/${appraisal._id}/finalize`).send({ finalRating: 4 }).expect(409);
  await call('get', `/${appraisal._id}`, 'outsider').expect(403);
  const invalid = await call('post', `/cycles/${cycle._id}/launch`).send({ employees: [{ userId: 'employee' }], reviewerMode: 'initiator', appraisalFlow: flow(['finalReview', 'oneOnOne']) });
  expect(invalid.status).toBe(400);
  const retry = await call('post', `/cycles/${cycle._id}/launch`).send({ employees: [{ userId: 'employee' }], reviewerMode: 'initiator', responseDeadlines: { selfAssessmentDue: '2099-01-01', managerReviewDue: '2099-01-10' }, appraisalFlow: flow(['finalReview']) }).expect(200);
  expect(retry.body.data.replayed).toBe(1);
  expect((await Appraisal.findById(appraisal._id)).cycleConfigurationSnapshot.appraisalFlow.steps).toHaveLength(3);
});
test('reviewer-first and skipped self-assessment work through real handlers without changing the shared quarter', async () => {
  const appraisal = await launch(['managerReview', 'discussion', 'finalReview']);
  expect(appraisal.status).toBe('manager_review_pending');
  await call('post', `/${appraisal._id}/manager-review/start`).send({}).expect(200);
  await call('put', `/${appraisal._id}/custom-responses`).send({ respondentRole: 'manager', responses: [{ sectionId: 'development', questionId: 'development_priority', value: 'Improve documentation.' }] }).expect(200);

  await call('post', `/${appraisal._id}/manager-review`).send({ submit: true, managerReview: { overallManagerRating: 4 } }).expect(200);
  expect((await Appraisal.findById(appraisal._id)).status).toBe('discussion_scheduled');
  await call('post', `/${appraisal._id}/finalize`).send({ finalRating: 4 }).expect(409);
  await call('put', `/${appraisal._id}/discussion`).send({ markCompleted: true }).expect(200);
  const final = await call('post', `/${appraisal._id}/finalize`).send({ finalRating: 4, justification: 'Evidence reviewed.' }).expect(200);
  expect(final.body.data.status).toBe('employee_acknowledged');
  const stored = await Appraisal.findById(appraisal._id); expect(stored.selfAssessment?.submittedAt).toBeFalsy();
  expect((await AppraisalCycle.findById(cycle._id)).workflowDefinition.stages.selfAssessment.enabled).toBe(true);
  const effective = await Appraisal.findById(appraisal._id).populate('cycleId');
  expect(effective.cycleId.workflowDefinition.stages.selfAssessment.enabled).toBe(false);
});
test('outcome-only workflows finish with a human result, and model writes cannot bypass earlier work', async () => {
  const appraisal = await launch(['finalReview']);
  const final = await call('post', `/${appraisal._id}/finalize`).send({ finalRating: 4, justification: 'Reviewed the supporting evidence.', overrideReason: 'Reviewed the supporting evidence.' }).expect(200);
  expect(final.body.data.status).toBe('employee_acknowledged');
  expect(final.body.data.selfAssessment?.submittedAt).toBeFalsy();
  await Appraisal.deleteMany({});
  const ordered = await launch(['selfAssessment', 'finalReview']);
  await Appraisal.updateMany({ _id: ordered._id }, { $set: { status: 'final_review_pending' } });
  expect((await Appraisal.findById(ordered._id)).status).toBe('self_assessment_pending');
  const record = await Appraisal.findById(ordered._id);
  record.finalRating = { overall: 4, finalizedAt: new Date() };
  await expect(record.save()).rejects.toMatchObject({ code: 'APPRAISAL_STEP_ORDER' });
});
test('calls use trusted participants, enforce reviewer access, recover connection failures and process transcripts with personal ChatGPT', async () => {
  const appraisal = await launch(['oneOnOne', 'finalReview']); const base = `/${appraisal._id}/meetings`;
  await call('get', base, 'anonymous').expect(401); await call('get', base, 'outsider').expect(403);
  const payload = { stepId: 'oneOnOne_0', scheduledDate: new Date(Date.now() + 3600000), duration: 30, record: true, recordingNoticeAccepted: true, participants: [{ email: 'attacker@example.test' }] };
  await call('post', base, 'employee').send(payload).expect(403);
  const provider = jest.spyOn(shared, 'request').mockRejectedValueOnce(Object.assign(new Error('Connect your calendar'), { statusCode: 409 }));
  await call('post', base).send(payload).expect(409); expect(await OneOnOne.countDocuments()).toBe(1);
  provider.mockResolvedValueOnce({ eventId: 'event-1', calendarId: 'calendar-1', conferenceUrl: 'https://meet.google.com/test-call', recordingState: 'scheduled', state: 'scheduled' });
  const created = await call('post', base).send(payload).expect(201); const meetingId = created.body.data._id;
  expect(JSON.stringify(created.body)).not.toContain('ownerIdentity');
  expect(provider.mock.calls[1][1].sub).toBe('reviewer');
  expect(provider.mock.calls[1][2].participants.map(p => p.email)).toEqual(['reviewer@example.test', 'employee@example.test']);
  await call('post', base).send(payload).expect(200); expect(provider).toHaveBeenCalledTimes(2);
  await call('post', `${base}/${meetingId}/complete`).send({ notes: 'Not yet' }).expect(409);
  await OneOnOne.updateOne({ _id: meetingId }, { $set: { scheduledDate: new Date(Date.now() - 3600000) } });
  provider.mockResolvedValue({ recordingState: 'ready', transcript: JSON.stringify({ segments: [{ speaker: 'Reviewer', text: 'We agreed to document the release.' }] }), recordingUrl: 'https://example.nylas.com/recording.mp4' });
  const completion = jest.spyOn(ai, 'getChatCompletions').mockResolvedValue({ model: 'gpt-5.6-terra', choices: [{ message: { content: 'Agreed: document the release. Owner: not specified.' } }] });
  await processDueMeetings();
  const meeting = await OneOnOne.findById(meetingId);
  expect(meeting.transcript.content).toContain('Reviewer: We agreed'); expect(meeting.appraisalMeeting.summaryState).toBe('ready'); expect(meeting.appraisalMeeting.summaryModel).toBe('gpt-5.6-terra');
  expect(completion.mock.calls[0][1]).toMatchObject({ runtimePreference: 'chatgpt', identity: { sub: 'reviewer' } });
  await call('post', `${base}/${meetingId}/complete`).send({ notes: 'Agreed to document the release.' }).expect(200);
  expect((await Appraisal.findById(appraisal._id)).status).toBe('final_review_pending');
});
