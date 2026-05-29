require('dotenv').config();

const cors = require('cors');
const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const {
  id,
  iso,
  hashToken,
  mutateStore,
  readStore,
  writeStore,
  seedStore,
  getFrontendUrl,
  getOptionsPayload,
  makePublicState,
  shouldUseMongo,
  getMongoDbName,
  canAccessOwnedResource
} = require('./store');
const { estimateAIInterviewWalletCost, findAIInterviewVoiceOption } = require('./aiInterviewVoiceOptions');
const azureSpeechTtsService = require('./azureSpeechTtsService');
const azureSpeechSttService = require('./azureSpeechSttService');
const brevoEmailService = require('./brevoEmailService');
const questionGeneratorService = require('./questionGeneratorService');
const cvParsingService = require('./cvParsingService');
const {
  createPasswordRecord,
  verifyPassword,
  signToken,
  verifyToken,
  safeUser
} = require('./auth');
const {
  startSession,
  sendMessage,
  confirmQuestion,
  syncStats,
  buildScoringSummary,
  TERMINAL_SESSION_STATUSES
} = require('./interviewEngine');

const app = express();
const port = Number(process.env.AI_INTERVIEW_BACKEND_PORT || process.env.PORT || 5101);
const configuredOrigin = process.env.CORS_ORIGIN || process.env.AI_INTERVIEW_FRONTEND_URL || 'http://localhost:5200';
const allowedOrigins = new Set([
  configuredOrigin.replace(/\/$/, ''),
  'http://localhost:5200',
  'http://127.0.0.1:5200'
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const allowed = [
      '.pdf',
      '.docx',
      '.txt',
      '.csv',
      '.xlsx'
    ].some((extension) => name.endsWith(extension));
    cb(allowed ? null : new Error('Unsupported file type. Upload PDF, DOCX, TXT, CSV, or XLSX files.'), allowed);
  }
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
}));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: code, message });
}

function centsToUsd(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function usdToCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function publicUrl(token) {
  return `${getFrontendUrl()}/public/ai-interview/${encodeURIComponent(token)}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function findSessionByToken(store, token) {
  const tokenHash = hashToken(token);
  return store.sessions.find((session) => session.tokenHash === tokenHash);
}

function getInterview(store, sessionOrInterviewId) {
  const idValue = typeof sessionOrInterviewId === 'string' ? sessionOrInterviewId : sessionOrInterviewId?.aiInterview;
  return store.interviews.find((interview) => interview._id === idValue);
}

function buildInterviewListItem(store, interview) {
  const job = store.jobs.find((item) => item._id === interview.jobId);
  const sessions = store.sessions.filter((session) => session.aiInterview === interview._id);
  return {
    ...interview,
    job,
    sessions,
    scoringSummary: buildScoringSummary(sessions)
  };
}

function getWalletPayload(store) {
  return {
    wallet: {
      currency: store.settings.walletCurrency || 'USD',
      balanceCents: Number(store.settings.walletBalanceCents || 0),
      balanceUsd: centsToUsd(store.settings.walletBalanceCents),
      interviewPriceCents: Number(store.settings.interviewPriceCents || 150),
      interviewPriceUsd: centsToUsd(store.settings.interviewPriceCents || 150)
    },
    ledger: [...(store.walletLedger || [])].reverse()
  };
}

function appendWalletLedger(store, entry) {
  const amountCents = Math.round(Number(entry.amountCents || 0));
  if (!amountCents) throw new Error('Wallet transaction amount is required.');
  const currentBalance = Number(store.settings.walletBalanceCents || 0);
  const nextBalance = currentBalance + amountCents;
  if (nextBalance < 0) {
    throw new Error(`Insufficient wallet balance. Need $${centsToUsd(Math.abs(amountCents)).toFixed(2)}, have $${centsToUsd(currentBalance).toFixed(2)}.`);
  }
  const ledgerEntry = {
    _id: id('ledger'),
    type: entry.type,
    amountCents,
    balanceAfterCents: nextBalance,
    currency: store.settings.walletCurrency || 'USD',
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    description: entry.description,
    metadata: entry.metadata || {},
    createdBy: entry.createdBy,
    createdAt: iso(new Date())
  };
  store.walletLedger = store.walletLedger || [];
  store.walletLedger.push(ledgerEntry);
  store.settings.walletBalanceCents = nextBalance;
  return ledgerEntry;
}

function getAuthHeaderToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function authenticate(req, res, next) {
  try {
    const token = getAuthHeaderToken(req);
    if (!token) return sendError(res, 401, 'UNAUTHENTICATED', 'Login is required.');
    const claims = verifyToken(token);
    const store = await readStore();
    const user = store.users.find((item) => item._id === claims.sub && item.status === 'active');
    if (!user) return sendError(res, 401, 'UNAUTHENTICATED', 'User session is invalid.');
    req.user = user;
    req.userClaims = claims;
    next();
  } catch (error) {
    sendError(res, 401, 'UNAUTHENTICATED', error.message || 'Login is required.');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to access this area.');
    }
    next();
  };
}

function canAccessInterview(user, interview) {
  return user.role === 'admin' || !interview.createdBy || interview.createdBy === user._id;
}

function canAccessRecord(user, record) {
  return canAccessOwnedResource(user, record);
}

function getOwnedRecord(store, collectionName, idValue, user) {
  const record = store[collectionName]?.find((item) => item._id === idValue);
  if (!record || !canAccessRecord(user, record)) return null;
  return record;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,;\n]/).map((item) => normalizeText(item)).filter(Boolean);
  }
  return [];
}

function normalizeRichText(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  return normalizeText(value);
}

function buildJobPayload(body = {}) {
  return {
    title: normalizeText(body.title),
    department: normalizeText(body.department),
    location: normalizeText(body.location),
    description: normalizeText(body.description),
    level: normalizeText(body.level),
    type: normalizeText(body.type),
    remote: body.remote === true || body.remote === 'true',
    skills: normalizeStringArray(body.skills),
    requirements: normalizeRichText(body.requirements),
    responsibilities: normalizeRichText(body.responsibilities),
    benefits: normalizeRichText(body.benefits),
    openings: Math.max(1, Number(body.openings || 1))
  };
}

function normalizeQuestionScoringCriteria(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      criterion: normalizeText(item?.criterion),
      weight: Math.max(0, Number(item?.weight || 0)),
      description: normalizeText(item?.description)
    }))
    .filter((item) => item.criterion);
}

function normalizeCandidateProfile(profile = {}) {
  const name = normalizeText(profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '));
  const parsed = splitName(name);
  return {
    firstName: normalizeText(profile.firstName) || parsed.firstName,
    lastName: normalizeText(profile.lastName) || parsed.lastName,
    name,
    email: normalizeEmail(profile.email),
    phone: normalizeText(profile.phone),
    location: normalizeText(profile.location),
    currentTitle: normalizeText(profile.currentTitle || profile.title),
    yearsOfExperience: profile.yearsOfExperience !== undefined && profile.yearsOfExperience !== null
      ? Number(profile.yearsOfExperience) || null
      : null,
    skills: normalizeStringArray(profile.skills),
    education: Array.isArray(profile.education) ? profile.education.map((item) => normalizeText(item)).filter(Boolean) : [],
    workExperience: Array.isArray(profile.workExperience) ? profile.workExperience : [],
    summary: normalizeText(profile.summary),
    strengths: normalizeStringArray(profile.strengths),
    risks: normalizeStringArray(profile.risks)
  };
}

function mergeCandidateProfile(candidate, profileInput = {}, metadata = {}) {
  const profile = normalizeCandidateProfile(profileInput);
  const parsedName = splitName(profile.name || candidate.name);
  const nextName = profile.name || candidate.name || profile.email;
  candidate.firstName = profile.firstName || candidate.firstName || parsedName.firstName;
  candidate.lastName = profile.lastName || candidate.lastName || parsedName.lastName;
  candidate.name = nextName;
  candidate.email = profile.email || normalizeEmail(candidate.email);
  candidate.phone = profile.phone || candidate.phone || '';
  candidate.location = profile.location || candidate.location || '';
  candidate.currentTitle = profile.currentTitle || candidate.currentTitle || '';
  if (profile.yearsOfExperience !== null) candidate.yearsOfExperience = profile.yearsOfExperience;
  candidate.skills = Array.from(new Set([...(candidate.skills || []), ...(profile.skills || [])])).slice(0, 80);
  candidate.education = profile.education?.length ? profile.education : candidate.education || [];
  candidate.workExperience = profile.workExperience?.length ? profile.workExperience : candidate.workExperience || [];
  candidate.summary = profile.summary || candidate.summary || '';
  candidate.strengths = profile.strengths?.length ? profile.strengths : candidate.strengths || [];
  candidate.risks = profile.risks?.length ? profile.risks : candidate.risks || [];
  candidate.profileUpdatedAt = iso(new Date());
  candidate.profileSource = metadata.source || candidate.profileSource || 'manual';
  candidate.resumeUploads = candidate.resumeUploads || [];
  if (metadata.fileName) {
    candidate.resumeUploads.push({
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      textLength: Number(metadata.textLength || 0),
      analyzedAt: metadata.analyzedAt || iso(new Date())
    });
  }
  if (metadata.resumeText) candidate.resumeText = metadata.resumeText;
  if (metadata.ai) candidate.cvAnalysis = metadata.ai;
  return candidate;
}

function findCandidateByEmailAndJob(store, email, jobId, user) {
  return store.candidates.find((candidate) => (
    normalizeEmail(candidate.email) === normalizeEmail(email) &&
    candidate.jobId === jobId &&
    canAccessRecord(user, candidate)
  ));
}

function buildCandidateHistory(store, candidate, user) {
  const email = normalizeEmail(candidate.email);
  return store.sessions
    .filter((session) => (
      canAccessRecord(user, session) &&
      (session.candidateId === candidate._id || normalizeEmail(session.candidateSnapshot?.email) === email)
    ))
    .map((session) => {
      const interview = getInterview(store, session);
      const job = store.jobs.find((item) => item._id === (session.jobId || interview?.jobId));
      return {
        session,
        interview: interview ? {
          _id: interview._id,
          title: interview.title,
          status: interview.status,
          createdAt: interview.createdAt,
          completedAt: session.completedAt,
          voice: interview.voice
        } : null,
        job: job ? { _id: job._id, title: job.title } : null,
        scoring: session.scoring || { status: 'pending' },
        proctoring: session.proctoring || null
      };
    })
    .sort((a, b) => String(b.session.createdAt || '').localeCompare(String(a.session.createdAt || '')));
}

function parseTabularCandidates(file) {
  if (!file?.buffer?.length) throw new Error('Upload a CSV or XLSX file.');
  const name = String(file.originalname || '').toLowerCase();
  const workbook = name.endsWith('.csv')
    ? xlsx.read(file.buffer.toString('utf8'), { type: 'string' })
    : xlsx.read(file.buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The uploaded file has no sheets.');
  return xlsx.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' }).map((row) => {
    const normalized = Object.entries(row).reduce((acc, [key, value]) => {
      acc[String(key).trim().toLowerCase().replace(/[\s_-]+/g, '')] = value;
      return acc;
    }, {});
    const nameValue = normalizeText(
      normalized.name ||
      normalized.fullname ||
      `${normalized.firstname || ''} ${normalized.lastname || ''}`
    );
    return normalizeCandidateProfile({
      firstName: normalized.firstname,
      lastName: normalized.lastname,
      name: nameValue,
      email: normalized.email || normalized.emailaddress,
      phone: normalized.phone || normalized.telephone || normalized.mobile,
      location: normalized.location,
      currentTitle: normalized.currenttitle || normalized.title || normalized.role,
      skills: normalized.skills,
      summary: normalized.summary || normalized.notes
    });
  });
}

async function deliverInvite(store, interview, session, token) {
  const job = store.jobs.find((item) => item._id === interview.jobId);
  const url = publicUrl(token);
  session.email = session.email || {};
  session.email.attempts = Number(session.email.attempts || 0) + 1;

  if (!brevoEmailService.isConfigured()) {
    session.status = 'email_failed';
    session.email.lastError = 'BREVO_API_KEY is not configured.';
    store.emailLog.push({
      _id: id('email'),
      sessionId: session._id,
      aiInterview: interview._id,
      to: session.candidateSnapshot.email,
      subject: `AI Interview Invitation - ${interview.title}`,
      publicUrl: url,
      status: 'failed',
      error: session.email.lastError,
      createdAt: iso(new Date())
    });
    return { sent: false, publicUrl: url, error: session.email.lastError };
  }

  try {
    const result = await brevoEmailService.sendInvite({
      candidateEmail: session.candidateSnapshot.email,
      candidateName: session.candidateSnapshot.name,
      organizationName: store.settings.organizationName,
      jobTitle: job?.title || 'the role',
      interviewTitle: interview.title,
      questionCount: interview.questionSnapshots.length,
      expiresAt: interview.schedule.expiresAt,
      interviewUrl: url
    });
    session.status = 'sent';
    session.email.sentAt = iso(new Date());
    session.email.lastError = undefined;
    session.email.messageId = result?.messageId || result?.messageIds?.[0] || result?.messageId;
    session.email.deliveryMode = result?.mode || 'brevo';
    store.emailLog.push({
      _id: id('email'),
      sessionId: session._id,
      aiInterview: interview._id,
      to: session.candidateSnapshot.email,
      subject: `AI Interview Invitation - ${interview.title}`,
      publicUrl: url,
      status: 'sent',
      messageId: session.email.messageId,
      createdAt: iso(new Date())
    });
    return { sent: true, publicUrl: url, messageId: session.email.messageId };
  } catch (error) {
    session.status = 'email_failed';
    session.email.lastError = error.message;
    store.emailLog.push({
      _id: id('email'),
      sessionId: session._id,
      aiInterview: interview._id,
      to: session.candidateSnapshot.email,
      subject: `AI Interview Invitation - ${interview.title}`,
      publicUrl: url,
      status: 'failed',
      error: error.message,
      createdAt: iso(new Date())
    });
    return { sent: false, publicUrl: url, error: error.message };
  }
}

async function createSessionForRecipient({ store, interview, recipient, recipientType, user }) {
  const token = Buffer.from(`${id('token')}_${Date.now()}`).toString('base64url');
  const now = new Date();
  const dueNow = new Date(interview.schedule.sendAt) <= now;
  const session = {
    _id: id('sess'),
    aiInterview: interview._id,
    jobId: interview.jobId,
    candidateId: recipient._id || null,
    recipientType,
    candidateSnapshot: {
      firstName: recipient.firstName || splitName(recipient.name).firstName,
      lastName: recipient.lastName || splitName(recipient.name).lastName,
      name: recipient.name || `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || recipient.email,
      email: normalizeEmail(recipient.email)
    },
    tokenHash: hashToken(token),
    tokenGeneratedAt: iso(now),
    status: dueNow ? 'sending' : 'pending_send',
    currentQuestionIndex: 0,
    messages: [],
    answers: [],
    scoring: { status: 'pending' },
    email: { attempts: 0 },
    billing: {
      charged: true,
      currency: interview.billing?.currency || 'USD',
      amountCents: interview.billing?.unitPriceCents || 150,
      chargedAt: interview.billing?.chargedAt,
      ledgerEntryId: interview.billing?.ledgerEntryId
    },
    proctoring: {
      enabled: store.settings.proctoringEnabled !== false,
      maxFocusViolations: Number(store.settings.maxFocusViolations || 3),
      focusViolationCount: 0,
      pasteAttemptCount: 0,
      violations: []
    },
    createdBy: user?._id,
    createdAt: iso(now),
    updatedAt: iso(now)
  };
  store.sessions.push(session);
  let delivery = { sent: false, publicUrl: publicUrl(token), scheduled: !dueNow };
  if (dueNow) delivery = await deliverInvite(store, interview, session, token);
  return { session, token, publicUrl: delivery.publicUrl, delivery };
}

async function processDueInvites() {
  await mutateStore(async (store) => {
    const now = new Date();
    const dueSessions = store.sessions.filter((session) => {
      const interview = getInterview(store, session);
      return session.status === 'pending_send'
        && interview
        && ['scheduled', 'active', 'sending'].includes(interview.status)
        && new Date(interview.schedule.sendAt) <= now
        && new Date(interview.schedule.expiresAt) > now;
    }).slice(0, 25);

    for (const session of dueSessions) {
      const interview = getInterview(store, session);
      const token = Buffer.from(`${id('token')}_${Date.now()}`).toString('base64url');
      session.tokenHash = hashToken(token);
      session.tokenGeneratedAt = iso(now);
      session.status = 'sending';
      await deliverInvite(store, interview, session, token);
      if (interview.status === 'scheduled') interview.status = 'active';
      syncStats(store, interview._id);
    }
  });
}

app.get('/health', asyncHandler(async (_req, res) => {
  res.json({
    ok: true,
    app: 'seemplify-ai-interview',
    database: shouldUseMongo() ? getMongoDbName() : 'json-dev-store',
    emailConfigured: brevoEmailService.isConfigured(),
    time: new Date().toISOString()
  });
}));

app.post('/api/ai-interviews/public/:token/speech-transcribe', express.raw({
  type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'],
  limit: '15mb'
}), asyncHandler(async (req, res) => {
  const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  if (!audioBuffer.length) return sendError(res, 400, 'EMPTY_AUDIO', 'Audio payload is required.');
  const result = await azureSpeechSttService.transcribeWav(audioBuffer);
  if (!result.transcript) return sendError(res, 422, 'SPEECH_NOT_RECOGNIZED', 'Speech could not be recognized.');
  res.json(result);
}));

app.use(express.json({ limit: '2mb' }));

app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return sendError(res, 400, 'VALIDATION_ERROR', 'Name, email, and password are required.');
  const result = await mutateStore((store) => {
    if (store.settings.allowPublicSignup === false) throw new Error('Signup is disabled.');
    const normalizedEmail = normalizeEmail(email);
    if (store.users.some((user) => normalizeEmail(user.email) === normalizedEmail)) {
      throw new Error('A user with this email already exists.');
    }
    const now = iso(new Date());
    const user = {
      _id: id('user'),
      email: normalizedEmail,
      name: String(name).trim(),
      role: 'recruiter',
      status: 'active',
      ...createPasswordRecord(password),
      createdAt: now,
      updatedAt: now
    };
    store.users.push(user);
    return { token: signToken(user), user: safeUser(user) };
  });
  res.status(201).json(result);
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await mutateStore((store) => {
    const user = store.users.find((item) => normalizeEmail(item.email) === normalizeEmail(email) && item.status === 'active');
    if (!user || !verifyPassword(password, user)) throw new Error('Invalid email or password.');
    user.lastLoginAt = iso(new Date());
    return { token: signToken(user), user: safeUser(user) };
  });
  res.json(result);
}));

app.post('/api/admin/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await mutateStore((store) => {
    const user = store.users.find((item) => normalizeEmail(item.email) === normalizeEmail(email) && item.role === 'admin' && item.status === 'active');
    if (!user || !verifyPassword(password, user)) throw new Error('Invalid admin email or password.');
    user.lastLoginAt = iso(new Date());
    return { token: signToken(user), admin: safeUser(user) };
  });
  res.json(result);
}));

app.get('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ user: safeUser(req.user) });
}));

app.get('/api/admin/auth/me', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  res.json({ admin: safeUser(req.user) });
}));

app.get('/api/admin/settings', authenticate, requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json({ settings: (await readStore()).settings });
}));

app.patch('/api/admin/settings', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const settings = await mutateStore((store) => {
    const patch = { ...(req.body || {}) };
    delete patch.walletBalanceCents;
    if (patch.interviewPriceUsd !== undefined) {
      patch.interviewPriceCents = usdToCents(patch.interviewPriceUsd);
      delete patch.interviewPriceUsd;
    }
    if (patch.interviewPriceCents !== undefined) {
      patch.interviewPriceCents = Math.max(1, Math.round(Number(patch.interviewPriceCents) || 150));
    }
    store.settings = { ...store.settings, ...patch, walletCurrency: 'USD' };
    return store.settings;
  });
  res.json({ settings });
}));

app.get('/api/admin/users', authenticate, requireRole('admin'), asyncHandler(async (_req, res) => {
  const store = await readStore();
  res.json({ users: store.users.map(safeUser) });
}));

app.post('/api/admin/users', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, email, password, role = 'recruiter' } = req.body || {};
  if (!name || !email || !password) return sendError(res, 400, 'VALIDATION_ERROR', 'Name, email, and password are required.');
  if (!['admin', 'recruiter'].includes(role)) return sendError(res, 400, 'VALIDATION_ERROR', 'Role must be admin or recruiter.');
  const user = await mutateStore((store) => {
    const normalizedEmail = normalizeEmail(email);
    if (store.users.some((item) => normalizeEmail(item.email) === normalizedEmail)) throw new Error('A user with this email already exists.');
    const now = iso(new Date());
    const created = {
      _id: id('user'),
      email: normalizedEmail,
      name: String(name).trim(),
      role,
      status: 'active',
      ...createPasswordRecord(password),
      createdBy: req.user._id,
      createdAt: now,
      updatedAt: now
    };
    store.users.push(created);
    return safeUser(created);
  });
  res.status(201).json({ user });
}));

app.get('/api/wallet', authenticate, asyncHandler(async (req, res) => {
  if (!['admin', 'recruiter'].includes(req.user.role)) return sendError(res, 403, 'FORBIDDEN', 'Wallet access denied.');
  res.json(getWalletPayload(await readStore()));
}));

app.post('/api/wallet/top-up', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const amountCents = req.body?.amountCents !== undefined
      ? Math.round(Number(req.body.amountCents))
      : usdToCents(req.body?.amountUsd);
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('Top-up amount must be greater than zero.');
    appendWalletLedger(store, {
      type: 'top_up',
      amountCents,
      description: req.body?.description || 'Manual wallet top-up from standalone admin',
      createdBy: req.user._id,
      metadata: { source: 'standalone_admin', note: req.body?.note }
    });
    return getWalletPayload(store);
  });
  res.json(result);
}));

app.post('/api/admin/seed-demo', authenticate, requireRole('admin'), asyncHandler(async (_req, res) => {
  const store = seedStore();
  await writeStore(store);
  res.json({ success: true, demoUrl: publicUrl('demo-token') });
}));

app.get('/api/admin/email-status', authenticate, requireRole('admin'), asyncHandler(async (_req, res) => {
  const config = brevoEmailService.getBrevoConfig();
  res.json({
    configured: brevoEmailService.isConfigured(),
    mode: config.mode,
    fromEmail: config.fromEmail,
    fromName: config.fromName
  });
}));

app.get('/api/jobs', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  const jobs = store.jobs
    .filter((job) => canAccessRecord(req.user, job))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ jobs });
}));

app.post('/api/jobs', authenticate, asyncHandler(async (req, res) => {
  const job = await mutateStore((store) => {
    const payload = buildJobPayload(req.body);
    if (!payload.title) throw new Error('Job title is required.');
    const now = iso(new Date());
    const created = {
      _id: id('job'),
      ...payload,
      status: req.body?.status === 'archived' ? 'archived' : 'active',
      createdBy: req.user._id,
      createdAt: now,
      updatedAt: now
    };
    store.jobs.push(created);
    return created;
  });
  res.status(201).json({ job });
}));

app.patch('/api/jobs/:id', authenticate, asyncHandler(async (req, res) => {
  const job = await mutateStore((store) => {
    const record = getOwnedRecord(store, 'jobs', req.params.id, req.user);
    if (!record) throw new Error('Job not found.');
    if (req.body?.title !== undefined) {
      const title = normalizeText(req.body.title);
      if (!title) throw new Error('Job title is required.');
      record.title = title;
    }
    if (req.body?.department !== undefined) record.department = normalizeText(req.body.department);
    if (req.body?.location !== undefined) record.location = normalizeText(req.body.location);
    if (req.body?.description !== undefined) record.description = normalizeText(req.body.description);
    if (req.body?.level !== undefined) record.level = normalizeText(req.body.level);
    if (req.body?.type !== undefined) record.type = normalizeText(req.body.type);
    if (req.body?.remote !== undefined) record.remote = req.body.remote === true || req.body.remote === 'true';
    if (req.body?.skills !== undefined) record.skills = normalizeStringArray(req.body.skills);
    if (req.body?.requirements !== undefined) record.requirements = normalizeRichText(req.body.requirements);
    if (req.body?.responsibilities !== undefined) record.responsibilities = normalizeRichText(req.body.responsibilities);
    if (req.body?.benefits !== undefined) record.benefits = normalizeRichText(req.body.benefits);
    if (req.body?.openings !== undefined) record.openings = Math.max(1, Number(req.body.openings || 1));
    if (req.body?.status !== undefined) record.status = req.body.status === 'archived' ? 'archived' : 'active';
    record.updatedAt = iso(new Date());
    return record;
  });
  res.json({ job });
}));

app.delete('/api/jobs/:id', authenticate, asyncHandler(async (req, res) => {
  await mutateStore((store) => {
    const record = getOwnedRecord(store, 'jobs', req.params.id, req.user);
    if (!record) throw new Error('Job not found.');
    if (store.interviews.some((interview) => interview.jobId === record._id)) {
      throw new Error('This job already has interviews. Archive it instead of deleting it.');
    }
    store.jobs = store.jobs.filter((job) => job._id !== record._id);
    store.candidates = store.candidates.filter((candidate) => candidate.jobId !== record._id);
    store.questions = store.questions.filter((question) => question.jobId !== record._id);
  });
  res.json({ success: true });
}));

app.get('/api/candidates', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  let candidates = store.candidates.filter((candidate) => canAccessRecord(req.user, candidate));
  if (req.query.jobId) candidates = candidates.filter((candidate) => candidate.jobId === req.query.jobId);
  candidates = candidates.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  res.json({ candidates });
}));

app.post('/api/candidates', authenticate, asyncHandler(async (req, res) => {
  const candidate = await mutateStore((store) => {
    const job = getOwnedRecord(store, 'jobs', req.body?.jobId, req.user);
    if (!job) throw new Error('A valid job is required for this candidate.');
    const profile = normalizeCandidateProfile(req.body);
    const email = profile.email;
    const name = profile.name;
    if (!name || !email) throw new Error('Candidate name and email are required.');
    if (store.candidates.some((item) => normalizeEmail(item.email) === email && item.jobId === job._id && canAccessRecord(req.user, item))) {
      throw new Error('This candidate already exists for the selected job.');
    }
    const now = iso(new Date());
    const created = {
      _id: id('cand'),
      firstName: profile.firstName,
      lastName: profile.lastName,
      name,
      email,
      phone: profile.phone,
      location: profile.location,
      currentTitle: profile.currentTitle,
      yearsOfExperience: profile.yearsOfExperience,
      skills: profile.skills,
      education: profile.education,
      workExperience: profile.workExperience,
      summary: profile.summary,
      strengths: profile.strengths,
      risks: profile.risks,
      jobId: job._id,
      status: req.body?.status === 'archived' ? 'archived' : 'active',
      createdBy: req.user._id,
      createdAt: now,
      updatedAt: now
    };
    store.candidates.push(created);
    return created;
  });
  res.status(201).json({ candidate });
}));

app.post('/api/candidates/import-cv', authenticate, upload.single('cv'), asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const job = getOwnedRecord(store, 'jobs', req.body?.jobId, req.user);
    if (!job) throw new Error('A valid job is required before importing a CV.');
    if (!req.file) throw new Error('Upload a CV file.');
    const parsed = await cvParsingService.parseAndAnalyze(req.file);
    const profile = parsed.profile;
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('The CV was parsed, but no email address was found. Add the candidate manually or upload a clearer CV.');
    let candidate = findCandidateByEmailAndJob(store, email, job._id, req.user);
    const now = iso(new Date());
    if (!candidate) {
      candidate = {
        _id: id('cand'),
        jobId: job._id,
        status: 'active',
        createdBy: req.user._id,
        createdAt: now,
        updatedAt: now
      };
      store.candidates.push(candidate);
    }
    mergeCandidateProfile(candidate, profile, {
      source: 'cv_import',
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      textLength: parsed.resumeText?.length || 0,
      resumeText: parsed.resumeText,
      ai: parsed.ai
    });
    candidate.updatedAt = now;
    return { candidate, profile: parsed.profile, history: buildCandidateHistory(store, candidate, req.user) };
  });
  res.status(201).json(result);
}));

app.post('/api/candidates/import-table', authenticate, upload.single('file'), asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const job = getOwnedRecord(store, 'jobs', req.body?.jobId, req.user);
    if (!job) throw new Error('A valid job is required before importing candidates.');
    if (!req.file) throw new Error('Upload a CSV or XLSX file.');
    const rows = parseTabularCandidates(req.file);
    const imported = [];
    const updated = [];
    const skipped = [];
    const now = iso(new Date());

    for (const row of rows) {
      if (!row.email || !row.name) {
        skipped.push({ row: row.name || row.email || 'unknown', reason: 'Missing name or email' });
        continue;
      }
      let candidate = findCandidateByEmailAndJob(store, row.email, job._id, req.user);
      if (candidate) {
        mergeCandidateProfile(candidate, row, { source: 'table_import' });
        candidate.updatedAt = now;
        updated.push(candidate);
      } else {
        candidate = {
          _id: id('cand'),
          jobId: job._id,
          status: 'active',
          createdBy: req.user._id,
          createdAt: now,
          updatedAt: now
        };
        mergeCandidateProfile(candidate, row, { source: 'table_import' });
        store.candidates.push(candidate);
        imported.push(candidate);
      }
    }

    return {
      importedCount: imported.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      skipped,
      candidates: [...imported, ...updated]
    };
  });
  res.status(201).json(result);
}));

app.get('/api/candidates/:id/profile', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  const candidate = getOwnedRecord(store, 'candidates', req.params.id, req.user);
  if (!candidate) return sendError(res, 404, 'NOT_FOUND', 'Candidate not found.');
  res.json({ candidate, history: buildCandidateHistory(store, candidate, req.user) });
}));

app.post('/api/candidates/:id/cv', authenticate, upload.single('cv'), asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const candidate = getOwnedRecord(store, 'candidates', req.params.id, req.user);
    if (!candidate) throw new Error('Candidate not found.');
    if (!req.file) throw new Error('Upload a CV file.');
    const parsed = await cvParsingService.parseAndAnalyze(req.file);
    mergeCandidateProfile(candidate, parsed.profile, {
      source: 'cv_enrichment',
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      textLength: parsed.resumeText?.length || 0,
      resumeText: parsed.resumeText,
      ai: parsed.ai
    });
    candidate.updatedAt = iso(new Date());
    return { candidate, profile: parsed.profile, history: buildCandidateHistory(store, candidate, req.user) };
  });
  res.json(result);
}));

app.patch('/api/candidates/:id', authenticate, asyncHandler(async (req, res) => {
  const candidate = await mutateStore((store) => {
    const record = getOwnedRecord(store, 'candidates', req.params.id, req.user);
    if (!record) throw new Error('Candidate not found.');
    if (req.body?.jobId !== undefined) {
      const job = getOwnedRecord(store, 'jobs', req.body.jobId, req.user);
      if (!job) throw new Error('A valid job is required.');
      record.jobId = job._id;
    }
    if (req.body?.email !== undefined) {
      const email = normalizeEmail(req.body.email);
      if (!email) throw new Error('Candidate email is required.');
      record.email = email;
    }
    if (req.body?.name !== undefined || req.body?.firstName !== undefined || req.body?.lastName !== undefined) {
      const name = normalizeText(req.body?.name || `${req.body?.firstName || record.firstName || ''} ${req.body?.lastName || record.lastName || ''}`);
      if (!name) throw new Error('Candidate name is required.');
      const parsed = splitName(name);
      record.name = name;
      record.firstName = normalizeText(req.body?.firstName) || parsed.firstName;
      record.lastName = normalizeText(req.body?.lastName) || parsed.lastName;
    }
    if (req.body?.phone !== undefined) record.phone = normalizeText(req.body.phone);
    if (req.body?.location !== undefined) record.location = normalizeText(req.body.location);
    if (req.body?.currentTitle !== undefined) record.currentTitle = normalizeText(req.body.currentTitle);
    if (req.body?.yearsOfExperience !== undefined) record.yearsOfExperience = Number(req.body.yearsOfExperience) || null;
    if (req.body?.skills !== undefined) record.skills = normalizeStringArray(req.body.skills);
    if (req.body?.summary !== undefined) record.summary = normalizeText(req.body.summary);
    if (req.body?.status !== undefined) record.status = req.body.status === 'archived' ? 'archived' : 'active';
    record.updatedAt = iso(new Date());
    return record;
  });
  res.json({ candidate });
}));

app.delete('/api/candidates/:id', authenticate, asyncHandler(async (req, res) => {
  await mutateStore((store) => {
    const record = getOwnedRecord(store, 'candidates', req.params.id, req.user);
    if (!record) throw new Error('Candidate not found.');
    if (store.sessions.some((session) => session.candidateId === record._id)) {
      throw new Error('This candidate already has interview sessions. Archive the candidate instead of deleting.');
    }
    store.candidates = store.candidates.filter((candidate) => candidate._id !== record._id);
  });
  res.json({ success: true });
}));

app.get('/api/questions', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  let questions = store.questions.filter((question) => canAccessRecord(req.user, question));
  if (req.query.jobId) questions = questions.filter((question) => question.jobId === req.query.jobId);
  res.json({ questions });
}));

app.post('/api/questions/generate', authenticate, asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const job = getOwnedRecord(store, 'jobs', req.body?.jobId, req.user);
    if (!job) throw new Error('A valid job is required for question generation.');
    const generated = await questionGeneratorService.generateForJob(job, {
      questionCount: req.body?.questionCount,
      difficulty: req.body?.difficulty,
      includeTypes: req.body?.includeTypes,
      focusAreas: req.body?.focusAreas
    });
    if (!generated.length) throw new Error('AI question generation returned no usable questions.');
    const now = iso(new Date());
    const questions = generated.map((question) => ({
      _id: id('q'),
      jobId: job._id,
      question: normalizeText(question.question),
      type: normalizeText(question.type) || 'behavioral',
      category: normalizeText(question.category),
      difficulty: normalizeText(question.difficulty) || normalizeText(req.body?.difficulty) || 'medium',
      expectedAnswer: normalizeText(question.expectedAnswer),
      scoringCriteria: normalizeQuestionScoringCriteria(question.scoringCriteria),
      followUpQuestions: question.followUpQuestions || [],
      tags: normalizeStringArray(question.tags),
      timeLimit: Number(question.timeLimit || 5),
      isAIGenerated: true,
      aiGenerationMetadata: question.aiGenerationMetadata,
      createdBy: req.user._id,
      createdAt: now,
      updatedAt: now
    })).filter((question) => question.question);
    store.questions.push(...questions);
    return { questions, count: questions.length };
  });
  res.status(201).json(result);
}));

app.post('/api/questions', authenticate, asyncHandler(async (req, res) => {
  const question = await mutateStore((store) => {
    const job = getOwnedRecord(store, 'jobs', req.body?.jobId, req.user);
    if (!job) throw new Error('A valid job is required for this question.');
    const text = normalizeText(req.body?.question);
    if (!text) throw new Error('Question text is required.');
    const now = iso(new Date());
    const created = {
      _id: id('q'),
      jobId: job._id,
      question: text,
      type: normalizeText(req.body?.type) || 'behavioral',
      category: normalizeText(req.body?.category),
      difficulty: normalizeText(req.body?.difficulty) || 'standard',
      expectedAnswer: normalizeText(req.body?.expectedAnswer),
      scoringCriteria: normalizeQuestionScoringCriteria(req.body?.scoringCriteria),
      createdBy: req.user._id,
      createdAt: now,
      updatedAt: now
    };
    store.questions.push(created);
    return created;
  });
  res.status(201).json({ question });
}));

app.patch('/api/questions/:id', authenticate, asyncHandler(async (req, res) => {
  const question = await mutateStore((store) => {
    const record = getOwnedRecord(store, 'questions', req.params.id, req.user);
    if (!record) throw new Error('Question not found.');
    if (req.body?.jobId !== undefined) {
      const job = getOwnedRecord(store, 'jobs', req.body.jobId, req.user);
      if (!job) throw new Error('A valid job is required.');
      record.jobId = job._id;
    }
    if (req.body?.question !== undefined) {
      const text = normalizeText(req.body.question);
      if (!text) throw new Error('Question text is required.');
      record.question = text;
    }
    if (req.body?.type !== undefined) record.type = normalizeText(req.body.type) || 'behavioral';
    if (req.body?.category !== undefined) record.category = normalizeText(req.body.category);
    if (req.body?.difficulty !== undefined) record.difficulty = normalizeText(req.body.difficulty) || 'standard';
    if (req.body?.expectedAnswer !== undefined) record.expectedAnswer = normalizeText(req.body.expectedAnswer);
    if (req.body?.scoringCriteria !== undefined) record.scoringCriteria = normalizeQuestionScoringCriteria(req.body.scoringCriteria);
    record.updatedAt = iso(new Date());
    return record;
  });
  res.json({ question });
}));

app.delete('/api/questions/:id', authenticate, asyncHandler(async (req, res) => {
  await mutateStore((store) => {
    const record = getOwnedRecord(store, 'questions', req.params.id, req.user);
    if (!record) throw new Error('Question not found.');
    store.questions = store.questions.filter((question) => question._id !== record._id);
  });
  res.json({ success: true });
}));

app.get('/api/ai-interviews/options', authenticate, asyncHandler(async (_req, res) => {
  res.json(getOptionsPayload(await readStore(), _req.user));
}));

app.post('/api/ai-interviews/estimate', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  const estimate = estimateAIInterviewWalletCost({
    ...(req.body || {}),
    unitPriceCents: store.settings.interviewPriceCents || 150
  });
  const walletBalanceCents = Number(store.settings.walletBalanceCents || 0);
  res.json({
    estimate: {
      ...estimate,
      walletBalanceCents,
      walletBalanceUsd: centsToUsd(walletBalanceCents),
      enoughFunds: estimate.totalCents <= walletBalanceCents,
      displayValue: { amount: estimate.totalUsd, currency: 'USD', source: 'standalone_wallet_pricing' }
    }
  });
}));

app.post('/api/ai-interviews/voice-preview', authenticate, asyncHandler(async (req, res) => {
  const voice = findAIInterviewVoiceOption(req.body?.voiceId);
  const text = req.body?.text || voice.samplePhrase || 'Hello. I will guide you through this AI interview.';
  const result = await azureSpeechTtsService.synthesize(text, { voice: voice.id, language: voice.language });
  res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
  res.send(result.buffer);
}));

app.get('/api/ai-interviews', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  let interviews = store.interviews.filter((interview) => canAccessInterview(req.user, interview));
  if (req.query.jobId) interviews = interviews.filter((interview) => interview.jobId === req.query.jobId);
  if (req.query.status) interviews = interviews.filter((interview) => interview.status === req.query.status);
  res.json({ aiInterviews: interviews.map((interview) => buildInterviewListItem(store, interview)) });
}));

app.post('/api/ai-interviews', authenticate, asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const job = getOwnedRecord(store, 'jobs', req.body.jobId, req.user);
    if (!job) throw new Error('Job is required.');

    const selectedCandidates = (req.body.candidateIds || [])
      .map((candidateId) => getOwnedRecord(store, 'candidates', candidateId, req.user))
      .filter(Boolean);
    const guests = (req.body.guestRecipients || [])
      .map((guest) => ({ ...guest, email: normalizeEmail(guest.email), name: guest.name || guest.email }))
      .filter((guest) => guest.email);
    const recipients = [
      ...selectedCandidates.map((candidate) => ({ recipient: candidate, recipientType: 'candidate' })),
      ...guests.map((guest) => ({ recipient: guest, recipientType: 'guest' }))
    ];
    if (!recipients.length) throw new Error('Select at least one candidate or guest recipient.');

    const questions = (req.body.questionIds || [])
      .map((questionId) => getOwnedRecord(store, 'questions', questionId, req.user))
      .filter(Boolean);
    if (!questions.length) throw new Error('Select at least one question.');

    const totalMinutes = Number(req.body.totalMinutes || 45);
    const estimate = estimateAIInterviewWalletCost({
      candidateCount: recipients.length,
      questionCount: questions.length,
      totalMinutes,
      voiceId: req.body.voiceId,
      unitPriceCents: store.settings.interviewPriceCents || 150
    });
    if (estimate.totalCents > Number(store.settings.walletBalanceCents || 0)) {
      throw new Error(`Insufficient wallet balance. Need $${estimate.totalUsd.toFixed(2)}, have $${centsToUsd(store.settings.walletBalanceCents).toFixed(2)}.`);
    }

    const now = new Date();
    const interviewId = id('ai');
    const ledgerEntry = appendWalletLedger(store, {
      type: 'interview_debit',
      amountCents: -estimate.totalCents,
      referenceType: 'ai_interview',
      referenceId: interviewId,
      createdBy: req.user._id,
      description: `AI interview charge for ${recipients.length} candidate session${recipients.length === 1 ? '' : 's'}`,
      metadata: { unitPriceCents: estimate.unitPriceCents, candidateCount: recipients.length, voiceId: req.body.voiceId }
    });
    const interview = {
      _id: interviewId,
      title: req.body.title || `${job.title} AI Interview`,
      jobId: job._id,
      status: new Date(req.body.sendAt || now) <= now ? 'active' : 'scheduled',
      guidelines: req.body.guidelines || '',
      questionSnapshots: questions.map((question, index) => ({
        questionId: question._id,
        question: question.question,
        type: question.type,
        category: question.category,
        difficulty: question.difficulty,
        order: index + 1,
        expectedAnswer: question.expectedAnswer,
        scoringCriteria: question.scoringCriteria
      })),
      timers: { perQuestionMinutes: Number(req.body.perQuestionMinutes || 10), totalMinutes },
      schedule: {
        sendAt: iso(req.body.sendAt || now),
        expiresAt: iso(req.body.expiresAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        timezone: req.body.timezone || 'UTC'
      },
      candidateCount: recipients.length,
      billing: { currency: 'USD', unitPriceCents: estimate.unitPriceCents, totalCents: estimate.totalCents, chargedAt: ledgerEntry.createdAt, ledgerEntryId: ledgerEntry._id },
      costEstimate: estimate,
      voice: findAIInterviewVoiceOption(req.body.voiceId),
      stats: { sent: 0, opened: 0, inProgress: 0, completed: 0, blocked: 0, failed: 0, proctorFailed: 0 },
      createdBy: req.user._id,
      createdAt: iso(now),
      updatedAt: iso(now)
    };
    store.interviews.unshift(interview);
    const createdSessions = [];
    for (const item of recipients) {
      createdSessions.push(await createSessionForRecipient({ store, interview, ...item, user: req.user }));
    }
    syncStats(store, interview._id);
    return {
      aiInterview: buildInterviewListItem(store, interview),
      sessions: createdSessions.map((item) => item.session),
      publicLinks: createdSessions.map((item) => ({
        sessionId: item.session._id,
        candidateName: item.session.candidateSnapshot.name,
        candidateEmail: item.session.candidateSnapshot.email,
        publicUrl: item.publicUrl,
        sent: item.delivery.sent,
        emailError: item.delivery.error
      })),
      walletCharge: { ...interview.billing, balanceAfterCents: ledgerEntry.balanceAfterCents, balanceAfterUsd: centsToUsd(ledgerEntry.balanceAfterCents) },
      costPreview: estimate
    };
  });
  res.status(201).json(result);
}));

app.get('/api/ai-interviews/:id', authenticate, asyncHandler(async (req, res) => {
  const store = await readStore();
  const interview = store.interviews.find((item) => item._id === req.params.id);
  if (!interview || !canAccessInterview(req.user, interview)) return sendError(res, 404, 'NOT_FOUND', 'Interview not found');
  const sessions = store.sessions.filter((session) => session.aiInterview === interview._id);
  res.json({ aiInterview: buildInterviewListItem(store, interview), sessions });
}));

app.post('/api/ai-interviews/:id/resend', authenticate, asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const interview = store.interviews.find((item) => item._id === req.params.id);
    if (!interview || !canAccessInterview(req.user, interview)) throw new Error('Interview not found');
    const links = [];
    const targetSessionIds = Array.isArray(req.body?.sessionIds) ? new Set(req.body.sessionIds) : null;
    const sessions = store.sessions.filter((session) => session.aiInterview === interview._id && (!targetSessionIds || targetSessionIds.has(session._id)));
    for (const session of sessions) {
      if (TERMINAL_SESSION_STATUSES.has(session.status)) continue;
      const token = Buffer.from(`${id('token')}_${Date.now()}`).toString('base64url');
      session.tokenHash = hashToken(token);
      session.tokenGeneratedAt = iso(new Date());
      const delivery = await deliverInvite(store, interview, session, token);
      links.push({ sessionId: session._id, candidateName: session.candidateSnapshot.name, candidateEmail: session.candidateSnapshot.email, publicUrl: delivery.publicUrl, sent: delivery.sent, emailError: delivery.error });
    }
    syncStats(store, interview._id);
    return { success: true, publicLinks: links };
  });
  res.json(result);
}));

app.post('/api/ai-interviews/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  await mutateStore((store) => {
    const interview = store.interviews.find((item) => item._id === req.params.id);
    if (!interview || !canAccessInterview(req.user, interview)) throw new Error('Interview not found');
    interview.status = 'cancelled';
    interview.cancelledAt = iso(new Date());
    interview.cancellationReason = req.body?.reason || 'Cancelled from standalone app';
    store.sessions.filter((session) => session.aiInterview === interview._id && !TERMINAL_SESSION_STATUSES.has(session.status)).forEach((session) => {
      session.status = 'cancelled';
      session.updatedAt = iso(new Date());
    });
    syncStats(store, interview._id);
  });
  res.json({ success: true });
}));

app.get('/api/ai-interviews/public/:token', asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    if (session.status === 'sent') session.status = 'opened';
    session.lastActivityAt = iso(new Date());
    session.updatedAt = iso(new Date());
    syncStats(store, session.aiInterview);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.get('/api/ai-interviews/public/:token/voice', asyncHandler(async (req, res) => {
  const store = await readStore();
  const session = findSessionByToken(store, req.params.token);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json({ success: true, canStart: true, voice: makePublicState(store, session).voice });
}));

app.post('/api/ai-interviews/public/:token/start', asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    const interview = getInterview(store, session);
    await startSession(interview, session);
    syncStats(store, interview._id);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/message', asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    const interview = getInterview(store, session);
    await sendMessage(interview, session, req.body?.message);
    syncStats(store, interview._id);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/confirm', asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    const interview = getInterview(store, session);
    await confirmQuestion(interview, session, 'skipped');
    syncStats(store, interview._id);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/timeout', asyncHandler(async (req, res) => {
  const result = await mutateStore(async (store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    const interview = getInterview(store, session);
    await confirmQuestion(interview, session, 'timeout');
    syncStats(store, interview._id);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/reset', asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    Object.assign(session, {
      status: 'sent',
      currentQuestionIndex: 0,
      startedAt: undefined,
      completedAt: undefined,
      questionStartedAt: undefined,
      questionDeadlineAt: undefined,
      totalDeadlineAt: undefined,
      messages: [],
      answers: [],
      scoring: { status: 'pending' },
      proctoring: { enabled: true, maxFocusViolations: 3, focusViolationCount: 0, pasteAttemptCount: 0, violations: [] }
    });
    syncStats(store, session.aiInterview);
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/proctoring-event', asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    if (session.status !== 'in_progress') return makePublicState(store, session, { action: 'ignored' });
    const type = req.body?.type;
    const category = ['paste_attempt', 'drop_attempt'].includes(type) ? 'input' : 'focus';
    const max = Number(session.proctoring?.maxFocusViolations || 3);
    let count = 1;
    let action = 'logged';
    let message = 'This proctoring event has been recorded.';

    if (category === 'focus') {
      count = Number(session.proctoring.focusViolationCount || 0) + 1;
      session.proctoring.focusViolationCount = count;
      if (count >= max) {
        action = 'terminated';
        message = 'Interview ended because the interview screen was left too many times. The recruiter will see this proctoring log.';
        session.status = 'proctor_failed';
        session.completedAt = iso(new Date());
        session.proctoring.terminatedAt = session.completedAt;
        session.proctoring.terminationReason = message;
      } else if (count === max - 1) {
        action = 'final_warning';
        message = `Final warning: you have left the interview screen ${count} times. If you leave again, the interview will automatically end.`;
      } else {
        action = 'warned';
        message = `You moved away from the interview screen ${count} time${count === 1 ? '' : 's'}. You have ${Math.max(0, max - count)} more before the interview is blocked.`;
      }
    } else {
      count = Number(session.proctoring.pasteAttemptCount || 0) + 1;
      session.proctoring.pasteAttemptCount = count;
      message = type === 'drop_attempt'
        ? 'Dropping prepared text or files into the answer box is disabled. This attempt has been logged for the recruiter.'
        : 'Pasting prepared answers is disabled for this interview. This attempt has been logged for the recruiter.';
    }

    session.proctoring.violations.push({
      _id: id('pv'),
      type,
      category,
      questionIndex: session.currentQuestionIndex,
      count,
      actionTaken: action,
      message,
      metadata: req.body?.metadata || {},
      createdAt: iso(new Date())
    });
    syncStats(store, session.aiInterview);
    return makePublicState(store, session, { action, warningMessage: message });
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/voice-transcript', asyncHandler(async (req, res) => {
  const result = await mutateStore((store) => {
    const session = findSessionByToken(store, req.params.token);
    if (!session) return null;
    const message = String(req.body?.message || '').trim();
    if (message) {
      session.messages.push({
        _id: id('msg'),
        role: req.body?.role === 'ai' ? 'ai' : 'candidate',
        content: message,
        questionIndex: session.currentQuestionIndex,
        messageType: req.body?.messageType || 'answer',
        createdAt: iso(new Date())
      });
    }
    return makePublicState(store, session);
  });
  if (!result) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  res.json(result);
}));

app.post('/api/ai-interviews/public/:token/speech', asyncHandler(async (req, res) => {
  const store = await readStore();
  const session = findSessionByToken(store, req.params.token);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Interview link not found');
  const interview = getInterview(store, session);
  const message = req.body?.messageId ? session.messages.find((item) => item._id === req.body.messageId)?.content : req.body?.text;
  const voice = interview?.voice || findAIInterviewVoiceOption();
  const result = await azureSpeechTtsService.synthesize(message, { voice: voice.voiceId || voice.id, language: voice.language });
  res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
  res.send(result.buffer);
}));

app.post('/api/ai-interviews/public/:token/speech-token', asyncHandler(async (req, res) => {
  const speechKey = process.env.AZURE_SPEECH_KEY || process.env.AZURE_VOICELIVE_API_KEY;
  const speechRegion = process.env.AZURE_SPEECH_REGION || process.env.AZURE_LOCATION;
  if (!speechKey || !speechRegion) {
    return sendError(res, 503, 'SPEECH_TOKEN_NOT_CONFIGURED', 'Azure Speech is not configured.');
  }
  res.json({
    success: true,
    speech: {
      token: speechKey,
      region: speechRegion,
      language: process.env.AZURE_SPEECH_LANGUAGE || 'en-US',
      expiresInSeconds: 600
    }
  });
}));

app.use((error, _req, res, _next) => {
  console.error('AI Interview API error:', error);
  const validationMessage = /required|not found|already exists|invalid|unsupported|upload|insufficient|missing|disabled|select|only/i.test(error.message || '');
  const status = Number(error.statusCode || error.status || (validationMessage ? 400 : 500));
  sendError(res, status, error.code || (status >= 500 ? 'SERVER_ERROR' : 'REQUEST_ERROR'), error.message || 'Server error');
});

readStore()
  .then(() => {
    app.listen(port, () => {
      console.log(`AI Interview standalone backend running on http://localhost:${port}`);
      console.log(`Database: ${shouldUseMongo() ? getMongoDbName() : 'json-dev-store'}`);
      console.log(`Brevo email configured: ${brevoEmailService.isConfigured() ? 'yes' : 'no'}`);
      console.log(`Demo candidate link: ${getFrontendUrl()}/public/ai-interview/demo-token`);
    });
    setInterval(() => {
      processDueInvites().catch((error) => console.error('Due invite scheduler failed:', error.message));
    }, 60 * 1000).unref();
  })
  .catch((error) => {
    console.error('Failed to start AI Interview backend:', error);
    process.exit(1);
  });
