'use strict';

const crypto = require('node:crypto');
const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
const { PerformanceAIRuntimeError } = require('./aiGatewayService');

const SOURCE_APP = 'performance-management';

function userIdFor(user) {
  return String(user?.sub || user?.id || '').trim();
}

function subjectKeyForUser(userId) {
  const subjectId = String(userId || '').trim();
  if (!subjectId) {
    throw new PerformanceAIRuntimeError(
      'A ChatGPT connection requires an authenticated user.',
      'CHATGPT_SUBJECT_UNRESOLVED',
      401
    );
  }
  return crypto.createHash('sha256').update(`${SOURCE_APP}\u001f${subjectId}`).digest('hex');
}

function gatewayConfiguration() {
  const baseUrl = String(process.env.CHATGPT_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  if (!baseUrl || !secret) {
    throw new PerformanceAIRuntimeError(
      'ChatGPT Connect is not configured for Performance Management.',
      'CHATGPT_GATEWAY_NOT_CONFIGURED'
    );
  }
  return { baseUrl, secret };
}

function sign(secret, body, requestPath) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function callGateway(operation, userId, { timeoutMs = 30_000, fetchImpl = global.fetch } = {}) {
  const { baseUrl, secret } = gatewayConfiguration();
  const requestPath = `/v1/codex/${operation}`;
  const body = JSON.stringify({ sourceApp: SOURCE_APP, subjectId: String(userId) });
  const signed = sign(secret, body, requestPath);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${requestPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-timestamp': signed.timestamp,
        'x-seemplify-nonce': signed.nonce,
        'x-seemplify-signature': signed.signature
      },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new PerformanceAIRuntimeError(
      `The ChatGPT gateway is unreachable: ${error.message}`,
      'CHATGPT_GATEWAY_UNAVAILABLE'
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new PerformanceAIRuntimeError(
      payload.message || `ChatGPT ${operation} failed.`,
      payload.code || 'CHATGPT_CONTROL_FAILED',
      response.status
    );
    error.retryable = payload.retryable === true;
    error.retryAfterSeconds = Number(payload.retryAfterSeconds)
      || Number(response.headers?.get?.('retry-after')) || 0;
    throw error;
  }
  return payload;
}

async function accountForUser(user) {
  const userId = userIdFor(user);
  if (!userId) subjectKeyForUser(userId);
  return AIUserRuntimeAccount.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, subjectKey: subjectKeyForUser(userId), status: 'disconnected' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function applyStatus(account, state) {
  const connected = state?.connected === true;
  account.status = connected ? 'connected' : state?.pendingLogin ? 'pending' : 'disconnected';
  account.connectedEmail = connected ? String(state.email || '') : '';
  account.planType = connected ? String(state.planType || '') : '';
  account.lastVerifiedAt = new Date();
  if (connected && !account.connectedAt) account.connectedAt = new Date();
  if (!connected) {
    account.connectedAt = null;
    account.rateLimits = null;
    account.usageLimit = null;
  } else {
    if (state?.rateLimits) account.rateLimits = state.rateLimits;
    if (state?.usageLimit !== undefined) account.usageLimit = state.usageLimit;
  }
  account.lastError = String(state?.loginError || '').slice(0, 500);
  return account;
}

async function readAccount(user, options = {}) {
  const account = await accountForUser(user);
  try {
    applyStatus(account, await callGateway('account', account.userId, options));
  } catch (error) {
    account.lastError = String(error.message || '').slice(0, 500);
  }
  await account.save();
  return account;
}

async function startLogin(user, options = {}) {
  const account = await accountForUser(user);
  const login = await callGateway('login/start', account.userId, options);
  if (login.connected) applyStatus(account, login);
  else {
    account.status = 'pending';
    account.lastError = '';
  }
  await account.save();
  return { login, account };
}

async function cancelLogin(user, options = {}) {
  const account = await accountForUser(user);
  const result = await callGateway('login/cancel', account.userId, options);
  if (account.status !== 'connected') account.status = 'disconnected';
  account.lastError = '';
  await account.save();
  return { result, account };
}

async function resetLogin(user, options = {}) {
  const account = await accountForUser(user);
  const result = await callGateway('login/reset', account.userId, options);
  if (account.status !== 'connected') account.status = 'disconnected';
  account.lastError = '';
  await account.save();
  return { result, account };
}

async function setConsent(user, acknowledged) {
  const account = await accountForUser(user);
  account.dataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  await account.save();
  return account;
}

async function disconnect(user, options = {}) {
  const account = await accountForUser(user);
  account.dataSharingAcknowledgedAt = null;
  account.status = 'disconnected';
  account.connectedEmail = '';
  account.planType = '';
  account.connectedAt = null;
  account.disconnectedAt = new Date();
  await account.save();
  await callGateway('logout', account.userId, options);
  return account;
}

async function resolveRoutableSubject(userId, options = {}) {
  const subjectId = String(userId || '').trim();
  if (!subjectId) return null;
  let account = await AIUserRuntimeAccount.findOne({ userId: subjectId });
  if (!account?.isRoutable()) {
    try {
      account = await readAccount({ sub: subjectId }, options);
    } catch {
      return null;
    }
  }
  if (!account?.isRoutable()) return null;
  return { subjectId, subjectKey: account.subjectKey, sourceApp: SOURCE_APP };
}

module.exports = {
  SOURCE_APP,
  accountForUser,
  callGateway,
  cancelLogin,
  disconnect,
  readAccount,
  resetLogin,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectKeyForUser
};
