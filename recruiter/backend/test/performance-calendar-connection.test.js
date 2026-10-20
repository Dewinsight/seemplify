'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Account = require('../models/NylasAccount');
const Intent = require('../models/PerformanceCalendarIntent');
const principals = require('../services/aiRuntime/sharedIdentityService');
const pool = require('../services/multiNylasService');
const nylas = require('../services/nylasV3Service');
const service = require('../services/performanceCalendarConnectionService');
const identity = { sub: 'calendar-test-manager', email: 'manager@example.test', organizationId: 'org-a' };
const path = '/appraisals/507f1f77bcf86cd799439011';
let mongo, user, account, exchanged, revoked;
test.before(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
test.beforeEach(async t => {
  await mongoose.connection.db.dropDatabase(); await Intent.createIndexes();
  user = await User.create({ email: identity.email, password: 'synthetic-fixture', idpSubject: identity.sub, nylasGrantId: 'original-grant', nylasGrantStatus: 'active' });
  account = await Account.create({ name: 'Synthetic OAuth app', clientId: 'synthetic-client', apiKey: 'synthetic-key', clientSecret: 'synthetic-secret', active: true, verified: true });
  t.mock.method(principals, 'resolveSharedPrincipal', async raw => ({ identity: raw, user: await User.findById(user._id) }));
  t.mock.method(pool, 'findAvailableAccount', async () => ({ account, credentials: { clientId: account.clientId, apiKey: 'synthetic-key', clientSecret: 'synthetic-secret' } }));
  t.mock.method(pool, 'updateGrantCount', async () => {});
  revoked = t.mock.fn(async () => ({}));
  exchanged = t.mock.fn(async () => ({ grantId: 'new-personal-grant', accessToken: 'never-expose-this-token' }));
  t.mock.method(nylas, 'getNylasInstance', () => ({ auth: { urlForOAuth2: input => `https://api.us.nylas.com/v3/connect/auth?${new URLSearchParams({ client_id: input.clientId, state: input.state, redirect_uri: input.redirectUri, provider: input.provider })}`, exchangeCodeForToken: exchanged }, grants: { destroy: revoked, find: async () => ({ data: { email: 'chosen-calendar@example.test', provider: 'google', grantStatus: 'valid' } }) } }));
});
test.afterEach(() => test.mock.restoreAll());
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
const start = () => service.connect(identity, { returnPath: path });
const callback = result => service.callback({ state: new URL(result.authUrl).searchParams.get('state'), code: 'synthetic-authorization-code' }, result.browserProof);

test('direct Nylas authorization uses opaque state and hashed, expiring browser proof', async () => {
  const result = await start(); const url = new URL(result.authUrl);
  assert.equal(url.hostname, 'api.us.nylas.com'); assert.equal(url.pathname, '/v3/connect/auth');
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_uri').endsWith('/api/interviews/oauth/callback'), true);
  assert.match(url.searchParams.get('state'), /^pmcal_[A-Za-z0-9_-]{43}$/);
  assert.equal(result.authUrl.includes(identity.email), false);
  assert.equal(result.authUrl.includes('synthetic-key'), false);
  const stored = await Intent.findOne().lean();
  assert.equal(stored.userId.toString(), user._id.toString());
  assert.equal(stored.stateHash.includes(url.searchParams.get('state')), false);
  assert.notEqual(stored.browserProofHash, result.browserProof);
  assert.ok(stored.expiresAt > new Date());
});

test('callback cannot be used from another browser and connects only the originating manager', async () => {
  const other = await User.create({ email: 'other@example.test', password: 'synthetic-other', idpSubject: 'other', nylasGrantId: 'other-grant' });
  const result = await start(); const state = new URL(result.authUrl).searchParams.get('state');
  await assert.rejects(service.callback({ state, code: 'synthetic' }, 'a'.repeat(43)), { code: 'CALENDAR_STATE_INVALID' });
  assert.equal(exchanged.mock.callCount(), 0); assert.equal(await Intent.countDocuments(), 1);
  const finished = await callback(result);
  assert.equal(new URL(finished.redirectUrl).pathname, path);
  assert.equal(new URL(finished.redirectUrl).searchParams.get('calendarConnection'), 'connected');
  assert.equal((await User.findById(user._id)).nylasGrantId, 'new-personal-grant');
  assert.equal((await User.findById(other._id)).nylasGrantId, 'other-grant');
  assert.equal(JSON.stringify(finished).includes('never-expose-this-token'), false);
});

test('expired, forged and replayed callbacks never exchange a code', async () => {
  const result = await start();
  await Intent.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(callback(result), { code: 'CALENDAR_STATE_INVALID' });
  await assert.rejects(service.callback({ state: 'pmcal_' + 'b'.repeat(43), code: 'synthetic' }, result.browserProof), { code: 'CALENDAR_STATE_INVALID' });
  assert.equal(exchanged.mock.callCount(), 0);
  const fresh = await start(); await callback(fresh);
  await assert.rejects(callback(fresh), { code: 'CALENDAR_STATE_INVALID' });
  assert.equal(exchanged.mock.callCount(), 1);
});

test('parallel callbacks consume their connection once', async () => {
  const result = await start(); const outcomes = await Promise.allSettled([callback(result), callback(result)]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(exchanged.mock.callCount(), 1);
});

test('cancellation preserves the existing account and consumes the attempt', async () => {
  const result = await start();
  const finished = await service.callback({ state: new URL(result.authUrl).searchParams.get('state'), error: 'access_denied' }, result.browserProof);
  assert.equal(new URL(finished.redirectUrl).searchParams.get('calendarConnection'), 'cancelled');
  assert.equal((await User.findById(user._id)).nylasGrantId, 'original-grant');
  assert.equal(exchanged.mock.callCount(), 0);
  await assert.rejects(callback(result), { code: 'CALENDAR_STATE_INVALID' });
});

test('a newer connection cannot be overwritten by an old OAuth attempt', async () => {
  const result = await start(); await User.updateOne({ _id: user._id }, { $set: { nylasGrantId: 'newer-grant' } });
  const finished = await callback(result);
  assert.equal(new URL(finished.redirectUrl).searchParams.get('calendarConnection'), 'failed');
  assert.equal((await User.findById(user._id)).nylasGrantId, 'newer-grant'); assert.equal(exchanged.mock.callCount(), 0);
});

test('invalid return destinations and providers do not allocate a connection', async () => {
  for (const returnPath of ['https://example.test', '//example.test', '/appraisals/../settings', '/appraisals?next=bad', '/settings']) await assert.rejects(service.connect(identity, { returnPath }), { code: 'CALENDAR_RETURN_INVALID' });
  await assert.rejects(service.connect(identity, { returnPath: path, provider: 'unknown' }), { code: 'CALENDAR_PROVIDER_INVALID' });
  assert.equal(await Intent.countDocuments(), 0);
});

test('capacity failure never disconnects another user to make room', async t => {
  t.mock.method(pool, 'findAvailableAccount', async () => null);
  await assert.rejects(start(), { code: 'CALENDAR_CAPACITY_UNAVAILABLE' });
  assert.equal(await Intent.countDocuments(), 0); assert.equal((await User.findById(user._id)).nylasGrantId, 'original-grant');
});


test('disconnect revokes only the authenticated personal grant and clears its mapping', async () => {
  await User.updateOne({ _id: user._id }, { $set: { nylasAccountId: account._id, calendarConnected: true } });
  const other = await User.create({ email: 'separate@example.test', password: 'synthetic', idpSubject: 'separate', nylasGrantId: 'separate-grant', nylasAccountId: account._id });
  const result = await service.disconnect(identity);
  assert.equal(result.disconnected, true);
  assert.deepEqual(revoked.mock.calls[0].arguments, [{ grantId: 'original-grant' }]);
  const fresh = await User.findById(user._id);
  assert.equal(fresh.nylasGrantId, undefined); assert.equal(fresh.calendarConnected, false);
  assert.equal((await User.findById(other._id)).nylasGrantId, 'separate-grant');
  assert.equal((await service.disconnect(identity)).disconnected, true);
  assert.equal(revoked.mock.callCount(), 1);
});

test('failed provider revocation quarantines the grant, blocks old callbacks and permits retry', async () => {
  await User.updateOne({ _id: user._id }, { $set: { nylasAccountId: account._id } });
  const pending = await start();
  revoked.mock.mockImplementation(async () => { throw Object.assign(new Error('Synthetic outage'), { statusCode: 503 }); });
  await assert.rejects(service.disconnect(identity), { code: 'CALENDAR_DISCONNECT_PENDING' });
  const quarantined = await User.findById(user._id);
  assert.equal(quarantined.nylasGrantStatus, 'stopped'); assert.equal(quarantined.nylasGrantId, 'original-grant');
  await assert.rejects(start(), { code: 'CALENDAR_DISCONNECT_PENDING' });
  assert.equal(new URL((await callback(pending)).redirectUrl).searchParams.get('calendarConnection'), 'failed');
  assert.equal(exchanged.mock.callCount(), 0);
  revoked.mock.mockImplementation(async () => { throw Object.assign(new Error('Already revoked'), { statusCode: 404 }); });
  assert.equal((await service.disconnect(identity)).disconnected, true);
});
