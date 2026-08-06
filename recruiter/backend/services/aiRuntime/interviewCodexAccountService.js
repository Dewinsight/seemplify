const AIInterviewRuntimeAccount = require('../../models/AIInterviewRuntimeAccount');
const { AIRuntimeError } = require('./aiRuntimeService');
const { callGateway, subjectKeyForUser } = require('./codexAccountService');

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
  return account;
}

/** Live gateway state rather than the stored row: a session signed out on the
 * host must not keep routing interview turns that would then fail mid-answer. */
async function readAccount(session, options = {}) {
  const account = await accountForSession(session);
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
  account.status = 'disconnected';
  account.connectedEmail = '';
  account.planType = '';
  account.connectedAt = null;
  account.disconnectedAt = new Date();
  account.dataSharingAcknowledgedAt = null;
  await account.save();
  await callGateway('logout', subjectIdForSession(account.session), options).catch(() => undefined);
  return account;
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
  disconnect,
  readAccount,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectIdForSession
};
