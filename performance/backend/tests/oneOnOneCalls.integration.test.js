const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const OneOnOne = require('../models/OneOnOne');
const User = require('../models/User');
const shared = require('../services/sharedAIAccountService');
const ai = require('../services/aiGatewayService');
const media = require('../services/appraisalMeetingMediaService');
const routes = require('../routes/oneOnOnes');
let app, mongo, provider;
const org = { id: 'standalone-org', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
function actor(name) {
  const organization = { ...org, role: name === 'hr' ? 'hr_manager' : 'staff' };
  return { id: name, sub: name, name, email: `${name}@example.test`, organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: name === 'outsider' ? 'outside' : 'team', name: 'Team', organizationId: org.id, role: name === 'manager' ? 'line_manager' : 'member', directReports: name === 'manager' ? ['employee'] : [] }] };
}
const call = (method, path, who = 'manager') => request(app)[method](`/api/one-on-ones${path}`).set('x-actor', who);
const payload = (mode = 'in_app') => ({ mode, employeeId: 'employee', scheduledDate: new Date(Date.now() + 3600000).toISOString(), duration: 30, requestId: randomUUID(), record: true, recordingNoticeAccepted: true });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { const name = req.get('x-actor') || 'manager'; if (name !== 'anonymous') req.session = { user: actor(name), currentOrganizationId: org.id }; next(); });
  app.use('/api/one-on-ones', routes);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await OneOnOne.createIndexes();
  for (const name of ['manager', 'employee', 'outsider', 'hr']) await User.create({ idpSub: name, email: `${name}@example.test`, profile: { displayName: name }, currentOrganizationId: org.id, idpTeams: actor(name).idpTeams });
  await User.create({ idpSub: 'foreign', email: 'foreign@example.test', currentOrganizationId: 'foreign-org' });
  provider = jest.spyOn(shared, 'request').mockImplementation(async operation => operation === 'meetings/connection' ? { connected: true, email: 'manager@example.test' } : operation === 'meetings/create' ? { eventId: 'event-1', calendarId: 'calendar-1', conferenceUrl: 'https://meet.google.com/test-call', state: 'scheduled', recordingState: 'scheduled' } : { state: 'cancelled' });
});
afterEach(() => jest.restoreAllMocks());

async function consentedCalendarFixture() {
  const response = await call('post', '/').send(payload('calendar')).expect(201);
  const meeting = await OneOnOne.findById(response.body.data._id);
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { status: 'completed',
    'appraisalMeeting.recordingConsent': { noticeVersion: 'calendar-recording-v1', manager: { userId: 'manager', acceptedAt: new Date() }, employee: { userId: 'employee', acceptedAt: new Date() } },
    'transcript.content': 'Private source transcript sentinel', 'transcript.rawContent': 'Private raw transcript sentinel',
    'aiAnalysis.summary': 'Private generated source analysis sentinel', 'appraisalMeeting.summary': 'Private meeting notes sentinel' } });
  return OneOnOne.findById(meeting._id);
}
test('withdrawn recording source is redacted from top-level detail and blocked before ordinary analysis dispatch', async () => {
  const meeting = await consentedCalendarFixture();
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.employee.revokedAt': new Date() } });
  const response = await call('get', `/${meeting._id}`, 'employee').expect(200);
  for (const sentinel of ['Private source transcript sentinel', 'Private raw transcript sentinel', 'Private generated source analysis sentinel', 'Private meeting notes sentinel']) expect(JSON.stringify(response.body)).not.toContain(sentinel);
  const provider = jest.spyOn(require('../services/meetingAnalysisService'), 'analyzeTranscript');
  const denied = await call('post', `/${meeting._id}/analyze`).send({}).expect(409);
  expect(denied.body.code).toBe('SOURCE_CONSENT_UNVERIFIED'); expect(provider).not.toHaveBeenCalled();
  const trends = jest.spyOn(require('../services/meetingAnalysisService'), 'analyzeTrends').mockResolvedValue({ trend: 'no_authorised_history' });
  await call('get', `/${meeting._id}/trends`).expect(200);
  expect(trends.mock.calls[0][0]).toEqual([]);
});
test('withdrawal during ordinary analysis cannot save generated findings or overwrite source revocation', async () => {
  const meeting = await consentedCalendarFixture();
  const analysis = require('../services/meetingAnalysisService');
  jest.spyOn(analysis, 'analyzeTranscript').mockImplementation(async () => {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.revokedAt': new Date() } });
    return { summary: 'Must not publish late ordinary analysis sentinel', sentiment: 'neutral' };
  });
  jest.spyOn(analysis, 'scoreEmployeePerformance').mockResolvedValue({}); jest.spyOn(analysis, 'scoreManagerEffectiveness').mockResolvedValue({}); jest.spyOn(analysis, 'extractActionItems').mockResolvedValue({ actionItems: [] });
  const denied = await call('post', `/${meeting._id}/analyze`).send({}).expect(409);
  expect(denied.body.code).toBe('SOURCE_CONSENT_UNVERIFIED');
  const saved = await OneOnOne.findById(meeting._id);
  expect(saved.appraisalMeeting.recordingConsent.revokedAt).toBeTruthy(); expect(saved.aiAnalysis.summary).toBe('Private generated source analysis sentinel');
});

test('only authorized managers schedule trusted participants; consent and recording bounds are enforced', async () => {
  await call('post', '/', 'anonymous').send(payload()).expect(401);
  await call('post', '/', 'employee').send(payload()).expect(403);
  for (const employeeId of ['manager', 'outsider', 'foreign', 'missing']) await call('post', '/').send({ ...payload(), employeeId }).expect(403);
  await call('post', '/', 'hr').send({ ...payload(), employeeId: 'foreign' }).expect(403);
  await call('post', '/').send({ ...payload(), recordingNoticeAccepted: false }).expect(400);
  await call('post', '/').send({ ...payload(), duration: 60 }).expect(400);
  await call('post', '/').send({ ...payload('calendar'), meetingLink: 'https://evil.example/collect' }).expect(400);
  expect(await OneOnOne.countDocuments()).toBe(0);
  const response = await call('post', '/').send({ ...payload(), employeeInfo: { email: 'forged@example.test' }, ownerIdentity: { sub: 'hr' } }).expect(201);
  expect(response.body.data.employeeInfo.email).toBe('employee@example.test');
  expect(response.body.data.call.mode).toBe('in_app');
  expect(JSON.stringify(response.body)).not.toContain('ownerIdentity');
  expect(provider).not.toHaveBeenCalled();
});

test('parallel retries keep one call and ignore forged provider destinations', async () => {
  const body = payload('calendar');
  const responses = await Promise.all([call('post', '/').send(body), call('post', '/').send(body)]);
  expect(responses.every(response => [200, 201].includes(response.status))).toBe(true);
  expect(await OneOnOne.countDocuments()).toBe(1);
  const ids = new Set(provider.mock.calls.filter(([operation]) => operation === 'meetings/create').map(([, , input]) => input.externalId));
  expect(ids.size).toBe(1);
  const invocation = provider.mock.calls.find(([operation]) => operation === 'meetings/create');
  expect(invocation[1].sub).toBe('manager');
  expect(invocation[2].participants.map(person => person.email)).toEqual(['manager@example.test', 'employee@example.test']);
  await call('post', '/').send(body).expect(200);
  const stored = await OneOnOne.findOne(); expect(stored.appraisalMeeting.lifecycleScheduled).toBe(true);
});

test('a missing connection creates no meeting; a provider outage leaves a retryable record without duplicate invitations', async () => {
  provider.mockResolvedValueOnce({ connected: false });
  await call('post', '/').send(payload('calendar')).expect(409); expect(await OneOnOne.countDocuments()).toBe(0);
  const body = payload('calendar');
  provider.mockImplementation(async operation => { if (operation === 'meetings/connection') return { connected: true }; throw Object.assign(new Error('Calendar temporarily unavailable'), { statusCode: 503 }); });
  const failed = await call('post', '/').send(body).expect(503); const id = failed.body.data.meetingId;
  expect(await OneOnOne.countDocuments()).toBe(1);
  const pending = await call('get', `/${id}`).expect(200); expect(pending.body.data.call.integration.calendarState).toBe('needs_attention');
  await call('post', `/${id}/call/retry`, 'employee').expect(403);
  provider.mockResolvedValue({ eventId: 'recovered', calendarId: 'calendar', conferenceUrl: 'https://meet.google.com/recovered', state: 'scheduled' });
  await call('post', `/${id}/call/retry`).expect(200);
  expect(await OneOnOne.countDocuments()).toBe(1);
  expect((await OneOnOne.findById(id)).appraisalMeeting.lifecycleScheduled).toBe(true);
  await call('put', `/${id}`).send({ scheduledDate: new Date(Date.now() + 7200000) }).expect(409);
  provider.mockRejectedValueOnce(Object.assign(new Error('Cancellation not confirmed'), { statusCode: 502 }));
  await call('delete', `/${id}`).expect(502);
  expect((await OneOnOne.findById(id)).status).toBe('scheduled');
  provider.mockResolvedValue({ state: 'cancelled' });
  await call('delete', `/${id}`).expect(200);
  expect((await OneOnOne.findById(id)).appraisalMeeting.calendarState).toBe('cancelled');
});

test('calendar transcripts and personal-account notes process without requiring an appraisal', async () => {
  const created = await call('post', '/').send(payload('calendar')).expect(201); const id = created.body.data._id;
  provider.mockResolvedValue({ recordingState: 'scheduled' });
  const consent = { noticeVersion: 'calendar-recording-v1', acknowledged: true, recording: true, transcription: true };
  await call('post', `/${id}/call/recording-consent`, 'manager').send(consent).expect(200);
  await call('post', `/${id}/call/recording-consent`, 'employee').send(consent).expect(200);
  await OneOnOne.updateOne({ _id: id }, { $set: { scheduledDate: new Date(Date.now() - 60000) } });
  provider.mockResolvedValue({ recordingState: 'ready', transcript: JSON.stringify({ segments: [{ speaker: 'Employee', text: 'I will document the release.' }] }), recordingUrl: 'https://recordings.example.test/saved' });
  const completion = jest.spyOn(ai, 'getChatCompletions').mockResolvedValue({ model: 'gpt-5.6-terra', choices: [{ message: { content: 'Employee will document the release.' } }] });
  await media.processDueMeetings();
  const employee = await call('get', `/${id}/call`, 'employee').expect(200);
  expect(employee.body.data[0].transcript).toContain('Employee: I will document');
  expect(employee.body.data[0].summary).toContain('document the release');
  expect(completion.mock.calls[0][1].identity.sub).toBe('manager');
  await call('post', `/${id}/call/summary`, 'employee').expect(200);
  expect(completion.mock.calls.at(-1)[1].identity.sub).toBe('employee');
  await call('get', `/${id}/call`, 'outsider').expect(403);
  await call('post', `/${id}/call/complete`).send({ notes: 'Agreed actions saved.' }).expect(200);
  const history = await call('get', '/?past=true', 'employee').expect(200);
  expect(history.body.data[0].call.integration.recordingUrl).toBeTruthy();
  expect(history.body.data[0].call.transcript).toBeUndefined();
  expect(history.body.data[0].sharedNotes).toBe('Agreed actions saved.');
});

test('native calls enforce participant consent, store private media and prevent completion during an active call', async () => {
  const created = await call('post', '/').send(payload()).expect(201); const id = created.body.data._id; const base = `/${id}/call/native`;
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ urls: ['turn:example.test'], username: 'test', credential: 'test' }) });
  const managerPeer = randomUUID(), employeePeer = randomUUID();
  await call('post', `${base}/join`).send({ peerId: managerPeer, consent: false }).expect(400);
  await call('post', `${base}/join`, 'hr').send({ peerId: randomUUID(), consent: true }).expect(403);
  await call('post', `${base}/join`).send({ peerId: managerPeer, consent: true }).expect(200);
  await call('post', `${base}/record`).send({ peerId: managerPeer }).expect(409);
  await call('post', `${base}/join`, 'employee').send({ peerId: employeePeer, consent: true }).expect(200);
  await call('post', `${base}/record`).send({ peerId: managerPeer }).expect(200);
  await call('post', `${base}/stop`).send({ peerId: managerPeer }).expect(200);
  await call('post', `${base}/upload?peerId=${managerPeer}`).attach('recording', Buffer.alloc(80), { filename: 'call.webm', contentType: 'video/webm' }).expect(201);
  await call('get', `${base}/recording`, 'employee').expect(200);
  await call('get', `${base}/recording`, 'outsider').expect(403);
  await call('post', `/${id}/call/complete`).send({ notes: 'Done.' }).expect(409);
  await call('post', `${base}/leave`).send({ peerId: managerPeer }).expect(200);
  await call('post', `${base}/leave`, 'employee').send({ peerId: employeePeer }).expect(200);
  await OneOnOne.updateOne({ _id: id }, { $set: { scheduledDate: new Date(Date.now() - 60000) } });
  await call('post', `/${id}/call/complete`).send({ notes: 'Agreed next steps.' }).expect(200);
  await call('post', `${base}/join`).send({ peerId: managerPeer, consent: true }).expect(409);
  const detail = await call('get', `/${id}`, 'employee').expect(200);
  expect(detail.body.data.call.integration.recordingAvailable).toBe(true);
  expect(JSON.stringify(detail.body)).not.toContain('recordingFileId');
});

test('history is tenant/participant scoped, paginated and excludes live calls', async () => {
  const records = Array.from({ length: 52 }, (_, index) => ({ managerId: 'manager', employeeId: 'employee', organizationId: org.id, title: `Past ${index}`, scheduledDate: new Date(Date.now() - (index + 1) * 60000), status: 'completed' }));
  await OneOnOne.insertMany([...records, { ...records[0], managerId: 'outsider', employeeId: 'other' }, { ...records[0], organizationId: 'foreign-org' }, { ...records[0], status: 'in_progress', title: 'Live call' }, { ...records[0], scheduledDate: new Date(Date.now() + 3600000), status: 'cancelled', title: 'Cancelled future call' }]);
  const first = await call('get', '/?past=true&limit=51&offset=0', 'employee').expect(200);
  expect(first.body.data).toHaveLength(51); expect(first.body.data.some(meeting => meeting.title === 'Live call')).toBe(false);
  const second = await call('get', '/?past=true&limit=51&offset=50', 'employee').expect(200); expect(second.body.data).toHaveLength(3);
  const upcoming = await call('get', '/?upcoming=true', 'employee').expect(200);
  expect(upcoming.body.data.map(meeting => meeting.title)).toEqual(['Live call']);
  const foreign = await OneOnOne.findOne({ organizationId: 'foreign-org' });
  await call('get', `/${foreign._id}`).expect(404);
  await call('post', `/${foreign._id}/call/native/join`).send({ peerId: randomUUID(), consent: true }).expect(404);
});


test('manual reminders use only saved participants, deduplicate clicks and enforce meeting access', async () => {
  const { DomainEvent } = { DomainEvent: require('../models/DomainEvent') }; await DomainEvent.createIndexes();
  const created = await call('post', '/').send(payload()).expect(201); const id = created.body.data._id;
  const path = `/${id}/call/reminder`;
  await call('post', path, 'employee').send({}).expect(403);
  await call('post', path, 'outsider').send({}).expect(403);
  const reminders = await Promise.all([1, 2].map(() => call('post', path).send({ recipients: [{ email: 'forged@example.test' }], organizationId: 'foreign-org' })));
  expect(reminders.map(r => r.status)).toEqual([202, 202]);
  const events = await DomainEvent.find({ eventType: 'one_on_one.call_reminder' });
  expect(events).toHaveLength(1); expect(events[0].organizationId).toBe(org.id);
  expect(events[0].recipients.map(r => r.email).sort()).toEqual(['employee@example.test', 'manager@example.test']);
  expect(events[0].notification.deepLink).toBe(`/one-on-ones/${id}`);
  expect(events[0].status).toBe('pending');
  await OneOnOne.updateOne({ _id: id }, { $set: { status: 'completed' } });
  await call('post', path).send({}).expect(409);
});

test('personal call connection uses the requesting participant identity', async () => {
  const created = await call('post', '/').send(payload()).expect(201); const id = created.body.data._id;
  await call('get', `/${id}/call/connection`, 'employee').expect(200);
  expect(provider.mock.calls.at(-1)[0]).toBe('meetings/connection'); expect(provider.mock.calls.at(-1)[1].sub).toBe('employee');
});
