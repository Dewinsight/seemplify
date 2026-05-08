const AzureOpenAIService = require('./azureOpenAIService');

let azureOpenAIService;

function getAzureOpenAIService() {
  if (!azureOpenAIService) {
    azureOpenAIService = new AzureOpenAIService();
  }
  return azureOpenAIService;
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
    return getAzureOpenAIService().extractJsonObject(content);
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
  buildBaseContext({ interview, session, question, questionNumber }) {
    return [
      `Interview title: ${interview.title}`,
      `Candidate: ${session.candidateSnapshot?.name || 'Candidate'}`,
      `Question ${questionNumber} of ${interview.questionSnapshots.length}: ${question.question}`,
      `Candidate guidelines: ${interview.guidelines || 'No custom guidelines provided.'}`,
    ].join('\n');
  }

  async introduceQuestion({ interview, session, question, questionNumber }) {
    try {
      const context = this.buildBaseContext({ interview, session, question, questionNumber });
      const result = await getAzureOpenAIService().chatCompletion([
        {
          role: 'system',
          content: `You are a professional AI interviewer.
Ask only the current interview question.
Keep the wording conversational but preserve the meaning of the exact question.
Do not add extra assessment questions.
Do not reveal scoring criteria or expected answers.
End by telling the candidate they can ask for clarification or answer when ready.`
        },
        {
          role: 'user',
          content: `${context}\n\nWrite the interviewer message for this question in 2-4 concise sentences.`
        }
      ], { temperature: 0.45, maxTokens: 260 });

      return requireModelContent(result, 'question introduction');
    } catch (error) {
      console.warn('AI question intro failed:', error.message);
      if (error.code === 'AI_MODEL_UNAVAILABLE') throw error;
      throw new AIModelUnavailableError('question introduction', error);
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
    return text.endsWith('?') || clarificationTerms.some((term) => text.includes(term));
  }

  async clarifyQuestion({ interview, session, question, questionNumber, candidateMessage }) {
    try {
      const context = this.buildBaseContext({ interview, session, question, questionNumber });
      const result = await getAzureOpenAIService().chatCompletion([
        {
          role: 'system',
          content: `You are clarifying one interview question for a candidate.
Answer the candidate's exact clarification request.
If they ask what a term means, define that term in the context of the current question.
If they ask to rephrase the question, rephrase the current question without changing what is being assessed.
Use only the current question and the candidate-facing guidelines.
Do not answer the question for the candidate.
Do not add a new assessment question.
Do not reveal expected answers, rubrics, or scoring criteria.
Keep the clarification brief, practical, and specific to the candidate's question.`
        },
        {
          role: 'user',
          content: `${context}\n\nCandidate asks: ${truncate(candidateMessage, 800)}\n\nClarify only what the candidate asked in 2-4 sentences.`
        }
      ], { temperature: 0.35, maxTokens: 260 });

      return requireModelContent(result, 'question clarification');
    } catch (error) {
      console.warn('AI clarification failed:', error.message);
      if (error.code === 'AI_MODEL_UNAVAILABLE') throw error;
      throw new AIModelUnavailableError('question clarification', error);
    }
  }

  async acknowledgeAnswer({ interview, session, question, candidateMessage }) {
    try {
      const result = await getAzureOpenAIService().chatCompletion([
        {
          role: 'system',
          content: `You are an AI interviewer acknowledging a candidate answer.
Do not score the answer.
Do not ask a follow-up assessment question.
Tell the candidate to use the confirm button when ready to move on.`
        },
        {
          role: 'user',
          content: `Question: ${question.question}\nCandidate answer: ${truncate(candidateMessage, 1200)}\nInterview title: ${interview.title}\nCandidate: ${session.candidateSnapshot?.name || 'Candidate'}`
        }
      ], { temperature: 0.35, maxTokens: 180 });

      return requireModelContent(result, 'answer acknowledgement');
    } catch (error) {
      console.warn('AI acknowledgement failed:', error.message);
      if (error.code === 'AI_MODEL_UNAVAILABLE') throw error;
      throw new AIModelUnavailableError('answer acknowledgement', error);
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
      const result = await getAzureOpenAIService().chatCompletion([
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
Use the expected answer and scoring criteria only for scoring. Do not include hidden criteria verbatim in the summary. Penalize missing, skipped, or timed-out answers.`
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
        temperature: 0.2,
        maxTokens: 1200,
        response_format: { type: 'json_object' }
      });

      const parsed = safeJsonParse(result.content);
      if (!parsed) {
        throw new AIModelUnavailableError('interview scoring', new Error('Invalid JSON model response'));
      }

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
