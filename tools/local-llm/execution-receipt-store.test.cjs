const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  LocalExecutionReceiptStore,
  canonicalRequestFingerprint
} = require('./execution-receipt-store.cjs');

const directories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-execution-receipts-'));
  directories.push(directory);
  return directory;
}

function executionId(seed) {
  return `localexec_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48)}`;
}

function fingerprint(seed = 'one') {
  return canonicalRequestFingerprint({
    method: 'POST',
    path: '/v1/complete',
    body: { activity: 'experience.analyst_chat', messages: [{ role: 'user', content: seed }] }
  });
}

function prepared(seed = 'one') {
  return {
    response: {
      status: 200,
      payload: {
        id: `provider-${seed}`,
        content: 'Ada Lovelace ada@example.test',
        data: { answer: seed }
      }
    },
    usageRecord: {
      eventId: `usage_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48)}`,
      gatewayExecutionId: executionId(seed),
      requestId: `request-${seed}`,
      activity: 'experience.analyst_chat',
      provider: 'local-codex',
      model: 'gpt-5.6-terra',
      providerRequestId: `provider-${seed}`,
      status: 'success',
      httpStatus: 200,
      latencyMs: 1200,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 5,
      totalTokens: 130,
      usageReported: true,
      usageSource: 'codex-response',
      occurredAt: '2026-07-30T10:00:00.000Z'
    }
  };
}

function store(directory, options = {}) {
  return new LocalExecutionReceiptStore({
    directory,
    encryptionSecret: 'execution-receipt-test-secret',
    leaseMs: 5_000,
    pollMs: 5,
    lockTimeoutMs: 10_000,
    pruneIntervalMs: 0,
    ...options
  });
}

async function completeExecution(receipts, seed) {
  const identity = executionId(seed); const requestFingerprint = fingerprint(seed);
  const lease = await receipts.acquire({ executionId: identity, requestFingerprint });
  assert.equal(lease.action, 'execute');
  await receipts.markStarted(lease);
  await receipts.prepare({ ...lease, prepared: prepared(seed) });
  await receipts.complete(lease);
  return { identity, requestFingerprint };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('canonical request fingerprints ignore object key order but bind endpoint and inference inputs', () => {
  const left = canonicalRequestFingerprint({
    method: 'POST', path: '/v1/complete', body: { activity: 'recruiter.general', settings: { b: 2, a: 1 }, messages: ['one'] }
  });
  const reordered = canonicalRequestFingerprint({
    body: { messages: ['one'], settings: { a: 1, b: 2 }, activity: 'recruiter.general' }, path: '/v1/complete', method: 'POST'
  });
  assert.equal(left, reordered);
  assert.notEqual(left, canonicalRequestFingerprint({
    method: 'POST', path: '/v1/cv/analyze', body: { activity: 'recruiter.general', settings: { a: 1, b: 2 }, messages: ['one'] }
  }));
  assert.notEqual(left, canonicalRequestFingerprint({
    method: 'POST', path: '/v1/complete', body: { activity: 'recruiter.general', settings: { a: 1, b: 2 }, messages: ['two'] }
  }));
});

test('concurrent duplicates across store instances coalesce behind one durable reservation', async () => {
  const directory = temporaryDirectory();
  const firstStore = store(directory); const secondStore = store(directory);
  const identity = executionId('concurrent'); const requestFingerprint = fingerprint('concurrent');
  let providerCalls = 0;
  const owner = await firstStore.acquire({ executionId: identity, requestFingerprint });
  assert.equal(owner.action, 'execute');
  providerCalls += 1;
  await firstStore.markStarted(owner);
  const duplicates = Array.from({ length: 32 }, (_, index) => (
    (index % 2 ? firstStore : secondStore).acquire({ executionId: identity, requestFingerprint })
  ));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await firstStore.prepare({ ...owner, prepared: prepared('concurrent') });
  await firstStore.complete(owner);
  const replayed = await Promise.all(duplicates);
  assert.equal(providerCalls, 1);
  assert.ok(replayed.every((item) => item.action === 'replay'));
  assert.ok(replayed.every((item) => item.prepared.response.payload.id === 'provider-concurrent'));
});

test('a completed encrypted receipt replays after restart without persisting result PII in plaintext', async () => {
  const directory = temporaryDirectory();
  const firstStore = store(directory);
  const { identity, requestFingerprint } = await completeExecution(firstStore, 'restart');
  const [receiptName] = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  const rawReceipt = fs.readFileSync(path.join(directory, receiptName), 'utf8');
  assert.doesNotMatch(rawReceipt, /Ada Lovelace|ada@example\.test|provider-restart/);

  const restarted = store(directory);
  const replay = await restarted.acquire({ executionId: identity, requestFingerprint });
  assert.equal(replay.action, 'replay');
  assert.deepEqual(replay.prepared, prepared('restart'));
});

test('a result-ready crash window recovers the exact response and usage envelope without another execution', async () => {
  const directory = temporaryDirectory();
  const firstStore = store(directory);
  const identity = executionId('recovery'); const requestFingerprint = fingerprint('recovery');
  const owner = await firstStore.acquire({ executionId: identity, requestFingerprint });
  await firstStore.markStarted(owner);
  await firstStore.prepare({ ...owner, prepared: prepared('recovery') });
  await firstStore.release(owner);

  const restarted = store(directory);
  const recovery = await restarted.acquire({ executionId: identity, requestFingerprint });
  assert.equal(recovery.action, 'recover');
  assert.deepEqual(recovery.prepared, prepared('recovery'));
  await restarted.complete(recovery);
  const replay = await firstStore.acquire({ executionId: identity, requestFingerprint });
  assert.equal(replay.action, 'replay');
  assert.deepEqual(replay.prepared.usageRecord, prepared('recovery').usageRecord);
});

test('same execution ID with a changed canonical request is rejected before waiting or replay', async () => {
  const receipts = store(temporaryDirectory());
  const identity = executionId('conflict'); const requestFingerprint = fingerprint('conflict');
  const owner = await receipts.acquire({ executionId: identity, requestFingerprint });
  await assert.rejects(
    () => receipts.acquire({ executionId: identity, requestFingerprint: fingerprint('changed') }),
    (error) => error.code === 'LOCAL_EXECUTION_IDENTITY_CONFLICT' && error.status === 409 && error.retryable === false
  );
  await receipts.release(owner);
});

test('an ambiguous running receipt fails closed instead of automatically re-executing', async () => {
  const receipts = store(temporaryDirectory());
  const identity = executionId('ambiguous'); const requestFingerprint = fingerprint('ambiguous');
  const owner = await receipts.acquire({ executionId: identity, requestFingerprint });
  await receipts.markStarted(owner);
  await receipts.forfeitAmbiguous(owner);
  await assert.rejects(
    () => receipts.acquire({ executionId: identity, requestFingerprint }),
    (error) => error.code === 'LOCAL_EXECUTION_OUTCOME_AMBIGUOUS' && error.retryable === false
  );
});

test('sharded permanent identity ledger stays available beyond the configured hot capacity', async () => {
  let clock = Date.parse('2026-07-30T10:00:00.000Z');
  const directory = temporaryDirectory();
  const receipts = store(directory, {
    now: () => clock,
    retentionMs: 100,
    maxReceipts: 1,
    maxTombstones: 2,
    maxBytes: 1024 * 1024
  });
  const executions = [];
  for (const seed of ['oldest', 'two', 'three', 'four', 'five', 'newest']) {
    executions.push(await completeExecution(receipts, seed));
    clock += 10;
  }
  clock += 200;
  await receipts.prune({ force: true });
  const states = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => (
    JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')).state
  ));
  assert.equal(states.filter((state) => state === 'completed').length, 0);
  assert.equal(states.filter((state) => state === 'expired').length, 2);
  assert.equal(fs.existsSync(receipts.identityLedgerFile(executions[0].identity)), true);
  const restarted = store(directory, {
    now: () => clock,
    retentionMs: 100,
    maxReceipts: 1,
    maxTombstones: 2,
    maxBytes: 1024 * 1024
  });
  await assert.rejects(
    () => restarted.acquire({ executionId: executions[0].identity, requestFingerprint: executions[0].requestFingerprint }),
    (error) => error.code === 'LOCAL_EXECUTION_RECEIPT_EXPIRED' && error.status === 410
  );
  await assert.rejects(
    () => restarted.acquire({ executionId: executions[0].identity, requestFingerprint: fingerprint('changed-oldest') }),
    (error) => error.code === 'LOCAL_EXECUTION_IDENTITY_CONFLICT' && error.status === 409
  );

  clock += 2_000_000;
  await receipts.prune({ force: true });
  assert.equal(receipts.status().retained, 2);
  assert.equal(receipts.status().identityLedgerPermanent, true);
  assert.equal(receipts.status().identityLifetimeCapConfigured, false);
  assert.equal(receipts.status().identityStorageBoundedByDisk, true);
  assert.equal(receipts.status().maxHotIdentities, 3);

  // More than maxReceipts + maxTombstones identities have already been
  // accepted. A new identity remains executable instead of exhausting a
  // lifetime cap, while a fresh completed identity still replays exactly.
  const fresh = await completeExecution(restarted, 'new-after-hot-capacity');
  const replay = await store(directory, { now: () => clock }).acquire({
    executionId: fresh.identity,
    requestFingerprint: fresh.requestFingerprint
  });
  assert.equal(replay.action, 'replay');
  assert.deepEqual(replay.prepared, prepared('new-after-hot-capacity'));
});

test('encrypted results are authenticated against execution identity, fingerprint, schema, and state', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory);
  const { identity, requestFingerprint } = await completeExecution(receipts, 'aad-binding');
  const raw = JSON.parse(fs.readFileSync(receipts.receiptFile(identity), 'utf8'));
  assert.throws(
    () => receipts.decryptPrepared(identity, requestFingerprint, 'result_ready', raw.prepared),
    (error) => error.code === 'LOCAL_EXECUTION_RECEIPT_CORRUPT' && error.retryable === false
  );
  assert.throws(
    () => receipts.decryptPrepared(identity, fingerprint('different'), 'completed', raw.prepared),
    (error) => error.code === 'LOCAL_EXECUTION_RECEIPT_CORRUPT'
  );
});

test('an old lock owned by a live process is never stolen by timestamp', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory, { lockTimeoutMs: 100 });
  const identity = executionId('live-lock');
  const lockDirectory = receipts.lockDirectory(identity);
  fs.mkdirSync(lockDirectory, { recursive: true });
  fs.writeFileSync(path.join(lockDirectory, 'owner.json'), JSON.stringify({
    pid: process.pid,
    ownerToken: 'live-owner'
  }));
  const old = new Date(Date.now() - 86_400_000);
  fs.utimesSync(lockDirectory, old, old);
  await assert.rejects(
    () => receipts.acquire({ executionId: identity, requestFingerprint: fingerprint('live-lock') }),
    (error) => error.code === 'LOCAL_EXECUTION_LOCK_TIMEOUT'
  );
  assert.equal(fs.existsSync(lockDirectory), true);
});

test('an ownerless legacy lock is atomically claimed and does not strand the receipt', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory, { lockTimeoutMs: 500 });
  const identity = executionId('ownerless-lock');
  const lockDirectory = receipts.lockDirectory(identity);
  fs.mkdirSync(lockDirectory, { recursive: true });

  const lease = await receipts.acquire({
    executionId: identity,
    requestFingerprint: fingerprint('ownerless-lock')
  });
  assert.equal(lease.action, 'execute');
  assert.equal(fs.existsSync(lockDirectory), false);
  await receipts.release(lease);
});

test('an empty owner marker left by a release crash is recovered without manual cleanup', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory, { lockTimeoutMs: 500 });
  const identity = executionId('empty-owner-marker');
  const lockDirectory = receipts.lockDirectory(identity);
  fs.mkdirSync(path.join(lockDirectory, 'owner.json'), { recursive: true });

  const lease = await receipts.acquire({
    executionId: identity,
    requestFingerprint: fingerprint('empty-owner-marker')
  });
  assert.equal(lease.action, 'execute');
  assert.equal(fs.existsSync(lockDirectory), false);
  await receipts.release(lease);
});

test('a delayed dead-owner reclaimer cannot remove a replacement lock generation', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory);
  const identity = executionId('dead-owner-aba');
  const lockDirectory = receipts.lockDirectory(identity);
  const staleToken = crypto.randomUUID();
  const replacementToken = crypto.randomUUID();
  fs.mkdirSync(lockDirectory, { recursive: true });
  assert.equal(await receipts.tryClaimOwnerlessLock(lockDirectory, staleToken), true);
  const staleOwner = await receipts.readLockOwner(lockDirectory);

  // Reclaimer B removes the observed generation. A replacement then acquires
  // before delayed reclaimer A resumes with its stale observation.
  assert.equal(await receipts.removeLockOwner(lockDirectory, staleOwner), true);
  fs.rmdirSync(lockDirectory);
  assert.equal(await receipts.tryCreateOwnedLock(lockDirectory, replacementToken), true);

  assert.equal(await receipts.removeLockOwner(lockDirectory, staleOwner), false);
  const currentOwner = await receipts.readLockOwner(lockDirectory);
  assert.equal(currentOwner.ownerToken, replacementToken);
  await receipts.releaseLock(lockDirectory, replacementToken);
});

test('corrupt or oversized receipts fail closed without reopening the provider execution', async () => {
  const directory = temporaryDirectory();
  const receipts = store(directory, { maxPreparedBytes: 1024 });
  const identity = executionId('oversized'); const requestFingerprint = fingerprint('oversized');
  const owner = await receipts.acquire({ executionId: identity, requestFingerprint });
  await receipts.markStarted(owner);
  await assert.rejects(
    () => receipts.prepare({ ...owner, prepared: { response: { status: 200, payload: { content: 'x'.repeat(2_000) } }, usageRecord: null } }),
    (error) => error.code === 'LOCAL_EXECUTION_RESULT_TOO_LARGE'
  );
  await receipts.forfeitAmbiguous(owner);
  await assert.rejects(
    () => receipts.acquire({ executionId: identity, requestFingerprint }),
    (error) => error.code === 'LOCAL_EXECUTION_OUTCOME_AMBIGUOUS'
  );

  const corruptIdentity = executionId('corrupt');
  fs.writeFileSync(receipts.receiptFile(corruptIdentity), 'private-cv-data{');
  await assert.rejects(
    () => receipts.acquire({ executionId: corruptIdentity, requestFingerprint: fingerprint('corrupt') }),
    (error) => error.code === 'LOCAL_EXECUTION_RECEIPT_CORRUPT' && error.retryable === false
  );
});
