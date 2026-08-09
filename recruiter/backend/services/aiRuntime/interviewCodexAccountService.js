const AIInterviewRuntimeAccount = require('../../models/AIInterviewRuntimeAccount');
const { AIRuntimeError } = require('./aiRuntimeService');
const { callGateway, subjectKeyForUser } = require('./codexAccountService');

const CLEANUP_RETENTION_DAYS = Math.max(1, Number(process.env.AI_INTERVIEW_CONNECTION_RETENTION_DAYS || 30));

function cleanupRetryAt(attempts, now = Date.now()) {
  const minutes = Math.min(60, 2 ** Math.min(Math.max(1, Number(attempts) || 1), 6));
  return new Date(now + minutes * 60 * 1000);
}

function cleanupState(account) {
  if (!account.credentialCleanup) account.credentialCleanup = {};
  return account.credentialCleanup;
}

function clearConnection(account, { reason = 'candidate_requested', terminal = false } = {}) {
  account.status = 'disconnected';
  account.connectedEmail = '';
  account.planType = '';
  account.connectedAt = null;
  account.disconnectedAt = new Date();
  account.dataSharingAcknowledgedAt = null;
  const cleanup = cleanupState(account);
  cleanup.status = 'pending';
  cleanup.requestedAt = cleanup.requestedAt || new Date();
  cleanup.nextAttemptAt = new Date();
  cleanup.completedAt = null;
  cleanup.reason = String(reason || '').slice(0, 80);
  cleanup.lastError = '';
  if (terminal) {
    account.purgeAfter = new Date(Date.now() + CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  }
  return account;
}

/**
 * A candidate's own ChatGPT connection for one live AI interview.
 *
 * A candidate holds only an interview link, so the connection is scoped to
 * their session rather than to a platform account. Everything else mirrors the
 * recruiter flow: the device login and the credential store live on the
 * gateway host, and this service keeps the durable connection state.
 */

/** Namespaced so a session subject can never collide with a user subject on
 * the gateway host, even if the two ids were ever equal. */
function subjectIdForSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) {
    throw new AIRuntimeError('An interview ChatGPT connection requires a session', {
      code: 'CHATGPT_SUBJECT_UNRESOLVED', statusCode: 400, retryable: false
    });
  }
  return `interview:${id}`;
}

async function accountForSession(session) {
  const sessionId = String(session?._id || session?.id || session || '');
  const subjectId = subjectIdForSession(sessionId);
  const existing = await AIInterviewRuntimeAccount.findOne({ session: sessionId });
  if (existing) return existing;
  return AIInterviewRuntimeAccount.create({
    session: sessionId,
    aiInterview: session?.aiInterview?._id || session?.aiInterview || undefined,
    organization: session?.organization || session?.aiInterview?.organization?._id
      || session?.aiInterview?.organization || undefined,
    candidate: session?.candidate?._id || session?.candidate || undefined,
    subjectKey: subjectKeyForUser(subjectId),
    status: 'disconnected'
  });
}

function applyStatus(account, status) {
  const connected = status?.connected === true;
  account.status = connected ? 'connected' : status?.pendingLogin ? 'pending' : 'disconnected';
  account.connectedEmail = connected ? String(status.email || '') : '';
  account.planType = connected ? String(status.planType || '') : '';
  account.lastVerifiedAt = new Date();
  if (connected && !account.connectedAt) account.connectedAt = new Date();
  if (!connected) account.connectedAt = null;
  account.lastError = String(status?.loginError || '').slice(0, 500);
  if (connected) {
    const cleanup = cleanupState(account);
    cleanup.status = 'idle';
    cleanup.attempts = 0;
    cleanup.requestedAt = null;
    cleanup.nextAttemptAt = null;
    cleanup.completedAt = null;
    cleanup.reason = '';
    cleanup.lastError = '';
    account.purgeAfter = null;
  }
  return account;
}

async function attemptCredentialCleanup(account, options = {}) {
  const cleanup = cleanupState(account);
  cleanup.status = 'processing';
  cleanup.attempts = Number(cleanup.attempts || 0) + 1;
  cleanup.nextAttemptAt = null;
  await account.save();
  try {
    await callGateway('logout', subjectIdForSession(account.session), options);
    cleanup.status = 'completed';
    cleanup.completedAt = new Date();
    cleanup.lastError = '';
  } catch (error) {
    cleanup.status = 'pending';
    cleanup.nextAttemptAt = cleanupRetryAt(cleanup.attempts);
    cleanup.lastError = String(error?.message || 'Credential cleanup failed').slice(0, 500);
  }
  await account.save();
  return account;
}

/** Live gateway state rather than the stored row: a session signed out on the
 * host must not keep routing interview turns that would then fail mid-answer. */
async function readAccount(session, options = {}) {
  const account = await accountForSession(session);
  if (['pending', 'processing'].includes(account.credentialCleanup?.status)) {
    return attemptCredentialCleanup(account, options);
  }
  if (account.credentialCleanup?.status === 'completed' && account.status === 'disconnected') {
    return account;
  }
  try {
    applyStatus(account, await callGateway('account', subjectIdForSession(account.session), options));
  } catch (error) {
    account.status = account.status === 'connected' ? 'error' : account.status;
    account.lastError = String(error.message || '').slice(0, 500);
  }
  await account.save();
  return account;
}

async function startLogin(session, options = {}) {
  const account = await accountForSession(session);
  const cleanup = cleanupState(account);
  cleanup.status = 'idle';
  cleanup.attempts = 0;
  cleanup.requestedAt = null;
  cleanup.nextAttemptAt = null;
  cleanup.completedAt = null;
  cleanup.reason = '';
  cleanup.lastError = '';
  account.purgeAfter = null;
  const login = await callGateway('login/start', subjectIdForSession(account.session), options);
  if (login.connected) {
    applyStatus(account, { connected: true });
  } else {
    account.status = 'pending';
    account.lastError = '';
  }
  await account.save();
  return { login, account };
}

async function cancelLogin(session, options = {}) {
  const account = await accountForSession(session);
  await callGateway('login/cancel', subjectIdForSession(account.session), options).catch(() => undefined);
  return readAccount(session, options);
}

async function setConsent(session, acknowledged) {
  const account = await accountForSession(session);
  account.dataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  await account.save();
  return account;
}

/** Withdrawal clears local state before the gateway call so an unreachable
 * host can never keep a candidate connected against their wish. */
async function disconnect(session, options = {}) {
  const account = await accountForSession(session);
  clearConnection(account, options);
  await account.save();
  return attemptCredentialCleanup(account, options);
}

async function processPendingCredentialCleanup(limit = 20, options = {}) {
  const now = new Date();
  const accounts = await AIInterviewRuntimeAccount.find({
    'credentialCleanup.status': 'pending',
    $or: [
      { 'credentialCleanup.nextAttemptAt': { $lte: now } },
      { 'credentialCleanup.nextAttemptAt': null },
      { 'credentialCleanup.nextAttemptAt': { $exists: false } }
    ]
  }).sort({ 'credentialCleanup.nextAttemptAt': 1 }).limit(Math.max(1, Number(limit) || 20));
  for (const account of accounts) {
    await attemptCredentialCleanup(account, options);
  }
  return accounts.length;
}

async function disconnectInterview(aiInterviewId, options = {}) {
  const accounts = await AIInterviewRuntimeAccount.find({ aiInterview: aiInterviewId });
  for (const account of accounts) {
    clearConnection(account, { ...options, terminal: true });
    await account.save();
    await attemptCredentialCleanup(account, options);
  }
  return accounts.length;
}

/** The subject a live interview turn runs on, or null when the candidate has
 * not connected and consented. Callers must refuse rather than substitute. */
async function resolveRoutableSubject(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  let account = null;
  try {
    account = await AIInterviewRuntimeAccount.findOne({ session: id });
  } catch (error) {
    console.warn('Interview ChatGPT subject lookup failed:', error.message);
    return null;
  }
  if (!account || !account.isRoutable()) return null;
  return { subjectId: subjectIdForSession(id), subjectKey: account.subjectKey, sourceApp: 'recruiter' };
}

module.exports = {
  accountForSession,
  cancelLogin,
  cleanupRetryAt,
  disconnect,
  disconnectInterview,
  processPendingCredentialCleanup,
  readAccount,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectIdForSession
};
