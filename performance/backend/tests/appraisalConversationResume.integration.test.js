'use strict';

// Real HTTP routes and Mongo persistence; only the account/provider boundary is
// substituted. No employee records or external AI service are used.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const ai = require('../services/appraisalAIService');
const account = require('../services/chatGptAccountService');
const gateway = require('../services/aiGatewayService');

const org = 'conversation-resume-acceptance';
let app, mongo, appraisal;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const post = (suffix, body = {}, who = 'employee') => request(app)
  .post(`/api/appraisals/${appraisal._id}/conversation/${suffix}`)
  .set('x-resume-actor', who).send(body);
const context = (who = 'employee') => request(app)
  .get(`/api/appraisals/${appraisal._id}/conversation/context`).set('x-resume-actor', who);
const answer = value => ({ cycleResponse: { sectionId: 'reflection', questionId: 'impact', value } });

async function seed(daysAway = 100) {
  const then = new Date(Date.now() - daysAway * 86400000);
  const design = {
    version: 1,
    scoring: { goalsWeight: 100, competenciesWeight: 0 },
    stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, finalReview: { enabled: true } },
    sections: [{
      id: 'reflection', title: 'Reflection', type: 'custom', respondent: 'employee',
      required: true, scored: false, weight: 0,
      questions: [
        { id: 'impact', prompt: 'What outcome did you deliver?', responseType: 'long_text', required: true },
        { id: 'rating', prompt: 'Rate the outcome.', responseType: 'rating', required: true, ratingMin: 1, ratingMax: 5 }
      ]
    }]
  };
  const cycle = await Cycle.create({
    organizationId: org, name: 'Long-running employee review', status: 'active',
    periodStart: new Date(then.getTime() - 90 * 86400000), periodEnd: then,
    phases: { selfAssessment: { startDate: then, endDate: new Date(then.getTime() + 7 * 86400000), isActive: true } },
    settings: { enableAiAssist: true, requireOkrAlignment: false }, workflowDefinition: design
  });
  return Appraisal.create({
    organizationId: org, cycleId: cycle._id, status: 'self_assessment_in_progress',
    cycleConfigurationSnapshot: { version: 1, workflowDefinition: design, settings: cycle.settings, capturedAt: then },
    employee: { userId: 'employee', name: 'Fictional employee', email: 'employee@example.test' },
    manager: { userId: 'manager', name: 'Fictional manager', email: 'manager@example.test' },
    conversationAssessment: {
      mode: 'conversation', currentPhase: 'cycle_questions', startedAt: then, lastActivityAt: then,
      currentOkrIndex: 0, completedPhases: [], messageCount: 1,
      extractedData: { achievements: [], challenges: [], skills: [], goals: [] },
      cycleQuestionProgress: { currentIndex: 0, completedKeys: [], skippedKeys: [], startedAt: then }
    },
    chatThread: [{
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: 'What outcome did you deliver?', messageType: 'prompt', phase: 'cycle_questions',
      questionRef: { sectionId: 'reflection', questionId: 'impact' }, createdAt: then
    }]
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.get('x-resume-actor') || 'employee';
    const organizationId = who === 'foreign' ? 'foreign-org' : org;
    const organization = { id: organizationId, role: 'staff', appAccess: { mode: 'all', appIds: [] } };
    req.session = { currentOrganizationId: organizationId, user: {
      id: who, sub: who, name: `Fictional ${who}`, email: `${who}@example.test`,
      currentOrganization: organization, organizations: [organization],
      idpTeams: [{ id: 'resume-team', organizationId, role: 'member' }]
    } };
    next();
  });
  app.use('/api/appraisals', require('../routes/appraisals'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  appraisal = await seed();
  jest.spyOn(account, 'readAccount').mockResolvedValue({ isRoutable: () => true });
  jest.spyOn(gateway, 'policy').mockResolvedValue({ chatgptEnabled: true, localEnabled: false, defaultRuntime: 'chatgpt' });
  jest.spyOn(ai, 'acknowledgeCycleQuestionResponse').mockResolvedValue('Your answer is saved.');
  jest.spyOn(ai, 'startSelfAssessmentConversation').mockRejectedValue(new Error('A resumed conversation must not restart AI.'));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test.each([10, 100])('an unfinished question still resumes and accepts an answer after %i days without writes on resume', async days => {
  if (days !== 100) appraisal = await seed(days);
  const before = await Appraisal.findById(appraisal._id).lean();
  for (const response of [await context().expect(200), await post('start').expect(200), await context().expect(200)]) {
    expect(response.body.data.activeCycleQuestion.questionId).toBe('impact');
    expect(response.body.data.conversationState.currentPhase).toBe('cycle_questions');
    expect(response.body.data.conversationState.startedAt).toBe(before.conversationAssessment.startedAt.toISOString());
    expect(response.body.data.chatThread).toHaveLength(1);
  }
  const resumed = await Appraisal.findById(appraisal._id).lean();
  expect(resumed.__v).toBe(before.__v);
  expect(resumed.conversationAssessment.lastActivityAt).toEqual(before.conversationAssessment.lastActivityAt);
  expect(resumed.customResponses).toHaveLength(0);
  expect(ai.startSelfAssessmentConversation).not.toHaveBeenCalled();
  const saved = await post('message', answer('A delivery outcome after returning.')).expect(200);
  expect(saved.body.data.activeCycleQuestion.questionId).toBe('rating');
  expect(saved.body.data.cycleResponses[0].value).toBe('A delivery outcome after returning.');
  expect((await context().expect(200)).body.data.activeCycleQuestion.questionId).toBe('rating');
});

test('resume and context reads during a pending provider acknowledgement do not invalidate the pending answer', async () => {
  const entered = deferred(), release = deferred();
  ai.acknowledgeCycleQuestionResponse.mockImplementation(async () => { entered.resolve(); await release.promise; return 'Saved after reconnect.'; });
  const saving = post('message', answer('The delayed answer.')).then(result => result);
  try {
    await entered.promise;
    const before = await Appraisal.findById(appraisal._id).lean();
    const resumed = await post('start').expect(200);
    const read = await context().expect(200);
    expect(resumed.body.data.activeCycleQuestion.questionId).toBe('impact');
    expect(read.body.data.activeCycleQuestion.questionId).toBe('impact');
    expect((await Appraisal.findById(appraisal._id).lean()).__v).toBe(before.__v);
  } finally { release.resolve(); }
  const saved = await saving;
  expect(saved.status).toBe(200);
  expect(saved.body.data.activeCycleQuestion.questionId).toBe('rating');
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.customResponses).toHaveLength(1);
  expect(stored.customResponses[0].value).toBe('The delayed answer.');
  expect(stored.chatThread).toHaveLength(3);
});

test('lost-response retries are idempotent and stale edits return the latest snapshot without overwriting answers', async () => {
  await post('message', answer('Already saved outcome.')).expect(200);
  const replay = await post('message', answer('Already saved outcome.')).expect(200);
  expect(replay.body.data.idempotent).toBe(true);
  const stale = await post('message', answer('Unsent replacement must stay a draft.')).expect(409);
  expect(stale.body.code).toBe('CYCLE_QUESTION_STALE');
  expect(stale.body.error).not.toContain('Use the review form');
  expect(stale.body.data).toMatchObject({ currentPhase: 'cycle_questions', editable: true, appraisalStatus: 'self_assessment_in_progress', activeCycleQuestion: { questionId: 'rating' } });
  expect(stale.body.data.chatThread).toHaveLength(3);
  expect(stale.body.data.cycleResponses[0].value).toBe('Already saved outcome.');
  expect(stale.body.data.conversationState.currentPhase).toBe('cycle_questions');
  expect(ai.acknowledgeCycleQuestionResponse).toHaveBeenCalledTimes(1);
  await post('message', { cycleResponse: { sectionId: 'reflection', questionId: 'rating', value: 4 } }).expect(200);
  const finalStale = await post('message', answer('A later stale answer.')).expect(409);
  expect(finalStale.body.data.currentPhase).toBe('report_generation');
  expect(finalStale.body.data.activeCycleQuestion).toBeNull();
  expect(finalStale.body.data.conversationState.currentPhase).toBe('report_generation');
  expect(finalStale.body.data.cycleResponses).toHaveLength(2);
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.customResponses[0].value).toBe('Already saved outcome.');
  expect(stored.chatThread).toHaveLength(5);
});

test('two concurrent answers cannot overwrite one another and the losing request receives a recoverable cursor', async () => {
  const firstEntered = deferred(), secondEntered = deferred(), firstRelease = deferred(), secondRelease = deferred();
  let count = 0;
  ai.acknowledgeCycleQuestionResponse.mockImplementation(async () => {
    if (++count === 1) { firstEntered.resolve(); await firstRelease.promise; }
    else { secondEntered.resolve(); await secondRelease.promise; }
    return 'Saved.';
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const first = post('message', answer('Winning saved outcome.')).then(result => result);
  let second;
  try {
    await firstEntered.promise;
    second = post('message', answer('Losing unsent outcome.')).then(result => result);
    await secondEntered.promise;
    firstRelease.resolve();
    expect((await first).status).toBe(200);
  } finally { firstRelease.resolve(); secondRelease.resolve(); }
  const conflict = await second;
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('CONVERSATION_UPDATED');
  expect(conflict.body.data.activeCycleQuestion.questionId).toBe('rating');
  expect(conflict.body.data.cycleResponses[0].value).toBe('Winning saved outcome.');
  expect(conflict.body.data.chatThread).toHaveLength(3);
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.customResponses).toHaveLength(1);
  expect(stored.customResponses[0].value).toBe('Winning saved outcome.');
  expect(stored.chatThread).toHaveLength(3);
});

test('a provider outage leaves the current question and evidence untouched, and a later retry still succeeds', async () => {
  const before = await Appraisal.findById(appraisal._id).lean();
  ai.acknowledgeCycleQuestionResponse.mockRejectedValueOnce(new gateway.PerformanceAIRuntimeError('Fictional provider unavailable.', 'AI_GATEWAY_UNAVAILABLE'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await post('message', answer('Retain this answer until retry.')).expect(503);
  const failed = await Appraisal.findById(appraisal._id).lean();
  expect(failed.__v).toBe(before.__v);
  expect(failed.customResponses).toHaveLength(0);
  expect(failed.chatThread).toHaveLength(1);
  expect(failed.conversationAssessment.lastActivityAt).toEqual(before.conversationAssessment.lastActivityAt);
  expect((await context().expect(200)).body.data.activeCycleQuestion.questionId).toBe('impact');
  await post('message', answer('Retain this answer until retry.')).expect(200);
});

test('a concurrent manual clear returns a coherent question cursor from a stale review phase without another conflict save', async () => {
  const entered = deferred(), release = deferred();
  ai.acknowledgeCycleQuestionResponse.mockImplementation(async () => { entered.resolve(); await release.promise; return 'Saved.'; });
  jest.spyOn(ai, 'generateSelfAssessmentReport').mockResolvedValue({ overallSummary: { achievements: 'Fictional report draft.' }, missingInfo: [], tokensUsed: 1 });
  const pending = post('message', answer('This old in-flight answer must not replace a manual edit.')).then(result => result);
  let beforeConflict;
  try {
    await entered.promise;
    await request(app).put(`/api/appraisals/${appraisal._id}/custom-responses`).send({
      respondentRole: 'employee', responses: [
        { sectionId: 'reflection', questionId: 'impact', value: 'The newer manual answer.' },
        { sectionId: 'reflection', questionId: 'rating', value: 4 }
      ]
    }).expect(200);
    await post('generate-report').expect(200);
    await request(app).put(`/api/appraisals/${appraisal._id}/custom-responses`).send({
      respondentRole: 'employee', responses: [{ sectionId: 'reflection', questionId: 'impact', value: '' }]
    }).expect(200);
    beforeConflict = await Appraisal.findById(appraisal._id).lean();
    expect(beforeConflict.conversationAssessment.currentPhase).toBe('review');
  } finally { release.resolve(); }
  const conflict = await pending;
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('CONVERSATION_UPDATED');
  expect(conflict.body.data).toMatchObject({
    editable: true, currentPhase: 'cycle_questions',
    conversationState: { currentPhase: 'cycle_questions' },
    activeCycleQuestion: { questionId: 'impact' },
    cycleQuestionProgress: { completed: false, answered: 1 }
  });
  expect(conflict.body.data.cycleResponses).toEqual([expect.objectContaining({ questionId: 'rating', value: 4 })]);
  const unchanged = await Appraisal.findById(appraisal._id).lean();
  expect(unchanged.__v).toBe(beforeConflict.__v);
  expect(unchanged.conversationAssessment.currentPhase).toBe('review');
  expect(unchanged.customResponses).toHaveLength(1);
  // A subsequent normal resume persists the reconciled cursor once, and the
  // employee can continue without switching modes or re-entering other rows.
  const resumed = await context().expect(200);
  expect(resumed.body.data.conversationState.currentPhase).toBe('cycle_questions');
  expect(resumed.body.data.activeCycleQuestion.questionId).toBe('impact');
  await post('message', answer('The replacement answer explicitly sent after resuming.')).expect(200);
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.conversationAssessment.currentPhase).toBe('report_generation');
  expect(stored.customResponses).toEqual(expect.arrayContaining([
    expect.objectContaining({ questionId: 'impact', value: 'The replacement answer explicitly sent after resuming.' }),
    expect.objectContaining({ questionId: 'rating', value: 4 })
  ]));
});

test('a concurrent submission returns a noneditable snapshot and cannot be reopened by conflict normalization', async () => {
  const entered = deferred(), release = deferred();
  ai.acknowledgeCycleQuestionResponse.mockImplementation(async () => { entered.resolve(); await release.promise; return 'Saved.'; });
  const pending = post('message', answer('An obsolete in-flight answer.')).then(result => result);
  let submitted;
  try {
    await entered.promise;
    submitted = await Appraisal.findById(appraisal._id);
    submitted.status = 'manager_review_pending';
    submitted.selfAssessment.submittedAt = new Date();
    submitted.conversationAssessment.currentPhase = 'completed';
    await submitted.save();
  } finally { release.resolve(); }
  const conflict = await pending;
  expect(conflict.status).toBe(409);
  expect(conflict.body.data).toMatchObject({
    editable: false, appraisalStatus: 'manager_review_pending', currentPhase: 'completed',
    conversationState: { currentPhase: 'completed' }
  });
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.__v).toBe(submitted.__v);
  expect(stored.conversationAssessment.currentPhase).toBe('completed');
  expect(stored.customResponses).toHaveLength(0);
});

test('a future-question attempt returns the current snapshot and never skips or invents an answer', async () => {
  const result = await post('message', { cycleResponse: { sectionId: 'reflection', questionId: 'rating', value: 4 } }).expect(409);
  expect(result.body.data.activeCycleQuestion.questionId).toBe('impact');
  expect(result.body.data.conversationState.currentPhase).toBe('cycle_questions');
  expect(result.body.data.chatThread).toHaveLength(1);
  expect((await Appraisal.findById(appraisal._id)).customResponses).toHaveLength(0);
  expect(ai.acknowledgeCycleQuestionResponse).not.toHaveBeenCalled();
});

test.each([['foreign', 404], ['outsider', 403]])('resume and messages preserve %s access restrictions', async (who, status) => {
  await context(who).expect(status);
  await post('start', {}, who).expect(status);
  await post('message', answer('Forbidden answer.'), who).expect(status);
  expect(ai.acknowledgeCycleQuestionResponse).not.toHaveBeenCalled();
  expect((await Appraisal.findById(appraisal._id)).customResponses).toHaveLength(0);
});

test.each(['manager_review_pending', 'completed', 'employee_acknowledged'])('inactivity recovery cannot reopen a submitted or closed %s appraisal', async status => {
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status, 'selfAssessment.submittedAt': new Date(), 'conversationAssessment.currentPhase': 'review' } });
  expect((await context().expect(200)).body.data.conversationState.currentPhase).toBe('review');
  await post('start').expect(400);
  await post('message', answer('Must not reopen.')).expect(400);
  const stored = await Appraisal.findById(appraisal._id).lean();
  expect(stored.status).toBe(status);
  expect(stored.conversationAssessment.currentPhase).toBe('review');
  expect(stored.customResponses).toHaveLength(0);
  expect(ai.acknowledgeCycleQuestionResponse).not.toHaveBeenCalled();
});
