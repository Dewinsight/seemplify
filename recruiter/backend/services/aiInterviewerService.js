const azureOpenAIService = require('./azureOpenAIService');

const DEFAULT_ACK = 'Thank you. I have captured that response. When you are ready, use the confirm button to move to the next question.';

function safeJsonParse(content) {
  try {
    return azureOpenAIService.extractJsonObject(content);
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
      const result = await azureOpenAIService.chatCompletion([
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

      return result.content || this.fallbackQuestionIntro(question, questionNumber, interview.questionSnapshots.length);
    } catch (error) {
      console.warn('AI question intro failed, using fallback:', error.message);
      return this.fallbackQuestionIntro(question, questionNumber, interview.questionSnapshots.length);
    }
  }

  fallbackQuestionIntro(question, questionNumber, totalQuestions) {
    return `Let's move into question ${questionNumber} of ${totalQuestions}. ${question.question}\n\nYou can ask me to clarify the question, or share your answer when you are ready.`;
  }

  isLikelyClarification(message) {
    const text = String(message || '').toLowerCase().trim();
    if (!text) return false;
    const clarificationTerms = [
      'clarify',
      'explain',
      'what do you mean',
      'more detail',
      'more details',
      'can you elaborate',
      'example',
      'understand',
      'rephrase'
    ];
    return text.endsWith('?') || clarificationTerms.some((term) => text.includes(term));
  }

  async clarifyQuestion({ interview, session, question, questionNumber, candidateMessage }) {
    try {
      const context = this.buildBaseContext({ interview, session, question, questionNumber });
      const result = await azureOpenAIService.chatCompletion([
        {
          role: 'system',
          content: `You are clarifying one interview question for a candidate.
Use only the current question and the candidate-facing guidelines.
Do not answer the question for the candidate.
Do not add a new assessment question.
Do not reveal expected answers, rubrics, or scoring criteria.
Keep the clarification brief and useful.`
        },
        {
          role: 'user',
          content: `${context}\n\nCandidate asks: ${truncate(candidateMessage, 800)}\n\nClarify the question in 2-4 sentences.`
        }
      ], { temperature: 0.35, maxTokens: 260 });

      return result.content || 'This question is asking you to explain your own experience and reasoning. Focus on a specific example, the actions you took, and the result.';
    } catch (error) {
      console.warn('AI clarification failed, using fallback:', error.message);
      return 'This question is asking you to explain your own experience and reasoning. Focus on a specific example, the actions you took, and the result.';
    }
  }

  async acknowledgeAnswer({ interview, session, question, candidateMessage }) {
    try {
      const result = await azureOpenAIService.chatCompletion([
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

      return result.content || DEFAULT_ACK;
    } catch (error) {
      console.warn('AI acknowledgement failed, using fallback:', error.message);
      return DEFAULT_ACK;
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

    const fallback = this.buildFallbackScore(scoringQuestions);

    try {
      const result = await azureOpenAIService.chatCompletion([
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
      if (!parsed) return fallback;

      return {
        overallScore: Math.max(0, Math.min(100, Number(parsed.overallScore) || 0)),
        recommendation: parsed.recommendation || fallback.recommendation,
        summary: parsed.summary || fallback.summary,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : fallback.strengths,
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 6) : fallback.concerns,
        questionScores: Array.isArray(parsed.questionScores)
          ? parsed.questionScores.map((item, index) => ({
              questionIndex: Number.isInteger(item.questionIndex) ? item.questionIndex : index,
              score: Math.max(1, Math.min(5, Number(item.score) || 1)),
              rationale: item.rationale || ''
            }))
          : fallback.questionScores,
        raw: parsed
      };
    } catch (error) {
      console.warn('AI scoring failed, using fallback:', error.message);
      return {
        ...fallback,
        error: error.message
      };
    }
  }

  buildFallbackScore(scoringQuestions) {
    const answered = scoringQuestions.filter((item) => item.answer && item.status === 'answered');
    const completionRatio = scoringQuestions.length > 0 ? answered.length / scoringQuestions.length : 0;
    const overallScore = Math.round(completionRatio * 60);

    return {
      overallScore,
      recommendation: overallScore >= 70 ? 'yes' : overallScore >= 40 ? 'maybe' : 'no',
      summary: answered.length
        ? 'The candidate completed part of the interview. AI scoring was unavailable, so this fallback score is based on completion only.'
        : 'The candidate did not provide enough completed answers for a meaningful score.',
      strengths: answered.length ? ['Provided responses to one or more selected questions'] : [],
      concerns: scoringQuestions.length !== answered.length ? ['Some questions were skipped, timed out, or left unanswered'] : [],
      questionScores: scoringQuestions.map((item) => ({
        questionIndex: item.questionIndex,
        score: item.answer && item.status === 'answered' ? 3 : 1,
        rationale: item.answer && item.status === 'answered' ? 'Answer captured; detailed AI scoring unavailable.' : 'No completed answer captured.'
      }))
    };
  }
}

module.exports = new AIInterviewerService();
