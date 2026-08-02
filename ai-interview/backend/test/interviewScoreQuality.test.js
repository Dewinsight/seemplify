const assert = require('node:assert/strict');
const test = require('node:test');

const { assessInterviewScore } = require('../src/interviewScoreQuality');

const questions = [
  { answer: 'I profiled the query and reduced latency by 20%.', status: 'answered' },
  { answer: '', status: 'skipped' }
];

const validScore = {
  overallScore: 40,
  recommendation: 'maybe',
  summary: 'The first answer provides measured technical evidence, while the second answer is missing.',
  strengths: ['Measured a 20% latency improvement.'],
  concerns: ['No evidence was supplied for question two.'],
  questionScores: [
    { questionIndex: 0, score: 4, rationale: 'The answer describes diagnosis and a measured 20% latency outcome.' },
    { questionIndex: 1, score: 1, rationale: 'No response was supplied, so there is no evidence to assess.' }
  ]
};

test('interview score quality accepts complete evidence-aligned scoring', () => {
  assert.deepEqual(assessInterviewScore(validScore, questions), { passed: true, issues: [] });
});

test('interview score quality rejects duplicate indexes and inflated missing answers', () => {
  const result = assessInterviewScore({
    ...validScore,
    overallScore: 10,
    recommendation: 'strong_yes',
    questionScores: [
      validScore.questionScores[0],
      { questionIndex: 0, score: 5, rationale: 'A duplicate score with no matching candidate answer evidence.' }
    ]
  }, questions);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => /duplicate question indexes/i.test(issue)));
  assert.ok(result.issues.some((issue) => /no score/i.test(issue)));
  assert.ok(result.issues.some((issue) => /inconsistent/i.test(issue)));
});

test('interview score quality rejects unsupported success when every answer is missing', () => {
  const result = assessInterviewScore({
    ...validScore,
    overallScore: 80,
    recommendation: 'yes',
    strengths: ['Strong communication'],
    questionScores: [
      { questionIndex: 0, score: 4, rationale: 'No answer was supplied but this score is still high.' },
      { questionIndex: 1, score: 4, rationale: 'No answer was supplied but this score is still high.' }
    ]
  }, [{ answer: '', status: 'skipped' }, { answer: '', status: 'timed_out' }]);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => /missing answer/i.test(issue)));
  assert.ok(result.issues.some((issue) => /no answers cannot receive/i.test(issue)));
  assert.ok(result.issues.some((issue) => /cannot contain evidence-based strengths/i.test(issue)));
});
