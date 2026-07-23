const AIModelService = require('./aiModelService');
const {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction,
  repairInstruction
} = require('./aiInterviewerResponseQuality');
const { assertInterviewScoreQuality } = require('./interviewScoreQuality');

const INTERVIEW_SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallScore', 'recommendation', 'summary', 'strengths', 'concerns', 'questionScores'],
  properties: {
    overallScore: { type: 'number', minimum: 0, maximum: 100 },
    recommendation: { type: 'string', enum: ['strong_yes', 'yes', 'maybe', 'no'] },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    questionScores: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['questionIndex', 'score', 'rationale'],
        properties: {
          questionIndex: { type: 'integer', minimum: 0 },
          score: { type: 'number', minimum: 1, maximum: 5 },
          rationale: { type: 'string' }
        }
      }
    }
  }
};

let aiModelService;

function getAIModelService() {
  if (!aiModelService) {
    aiModelService = new AIModelService();
  }
  return aiModelService;
}

class AIModelUnavailableError extends Error {
  constructor(operation, cause) {
    super(`AI model failed during ${operation}: ${cause?.message || 'empty model response'}`);
    this.name = 'AIModelUnavailableError';
    this.code = 'AI_MODEL_UNAVAILABLE';
    this.statusCode = 503;
    this.cause = cause;
  }
}

function safeJsonParse(content) {
  try {
    return getAIModelService().extractJsonObject(content);
  } catch (_error) {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

function truncate(value, max = 1600) {
  if (!value) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function requireModelContent(result, operation) {
  const content = String(result?.content || '').trim();
  if (!content) {
    throw new AIModelUnavailableError(operation);
  }
  return content;
}

class AIInterviewerService {
  buildTelemetryContext({ interview, session }) {
    return {
      organizationId: interview?.organization?._id || interview?.organization || session?.organization,
      organizationName: interview?.organization?.name,
      actorId: interview?.createdBy?._id || interview?.createdBy,
      interviewId: interview?._id,
      sessionId: session?._id,
      candidateId: session?.candidate,
      jobId: interview?.job
    };
  }

  buildBaseContext({ interview, session, question, questionNumber }) {
    return [
      `Interview title: ${interview.title}`,
      `Candidate: ${session.candidateSnapshot?.name || 'Candidate'}`,
      `Question ${questionNumber} of ${interview.questionSnapshots.length}: ${question.question}`,
      `Candidate guidelines: ${interview.guidelines || 'No custom guidelines provided.'}`,
    ].join('\n');
  }

  async completeWithQualityGate({ messages, options, assess, kind, operation }) {
    let attemptMessages = messages;
    let lastAssessment = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await getAIModelService().chatCompletion(attemptMessages, options);
      const content = requireModelContent(result, operation);
      const assessment = assess(content);
      lastAssessment = assessment;
      if (assessment.passed) return content;
      if (attempt === 1) {
        attemptMessages = [
          ...messages,
          { role: 'assistant', content: truncate(content, 1000) },
          { role: 'user', content: repairInstruction(kind, assessment) }
        ];
      }
    }
    const error = new Error(`${operation} failed semantic quality checks: ${lastAssessment?.issues?.join(' ') || 'unknown quality issue'}`);
    error.code = 'AI_RESPONSE_QUALITY_FAILED';
    error.statusCode = 503;
    throw error;
  }

  async introduceQuestion({ interview, session, question, questionNumber }) {
    try {
      const context = this.buildBaseContext({ interview, session, question, questionNumber });
      return await this.completeWithQualityGate({
        messages: [
        {
          role: 'system',
          content: `You are a professional AI interviewer.
Ask only the current interview question.
Keep the wording conversational but preserve the meaning of the exact question.
Do not add extra assessment questions.
Do not reveal scoring criteria or expected answers.
End by telling the candidate they can ask for clarification or answer when ready.
Good pattern: "Let's focus on a specific situation. [Current question] You can ask me to clarify anything, or answer when you are ready."`
        },
        {
          role: 'user',
          content: `${context}\n\nWrite the interviewer message for this question in 2-4 concise sentences.`
        }
        ],
        options: {
          activity: 'ai_interview.chat.introduction',
          promptVersion: 'ai-interview-introduction-v2',
          context: this.buildTelemetryContext({ interview, session }),
          temperature: 0.25,
          maxTokens: 320
        },
        assess: (content) => assessIntroduction(content, question.question),
        kind: 'question introduction',
        operation: 'question introduction'
      });
    } catch (error) {
      console.warn('AI question intro failed:', error.message);
      return `${question.question}\n\nYou can ask for clarification or answer when you are ready.`;
    }
  }

  isLikelyClarification(message) {
    const text = String(message || '').toLowerCase().trim();
    if (!text) return false;
    const clarificationTerms = [
      'clarify',
      'explain',
      'what do you mean',
      'what do they mean',
      'what does',
      'what does this mean',
      'what does that mean',
      'what does it mean',
      "what's",
      'whats',
      'what is',
      'what are',
      'mean by',
      'meaning of',
      'define',
      'definition',
      'more detail',
      'more details',
      'can you elaborate',
      'elaborate',
      'example',
      'understand',
      'rephrase',
      'break down',
      'not sure',
      "don't understand",
      'do not understand',
      'help me understand'
    ];
    const hasClarificationTerm = clarificationTerms.some((term) => text.includes(term));
    if (hasClarificationTerm) return true;

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return text.endsWith('?') && wordCount <= 24;
  }

  async clarifyQuestion({ interview, session, question, questionNumber, candidateMessage }) {
    try {
      const context = this.buildBaseContext({ interview, session, question, questionNumber });
      return await this.completeWithQualityGate({
        messages: [
        {
          role: 'system',
          content: `You are clarifying one interview question for a candidate.
Answer the candidate's exact clarification request.
If they ask what a term means, define that term in the context of the current question.
If they ask to rephrase the question, rephrase the current question without changing what is being assessed.
Start with the specific term or phrase they asked about when one is present.
Avoid generic restatements such as "this question is asking you to explain your experience" unless the candidate asked for a broad rephrase.
Use only the current question and the candidate-facing guidelines.
Do not answer the question for the candidate.
Do not add a new assessment question.
Do not reveal expected answers, rubrics, or scoring criteria.
Keep the clarification brief, practical, and specific to the candidate's question.
Good pattern for "What does rollback threshold mean?": "A rollback threshold is the measurable condition that tells a team to reverse a change. In this question, explain which signal you would choose and why, without trying to guess a preferred answer."`
        },
        {
          role: 'user',
          content: `${context}\n\nCandidate asks: ${truncate(candidateMessage, 800)}\n\nClarify only what the candidate asked in 2-4 sentences.`
        }
        ],
        options: {
          activity: 'ai_interview.chat.clarification',
          promptVersion: 'ai-interview-clarification-v2',
          context: this.buildTelemetryContext({ interview, session }),
          temperature: 0.2,
          maxTokens: 320
        },
        assess: (content) => assessClarification(content, { question: question.question, candidateMessage }),
        kind: 'clarification',
        operation: 'question clarification'
      });
    } catch (error) {
      console.warn('AI clarification failed:', error.message);
      if (error.code === 'AI_MODEL_UNAVAILABLE') throw error;
      throw new AIModelUnavailableError('question clarification', error);
    }
  }

  async acknowledgeAnswer({ interview, session, question, candidateMessage }) {
    try {
      return await this.completeWithQualityGate({
        messages: [
        {
          role: 'system',
          content: `You are an AI interviewer acknowledging a candidate answer.
Do not score the answer.
Do not ask a follow-up assessment question.
Tell the candidate to use the confirm button when ready to move on.
Good response: "Thank you. I have recorded your response. Use the Confirm button when you are ready to move to the next question."`
        },
        {
          role: 'user',
          content: `Question: ${question.question}\nCandidate answer: ${truncate(candidateMessage, 1200)}\nInterview title: ${interview.title}\nCandidate: ${session.candidateSnapshot?.name || 'Candidate'}`
        }
        ],
        options: {
          activity: 'ai_interview.chat.acknowledgement',
          promptVersion: 'ai-interview-acknowledgement-v2',
          context: this.buildTelemetryContext({ interview, session }),
          temperature: 0.2,
          maxTokens: 220
        },
        assess: assessAcknowledgement,
        kind: 'acknowledgement',
        operation: 'answer acknowledgement'
      });
    } catch (error) {
      console.warn('AI acknowledgement failed:', error.message);
      return 'Thank you. Use the confirm button when you are ready to move to the next question.';
    }
  }

  async scoreInterview({ interview, session }) {
    const scoringQuestions = interview.questionSnapshots.map((question, index) => {
      const answer = session.answers.find((item) => item.questionIndex === index);
      return {
        questionIndex: index,
        question: question.question,
        expectedAnswer: question.expectedAnswer || '',
        scoringCriteria: question.scoringCriteria || [],
        answer: answer?.answer || '',
        status: answer?.status || 'skipped',
        timeSpentSeconds: answer?.timeSpentSeconds || 0
      };
    });

    try {
      const result = await getAIModelService().structuredCompletion([
        {
          role: 'system',
          content: `You score async interview responses for recruiters.
Return JSON only with this shape:
{
  "overallScore": number from 0 to 100,
  "recommendation": "strong_yes" | "yes" | "maybe" | "no",
  "summary": string,
  "strengths": string[],
  "concerns": string[],
  "questionScores": [{"questionIndex": number, "score": number from 1 to 5, "rationale": string}]
}
Use the expected answer and scoring criteria only for scoring. Do not include hidden criteria verbatim in the summary.
Return exactly one questionScores entry for every supplied questionIndex, with no duplicates.
Ground every rationale, strength, concern, and summary claim only in the candidate's supplied answer.
Give skipped, timed-out, or empty answers a score of 1 and identify the missing evidence.
Keep overallScore mathematically consistent with the per-question scores.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            title: interview.title,
            guidelines: interview.guidelines,
            candidate: session.candidateSnapshot?.name,
            questions: scoringQuestions
          })
        }
      ], {
        activity: 'ai_interview.scoring',
        context: this.buildTelemetryContext({ interview, session }),
        temperature: 0.2,
        maxTokens: 1200,
        jsonSchema: INTERVIEW_SCORE_SCHEMA,
        schemaName: 'ai_interview_score',
        promptVersion: 'ai-interview-scoring-v3'
      });

      const parsed = result.data || safeJsonParse(result.content);
      if (!parsed) {
        throw new AIModelUnavailableError('interview scoring', new Error('Invalid JSON model response'));
      }
      assertInterviewScoreQuality(parsed, scoringQuestions);

      return {
        overallScore: Math.max(0, Math.min(100, Number(parsed.overallScore) || 0)),
        recommendation: parsed.recommendation || 'maybe',
        summary: parsed.summary || '',
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : [],
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 6) : [],
        questionScores: Array.isArray(parsed.questionScores)
          ? parsed.questionScores.map((item, index) => ({
              questionIndex: Number.isInteger(item.questionIndex) ? item.questionIndex : index,
              score: Math.max(1, Math.min(5, Number(item.score) || 1)),
              rationale: item.rationale || ''
            }))
          : [],
        raw: parsed
      };
    } catch (error) {
      console.warn('AI scoring failed:', error.message);
      if (error.code === 'AI_MODEL_UNAVAILABLE') throw error;
      throw new AIModelUnavailableError('interview scoring', error);
    }
  }
}

module.exports = new AIInterviewerService();
