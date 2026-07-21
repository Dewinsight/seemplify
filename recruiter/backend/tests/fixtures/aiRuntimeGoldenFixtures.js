const strictObject = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const stringArray = { type: 'array', items: { type: 'string' } };

module.exports = [
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
    expectedOutput: { score: 88, evidence: ['TypeScript platform experience'], gaps: [] }
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
    expectedOutput: { overallScore: 82, summary: 'Strong delivery evidence.', evidence: ['Measured delivery outcome'] }
  }
];
