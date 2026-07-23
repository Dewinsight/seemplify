const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessQuestionSet,
  buildQualityRepairInstructions,
  jaccardSimilarity
} = require('../services/interviewQuestionQualityService');
const InterviewService = require('../services/interviewService');

const job = {
  title: 'Senior Platform Engineer',
  department: 'Engineering',
  skills: ['Kubernetes', 'TypeScript', 'PostgreSQL'],
  responsibilities: 'Own production reliability, incident response, and platform scaling.',
  requirements: 'Design distributed systems and communicate technical trade-offs.'
};

function strongQuestion(overrides = {}) {
  return {
    question: 'A Kubernetes service is dropping requests during a tenfold traffic spike. How would you diagnose the production failure, choose a scaling strategy, and explain the trade-offs?',
    type: 'technical',
    difficulty: 'hard',
    category: 'Platform reliability',
    expectedAnswer: 'Look for a hypothesis-led investigation using service metrics, traces, resource limits, and load tests; a justified mitigation; explicit reliability and cost trade-offs; and a measurable validation plan.',
    scoringCriteria: [
      { criterion: 'Diagnosis', weight: 35, description: 'Uses evidence to isolate the bottleneck.' },
      { criterion: 'Design', weight: 35, description: 'Chooses a viable scaling and resilience strategy.' },
      { criterion: 'Validation', weight: 30, description: 'Defines metrics, tests, and rollback conditions.' }
    ],
    followUpQuestions: [
      { question: 'How would your plan change if PostgreSQL were the bottleneck?', condition: 'Ask after the initial diagnosis.' }
    ],
    tags: ['kubernetes', 'reliability', 'scaling'],
    timeLimit: 8,
    ...overrides
  };
}

test('semantic quality gate accepts grounded, complete questions', () => {
  const assessment = assessQuestionSet([strongQuestion()], {
    job,
    expectedCount: 1,
    expectedTypes: ['technical'],
    difficulty: 'hard'
  });
  assert.equal(assessment.passed, true);
  assert.ok(assessment.score >= 0.8);
  assert.ok(assessment.questions[0].matchedJobSignals.includes('kubernetes'));
});

test('semantic quality gate rejects stock fallback questions and duplicate sets', () => {
  const generic = {
    question: 'Describe your approach to solving complex technical problems.',
    type: 'technical', difficulty: 'hard', expectedAnswer: 'Look for technical depth.',
    scoringCriteria: [], followUpQuestions: [], tags: []
  };
  const assessment = assessQuestionSet([generic, { ...generic }], {
    job,
    expectedCount: 2,
    expectedTypes: ['technical', 'technical'],
    difficulty: 'hard'
  });
  assert.equal(assessment.passed, false);
  assert.equal(assessment.questions[0].generic, true);
  assert.deepEqual(assessment.duplicateIndexes, [0, 1]);
  assert.match(buildQualityRepairInstructions(assessment), /Discard the previous questions/);
});

test('semantic quality gate rejects protected-trait questions and generic scoring guidance', () => {
  const assessment = assessQuestionSet([strongQuestion({
    question: 'Do you have children, and would family plans prevent you from handling Kubernetes incidents?',
    expectedAnswer: 'Look for technical depth.'
  })], {
    job,
    expectedCount: 1,
    expectedTypes: ['technical'],
    difficulty: 'hard'
  });
  assert.equal(assessment.passed, false);
  assert.equal(assessment.questions[0].protectedTraitRisk, true);
  assert.equal(assessment.questions[0].genericExpectedAnswer, true);
  assert.match(assessment.issues.join(' '), /protected-characteristic/i);
});

test('semantic quality gate does not mistake a software race condition for a protected trait', () => {
  const assessment = assessQuestionSet([strongQuestion({
    question: 'A Java race condition causes duplicate payments under production load. How would you isolate the concurrency failure, choose a safe mitigation, and validate recovery?',
    expectedAnswer: 'Look for evidence from traces and concurrent request timing, isolation of the shared-state failure, a justified locking or idempotency mitigation, and measurable validation that duplicate payments stop without unacceptable throughput loss.',
    followUpQuestions: [{ question: 'How would you prove the mitigation remains safe under concurrent retries?', condition: 'Ask after the candidate selects a mitigation.' }],
    tags: ['Java', 'concurrency']
  })], {
    job: { title: 'Senior Java Engineer', skills: ['Java', 'concurrency'], responsibilities: 'Own production payment reliability.' },
    expectedCount: 1,
    expectedTypes: ['technical'],
    difficulty: 'hard'
  });
  assert.equal(assessment.questions[0].protectedTraitRisk, false);
});

test('semantic quality gate does not accept a role title as the only job grounding', () => {
  const assessment = assessQuestionSet([strongQuestion({
    question: 'As a Product Manager, describe a difficult decision and explain how you measured whether it worked?',
    type: 'behavioral',
    difficulty: 'medium',
    expectedAnswer: 'Look for a clear decision, evidence considered, trade-offs made, stakeholder communication, and a measurable result linked to the decision.',
    tags: ['product management', 'decision making']
  })], {
    job: {
      title: 'Product Manager',
      skills: ['SQL', 'roadmap prioritization'],
      responsibilities: 'Own activation experiments and align engineering and design stakeholders.'
    },
    expectedCount: 1,
    expectedTypes: ['behavioral'],
    difficulty: 'medium'
  });
  assert.equal(assessment.passed, false);
  assert.match(assessment.issues.join(' '), /concrete skill|job context/i);
});

test('semantic quality gate rejects duplicated answer guidance and non-actionable criteria', () => {
  const first = strongQuestion();
  const second = strongQuestion({
    question: 'A PostgreSQL migration is blocking production writes. How would you isolate the failure, choose a recovery path, and manage the reliability trade-offs?',
    scoringCriteria: [
      { criterion: 'Diagnosis', weight: 35, description: 'Short.' },
      { criterion: 'Diagnosis approach', weight: 35, description: 'Also short.' },
      { criterion: 'Validation', weight: 30, description: 'Brief.' }
    ]
  });
  const assessment = assessQuestionSet([first, second], {
    job,
    expectedCount: 2,
    expectedTypes: ['technical', 'technical'],
    difficulty: 'hard'
  });
  assert.equal(assessment.passed, false);
  assert.deepEqual(assessment.duplicateIndexes, [0, 1]);
  assert.match(assessment.issues.join(' '), /reuse the same expected-answer guidance/i);
  assert.match(assessment.issues.join(' '), /concrete description/i);
});

test('similarity detector distinguishes repeated wording from different scenarios', () => {
  assert.ok(jaccardSimilarity('How would you scale a Kubernetes service during a traffic spike?', 'How would you scale a Kubernetes service for a sudden traffic spike?') > 0.72);
  assert.ok(jaccardSimilarity('How would you scale Kubernetes?', 'Tell us about resolving a PostgreSQL data migration failure.') < 0.4);
});

test('recruiter generation retries once when the first set is semantically weak', async () => {
  const service = new InterviewService();
  let calls = 0;
  service.aiModelService = {
    generateInterviewQuestions: async (prompt) => {
      calls += 1;
      if (calls === 2) assert.match(prompt, /QUALITY REGENERATION REQUIRED/);
      return calls === 1
        ? [{
            question: 'Describe your approach to solving complex technical problems.',
            type: 'technical', difficulty: 'hard', category: 'Problem solving',
            expectedAnswer: 'Look for technical depth.', scoringCriteria: [], followUpQuestions: [], tags: [], timeLimit: 5
          }]
        : [strongQuestion()];
    }
  };
  const result = await service._generateQuestionsByType('technical', 1, 'job context', 'hard', [], job);
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.ok(result[0].qualityMetrics.semanticQualityScore >= 0.8);
});

test('recruiter generation saves no generic fallback after two weak sets', async () => {
  const service = new InterviewService();
  service.aiModelService = {
    generateInterviewQuestions: async () => [{
      question: 'Describe your approach to solving complex technical problems.',
      type: 'technical', difficulty: 'hard', category: 'Problem solving',
      expectedAnswer: 'Look for technical depth.', scoringCriteria: [], followUpQuestions: [], tags: [], timeLimit: 5
    }]
  };
  await assert.rejects(
    () => service._generateQuestionsByType('technical', 1, 'job context', 'hard', [], job),
    (error) => error.code === 'AI_QUESTION_QUALITY_FAILED' && error.statusCode === 503
  );
});

test('quality analytics use semantic assessment and ignore unassessed questions', () => {
  const service = new InterviewService();
  const average = service._calculateAverageQuality([
    { qualityMetrics: { semanticQualityScore: 0.82, biasScore: 0.9 } },
    { qualityMetrics: { semanticQualityScore: 0.9, biasScore: 0 } },
    { qualityMetrics: { semanticQualityScore: null, biasScore: 0 } }
  ]);
  assert.equal(average, 0.86);
});

test('legacy template fallback entry points fail closed', () => {
  const service = new InterviewService();
  assert.throws(() => service._generateBasicQuestions(job), { code: 'AI_QUESTION_GENERATION_REQUIRED', statusCode: 503 });
  assert.throws(() => service._generateFallbackQuestions('technical', 2, 'hard'), { code: 'AI_QUESTION_GENERATION_REQUIRED', statusCode: 503 });
});
