const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { createInternalAIAdminAuth } = require('../middleware/internalAIAdminAuth');
const {
  normalizeDashboardQuery,
  safeAccount,
  safeAuditEvent,
  safeUsageEvent,
  sanitizeQueue,
  usageMatch
} = require('../services/aiRuntime/adminAnalyticsDashboardService');

test('admin analytics filters are bounded and invalid enum values are ignored', () => {
  assert.deepEqual(normalizeDashboardQuery({
    days: 500,
    page: -3,
    limit: 1000,
    status: 'deleted',
    runtimeOwner: 'other',
    sourceApp: 'experience-management',
    search: 'x'.repeat(200)
  }), {
    days: 90,
    page: 1,
    limit: 100,
    sourceApp: 'experience-management',
    activity: '',
    provider: '',
    model: '',
    organizationId: '',
    status: '',
    runtimeOwner: '',
    search: 'x'.repeat(120)
  });
});

test('history search is literal and the selected dimensions remain server-side filters', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');
  const filters = normalizeDashboardQuery({ days: 7, search: 'org.*', status: 'failed', runtimeOwner: 'user' });
  const { match, since, until } = usageMatch(filters, now);
  assert.equal(since.toISOString(), '2026-08-10T12:00:00.000Z');
  assert.equal(until, now);
  assert.equal(match.status, 'failed');
  assert.equal(match.runtimeOwner, 'user');
  assert.equal(match.$or[0].requestId.test('org.*'), true);
  assert.equal(match.$or[0].requestId.test('organization'), false);
});

test('telemetry serializers exclude request content, credentials, network identity, and raw errors', () => {
  const event = safeUsageEvent({
    _id: 'event-1', requestId: 'request-1', status: 'failed', sourceApp: 'recruiter', activity: 'cv.parse',
    prompt: 'private CV', response: 'private answer', credentialLabel: 'secret-slot', errorMessage: 'raw upstream detail',
    attemptErrors: [{ message: 'secret' }], rateLimit: { private: true }, totalTokens: 12
  });
  assert.equal(event.totalTokens, 12);
  for (const key of ['prompt', 'response', 'credentialLabel', 'errorMessage', 'attemptErrors', 'rateLimit']) {
    assert.equal(Object.hasOwn(event, key), false, key);
  }

  const account = safeAccount({
    _id: 'account-1', subjectKey: 'secret-subject', idpSubject: 'private-sub', lastError: 'raw error',
    rateLimits: { secret: true }, status: 'connected', connectedEmail: 'user@example.test'
  });
  assert.equal(account.connectedEmail, 'user@example.test');
  for (const key of ['subjectKey', 'idpSubject', 'lastError', 'rateLimits']) assert.equal(Object.hasOwn(account, key), false, key);

  const audit = safeAuditEvent({ actorEmail: 'admin@example.test', ipAddress: '192.0.2.1', userAgent: 'secret-agent', metadata: { key: 'secret' } });
  assert.equal(audit.actorEmail, 'admin@example.test');
  for (const key of ['ipAddress', 'userAgent', 'metadata']) assert.equal(Object.hasOwn(audit, key), false, key);
});

test('queue serializer emits operational counters but not recent CV jobs', () => {
  const queue = sanitizeQueue({
    available: true, counts: { waitingTotal: 3, active: 2 }, rates: { completedLastHour: 9 },
    recentJobs: [{ originalName: 'private-cv.pdf', actorEmail: 'private@example.test' }]
  });
  assert.equal(queue.counts.waiting, 3);
  assert.equal(queue.rates.completedLastHour, 9);
  assert.equal(Object.hasOwn(queue, 'recentJobs'), false);
});

test('admin telemetry endpoint accepts only a replay-protected Identity Provider signature', async () => {
  const secret = 'a'.repeat(64);
  const timestamp = '1786968000000';
  const nonce = 'analytics-test-nonce-123456';
  const body = JSON.stringify({ days: 30 });
  const canonical = [timestamp, nonce, 'identity-provider-admin', 'POST', '/api/internal/ai-admin/v1/dashboard', body].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const headers = {
    'x-seemplify-service': 'identity-provider-admin',
    'x-seemplify-signature-version': '2',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
  const request = {
    get(name) { return headers[name.toLowerCase()]; },
    rawBody: Buffer.from(body), body: JSON.parse(body), method: 'POST',
    originalUrl: '/api/internal/ai-admin/v1/dashboard?ignored=true'
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; }
  };
  let nextCalled = false;
  const middleware = createInternalAIAdminAuth({
    env: { AI_GATEWAY_ADMIN_ANALYTICS_SECRET: secret },
    now: () => Number(timestamp),
    claimNonce: async () => true
  });
  await middleware(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(response.payload, null);

  headers['x-seemplify-service'] = 'ai-interview';
  await middleware(request, response, () => assert.fail('other services must not pass'));
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'AI_GATEWAY_ADMIN_SERVICE_FORBIDDEN');
});
