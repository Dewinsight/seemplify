const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction
} = require('../src/interviewerResponseQuality');

const question = 'A Kubernetes release doubles checkout latency. How would you diagnose the incident, decide whether to roll back, and validate recovery?';

test('standalone live-message harness accepts grounded interviewer messages', () => {
  assert.equal(assessIntroduction(
    'A Kubernetes release has doubled checkout latency. How would you diagnose the incident, decide whether to roll back, and validate recovery? Ask for clarification or answer when ready.',
    question
  ).passed, true);
  assert.equal(assessClarification(
    'A rollback threshold is a measurable signal for reversing the Kubernetes release. Here, explain which latency or error signal you would choose and why.',
    { question, candidateMessage: 'What is a rollback threshold?' }
  ).passed, true);
  assert.equal(assessAcknowledgement(
    'Thank you. Your response is recorded. Use the Confirm button when you are ready to move on.'
  ).passed, true);
});

test('standalone live-message harness rejects generic, leading, and scoring content', () => {
  assert.equal(assessIntroduction('Tell me about yourself?', question).passed, false);
  assert.equal(assessClarification(
    'The best answer is to roll back because the scoring rubric says so.',
    { question, candidateMessage: 'What is a rollback threshold?' }
  ).passed, false);
  assert.equal(assessAcknowledgement('Great answer, I score it five out of five. What else did you do?').passed, false);
});

test('standalone harness accepts short questions and broad rephrasing requests', () => {
  assert.equal(assessIntroduction(
    'Let us discuss React. Why React? You can ask for clarification or answer when ready.',
    'Why React?'
  ).passed, true);

  assert.equal(assessClarification(
    'Imagine the release has caused a serious production slowdown. Describe how you would investigate it, decide whether to undo the change, and confirm the service has recovered.',
    {
      question: 'A Kubernetes release doubles checkout latency. How would you diagnose the incident, decide whether to roll back, and validate recovery?',
      candidateMessage: 'Can you rephrase that?'
    }
  ).passed, true);
});
