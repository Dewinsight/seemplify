const { chatCompletion, extractJsonObject } = require('./llmClient');

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

    const result = await chatCompletion([
      {
        role: 'system',
        content: `You are an expert interview question generator.
Create job-specific, legally compliant, unbiased questions.
Questions must assess the actual role, skills, responsibilities, and seniority.
Do not generate generic questions when job details are available.
Return valid JSON only.`
      },
      { role: 'user', content: prompt }
    ], {
      temperature: 0.75,
      maxTokens: 2400,
      response_format: { type: 'json_object' }
    });

    const parsed = extractJsonObject(result.content);
    const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (!rawQuestions.length) throw new Error('AI did not return generated questions.');

    return rawQuestions.slice(0, questionCount).map((question, index) => {
      const plannedType = typePlan[index] || question.type || 'behavioral';
      return {
        question: String(question.question || '').trim(),
        type: String(question.type || plannedType || 'behavioral').trim(),
        category: String(question.category || '').trim(),
        difficulty: String(question.difficulty || difficulty).trim(),
        expectedAnswer: String(question.expectedAnswer || 'Look for a specific example, clear reasoning, and measurable outcome.').trim(),
        scoringCriteria: normalizeCriteria(question.scoringCriteria),
        followUpQuestions: normalizeFollowUps(question.followUpQuestions),
        tags: Array.isArray(question.tags) ? question.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        timeLimit: Math.max(3, Math.min(20, Number(question.timeLimit || 5))),
        isAIGenerated: true,
        aiGenerationMetadata: {
          model: result.model,
          generatedAt: new Date().toISOString(),
          promptVersion: 'standalone-ai-interview-v1'
        }
      };
    }).filter((question) => question.question.length >= 10);
  }
}

module.exports = new QuestionGeneratorService();
