const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-queue-'));
process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = 'false';
process.env.AI_INTERVIEW_CV_QUEUE_CONCURRENCY = '9';
process.env.AI_INTERVIEW_CV_QUEUE_APPROVED_CONCURRENCY = '2';
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
const queueService = require('../src/cvProcessingQueueService');
const { readStore } = require('../src/store');

test.after(async () => {
  await queueService.closeForTests();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('AI Interview CV status tokens are deterministic only for the same tenant and idempotency key', () => {
  const first = queueService.deterministicStatusToken('org-a', 'upload-1');
  assert.equal(first, queueService.deterministicStatusToken('org-a', 'upload-1'));
  assert.notEqual(first, queueService.deterministicStatusToken('org-b', 'upload-1'));
  assert.notEqual(first, queueService.deterministicStatusToken('org-a', 'upload-2'));
  assert.equal(queueService.tokenHash(first).length, 64);
});

test('local runtime outages remain retryable and receive bounded exponential backoff', () => {
  assert.equal(queueService.isOfflineError({ code: 'AI_LOCAL_UNAVAILABLE' }), true);
  assert.equal(queueService.isOfflineError({ message: 'Seemplify AI gateway could not be reached before the request deadline.' }), true);
  assert.equal(queueService.isOfflineError({ message: 'The CV has no email address.' }), false);
  assert.equal(queueService.backoffDelay(1, { code: 'AI_LOCAL_UNAVAILABLE' }), 30_000);
  assert.equal(queueService.backoffDelay(2, { code: 'AI_LOCAL_UNAVAILABLE' }), 60_000);
  assert.equal(queueService.backoffDelay(20, { code: 'AI_LOCAL_UNAVAILABLE' }), 300_000);
});

test('standalone CV worker concurrency cannot exceed the approved local-runtime limit', async () => {
  assert.equal((await queueService.telemetry()).concurrency, 2);
});

test('public CV job state never exposes extracted resume text or token hashes', () => {
  const state = queueService.publicState({
    publicId: 'aicv_test',
    state: 'queued',
    progress: 10,
    createdAt: '2026-07-23T00:00:00.000Z',
    resumeText: 'private resume text',
    statusTokenHash: 'private hash'
  });
  assert.deepEqual(state, {
    jobId: 'aicv_test',
    state: 'queued',
    progress: 10,
    position: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    failedAt: null,
    candidateId: null,
    error: undefined
  });
  assert.equal('resumeText' in state, false);
  assert.equal('statusTokenHash' in state, false);
});

test('offline submissions persist extracted text and status-token isolation before dispatch', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Ada Lovelace\\nada@example.com\\nPrincipal Engineer\\nTwenty years building reliable distributed systems.'),
      originalname: 'ada.txt',
      mimetype: 'text/plain',
      size: 99
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_product_owner',
    mode: 'import',
    idempotencyKey: 'offline-upload-1'
  };
  const first = await queueService.submit(input);
  assert.equal(first.job.state, 'queued');
  assert.match(first.job.publicId, /^aicv_/);
  const stored = await readStore();
  const persisted = stored.cvProcessingJobs.find((item) => item.publicId === first.job.publicId);
  assert.match(persisted.resumeText, /Ada Lovelace/);
  assert.equal(persisted.lastError.code, 'CV_QUEUE_DISABLED');

  const visible = await queueService.getStatus(first.job.publicId, first.statusToken, 'user_recruiter');
  assert.equal(visible.state, 'queued');
  assert.equal(visible.queueAvailable, false);
  assert.equal(await queueService.getStatus(first.job.publicId, 'wrong-token', 'user_recruiter'), null);
  assert.equal(await queueService.getStatus(first.job.publicId, first.statusToken, 'another-user'), null);

  const duplicate = await queueService.submit(input);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.publicId, first.job.publicId);
  assert.equal(duplicate.statusToken, first.statusToken);
  assert.equal((await readStore()).cvProcessingJobs.length, 1);
});

test('standalone queue publishes privacy-safe signed lifecycle events to the recruiter history', async () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.AI_GATEWAY_HMAC_SECRET;
  const originalGateway = process.env.SEEMPLIFY_AI_GATEWAY_URL;
  const captured = [];
  process.env.AI_GATEWAY_HMAC_SECRET = 'queue-event-test-secret';
  process.env.SEEMPLIFY_AI_GATEWAY_URL = 'https://api.example.test';
  global.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return { ok: true, status: 200 };
  };
  try {
    await queueService.submit({
      file: {
        buffer: Buffer.from('Grace Hopper\\ngrace@example.com\\nEngineering leader with extensive compiler and distributed systems experience.'),
        originalname: 'grace.txt',
        mimetype: 'text/plain',
        size: 110
      },
      organizationId: 'settings',
      actorId: 'user_recruiter',
      jobId: 'job_engineering',
      mode: 'import',
      idempotencyKey: 'queue-event-upload-1'
    });
    await queueService.flushQueueEvents();
    const published = captured.find((request) => request.url.endsWith('/api/internal/ai/v1/cv-queue/events'));
    assert.ok(published);
    const body = JSON.parse(published.init.body);
    assert.match(body.job.publicId, /^aicv_/);
    assert.equal(body.job.state, 'queued');
    assert.equal('resumeText' in body.job, false);
    assert.equal('originalName' in body.job, false);
    assert.equal(typeof published.init.headers['x-seemplify-signature'], 'string');
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.AI_GATEWAY_HMAC_SECRET;
    else process.env.AI_GATEWAY_HMAC_SECRET = originalSecret;
    if (originalGateway === undefined) delete process.env.SEEMPLIFY_AI_GATEWAY_URL;
    else process.env.SEEMPLIFY_AI_GATEWAY_URL = originalGateway;
  }
});
