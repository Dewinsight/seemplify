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
  [
    'recruiter-general',
    'recruiter.general',
    'Use only these supplied findings: recruiter-to-manager feedback is the hiring bottleneck, and structured interviews reduce avoidable rework. Give a concise answer about reducing hiring cycle time. Do not invent figures, studies, surveys, or citations.',
    'Prioritize bottleneck measurement and structured interviews.',
    [
      ['bottleneck', 'recruiter-to-manager feedback', 'feedback loop', 'recruiter input'],
      ['structured interviews', 'standardizing interviews', 'standardize interviews']
    ],
    {
      qualityEvaluator: 'grounded_text',
      qualityContext: {
        requiredFacts: [
          ['bottleneck', 'recruiter-to-manager feedback', 'feedback loop', 'recruiter input'],
          ['structured interviews', 'standardizing interviews', 'standardize interviews']
        ],
        maxWords: 80,
        rejectUnsupportedEvidence: true
      }
    }
  ],
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

fixtures.push(...genericSpecs.map(([id, activity, prompt, result, keywords, quality = {}]) => {
  const responseMode = textActivities.has(activity) ? 'text' : 'structured';
  const fixture = {
    id,
    activity,
    azureBaselineScore: 8.5,
    messages: [{ role: 'user', content: prompt }],
    responseMode,
    schema: responseMode === 'structured' ? genericResultSchema : undefined,
    expectedKeywords: keywords,
    expectedOutput: responseMode === 'text' ? result : { result, evidence: keywords },
    ...quality
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

const experienceQuestionSchema = strictObject({
  type: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, required: { type: 'boolean' }, options: stringArray, page: { type: 'integer' }
});
const assistantCitationSchema = strictObject({
  sourceRef: { type: 'string' }, excerpt: { type: 'string' }
});
const intelligenceEvidenceSchema = strictObject({
  sourceRef: { type: 'string' }, excerpt: { type: 'string' }, relevance: { type: 'string' }
});
const intelligenceFindingSchema = strictObject({
  title: { type: 'string' }, detail: { type: 'string' },
  evidence: { type: 'array', items: intelligenceEvidenceSchema }, confidence: { type: 'number' }
});
const experienceFixtures = [
  {
    id: 'experience-survey-generation', activity: 'experience.survey_generation',
    prompt: 'Create a short onboarding survey for new customers that measures effort and clarity.',
    schema: strictObject({ title: { type: 'string' }, description: { type: 'string' }, purpose: { type: 'string' }, audience: { type: 'string' }, primaryMetric: { type: 'string' }, language: { type: 'string' }, estimatedMinutes: { type: 'number' }, questions: { type: 'array', items: experienceQuestionSchema } }),
    keywords: ['Onboarding', 'effort', 'clarity'],
    output: { title: 'Customer onboarding check-in', description: 'Measure early effort and clarity.', purpose: 'customer_experience', audience: 'New customers', primaryMetric: 'ces', language: 'English', estimatedMinutes: 2, questions: [{ type: 'ces', title: 'How easy was setup?', description: 'Rate your onboarding effort.', required: true, options: [], page: 1 }, { type: 'long_text', title: 'What was unclear?', description: 'Share one improvement.', required: false, options: [], page: 1 }] }
  },
  {
    id: 'experience-response-analysis', activity: 'experience.response_analysis',
    prompt: 'Analyze only this response: setup was confusing, but support resolved the issue quickly.',
    schema: strictObject({ language: { type: 'string' }, sentiment: { type: 'string' }, sentimentScore: { type: 'number' }, confidence: { type: 'number' }, emotions: stringArray, intent: { type: 'string' }, urgency: { type: 'string' }, summary: { type: 'string' }, topics: { type: 'array', items: strictObject({ name: { type: 'string' }, sentiment: { type: 'string' }, evidence: { type: 'string' } }) }, recommendedActions: stringArray, flags: stringArray }),
    keywords: ['confusing', 'support', 'mixed'],
    output: { language: 'English', sentiment: 'neutral', sentimentScore: 0, confidence: 0.92, emotions: ['frustration', 'relief'], intent: 'product feedback', urgency: 'medium', summary: 'Mixed feedback: setup was confusing while support resolved the issue quickly.', topics: [{ name: 'Setup', sentiment: 'negative', evidence: 'setup was confusing' }, { name: 'Support', sentiment: 'positive', evidence: 'support resolved the issue quickly' }], recommendedActions: ['Simplify setup guidance.'], flags: ['mixed sentiment'] }
  },
  {
    id: 'experience-insights', activity: 'experience.insight_generation',
    prompt: 'Use supplied onboarding feedback to identify the strongest theme and a measurable action.',
    schema: strictObject({ executiveSummary: { type: 'string' }, healthScore: { type: 'number' }, keyFindings: stringArray, recommendations: stringArray }),
    keywords: ['onboarding', 'clarity', 'completion'],
    output: { executiveSummary: 'Onboarding clarity is the strongest supplied theme.', healthScore: 64, keyFindings: ['Customers report unclear setup guidance during onboarding.'], recommendations: ['Track onboarding completion after simplifying the setup guide.'] }
  },
  {
    id: 'experience-analyst-chat', activity: 'experience.analyst_chat',
    prompt: 'Answer from supplied evidence: which issue is most urgent? Response r-1 says setup blocked activation.',
    schema: strictObject({ answer: { type: 'string' }, evidence: { type: 'array', items: strictObject({ responseId: { type: 'string' }, excerpt: { type: 'string' }, relevance: { type: 'string' } }) }, caveats: stringArray, suggestedQuestions: stringArray }),
    keywords: ['setup', 'r-1', 'activation'],
    output: { answer: 'Setup friction is most urgent because it blocked activation.', evidence: [{ responseId: 'r-1', excerpt: 'setup blocked activation', relevance: 'Directly identifies the blocking issue.' }], caveats: ['Only one response was supplied.'], suggestedQuestions: ['Which setup step causes the block?'] }
  },
  {
    id: 'experience-report', activity: 'experience.report_generation',
    prompt: 'Create an executive report from supplied onboarding evidence without inventing data.',
    schema: strictObject({ title: { type: 'string' }, executiveSummary: { type: 'string' }, sections: { type: 'array', items: strictObject({ heading: { type: 'string' }, body: { type: 'string' }, evidence: stringArray }) }, recommendations: { type: 'array', items: strictObject({ action: { type: 'string' }, priority: { type: 'string' }, expectedOutcome: { type: 'string' } }) }, methodology: { type: 'string' } }),
    keywords: ['onboarding', 'setup', 'evidence'],
    output: { title: 'Onboarding experience report', executiveSummary: 'Supplied feedback identifies setup clarity as the primary issue.', sections: [{ heading: 'Setup friction', body: 'Customers describe unclear onboarding steps.', evidence: ['setup was confusing'] }], recommendations: [{ action: 'Simplify the setup guide.', priority: 'now', expectedOutcome: 'Improve onboarding completion, measured after release.' }], methodology: 'Used only supplied response evidence and deterministic metrics.' }
  },
  {
    id: 'experience-translation', activity: 'experience.translation',
    prompt: 'Translate the supplied onboarding survey into French while preserving IDs.',
    schema: strictObject({ language: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, thankYouMessage: { type: 'string' }, questions: { type: 'array', items: strictObject({ questionId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, options: stringArray }) } }),
    keywords: ['French', 'Intégration', 'q-1'],
    output: { language: 'French', title: 'Enquête sur l’intégration', description: 'Évaluez votre expérience.', thankYouMessage: 'Merci pour votre retour.', questions: [{ questionId: 'q-1', title: 'L’intégration était-elle simple ?', description: 'Évaluez l’effort requis.', options: ['Très simple', 'Difficile'] }] }
  },
  {
    id: 'experience-social-listening', activity: 'experience.social_listening',
    prompt: 'Analyze two imported public mentions: m-1 praises support; m-2 reports confusing billing.',
    schema: strictObject({ executiveSummary: { type: 'string' }, sentiment: strictObject({ positive: { type: 'number' }, neutral: { type: 'number' }, mixed: { type: 'number' }, negative: { type: 'number' } }), themes: stringArray, risks: stringArray, opportunities: stringArray, mentions: { type: 'array', items: strictObject({ mentionId: { type: 'string' }, sentiment: { type: 'string' }, summary: { type: 'string' } }) } }),
    keywords: ['m-1', 'm-2', 'billing'],
    output: { executiveSummary: 'Support is praised while billing clarity creates risk.', sentiment: { positive: 1, neutral: 0, mixed: 0, negative: 1 }, themes: ['Support quality', 'Billing clarity'], risks: ['Confusing billing'], opportunities: ['Clarify billing guidance'], mentions: [{ mentionId: 'm-1', sentiment: 'positive', summary: 'Praises support.' }, { mentionId: 'm-2', sentiment: 'negative', summary: 'Reports confusing billing.' }] }
  },
  {
    id: 'experience-journey-mapping', activity: 'experience.journey_mapping',
    prompt: 'Map a software customer journey from discovery through onboarding and adoption.',
    schema: strictObject({ name: { type: 'string' }, audience: { type: 'string' }, objective: { type: 'string' }, industry: { type: 'string' }, summary: { type: 'string' }, stages: { type: 'array', items: strictObject({ name: { type: 'string' }, touchpoints: stringArray, painPoints: stringArray, metrics: stringArray, recommendedActions: stringArray }) } }),
    keywords: ['Discovery', 'Onboarding', 'Adoption'],
    output: { name: 'Software customer journey', audience: 'New customers', objective: 'Improve activation', industry: 'Software', summary: 'A measurable path from discovery to adoption.', stages: [{ name: 'Discovery', touchpoints: ['Website'], painPoints: ['Unclear value'], metrics: ['Demo conversion'], recommendedActions: ['Clarify value proposition'] }, { name: 'Onboarding', touchpoints: ['Setup flow'], painPoints: ['Too many steps'], metrics: ['Time to value'], recommendedActions: ['Reduce setup steps'] }, { name: 'Adoption', touchpoints: ['Product'], painPoints: ['Low feature discovery'], metrics: ['Weekly active use'], recommendedActions: ['Add contextual guidance'] }] }
  },
  {
    id: 'experience-social-reply-draft', activity: 'experience.social_reply_draft',
    prompt: 'Draft a concise human-reviewed reply to a public post that says billing instructions were unclear.',
    schema: strictObject({ reply: { type: 'string' }, rationale: { type: 'string' }, safetyFlags: stringArray }),
    keywords: ['billing', 'clarity', 'review'],
    output: { reply: 'Thank you for flagging the billing instructions. We are reviewing the guidance to make it clearer.', rationale: 'Acknowledges the supplied issue without claiming it is already resolved.', safetyFlags: ['Human review required before posting.'] }
  },
  {
    id: 'experience-cross-source-intelligence', activity: 'experience.cross_source_intelligence',
    prompt: 'Synthesize supplied survey and social reports that both identify unclear billing instructions.',
    schema: strictObject({
      title: { type: 'string' }, executiveSummary: { type: 'string' }, confidence: { type: 'number' },
      themes: { type: 'array', items: intelligenceFindingSchema }, convergence: { type: 'array', items: intelligenceFindingSchema },
      divergence: { type: 'array', items: intelligenceFindingSchema }, risks: { type: 'array', items: intelligenceFindingSchema },
      opportunities: { type: 'array', items: intelligenceFindingSchema },
      recommendations: { type: 'array', items: strictObject({ action: { type: 'string' }, priority: { type: 'string' }, rationale: { type: 'string' }, evidence: { type: 'array', items: intelligenceEvidenceSchema } }) },
      limitations: stringArray
    }),
    keywords: ['billing', 'survey', 'social'],
    output: {
      title: 'Billing clarity intelligence', executiveSummary: 'Survey and social evidence both identify unclear billing instructions.', confidence: 0.9,
      themes: [{ title: 'Billing clarity', detail: 'Customers report unclear billing instructions.', evidence: [{ sourceRef: 'survey-1', excerpt: 'billing instructions were unclear', relevance: 'Direct survey evidence.' }], confidence: 0.9 }],
      convergence: [{ title: 'Shared clarity issue', detail: 'Both sources identify the same issue.', evidence: [{ sourceRef: 'survey-1', excerpt: 'billing instructions were unclear', relevance: 'Survey evidence.' }, { sourceRef: 'social-1', excerpt: 'the billing guide is confusing', relevance: 'Social evidence.' }], confidence: 0.88 }],
      divergence: [],
      risks: [{ title: 'Repeated confusion', detail: 'Unclear instructions may increase support demand.', evidence: [{ sourceRef: 'social-1', excerpt: 'the billing guide is confusing', relevance: 'Shows public confusion.' }], confidence: 0.8 }],
      opportunities: [{ title: 'Guidance revision', detail: 'Rewrite and test the billing guide.', evidence: [{ sourceRef: 'survey-1', excerpt: 'billing instructions were unclear', relevance: 'Supports a clarity intervention.' }], confidence: 0.82 }],
      recommendations: [{ action: 'Prioritise a reviewed billing-guide revision.', priority: 'now', rationale: 'Both supplied sources identify clarity problems.', evidence: [{ sourceRef: 'survey-1', excerpt: 'billing instructions were unclear', relevance: 'Supports immediate review.' }] }],
      limitations: ['Only the supplied reports were considered.']
    }
  },
  {
    id: 'experience-assistant-email-summarise', activity: 'experience.assistant.email_summarise',
    prompt: 'Summarise a supplied email requesting a reviewed onboarding brief by Friday.',
    schema: strictObject({ summary: { type: 'string' }, asks: stringArray, dates: stringArray, commitments: stringArray, risks: stringArray, limitations: stringArray }),
    keywords: ['onboarding', 'Friday', 'review'],
    output: { summary: 'The sender requests a reviewed onboarding brief by Friday.', asks: ['Review the onboarding brief.'], dates: ['Friday'], commitments: [], risks: ['The owner is not specified.'], limitations: ['Only the supplied email was considered.'] }
  },
  {
    id: 'experience-assistant-email-draft', activity: 'experience.assistant.email_draft',
    prompt: 'Draft a reply confirming that the onboarding brief will be reviewed, without sending it.',
    schema: strictObject({ subject: { type: 'string' }, body: { type: 'string' }, factsUsed: stringArray, warnings: stringArray }),
    keywords: ['onboarding', 'review', 'draft'],
    output: { subject: 'Onboarding brief review', body: 'Thank you. I have prepared this draft to confirm that the onboarding brief will be reviewed.', factsUsed: ['A review was requested.'], warnings: ['Draft only; human approval is required before sending.'] }
  },
  {
    id: 'experience-assistant-document-summarise', activity: 'experience.assistant.document_summarise',
    prompt: 'Summarise a supplied policy excerpt that requires human approval before external communication.',
    schema: strictObject({ summary: { type: 'string' }, keyPoints: stringArray, citations: { type: 'array', items: assistantCitationSchema }, limitations: stringArray }),
    keywords: ['human approval', 'external communication', 'policy-1'],
    output: { summary: 'External communication requires human approval.', keyPoints: ['AI may prepare drafts but cannot send them autonomously.'], citations: [{ sourceRef: 'policy-1', excerpt: 'Human approval is required before external communication.' }], limitations: ['Only the supplied excerpt was reviewed.'] }
  },
  {
    id: 'experience-assistant-document-compare', activity: 'experience.assistant.document_compare',
    prompt: 'Compare two supplied policy versions where only the approval threshold changed.',
    schema: strictObject({ agreements: stringArray, differences: stringArray, gaps: stringArray, risks: stringArray, citations: { type: 'array', items: assistantCitationSchema } }),
    keywords: ['approval threshold', 'policy-v1', 'policy-v2'],
    output: { agreements: ['Both versions require human review.'], differences: ['The approval threshold changed in policy-v2.'], gaps: [], risks: ['Applying the old threshold could bypass review.'], citations: [{ sourceRef: 'policy-v1', excerpt: 'Manager approval is required.' }, { sourceRef: 'policy-v2', excerpt: 'Executive approval is required.' }] }
  },
  {
    id: 'experience-assistant-meeting-prepare', activity: 'experience.assistant.meeting_prepare',
    prompt: 'Prepare a meeting pack from supplied onboarding decisions and open actions.',
    schema: strictObject({ agenda: stringArray, background: stringArray, openActions: stringArray, questions: stringArray, risks: stringArray, citations: { type: 'array', items: assistantCitationSchema } }),
    keywords: ['onboarding', 'open action', 'decision-1'],
    output: { agenda: ['Review onboarding progress.'], background: ['Decision-1 approved a simpler setup guide.'], openActions: ['Confirm the guide owner.'], questions: ['When will the revised guide be tested?'], risks: ['No owner is recorded.'], citations: [{ sourceRef: 'decision-1', excerpt: 'Approve a simpler setup guide.' }] }
  },
  {
    id: 'experience-assistant-meeting-minutes', activity: 'experience.assistant.meeting_minutes',
    prompt: 'Create draft minutes from a supplied transcript that records one decision and one open item.',
    schema: strictObject({ summary: { type: 'string' }, decisions: stringArray, proposedActions: stringArray, unresolvedItems: stringArray, transcriptSpans: stringArray }),
    keywords: ['draft minutes', 'setup guide', 'owner'],
    output: { summary: 'Draft minutes record approval of the setup-guide revision.', decisions: ['Revise the setup guide.'], proposedActions: ['Assign an owner for the revision.'], unresolvedItems: ['The owner remains unconfirmed.'], transcriptSpans: ['Revise the setup guide; owner to be confirmed.'] }
  },
  {
    id: 'experience-assistant-action-extract', activity: 'experience.assistant.action_extract',
    prompt: 'Extract the proposed action from a supplied note: Ada will review the guide by Friday.',
    schema: strictObject({ actions: { type: 'array', items: strictObject({ action: { type: 'string' }, ownerCandidate: { type: 'string' }, dueDateCandidate: { type: 'string' }, sourceSpan: { type: 'string' } }) } }),
    keywords: ['Ada', 'Friday', 'review'],
    output: { actions: [{ action: 'Review the guide.', ownerCandidate: 'Ada', dueDateCandidate: 'Friday', sourceSpan: 'Ada will review the guide by Friday.' }] }
  },
  {
    id: 'experience-assistant-knowledge-answer', activity: 'experience.assistant.knowledge_answer',
    prompt: 'Answer from supplied policy-1: may an AI assistant send external email without review?',
    schema: strictObject({ answer: { type: 'string' }, citations: { type: 'array', items: assistantCitationSchema }, confidence: { type: 'number' }, limitations: stringArray, unsupported: { type: 'boolean' } }),
    keywords: ['human approval', 'policy-1', 'cannot'],
    output: { answer: 'No. The supplied policy requires human approval before external email is sent.', citations: [{ sourceRef: 'policy-1', excerpt: 'Human approval is required before external communication.' }], confidence: 0.98, limitations: ['This answer is limited to policy-1.'], unsupported: false }
  },
  {
    id: 'experience-assistant-executive-brief', activity: 'experience.assistant.executive_brief',
    prompt: 'Create an executive brief from supplied evidence about onboarding friction and an unowned action.',
    schema: strictObject({ summary: { type: 'string' }, rankedItems: stringArray, rationale: stringArray, sourceLinks: stringArray, conflicts: stringArray, followUps: stringArray }),
    keywords: ['onboarding friction', 'owner', 'follow-up'],
    output: { summary: 'Onboarding friction is the leading supplied issue.', rankedItems: ['Clarify setup guidance.', 'Assign the open action.'], rationale: ['Both supplied sources identify setup confusion.'], sourceLinks: ['report-1', 'decision-1'], conflicts: [], followUps: ['Confirm an owner and test date.'] }
  },
  {
    id: 'experience-assistant-correspondence-draft', activity: 'experience.assistant.correspondence_draft',
    prompt: 'Draft internal correspondence requesting approval of the revised onboarding guide.',
    schema: strictObject({ subject: { type: 'string' }, body: { type: 'string' }, factsUsed: stringArray, missingInformation: stringArray, warnings: stringArray }),
    keywords: ['approval', 'onboarding guide', 'draft'],
    output: { subject: 'Approval request: revised onboarding guide', body: 'Please review the revised onboarding guide and confirm approval.', factsUsed: ['A revised guide is ready for review.'], missingInformation: ['Approval deadline'], warnings: ['Draft only; human approval is required before sending.'] }
  }
];
fixtures.push(...experienceFixtures.map((fixture) => ({
  id: fixture.id, activity: fixture.activity, azureBaselineScore: 8.5,
  messages: [{ role: 'user', content: fixture.prompt }], schema: fixture.schema,
  expectedKeywords: fixture.keywords, expectedOutput: fixture.output
})));

module.exports = fixtures;
