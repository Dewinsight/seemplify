const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction,
  repairInstruction
} = require('../services/aiInterviewerResponseQuality');

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
