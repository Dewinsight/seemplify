const strictObject = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const stringArray = { type: 'array', items: { type: 'string' } };

const fixtures = [
  {
    id: 'cv-extraction', activity: 'candidate.cv_parse', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Synthetic CV: Jordan Lee, platform engineer, TypeScript and Kubernetes.' }],
    schema: strictObject({ name: { type: 'string' }, title: { type: 'string' }, skills: stringArray }),
    expectedKeywords: ['Jordan Lee', 'platform engineer', 'TypeScript', 'Kubernetes'],
    expectedOutput: { name: 'Jordan Lee', title: 'Platform Engineer', skills: ['TypeScript', 'Kubernetes'] }
  },
  {
    id: 'job-generation', activity: 'job.description', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Create a concise synthetic role for a senior data engineer.' }],
    schema: strictObject({ title: { type: 'string' }, description: { type: 'string' }, skills: stringArray }),
    expectedKeywords: ['senior data engineer', 'pipelines', 'SQL'],
    expectedOutput: { title: 'Senior Data Engineer', description: 'Build reliable data pipelines.', skills: ['SQL'] }
  },
  {
    id: 'matching', activity: 'matching.analysis', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Match a synthetic TypeScript engineer to a platform role using only supplied evidence.' }],
    schema: strictObject({ score: { type: 'number', minimum: 0, maximum: 100 }, evidence: stringArray, gaps: stringArray }),
    expectedKeywords: ['TypeScript', 'platform'],
    expectedOutput: { score: 88, evidence: ['TypeScript platform experience'], gaps: [] },
    qualityEvaluator: 'matching'
  },
  {
    id: 'assistant-tool', activity: 'assistant.tool_selection', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Find open engineering jobs.' }],
    schema: strictObject({ tool: { type: 'string' }, arguments: { type: 'object' } }),
    expectedKeywords: ['search_jobs'],
    expectedOutput: { tool: 'search_jobs', arguments: { department: 'Engineering' } }
  },
  {
    id: 'interview-chat-safety', activity: 'ai_interview.chat.clarification', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Clarify what cross-functional means without answering the interview question.' }],
    schema: strictObject({ message: { type: 'string' } }),
    expectedKeywords: ['different teams'],
    forbiddenPhrases: ['scoring rubric', 'expected answer', 'your score'],
    expectedOutput: { message: 'Cross-functional means working with people from different teams.' }
  },
  {
    id: 'interview-scoring', activity: 'ai_interview.scoring', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Score a synthetic grounded interview response.' }],
    schema: strictObject({ overallScore: { type: 'number', minimum: 0, maximum: 100 }, summary: { type: 'string' }, evidence: stringArray }),
    expectedKeywords: ['evidence', 'delivery'],
    expectedOutput: { overallScore: 82, summary: 'Strong delivery evidence.', evidence: ['Measured delivery outcome'] },
    qualityEvaluator: 'scoring'
  }
];

const genericResultSchema = strictObject({ result: { type: 'string' }, evidence: stringArray });
const genericSpecs = [
  ['recruiter-general', 'recruiter.general', 'Give a concise evidence-based answer about reducing hiring cycle time.', 'Prioritize bottleneck measurement and structured interviews.', ['bottleneck', 'structured interviews']],
  ['candidate-insights', 'candidate.insights', 'Summarize strengths in this synthetic profile: TypeScript platform engineer who reduced incidents by 35%.', 'Strong TypeScript platform experience with measured reliability impact.', ['TypeScript', '35%']],
  ['job-requirements', 'job.requirements', 'List defensible requirements for a senior data engineer owning SQL pipelines.', 'Require production SQL and reliable pipeline ownership.', ['SQL', 'pipeline']],
  ['job-normalize', 'job.normalize', 'Normalize this title: Sr. Platform Eng.', 'Senior Platform Engineer', ['Senior Platform Engineer']],
  ['matching-report', 'matching.report', 'Explain a grounded match between Kubernetes experience and a platform reliability role.', 'The supplied Kubernetes evidence aligns with platform reliability work.', ['Kubernetes', 'reliability']],
  ['assistant-chat', 'assistant.chat', 'Answer: how should a recruiter compare two shortlisted engineers fairly?', 'Use the same job-relevant rubric and evidence for both candidates.', ['rubric', 'evidence']],
  ['assistant-memory', 'assistant.memory', 'Classify this durable preference: always show salary in GBP.', 'Store the GBP display preference.', ['GBP', 'preference']],
  ['assistant-title', 'assistant.title', 'Create a short title for a chat about open platform engineering roles.', 'Platform engineering roles', ['platform engineering']],
  ['assistant-job-extract', 'assistant.job_extract', 'Extract the intent: create a senior backend engineer role using Node.js.', 'Create a Senior Backend Engineer job using Node.js.', ['Senior Backend Engineer', 'Node.js']],
  ['analytics-candidates', 'analytics.candidates', 'Interpret synthetic candidate data: 40 applicants, 10 shortlisted.', 'The shortlist rate is 25%.', ['25%']],
  ['analytics-jobs', 'analytics.jobs', 'Interpret synthetic job data: 8 open roles, 2 overdue.', 'Two of eight open roles are overdue.', ['two', 'eight']],
  ['analytics-hiring', 'analytics.hiring', 'Interpret synthetic hiring data: median time-to-hire fell from 40 to 30 days.', 'Median time-to-hire improved by 10 days.', ['10 days']],
  ['report-analysis', 'report.analysis', 'Summarize a synthetic report showing offer acceptance rose from 70% to 80%.', 'Offer acceptance increased by 10 percentage points.', ['10 percentage points']],
  ['interview-analysis', 'interview.analysis', 'Analyze a synthetic interview answer that gives a measured 20% latency reduction.', 'The answer provides a measurable latency outcome.', ['20%', 'latency']],
  ['interview-summary', 'interview.summary', 'Summarize synthetic interview evidence: strong SQL, weak incident examples.', 'Strong SQL evidence; incident-response evidence remains weak.', ['SQL', 'incident']],
  ['interview-team-feedback', 'interview.team_feedback', 'Synthesize synthetic feedback: two assessors praise system design; one notes vague delivery metrics.', 'System design is consistently strong; delivery impact needs clearer metrics.', ['system design', 'metrics']],
  ['chat-introduction', 'ai_interview.chat.introduction', 'Introduce this question without revealing an answer: How did you improve API reliability?', 'How did you improve API reliability? You may ask for clarification or answer when ready.', ['API reliability', 'clarification']],
  ['chat-acknowledgement', 'ai_interview.chat.acknowledgement', 'Acknowledge an answer without scoring it and direct the candidate to confirm.', 'Thank you. Use the confirm button when you are ready to continue.', ['confirm']],
  ['standalone-cv-parse', 'ai_interview.cv_parse', 'Extract synthetic CV evidence: Sam Lee, data engineer, SQL and Python.', 'Sam Lee is a data engineer with SQL and Python skills.', ['Sam Lee', 'SQL', 'Python']]
];

fixtures.push(...genericSpecs.map(([id, activity, prompt, result, keywords]) => ({
  id,
  activity,
  azureBaselineScore: 8.5,
  messages: [{ role: 'user', content: prompt }],
  schema: genericResultSchema,
  expectedKeywords: keywords,
  expectedOutput: { result, evidence: keywords }
})));

const interviewQuestionSchema = strictObject({
  questions: {
    type: 'array',
    items: strictObject({
      question: { type: 'string' },
      type: { type: 'string' },
      difficulty: { type: 'string' },
      category: { type: 'string' },
      expectedAnswer: { type: 'string' },
      scoringCriteria: { type: 'array', items: strictObject({ criterion: { type: 'string' }, weight: { type: 'number' }, description: { type: 'string' } }) },
      followUpQuestions: { type: 'array', items: strictObject({ question: { type: 'string' }, condition: { type: 'string' } }) },
      tags: stringArray,
      timeLimit: { type: 'number' }
    })
  }
});
const questionOutput = {
  questions: [{
    question: 'A Kubernetes service is dropping requests during a tenfold production traffic spike. How would you diagnose the failure, choose a scaling response, and explain the reliability trade-offs?',
    type: 'technical', difficulty: 'hard', category: 'Platform reliability',
    expectedAnswer: 'Look for evidence-led diagnosis using metrics and traces, a justified mitigation, explicit reliability and cost trade-offs, and measurable validation and rollback criteria.',
    scoringCriteria: [
      { criterion: 'Diagnosis', weight: 35, description: 'Uses evidence to isolate the failure.' },
      { criterion: 'Decision', weight: 35, description: 'Explains a viable response and trade-offs.' },
      { criterion: 'Validation', weight: 30, description: 'Defines success and rollback metrics.' }
    ],
    followUpQuestions: [{ question: 'What would trigger rollback?', condition: 'After the initial mitigation.' }],
    tags: ['kubernetes', 'reliability'], timeLimit: 8
  }]
};
for (const [id, activity] of [['interview-questions', 'interview.questions'], ['standalone-interview-questions', 'ai_interview.question_generation']]) {
  fixtures.push({
    id, activity, azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Create one hard, job-grounded technical question for a Senior Platform Engineer using Kubernetes and owning production reliability.' }],
    schema: interviewQuestionSchema,
    expectedKeywords: ['Kubernetes', 'production', 'trade-offs'],
    forbiddenPhrases: ['describe your approach to solving complex technical problems'],
    expectedOutput: questionOutput,
    qualityEvaluator: 'interview_questions',
    qualityContext: { job: { title: 'Senior Platform Engineer', skills: ['Kubernetes'], responsibilities: 'Own production reliability.' }, expectedCount: 1, expectedTypes: ['technical'], difficulty: 'hard' }
  });
}

fixtures.push({
  id: 'interview-bias', activity: 'interview.bias', azureBaselineScore: 9,
  messages: [{ role: 'user', content: 'Assess this job-relevant question for protected-characteristic bias: How did you improve API reliability?' }],
  schema: strictObject({ overallBiasScore: { type: 'number', minimum: 0, maximum: 1 }, isBiased: { type: 'boolean' }, detectedBiasFactors: { type: 'array', items: { type: 'string' } }, neutralityConfidence: { type: 'number', minimum: 0, maximum: 1 }, recommendation: { type: 'string' } }),
  expectedKeywords: ['reliability'],
  expectedOutput: { overallBiasScore: 0, isBiased: false, detectedBiasFactors: [], neutralityConfidence: 0.95, recommendation: 'The question is job-relevant and neutral.' },
  qualityEvaluator: 'bias'
});

module.exports = fixtures;
