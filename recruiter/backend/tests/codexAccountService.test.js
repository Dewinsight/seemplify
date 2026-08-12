const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
const codexAccountService = require('../services/aiRuntime/codexAccountService');

test('stored subject metadata mirrors the hosted gateway separator exactly', () => {
  const userId = '507f191e810c19729de860e9';
  const expected = crypto.createHash('sha256').update(`recruiter\x1f${userId}`).digest('hex');
  assert.equal(codexAccountService.subjectKeyForUser(userId), expected);
  assert.notEqual(
    expected,
    crypto.createHash('sha256').update(`recruiter${userId}`).digest('hex')
  );
});

test('a pre-migration account retains its proven Recruiter gateway identity', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const account = {
    user: '507f191e810c19729de860e8',
    idpSubject: 'idp-legacy-user',
    organization: '507f191e810c19729de860e7',
    subjectKey: 'legacy-wrong-hash',
    saves: 0,
    async save() { this.saves += 1; return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  try {
    const result = await codexAccountService.accountForUser({ id: account.user, idpSubject: account.idpSubject });
    assert.equal(result.user, '507f191e810c19729de860e8');
    assert.equal(result.subjectKey, codexAccountService.subjectKeyForUser(account.user));
    assert.equal(result.saves, 1);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
  }
});

test('an older gateway without account adoption keeps status and disconnect on the legacy credential', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const account = {
    user: '507f191e810c19729de86101',
    idpSubject: 'idp-rolling-upgrade-user',
    organization: '507f191e810c19729de86102',
    subjectKey: codexAccountService.subjectKeyForUser('idp-rolling-upgrade-user'),
    status: 'connected',
    connectedEmail: 'person@example.test',
    dataSharingAcknowledgedAt: new Date(),
    performanceDataSharingAcknowledgedAt: new Date(),
    messagingDataSharingAcknowledgedAt: new Date(),
    credentialNamespaceVersion: 1,
    lastError: 'ChatGPT account/adopt failed',
    async save() { return this; }
  };
  const operations = [];
  const fetchImpl = async (url, init) => {
    const operation = new URL(url).pathname.split('/').pop();
    const body = JSON.parse(init.body);
    operations.push({ operation, subjectId: body.subjectId });
    if (url.endsWith('/account/adopt')) {
      return new Response(JSON.stringify({ code: 'CHATGPT_OPERATION_UNKNOWN' }), {
        status: 404, headers: { 'content-type': 'application/json' }
      });
    }
    if (url.endsWith('/account')) {
      return new Response(JSON.stringify({
        connected: true, email: 'person@example.test', planType: 'pro'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/logout')) {
      return new Response(JSON.stringify({ forgotten: true }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected gateway operation: ${url}`);
  };
  AIUserRuntimeAccount.findOne = async () => account;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'http://hosted-gateway.test:11435';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'hosted-test-secret';
  try {
    const refreshed = await codexAccountService.readAccount(
      { id: account.user, idpSubject: account.idpSubject }, { fetchImpl }
    );
    assert.equal(refreshed.status, 'connected');
    assert.equal(refreshed.lastError, '');
    assert.equal(refreshed.credentialNamespaceVersion, 1);
    assert.equal(refreshed.subjectKey, codexAccountService.subjectKeyForUser(account.user));
    assert.deepEqual(operations.slice(0, 2), [
      { operation: 'adopt', subjectId: account.idpSubject },
      { operation: 'account', subjectId: account.user }
    ]);

    const disconnected = await codexAccountService.disconnect(
      { id: account.user, idpSubject: account.idpSubject }, { fetchImpl }
    );
    assert.equal(disconnected.status, 'disconnected');
    assert.equal(disconnected.dataSharingAcknowledgedAt, null);
    assert.equal(disconnected.performanceDataSharingAcknowledgedAt, null);
    assert.equal(disconnected.messagingDataSharingAcknowledgedAt, null);
    assert.deepEqual(operations.slice(-2), [
      { operation: 'adopt', subjectId: account.idpSubject },
      { operation: 'logout', subjectId: account.user }
    ]);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});

test('an already-connected login response does not erase account details it omits', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const account = {
    user: '507f191e810c19729de860e6',
    idpSubject: 'idp-connected-user',
    organization: '507f191e810c19729de860e5',
    subjectKey: codexAccountService.subjectKeyForUser('507f191e810c19729de860e6'),
    status: 'connected',
    connectedEmail: 'person@example.test',
    planType: 'pro',
    connectedAt: new Date('2026-08-01T00:00:00Z'),
    credentialNamespaceVersion: 2,
    async save() { return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'http://hosted-gateway.test:11435';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'hosted-test-secret';
  try {
    const result = await codexAccountService.startLogin({ id: account.user, idpSubject: account.idpSubject }, {
      fetchImpl: async () => new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    });
    assert.equal(result.account.connectedEmail, 'person@example.test');
    assert.equal(result.account.planType, 'pro');
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});

test('a transient hosted-gateway outage never disconnects a verified account', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const account = {
    user: '507f191e810c19729de860ea',
    idpSubject: 'idp-outage-user',
    organization: '507f191e810c19729de860eb',
    status: 'connected',
    lastError: '',
    credentialNamespaceVersion: 2,
    isRoutable() { return this.status === 'connected'; },
    async save() { return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'http://hosted-gateway.test:11435';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'hosted-test-secret';

  try {
    const result = await codexAccountService.readAccount(
      { id: account.user, idpSubject: account.idpSubject },
      { fetchImpl: async () => { throw new Error('rolling deployment'); } }
    );
    assert.equal(result.status, 'connected');
    assert.equal(result.isRoutable(), true);
    assert.match(result.lastError, /gateway is unreachable/i);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});

test('background subject resolution heals a stale account from the hosted gateway', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const account = {
    user: '507f191e810c19729de860ec',
    idpSubject: 'idp-background-user',
    organization: '507f191e810c19729de860ed',
    subjectKey: 'hosted-subject-key',
    status: 'error',
    dataSharingAcknowledgedAt: new Date(),
    lastError: 'temporary outage',
    credentialNamespaceVersion: 2,
    isRoutable() { return this.status === 'connected' && Boolean(this.dataSharingAcknowledgedAt); },
    async save() { return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'http://hosted-gateway.test:11435';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'hosted-test-secret';

  try {
    const subject = await codexAccountService.resolveRoutableSubject(account.user, {
      organizationId: account.organization,
      findUser: async () => ({
        sharedAIOnly: false,
        recruiterAppAccessSyncedAt: new Date(),
        recruiterAuthorizedOrganizations: [account.organization],
        organizationMemberships: [{ organization: account.organization, isActive: true }]
      }),
      fetchImpl: async () => new Response(JSON.stringify({
        connected: true,
        email: 'recruiter@example.test',
        planType: 'pro'
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    });
    assert.deepEqual(subject, {
      subjectId: account.idpSubject,
      subjectKey: codexAccountService.subjectKeyForUser(account.idpSubject),
      sourceApp: 'recruiter'
    });
    assert.equal(account.status, 'connected');
    assert.equal(account.lastError, '');
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});

test('foreground subject resolution rechecks exact Recruiter organization authorization', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const actorId = '507f191e810c19729de860f3';
  const orgA = '507f191e810c19729de860f4';
  const orgB = '507f191e810c19729de860f5';
  const account = {
    user: actorId,
    idpSubject: 'idp-foreground-user',
    subjectKey: 'exact-org-subject',
    status: 'connected',
    dataSharingAcknowledgedAt: new Date(),
    credentialNamespaceVersion: 2,
    isRoutable(app) { return app === 'recruiter' && Boolean(this.dataSharingAcknowledgedAt); }
  };
  const actor = {
    sharedAIOnly: false,
    recruiterAppAccessSyncedAt: new Date(),
    recruiterAuthorizedOrganizations: [orgA],
    organizationMemberships: [
      { organization: orgA, isActive: true },
      { organization: orgB, isActive: true }
    ]
  };
  AIUserRuntimeAccount.findOne = async () => account;
  try {
    const allowed = await codexAccountService.resolveRoutableSubject(actorId, {
      organizationId: orgA,
      findUser: async () => actor
    });
    assert.equal(allowed.subjectId, account.idpSubject);
    const denied = await codexAccountService.resolveRoutableSubject(actorId, {
      organizationId: orgB,
      findUser: async () => actor
    });
    assert.equal(denied, null);
    const tenantless = await codexAccountService.resolveRoutableSubject(actorId, {
      findUser: async () => actor
    });
    assert.equal(tenantless, null);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
  }
});

test('foreground subject resolution explains a denied workspace without exposing account data', async () => {
  const actorId = '507f191e810c19729de860f6';
  const allowedOrg = '507f191e810c19729de860f7';
  const deniedOrg = '507f191e810c19729de860f8';

  await assert.rejects(
    codexAccountService.resolveRoutableSubject(actorId, {
      organizationId: deniedOrg,
      explainUnavailable: true,
      findUser: async () => ({
        sharedAIOnly: false,
        recruiterAppAccessSyncedAt: new Date(),
        recruiterAuthorizedOrganizations: [allowedOrg],
        organizationMemberships: [{ organization: allowedOrg, isActive: true }]
      })
    }),
    (error) => (
      error.code === 'AI_RUNTIME_ACCOUNT_REQUIRED'
      && error.statusCode === 409
      && error.details?.reason === 'organization_not_authorized'
      && /selected Recruiter workspace/i.test(error.message)
    )
  );
});
