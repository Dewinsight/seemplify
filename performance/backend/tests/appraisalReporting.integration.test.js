'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const OneOnOne = require('../models/OneOnOne');
const Job = require('../models/AppraisalAIReport');
const User = require('../models/User');
const media = require('../services/appraisalMeetingMediaService');
const reports = require('../services/appraisalFinalReportService');
const shared = require('../services/sharedAIAccountService');
const ai = require('../services/aiGatewayService');
const org = { id: 'report-org', name: 'Report QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
const identity = { sub: 'reviewer', email: 'reviewer@example.test', organizationId: org.id };
function actor(who) {
  const organization = { ...org, ...(who === 'foreign' ? { id: 'other-org', role: 'owner' } : {}) };
  return { id: who, sub: who, name: who, email: `${who}@example.test`, organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: who === 'outsider' ? 'outside' : 'team', name: 'Team', organizationId: organization.id, role: who === 'reviewer' ? 'line_manager' : 'member' }] };
}
let mongo, app, cycle;
const api = (method, url, who = 'reviewer') => request(app)[method](`/api/appraisals${url}`).set('x-actor', who);
async function fixture(status = 'manager_review_pending') {
  const appraisal = await Appraisal.create({ cycleId: cycle._id, organizationId: org.id, status,
    employee: { userId: 'employee', name: 'Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Reviewer', email: identity.email },
    selfAssessment: { submittedAt: new Date(), overallSummary: { achievements: 'Employee outcome evidence' } },
    managerReview: { submittedAt: new Date(), overallSummary: { strengths: 'Submitted reviewer feedback' }, overallManagerRating: 4 },
    ...(status === 'completed' ? { finalRating: { overall: 4, finalizedAt: new Date() } } : {}) });
  const meeting = await OneOnOne.create({ organizationId: org.id, appraisalId: appraisal._id, workflowStepId: 'call', managerId: 'reviewer', employeeId: 'employee',
    scheduledDate: new Date(Date.now() - 3600000), title: 'Evidence call', status: 'completed', sharedNotes: 'Agreed action: document the release.',
    appraisalMeeting: { mode: 'calendar', recordingRequested: true, recordingState: 'ready', ownerIdentity: identity } });
  return { appraisal, meeting, path: `/${appraisal._id}/meetings/${meeting._id}` };
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { const who = req.get('x-actor') || 'reviewer'; if (who !== 'anonymous') req.session = { user: actor(who), currentOrganizationId: actor(who).currentOrganization.id }; next(); });
  app.use('/api/appraisals', require('../routes/appraisals'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await Job.createIndexes();
  cycle = await Cycle.create({ organizationId: org.id, name: 'Report cycle', periodStart: '2026-01-01', periodEnd: '2026-03-31', status: 'active', createdBy: { userId: 'reviewer' } });
  for (const who of ['reviewer', 'employee', 'outsider']) await User.create({ idpSub: who, email: actor(who).email, profile: { displayName: who }, currentOrganizationId: org.id, idpTeams: actor(who).idpTeams });
  jest.spyOn(ai, 'getChatCompletions').mockResolvedValue({ model: 'synthetic-personal-model', choices: [{ message: { content: 'Synthetic report based on the submitted evidence. Human final rating: 4/5.' } }] });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('manual transcripts persist on completed calls, enforce reviewer/tenant access, and cannot replace saved evidence', async () => {
  const record = await fixture();
  for (const [who, status] of [['employee', 403], ['outsider', 403], ['foreign', 404], ['anonymous', 401]]) await api('post', `${record.path}/transcript`, who).send({ content: 'Transcript evidence' }).expect(status);
  await api('post', `${record.path}/transcript`).send({ content: ' ' }).expect(400);
  await api('post', `${record.path}/transcript`).send({ content: 'Reviewer: We agreed to document the release.\nEmployee: I will do that.' }).expect(200);
  const saved = await OneOnOne.findById(record.meeting._id);
  expect(saved.transcript).toMatchObject({ source: 'manual_upload', status: 'ready' });
  expect(saved.appraisalMeeting.manualTranscriptAddedBy).toBe('reviewer');
  expect((await api('get', `/${record.appraisal._id}/meetings`, 'employee').expect(200)).body.data[0]).toMatchObject({ transcript: saved.transcript.content, integration: { transcriptSource: 'manual_upload' } });
  await api('post', `${record.path}/transcript`).send({ content: 'Replacement' }).expect(409);
  await api('post', `${record.path}/summary`).send({}).expect(200);
  expect(ai.getChatCompletions.mock.calls[0][1]).toMatchObject({ runtimePreference: 'chatgpt', identity });
});

test('Nylas speaker-labelled and raw media sync persist and the endpoint returns the fresh transcript', async () => {
  const record = await fixture();
  jest.spyOn(shared, 'request').mockResolvedValue({ recordingState: 'ready', transcript: JSON.stringify({ type: 'speaker_labelled', transcript: [{ speaker: 'Employee', text: 'The portal shipped.' }] }) });
  const response = await api('post', `${record.path}/sync`).send({}).expect(200);
  expect(response.body.data.transcript).toBe('Employee: The portal shipped.');
  expect((await OneOnOne.findById(record.meeting._id)).transcript.source).toBe('nylas');
  expect(media.readableTranscript({ type: 'raw', transcript: 'Raw provider transcript' })).toBe('Raw provider transcript');
  expect(media.readableTranscript(JSON.stringify('Plain JSON transcript'))).toBe('Plain JSON transcript');
  expect(media.readableTranscript({ transcript: [] })).toBe('');
});

test('a manual transcript saved during provider sync is preserved', async () => {
  const { meeting } = await fixture();
  jest.spyOn(shared, 'request').mockImplementation(async () => {
    await media.saveManualTranscript(meeting, 'Manually verified transcript', 'reviewer');
    return { recordingState: 'ready', transcript: 'Late automatic transcript' };
  });
  const saved = await media.sync(meeting);
  expect(saved.transcript.content).toBe('Manually verified transcript');
  expect(saved.transcript.source).toBe('manual_upload');
});

test('the final report combines authorized evidence, uses the requesting personal identity, and preserves the human rating', async () => {
  const { appraisal, meeting } = await fixture('completed');
  await media.saveManualTranscript(meeting, 'Employee: We improved the customer portal.', 'reviewer');
  const Document = require('../models/AppraisalDocument');
  for (const [visibility, text] of [['employee_manager', 'Shared document evidence'], ['hr_only', 'PRIVATE HR SENTINEL'], ['employee_only', 'PRIVATE EMPLOYEE SENTINEL']]) {
    const doc = await Document.create({ organizationId: org.id, appraisalId: appraisal._id, originalName: `${visibility}.txt`, fileName: 'synthetic.txt', fileType: 'txt', visibility, textExtraction: { status: 'completed', extractedText: text } });
    await Appraisal.updateOne({ _id: appraisal._id }, { $push: { documents: doc._id } });
  }
  await api('post', `/${appraisal._id}/report/ai`, 'employee').send({}).expect(403);
  await api('post', `/${appraisal._id}/report/ai`, 'foreign').send({}).expect(404);
  await api('post', `/${appraisal._id}/report/ai`).send({}).expect(202);
  await Promise.all([reports.processDue(), reports.processDue()]);
  expect(ai.getChatCompletions).toHaveBeenCalledTimes(1);
  const [messages, options] = ai.getChatCompletions.mock.calls[0];
  expect(options).toMatchObject({ identity, runtimePreference: 'chatgpt' });
  for (const evidence of ['Employee outcome evidence', 'Submitted reviewer feedback', 'We improved the customer portal.', 'Shared document evidence', 'Agreed action: document the release.']) expect(messages[1].content).toContain(evidence);
  expect(messages[1].content).not.toContain('PRIVATE HR SENTINEL'); expect(messages[1].content).not.toContain('PRIVATE EMPLOYEE SENTINEL');
  const response = await api('get', `/${appraisal._id}/report`, 'employee').expect(200);
  expect(response.body.data.aiReport).toMatchObject({ state: 'ready', coverage: { transcripts: 1, documents: 1 } });
  expect(response.body.data.canGenerateAIReport).toBe(false);
  expect(JSON.stringify(response.body.data)).not.toContain('leaseToken');
  expect((await Appraisal.findById(appraisal._id)).finalRating.overall).toBe(4);
});

test('late transcripts invalidate reports and provider failures are visible, bounded and retryable', async () => {
  const { appraisal, meeting } = await fixture('completed');
  await reports.queue(appraisal, identity); await reports.processDue();
  expect((await reports.view(appraisal)).coverage.missingTranscripts).toEqual(['Evidence call']);
  await api('post', `/${appraisal._id}/meetings/${meeting._id}/transcript`).send({ content: 'Transcript added after Nylas did not deliver.' }).expect(200);
  expect((await reports.view(appraisal)).state).toBe('pending');
  ai.getChatCompletions.mockRejectedValue(Object.assign(new Error('private provider diagnostic'), { code: 'SHARED_AI_REAUTH_REQUIRED' }));
  await reports.processDue();
  expect((await reports.view(appraisal))).toMatchObject({ state: 'failed', errorCode: 'SHARED_AI_REAUTH_REQUIRED' });
  expect((await reports.view(appraisal)).content).toBeUndefined();
  await reports.processDue(); expect(ai.getChatCompletions).toHaveBeenCalledTimes(2);
  ai.getChatCompletions.mockResolvedValue({ choices: [{ message: { content: 'Recovered report' } }] });
  await api('post', `/${appraisal._id}/report/ai`).send({}).expect(202);
  await reports.processDue(); expect((await reports.view(appraisal)).content).toBe('Recovered report');
});

test('source revocation during report generation prevents publishing the old transcript', async () => {
  const { appraisal, meeting } = await fixture('completed');
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { transcript: { source: 'nylas', content: 'Withdrawn private source', status: 'ready' } } });
  await reports.queue(appraisal, identity);
  ai.getChatCompletions.mockImplementation(async () => {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingConsent.revokedAt': new Date() } });
    return { choices: [{ message: { content: 'Potentially stale provider result' } }] };
  });
  await reports.processDue();
  const job = await Job.findOne({ appraisalId: appraisal._id });
  // A second pass may finish using only the currently authorized notes.
  expect(ai.getChatCompletions.mock.calls.at(-1)[0][1].content).not.toContain('Withdrawn private source');
  expect(job.sourceHash).toBe((await reports.evidence(appraisal)).sourceHash);
});

test('finalization durably queues the AI report without making the provider part of the human decision', async () => {
  const { appraisal } = await fixture('final_review_pending');
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { 'cycleConfigurationSnapshot.appraisalFlow': { version: 1, assessmentMode: 'form', steps: [{ id: 'outcome', type: 'finalReview', label: 'Final outcome' }] } } });
  const response = await api('post', `/${appraisal._id}/finalize`).send({ finalRating: 4, justification: 'The submitted evidence supports this outcome.' }).expect(200);
  expect(['completed', 'employee_acknowledged']).toContain(response.body.data.status);
  expect((await Job.findOne({ appraisalId: appraisal._id }).select('+identity')).identity.sub).toBe('reviewer');
});
