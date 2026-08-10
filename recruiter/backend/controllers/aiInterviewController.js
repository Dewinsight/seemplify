const crypto = require('crypto');
const mongoose = require('mongoose');
const AIInterview = require('../models/AIInterview');
const AIInterviewSession = require('../models/AIInterviewSession');
const Candidate = require('../models/Candidate');
const InterviewQuestion = require('../models/InterviewQuestion');
const Job = require('../models/Job');
const Organization = require('../models/Organization');
const creditsService = require('../services/creditsService');
const aiInterviewerService = require('../services/aiInterviewerService');
const aiInterviewScoringRetryService = require('../services/aiInterviewScoringRetryService');
const aiInterviewEmailService = require('../services/aiInterviewEmailService');
const aiInterviewVoiceLiveService = require('../services/aiInterviewVoiceLiveService');
const azureSpeechTtsService = require('../services/azureSpeechTtsService');
const aiInterviewCostService = require('../services/aiInterviewCostService');
const interviewCodexAccountService = require('../services/aiRuntime/interviewCodexAccountService');
const {
  getRecruiterPublicPath,
  verifyRecruiterPublicToken
} = require('../services/aiInterviewPublicLinkService');
const { runWithAIRequestContext } = require('../services/aiRuntime/requestContext');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

const AI_INTERVIEW_ACTION = 'aiInterviewCandidate';
const TERMINAL_SESSION_STATUSES = new Set(['completed', 'expired', 'cancelled', 'proctor_failed']);
const PROCTORING_FOCUS_EVENT_TYPES = new Set(['visibility_hidden', 'window_blur', 'pagehide']);
const PROCTORING_INPUT_EVENT_TYPES = new Set(['paste_attempt', 'drop_attempt']);
const PROCTORING_EVENT_TYPES = new Set([
  ...PROCTORING_FOCUS_EVENT_TYPES,
  ...PROCTORING_INPUT_EVENT_TYPES
]);
const PROCTORING_FOCUS_DEDUP_WINDOW_MS = 3000;
const PROCTORING_INPUT_DEDUP_WINDOW_MS = 1000;
const PROCTORING_MAX_FOCUS_VIOLATIONS = 3;

function sendControllerError(res, error) {
  const statusCode = Number(error.statusCode || error.status || 500);
  res.status(statusCode).json({
    error: error.code || 'SERVER_ERROR',
    message: error.message
  });
}

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?._doc?._id;
}

function getOrganizationId(req) {
  return req.user?.currentOrganization;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function splitFullName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createLegacyPublicLinkValue() {
  return `ai_${crypto.randomBytes(18).toString('base64url')}`;
}

function getSessionCandidateName(session) {
  const snapshot = session.candidateSnapshot || {};
  return snapshot.name || `${snapshot.firstName || ''} ${snapshot.lastName || ''}`.trim() || snapshot.email || 'Candidate';
}

function buildRecruiterSession(session) {
  const item = typeof session?.toObject === 'function' ? session.toObject() : { ...session };
  delete item.tokenHash;
  item.publicInterviewPath = getRecruiterPublicPath(item._id);
  return item;
}

function buildScoringSummary(sessions = []) {
  const rankings = sessions
    .filter((session) => session.scoring?.status === 'completed' && Number.isFinite(Number(session.scoring.overallScore)))
    .map((session) => ({
      sessionId: session._id,
      candidateId: session.candidate,
      candidateName: getSessionCandidateName(session),
      candidateEmail: session.candidateSnapshot?.email,
      score: Math.round(Number(session.scoring.overallScore)),
      recommendation: session.scoring.recommendation || 'review',
      completedAt: session.completedAt,
      answeredCount: (session.answers || []).filter((answer) => answer.status === 'answered').length,
      concernCount: session.scoring.concerns?.length || 0,
      strengthCount: session.scoring.strengths?.length || 0
    }))
    .sort((a, b) => b.score - a.score || new Date(a.completedAt || 0) - new Date(b.completedAt || 0))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const recommendationCounts = rankings.reduce((counts, item) => {
    counts[item.recommendation] = (counts[item.recommendation] || 0) + 1;
    return counts;
  }, {});

  const averageScore = rankings.length
    ? Math.round(rankings.reduce((sum, item) => sum + item.score, 0) / rankings.length)
    : null;

  return {
    scoredCount: rankings.length,
    averageScore,
    topScore: rankings[0]?.score ?? null,
    topCandidate: rankings[0] || null,
    recommendationCounts,
    rankings
  };
}

function getQuestionLimitMinutes(interview, question) {
  return Number(question?.timeLimit || interview.timers?.perQuestionMinutes || 10);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value)).filter(Boolean)));
}

function truncateText(value, max = 5000) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeProctoringEventType(value) {
  const type = String(value || '').trim();
  return PROCTORING_EVENT_TYPES.has(type) ? type : null;
}

function getProctoringCategory(type) {
  if (PROCTORING_FOCUS_EVENT_TYPES.has(type)) return 'focus';
  if (PROCTORING_INPUT_EVENT_TYPES.has(type)) return 'input';
  return null;
}

function safeProctoringMetadata(input, req) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    visibilityState: truncateText(source.visibilityState || '', 50),
    reason: truncateText(source.reason || '', 120),
    userAgent: truncateText(req.get('user-agent') || '', 300)
  };
}

function getProctoringSummary(session) {
  const proctoring = session.proctoring || {};
  const violations = Array.isArray(proctoring.violations) ? proctoring.violations : [];

  return {
    enabled: proctoring.enabled !== false,
    maxFocusViolations: Number(proctoring.maxFocusViolations || PROCTORING_MAX_FOCUS_VIOLATIONS),
    focusViolationCount: Number(proctoring.focusViolationCount || 0),
    pasteAttemptCount: Number(proctoring.pasteAttemptCount || 0),
    terminatedAt: proctoring.terminatedAt,
    terminationReason: proctoring.terminationReason,
    violations: violations.map((violation) => ({
      _id: violation._id,
      type: violation.type,
      category: violation.category,
      questionIndex: violation.questionIndex,
      count: violation.count,
      actionTaken: violation.actionTaken,
      message: violation.message,
      createdAt: violation.createdAt
    }))
  };
}

function findRecentProctoringViolation(session, category, now, windowMs) {
  const violations = session.proctoring?.violations || [];
  for (let index = violations.length - 1; index >= 0; index -= 1) {
    const violation = violations[index];
    if (violation.category !== category) continue;
    const createdAt = violation.createdAt ? new Date(violation.createdAt).getTime() : 0;
    if (createdAt && now.getTime() - createdAt <= windowMs) return violation;
    return null;
  }
  return null;
}

function normalizeTranscriptText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function canonicalTranscriptText(value) {
  return normalizeTranscriptText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function areEquivalentTranscriptTexts(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 30 && longer.includes(shorter);
}

function hasEquivalentTranscriptMessage(session, { role, questionIndex, content }) {
  const canonicalContent = canonicalTranscriptText(content);
  if (!canonicalContent) return false;

  const targetQuestionIndex = questionIndex == null ? null : Number(questionIndex);
  return (session.messages || []).some((message) => {
    if (message.role !== role) return false;

    const messageQuestionIndex = message.questionIndex == null ? null : Number(message.questionIndex);
    if (messageQuestionIndex !== targetQuestionIndex) return false;

    const existingContent = canonicalTranscriptText(message.content);
    if (!existingContent) return false;

    return areEquivalentTranscriptTexts(existingContent, canonicalContent);
  });
}

function isApprovedAssistantSpeech(session, content) {
  const canonicalContent = canonicalTranscriptText(content);
  if (!canonicalContent) return false;

  return (session.messages || []).some((message) => {
    if (message.role !== 'ai') return false;
    if (!['greeting', 'question', 'clarification', 'acknowledgement', 'transition', 'system'].includes(message.messageType)) {
      return false;
    }

    const existingContent = canonicalTranscriptText(message.content);
    return existingContent && areEquivalentTranscriptTexts(existingContent, canonicalContent);
  });
}

function buildPublicState(session, interview) {
  const currentQuestion = interview.questionSnapshots[session.currentQuestionIndex];
  return {
    session: {
      _id: session._id,
      id: session._id,
      status: session.status,
      currentQuestionIndex: session.currentQuestionIndex,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      questionDeadlineAt: session.questionDeadlineAt,
      totalDeadlineAt: session.totalDeadlineAt,
      messages: session.messages || [],
      answers: (session.answers || []).map((answer) => ({
        questionIndex: answer.questionIndex,
        status: answer.status,
        submittedAt: answer.submittedAt,
        timeSpentSeconds: answer.timeSpentSeconds
      })),
      scoring: session.status === 'completed' ? session.scoring : undefined,
      proctoring: getProctoringSummary(session)
    },
    interview: {
      id: interview._id,
      title: interview.title,
      guidelines: interview.guidelines,
      questionCount: interview.questionSnapshots.length,
      timers: interview.timers,
      schedule: interview.schedule,
      currentQuestion: currentQuestion ? {
        questionIndex: session.currentQuestionIndex,
        type: currentQuestion.type,
        difficulty: currentQuestion.difficulty,
        timeLimit: getQuestionLimitMinutes(interview, currentQuestion)
      } : null
    },
    candidate: session.candidateSnapshot,
    voice: {
      ...aiInterviewVoiceLiveService.getPublicConfig(),
      voice: interview.voice?.voiceId || aiInterviewVoiceLiveService.getPublicConfig().voice,
      selectedVoice: interview.voice || null
    },
    job: session.job ? {
      id: session.job._id,
      title: session.job.title
    } : undefined
  };
}

async function syncInterviewStats(interviewId) {
  const rows = await AIInterviewSession.aggregate([
    { $match: { aiInterview: new mongoose.Types.ObjectId(String(interviewId)) } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  const counts = rows.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  await AIInterview.findByIdAndUpdate(interviewId, {
    stats: {
      sent: counts.sent || 0,
      opened: counts.opened || 0,
      inProgress: counts.in_progress || 0,
      completed: counts.completed || 0,
      blocked: (counts.credit_blocked || 0) + (counts.credit_error || 0),
      failed: (counts.email_failed || 0) + (counts.proctor_failed || 0),
      proctorFailed: counts.proctor_failed || 0
    }
  });
}

function upsertDraftAnswer(session, interview, answerText) {
  const index = session.currentQuestionIndex;
  const question = interview.questionSnapshots[index];
  if (!question) return null;

  let answer = session.answers.find((item) => item.questionIndex === index);
  if (!answer) {
    answer = session.answers.create({
      questionIndex: index,
      questionId: question.questionId,
      question: question.question,
      answer: '',
      status: 'draft',
      startedAt: session.questionStartedAt || new Date()
    });
    session.answers.push(answer);
  }

  const existing = answer.answer ? `${answer.answer}\n\n` : '';
  answer.answer = `${existing}${answerText}`.trim();
  answer.status = 'draft';
  return answer;
}

function finalizeCurrentAnswer(session, interview, mode = 'answered') {
  const now = new Date();
  const index = session.currentQuestionIndex;
  const question = interview.questionSnapshots[index];
  if (!question) return null;

  let answer = session.answers.find((item) => item.questionIndex === index);
  if (!answer) {
    answer = session.answers.create({
      questionIndex: index,
      questionId: question.questionId,
      question: question.question,
      answer: '',
      status: 'draft',
      startedAt: session.questionStartedAt || now
    });
    session.answers.push(answer);
  }

  const hasAnswer = Boolean(String(answer.answer || '').trim());
  answer.status = mode === 'timeout' ? 'timeout' : (hasAnswer ? 'answered' : 'skipped');
  answer.submittedAt = now;
  const startedAt = answer.startedAt || session.questionStartedAt || now;
  answer.timeSpentSeconds = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000));
  return answer;
}

async function completeSession(session, interview) {
  if (session.status === 'completed') {
    return session;
  }

  session.status = 'completed';
  session.completedAt = new Date();
  session.lastActivityAt = new Date();
  session.messages.push({
    role: 'ai',
    content: 'That completes the interview. Thank you for taking the time to answer these questions.',
    questionIndex: null,
    messageType: 'transition'
  });
  await aiInterviewScoringRetryService.scoreSession(session, interview);
  await syncInterviewStats(interview._id);
  return session;
}

async function advanceQuestion(session, interview, mode = 'answered') {
  finalizeCurrentAnswer(session, interview, mode);

  const nextIndex = session.currentQuestionIndex + 1;
  if (nextIndex >= interview.questionSnapshots.length) {
    return completeSession(session, interview);
  }

  const now = new Date();
  const nextQuestion = interview.questionSnapshots[nextIndex];
  session.currentQuestionIndex = nextIndex;
  session.questionStartedAt = now;
  session.questionDeadlineAt = addMinutes(now, getQuestionLimitMinutes(interview, nextQuestion));
  session.lastActivityAt = now;
  session.messages.push({
    role: 'ai',
    content: `Confirmed. We are moving to question ${nextIndex + 1} of ${interview.questionSnapshots.length}.`,
    questionIndex: nextIndex,
    messageType: 'transition'
  });

  const intro = await aiInterviewerService.introduceQuestion({
    interview,
    session,
    question: nextQuestion,
    questionNumber: nextIndex + 1
  });

  session.messages.push({
    role: 'ai',
    content: intro,
    questionIndex: nextIndex,
    messageType: 'question'
  });

  await session.save();
  await syncInterviewStats(interview._id);
  return session;
}

async function enforceDeadlines(session, interview) {
  const now = new Date();

  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    return session;
  }

  if (new Date(interview.schedule.expiresAt) <= now) {
    session.status = 'expired';
    session.lastActivityAt = now;
    await session.save();
    await interviewCodexAccountService.disconnect(session, {
      terminal: true,
      reason: 'interview_expired'
    }).catch((error) => console.warn('Expired interview credential cleanup failed:', error.message));
    await syncInterviewStats(interview._id);
    return session;
  }

  if (session.status !== 'in_progress') {
    return session;
  }

  if (session.totalDeadlineAt && new Date(session.totalDeadlineAt) <= now) {
    finalizeCurrentAnswer(session, interview, 'timeout');
    return completeSession(session, interview);
  }

  if (session.questionDeadlineAt && new Date(session.questionDeadlineAt) <= now) {
    return advanceQuestion(session, interview, 'timeout');
  }

  return session;
}

async function findPublicSession(token) {
  const tokenHash = hashPublicToken(token);
  let sessionQuery = AIInterviewSession.findOne({ tokenHash });
  const recruiterSessionId = verifyRecruiterPublicToken(token);
  if (recruiterSessionId) {
    sessionQuery = AIInterviewSession.findById(recruiterSessionId);
  }

  return sessionQuery
    .populate({
      path: 'aiInterview',
      populate: [
        { path: 'job', select: 'title description organization' },
        { path: 'organization', select: 'name idpOrganizationId' }
      ]
    })
    .populate('job', 'title description')
    .populate('candidate', 'firstName lastName email');
}

exports.getAIInterviewOptions = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const estimate = await aiInterviewCostService.buildAIInterviewEstimate({
      organizationId,
      candidateCount: 1,
      questionCount: 3,
      totalMinutes: 45
    });

    res.json({
      success: true,
      ...aiInterviewCostService.getOptionsPayload(),
      currency: {
        displayCurrency: estimate.displayValue?.currency || 'USD',
        supportedCurrencies: estimate.supportedCurrencies,
        rateSource: estimate.displayValue?.source,
        rateAsOf: estimate.displayValue?.asOf
      },
      creditRate: estimate.creditRate
    });
  } catch (error) {
    console.error('AI interview options error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.estimateAIInterviewCost = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const estimate = await aiInterviewCostService.buildAIInterviewEstimate({
      organizationId,
      candidateCount: req.body?.candidateCount,
      questionCount: req.body?.questionCount,
      totalMinutes: req.body?.totalMinutes,
      voiceId: req.body?.voiceId
    });
    res.json({ success: true, estimate });
  } catch (error) {
    console.error('AI interview cost estimate error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.previewAIInterviewVoice = async (req, res) => {
  try {
    const voice = aiInterviewCostService.snapshotVoice(req.body?.voiceId);
    const text = String(req.body?.text || voice.samplePhrase || '').trim().slice(0, 300);

    if (!text) {
      return res.status(400).json({ error: 'EMPTY_PREVIEW_TEXT', message: 'A voice preview phrase is required.' });
    }

    const speech = await azureSpeechTtsService.synthesize(text, {
      voice: voice.voiceId,
      language: voice.language
    });

    res.set({
      'Content-Type': speech.contentType || 'audio/mpeg',
      'Content-Length': speech.buffer.length,
      'Cache-Control': 'no-store',
      'X-AI-Interview-Voice': voice.voiceId || ''
    });
    res.send(speech.buffer);
  } catch (error) {
    console.error('AI interview voice preview error:', error);
    sendControllerError(res, error);
  }
};

exports.createAIInterview = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const {
      title,
      jobId,
      candidateIds,
      guestCandidates,
      questionIds,
      guidelines,
      sendAt,
      expiresAt,
      perQuestionMinutes,
      totalMinutes,
      voiceId,
      timezone
    } = req.body;

    if (!organizationId || !userId) {
      return res.status(400).json({ error: 'ORGANIZATION_REQUIRED', message: 'Organization context is required' });
    }

    if (!isValidObjectId(jobId)) {
      return res.status(400).json({ error: 'INVALID_JOB', message: 'A valid job is required' });
    }

    const uniqueCandidateIds = uniqueStrings(candidateIds);
    const uniqueQuestionIds = uniqueStrings(questionIds);
    const guestCandidateInputs = Array.isArray(guestCandidates) ? guestCandidates : [];
    const normalizedGuests = [];
    const seenGuestEmails = new Set();

    for (const guest of guestCandidateInputs) {
      const email = normalizeEmail(guest?.email);
      const fullName = String(guest?.fullName || guest?.name || `${guest?.firstName || ''} ${guest?.lastName || ''}`).trim();

      if (!email && !fullName) continue;
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'INVALID_GUEST_CANDIDATE', message: 'Guest candidates need a valid email address' });
      }
      if (!fullName) {
        return res.status(400).json({ error: 'INVALID_GUEST_CANDIDATE', message: 'Guest candidates need a full name' });
      }
      if (seenGuestEmails.has(email)) continue;

      const splitName = splitFullName(fullName);
      normalizedGuests.push({
        firstName: String(guest?.firstName || splitName.firstName || '').trim(),
        lastName: String(guest?.lastName || splitName.lastName || '').trim(),
        name: fullName,
        email
      });
      seenGuestEmails.add(email);
    }

    if ((!uniqueCandidateIds.length && !normalizedGuests.length) || !uniqueQuestionIds.length) {
      return res.status(400).json({ error: 'MISSING_SELECTIONS', message: 'Select or add at least one candidate and one question' });
    }
    if (uniqueCandidateIds.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ error: 'INVALID_CANDIDATES', message: 'One or more candidate ids are invalid' });
    }
    if (uniqueQuestionIds.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ error: 'INVALID_QUESTIONS', message: 'One or more question ids are invalid' });
    }

    const scheduledSendAt = new Date(sendAt);
    const scheduledExpiresAt = new Date(expiresAt);
    if (Number.isNaN(scheduledSendAt.getTime()) || Number.isNaN(scheduledExpiresAt.getTime())) {
      return res.status(400).json({ error: 'INVALID_SCHEDULE', message: 'Send time and expiry are required' });
    }
    if (scheduledExpiresAt <= new Date()) {
      return res.status(400).json({ error: 'INVALID_EXPIRY', message: 'Expiry must be in the future' });
    }
    if (scheduledSendAt >= scheduledExpiresAt) {
      return res.status(400).json({ error: 'INVALID_SCHEDULE', message: 'Send time must be before expiry' });
    }

    const job = await Job.findOne({ _id: jobId, organization: organizationId });
    if (!job) {
      return res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'Job not found for this organization' });
    }

    const candidates = await Candidate.find({
      _id: { $in: uniqueCandidateIds },
      organization: organizationId
    }).select('firstName lastName email organization');

    if (candidates.length !== uniqueCandidateIds.length) {
      return res.status(400).json({ error: 'INVALID_CANDIDATES', message: 'One or more candidates were not found in this organization' });
    }

    const candidateMap = new Map(candidates.map((candidate) => [String(candidate._id), candidate]));
    const savedRecipients = uniqueCandidateIds.map((id) => candidateMap.get(String(id))).filter(Boolean);
    const savedEmails = new Set(savedRecipients.map((candidate) => normalizeEmail(candidate.email)).filter(Boolean));
    const duplicateGuest = normalizedGuests.find((guest) => savedEmails.has(guest.email));
    if (duplicateGuest) {
      return res.status(400).json({
        error: 'DUPLICATE_RECIPIENT',
        message: `${duplicateGuest.email} is already selected as a saved candidate`
      });
    }

    const recipients = [
      ...savedRecipients.map((candidate) => {
        const name = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email;
        return {
          recipientType: 'candidate',
          candidateId: candidate._id,
          candidateSnapshot: {
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            name,
            email: normalizeEmail(candidate.email)
          }
        };
      }),
      ...normalizedGuests.map((guest) => ({
        recipientType: 'guest',
        candidateId: new mongoose.Types.ObjectId(),
        candidateSnapshot: guest
      }))
    ];

    const questions = await InterviewQuestion.find({
      _id: { $in: uniqueQuestionIds },
      jobId,
      isActive: true
    });

    if (questions.length !== uniqueQuestionIds.length) {
      return res.status(400).json({ error: 'INVALID_QUESTIONS', message: 'One or more questions were not found for this job' });
    }

    const questionMap = new Map(questions.map((question) => [String(question._id), question]));
    const questionSnapshots = uniqueQuestionIds.map((id, index) => {
      const question = questionMap.get(String(id));
      return {
        questionId: question._id,
        question: question.question,
        type: question.type,
        category: question.category,
        difficulty: question.difficulty,
        interviewStage: question.interviewStage,
        order: index,
        timeLimit: question.timeLimit,
        expectedAnswer: question.expectedAnswer,
        scoringCriteria: question.scoringCriteria || []
      };
    });

    const normalizedTimers = {
      perQuestionMinutes: Math.max(1, Math.min(120, Number(perQuestionMinutes) || 10)),
      totalMinutes: Math.max(1, Math.min(480, Number(totalMinutes) || Math.max(30, questionSnapshots.length * 10)))
    };
    const costEstimate = await aiInterviewCostService.buildAIInterviewEstimate({
      organizationId,
      candidateCount: recipients.length,
      questionCount: questionSnapshots.length,
      totalMinutes: normalizedTimers.totalMinutes,
      voiceId
    });
    const perCandidateCost = Number(costEstimate.creditCostPerCandidate || 0);
    const totalRequired = Number(costEstimate.totalCredits || 0);
    const creditCheck = await creditsService.checkSufficientCredits(organizationId, AI_INTERVIEW_ACTION, {
      creditCostOverride: totalRequired
    });
    if (!creditCheck.allowed || (Number.isFinite(creditCheck.remaining) && creditCheck.remaining < totalRequired)) {
      return res.status(402).json({
        error: 'INSUFFICIENT_CREDITS',
        message: `Insufficient credits. Required: ${totalRequired}, Available: ${creditCheck.remaining}`,
        details: {
          action: AI_INTERVIEW_ACTION,
          required: totalRequired,
          available: creditCheck.remaining,
          perCandidateCost,
          candidateCount: recipients.length
        }
      });
    }

    const aiInterview = await AIInterview.create({
      organization: organizationId,
      job: job._id,
      createdBy: userId,
      title: title?.trim() || `${decodeHtmlEntities(job.title)} AI Interview`,
      publicLink: createLegacyPublicLinkValue(),
      guidelines: guidelines?.trim() || '',
      questionSnapshots,
      timers: normalizedTimers,
      schedule: {
        sendAt: scheduledSendAt,
        expiresAt: scheduledExpiresAt,
        timezone: timezone || 'UTC'
      },
      candidateCount: recipients.length,
      voice: aiInterviewCostService.snapshotVoice(costEstimate.voice?.id || voiceId),
      creditCostPerCandidate: perCandidateCost,
      costEstimate: {
        baseCreditsPerCandidate: costEstimate.baseCreditsPerCandidate,
        voiceSurchargeCredits: costEstimate.voiceSurchargeCredits,
        durationSurchargeCredits: costEstimate.durationSurchargeCredits,
        creditCostPerCandidate: perCandidateCost,
        candidateCount: recipients.length,
        totalCredits: totalRequired,
        estimatedSpeechCharacters: costEstimate.estimatedSpeechCharacters,
        estimatedSpeechUsd: costEstimate.estimatedSpeechUsd,
        estimatedSttUsd: costEstimate.estimatedSttUsd,
        estimatedLlmAndPlatformUsd: costEstimate.estimatedLlmAndPlatformUsd,
        estimatedBackendCostUsdPerCandidate: costEstimate.estimatedBackendCostUsdPerCandidate,
        targetProfitUsdPerCandidate: costEstimate.targetProfitUsdPerCandidate,
        voiceSurchargeUsdPerCandidate: costEstimate.voiceSurchargeUsdPerCandidate,
        billableUsdPerCandidate: costEstimate.billableUsdPerCandidate,
        estimatedBackendCostUsd: costEstimate.estimatedBackendCostUsd,
        targetProfitUsd: costEstimate.targetProfitUsd,
        voiceSurchargeUsd: costEstimate.voiceSurchargeUsd,
        billableUsdBeforeRounding: costEstimate.billableUsdBeforeRounding,
        roundedBillableUsd: costEstimate.roundedBillableUsd,
        estimatedUsdValue: costEstimate.estimatedUsdValue,
        creditUsdRate: costEstimate.creditRate?.usdPerCredit,
        creditRateSource: costEstimate.creditRate?.source,
        displayCurrency: costEstimate.displayValue?.currency,
        displayCurrencyRate: costEstimate.displayValue?.rate,
        estimatedDisplayValue: costEstimate.displayValue?.amount,
        rateSource: costEstimate.displayValue?.source,
        calculatedAt: new Date()
      }
    });

    const sessions = await AIInterviewSession.insertMany(recipients.map((recipient) => {
      return {
        aiInterview: aiInterview._id,
        organization: organizationId,
        job: job._id,
        candidate: recipient.candidateId,
        recipientType: recipient.recipientType,
        createdBy: userId,
        candidateSnapshot: recipient.candidateSnapshot,
        credits: {
          cost: perCandidateCost
        }
      };
    }));

    await syncInterviewStats(aiInterview._id);

    res.status(201).json({
      success: true,
      message: 'AI interview scheduled successfully',
      aiInterview,
      sessions: sessions.map(buildRecruiterSession),
      creditPreview: {
        perCandidateCost,
        totalRequired,
        estimate: costEstimate
      }
    });
  } catch (error) {
    console.error('Create AI interview error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.listAIInterviews = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { status, jobId } = req.query;
    const query = { organization: organizationId };
    if (status && status !== 'all') query.status = status;
    if (jobId && isValidObjectId(jobId)) query.job = jobId;

    const aiInterviews = await AIInterview.find(query)
      .populate('job', 'title status')
      .populate('createdBy', 'email profile')
      .sort({ createdAt: -1 })
      .limit(100);

    const interviewIds = aiInterviews.map((interview) => interview._id);
    const sessions = await AIInterviewSession.find({
      aiInterview: { $in: interviewIds },
      organization: organizationId
    })
      .select('aiInterview candidateSnapshot status completedAt answers scoring proctoring')
      .lean();
    const sessionsByInterview = sessions.reduce((map, session) => {
      const key = String(session.aiInterview);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(session);
      return map;
    }, new Map());

    res.json({
      success: true,
      aiInterviews: aiInterviews.map((interview) => {
        const item = interview.toObject();
        item.scoringSummary = buildScoringSummary(sessionsByInterview.get(String(interview._id)) || []);
        return item;
      })
    });
  } catch (error) {
    console.error('List AI interviews error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.getAIInterview = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;
    const aiInterview = await AIInterview.findOne({ _id: id, organization: organizationId })
      .populate('job', 'title status description')
      .populate('createdBy', 'email profile');

    if (!aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'AI interview not found' });
    }

    const sessions = await AIInterviewSession.find({ aiInterview: aiInterview._id, organization: organizationId })
      .populate('candidate', 'firstName lastName email status')
      .sort({ createdAt: 1 });

    const aiInterviewObject = aiInterview.toObject();
    aiInterviewObject.scoringSummary = buildScoringSummary(sessions);

    res.json({
      success: true,
      aiInterview: aiInterviewObject,
      sessions: sessions.map(buildRecruiterSession)
    });
  } catch (error) {
    console.error('Get AI interview error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.getAIInterviewSession = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id, sessionId } = req.params;
    const session = await AIInterviewSession.findOne({
      _id: sessionId,
      aiInterview: id,
      organization: organizationId
    })
      .populate('aiInterview')
      .populate('job', 'title status')
      .populate('candidate', 'firstName lastName email status');

    if (!session) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'AI interview session not found' });
    }

    res.json({ success: true, session: buildRecruiterSession(session) });
  } catch (error) {
    console.error('Get AI interview session error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.cancelAIInterview = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const { id } = req.params;
    const aiInterview = await AIInterview.findOne({ _id: id, organization: organizationId });

    if (!aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'AI interview not found' });
    }

    aiInterview.status = 'cancelled';
    aiInterview.cancelledAt = new Date();
    aiInterview.cancelledBy = userId;
    aiInterview.cancellationReason = req.body?.reason || '';
    await aiInterview.save();

    await AIInterviewSession.updateMany({
      aiInterview: id,
      organization: organizationId,
      status: { $nin: Array.from(TERMINAL_SESSION_STATUSES) }
    }, {
      $set: { status: 'cancelled' }
    });

    await interviewCodexAccountService.disconnectInterview(id, {
      reason: 'interview_cancelled'
    }).catch((error) => console.warn('Cancelled interview credential cleanup failed:', error.message));

    await syncInterviewStats(id);
    res.json({ success: true, message: 'AI interview cancelled' });
  } catch (error) {
    console.error('Cancel AI interview error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.resendAIInterviewSessions = async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;
    const { sessionIds } = req.body;
    const aiInterview = await AIInterview.findOne({ _id: id, organization: organizationId });

    if (!aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'AI interview not found' });
    }

    if (new Date(aiInterview.schedule.expiresAt) <= new Date()) {
      return res.status(400).json({ error: 'EXPIRED', message: 'Cannot resend an expired AI interview' });
    }

    const query = {
      aiInterview: id,
      organization: organizationId,
      status: { $in: ['sent', 'opened', 'email_failed', 'credit_blocked', 'credit_error'] }
    };
    if (Array.isArray(sessionIds) && sessionIds.length) {
      query._id = { $in: sessionIds };
    }

    const result = await AIInterviewSession.updateMany(query, {
      $set: {
        status: 'pending_send',
        tokenHash: null,
        tokenGeneratedAt: null,
        'email.lastError': null
      }
    });

    await aiInterviewEmailService.checkAndSendInvites();
    await syncInterviewStats(id);
    res.json({ success: true, message: 'Sessions queued for resend', modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Resend AI interview sessions error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

/**
 * Live interview turns run on the candidate's own ChatGPT account, so the
 * session is put on the AI request context and the runtime resolves the
 * candidate's subject from it. A candidate is not a platform user, so there is
 * no actor to infer this from.
 */
function withCandidateRuntime(session, run) {
  const organization = session?.aiInterview?.organization;
  const localOrganizationId = organization?._id || session?.organization || organization;
  return runWithAIRequestContext({
    sourceApp: 'recruiter-ai-interview',
    interviewSessionId: String(session?._id || ''),
    organizationId: organization?.idpOrganizationId || localOrganizationId || undefined,
    localOrganizationId: localOrganizationId || undefined,
    organizationName: organization?.name,
    actorName: 'Interview candidate',
    interviewId: String(session?.aiInterview?._id || session?.aiInterview || '')
  }, run);
}

/**
 * A candidate's own ChatGPT connection for this interview. Authenticated by
 * the interview link alone — the candidate has no platform account — so every
 * handler resolves the session from the token and never trusts a body field.
 */
exports.getPublicChatgptAccount = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    const account = await interviewCodexAccountService.readAccount(session);
    return res.json({ account: account.toPublicJSON() });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.code || 'CHATGPT_STATUS_FAILED',
      message: error.message || 'The ChatGPT connection could not be checked'
    });
  }
};

exports.startPublicChatgptLogin = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      return res.status(409).json({
        error: 'INTERVIEW_ALREADY_ENDED',
        message: 'This interview has ended, so its ChatGPT connection cannot be reopened.'
      });
    }
    const { login, account } = await interviewCodexAccountService.startLogin(session);
    return res.json({ login, account: account.toPublicJSON() });
  } catch (error) {
    // A candidate cannot ask anyone for help, so a throttled sign-in has to
    // say how long the wait is rather than just failing.
    const retryAfterSeconds = Number(error.retryAfterSeconds) || 0;
    if (retryAfterSeconds > 0) res.set('Retry-After', String(retryAfterSeconds));
    return res.status(error.statusCode || 503).json({
      error: error.code || 'CHATGPT_LOGIN_FAILED',
      message: error.message || 'ChatGPT sign-in could not be started',
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
    });
  }
};

exports.cancelPublicChatgptLogin = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    const account = await interviewCodexAccountService.cancelLogin(session);
    return res.json({ account: account.toPublicJSON() });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.code || 'CHATGPT_CANCEL_FAILED',
      message: error.message || 'The pending sign-in could not be cancelled'
    });
  }
};

exports.setPublicChatgptConsent = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    if (req.body?.acknowledged === true && TERMINAL_SESSION_STATUSES.has(session.status)) {
      return res.status(409).json({
        error: 'INTERVIEW_ALREADY_ENDED',
        message: 'This interview has ended, so data sharing cannot be enabled again.'
      });
    }
    const account = await interviewCodexAccountService.setConsent(session, req.body?.acknowledged === true);
    return res.json({ account: account.toPublicJSON() });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.code || 'CHATGPT_CONSENT_FAILED',
      message: error.message || 'Your choice could not be saved'
    });
  }
};

exports.disconnectPublicChatgpt = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    const account = await interviewCodexAccountService.disconnect(session);
    return res.json({ account: account.toPublicJSON() });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.code || 'CHATGPT_DISCONNECT_FAILED',
      message: error.message || 'The ChatGPT account could not be disconnected'
    });
  }
};

exports.bootstrapPublicInterview = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status === 'sent') {
      session.status = 'opened';
      session.lastActivityAt = new Date();
      await session.save();
      await syncInterviewStats(interview._id);
    }

    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Bootstrap public AI interview error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.getPublicVoiceStatus = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    res.json({
      success: true,
      voice: {
        ...aiInterviewVoiceLiveService.getPublicConfig(),
        voice: interview.voice?.voiceId || aiInterviewVoiceLiveService.getPublicConfig().voice,
        selectedVoice: interview.voice || null
      },
      canStart: session.status === 'in_progress'
    });
  } catch (error) {
    console.error('Public AI interview voice status error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.getPublicSpeechToken = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'NOT_IN_PROGRESS', message: 'Start the interview before enabling speech recognition' });
    }

    const speech = await aiInterviewVoiceLiveService.issueClientToken();
    res.json({ success: true, speech });
  } catch (error) {
    console.error('Public AI interview speech token error:', error);
    sendControllerError(res, error);
  }
};

exports.transcribePublicSpeech = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'NOT_IN_PROGRESS', message: 'Interview is not in progress' });
    }

    const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!audioBuffer.length) {
      return res.status(400).json({ error: 'EMPTY_AUDIO', message: 'Audio payload is required' });
    }

    const transcript = await aiInterviewVoiceLiveService.transcribeWav(audioBuffer);
    res.json({
      success: true,
      transcript,
      language: aiInterviewVoiceLiveService.getConfig().language
    });
  } catch (error) {
    console.error('Public AI interview speech transcription error:', error.message);
    sendControllerError(res, error);
  }
};

exports.startPublicInterview = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      return res.json({ success: true, ...buildPublicState(session, interview) });
    }

    if (!['sent', 'opened', 'in_progress'].includes(session.status)) {
      return res.status(400).json({ error: 'NOT_READY', message: 'This interview link is not ready to start' });
    }

    if (session.status !== 'in_progress') {
      const now = new Date();
      const firstQuestion = interview.questionSnapshots[0];
      session.status = 'in_progress';
      session.startedAt = now;
      session.lastActivityAt = now;
      session.currentQuestionIndex = 0;
      session.questionStartedAt = now;
      session.questionDeadlineAt = addMinutes(now, getQuestionLimitMinutes(interview, firstQuestion));
      session.totalDeadlineAt = addMinutes(now, interview.timers?.totalMinutes || 60);
      session.messages.push({
        role: 'ai',
        content: `Hello ${session.candidateSnapshot?.firstName || ''}. Thanks for joining this AI interview. There are ${interview.questionSnapshots.length} questions, and I will guide you through them one at a time.`,
        questionIndex: null,
        messageType: 'greeting'
      });

      const intro = await aiInterviewerService.introduceQuestion({
        interview,
        session,
        question: firstQuestion,
        questionNumber: 1
      });

      session.messages.push({
        role: 'ai',
        content: intro,
        questionIndex: 0,
        messageType: 'question'
      });
      await session.save();
      await syncInterviewStats(interview._id);
    }

    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Start public AI interview error:', error);
    sendControllerError(res, error);
  }
};

exports.sendPublicMessage = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'EMPTY_MESSAGE', message: 'Message is required' });
    }

    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'NOT_IN_PROGRESS', message: 'Interview is not in progress' });
    }

    const currentQuestion = interview.questionSnapshots[session.currentQuestionIndex];
    const candidateMessage = String(message).trim();
    session.messages.push({
      role: 'candidate',
      content: candidateMessage,
      questionIndex: session.currentQuestionIndex,
      messageType: aiInterviewerService.isLikelyClarification(candidateMessage) ? 'clarification' : 'answer'
    });

    let aiReply;
    if (aiInterviewerService.isLikelyClarification(candidateMessage)) {
      aiReply = await aiInterviewerService.clarifyQuestion({
        interview,
        session,
        question: currentQuestion,
        questionNumber: session.currentQuestionIndex + 1,
        candidateMessage
      });
      session.messages.push({
        role: 'ai',
        content: aiReply,
        questionIndex: session.currentQuestionIndex,
        messageType: 'clarification'
      });
    } else {
      upsertDraftAnswer(session, interview, candidateMessage);
      aiReply = await aiInterviewerService.acknowledgeAnswer({
        interview,
        session,
        question: currentQuestion,
        candidateMessage
      });
      session.messages.push({
        role: 'ai',
        content: aiReply,
        questionIndex: session.currentQuestionIndex,
        messageType: 'acknowledgement'
      });
    }

    session.lastActivityAt = new Date();
    await session.save();

    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Public AI interview message error:', error);
    sendControllerError(res, error);
  }
};

exports.recordPublicVoiceTranscript = async (req, res) => {
  try {
    const role = req.body?.role === 'ai' ? 'ai' : 'candidate';
    const content = normalizeTranscriptText(truncateText(req.body?.message || req.body?.content || ''));
    if (!content) {
      return res.status(400).json({ error: 'EMPTY_MESSAGE', message: 'Transcript content is required' });
    }

    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'NOT_IN_PROGRESS', message: 'Interview is not in progress' });
    }

    const questionIndex = session.currentQuestionIndex;
    if (hasEquivalentTranscriptMessage(session, { role, questionIndex, content })) {
      return res.json({ success: true, deduped: true, ...buildPublicState(session, interview) });
    }

    if (role === 'candidate') {
      const isClarification = aiInterviewerService.isLikelyClarification(content);
      session.messages.push({
        role: 'candidate',
        content,
        questionIndex,
        messageType: isClarification ? 'clarification' : 'answer'
      });

      if (!isClarification) {
        upsertDraftAnswer(session, interview, content);
      }
    } else {
      const allowedTypes = new Set(['greeting', 'question', 'clarification', 'acknowledgement', 'transition', 'system']);
      const requestedType = String(req.body?.messageType || '').trim();
      session.messages.push({
        role: 'ai',
        content,
        questionIndex,
        messageType: allowedTypes.has(requestedType) ? requestedType : 'acknowledgement'
      });
    }

    session.lastActivityAt = new Date();
    await session.save();

    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Public AI interview voice transcript error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
  }
};

exports.recordPublicProctoringEvent = async (req, res) => {
  try {
    const type = normalizeProctoringEventType(req.body?.type);
    if (!type) {
      return res.status(400).json({ error: 'INVALID_PROCTORING_EVENT', message: 'Unsupported proctoring event type' });
    }

    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      return res.json({
        success: true,
        action: 'ignored',
        proctoring: getProctoringSummary(session),
        ...buildPublicState(session, interview)
      });
    }

    if (session.status !== 'in_progress') {
      return res.json({
        success: true,
        action: 'ignored',
        proctoring: getProctoringSummary(session),
        ...buildPublicState(session, interview)
      });
    }

    if (!session.proctoring) session.proctoring = {};
    if (!Array.isArray(session.proctoring.violations)) session.proctoring.violations = [];
    if (session.proctoring.enabled === false) {
      return res.json({
        success: true,
        action: 'ignored',
        proctoring: getProctoringSummary(session),
        ...buildPublicState(session, interview)
      });
    }

    const now = new Date();
    const category = getProctoringCategory(type);
    const windowMs = category === 'focus' ? PROCTORING_FOCUS_DEDUP_WINDOW_MS : PROCTORING_INPUT_DEDUP_WINDOW_MS;
    const recent = findRecentProctoringViolation(session, category, now, windowMs);
    if (recent) {
      return res.json({
        success: true,
        deduped: true,
        action: recent.actionTaken || 'logged',
        warningMessage: recent.message,
        proctoring: getProctoringSummary(session),
        ...buildPublicState(session, interview)
      });
    }

    const maxFocusViolations = Number(session.proctoring.maxFocusViolations || PROCTORING_MAX_FOCUS_VIOLATIONS);
    let count = 1;
    let action = 'logged';
    let message = 'This event has been recorded.';

    if (category === 'focus') {
      count = Number(session.proctoring.focusViolationCount || 0) + 1;
      session.proctoring.focusViolationCount = count;

      if (count >= maxFocusViolations) {
        action = 'terminated';
        message = 'Interview ended because the interview screen was left too many times. The recruiter will see this proctoring log.';
        session.status = 'proctor_failed';
        session.completedAt = now;
        session.proctoring.terminatedAt = now;
        session.proctoring.terminationReason = message;
        session.messages.push({
          role: 'system',
          content: message,
          questionIndex: session.currentQuestionIndex,
          messageType: 'system'
        });
      } else if (count === maxFocusViolations - 1) {
        action = 'final_warning';
        message = `Final warning: you have left the interview screen ${count} times. If you leave again, the interview will automatically end.`;
      } else {
        action = 'warned';
        const remaining = Math.max(0, maxFocusViolations - count);
        message = `You moved away from the interview screen ${count} time${count === 1 ? '' : 's'}. You have ${remaining} more before the interview is blocked.`;
      }
    } else {
      count = Number(session.proctoring.pasteAttemptCount || 0) + 1;
      session.proctoring.pasteAttemptCount = count;
      message = type === 'drop_attempt'
        ? 'Dropping prepared text or files into the answer box is disabled. This attempt has been logged for the recruiter.'
        : 'Pasting prepared answers is disabled for this interview. This attempt has been logged for the recruiter.';
    }

    session.proctoring.violations.push({
      type,
      category,
      questionIndex: session.currentQuestionIndex,
      count,
      actionTaken: action,
      message,
      metadata: safeProctoringMetadata(req.body?.metadata, req)
    });
    session.lastActivityAt = now;
    await session.save();
    if (action === 'terminated') {
      await interviewCodexAccountService.disconnect(session, {
        terminal: true,
        reason: 'proctor_terminated'
      }).catch((error) => console.warn('Terminated interview credential cleanup failed:', error.message));
    }
    await syncInterviewStats(interview._id);

    res.json({
      success: true,
      action,
      warningMessage: message,
      proctoring: getProctoringSummary(session),
      ...buildPublicState(session, interview)
    });
  } catch (error) {
    console.error('Public AI interview proctoring event error:', error);
    sendControllerError(res, error);
  }
};

exports.synthesizePublicSpeech = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'NOT_IN_PROGRESS', message: 'Interview is not in progress' });
    }

    // Prefer messageId — pick up the exact stored content so canonical-text
    // matching can never reject a legitimate playback request.
    const rawMessageId = req.body?.messageId ? String(req.body.messageId).trim() : '';
    let content = '';
    if (rawMessageId) {
      const message = session.messages.id(rawMessageId);
      if (!message || message.role !== 'ai') {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'Interview message not found' });
      }
      content = normalizeTranscriptText(message.content || '');
    }

    // Fallback: accept raw text and approve it against the stored AI messages.
    // Kept for older clients and one-off internal callers; preferred path is
    // messageId because it is unambiguous.
    if (!content) {
      const candidate = normalizeTranscriptText(truncateText(req.body?.text || req.body?.message || '', 4000));
      if (!candidate) {
        return res.status(400).json({ error: 'EMPTY_SPEECH_TEXT', message: 'Speech text is required' });
      }
      if (!isApprovedAssistantSpeech(session, candidate)) {
        return res.status(403).json({
          error: 'UNAPPROVED_SPEECH_TEXT',
          message: 'Only approved interviewer messages can be synthesized.'
        });
      }
      content = candidate;
    }

    console.log('[ai-interview/speech] synthesizing', {
      token: req.params.token?.slice(0, 8),
      messageId: rawMessageId || null,
      length: content.length,
      preview: content.slice(0, 80)
    });

    const speech = await azureSpeechTtsService.synthesize(content, {
      voice: interview.voice?.voiceId,
      language: interview.voice?.language
    });
    console.log('[ai-interview/speech] synthesized', {
      contentType: speech.contentType,
      bytes: speech.buffer.length,
      format: speech.outputFormat
    });
    res.set({
      'Content-Type': speech.contentType,
      'Content-Length': speech.buffer.length,
      'Cache-Control': 'no-store',
      'X-Speech-Output-Format': speech.outputFormat
    });
    res.send(speech.buffer);
  } catch (error) {
    console.error('Public AI interview speech synthesis error:', error.message);
    sendControllerError(res, error);
  }
};

exports.confirmPublicQuestion = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status !== 'in_progress') {
      return res.json({ success: true, ...buildPublicState(session, interview) });
    }

    await advanceQuestion(session, interview, 'answered');
    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Public AI interview confirm error:', error);
    sendControllerError(res, error);
  }
};

exports.timeoutPublicQuestion = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    const interview = session.aiInterview;
    await enforceDeadlines(session, interview);

    if (session.status === 'in_progress') {
      await advanceQuestion(session, interview, 'timeout');
    }

    res.json({ success: true, ...buildPublicState(session, interview) });
  } catch (error) {
    console.error('Public AI interview timeout error:', error);
    sendControllerError(res, error);
  }
};

// Reset a public interview session back to a fresh "ready to start" state.
// Used by the demo flow so a single bookmarked URL can be tested over and
// over without provisioning a new candidate/interview each time.
exports.resetPublicSession = async (req, res) => {
  try {
    const session = await findPublicSession(req.params.token);
    if (!session || !session.aiInterview) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview link not found' });
    }

    session.status = 'sent';
    session.currentQuestionIndex = 0;
    session.startedAt = undefined;
    session.completedAt = undefined;
    session.lastActivityAt = new Date();
    session.questionStartedAt = undefined;
    session.questionDeadlineAt = undefined;
    session.totalDeadlineAt = undefined;
    session.messages = [];
    session.answers = [];
    session.scoring = {
      status: 'pending',
      overallScore: undefined,
      recommendation: undefined,
      summary: undefined,
      strengths: [],
      concerns: [],
      questionScores: [],
      raw: undefined,
      error: undefined,
      scoredAt: undefined
    };
    session.proctoring = {
      enabled: true,
      maxFocusViolations: PROCTORING_MAX_FOCUS_VIOLATIONS,
      focusViolationCount: 0,
      pasteAttemptCount: 0,
      violations: [],
      terminatedAt: undefined,
      terminationReason: undefined
    };

    await session.save();
    await syncInterviewStats(session.aiInterview._id);

    res.json({ success: true, ...buildPublicState(session, session.aiInterview) });
  } catch (error) {
    console.error('Public AI interview reset error:', error);
    sendControllerError(res, error);
  }
};

exports._private = {
  hashPublicToken,
  syncInterviewStats
};
