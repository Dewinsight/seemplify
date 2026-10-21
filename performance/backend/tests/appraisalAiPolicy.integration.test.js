'use strict';
// Real appraisal routes/models and disposable Mongo. Provider and remote storage
// are explicit test stubs; no personal account or external service is contacted.
jest.mock('../services/storageService', () => ({ createStorageService: () => ({
  uploadBuffer: jest.fn(async () => ({ storageKey: 'synthetic-ai-policy-document', storageProvider: 'local' })),
  remove: jest.fn(async () => undefined)
}) }));
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const Document = require('../models/AppraisalDocument');
const User = require('../models/User');
const ai = require('../services/appraisalAIService');
const gateway = require('../services/aiGatewayService');
const { PerformanceAIRuntimeError } = gateway;
const designService = require('../services/appraisalCycleDesignService');
const flowService = require('../services/appraisalFlowService');
const routes = require('../routes/appraisals');
const ORG = 'ai-policy-org';
let mongo, app;
const person = name => {
  const organization = { id: name === 'foreign' ? 'other-org' : ORG, role: name === 'admin' ? 'owner' : 'employee', appAccess: { mode: 'all', appIds: [] } };
  return { id: name, sub: name, name: `Synthetic ${name}`, email: `${name}@example.test`, organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: name === 'outsider' ? 'outside' : 'team', name: 'Synthetic team', organizationId: organization.id, role: name === 'reviewer' ? 'line_manager' : 'member' }] };
};
const call = (method, url, actor = 'reviewer') => request(app)[method](`/api/appraisals${url}`).set('x-ai-policy-actor', actor);
async function createCycle(enabled = true) {
  return Cycle.create({ name: 'Synthetic live AI policy', organizationId: ORG, status: 'active', periodStart: '2020-01-01', periodEnd: '2020-03-31',
    createdBy: { userId: 'reviewer', name: 'Synthetic reviewer' }, settings: { enableAiAssist: enabled, requireOkrAlignment: false, allowSelfRating: true, enableChat: true },
    competencies: [{ id: 'delivery', name: 'Delivery', weight: 100 }], workflowDefinition: designService.cloneBuiltInTemplate('balanced_performance').design });
}
async function launch(cycle, employee = 'employee', assessmentMode = 'form') {
  const response = await call('post', `/cycles/${cycle._id}/launch`).send({ employees: [{ userId: employee }], reviewerMode: 'initiator',
    responseDeadlines: { selfAssessmentDue: '2099-01-01', managerReviewDue: '2099-01-10' },
    appraisalFlow: { assessmentMode, steps: ['selfAssessment', 'managerReview', 'finalReview'].map(type => ({ id: type, type, label: type })) } }).expect(200);
  expect(response.body.data.launched).toBe(1);
  return Appraisal.findOne({ cycleId: cycle._id, 'employee.userId': employee });
}
async function setLive(cycle, enabled) {
  return call('put', `/cycles/${cycle._id}`, 'admin').send({ settings: { enableAiAssist: enabled } }).expect(200);
}
const read = async (id, actor = 'reviewer') => (await call('get', `/${id}`, actor).expect(200)).body.data;
const rawSnapshot = async id => (await Appraisal.collection.findOne({ _id: id })).cycleConfigurationSnapshot;
function neverCompleteDocumentAnalysis() { return jest.spyOn(ai, 'analyzeDocument').mockImplementation(() => new Promise(() => {})); }
async function upload(id, assessmentMode) {
  const text = 'Synthetic work evidence for a fictional performance exercise. '.repeat(5);
  const pending = call('post', `/${id}/documents`, 'employee');
  if (assessmentMode) pending.field('assessmentMode', assessmentMode);
  return pending.attach('file', Buffer.from(text), { filename: 'synthetic-ai-policy.txt', contentType: 'text/plain' }).expect(201);
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = person(req.get('x-ai-policy-actor') || 'reviewer'); req.session = { user, currentOrganizationId: user.currentOrganization.id }; next(); });
  app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all([Appraisal.createIndexes(), Cycle.createIndexes()]);
  for (const actor of ['admin', 'reviewer', 'employee', 'peer', 'outsider', 'foreign']) {
    const user = person(actor); await User.create({ idpSub: user.sub, email: user.email, currentOrganizationId: user.currentOrganization.id, profile: { displayName: user.name }, idpTeams: user.idpTeams });
  }
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('manager assistance returns the data envelope and keeps human review fields unchanged', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const notes = { achievements: 'Delivered a fictional release.', strengths: 'Clear planning.' };
  const assistance = { success: true, overallSuggestion: 'Use the documented delivery evidence.', suggestedRating: 4, ratingJustification: 'Synthetic evidence only.' };
  const provider = jest.spyOn(ai, 'assistManagerReview').mockResolvedValue(assistance);
  const before = (await Appraisal.findById(appraisal._id)).toObject().managerReview;
  const response = await call('post', `/${appraisal._id}/ai-assist`).send({ managerNotes: notes }).expect(200);
  expect(response.body).toEqual({ success: true, data: assistance });
  expect(provider.mock.calls[0][1]).toEqual(notes);
  expect((await Appraisal.findById(appraisal._id)).toObject().managerReview).toEqual(before);
});

test('manager assistance preserves actionable gateway errors rather than returning an empty success', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  jest.spyOn(ai, 'assistManagerReview').mockRejectedValue(new PerformanceAIRuntimeError('AI is temporarily unavailable. Please retry.', 'AI_GATEWAY_UNAVAILABLE', 503));
  const response = await call('post', `/${appraisal._id}/ai-assist`).send({ managerNotes: {} }).expect(503);
  expect(response.body).toEqual({ success: false, error: 'AI is temporarily unavailable. Please retry.', code: 'AI_GATEWAY_UNAVAILABLE' });
});

test.each([[true, false], [false, true], [false, false], [true, true]])('AI policy combines frozen %s and current %s without rewriting any snapshot', async (frozen, live) => {
  const cycle = await createCycle(frozen), appraisal = await launch(cycle), original = await rawSnapshot(appraisal._id);
  await setLive(cycle, live);
  const detail = await read(appraisal._id);
  expect(detail.cycleId.settings.enableAiAssist).toBe(frozen && live);
  expect(detail.cycleConfigurationSnapshot).toEqual(JSON.parse(JSON.stringify(original)));
  const { enableAiAssist: _ignored, ...settings } = detail.cycleId.settings;
  const { enableAiAssist: _original, ...frozenSettings } = original.settings;
  expect(settings).toEqual(frozenSettings);
  expect(detail.cycleId.workflowDefinition).toEqual(JSON.parse(JSON.stringify(original.workflowDefinition)));
  const provider = jest.spyOn(ai, 'assistManagerReview').mockResolvedValue({ overallSuggestion: 'Explicit synthetic provider fixture.' });
  await call('post', `/${appraisal._id}/ai-assist`).send({ managerNotes: 'Synthetic review notes.' }).expect(frozen && live ? 200 : 400);
  expect(provider).toHaveBeenCalledTimes(frozen && live ? 1 : 0);
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
  expect((await Cycle.findById(cycle._id)).settings.enableAiAssist).toBe(live);
});

test('different appraisals in the same live cycle retain their independent frozen AI veto', async () => {
  const cycle = await createCycle(false), first = await launch(cycle);
  await setLive(cycle, true); const second = await launch(cycle, 'peer');
  const records = await Appraisal.find({ cycleId: cycle._id }).populate('cycleId').sort({ createdAt: 1 });
  expect(records.find(row => String(row._id) === String(first._id)).cycleId.settings.enableAiAssist).toBe(false);
  expect(records.find(row => String(row._id) === String(second._id)).cycleId.settings.enableAiAssist).toBe(true);
  const on = records.find(row => String(row._id) === String(second._id)); flowService.applySnapshot(on);
  expect(on.cycleId.settings.enableAiAssist).toBe(true);
  await setLive(cycle, false);
  expect((await read(first._id)).cycleId.settings.enableAiAssist).toBe(false);
  expect((await read(second._id)).cycleId.settings.enableAiAssist).toBe(false);
  expect((await rawSnapshot(first._id)).settings.enableAiAssist).toBe(false);
  expect((await rawSnapshot(second._id)).settings.enableAiAssist).toBe(true);
});

test.each([true, false])('legacy appraisal without a snapshot retains live AI setting %s', async live => {
  const cycle = await createCycle(live);
  const appraisal = await Appraisal.create({ cycleId: cycle._id, organizationId: ORG, employee: { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.test' }, status: 'self_assessment_pending' });
  const provider = jest.spyOn(ai, 'assistManagerReview').mockResolvedValue({ overallSuggestion: 'Explicit synthetic provider fixture.' });
  expect((await read(appraisal._id)).cycleId.settings.enableAiAssist).toBe(live);
  await call('post', `/${appraisal._id}/ai-assist`).send({}).expect(live ? 200 : 400);
  expect(provider).toHaveBeenCalledTimes(live ? 1 : 0);
});

test.each([[true, false], [false, true], [true, true]])('ordinary manual upload uses raw-record AI policy frozen=%s/current=%s', async (frozen, live) => {
  const cycle = await createCycle(frozen), appraisal = await launch(cycle), original = await rawSnapshot(appraisal._id);
  await setLive(cycle, live); const provider = neverCompleteDocumentAnalysis();
  const uploaded = await upload(appraisal._id);
  expect(provider).toHaveBeenCalledTimes(frozen && live ? 1 : 0);
  const document = await Document.findById(uploaded.body.data._id).lean();
  expect(document.textExtraction.status).toBe('completed'); expect(document.textExtraction.extractedText).toContain('Synthetic work evidence');
  expect(document.aiAnalysis.status).toBe(frozen && live ? 'processing' : 'skipped');
  if (!(frozen && live)) {
    expect(document.aiAnalysis.analyzedAt).toBeUndefined();
    expect(document.aiAnalysis.summary).toBeUndefined();
    expect(document.aiAnalysis.keyPoints).toEqual([]);
    expect(document.aiAnalysis.extractedAchievements).toEqual([]);
  }
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toContain(String(document._id));
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
});

test('explicit manual document upload retains extracted evidence and frozen cycle policy without dispatching optional AI', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle, 'employee', 'conversation'), original = await rawSnapshot(appraisal._id);
  const provider = neverCompleteDocumentAnalysis();
  const uploaded = await upload(appraisal._id, 'form');
  const stored = await Document.findById(uploaded.body.data._id).lean();
  expect(stored.textExtraction.status).toBe('completed');
  expect(stored.textExtraction.extractedText).toContain('Synthetic work evidence');
  expect(stored.aiAnalysis.status).toBe('skipped');
  expect(stored.aiAnalysis.analyzedAt).toBeUndefined();
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toContain(String(stored._id));
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
  expect(provider).not.toHaveBeenCalled();
});

test('turning live AI off denies scoped provider endpoints and conversation while keeping ordinary chat available', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle, 'employee', 'conversation'); await setLive(cycle, false);
  const methods = ['assistManagerReview', 'checkForBias', 'generateAISuggestedRating', 'startSelfAssessmentConversation', 'generateChatResponse'];
  const providers = methods.map(method => jest.spyOn(ai, method).mockResolvedValue({}));
  for (const suffix of ['ai-assist', 'check-bias', 'ai-rating-suggestion']) await call('post', `/${appraisal._id}/${suffix}`).send({}).expect(400);
  await call('post', `/${appraisal._id}/conversation/start`, 'employee').send({}).expect(400);
  const chat = await call('post', `/${appraisal._id}/chat`, 'employee').send({ message: 'Synthetic ordinary discussion without AI.', requestAI: true }).expect(200);
  expect(chat.body.data.some(row => row.message === 'Synthetic ordinary discussion without AI.')).toBe(true);
  expect(chat.body.data.some(row => row.message === 'AI assistance is disabled for this appraisal cycle.')).toBe(true);
  for (const provider of providers) expect(provider).not.toHaveBeenCalled();
});

test('AI policy changes never weaken employee, reviewer or tenant authorization', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle); await setLive(cycle, false);
  const provider = jest.spyOn(ai, 'assistManagerReview').mockResolvedValue({});
  await call('post', `/${appraisal._id}/ai-assist`, 'employee').send({}).expect(403);
  await call('post', `/${appraisal._id}/ai-assist`, 'outsider').send({}).expect(403);
  await call('post', `/${appraisal._id}/ai-assist`, 'foreign').send({}).expect(404);
  expect(provider).not.toHaveBeenCalled();
});

test('invalid rating advice returns an actionable failure and creates no advisory outcome', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  jest.spyOn(ai, 'generateAISuggestedRating').mockRejectedValue(new PerformanceAIRuntimeError('The AI rating recommendation was incomplete.', 'AI_RESPONSE_INVALID', 502));
  const response = await call('post', `/${appraisal._id}/ai-rating-suggestion`).send({}).expect(502);
  expect(response.body).toMatchObject({ success: false, code: 'AI_RESPONSE_INVALID', error: 'The AI rating recommendation was incomplete.' });
  const saved = await Appraisal.findById(appraisal._id);
  expect(saved.aiSuggestionReviews).toHaveLength(0);
  expect(saved.finalRating?.overall).toBeUndefined();
});

test('live AI off changes no frozen questions, evidence requirements, self-rating or scoring settings', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle), original = await rawSnapshot(appraisal._id);
  const changedDesign = JSON.parse(JSON.stringify(cycle.workflowDefinition)); changedDesign.sections[0].title = 'Changed live title after launch';
  // Existing design immutability still rejects editing questions after launch.
  await call('put', `/cycles/${cycle._id}`, 'admin').send({ workflowDefinition: changedDesign }).expect(409);
  await call('put', `/cycles/${cycle._id}`, 'admin').send({ settings: { enableAiAssist: false, allowSelfRating: false, requireDocumentUpload: true } }).expect(200);
  const detail = await read(appraisal._id), model = await Appraisal.findById(appraisal._id).populate('cycleId');
  expect(detail.cycleId.settings.enableAiAssist).toBe(false); expect(model.cycleId.settings.enableAiAssist).toBe(false);
  expect(detail.cycleId.settings.allowSelfRating).toBe(true); expect(model.cycleId.settings.allowSelfRating).toBe(true);
  expect(detail.cycleId.settings.requireDocumentUpload).toBe(false); expect(model.cycleId.settings.requireDocumentUpload).toBe(false);
  expect(detail.cycleId.workflowDefinition).toEqual(JSON.parse(JSON.stringify(original.workflowDefinition)));
  expect(model.cycleId.workflowDefinition).toEqual(original.workflowDefinition);
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
  const live = await Cycle.findById(cycle._id); expect(live.settings.requireDocumentUpload).toBe(true);
  expect(live.workflowDefinition).toEqual(cycle.workflowDefinition);
});

test('a launched appraisal still completes both required manual forms and human finalization after live AI is disabled', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle), original = await rawSnapshot(appraisal._id);
  await setLive(cycle, false);
  const providers = ['analyzeSelfAssessment', 'checkForBias', 'suggestDevelopmentPlan'].map(method => jest.spyOn(ai, method).mockResolvedValue({}));
  for (const [actor, respondent] of [['employee', 'employee'], ['reviewer', 'manager']]) {
    const responses = original.workflowDefinition.sections.filter(section => [respondent, 'both'].includes(section.respondent)).flatMap(section => section.questions.map(question => ({
      sectionId: section.id, questionId: question.id,
      value: ['number', 'rating'].includes(question.responseType) ? 4 : question.responseType === 'boolean' ? true
        : question.responseType === 'multi_select' ? [question.options[0]?.value || question.options[0]]
          : question.responseType === 'single_select' ? question.options[0]?.value || question.options[0] : 'Synthetic evidence documents completed work and the next fictional development step.'
    })));
    await call('put', `/${appraisal._id}/custom-responses`, actor).send({ respondentRole: respondent, submit: true, responses }).expect(200);
    if (actor === 'employee') await call('post', `/${appraisal._id}/self-assessment`, actor).send({ submit: true, selfAssessment: {
      overallSelfRating: 4, overallSummary: { achievements: 'Delivered the synthetic project with clearly documented evidence.', challenges: 'Resolved an invented dependency through early planning.', learnings: 'Applied a structured approach to fictional delivery.', improvements: 'Improve the next fictional handover with a checklist.', goals: 'Practice the next synthetic capability with measured evidence.' }
    } }).expect(200);
    else await call('post', `/${appraisal._id}/manager-review`, actor).send({ submit: true, managerReview: {
      overallManagerRating: 4, competencyRatings: [{ competencyId: 'delivery', competencyName: 'Delivery', managerRating: 4, managerComments: 'Synthetic evidence supports the human rating.' }],
      overallSummary: { achievements: 'Completed fictional deliverables.', strengths: 'Clear structured delivery.', improvements: 'Practice the next synthetic capability.', recommendations: 'Continue the fictional exercise.' }
    } }).expect(200);
  }
  const final = await call('post', `/${appraisal._id}/finalize`).send({ finalRating: 4, justification: 'Human review of synthetic evidence supports this fictional outcome.' }).expect(200);
  expect(final.body.data.finalRating.overall).toBe(4);
  expect((await Appraisal.findById(appraisal._id)).customResponses.filter(row => row.submittedAt).length).toBeGreaterThan(0);
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
  for (const provider of providers) expect(provider).not.toHaveBeenCalled();
});

const manualAssessment = () => ({ overallSelfRating: 4, overallSummary: {
  achievements: 'Delivered the synthetic project with clearly documented evidence.',
  challenges: 'Resolved an invented dependency through early planning.',
  learnings: 'Applied a structured approach to fictional delivery.',
  improvements: 'Improve the next fictional handover with a checklist.',
  goals: 'Practice the next synthetic capability with measured evidence.'
} });

test.each([undefined, null, '', 0])('an unrated partial manual draft (%s) saves without manufacturing overall or competency ratings', async placeholder => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const provider = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  const selfAssessment = { overallSummary: { achievements: 'A retained partial achievement before choosing ratings.' },
    overallSelfRating: placeholder, competencyRatings: [{ competencyId: 'delivery', competencyName: 'Delivery', selfRating: placeholder, selfComments: 'Partial notes.' }] };
  await call('post', `/${appraisal._id}/self-assessment`, 'employee')
    .send({ assessmentMode: 'form', submit: false, selfAssessment }).expect(200);
  const persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.status).toBe('self_assessment_in_progress');
  expect(persisted.selfAssessment.overallSummary.achievements).toBe(selfAssessment.overallSummary.achievements);
  expect(persisted.selfAssessment.lastSavedAt).toBeInstanceOf(Date);
  expect(persisted.selfAssessment.submittedAt).toBeUndefined();
  expect(persisted.selfAssessment.overallSelfRating).toBeUndefined();
  expect(persisted.selfAssessment.competencyRatings[0].selfRating).toBeUndefined();
  const reloaded = await read(appraisal._id, 'employee');
  expect(reloaded.selfAssessment.overallSelfRating).toBeUndefined();
  expect(reloaded.selfAssessment.overallSummary.achievements).toBe(selfAssessment.overallSummary.achievements);
  expect(provider).not.toHaveBeenCalled();
});

test.each([undefined, null, '', 0, -1, 6, 'invalid'])('enabled self rating cannot submit an absent or invalid human overall rating (%s)', async rating => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await answerEmployeeQuestions(appraisal);
  const before = await Appraisal.collection.findOne({ _id: appraisal._id });
  const provider = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  const response = await call('post', `/${appraisal._id}/self-assessment`, 'employee')
    .send({ assessmentMode: 'form', submit: true, selfAssessment: { ...manualAssessment(), overallSelfRating: rating } }).expect(400);
  expect(response.body.error).toMatch(/rating/i);
  expect(await Appraisal.collection.findOne({ _id: appraisal._id })).toEqual(before);
  expect(provider).not.toHaveBeenCalled();
});

test('an explicitly configured zero remains a real human rating on draft and submission', async () => {
  const cycle = await createCycle(true);
  cycle.ratingScale.min = 0; await cycle.save();
  const appraisal = await launch(cycle);
  const selfAssessment = { ...manualAssessment(), overallSelfRating: 0,
    competencyRatings: [{ competencyId: 'delivery', competencyName: 'Delivery', selfRating: 0 }] };
  await call('post', `/${appraisal._id}/self-assessment`, 'employee').send({ assessmentMode: 'form', submit: false, selfAssessment }).expect(200);
  await Cycle.updateOne({ _id: cycle._id }, { $set: { 'ratingScale.min': 1 } });
  await answerEmployeeQuestions(appraisal);
  await call('post', `/${appraisal._id}/self-assessment`, 'employee').send({ assessmentMode: 'form', submit: true, selfAssessment }).expect(200);
  const persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.selfAssessment.overallSelfRating).toBe(0);
  expect(persisted.selfAssessment.competencyRatings[0].selfRating).toBe(0);
  expect(persisted.status).toBe('manager_review_pending');
});

test.each([undefined, null, '', 0])('reviewer partial draft (%s) does not fabricate an overall or competency rating', async placeholder => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  const provider = jest.spyOn(ai, 'checkForBias').mockResolvedValue({});
  await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: false,
    managerReview: { overallSummary: { strengths: 'A partial retained reviewer note.' }, overallManagerRating: placeholder,
      competencyRatings: [{ competencyId: 'delivery', managerRating: placeholder }] } }).expect(200);
  const persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.managerReview.overallSummary.strengths).toBe('A partial retained reviewer note.');
  expect(persisted.managerReview.overallManagerRating).toBeUndefined();
  expect(persisted.managerReview.competencyRatings[0].managerRating).toBeUndefined();
  expect(persisted.managerReview.competencyRatings[0].gapFromSelf).toBeNull();
  expect(persisted.managerReview.submittedAt).toBeUndefined();
  expect((await read(appraisal._id)).managerReview.overallManagerRating).toBeUndefined();
  expect(provider).not.toHaveBeenCalled();
});

test.each([undefined, null, '', 0, -1, 6, 'invalid'])('reviewer submission rejects absent or invalid human overall rating (%s) without writes', async rating => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  await answerEmployeeQuestions(appraisal, 'manager');
  const before = await Appraisal.collection.findOne({ _id: appraisal._id });
  const provider = jest.spyOn(ai, 'checkForBias').mockResolvedValue({});
  const response = await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: true,
    managerReview: { overallManagerRating: rating } }).expect(400);
  expect(response.body.error).toMatch(/rating/i);
  expect(await Appraisal.collection.findOne({ _id: appraisal._id })).toEqual(before);
  expect(provider).not.toHaveBeenCalled();
});

test('reviewer explicit zero is retained when the frozen scale allows zero', async () => {
  const cycle = await createCycle(true); cycle.ratingScale.min = 0; await cycle.save();
  const appraisal = await launch(cycle);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  const managerReview = { overallManagerRating: 0, competencyRatings: [{ competencyId: 'delivery', managerRating: 0 }] };
  await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: false, managerReview }).expect(200);
  await Cycle.updateOne({ _id: cycle._id }, { $set: { 'ratingScale.min': 1 } });
  await answerEmployeeQuestions(appraisal, 'manager');
  await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: true, managerReview }).expect(200);
  const persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.managerReview.overallManagerRating).toBe(0);
  expect(persisted.managerReview.competencyRatings[0].managerRating).toBe(0);
  expect(persisted.managerReview.submittedAt).toBeInstanceOf(Date);
});

test.each(['employee', 'reviewer'])('invalid %s draft rating returns an actionable error without changing a prior human score', async actor => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const manager = actor === 'reviewer';
  if (manager) await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  const endpoint = manager ? 'manager-review' : 'self-assessment';
  const section = manager ? 'managerReview' : 'selfAssessment';
  const ratingField = manager ? 'overallManagerRating' : 'overallSelfRating';
  await call('post', `/${appraisal._id}/${endpoint}`, actor).send({ assessmentMode: 'form', submit: false,
    [section]: { [ratingField]: 4 } }).expect(200);
  const before = await Appraisal.collection.findOne({ _id: appraisal._id });
  for (const invalid of [-1, 6, 'invalid', false]) {
    const response = await call('post', `/${appraisal._id}/${endpoint}`, actor).send({ assessmentMode: 'form', submit: false,
      [section]: { [ratingField]: invalid } }).expect(400);
    expect(response.body.error).toMatch(/rating.*1.*5/i);
    expect(await Appraisal.collection.findOne({ _id: appraisal._id })).toEqual(before);
  }
});

test('reviewer partial draft omission preserves an existing human score but explicit clearing stays unrated', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date(), 'managerReview.overallManagerRating': 4 } });
  await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: false,
    managerReview: { overallSummary: { strengths: 'Partial note preserves a score already selected by the reviewer.' } } }).expect(200);
  expect((await Appraisal.findById(appraisal._id)).managerReview.overallManagerRating).toBe(4);
  await call('post', `/${appraisal._id}/manager-review`).send({ assessmentMode: 'form', submit: false,
    managerReview: { overallManagerRating: null } }).expect(200);
  expect((await Appraisal.findById(appraisal._id)).managerReview.overallManagerRating).toBeUndefined();
});
async function answerEmployeeQuestions(appraisal, respondent = 'employee') {
  const snapshot = await rawSnapshot(appraisal._id);
  const responses = snapshot.workflowDefinition.sections.filter(section => [respondent, 'both'].includes(section.respondent))
    .flatMap(section => section.questions.map(question => ({ sectionId: section.id, questionId: question.id,
      value: ['number', 'rating'].includes(question.responseType) ? 4 : question.responseType === 'boolean' ? true
        : question.responseType === 'multi_select' ? [question.options[0]?.value || question.options[0]]
          : question.responseType === 'single_select' ? question.options[0]?.value || question.options[0]
            : 'Synthetic evidence documents completed work and the next fictional development step.' })));
  await call('put', `/${appraisal._id}/custom-responses`, respondent === 'manager' ? 'reviewer' : 'employee')
    .send({ respondentRole: respondent, submit: true, responses }).expect(200);
}

test('explicit form mode saves drafts and submits without optional AI while preserving questions, ratings and manager handoff', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle), original = await rawSnapshot(appraisal._id);
  const provider = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({ summary: 'Must not be generated for manual form mode.' });
  const payload = { assessmentMode: 'form', selfAssessment: manualAssessment() };
  await call('post', `/${appraisal._id}/self-assessment`, 'employee').send({ ...payload, submit: false }).expect(200);
  let persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.status).toBe('self_assessment_in_progress');
  expect(persisted.selfAssessment.overallSummary.achievements).toBe(payload.selfAssessment.overallSummary.achievements);
  expect(persisted.selfAssessment.submittedAt).toBeUndefined();
  const missing = await call('post', `/${appraisal._id}/self-assessment`, 'employee').send({ ...payload, submit: true }).expect(400);
  expect(missing.body.missingQuestions.length).toBeGreaterThan(0);
  await answerEmployeeQuestions(appraisal);
  const incomplete = await call('post', `/${appraisal._id}/self-assessment`, 'employee')
    .send({ ...payload, selfAssessment: { overallSummary: {} }, submit: true }).expect(400);
  expect(incomplete.body.missingSections.length).toBeGreaterThan(0);
  await call('post', `/${appraisal._id}/self-assessment`, 'employee').send({ ...payload, submit: true }).expect(200);
  persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.status).toBe('manager_review_pending');
  expect(persisted.selfAssessment.overallSelfRating).toBe(4);
  expect(persisted.selfAssessment.submittedAt).toBeInstanceOf(Date);
  expect(persisted.selfAssessment.aiInsights?.generatedAt).toBeUndefined();
  expect(persisted.manager.userId).toBe('reviewer');
  expect(persisted.notifications.some(row => row.type === 'self_assessment_submitted' && row.message.includes('ready for your review'))).toBe(true);
  expect(await rawSnapshot(appraisal._id)).toEqual(original);
  expect(provider).not.toHaveBeenCalled();
});

test('manual mode never bypasses employee or tenant authorization and rejected requests never invoke AI', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const provider = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  for (const [actor, status] of [['reviewer', 403], ['outsider', 403], ['foreign', 404]]) {
    await call('post', `/${appraisal._id}/self-assessment`, actor)
      .send({ assessmentMode: 'form', submit: true, selfAssessment: manualAssessment() }).expect(status);
  }
  expect((await Appraisal.findById(appraisal._id)).selfAssessment.submittedAt).toBeUndefined();
  expect(provider).not.toHaveBeenCalled();
});

test.each([undefined, 'conversation'])('non-manual mode %s retains optional AI analysis on valid submission', async assessmentMode => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await answerEmployeeQuestions(appraisal);
  const provider = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({ summary: 'Synthetic optional analysis.' });
  await call('post', `/${appraisal._id}/self-assessment`, 'employee')
    .send({ assessmentMode, submit: true, selfAssessment: manualAssessment() }).expect(200);
  expect(provider).toHaveBeenCalledTimes(1);
  expect((await Appraisal.findById(appraisal._id)).selfAssessment.aiInsights.generatedAt).toBeInstanceOf(Date);
});

test.each([
  ['AI_RUNTIME_ACCOUNT_REQUIRED', 409, 'Connect ChatGPT and complete the data-sharing step before using AI assistance.'],
  ['SHARED_AI_NOT_CONFIGURED', 503, 'The shared AI account service is not configured.'],
  ['AI_GATEWAY_UNAVAILABLE', 503, 'AI is temporarily unavailable. Retry later.'],
  ['AI_RESPONSE_INVALID', 502, 'Bias-review output was incomplete.']
])('explicit bias check preserves actionable %s failure and never changes the appraisal', async (code, status, message) => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const original = await Appraisal.findById(appraisal._id).lean();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const provider = jest.spyOn(gateway, 'getChatCompletions').mockRejectedValue(new PerformanceAIRuntimeError(message, code, status,
    { retryable: status === 503, retryAfterSeconds: status === 503 ? 30 : undefined, cause: new Error('PRIVATE_PROVIDER_CAUSE') }));
  const response = await call('post', `/${appraisal._id}/check-bias`).send({ managerReview: { overallManagerRating: 4 } }).expect(status);
  expect(response.body).toMatchObject({ success: false, code, error: message });
  if (status === 503) expect(response.body).toMatchObject({ retryable: true, retryAfterSeconds: 30 });
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE_PROVIDER_CAUSE');
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await Appraisal.findById(appraisal._id).lean()).toEqual(original);
});

test('explicit bias check rejects unauthorized and foreign readers before contacting AI', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  const provider = jest.spyOn(gateway, 'getChatCompletions').mockRejectedValue(new Error('Must not contact AI'));
  for (const [actor, status] of [['employee', 403], ['outsider', 403], ['foreign', 404]]) {
    await call('post', `/${appraisal._id}/check-bias`, actor).send({ managerReview: {} }).expect(status);
  }
  expect(provider).not.toHaveBeenCalled();
});

test('manual manager form saves and submits without implicit bias analysis while keeping required questions and authorization', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle), snapshot = await rawSnapshot(appraisal._id);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  const provider = jest.spyOn(ai, 'checkForBias').mockResolvedValue({ hasPotentialBias: false, overallRisk: 'low' });
  const payload = { assessmentMode: 'form', managerReview: { overallManagerRating: 4,
    competencyRatings: [{ competencyId: 'delivery', competencyName: 'Delivery', managerRating: 4, managerComments: 'Documented synthetic delivery.' }],
    overallSummary: { achievements: 'Completed fictional deliverables.', strengths: 'Clear structured delivery.',
      improvements: 'Practice the next synthetic capability.', recommendations: 'Continue the fictional exercise.' } } };
  for (const [actor, status] of [['employee', 403], ['outsider', 403], ['foreign', 404]]) {
    await call('post', `/${appraisal._id}/manager-review`, actor).send({ ...payload, submit: true }).expect(status);
  }
  await call('post', `/${appraisal._id}/manager-review`).send({ ...payload, submit: false }).expect(200);
  expect((await Appraisal.findById(appraisal._id)).status).toBe('manager_review_in_progress');
  const missing = await call('post', `/${appraisal._id}/manager-review`).send({ ...payload, submit: true }).expect(400);
  expect(missing.body.missingQuestions.length).toBeGreaterThan(0);
  await answerEmployeeQuestions(appraisal, 'manager');
  await call('post', `/${appraisal._id}/manager-review`).send({ ...payload, submit: true }).expect(200);
  const persisted = await Appraisal.findById(appraisal._id);
  expect(persisted.managerReview.submittedAt).toBeInstanceOf(Date);
  expect(persisted.managerReview.overallManagerRating).toBe(4);
  expect(persisted.status).not.toMatch(/manager_review_(pending|in_progress)/);
  expect(persisted.auditLog.some(row => row.action === 'manager_review_submitted')).toBe(true);
  expect(persisted.managerReview.aiAssist?.generatedAt).toBeUndefined();
  expect(await rawSnapshot(appraisal._id)).toEqual(snapshot);
  expect(provider).not.toHaveBeenCalled();
});

test.each([undefined, 'conversation'])('non-manual manager mode %s retains optional bias analysis on valid submission', async assessmentMode => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'manager_review_pending', 'selfAssessment.submittedAt': new Date() } });
  await answerEmployeeQuestions(appraisal, 'manager');
  const provider = jest.spyOn(ai, 'checkForBias').mockResolvedValue({ hasPotentialBias: false, overallRisk: 'low' });
  await call('post', `/${appraisal._id}/manager-review`)
    .send({ assessmentMode, submit: true, managerReview: { overallManagerRating: 4 } }).expect(200);
  expect(provider).toHaveBeenCalledTimes(1);
  expect((await Appraisal.findById(appraisal._id)).managerReview.aiAssist.generatedAt).toBeInstanceOf(Date);
});

test('unexpected explicit bias-check errors return a generic response without internal causes', async () => {
  const cycle = await createCycle(true), appraisal = await launch(cycle);
  jest.spyOn(ai, 'checkForBias').mockRejectedValue(new Error('PRIVATE_INTERNAL_FAILURE'));
  const response = await call('post', `/${appraisal._id}/check-bias`).send({ managerReview: {} }).expect(500);
  expect(response.body).toEqual({ success: false, code: 'AI_REQUEST_FAILED', error: 'Failed to check for bias' });
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE_INTERNAL_FAILURE');
});
