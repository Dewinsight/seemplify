const assert = require('node:assert/strict');
const test = require('node:test');

const AIModelService = require('../services/aiModelService');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const {
  GroqTokenBudget,
  estimateRequestTokens,
  mergeCvExtractions,
  splitCvText
} = require('../services/aiRuntime/groqCvChunkingService');

test('large CV text is split at readable boundaries with bounded overlap', () => {
  const section = (name, value) => `${name}\n${value.repeat(90)}`;
  const text = [
    section('PROFILE', 'Senior engineer. '),
    section('EXPERIENCE', 'Built reliable platforms. '),
    section('EDUCATION', 'BSc Computer Science. ')
  ].join('\n\n');
  const chunks = splitCvText(text, { maxChars: 1_200, overlapChars: 100 });
  assert.ok(chunks.length > 3);
  assert.equal(chunks.every((chunk) => chunk.length <= 1_200), true);
  assert.match(chunks[0], /PROFILE/);
  assert.match(chunks.at(-1), /Computer Science/);
});

test('chunk extraction merge preserves unique roles, skills, and strongest summaries', () => {
  const merged = mergeCvExtractions([
    {
      firstName: 'Ada',
      skills: ['Node.js', 'Redis'],
      summary: 'Engineer.',
      workExperience: {
        totalYearsExperience: 6,
        jobHistory: [{ company: 'A', position: 'Engineer', duration: '2020-2022' }]
      }
    },
    {
      firstName: 'N/A',
      skills: ['Redis', 'MongoDB'],
      summary: 'Senior engineer building distributed recruitment systems.',
      workExperience: {
        totalYearsExperience: 8,
        jobHistory: [
          { company: 'A', position: 'Engineer', responsibilities: 'Built the payments API.' },
          { company: 'B', position: 'Senior Engineer' }
        ]
      }
    }
  ]);
  assert.equal(merged.firstName, 'Ada');
  assert.deepEqual(merged.skills, ['Node.js', 'Redis', 'MongoDB']);
  assert.equal(merged.summary, 'Senior engineer building distributed recruitment systems.');
  assert.equal(merged.workExperience.totalYearsExperience, 8);
  assert.equal(merged.workExperience.jobHistory.length, 2);
  assert.deepEqual(merged.workExperience.jobHistory[0], {
    company: 'A',
    position: 'Engineer',
    duration: '2020-2022',
    responsibilities: 'Built the payments API.'
  });
});

test('Groq token budget waits before crossing its per-minute safety ceiling', async () => {
  let now = 0;
  const sleeps = [];
  const budget = new GroqTokenBudget({
    tokensPerMinute: 100,
    windowMs: 1_000,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    }
  });
  await budget.reserve(70);
  await budget.reserve(40);
  assert.deepEqual(sleeps, [1_000]);
  assert.equal(budget.reserved, 40);
  assert.ok(estimateRequestTokens({
    messages: [{ content: 'x'.repeat(400) }],
    schema: { type: 'object' },
    maxOutputTokens: 100
  }) >= 400);
});

test('large CVs use the chunked Groq path when Groq is selected or active as failover', async () => {
  const originalGetExecutionRoute = aiRuntimeService.getExecutionRoute;
  aiRuntimeService.getExecutionRoute = async () => ({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  const service = new AIModelService();
  let reservations = 0;
  let calls = 0;
  service.groqCvTokenBudget = {
    tokensPerMinute: 7_200,
    async reserve() { reservations += 1; }
  };
  service.requestStructuredCompletion = async (request) => {
    await request.beforeAttempt();
    calls += 1;
    return {
      status: '200',
      choices: [{
        message: {
          content: JSON.stringify({
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.test',
            skills: calls === 1 ? ['Node.js'] : ['Redis'],
            summary: 'Distributed systems engineer.',
            strengths: ['Reliability'],
            potentialFlags: [],
            workExperience: {},
            educationHistory: [],
            certifications: [],
            languages: [],
            awards: [],
            projects: [],
            publications: [],
            volunteerWork: [],
            professionalMemberships: [],
            portfolioLinks: {},
            additionalSections: {},
            fullCVData: {}
          })
        }
      }]
    };
  };
  try {
    const result = await service.analyzeCV(`Ada Lovelace\n${'Platform engineering experience. '.repeat(500)}`);
    assert.equal(result.success, true);
    assert.equal(result.processing.strategy, 'chunked-map-merge');
    assert.ok(result.processing.chunks > 1);
    assert.equal(calls, result.processing.chunks);
    assert.equal(reservations, calls);
    assert.deepEqual(result.extractedFields.skills, ['Node.js', 'Redis']);
  } finally {
    aiRuntimeService.getExecutionRoute = originalGetExecutionRoute;
  }
});
