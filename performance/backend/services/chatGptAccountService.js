'use strict';

const crypto = require('node:crypto');
const sharedAIAccountService = require('./sharedAIAccountService');
const { identityFromUser } = require('./sharedAIAccountService');

// The credential namespace is owned by the central Seemplify account service.
// Performance keeps only its own disclosure/consent and never receives an
// OpenAI refresh token or the hosted gateway master secret.
const SOURCE_APP = 'recruiter';

function subjectKeyForUser(idpSubject) {
  const subject = String(idpSubject || '').trim();
  if (!subject) throw new TypeError('A stable Seemplify identity is required.');
  return crypto.createHash('sha256').update(`${SOURCE_APP}\u001f${subject}`).digest('hex');
}

class SharedAccountView {
  constructor(value = {}) { Object.assign(this, value); }
  isRoutable() { return this.routable === true; }
  toPublicJSON() { return { ...this }; }
}

function accountView(response) {
  return new SharedAccountView(response?.account || response || {});
}

function performancePreferences(response) {
  if (!response || typeof response !== 'object') return undefined;
  return {
    ...response,
    activities: Array.isArray(response.activities)
      ? response.activities.filter((activity) => activity?.app === 'performance')
      : []
  };
}

async function readAccountState(user, options = {}) {
  const identity = identityFromUser(user);
  try {
    const response = await sharedAIAccountService.status(identity, options);
    return {
      account: accountView(response),
      preferences: performancePreferences(response?.preferences)
    };
  } catch (error) {
    if (options.strict === true) throw error;
    return {
      account: new SharedAccountView({
        status: 'error', routable: false, connectedEmail: null,
        lastError: String(error.message || 'The shared ChatGPT account is unavailable.')
      }),
      preferences: undefined
    };
  }
}

async function readAccount(user, options = {}) {
  return (await readAccountState(user, options)).account;
}

async function startLogin(user, options = {}) {
  const result = await sharedAIAccountService.startLogin(identityFromUser(user), options);
  return { login: result.login, account: accountView(result) };
}

async function cancelLogin(user, options = {}) {
  const result = await sharedAIAccountService.cancelLogin(identityFromUser(user), options);
  return { result, account: accountView(result) };
}

async function resetLogin(user, options = {}) {
  const result = await sharedAIAccountService.resetLogin(identityFromUser(user), options);
  return { result, account: accountView(result) };
}

async function setConsent(user, acknowledged, options = {}) {
  return accountView(await sharedAIAccountService.consent(
    identityFromUser(user), acknowledged === true, options
  ));
}

async function disconnect(user, options = {}) {
  return accountView(await sharedAIAccountService.disconnect(identityFromUser(user), options));
}

async function readPreferences(user, options = {}) {
  return performancePreferences(await sharedAIAccountService.preferences(identityFromUser(user), options));
}

async function writePreference(user, preference, options = {}) {
  return performancePreferences(await sharedAIAccountService.writePreference(
    identityFromUser(user), preference, options
  ));
}

async function deletePreference(user, preference, options = {}) {
  return performancePreferences(await sharedAIAccountService.deletePreference(
    identityFromUser(user), preference, options
  ));
}

async function resolveRoutableSubject(userId, options = {}) {
  const identity = options.identity || { sub: String(userId || ''), email: options.email };
  if (!identity.sub || !identity.email) return null;
  const account = accountView(await sharedAIAccountService.status(identity, options));
  if (!account.isRoutable()) return null;
  return { subjectId: identity.sub, subjectKey: subjectKeyForUser(identity.sub), sourceApp: SOURCE_APP };
}

module.exports = {
  SOURCE_APP,
  accountForUser: readAccount,
  cancelLogin,
  disconnect,
  deletePreference,
  readAccount,
  readAccountState,
  readPreferences,
  resetLogin,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectKeyForUser,
  writePreference
};
