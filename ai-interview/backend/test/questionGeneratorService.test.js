const assert = require('node:assert/strict');
const test = require('node:test');

const { QuestionGeneratorService } = require('../src/questionGeneratorService');
const { assessGeneratedQuestions } = require('../src/questionQuality');

const job = {
  title: 'Senior Platform Engineer',
  skills: ['Kubernetes', 'PostgreSQL'],
  responsibilities: 'Scale production services and lead incident response.',
  requirements: 'Evaluate reliability trade-offs using evidence.'
};

function strongQuestion(question) {
  return {
    question,
    type: 'technical',
    difficulty: 'hard',
    category: 'Reliability',
    expectedAnswer: 'Look for evidence-led diagnosis using metrics and traces, a justified Kubernetes mitigation, explicit reliability trade-offs, and measurable validation and rollback criteria.',
    scoringCriteria: [
      { criterion: 'Diagnosis', weight: 35, description: 'Uses telemetry evidence to isolate the failure.' },
      { criterion: 'Decision', weight: 35, description: 'Explains the reliability and cost trade-offs.' },
      { criterion: 'Validation', weight: 30, description: 'Defines measurable recovery and rollback criteria.' }
    ],
    followUpQuestions: [{ question: 'What would trigger rollback?', condition: 'After the proposed mitigation.' }],
    tags: ['kubernetes', 'reliability'],
    timeLimit: 8
  };
}

test('standalone generator returns grounded questions after semantic validation', async () => {
  const service = new QuestionGeneratorService({
    completion: async () => ({
      content: JSON.stringify({ questions: [strongQuestion('A Kubernetes API is failing under a tenfold production traffic spike. How would you diagnose the failure, choose a scaling response, and explain the reliability trade-offs?')] }),
      model: 'openai/gpt-oss-120b',
      requestId: 'request-1'
    })
  });
  const questions = await service.generateForJob(job, { questionCount: 1, includeTypes: ['technical'], difficulty: 'hard' });
  assert.equal(questions.length, 1);
  assert.ok(questions[0].qualityMetrics.semanticQualityScore >= 0.8);
  assert.equal(questions[0].aiGenerationMetadata.requestId, 'request-1');
});

test('standalone generator retries once and rejects repeated generic output', async () => {
  let calls = 0;
  const generic = strongQuestion('Describe your approach to solving complex technical problems.');
  const service = new QuestionGeneratorService({
    completion: async (messages) => {
      calls += 1;
      if (calls === 2) assert.match(messages.at(-1).content, /failed the semantic quality gate/i);
      return { content: JSON.stringify({ questions: [generic] }), model: 'openai/gpt-oss-120b' };
    }
  });
  await assert.rejects(
    () => service.generateForJob(job, { questionCount: 1, includeTypes: ['technical'], difficulty: 'hard' }),
    (error) => error.code === 'AI_QUESTION_QUALITY_FAILED' && error.statusCode === 503
  );
  assert.equal(calls, 2);
});

test('standalone quality gate excludes title-only grounding and permits software race conditions', () => {
  const titleOnly = strongQuestion('As a Product Manager, describe a difficult decision and explain how you measured whether it worked?');
  titleOnly.type = 'behavioral';
  titleOnly.difficulty = 'medium';
  const titleAssessment = assessGeneratedQuestions([titleOnly], {
    job: {
      title: 'Product Manager',
      skills: ['SQL', 'roadmap prioritization'],
      responsibilities: 'Own activation experiments and align engineering and design stakeholders.'
    },
    expectedCount: 1,
    typePlan: ['behavioral'],
    difficulty: 'medium'
  });
  assert.equal(titleAssessment.passed, false);
  assert.match(titleAssessment.issues.join(' '), /concrete job skill|responsibility/i);

  const raceCondition = strongQuestion('A Java race condition causes duplicate payments under production load. How would you isolate the concurrency failure, choose a safe mitigation, and validate recovery?');
  raceCondition.expectedAnswer = 'Look for evidence from traces and concurrent timing, isolation of shared-state mutation, a justified locking or idempotency strategy, reliability trade-offs, and measurable proof that duplicate payments stop under load.';
  raceCondition.tags = ['Java', 'concurrency'];
  const raceAssessment = assessGeneratedQuestions([raceCondition], {
    job: { title: 'Senior Java Engineer', skills: ['Java', 'concurrency'], responsibilities: 'Own production payment reliability.' },
    expectedCount: 1,
    typePlan: ['technical'],
    difficulty: 'hard'
  });
  assert.equal(raceAssessment.questions[0].issues.some((failure) => /protected characteristic/i.test(failure)), false);
});
