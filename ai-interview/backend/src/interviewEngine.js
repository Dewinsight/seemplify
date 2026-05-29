const { iso, addMinutes } = require('./store');
const aiInterviewerService = require('./aiInterviewerService');

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'expired', 'cancelled', 'proctor_failed']);

function nowIso() {
  return iso(new Date());
}

function getCandidateName(session) {
  return session?.candidateSnapshot?.firstName || session?.candidateSnapshot?.name || 'there';
}

function addMessage(session, role, content, questionIndex = null, messageType = 'system') {
  const message = {
    _id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || '').trim(),
    questionIndex,
    messageType,
    createdAt: nowIso()
  };
  if (message.content) session.messages.push(message);
  return message;
}

async function introduceCurrentQuestion(interview, session) {
  const question = interview.questionSnapshots[session.currentQuestionIndex];
  if (!question) return;
  const questionNumber = session.currentQuestionIndex + 1;
  const content = await aiInterviewerService.introduceQuestion({
    interview,
    session,
    question,
    questionNumber
  });
  addMessage(
    session,
    'ai',
    content,
    session.currentQuestionIndex,
    'question'
  );
}

async function startSession(interview, session) {
  if (TERMINAL_SESSION_STATUSES.has(session.status)) return;
  const startedAt = new Date();
  session.status = 'in_progress';
  session.startedAt = session.startedAt || iso(startedAt);
  session.lastActivityAt = iso(startedAt);
  session.questionStartedAt = iso(startedAt);
  session.questionDeadlineAt = iso(addMinutes(startedAt, interview.timers?.perQuestionMinutes || 10));
  session.totalDeadlineAt = session.totalDeadlineAt || iso(addMinutes(startedAt, interview.timers?.totalMinutes || 45));

  if (!session.messages.some((message) => message.messageType === 'greeting')) {
    addMessage(
      session,
      'ai',
      `Hello ${getCandidateName(session)}. Thanks for joining this AI interview. There are ${interview.questionSnapshots.length} questions, and I will guide you through them one at a time.`,
      null,
      'greeting'
    );
  }

  if (!session.messages.some((message) => message.questionIndex === session.currentQuestionIndex && message.messageType === 'question')) {
    await introduceCurrentQuestion(interview, session);
  }
}

async function clarify(interview, session, candidateMessage) {
  const question = interview.questionSnapshots[session.currentQuestionIndex];
  const content = await aiInterviewerService.clarifyQuestion({
    interview,
    session,
    question,
    questionNumber: session.currentQuestionIndex + 1,
    candidateMessage
  });
  addMessage(session, 'ai', content, session.currentQuestionIndex, 'clarification');
}

async function acknowledge(interview, session, candidateMessage) {
  const question = interview.questionSnapshots[session.currentQuestionIndex];
  const content = await aiInterviewerService.acknowledgeAnswer({
    interview,
    session,
    question,
    candidateMessage
  });
  addMessage(
    session,
    'ai',
    content,
    session.currentQuestionIndex,
    'acknowledgement'
  );
}

function upsertAnswer(interview, session, answerText, status = 'answered') {
  const question = interview.questionSnapshots[session.currentQuestionIndex];
  const existing = session.answers.find((answer) => answer.questionIndex === session.currentQuestionIndex);
  const submittedAt = new Date();
  const startedAt = session.questionStartedAt ? new Date(session.questionStartedAt) : submittedAt;
  const payload = {
    questionIndex: session.currentQuestionIndex,
    questionId: question?.questionId,
    question: question?.question || '',
    answer: String(answerText || '').trim(),
    status,
    submittedAt: iso(submittedAt),
    timeSpentSeconds: Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000))
  };

  if (existing) {
    Object.assign(existing, payload);
  } else {
    session.answers.push(payload);
  }
}

async function scoreSession(interview, session) {
  session.scoring = { status: 'processing', startedAt: nowIso() };
  const score = await aiInterviewerService.scoreInterview({ interview, session });
  session.scoring = {
    status: 'completed',
    ...score,
    scoredAt: nowIso()
  };
}

async function sendMessage(interview, session, message) {
  if (session.status !== 'in_progress') return;
  addMessage(session, 'candidate', message, session.currentQuestionIndex, 'answer');
  session.lastActivityAt = nowIso();

  if (aiInterviewerService.isLikelyClarification(message)) {
    await clarify(interview, session, message);
  } else {
    upsertAnswer(interview, session, message, 'answered');
    await acknowledge(interview, session, message);
  }
}

async function confirmQuestion(interview, session, status = 'skipped') {
  if (session.status !== 'in_progress') return;
  const existingAnswer = session.answers.find((answer) => answer.questionIndex === session.currentQuestionIndex);
  if (!existingAnswer) {
    upsertAnswer(interview, session, '', status);
  }

  if (session.currentQuestionIndex >= interview.questionSnapshots.length - 1) {
    session.status = 'completed';
    session.completedAt = nowIso();
    session.lastActivityAt = session.completedAt;
    addMessage(session, 'ai', 'Thank you. Your AI interview is complete, and your responses have been submitted.', session.currentQuestionIndex, 'system');
    await scoreSession(interview, session);
    return;
  }

  session.currentQuestionIndex += 1;
  const startedAt = new Date();
  session.questionStartedAt = iso(startedAt);
  session.questionDeadlineAt = iso(addMinutes(startedAt, interview.timers?.perQuestionMinutes || 10));
  session.lastActivityAt = iso(startedAt);
  addMessage(session, 'ai', `We are moving to question ${session.currentQuestionIndex + 1} of ${interview.questionSnapshots.length}.`, session.currentQuestionIndex, 'transition');
  await introduceCurrentQuestion(interview, session);
}

function syncStats(store, interviewId) {
  const interview = store.interviews.find((item) => item._id === interviewId);
  if (!interview) return;
  const sessions = store.sessions.filter((session) => session.aiInterview === interviewId);
  interview.candidateCount = sessions.length;
  interview.stats = {
    sent: sessions.filter((session) => session.status === 'sent').length,
    opened: sessions.filter((session) => session.status === 'opened').length,
    inProgress: sessions.filter((session) => session.status === 'in_progress').length,
    completed: sessions.filter((session) => session.status === 'completed').length,
    blocked: sessions.filter((session) => session.status === 'wallet_blocked').length,
    failed: sessions.filter((session) => session.status === 'email_failed' || session.status === 'wallet_error').length,
    proctorFailed: sessions.filter((session) => session.status === 'proctor_failed').length
  };
  if (sessions.length && sessions.every((session) => ['completed', 'expired', 'cancelled', 'proctor_failed'].includes(session.status))) {
    interview.status = sessions.some((session) => session.status === 'completed') ? 'completed' : interview.status;
  } else if (interview.status === 'completed') {
    interview.status = new Date(interview.schedule?.sendAt || Date.now()) <= new Date() ? 'active' : 'scheduled';
  }
  interview.updatedAt = nowIso();
}

function buildScoringSummary(sessions) {
  const rankings = sessions
    .filter((session) => session.scoring?.status === 'completed')
    .map((session) => ({
      sessionId: session._id,
      candidateName: session.candidateSnapshot?.name || session.candidateSnapshot?.email,
      candidateEmail: session.candidateSnapshot?.email,
      score: Math.round(Number(session.scoring.overallScore || 0)),
      recommendation: session.scoring.recommendation || 'review',
      completedAt: session.completedAt,
      answeredCount: session.answers.filter((answer) => answer.status === 'answered').length,
      concernCount: session.scoring.concerns?.length || 0,
      strengthCount: session.scoring.strengths?.length || 0
    }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    scoredCount: rankings.length,
    averageScore: rankings.length ? Math.round(rankings.reduce((sum, item) => sum + item.score, 0) / rankings.length) : null,
    topScore: rankings[0]?.score ?? null,
    topCandidate: rankings[0] || null,
    rankings
  };
}

module.exports = {
  TERMINAL_SESSION_STATUSES,
  addMessage,
  startSession,
  sendMessage,
  confirmQuestion,
  scoreSession,
  syncStats,
  buildScoringSummary
};
