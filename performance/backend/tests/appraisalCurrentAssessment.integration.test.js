'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const User = require('../models/User');
const Job = require('../models/AppraisalCurrentAssessment');
const shared = require('../services/sharedAIAccountService');
const ai = require('../services/aiGatewayService');
const evidence = require('../services/appraisalAnalysisEvidenceService');
const service = require('../services/appraisalCurrentAssessmentService');
const auth = require('../services/competency/authorizationService');
const org = { id: 'current-assessment-org', name: 'Current assessment QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
const identity = { sub: 'reviewer', email: 'reviewer@example.test', organizationId: org.id };
const actor = who => ({ id: who, sub: who, name: who, email: `${who}@example.test`, organizations: [{ ...org, ...(who === 'foreign' ? { id: 'foreign-org', role: 'owner' } : {}) }],
  currentOrganization: { ...org, ...(who === 'foreign' ? { id: 'foreign-org', role: 'owner' } : {}) }, idpTeams: [{ id: who === 'outsider' ? 'other-team' : 'team', name: 'Team', organizationId: org.id, role: who === 'reviewer' ? 'line_manager' : 'member', directReports: who === 'reviewer' ? ['employee'] : [] }] });
let mongo, app, appraisal, cv, teamGoal;
const api = (method, who = 'reviewer') => request(app)[method](`/api/appraisals/${appraisal._id}/current-assessment`).set('x-actor', who);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => {
    const who = req.get('x-actor') || 'reviewer';
    if (who !== 'anonymous') { const user = actor(who); req.session = { user, currentOrganizationId: user.currentOrganization.id }; req.directReports = who === 'reviewer' ? ['employee'] : []; }
    next();
  }); app.use('/api/appraisals', require('../routes/appraisals'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); await Job.createIndexes();
  for (const who of ['reviewer', 'employee', 'outsider']) await User.create({ idpSub: who, email: actor(who).email, profile: { displayName: who }, currentOrganizationId: org.id, idpTeams: actor(who).idpTeams });
  const cycle = await Cycle.create({ organizationId: org.id, name: 'Developing review', periodStart: '2026-01-01', periodEnd: '2026-03-31', createdBy: { userId: 'reviewer' } });
  appraisal = await Appraisal.create({ organizationId: org.id, cycleId: cycle._id, status: 'self_assessment_in_progress', employee: { userId: 'employee', name: 'Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Reviewer', email: identity.email },
    selfAssessment: { overallSummary: { achievements: 'EMPLOYEE SAVED REFLECTION' } }, managerReview: { overallSummary: { strengths: 'MANAGER DRAFT JUDGMENT' } },
    chatThread: [{ sender: { userId: 'employee', role: 'employee', name: 'Employee' }, message: 'AI DISCUSSION CUSTOMER EXAMPLE', messageType: 'text', phase: 'achievements' }] });
  const period = await require('../models/GoalPeriod').create({ organizationId: org.id, name: 'Q1 2026', code: 'q1-2026', type: 'custom', startDate: '2026-01-01', endDate: '2026-03-31' });
  const OKR = require('../models/OKR');
  teamGoal = await OKR.create({ organizationId: org.id, ownerId: 'reviewer', type: 'team', title: 'TEAM RELIABLE RELEASES', period: '2026-Q1', periodId: period._id, teamHierarchy: { teamId: 'team' }, status: 'active' });
  await OKR.create({ organizationId: org.id, ownerId: 'employee', type: 'individual', title: 'INDIVIDUAL CUSTOMER PORTAL', period: '2026-Q1', periodId: period._id, alignment: { parentOKRId: teamGoal._id }, status: 'active' });
  await OKR.create({ organizationId: org.id, ownerId: 'outsider', type: 'team', title: 'UNRELATED TEAM PRIVATE SENTINEL', period: '2026-Q1', periodId: period._id, teamHierarchy: { teamId: 'other-team' }, status: 'active' });
  const role = await require('../models/CompetencyAssessment').create({ organizationId: org.id, cycleId: String(new mongoose.Types.ObjectId()), appraisalId: String(appraisal._id), participant: { userId: 'employee' }, assessorIds: ['reviewer'], definitionSnapshot: { role: { name: 'Engineer' }, criteria: [] }, status: 'in_progress' });
  cv = await require('../models/CompetencyEvidence').create({ organizationId: org.id, assessmentId: String(role._id), participantId: 'employee', documentType: 'cv', kind: 'file', visibility: 'participant', originalName: 'employee-cv.txt', text: 'CV CLAIM: THREE YEARS PLATFORM DELIVERY', status: 'ready', createdBy: { userId: 'employee' } });
  await require('../models/CompetencyEvidence').create({ organizationId: org.id, assessmentId: String(role._id), participantId: 'employee', kind: 'manual', visibility: 'assessors', title: 'Reviewer evidence', text: 'PRIVATE ASSESSOR SENTINEL', status: 'ready', createdBy: { userId: 'reviewer' } });
  const Document = require('../models/AppraisalDocument');
  for (const [visibility, text] of [['employee_manager', 'SHARED FILE EVIDENCE'], ['employee_only', 'PRIVATE EMPLOYEE FILE'], ['hr_only', 'PRIVATE HR FILE']]) {
    const doc = await Document.create({ organizationId: org.id, appraisalId: appraisal._id, originalName: `${visibility}.txt`, fileName: 'fixture.txt', fileType: 'txt', visibility, textExtraction: { status: 'completed', extractedText: text } });
    await Appraisal.updateOne({ _id: appraisal._id }, { $push: { documents: doc._id } });
    if (visibility === 'hr_only') await Appraisal.updateOne({ _id: appraisal._id }, { $push: { chatThread: { sender: { role: 'ai' }, message: 'PRIVATE HR FILE DERIVED CHAT', messageType: 'document_analysis', linkedDocumentId: doc._id } } });
  }
  await require('../models/OneOnOne').create({ organizationId: org.id, appraisalId: appraisal._id, managerId: 'reviewer', employeeId: 'employee', title: 'Customer review call', scheduledDate: new Date('2026-03-31'), status: 'completed',
    transcript: { source: 'manual_upload', status: 'ready', content: 'MEETING TRANSCRIPT: Customer signed off the portal.' }, sharedNotes: 'AGREED NOTES: Publish the handover.', appraisalMeeting: { mode: 'calendar' } });
  jest.spyOn(auth, 'context').mockImplementation(async req => ({ organizationId: org.id, actor: { userId: req.session.user.sub }, permissions: new Set(['competency.assessment.view', 'competency.evidence.view']), organizationWide: false,
    directory: { scope: 'managed_teams', members: [{ userId: 'employee', teamIds: ['team'] }, { userId: 'reviewer', teamIds: ['team'] }], reviewers: [{ userId: 'reviewer', eligibleTeamIds: ['team'] }] }, req }));
  jest.spyOn(shared, 'models').mockResolvedValue([{ id: 'gpt-6.1-sol', supportedReasoningEfforts: [{ reasoningEffort: 'max' }] }]);
  jest.spyOn(ai, 'getChatCompletions').mockImplementation(async (_messages, options) => ({ model: 'gpt-6.1-sol', choices: [{ message: { content: `Synthetic deep assessment for ${options.identity.sub}. Sources compared; human rating unchanged.` } }] }));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('current assessment reads and writes enforce appraisal scope, identity and organization', async () => {
  for (const [who, status] of [['outsider', 403], ['foreign', 404], ['anonymous', 401]]) {
    await api('get', who).expect(status); await api('post', who).send({ isHR: true, userId: 'reviewer', organizationId: org.id }).expect(status);
  }
  await api('post').send({ isHR: true, userId: 'employee' }).expect(202);
  const job = await Job.findOne({ appraisalId: appraisal._id }).select('+identity +profile');
  expect(job.userId).toBe('reviewer'); expect(job.identity.sub).toBe('reviewer'); expect(job.profile.isHR).toBe(false);
});

test('ongoing analysis includes CV, AI discussion, saved drafts, manager feedback, transcripts, notes and relevant team OKRs', async () => {
  await api('post').send({}).expect(202); await Promise.all([service.processDue(), service.processDue()]);
  expect(ai.getChatCompletions).toHaveBeenCalledTimes(1);
  const [messages, options] = ai.getChatCompletions.mock.calls[0];
  expect(options).toMatchObject({ identity, codexModel: 'gpt-6.1-sol', reasoningEffort: 'max', runtimePreference: 'chatgpt' });
  for (const source of ['CV CLAIM: THREE YEARS PLATFORM DELIVERY', 'AI DISCUSSION CUSTOMER EXAMPLE', 'MANAGER DRAFT JUDGMENT', 'EMPLOYEE SAVED REFLECTION', 'MEETING TRANSCRIPT', 'AGREED NOTES', 'TEAM RELIABLE RELEASES', 'INDIVIDUAL CUSTOMER PORTAL', 'SHARED FILE EVIDENCE']) expect(messages[1].content).toContain(source);
  expect(messages[1].content).not.toContain('UNRELATED TEAM PRIVATE SENTINEL'); expect(messages[1].content).not.toContain('PRIVATE HR FILE'); expect(messages[1].content).not.toContain('PRIVATE EMPLOYEE FILE');
  const response = await api('get').expect(200);
  expect(response.body.data).toMatchObject({ state: 'ready', model: 'gpt-6.1-sol', reasoningEffort: 'max', coverage: { counts: { cv: 1, aligned_okrs: 1, meetings: 1 } } });
  expect(response.body.data.history).toHaveLength(1);
});

test('each viewer has a personal assessment and employee views cannot expose manager drafts or assessor-private evidence', async () => {
  await api('post').send({}).expect(202); await service.processDue();
  const initial = await api('get', 'employee').expect(200); expect(initial.body.data.content).toBeUndefined();
  await api('post', 'employee').send({}).expect(202); await service.processDue();
  expect(ai.getChatCompletions.mock.calls.at(-1)[1].identity.sub).toBe('employee');
  const text = ai.getChatCompletions.mock.calls.at(-1)[0][1].content;
  expect(text).not.toContain('MANAGER DRAFT JUDGMENT'); expect(text).not.toContain('PRIVATE ASSESSOR SENTINEL'); expect(text).toContain('PRIVATE EMPLOYEE FILE');
  expect((await api('get', 'employee').expect(200)).body.data.content).toContain('for employee');
});

test('new evidence refreshes the assessment and history, unchanged evidence is reused, and deleted CV text is hidden immediately', async () => {
  await api('post').send({}).expect(202); await service.processDue();
  await Job.updateOne({ appraisalId: appraisal._id }, { $set: { nextCheckAt: new Date(0) } }); await service.processDue();
  expect(ai.getChatCompletions).toHaveBeenCalledTimes(1);
  await Appraisal.updateOne({ _id: appraisal._id }, { $push: { chatThread: { sender: { userId: 'employee', role: 'employee' }, message: 'NEW MEASURABLE OUTCOME', phase: 'achievements' } } });
  await require('../models/OKR').updateOne({ _id: teamGoal._id }, { $set: { progress: 85 } });
  await Job.updateOne({ appraisalId: appraisal._id }, { $set: { generatedAt: new Date(0), nextCheckAt: new Date(0) } }); await service.processDue();
  expect(ai.getChatCompletions).toHaveBeenCalledTimes(2); expect(ai.getChatCompletions.mock.calls[1][0][1].content).toContain('NEW MEASURABLE OUTCOME');
  expect((await api('get').expect(200)).body.data.history).toHaveLength(2);
  await require('../models/CompetencyEvidence').updateOne({ _id: cv._id }, { $set: { status: 'deleted', text: '' } });
  const changed = await api('get').expect(200); expect(changed.body.data.state).toBe('stale'); expect(changed.body.data.content).toBeUndefined();
});

test('pausing during an AI request fences its result and unavailable/newer models are never silently substituted', async () => {
  await api('post').send({}).expect(202);
  ai.getChatCompletions.mockImplementation(async () => { await service.pause(appraisal, identity); return { model: 'gpt-6.1-sol', choices: [{ message: { content: 'Must not publish after pause' } }] }; });
  await service.processDue(); expect((await api('get').expect(200)).body.data).toMatchObject({ state: 'paused', enabled: false });
  shared.models.mockResolvedValue([{ id: 'gpt-5.6-sol', supportedReasoningEfforts: ['max'] }]);
  await api('post').send({ force: true }).expect(202); await service.processDue();
  expect((await api('get').expect(200)).body.data.errorCode).toBe('ASSESSMENT_MODEL_UNAVAILABLE');
  shared.models.mockResolvedValue([{ id: 'gpt-6.1-sol', supportedReasoningEfforts: ['max'] }]);
  ai.getChatCompletions.mockResolvedValue({ model: 'gpt-5.6-terra', choices: [{ message: { content: 'Wrong model' } }] });
  await api('post').send({ force: true }).expect(202); await service.processDue();
  expect((await api('get').expect(200)).body.data.errorCode).toBe('ASSESSMENT_MODEL_MISMATCH');
});

test('appending discussion during generation publishes a labelled snapshot instead of starving the evolving assessment', async () => {
  await api('post').send({}).expect(202);
  ai.getChatCompletions.mockImplementationOnce(async () => {
    await Appraisal.updateOne({ _id: appraisal._id }, { $push: { chatThread: { sender: { role: 'employee' }, message: 'New answer while deep reasoning runs.', phase: 'achievements' } } });
    return { model: 'gpt-6.1-sol', choices: [{ message: { content: 'Completed snapshot of the earlier saved evidence.' } }] };
  });
  await service.processDue();
  const result = (await api('get').expect(200)).body.data;
  expect(result.content).toBe('Completed snapshot of the earlier saved evidence.');
  expect(result.isCurrent).toBe(false); expect(result.state).toBe('stale');
});
