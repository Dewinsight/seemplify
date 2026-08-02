const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  DELIVERY_PATH,
  LocalUsageMeteringOutbox,
  sanitizeUsageEvent
} = require('./usage-metering-outbox.cjs');

const temporaryDirectories = [];
const secret = 'local-metering-test-secret';

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-local-usage-'));
  temporaryDirectories.push(directory);
  return directory;
}

function usageEvent(overrides = {}) {
  const eventId = overrides.eventId || `usage_${'a'.repeat(48)}`;
  return {
    eventId,
    gatewayExecutionId: `localexec_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`,
    requestId: 'request-1',
    sourceApp: 'recruiter',
    activity: 'candidate.cv_parse',
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    providerRequestId: 'provider-1',
    status: 'success',
    httpStatus: 200,
    latencyMs: 1234,
    usageReported: true,
    usageSource: 'codex-response',
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 20,
    reasoningTokens: 5,
    totalTokens: 120,
    occurredAt: '2026-07-25T10:00:00.000Z',
    ...overrides
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('outbox stores approved operational identity but never prompt or CV content', async () => {
  let calls = 0;
  const directory = tempDirectory();
  const outbox = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 60_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 202 });
    }
  });
  const result = await outbox.enqueue({
    ...usageEvent(),
    candidateName: 'Must not persist',
    organizationName: 'Acme Ltd',
    prompt: 'Must not persist'
  });

  assert.equal(calls, 0);
  assert.equal(outbox.status().pending, 1);
  const stored = JSON.parse(fs.readFileSync(result.file, 'utf8'));
  assert.equal(stored.event.inputTokens, 100);
  assert.equal(stored.event.candidateName, undefined);
  assert.equal(stored.event.organizationName, 'Acme Ltd');
  assert.equal(stored.event.prompt, undefined);
});

test('exact duplicate events are idempotent but changed payloads are rejected and quarantined', async () => {
  const directory = tempDirectory();
  const outbox = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 60_000,
    fetchImpl: async () => new Response('{}', { status: 202 })
  });
  const first = await outbox.enqueue(usageEvent());
  const duplicate = await outbox.enqueue(usageEvent());
  assert.equal(duplicate.duplicate, true);
  assert.equal(outbox.status().dead, 0);

  await assert.rejects(
    () => outbox.enqueue(usageEvent({
      inputTokens: 999,
      totalTokens: 1_019,
      cvText: 'must not be quarantined'
    })),
    (error) => error.code === 'LOCAL_USAGE_IDENTITY_CONFLICT'
  );

  const stored = JSON.parse(fs.readFileSync(first.file, 'utf8'));
  assert.equal(stored.event.inputTokens, 100);
  assert.match(stored.eventFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(outbox.status().pending, 1);
  assert.equal(outbox.status().dead, 1);
  assert.equal(outbox.status().health, 'degraded');
  const [deadName] = fs.readdirSync(path.join(directory, 'dead'));
  const quarantined = fs.readFileSync(path.join(directory, 'dead', deadName), 'utf8');
  assert.match(quarantined, /"identityConflict":true/);
  assert.doesNotMatch(quarantined, /must not be quarantined/);
});

test('delivery is signed over the exact body and removes the durable job only after acceptance', async () => {
  let request;
  const outbox = new LocalUsageMeteringOutbox({
    directory: tempDirectory(),
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 0,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('{"accepted":true}', { status: 202 });
    }
  });
  await outbox.enqueue(usageEvent());
  await outbox.flush({ force: true });

  const canonical = [
    request.options.headers['x-seemplify-timestamp'],
    request.options.headers['x-seemplify-nonce'],
    'POST',
    DELIVERY_PATH,
    request.options.body
  ].join('\n');
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
  assert.equal(request.options.headers['x-seemplify-signature'], expected);
  assert.equal(outbox.status().pending, 0);
  assert.equal(outbox.status().dead, 0);
  assert.ok(outbox.status().lastDeliveryAt);
});

test('retry state survives a new outbox instance and 5xx never dead-letters the event', async () => {
  const directory = tempDirectory();
  const first = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 0,
    retryBaseMs: 50,
    fetchImpl: async () => new Response('offline', { status: 503 })
  });
  await first.enqueue(usageEvent());
  await first.flush({ force: true });
  assert.equal(first.status().pending, 1);
  assert.equal(first.status().dead, 0);
  first.stop();

  const second = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 0,
    fetchImpl: async () => new Response('{"duplicate":true}', { status: 202 })
  });
  await second.flush({ force: true });
  assert.equal(second.status().pending, 0);
  assert.equal(second.status().dead, 0);
});

test('sanitizer normalizes token composition without retaining arbitrary fields', () => {
  const sanitized = sanitizeUsageEvent(usageEvent({
    cachedInputTokens: 999,
    reasoningTokens: 999,
    totalTokens: 1,
    cvText: 'secret'
  }));
  assert.equal(sanitized.cachedInputTokens, sanitized.inputTokens);
  assert.equal(sanitized.reasoningTokens, sanitized.outputTokens);
  assert.equal(sanitized.totalTokens, sanitized.inputTokens + sanitized.outputTokens);
  assert.equal(sanitized.cvText, undefined);
});

test('dead letters are deterministically bounded by count and age', async () => {
  let clock = Date.parse('2026-07-25T10:00:00.000Z');
  const directory = tempDirectory();
  const outbox = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    initialDelayMs: 0,
    deadMaxJobs: 2,
    deadRetentionMs: 100,
    now: () => clock,
    fetchImpl: async () => new Response('identity conflict', { status: 409 })
  });
  for (const seed of ['one', 'two', 'three']) {
    const eventId = `usage_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48)}`;
    await outbox.enqueue(usageEvent({ eventId }));
    await outbox.flush({ force: true });
    clock += 10;
  }
  assert.equal(outbox.status().dead, 2);

  clock += 200;
  const newestId = `usage_${crypto.createHash('sha256').update('newest').digest('hex').slice(0, 48)}`;
  await outbox.enqueue(usageEvent({ eventId: newestId }));
  await outbox.flush({ force: true });
  assert.equal(outbox.status().dead, 1);
  const [deadName] = fs.readdirSync(path.join(directory, 'dead'));
  const dead = JSON.parse(fs.readFileSync(path.join(directory, 'dead', deadName), 'utf8'));
  assert.equal(dead.event.eventId, newestId);
});

test('corrupt pending jobs are quarantined without copying their contents and degrade health', async () => {
  const directory = tempDirectory();
  fs.writeFileSync(path.join(directory, `${'e'.repeat(64)}.json`), 'candidate-name-that-must-not-survive{');
  const outbox = new LocalUsageMeteringOutbox({
    directory,
    endpointUrl: `https://api.example.test${DELIVERY_PATH}`,
    secret,
    fetchImpl: async () => new Response('{}', { status: 202 })
  });
  await outbox.flush({ force: true });

  const status = outbox.status();
  assert.equal(status.pending, 0);
  assert.equal(status.dead, 1);
  assert.equal(status.health, 'degraded');
  const [deadName] = fs.readdirSync(path.join(directory, 'dead'));
  const quarantined = fs.readFileSync(path.join(directory, 'dead', deadName), 'utf8');
  assert.doesNotMatch(quarantined, /candidate-name-that-must-not-survive/);
  assert.match(quarantined, /"corrupt":true/);
});
