const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction,
  assessSpeechRendition,
  repairInstruction
} = require('../services/aiInterviewerResponseQuality');
const aiInterviewerService = require('../services/aiInterviewerService');

const question = 'A Kubernetes release doubles checkout latency. How would you diagnose the incident, decide whether to roll back, and validate recovery?';

test('live introduction quality preserves the selected question and candidate control', () => {
  const good = assessIntroduction(
    'Let us look at a production incident. A Kubernetes release doubles checkout latency: how would you diagnose the incident, decide whether to roll back, and validate recovery? You can ask for clarification or answer when ready.',
    question
  );
  assert.equal(good.passed, true);

  const generic = assessIntroduction('Tell me about yourself and why you want this role?', question);
  assert.equal(generic.passed, false);
  assert.match(repairInstruction('introduction', generic), /Preserve the concrete meaning/i);

  const shortQuestion = assessIntroduction(
    'Let us discuss React. Why React? You can ask for clarification or answer when ready.',
    'Why React?'
  );
  assert.equal(shortQuestion.passed, true);
});

test('live clarification quality rejects answer leakage and generic restatement', () => {
  const good = assessClarification(
    'A rollback threshold is the measurable signal that tells the team to reverse the Kubernetes release. In this question, explain which latency or error signal you would use and why.',
    { question, candidateMessage: 'What do you mean by rollback threshold?' }
  );
  assert.equal(good.passed, true);

  const leaked = assessClarification(
    'The ideal answer is to roll back immediately. You should say that the scoring criteria require latency below 200 milliseconds.',
    { question, candidateMessage: 'What do you mean by rollback threshold?' }
  );
  assert.equal(leaked.passed, false);
  assert.ok(leaked.issues.some((issue) => /reveal or supply/i.test(issue)));

  const broadRephrase = assessClarification(
    'Imagine the release has caused a serious production slowdown. Describe how you would investigate it, decide whether to undo the change, and confirm the service has recovered.',
    { question, candidateMessage: 'Can you rephrase that?' }
  );
  assert.equal(broadRephrase.passed, true);

  const broadExplanation = assessClarification(
    'The question presents a release that caused a production slowdown. Explain how you would investigate the cause, decide whether to reverse the release, and verify that the service recovered.',
    { question, candidateMessage: 'Can you explain that? Explain the question a bit more for me please.' }
  );
  assert.equal(broadExplanation.passed, true);
});

test('clarification model failures fall back without blocking the candidate turn', async (t) => {
  const originalComplete = aiInterviewerService.completeWithQualityGate;
  t.after(() => { aiInterviewerService.completeWithQualityGate = originalComplete; });
  aiInterviewerService.completeWithQualityGate = async () => {
    const error = new Error('semantic quality failure');
    error.code = 'AI_RESPONSE_QUALITY_FAILED';
    throw error;
  };

  const fallback = await aiInterviewerService.clarifyQuestion({
    interview: {
      title: 'Platform interview',
      questionSnapshots: [{ question }],
      timers: { perQuestionMinutes: 10 },
      guidelines: 'Answer in your own words.'
    },
    session: { candidateSnapshot: { name: 'Candidate' }, messages: [] },
    question: { question, timeLimit: 10 },
    questionNumber: 1,
    candidateMessage: 'Can you explain that? Explain the question a bit more for me please.'
  });

  assert.match(fallback, /restate the question without changing what it assesses/i);
  assert.match(fallback, /Kubernetes release doubles checkout latency/i);
  assert.doesNotMatch(fallback, /ideal answer|scoring criteria|rubric/i);
});

test('speech rendition quality preserves an intelligent canonical question without adding another ask', () => {
  assert.equal(assessSpeechRendition(
    'A Kubernetes release doubles checkout latency. How would you diagnose the incident, decide whether to roll back, and validate recovery?',
    question
  ).passed, true);

  const simplified = assessSpeechRendition(
    'Tell me how you handle incidents, and what is your greatest strength?',
    question
  );
  assert.equal(simplified.passed, false);
  assert.ok(simplified.issues.some((issue) => /preserve the original question/i.test(issue)));
});

test('live clarification quality permits interview-process and memory questions', () => {
  const progress = assessClarification(
    'There are three questions remaining after this one. We are currently on question two.',
    { question, candidateMessage: 'How many questions are left?' }
  );
  assert.equal(progress.passed, true);

  const remembered = assessClarification(
    'Earlier, you said the rollback threshold should use checkout latency. I can clarify how that term applies here, but I cannot choose the answer for you.',
    { question, candidateMessage: 'What did I say earlier?' }
  );
  assert.equal(remembered.passed, true);
  assert.equal(aiInterviewerService.isLikelyClarification('Please remind me what I said earlier'), true);
  assert.equal(aiInterviewerService.isLikelyClarification('Earlier in my career, I led a deployment migration.'), false);
});

test('interviewer conversation history preserves a short session and avoids duplicating the latest turn', () => {
  const session = {
    messages: [
      { role: 'ai', content: 'Welcome to the interview.' },
      { role: 'candidate', content: 'Could you explain rollback threshold?' },
      { role: 'ai', content: 'It is the signal used to reverse a release.' },
      { role: 'candidate', content: 'What did you say about that signal?' }
    ]
  };

  assert.deepEqual(
    aiInterviewerService.buildConversationHistory(session, {
      excludeLatestCandidateMessage: 'What did you say about that signal?'
    }),
    [
      { role: 'assistant', content: 'Welcome to the interview.' },
      { role: 'user', content: 'Could you explain rollback threshold?' },
      { role: 'assistant', content: 'It is the signal used to reverse a release.' }
    ]
  );
});

test('interviewer conversation history remains bounded while retaining the newest context', () => {
  const messages = Array.from({ length: 50 }, (_, index) => ({
    role: index % 2 ? 'candidate' : 'ai',
    content: `turn-${index} ${'context '.repeat(500)}`
  }));
  const history = aiInterviewerService.buildConversationHistory({ messages });

  assert.ok(history.length <= 32);
  assert.ok(history.reduce((sum, item) => sum + item.content.length, 0) <= 12000);
  assert.match(history.at(-1).content, /turn-49/);
  assert.doesNotMatch(history[0].content, /turn-0/);
});

test('live acknowledgement quality stays neutral and never asks another question', () => {
  assert.equal(assessAcknowledgement(
    'Thank you. I have recorded your response. Use the Confirm button when you are ready to move to the next question.'
  ).passed, true);

  const scored = assessAcknowledgement('Excellent answer. I would score that highly. Can you give another example?');
  assert.equal(scored.passed, false);
  assert.ok(scored.issues.some((issue) => /evaluate or score/i.test(issue)));
  assert.ok(scored.issues.some((issue) => /follow-up/i.test(issue)));
});
