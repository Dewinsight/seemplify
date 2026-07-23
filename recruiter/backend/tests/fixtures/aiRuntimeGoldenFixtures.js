const strictObject = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const stringArray = { type: 'array', items: { type: 'string' } };

const fixtures = [
  {
    id: 'cv-extraction', activity: 'candidate.cv_parse', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Synthetic CV: Jordan Lee, platform engineer, TypeScript and Kubernetes. No contact or education details were supplied.' }],
    schema: {
      type: 'object', additionalProperties: true,
      required: ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'skills', 'summary', 'strengths', 'potentialFlags', 'workExperience', 'educationHistory', 'certifications', 'languages', 'awards', 'projects', 'publications', 'volunteerWork', 'professionalMemberships', 'portfolioLinks', 'additionalSections', 'fullCVData'],
      properties: {
        firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, location: { type: 'string' },
        position: { type: 'string' }, experience: { type: 'string' }, education: { type: 'string' }, skills: stringArray, summary: { type: 'string' },
        strengths: stringArray, potentialFlags: stringArray, workExperience: { type: 'object' }, educationHistory: { type: 'array', items: { type: 'object' } },
        certifications: { type: 'array', items: { type: 'object' } }, languages: { type: 'array', items: { type: 'object' } }, awards: { type: 'array', items: { type: 'object' } },
        projects: { type: 'array', items: { type: 'object' } }, publications: { type: 'array', items: { type: 'object' } }, volunteerWork: { type: 'array', items: { type: 'object' } },
        professionalMemberships: { type: 'array', items: { type: 'object' } }, portfolioLinks: { type: 'object' }, additionalSections: { type: 'object' }, fullCVData: { type: 'object' }
      }
    },
    expectedKeywords: ['Jordan', 'Lee', 'Platform Engineer', 'TypeScript', 'Kubernetes'],
    expectedOutput: {
      firstName: 'Jordan', lastName: 'Lee', email: 'N/A', phone: 'N/A', location: 'N/A', position: 'Platform Engineer', experience: 'N/A', education: 'N/A',
      skills: ['TypeScript', 'Kubernetes'], summary: 'Platform engineer with TypeScript and Kubernetes experience.', strengths: ['Platform engineering'], potentialFlags: [],
      workExperience: {}, educationHistory: [], certifications: [], languages: [], awards: [], projects: [], publications: [], volunteerWork: [],
      professionalMemberships: [], portfolioLinks: {}, additionalSections: {}, fullCVData: {}
    },
    qualityEvaluator: 'cv_extraction',
    qualityContext: { requiredFacts: ['Jordan', 'Lee', 'TypeScript', 'Kubernetes'], knownMissingFacts: ['email', 'phone', 'location', 'education'] }
  },
  {
    id: 'job-generation', activity: 'job.description', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Create a concise synthetic role for a senior data engineer.' }],
    schema: strictObject({ description: { type: 'string' }, responsibilities: stringArray, requirements: stringArray, skills: stringArray, benefits: stringArray }),
    expectedKeywords: ['data engineer', 'pipelines', 'SQL'],
    expectedOutput: {
      description: 'A senior data engineer who builds and operates reliable production data platforms for analytics teams.',
      responsibilities: ['Design reliable batch and streaming pipelines.', 'Own production data quality and observability.', 'Model analytics-ready datasets in SQL.', 'Review architecture and code changes.', 'Partner with analysts on data contracts.', 'Improve platform cost and performance.'],
      requirements: ['Production SQL and data-pipeline experience.', 'Experience operating distributed data systems.', 'Evidence of data quality ownership.', 'Strong software engineering fundamentals.', 'Clear cross-functional communication.', 'Ability to diagnose production failures.'],
      skills: ['SQL', 'Data pipelines', 'Python', 'Data modelling', 'Observability', 'Distributed systems', 'Cloud platforms', 'Data quality'],
      benefits: ['Flexible remote work.', 'Learning budget.', 'Home-office support.', 'Health coverage.', 'Paid volunteering days.']
    },
    qualityEvaluator: 'job_description',
    qualityContext: { requiredFacts: ['data engineer', 'SQL', 'pipelines'], expectedCounts: { responsibilities: 6, requirements: 6, skills: 8, benefits: 5 } }
  },
  {
    id: 'matching', activity: 'matching.analysis', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Candidate candidate-1 is Jordan Lee, a TypeScript engineer with platform reliability experience. Match only this evidence to a platform role.' }],
    schema: strictObject({
      analysis: {
        type: 'array',
        items: strictObject({
          candidate_id: { type: 'string' }, candidate_name: { type: 'string' }, skill_match_percentage: { type: 'number', minimum: 0, maximum: 100 },
          experience_fit: { type: 'number', minimum: 1, maximum: 10 }, technical_strengths: stringArray, skill_gaps: stringArray, transferable_skills: stringArray,
          cultural_alignment: { type: 'number', minimum: 1, maximum: 10 }, growth_potential: { type: 'number', minimum: 1, maximum: 10 }, interview_focus: stringArray,
          contextual_explanation: { type: 'string' }, confidence_score: { type: 'number', minimum: 1, maximum: 10 }
        })
      }
    }),
    expectedKeywords: ['candidate-1', 'Jordan Lee', 'TypeScript', 'platform'],
    expectedOutput: { analysis: [{
      candidate_id: 'candidate-1', candidate_name: 'Jordan Lee', skill_match_percentage: 88, experience_fit: 8,
      technical_strengths: ['TypeScript platform reliability'], skill_gaps: [], transferable_skills: ['Production troubleshooting'],
      cultural_alignment: 7, growth_potential: 8, interview_focus: ['Platform reliability depth'],
      contextual_explanation: 'The supplied TypeScript and platform reliability evidence supports a strong match.', confidence_score: 8
    }] },
    qualityEvaluator: 'matching',
    qualityContext: { requiredFacts: ['candidate-1', 'TypeScript', 'platform reliability'] }
  },
  {
    id: 'assistant-tool', activity: 'assistant.tool_selection', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Find open engineering jobs.' }],
    schema: strictObject({
      message: { type: 'string' },
      toolCalls: { type: 'array', items: strictObject({ name: { type: 'string' }, parameters: { type: 'object' } }) }
    }),
    expectedKeywords: ['search_jobs'],
    expectedOutput: { message: 'I will look for open engineering jobs.', toolCalls: [{ name: 'search_jobs', parameters: { department: 'Engineering', status: 'open' } }] },
    qualityEvaluator: 'tool_selection',
    qualityContext: { expectedTool: 'search_jobs' }
  },
  {
    id: 'interview-chat-safety', activity: 'ai_interview.chat.clarification', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Current question: How would you align cross-functional teams around a delayed launch? Candidate asks: What does cross-functional mean?' }],
    responseMode: 'text',
    expectedKeywords: ['cross-functional', 'different teams'],
    forbiddenPhrases: ['scoring rubric', 'expected answer', 'your score'],
    expectedOutput: 'Cross-functional means coordinating people from different teams toward one outcome. In this question, explain how you would align those teams without trying to guess a preferred answer.',
    qualityEvaluator: 'chat_clarification',
    qualityContext: {
      question: 'How would you align cross-functional teams around a delayed launch?',
      candidateMessage: 'What does cross-functional mean?'
    }
  },
  {
    id: 'interview-scoring', activity: 'ai_interview.scoring', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Score a synthetic grounded interview response.' }],
    schema: strictObject({
      overallScore: { type: 'number', minimum: 0, maximum: 100 },
      recommendation: { type: 'string', enum: ['strong_yes', 'yes', 'maybe', 'no'] },
      summary: { type: 'string' }, strengths: stringArray, concerns: stringArray,
      questionScores: {
        type: 'array',
        items: strictObject({ questionIndex: { type: 'integer', minimum: 0 }, score: { type: 'number', minimum: 1, maximum: 5 }, rationale: { type: 'string' } })
      }
    }),
    expectedKeywords: ['delivery', '20%'],
    expectedOutput: {
      overallScore: 82, recommendation: 'yes',
      summary: 'The response gives credible delivery evidence and a measured 20% improvement.',
      strengths: ['Measured a 20% delivery improvement.'], concerns: ['Risk-management detail was limited.'],
      questionScores: [{ questionIndex: 0, score: 4, rationale: 'The candidate described a specific delivery action and measured a 20% outcome.' }]
    },
    qualityEvaluator: 'scoring',
    qualityContext: { requiredFacts: ['delivery', '20%'] }
  }
];

fixtures.push(
  {
    id: 'job-requirements', activity: 'job.requirements', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Generate grounded requirements for a senior data engineer who owns production SQL pipelines and data quality.' }],
    schema: strictObject({ requiredQualifications: stringArray, preferredQualifications: stringArray }),
    expectedKeywords: ['SQL', 'pipelines', 'data quality'],
    expectedOutput: {
      requiredQualifications: ['Production SQL expertise.', 'Experience owning reliable data pipelines.', 'Evidence of data-quality incident resolution.'],
      preferredQualifications: ['Experience with cloud data platforms.', 'Experience mentoring data engineers.']
    },
    qualityEvaluator: 'job_requirements',
    qualityContext: { requiredFacts: ['SQL', 'pipelines', 'data quality'] }
  },
  {
    id: 'job-normalize-salary', activity: 'job.normalize', azureBaselineScore: 9,
    messages: [{ role: 'user', content: 'Parse salary: GBP 75,000 to 90,000 per year.' }],
    schema: strictObject({
      min: { type: ['integer', 'null'], minimum: 0 }, max: { type: ['integer', 'null'], minimum: 0 },
      currency: { type: ['string', 'null'] }, period: { type: ['string', 'null'] }
    }),
    expectedKeywords: ['75000', '90000', 'GBP', 'annually'],
    expectedOutput: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
    qualityEvaluator: 'salary_normalization'
  },
  {
    id: 'assistant-memory', activity: 'assistant.memory', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Classify this durable preference: always show salary in GBP.' }],
    schema: strictObject({
      type: { type: 'string', enum: ['mixed', 'personality', 'chat'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, reasoning: { type: 'string' },
      personalityInsights: {
        type: 'array',
        items: strictObject({ category: { type: 'string' }, content: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } })
      },
      chatInsights: {
        type: 'array',
        items: strictObject({ category: { type: 'string' }, content: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } })
      }
    }),
    expectedKeywords: ['GBP', 'preference'],
    expectedOutput: {
      type: 'personality', confidence: 0.96, reasoning: 'This is a durable display preference.',
      personalityInsights: [{ category: 'preferences', content: 'Show salary amounts in GBP.', confidence: 0.96 }], chatInsights: []
    },
    qualityEvaluator: 'memory_classification',
    qualityContext: { requiredFacts: ['GBP'] }
  },
  {
    id: 'assistant-job-extract', activity: 'assistant.job_extract', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Extract the intent: create a senior backend engineer role using Node.js for a platform team.' }],
    schema: {
      type: 'object', additionalProperties: true, required: ['title', 'skills'],
      properties: { title: { type: 'string' }, department: { type: 'string' }, level: { type: 'string' }, skills: stringArray }
    },
    expectedKeywords: ['Senior Backend Engineer', 'Node.js', 'Platform'],
    expectedOutput: { title: 'Senior Backend Engineer', department: 'Platform', level: 'senior', skills: ['Node.js'] },
    qualityEvaluator: 'job_extraction',
    qualityContext: { requiredFacts: ['Senior Backend Engineer', 'Node.js', 'Platform'] }
  },
  {
    id: 'standalone-cv-parse', activity: 'ai_interview.cv_parse', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Synthetic CV: Sam Lee, data engineer with SQL and Python. No contact, education, dates, employer, or location supplied.' }],
    schema: strictObject({
      name: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, location: { type: 'string' },
      currentTitle: { type: 'string' }, yearsOfExperience: { type: ['number', 'null'], minimum: 0 }, skills: stringArray, education: stringArray,
      workExperience: {
        type: 'array',
        items: strictObject({ title: { type: 'string' }, company: { type: 'string' }, duration: { type: 'string' }, summary: { type: 'string' } })
      },
      summary: { type: 'string' }, strengths: stringArray, risks: stringArray
    }),
    expectedKeywords: ['Sam Lee', 'SQL', 'Python'],
    expectedOutput: {
      name: 'Sam Lee', firstName: 'Sam', lastName: 'Lee', email: '', phone: '', location: '', currentTitle: 'Data Engineer', yearsOfExperience: null,
      skills: ['SQL', 'Python'], education: [], workExperience: [], summary: 'Data engineer with SQL and Python skills.', strengths: ['SQL', 'Python'], risks: []
    },
    qualityEvaluator: 'cv_extraction',
    qualityContext: { requiredFacts: ['Sam', 'Lee', 'SQL', 'Python'], knownMissingFacts: ['email', 'phone', 'location'] }
  },
  {
    id: 'interview-analysis', activity: 'interview.analysis', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Analyze only this synthetic evidence: the candidate reduced API latency by 20% after profiling a database bottleneck, but gave no incident leadership example.' }],
    schema: strictObject({ overallAssessment: { type: 'string' }, evidence: stringArray, strengths: stringArray, concerns: stringArray, recommendation: { type: 'string' } }),
    expectedKeywords: ['20%', 'latency', 'incident leadership'],
    expectedOutput: {
      overallAssessment: 'The candidate supplied measurable performance evidence but insufficient leadership evidence.',
      evidence: ['Reduced API latency by 20% after profiling a database bottleneck.'],
      strengths: ['Grounded technical diagnosis with a measured 20% latency outcome.'],
      concerns: ['No incident leadership example was supplied.'],
      recommendation: 'Probe incident leadership before making a hiring decision.'
    },
    qualityEvaluator: 'evidence_analysis',
    qualityContext: { requiredFacts: ['20%', 'latency', 'incident leadership'], minimumLength: 180 }
  },
  {
    id: 'interview-summary', activity: 'interview.summary', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Summarize only this synthetic interview evidence: strong SQL diagnosis with a 30% query improvement; incident-response examples remained vague.' }],
    schema: strictObject({
      summary: { type: 'string' }, keyInsights: stringArray, candidateStrengths: stringArray, candidateConcerns: stringArray,
      recommendation: { type: 'string', enum: ['strong_yes', 'yes', 'maybe', 'no', 'strong_no'] }, confidence: { type: 'number', minimum: 0, maximum: 100 }, methodology: { type: 'string' }
    }),
    expectedKeywords: ['SQL', '30%', 'incident-response'],
    expectedOutput: {
      summary: 'The candidate demonstrated a grounded SQL diagnosis and reported a 30% query improvement. Incident-response evidence remained vague, so the interview does not yet support a confident decision.',
      keyInsights: ['Measured SQL performance impact.', 'Incident-response depth remains unverified.'],
      candidateStrengths: ['Diagnosed a SQL bottleneck and measured a 30% improvement.'],
      candidateConcerns: ['Gave no specific incident-response example.'],
      recommendation: 'maybe', confidence: 72,
      methodology: 'Compared supplied examples with the role evidence and marked unsupported competencies as unverified.'
    },
    qualityEvaluator: 'evidence_analysis',
    qualityContext: { requiredFacts: ['SQL', '30%', 'incident-response'], minimumLength: 220 }
  },
  {
    id: 'interview-team-feedback', activity: 'interview.team_feedback', azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: 'Synthesize only this synthetic feedback: two assessors praise system design; one assessor says delivery metrics are vague.' }],
    schema: strictObject({
      overallSentiment: { type: 'string' }, sentimentScore: { type: 'number', minimum: 0, maximum: 100 },
      consensus: strictObject({ level: { type: 'string' }, areas: { type: 'array', items: strictObject({ topic: { type: 'string' }, agreement: { type: 'string' }, details: { type: 'string' } }) } }),
      commonThemes: { type: 'array', items: strictObject({ theme: { type: 'string' }, frequency: { type: 'number' }, sentiment: { type: 'string' }, examples: stringArray }) },
      identifiedStrengths: { type: 'array', items: strictObject({ strength: { type: 'string' }, mentionedBy: { type: 'number' }, priority: { type: 'string' } }) },
      identifiedConcerns: { type: 'array', items: strictObject({ concern: { type: 'string' }, severity: { type: 'string' }, mentionedBy: { type: 'number' }, consensus: { type: 'string' } }) },
      finalRecommendation: strictObject({ decision: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 100 }, reasoning: { type: 'string' }, keyFactors: stringArray, riskFactors: stringArray, nextSteps: stringArray })
    }),
    expectedKeywords: ['system design', 'delivery metrics'],
    expectedOutput: {
      overallSentiment: 'positive', sentimentScore: 72,
      consensus: { level: 'consensus', areas: [{ topic: 'System design', agreement: 'majority', details: 'Two assessors independently praised system design.' }] },
      commonThemes: [{ theme: 'System design strength', frequency: 2, sentiment: 'positive', examples: ['Two assessors praised system design.'] }],
      identifiedStrengths: [{ strength: 'Strong system design', mentionedBy: 2, priority: 'important' }],
      identifiedConcerns: [{ concern: 'Delivery metrics were vague', severity: 'medium', mentionedBy: 1, consensus: 'single' }],
      finalRecommendation: { decision: 'maybe', confidence: 72, reasoning: 'System design evidence is consistent, but delivery impact needs validation.', keyFactors: ['System design'], riskFactors: ['Vague delivery metrics'], nextSteps: ['Probe measurable delivery outcomes.'] }
    },
    qualityEvaluator: 'evidence_analysis',
    qualityContext: { requiredFacts: ['system design', 'delivery metrics'], minimumLength: 260 }
  }
);

const genericResultSchema = strictObject({ result: { type: 'string' }, evidence: stringArray });
const genericSpecs = [
  ['recruiter-general', 'recruiter.general', 'Give a concise evidence-based answer about reducing hiring cycle time.', 'Prioritize bottleneck measurement and structured interviews.', ['bottleneck', 'structured interviews']],
  ['candidate-insights', 'candidate.insights', 'Summarize strengths in this synthetic profile: TypeScript platform engineer who reduced incidents by 35%.', 'Strong TypeScript platform experience with measured reliability impact.', ['TypeScript', '35%']],
  ['job-normalize-text', 'job.normalize', 'Normalize this title: Sr. Platform Eng.', 'Senior Platform Engineer', ['Senior Platform Engineer']],
  ['matching-report', 'matching.report', 'Explain a grounded match between Kubernetes experience and a platform reliability role.', 'The supplied Kubernetes evidence aligns with platform reliability work.', ['Kubernetes', 'reliability']],
  ['assistant-chat', 'assistant.chat', 'Answer: how should a recruiter compare two shortlisted engineers fairly?', 'Use the same job-relevant rubric and evidence for both candidates.', ['rubric', 'evidence']],
  ['assistant-title', 'assistant.title', 'Create a short title for a chat about open platform engineering roles.', 'Platform engineering roles', ['platform engineering']],
  ['analytics-candidates', 'analytics.candidates', 'Interpret synthetic candidate data: 40 applicants, 10 shortlisted.', 'The shortlist rate is 25%.', ['25%']],
  ['analytics-jobs', 'analytics.jobs', 'Interpret synthetic job data: 8 open roles, 2 overdue.', 'Two of eight open roles are overdue.', ['two', 'eight']],
  ['analytics-hiring', 'analytics.hiring', 'Interpret synthetic hiring data: median time-to-hire fell from 40 to 30 days.', 'Median time-to-hire improved by 10 days.', ['10 days']],
  ['report-analysis', 'report.analysis', 'Summarize a synthetic report showing offer acceptance rose from 70% to 80%.', 'Offer acceptance increased by 10 percentage points.', ['10 percentage points']],
  ['chat-introduction', 'ai_interview.chat.introduction', 'Introduce this question without revealing an answer: How did you improve API reliability?', 'How did you improve API reliability? You may ask for clarification or answer when ready.', ['API reliability', 'clarification']],
  ['chat-acknowledgement', 'ai_interview.chat.acknowledgement', 'Acknowledge an answer without scoring it and direct the candidate to confirm.', 'Thank you. Use the confirm button when you are ready to continue.', ['confirm']]
];

const textActivities = new Set([
  'recruiter.general',
  'candidate.insights',
  'job.normalize',
  'matching.report',
  'assistant.chat',
  'assistant.title',
  'analytics.candidates',
  'analytics.jobs',
  'analytics.hiring',
  'report.analysis',
  'ai_interview.chat.introduction',
  'ai_interview.chat.acknowledgement'
]);

fixtures.push(...genericSpecs.map(([id, activity, prompt, result, keywords]) => {
  const responseMode = textActivities.has(activity) ? 'text' : 'structured';
  const fixture = {
    id,
    activity,
    azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: prompt }],
    responseMode,
    schema: responseMode === 'structured' ? genericResultSchema : undefined,
    expectedKeywords: keywords,
    expectedOutput: responseMode === 'text' ? result : { result, evidence: keywords }
  };
  if (activity === 'ai_interview.chat.introduction') {
    fixture.qualityEvaluator = 'chat_introduction';
    fixture.qualityContext = { question: 'How did you improve API reliability?' };
  }
  if (activity === 'ai_interview.chat.acknowledgement') {
    fixture.qualityEvaluator = 'chat_acknowledgement';
    fixture.forbiddenPhrases = ['excellent answer', 'score', 'rating'];
  }
  return fixture;
}));

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
  messages: [{ role: 'user', content: JSON.stringify({ jobContext: 'Platform reliability role', questions: [{ questionIndex: 0, question: 'How did you improve API reliability?' }] }) }],
  schema: strictObject({
    analyses: {
      type: 'array',
      items: strictObject({
        questionIndex: { type: 'integer', minimum: 0 },
        overallBiasScore: { type: 'number', minimum: 0, maximum: 1 },
        isBiased: { type: 'boolean' },
        detectedBiasFactors: {
          type: 'array',
          items: strictObject({
            type: { type: 'string' },
            score: { type: 'number', minimum: 0, maximum: 1 },
            keywordsFound: stringArray,
            explanation: { type: 'string' }
          })
        },
        neutralityConfidence: { type: 'number', minimum: 0, maximum: 1 },
        recommendation: { type: 'string' }
      })
    }
  }),
  expectedKeywords: ['reliability'],
  expectedOutput: { analyses: [{ questionIndex: 0, overallBiasScore: 0, isBiased: false, detectedBiasFactors: [], neutralityConfidence: 0.95, recommendation: 'The reliability question is job-relevant and neutral.' }] },
  qualityEvaluator: 'bias'
});

module.exports = fixtures;
