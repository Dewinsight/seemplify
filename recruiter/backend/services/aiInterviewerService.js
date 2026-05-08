const AzureOpenAIService = require('./azureOpenAIService');

const DEFAULT_ACK = 'Thank you. I have captured that response. When you are ready, use the confirm button to move to the next question.';
let azureOpenAIService;

const TERM_CLARIFICATIONS = [
  {
    patterns: ['cross-functional agile team', 'cross functional agile team'],
    explanation: 'A cross-functional Agile team means people from different disciplines, such as product, engineering, design, QA, operations, or business stakeholders, working together in short planning and delivery cycles.'
  },
  {
    patterns: ['cross-functional', 'cross functional'],
    explanation: 'Cross-functional means the work involved people from different roles or departments, not just one team or one skill set.'
  },
  {
    patterns: ['agile team', 'agile'],
    explanation: 'Agile refers to a way of working where a team plans, builds, reviews, and adjusts in short cycles instead of trying to define everything upfront.'
  },
  {
    patterns: ['backlog', 'product backlog'],
    explanation: 'A backlog is the prioritized list of product features, fixes, and tasks the team may work on next.'
  },
  {
    patterns: ['prioritize', 'prioritise', 'prioritizing', 'prioritising'],
    explanation: 'Prioritize means deciding which features or tasks should come first based on value, urgency, effort, dependencies, or risk.'
  },
  {
    patterns: ['business goals', 'business goal'],
    explanation: 'Business goals are the outcomes the company or team wanted, such as revenue growth, lower cost, faster delivery, customer retention, or operational efficiency.'
  },
  {
    patterns: ['customer needs', 'customer need'],
    explanation: 'Customer needs are the user problems, expectations, or pain points the product work was meant to solve.'
  },
  {
    patterns: ['requirements', 'gather requirements', 'gathering requirements'],
    explanation: 'Gathering requirements means finding out what users, stakeholders, and the business need before deciding what should be built.'
  },
  {
    patterns: ['outcome', 'result'],
    explanation: 'The outcome is what changed because of the work, such as a shipped feature, improved metric, customer feedback, reduced delay, or lesson learned.'
  },
  {
    patterns: ['specific responsibilities', 'responsibilities'],
    explanation: 'Your specific responsibilities are the parts you personally owned or influenced, separate from what the wider team did.'
  }
];

function getAzureOpenAIService() {
  if (!azureOpenAIService) {
    azureOpenAIService = new AzureOpenAIService();
  }
  return azureOpenAIService;
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

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function longestPatternLength(item) {
  return Math.max(...item.patterns.map((pattern) => pattern.length));
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

      return result.content || this.buildContextualClarification({ question, candidateMessage });
    } catch (error) {
      console.warn('AI clarification failed, using fallback:', error.message);
      return this.buildContextualClarification({ question, candidateMessage });
    }
  }

  buildContextualClarification({ question, candidateMessage }) {
    const questionText = String(question?.question || '').trim();
    const askText = normalizeText(candidateMessage);
    const normalizedQuestion = normalizeText(questionText);
    const directMatches = TERM_CLARIFICATIONS.filter((item) =>
      item.patterns.some((pattern) => askText.includes(pattern))
    ).sort((a, b) => longestPatternLength(b) - longestPatternLength(a));

    const inferredMatches = directMatches.length
      ? directMatches.slice(0, 1)
      : TERM_CLARIFICATIONS.filter((item) =>
          item.patterns.some((pattern) => normalizedQuestion.includes(pattern))
        )
          .sort((a, b) => longestPatternLength(b) - longestPatternLength(a))
          .slice(0, 1);

    if (inferredMatches.length) {
      const explanations = inferredMatches.map((item) => item.explanation).join(' ');
      return `${explanations} For this question, choose one real example, explain what you personally did, how you made decisions, and what result came from the work.`;
    }

    if (questionText) {
      return `This question is asking for one specific example from your experience. Break it down into the situation, what you were responsible for, the actions you took, and the outcome, without trying to give a perfect or theoretical answer.`;
    }

    return 'This question is asking you to explain your own experience and reasoning. Focus on a specific example, the actions you took, and the result.';
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
