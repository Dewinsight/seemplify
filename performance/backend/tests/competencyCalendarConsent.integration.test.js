'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const OneOnOne = require('../models/OneOnOne');
const service = require('../services/calendarRecordingConsentService');
const shared = require('../services/sharedAIAccountService');
const calls = require('../services/meetingCallService');
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); });
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
const acceptance = () => ({ noticeVersion: service.NOTICE, acknowledged: true, recording: true, transcription: true });
async function fixture(extra = {}) {
  return OneOnOne.create({ organizationId: 'org-a', managerId: 'manager', employeeId: 'employee', managerInfo: { name: 'Synthetic manager', email: 'manager@example.test' }, employeeInfo: { name: 'Synthetic employee', email: 'employee@example.test' }, scheduledDate: new Date(Date.now() + 3600000), duration: 30, title: 'Synthetic consent test', nylas: { eventId: 'event', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc' }, appraisalMeeting: { source: 'one_on_one', mode: 'calendar', recordingRequested: true, ownerIdentity: { sub: 'manager', email: 'manager@example.test', organizationId: 'org-a' }, recordingPolicyVersion: service.NOTICE, calendarConsent: {} }, ...extra });
}
function provider() { return jest.spyOn(shared, 'request').mockImplementation(async operation => ({ recordingState: operation.endsWith('stopRecording') ? 'revoked' : 'scheduled' })); }
test('CA-103 future calendar creation defers the bot and sends only bounded participant identities', async () => {
  const meeting = await fixture({ nylas: {} });
  const transport = jest.spyOn(shared, 'request').mockResolvedValue({ eventId: 'event', calendarId: 'calendar', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', recordingState: 'awaiting_consent', state: 'scheduled' });
  const saved = await calls.createCalendar(meeting);
  expect(transport).toHaveBeenCalledWith('meetings/create', expect.anything(), expect.objectContaining({ record: false, recordingPolicyVersion: service.NOTICE, participantSubjects: ['manager', 'employee'] }), expect.anything());
  expect(saved.appraisalMeeting.recordingState).toBe('awaiting_consent');
  expect(saved.appraisalMeeting.recordingConsent).toBeUndefined();
});
test('CA-103 organizer promise cannot stand in for employee; actual second participant schedules recording once', async () => {
  const meeting = await fixture(), transport = provider();
  let saved = await service.acknowledge(meeting, 'manager', acceptance());
  expect(transport).not.toHaveBeenCalled();
  expect(saved.appraisalMeeting.recordingConsent).toBeUndefined();
  saved = await service.acknowledge(meeting, 'employee', { ...acceptance(), userId: 'forged' });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(saved.appraisalMeeting.recordingConsent.employee.userId).toBe('employee');
  expect(saved.appraisalMeeting.recordingConsent.manager.userId).toBe('manager');
  await service.acknowledge(meeting, 'employee', acceptance());
  expect(transport).toHaveBeenCalledTimes(1);
});
test('CA-103 unrelated HR cannot proxy consent; legacy and closed calls cannot be retrospectively authorized', async () => {
  const meeting = await fixture(), transport = provider();
  await expect(service.acknowledge(meeting, 'hr-admin', acceptance())).rejects.toMatchObject({ statusCode: 403 });
  const legacy = await fixture({ appraisalMeeting: { mode: 'calendar', recordingRequested: true } });
  expect(service.status(legacy, 'manager').state).toBe('legacy_unverified');
  await expect(service.acknowledge(legacy, 'manager', acceptance())).rejects.toMatchObject({ code: 'RECORDING_NOTICE_REQUIRED' });
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { status: 'completed' } });
  await expect(service.acknowledge(meeting, 'manager', acceptance())).rejects.toMatchObject({ code: 'RECORDING_WINDOW_CLOSED' });
  expect(transport).not.toHaveBeenCalled();
});
test('CA-103 withdrawal invalidates source authorization immediately and preserves calendar event', async () => {
  const meeting = await fixture(), transport = provider();
  await service.acknowledge(meeting, 'manager', acceptance()); await service.acknowledge(meeting, 'employee', acceptance());
  const saved = await service.acknowledge(meeting, 'employee', { noticeVersion: service.NOTICE, acknowledged: false });
  expect(saved.appraisalMeeting.recordingConsent.revokedAt).toBeTruthy();
  expect(saved.nylas.eventId).toBe('event');
  expect(transport.mock.calls.at(-1)[0]).toBe('meetings/stopRecording');
  await expect(service.start(meeting, 'manager')).rejects.toMatchObject({ code: 'RECORDING_CONSENT_REQUIRED' });
});
test('CA-103 concurrent withdrawal while provider responds never publishes valid recording consent', async () => {
  const meeting = await fixture(); let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), providerResult = new Promise(resolve => { release = resolve; });
  const transport = jest.spyOn(shared, 'request').mockImplementation(async operation => { if (operation.endsWith('startRecording')) { entered(); return providerResult; } return { recordingState: 'revoked' }; });
  await service.acknowledge(meeting, 'manager', acceptance());
  const pending = service.acknowledge(meeting, 'employee', acceptance());
  await started; await service.acknowledge(meeting, 'manager', { noticeVersion: service.NOTICE, acknowledged: false });
  release({ recordingState: 'scheduled' });
  await expect(pending).rejects.toMatchObject({ code: 'RECORDING_CONSENT_REVOKED' });
  const saved = await OneOnOne.findById(meeting._id);
  expect(saved.appraisalMeeting.recordingConsent?.revokedAt).toBeTruthy();
  expect(transport.mock.calls.filter(call => call[0].endsWith('stopRecording')).length).toBe(2);
});
test('CA-103 consent routes bind authenticated subject and selected organization', async () => {
  const meeting = await fixture(); provider();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.meeting = meeting; req.session = { user: { sub: req.headers['x-test-user'] || 'employee', email: 'employee@example.test' }, currentOrganizationId: req.headers['x-test-org'] || 'org-a' }; next(); });
  app.use('/consent', require('../routes/calendarRecordingConsent')());
  await request(app).post('/consent/start').set('x-test-user', 'hr-admin').send({}).expect(403);
  await request(app).get('/consent').set('x-test-org', 'org-b').expect(404);
  await request(app).post('/consent').send(acceptance()).expect(410);
  const result = await request(app).get('/consent').expect(200);
  expect(result.body.data.ownRole).toBe('employee');
  expect(result.body.data.canAcknowledge).toBe(false);
});
test('CA-103 source recording consent alone never grants assessment-purpose processing', async () => {
  const meeting = await fixture(); provider();
  await service.acknowledge(meeting, 'manager', acceptance()); await service.acknowledge(meeting, 'employee', acceptance());
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { status: 'completed', 'transcript.status': 'ready', 'transcript.content': 'Synthetic public utterance' } });
  jest.spyOn(require('../services/competency/settingsService'), 'getSettings').mockResolvedValue({ callEvidenceEnabled: true, mediaRetentionDays: 30, noticeVersion: 'assessment-v1' });
  const oral = require('../services/competency/oralService'), record = { _id: new mongoose.Types.ObjectId(), participant: { userId: 'employee' } }, ctx = { organizationId: 'org-a', actor: { userId: 'manager' }, organizationWide: false };
  const consent = { recording: true, transcription: true, policyVersion: 'assessment-v1' };
  await expect(oral.callSource(ctx, record, 'nylas', String(meeting._id), consent)).rejects.toMatchObject({ code: 'ASSESSMENT_CONSENT_REQUIRED' });
  await oral.CallConsent.create(['manager', 'employee'].map(userId => ({ organizationId: 'org-a', assessmentId: String(record._id), callId: String(meeting._id), userId, noticeVersion: 'assessment-v1', acknowledged: true, acknowledgedAt: new Date() })));
  const source = await oral.callSource(ctx, record, 'nylas', String(meeting._id), consent);
  expect(source.sha256).toMatch(/^[a-f\d]{64}$/); expect(source.text).toBeUndefined();
  await service.acknowledge(meeting, 'employee', { noticeVersion: service.NOTICE, acknowledged: false });
  await expect(oral.callSource(ctx, record, 'nylas', String(meeting._id), consent)).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
});

async function linkedEvidence() {
  const meeting = await fixture(); provider();
  await service.acknowledge(meeting, 'manager', acceptance()); await service.acknowledge(meeting, 'employee', acceptance());
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { status: 'completed', 'transcript.status': 'ready', 'transcript.content': 'Synthetic utterance' } });
  const auth = require('../services/competency/authorizationService');
  const ctx = { organizationId: 'org-a', actor: { userId: 'manager', name: 'Synthetic manager' }, user: { email: 'manager@example.test' }, organizationWide: true, permissions: new Set(auth.ACTIONS), directory: { reviewers: [], members: [] }, req: {} };
  jest.spyOn(auth, 'refreshContext').mockResolvedValue(ctx);
  jest.spyOn(require('../services/competency/settingsService'), 'getSettings').mockResolvedValue({ callEvidenceEnabled: true, mediaRetentionDays: 30, noticeVersion: 'assessment-v1', aiDraftsEnabled: true, policyVersion: 'policy-v1', evidenceRetentionDays: 30 });
  const record = await require('../models/CompetencyAssessment').create({ organizationId: 'org-a', cycleId: String(new mongoose.Types.ObjectId()), participant: { userId: 'employee', name: 'Synthetic employee' }, assessors: [{ userId: 'manager' }], assessorIds: ['manager'], definitionSnapshot: { definitionHash: 'synthetic', role: {}, criteria: [{ id: 'criterion-0', evidenceRequired: true }] }, items: [], managerFeedback: [] });
  const oral = require('../services/competency/oralService');
  await oral.CallConsent.create(['manager', 'employee'].map(userId => ({ organizationId: 'org-a', assessmentId: String(record._id), callId: String(meeting._id), userId, noticeVersion: 'assessment-v1', acknowledged: true, acknowledgedAt: new Date() })));
  const source = await oral.callSource(ctx, record, 'nylas', String(meeting._id), { recording: true, transcription: true, policyVersion: 'assessment-v1' });
  const session = await require('../models/CompetencyOralSession').create({ organizationId: 'org-a', assessmentId: String(record._id), participantId: 'employee', title: 'Synthetic oral notes', callType: 'nylas', callId: String(meeting._id), source, consent: source.consent, status: 'submitted', prompts: [{ criterionId: 'criterion-0', question: 'Synthetic question', answer: 'Synthetic answer sentinel', notes: '', required: true }], participants: [{ userId: 'employee' }, { userId: 'manager' }] });
  const evidence = await require('../models/CompetencyEvidence').create({ organizationId: 'org-a', assessmentId: String(record._id), participantId: 'employee', kind: 'oral', title: 'Synthetic oral notes', criterionIds: ['criterion-0'], visibility: 'assessors', status: 'ready', text: 'Synthetic answer sentinel', spans: [{ id: 'span-1', text: 'Synthetic answer sentinel' }], sha256: 'synthetic-hash', source: { oralSessionId: String(session._id) }, createdBy: ctx.actor });
  return { meeting, ctx, record: record.toObject(), evidence, session, oral };
}
test('CA-103/104/115 withdrawal denies current oral answers and AI before provider dispatch, while explicit manual detach remains available', async () => {
  const { meeting, ctx, record, evidence, session, oral } = await linkedEvidence();
  await service.acknowledge(meeting, 'employee', { noticeVersion: service.NOTICE, acknowledged: false });
  const provider = jest.spyOn(shared, 'complete');
  await expect(require('../services/competency/aiService').create(ctx, String(record._id), { evidenceIds: [String(evidence._id)], consent: { acknowledged: true, policyVersion: 'policy-v1' } }, 'synthetic-withdrawn-before')).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
  expect(provider).not.toHaveBeenCalled();
  const source = await require('../services/competency/evidenceService').get(ctx, String(record._id), String(evidence._id));
  expect(source.evidence.status).toBe('source_unavailable'); expect(source.evidence.text).toBe('');
  await expect(oral.get(ctx, String(record._id), String(session._id))).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
  const detail = await require('../services/competency/assessmentService').detail(ctx, record);
  expect(detail.oralSessions[0].prompts).toEqual([]); expect(detail.oralSessions[0].sourceUnavailable).toBe(true);
  expect(detail.evidence[0].text).toBeUndefined(); expect((await oral.list(ctx, String(record._id)))[0].prompts).toEqual([]);
  const detached = await oral.patch(ctx, String(record._id), String(session._id), { detachCall: true }, 1);
  expect(detached.callType).toBe('manual'); expect(detached.prompts[0].answer).toBe('Synthetic answer sentinel');
});
test('CA-104 source withdrawal during AI generation discards the draft after provider response', async () => {
  const { meeting, ctx, record, evidence } = await linkedEvidence();
  const provider = jest.spyOn(shared, 'complete').mockImplementation(async () => {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.employee.revokedAt': new Date() } });
    return { content: JSON.stringify({ observations: [{ criterionId: 'criterion-0', text: 'Synthetic cited observation', citations: [{ evidenceId: String(evidence._id), spanId: 'span-1', quote: 'Synthetic answer sentinel' }] }] }) };
  });
  await expect(require('../services/competency/aiService').create(ctx, String(record._id), { evidenceIds: [String(evidence._id)], consent: { acknowledged: true, policyVersion: 'policy-v1' } }, 'synthetic-withdrawn-during')).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await require('../models/CompetencyAISuggestion').countDocuments({ status: 'ready' })).toBe(0);
});
test('CA-103 calendar sync cannot overwrite consent revoked during gateway media response', async () => {
  const { meeting } = await linkedEvidence();
  shared.request.mockImplementation(async () => {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.revokedAt': new Date(), 'appraisalMeeting.recordingState': 'revoked' } });
    return { recordingState: 'ready', transcript: 'Do not publish late private transcript sentinel', recordingUrl: 'https://example.nylas.com/recording' };
  });
  await expect(require('../services/appraisalMeetingMediaService').sync(meeting)).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
  const saved = await OneOnOne.findById(meeting._id);
  expect(saved.transcript.content).toBe('Synthetic utterance'); expect(saved.appraisalMeeting.recordingState).toBe('revoked');
  expect(JSON.stringify(calls.publicMeeting(saved))).not.toContain('Synthetic utterance');
  expect(calls.publicMeeting(saved).integration.recordingUrl).toBeUndefined();
});
test('CA-103 ordinary meeting summary checks source authority before dispatch and after response', async () => {
  const { meeting } = await linkedEvidence();
  const ai = require('../services/aiGatewayService');
  const provider = jest.spyOn(ai, 'getChatCompletions').mockImplementation(async () => {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.employee.revokedAt': new Date() } });
    return { choices: [{ message: { content: 'Must not publish late AI meeting notes sentinel' } }] };
  });
  const current = await OneOnOne.findById(meeting._id);
  await expect(require('../services/appraisalMeetingMediaService').summarize(current, current.appraisalMeeting.ownerIdentity)).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
  expect(provider).toHaveBeenCalledTimes(1); expect((await OneOnOne.findById(meeting._id)).appraisalMeeting.summary).toBeUndefined();
  await expect(require('../services/appraisalMeetingMediaService').summarize(current, current.appraisalMeeting.ownerIdentity)).rejects.toMatchObject({ statusCode: 409 });
  expect(provider).toHaveBeenCalledTimes(1);
});
test('CA-112 PDF text preserves oral occurrence, time zone, actual submitter, participants and revision', async () => {
  const report = { participant: { name: 'Synthetic employee' }, role: { name: 'Synthetic role', version: 1 }, number: 1, status: 'current', visibilityScope: 'assessors', selectedSources: ['internal'], finalClassification: { finalizedAt: '2026-10-19', finalisedAt: '2026-10-19', label: 'Synthetic test outcome', finalizedBy: {}, finalisedBy: { name: 'Synthetic finalizer', userId: 'finalizer' } }, score: { overallScore: null, coverage: { assessedRequired: 0, required: 0, assessed: 0, selected: 0, weighted: 0 }, formula: {}, sourceScores: [], exclusions: [] }, findings: [], managerSource: { state: 'not_linked' }, managerFeedback: [], criteria: [], evidenceReferences: [], exceptions: [], oralFindings: [{ title: 'Synthetic dated oral', callType: 'manual', occurredAt: '2026-10-18T14:25:00.000Z', timeZone: 'Europe/London', participants: [{ name: 'Synthetic participant sentinel' }, { name: 'Synthetic assessor sentinel' }], status: 'submitted', revision: 3, createdBy: { name: 'Synthetic creator' }, createdAt: '2026-10-17T09:00:00.000Z', submittedBy: { name: 'Actual submitter sentinel' }, submittedAt: '2026-10-19T11:30:00.000Z', prompts: [] }] };
  report.findings.push({ criterion: { name: 'Synthetic criterion', sourceType: 'internal', sourceName: 'Internal framework sentinel', sourceVersionId: 'opaque-reference-sentinel', sourceVersion: 7, description: 'Complete native criterion definition sentinel', weight: 1 }, status: 'insufficient_evidence', evidenceIds: [] });
  const buffer = await require('../services/competency/reportService').pdfBuffer(report);
  const parsed = await require('pdf-parse')(new Uint8Array(buffer), { version: 'v2.0.550' });
  for (const expected of ['Session date:', '2026-10-18T14:25:00.000Z', 'Europe/London', 'Synthetic participant sentinel', 'Synthetic assessor sentinel', 'revision 3', 'Submitted by:', 'Actual submitter sentinel', '2026-10-19T11:30:00.000Z', 'Internal framework sentinel', 'version 7', 'Complete native criterion definition sentinel']) expect(parsed.text).toContain(expected);
  expect(parsed.text).not.toContain('opaque-reference-sentinel');
});


test('active call accepts each participant permission and supports a bounded manual add', async () => {
  const meeting = await fixture({ scheduledDate: new Date(Date.now() - 60000) }), transport = provider();
  expect(service.status(meeting, 'employee').canAcknowledge).toBe(true);
  await service.acknowledge(meeting, 'manager', acceptance());
  const accepted = await service.acknowledge(meeting, 'employee', acceptance());
  expect(transport).toHaveBeenCalledTimes(1); expect(service.status(accepted, 'manager').canAddNow).toBe(true);
  await service.start(meeting, 'manager', { joinNow: true });
  expect(transport.mock.calls.at(-1)[2].joinNow).toBe(true);
  await expect(service.start(meeting, 'hr-admin', { joinNow: true })).rejects.toMatchObject({ statusCode: 403 });
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { scheduledDate: new Date(Date.now() - 31 * 60000) } });
  await expect(service.start(meeting, 'manager', { joinNow: true })).rejects.toMatchObject({ code: 'RECORDING_CONSENT_REQUIRED' });
});
