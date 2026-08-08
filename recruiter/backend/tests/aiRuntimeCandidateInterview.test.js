'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CANDIDATE_INTERVIEW_ACTIVITIES,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  createDefaultRuntimeSettings,
  isCandidateInterviewActivity,
  normalizeRuntimePolicy
} = require('../config/aiRuntimeCatalog');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

function runtimeWith({ candidateSubjects = new Map(), userSubjects = new Map() } = {}) {
  const runtime = new AIRuntimeService({
    fetchImpl: async () => ({ ok: true }),
    settingsModel: {},
    credentialModel: {},
    quotaModel: {},
    resolveSubject: async (actorId) => userSubjects.get(String(actorId)) || null,
    resolveInterviewSubject: async (sessionId) => candidateSubjects.get(String(sessionId)) || null
  });
  const settings = {
    ...createDefaultRuntimeSettings(),
    runtimePolicy: normalizeRuntimePolicy({ chatgptEnabled: true })
  };
  runtime.getSettings = async () => settings;
  return { runtime, settings };
}

const chatgptRoute = (activity) => ({ activity, provider: CHATGPT_PROVIDER, model: CHATGPT_MODEL });

test('a live interview turn is exactly the conversation the candidate owns', () => {
  // Question generation and CV parsing happen before any candidate is present,
  // so they belong to the recruiter rather than the interviewee.
  assert.deepEqual([...CANDIDATE_INTERVIEW_ACTIVITIES].sort(), [
    'ai_interview.chat.acknowledgement',
    'ai_interview.chat.clarification',
    'ai_interview.chat.introduction',
    'ai_interview.scoring'
  ]);
  assert.equal(isCandidateInterviewActivity('ai_interview.question_generation'), false);
  assert.equal(isCandidateInterviewActivity('ai_interview.cv_parse'), false);
  assert.equal(isCandidateInterviewActivity('assistant.chat'), false);
});

test('live interview turns run on the candidate\'s own connected account', async () => {
  const candidateSubjects = new Map([
    ['session-1', { subjectId: 'interview:session-1', subjectKey: 'k'.repeat(64), sourceApp: 'recruiter' }]
  ]);
  const { runtime, settings } = runtimeWith({ candidateSubjects });
  for (const activity of CANDIDATE_INTERVIEW_ACTIVITIES) {
    const route = await runtime.attachChatGptSubject(
      chatgptRoute(activity),
      { interviewSessionId: 'session-1' },
      settings
    );
    assert.equal(route.chatgptSubjectId, 'interview:session-1', activity);
    assert.equal(route.runtimeOwner, 'user', activity);
  }
});

test('an unconnected candidate is refused, never run on someone else\'s plan', async () => {
  const { runtime, settings } = runtimeWith({
    // A recruiter account exists and is routable — it must still not be used.
    userSubjects: new Map([['recruiter-1', { subjectId: 'recruiter-1', subjectKey: 'r'.repeat(64) }]])
  });
  for (const activity of CANDIDATE_INTERVIEW_ACTIVITIES) {
    await assert.rejects(
      runtime.attachChatGptSubject(
        chatgptRoute(activity),
        { interviewSessionId: 'session-without-account', actorId: 'recruiter-1' },
        settings
      ),
      (error) => {
        assert.equal(error.code, 'CHATGPT_CANDIDATE_ACCOUNT_REQUIRED', activity);
        assert.equal(error.statusCode, 409);
        return true;
      },
      `${activity} must refuse rather than substitute an account`
    );
  }
});

test('a live turn with no session at all is refused rather than attributed elsewhere', async () => {
  const { runtime, settings } = runtimeWith({
    userSubjects: new Map([['recruiter-1', { subjectId: 'recruiter-1', subjectKey: 'r'.repeat(64) }]])
  });
  await assert.rejects(
    runtime.attachChatGptSubject(
      chatgptRoute('ai_interview.chat.introduction'),
      { actorId: 'recruiter-1' },
      settings
    ),
    (error) => {
      assert.equal(error.code, 'CHATGPT_CANDIDATE_ACCOUNT_REQUIRED');
      return true;
    }
  );
});

test('interview setup work still runs on the recruiter who is doing it', async () => {
  const userSubjects = new Map([
    ['recruiter-1', { subjectId: 'recruiter-1', subjectKey: 'r'.repeat(64), sourceApp: 'recruiter' }]
  ]);
  const { runtime, settings } = runtimeWith({ userSubjects });
  const route = await runtime.attachChatGptSubject(
    chatgptRoute('ai_interview.question_generation'),
    { actorId: 'recruiter-1', interviewSessionId: 'session-1' },
    settings
  );
  assert.equal(route.chatgptSubjectId, 'recruiter-1');
});

test('a candidate subject is namespaced so it cannot collide with a user subject', () => {
  const { subjectIdForSession } = require('../services/aiRuntime/interviewCodexAccountService');
  assert.equal(subjectIdForSession('abc123'), 'interview:abc123');
  assert.notEqual(subjectIdForSession('abc123'), 'abc123');
  assert.throws(() => subjectIdForSession(''), /session/);
});
