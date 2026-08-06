const { chatCompletion, extractJsonObject } = require('./llmClient');
const { assessGeneratedQuestions, repairInstructions } = require('./questionQuality');

const GENERATED_QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'type', 'difficulty', 'category', 'expectedAnswer', 'scoringCriteria', 'followUpQuestions', 'tags', 'timeLimit'],
        properties: {
          question: { type: 'string' },
          type: { type: 'string' },
          difficulty: { type: 'string' },
          category: { type: 'string' },
          expectedAnswer: { type: 'string' },
          scoringCriteria: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['criterion', 'weight', 'description'],
              properties: {
                criterion: { type: 'string' },
                weight: { type: 'number' },
                description: { type: 'string' }
              }
            }
          },
          followUpQuestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question', 'condition'],
              properties: { question: { type: 'string' }, condition: { type: 'string' } }
            }
          },
          tags: { type: 'array', items: { type: 'string' } },
          timeLimit: { type: 'number', minimum: 3, maximum: 20 }
        }
      }
    }
  }
};

function distributeQuestionTypes(includeTypes, totalCount) {
  const types = Array.isArray(includeTypes) && includeTypes.length
    ? includeTypes
    : ['technical', 'behavioral', 'situational'];
  const count = Math.max(1, Number(totalCount) || 5);
  const base = Math.floor(count / types.length);
  const remainder = count % types.length;
  return types.flatMap((type, index) => Array(base + (index < remainder ? 1 : 0)).fill(type));
}

function normalizeCriteria(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { criterion: item, weight: 10, description: `Evaluate ${item}` };
      }
      return {
        criterion: String(item?.criterion || '').trim(),
        weight: Math.max(0, Number(item?.weight || 10)),
        description: String(item?.description || item?.criterion || '').trim()
      };
    })
    .filter((item) => item.criterion);
}

function normalizeFollowUps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { question: item, condition: 'If the answer needs more detail' };
      return {
        question: String(item?.question || '').trim(),
        condition: String(item?.condition || 'If the answer needs more detail').trim()
      };
    })
    .filter((item) => item.question);
}

function buildJobContext(job) {
  return [
    `Title: ${job.title}`,
    `Department: ${job.department || 'Not specified'}`,
    `Level: ${job.level || 'Not specified'}`,
    `Location: ${job.location || 'Not specified'}`,
    `Type: ${job.type || 'Not specified'}`,
    `Skills: ${Array.isArray(job.skills) ? job.skills.join(', ') : job.skills || 'Not specified'}`,
    `Description: ${job.description || 'Not specified'}`,
    `Requirements: ${job.requirements || 'Not specified'}`,
    `Responsibilities: ${job.responsibilities || 'Not specified'}`
  ].join('\n');
}

class QuestionGeneratorService {
  constructor({ completion = chatCompletion, parseJson = extractJsonObject } = {}) {
    this.completion = completion;
    this.parseJson = parseJson;
  }

  async generateForJob(job, options = {}) {
    const questionCount = Math.max(1, Math.min(20, Number(options.questionCount || 5)));
    const difficulty = String(options.difficulty || 'medium');
    const typePlan = distributeQuestionTypes(options.includeTypes, questionCount);
    const prompt = `Generate ${questionCount} interview questions for this job.

JOB CONTEXT:
${buildJobContext(job)}

TYPE PLAN:
${typePlan.map((type, index) => `${index + 1}. ${type}`).join('\n')}

FOCUS AREAS:
${Array.isArray(options.focusAreas) && options.focusAreas.length ? options.focusAreas.join(', ') : 'Use the job description and required skills.'}

Return JSON only:
{
  "questions": [
    {
      "question": "candidate-facing question",
      "type": "technical | behavioral | situational | cultural_fit | skills_based | experience_based",
      "difficulty": "${difficulty}",
      "category": "short category",
      "expectedAnswer": "recruiter-only scoring guidance",
      "scoringCriteria": [{"criterion": "criterion", "weight": 10, "description": "what to look for"}],
      "followUpQuestions": [{"question": "optional follow-up", "condition": "when to ask"}],
      "tags": ["skill"],
      "timeLimit": 5
    }
  ]
}`;

    const systemMessage = `You are an expert interview question generator.
Create job-specific, legally compliant, unbiased questions.
Questions must assess the actual role, skills, responsibilities, and seniority.
Do not generate generic questions when job details are available.
Each question must use a realistic decision or scenario from the job context.
Provide three or four distinct scoring criteria whose weights total 100, a useful follow-up, and at least two role-relevant tags.
Hard questions must include ambiguity, scale, failure, risk, or competing trade-offs.
Do not treat the role title alone as grounding; anchor each question in a named skill, deliverable, stakeholder, metric, system, or responsibility.
Expected-answer guidance must be unique to the question and identify evidence, decisions, trade-offs, and measurable outcomes.
Follow-ups must probe missing evidence rather than paraphrase the main question.
Weak example: "Describe your approach to solving complex technical problems."
Strong pattern: give a realistic job-specific situation with a concrete constraint, then ask for the decision process, evidence, trade-offs, and success measure.
Silently self-check count, type, difficulty, distinct scenarios, protected-trait safety, criteria weights, and grounding before returning JSON.
Return valid JSON only.`;
    let userMessage = prompt;
    let lastAssessment = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.completion([
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ], {
        activity: 'ai_interview.question_generation',
        promptVersion: 'ai-interview-questions-v3',
        temperature: 0.6,
        maxTokens: 3600,
        response_format: { type: 'json_object' },
        jsonSchema: GENERATED_QUESTIONS_SCHEMA,
        schemaName: 'ai_interview_questions',
        context: options.context || {}
      });

      const parsed = this.parseJson(result.content);
      const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const normalized = rawQuestions.map((question, index) => {
        const plannedType = typePlan[index] || question.type || 'behavioral';
        return {
        question: String(question.question || '').trim(),
        type: String(question.type || plannedType || 'behavioral').trim(),
        category: String(question.category || '').trim(),
        difficulty: String(question.difficulty || difficulty).trim(),
        expectedAnswer: String(question.expectedAnswer || '').trim(),
        scoringCriteria: normalizeCriteria(question.scoringCriteria),
        followUpQuestions: normalizeFollowUps(question.followUpQuestions),
        tags: Array.isArray(question.tags) ? question.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        timeLimit: Math.max(3, Math.min(20, Number(question.timeLimit || 5))),
        isAIGenerated: true,
        aiGenerationMetadata: {
          model: result.model,
          generatedAt: new Date().toISOString(),
          promptVersion: 'ai-interview-questions-v3',
          requestId: result.requestId
        }
      };
      });
      const assessment = assessGeneratedQuestions(normalized, { job, expectedCount: questionCount, typePlan, difficulty });
      lastAssessment = assessment;
      if (assessment.passed) {
        return normalized.map((question, index) => ({
          ...question,
          qualityMetrics: {
            semanticQualityScore: assessment.questions[index]?.score ?? assessment.score,
            qualityIssues: [],
            analysisStatus: 'pending'
          }
        }));
      }
      if (attempt === 1) userMessage = prompt + repairInstructions(assessment);
    }

    const error = new Error(`AI question generation failed semantic quality checks: ${lastAssessment?.issues?.join(' ') || 'No usable questions returned.'}`);
    error.code = 'AI_QUESTION_QUALITY_FAILED';
    error.statusCode = 503;
    throw error;
  }
}

const questionGeneratorService = new QuestionGeneratorService();
module.exports = questionGeneratorService;
module.exports.QuestionGeneratorService = QuestionGeneratorService;
module.exports.GENERATED_QUESTIONS_SCHEMA = GENERATED_QUESTIONS_SCHEMA;
