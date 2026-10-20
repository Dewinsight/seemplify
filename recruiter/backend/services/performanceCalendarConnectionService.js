'use strict';
const crypto = require('node:crypto');
const Intent = require('../models/PerformanceCalendarIntent');
const User = require('../models/User');
const Account = require('../models/NylasAccount');
const shared = require('./aiRuntime/sharedIdentityService');
const pool = require('./multiNylasService');
const nylas = require('./nylasV3Service');
const config = require('../config/configLoader');

const PREFIX = 'pmcal_';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookieName = state => `pmcal_proof_${String(state).slice(PREFIX.length, PREFIX.length + 20)}`;
const fail = (message, code, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
function returnPath(value) {
  if (typeof value !== 'string' || !/^\/(?:appraisals(?:\/[a-f0-9]{24})?|one-on-ones(?:\/(?:new|[a-f0-9]{24}))?|competency\/assessments\/[a-f0-9]{24})$/i.test(value)) throw fail('Return to the appraisal or one-on-one page to connect your calendar.', 'CALENDAR_RETURN_INVALID', 400);
  return value;
}
function returnUrl(path, status) {
  const base = new URL(process.env.PERFORMANCE_FRONTEND_URL || 'https://performance.seemplifyai.com');
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw fail('Calendar return address is unavailable.', 'CALENDAR_RETURN_UNAVAILABLE', 503);
  const url = new URL(returnPath(path), base.origin);
  url.searchParams.set('calendarConnection', status);
  return url.href;
}
function accountCredentials(account) {
  return { apiKey: account.apiKey, apiUri: account.apiUri, clientId: account.clientId, clientSecret: account.clientSecret, region: account.region };
}
async function connect(rawIdentity, input = {}) {
  const { user, identity } = await shared.resolveSharedPrincipal(rawIdentity);
  if (!identity.organizationId) throw fail('Choose an organization first.', 'ORGANIZATION_REQUIRED', 400);
  const path = returnPath(input.returnPath);
  const provider = input.provider || 'google';
  if (!['google', 'microsoft'].includes(provider)) throw fail('Choose Google or Microsoft Calendar.', 'CALENDAR_PROVIDER_INVALID', 400);
  returnUrl(path, 'connected'); // Validate server configuration before allocating an intent.
  if (await Intent.countDocuments({ userId: user._id, expiresAt: { $gt: new Date() } }) >= 5) throw fail('Finish an open calendar connection, or retry in 20 minutes.', 'CALENDAR_CONNECT_RATE_LIMITED', 429);
  // Never free a slot by disconnecting somebody else's calendar.
  const available = await pool.findAvailableAccount();
  if (!available) throw fail('No calendar connection slots are available. Contact your administrator.', 'CALENDAR_CAPACITY_UNAVAILABLE', 503);
  const state = PREFIX + crypto.randomBytes(32).toString('base64url');
  const browserProof = crypto.randomBytes(32).toString('base64url');
  const intent = await Intent.create({ stateHash: digest(state), browserProofHash: digest(browserProof), userId: user._id, identity, accountId: available.account._id, previousGrantId: user.nylasGrantId || null, returnPath: path, expiresAt: new Date(Date.now() + 20 * 60_000) });
  try {
    const authUrl = nylas.getNylasInstance(available.credentials).auth.urlForOAuth2({
      clientId: available.credentials.clientId, redirectUri: config.getCallbackUrl(), provider,
      accessType: 'offline', state, prompt: 'select_provider',
      scope: provider === 'google' ? ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose'] : ['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite', 'User.Read', 'Mail.Send', 'Mail.ReadWrite']
    });
    // The caller sets this as an HttpOnly cookie; it never reaches frontend JS.
    return { authUrl, browserProof, cookieName: cookieName(state) };
  } catch {
    await Intent.deleteOne({ _id: intent._id });
    throw fail('Nylas authorization could not be started. Please retry.', 'CALENDAR_AUTH_UNAVAILABLE', 503);
  }
}
async function callback(query = {}, browserProof) {
  if (typeof query.state !== 'string' || !/^pmcal_[A-Za-z0-9_-]{43}$/.test(query.state)) throw fail('Calendar connection has expired. Start again from Performance.', 'CALENDAR_STATE_INVALID', 400);
  // Claim once before provider work. Expiry is enforced even before Mongo's TTL sweep.
  if (typeof browserProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(browserProof)) throw fail('Use the browser where you started the calendar connection.', 'CALENDAR_BROWSER_REQUIRED', 400);
  const intent = await Intent.findOneAndDelete({ stateHash: digest(query.state), browserProofHash: digest(browserProof), expiresAt: { $gt: new Date() } });
  if (!intent) throw fail('Calendar connection has expired or was already used. Start again from Performance.', 'CALENDAR_STATE_INVALID', 400);
  if (query.error) return { redirectUrl: returnUrl(intent.returnPath, 'cancelled') };
  if (typeof query.code !== 'string' || !query.code || query.code.length > 4096) return { redirectUrl: returnUrl(intent.returnPath, 'failed') };
  try {
    const { user } = await shared.resolveSharedPrincipal(intent.identity);
    if (String(user._id) !== String(intent.userId) || (user.nylasGrantId || null) !== intent.previousGrantId) throw fail('Calendar changed while connecting.', 'CALENDAR_CONNECTION_CHANGED');
    const account = await Account.findOne({ _id: intent.accountId, active: true }).select('+apiKey +clientSecret');
    if (!account) throw fail('Calendar application unavailable.', 'CALENDAR_APPLICATION_UNAVAILABLE');
    const client = nylas.getNylasInstance(accountCredentials(account));
    // Do not pass this response through the legacy exchange helper, which logs tokens.
    const exchange = await client.auth.exchangeCodeForToken({ clientId: account.clientId, clientSecret: account.clientSecret, redirectUri: config.getCallbackUrl(), code: query.code });
    const grantId = exchange.grantId || exchange.grant_id || exchange.data?.grantId || exchange.data?.grant_id;
    if (!grantId) throw fail('Calendar authorization was incomplete.', 'CALENDAR_GRANT_INVALID');
    const grant = (await client.grants.find({ grantId })).data;
    if (!grant?.email || !['valid', 'active'].includes(grant.grantStatus || grant.grant_status)) throw fail('Calendar authorization is not active.', 'CALENDAR_GRANT_INVALID');
    if (await User.exists({ _id: { $ne: user._id }, nylasGrantId: grantId, nylasAccountId: account._id })) throw fail('This calendar is already connected to another user.', 'CALENDAR_GRANT_IN_USE');
    const saved = await User.updateOne({ _id: intent.userId, idpSubject: intent.identity.sub, nylasGrantId: intent.previousGrantId }, { $set: { nylasGrantId: grantId, nylasAccountId: account._id, nylasGrantStatus: 'active', calendarConnected: true, calendarProvider: grant.provider, grantConnectedAt: new Date() } });
    if (saved.matchedCount !== 1) throw fail('Calendar changed while connecting.', 'CALENDAR_CONNECTION_CHANGED');
    // Keep old grants usable by invitations already pinned to those calendars.
    // No other person's connection or existing meeting is changed here.
    await pool.updateGrantCount(account._id).catch(() => undefined);
    return { redirectUrl: returnUrl(intent.returnPath, 'connected') };
  } catch {
    return { redirectUrl: returnUrl(intent.returnPath, 'failed') };
  }
}
module.exports = { connect, callback, PREFIX, cookieName };
