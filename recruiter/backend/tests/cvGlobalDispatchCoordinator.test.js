const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

process.env.REDIS_ENABLED = 'false';
process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = 'false';

const recruiterDispatch = require('../services/cvGlobalDispatch');
const aiInterviewDispatch = require('../../../ai-interview/backend/src/cvGlobalDispatch');
const IORedis = require('ioredis');

class FakeRedis {
  constructor({ nowMs = 1_700_000_000_000 } = {}) {
    this.status = 'ready';
    this.nowMs = nowMs;
    this.hashes = new Map();
    this.sortedSets = new Map();
    this.failures = new Map();
    this.loseNextRenew = false;
  }

  async connect() {
    this.status = 'ready';
  }

  advance(milliseconds) {
    this.nowMs += milliseconds;
  }

  failNext(marker, error = new Error(`Synthetic Redis ${marker} failure`)) {
    this.failures.set(marker, error);
  }

  hash(key) {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    return this.hashes.get(key);
  }

  sortedSet(key) {
    if (!this.sortedSets.has(key)) this.sortedSets.set(key, new Map());
    return this.sortedSets.get(key);
  }

  async hset(key, field, value) {
    this.hash(key).set(String(field), String(value));
    return 1;
  }

  async hget(key, field) {
    return this.hash(key).get(String(field)) ?? null;
  }

  async zrem(key, member) {
    return this.sortedSet(key).delete(String(member)) ? 1 : 0;
  }

  async del(...keys) {
    let removed = 0;
    for (const key of keys) {
      removed += this.hashes.delete(key) ? 1 : 0;
      removed += this.sortedSets.delete(key) ? 1 : 0;
    }
    return removed;
  }

  prune(key) {
    const leases = this.sortedSet(key);
    for (const [member, expiresAt] of leases) {
      if (Number(expiresAt) <= this.nowMs) leases.delete(member);
    }
  }

  scriptMarker(script) {
    for (const marker of ['initialize', 'acquire', 'renew', 'release', 'state', 'set-control']) {
      if (script.includes(`v2:${marker}`)) return marker;
    }
    return 'unknown';
  }

  async eval(script, numberOfKeys, ...values) {
    const marker = this.scriptMarker(script);
    if (this.failures.has(marker)) {
      const error = this.failures.get(marker);
      this.failures.delete(marker);
      throw error;
    }
    const keys = values.slice(0, numberOfKeys).map(String);
    const args = values.slice(numberOfKeys).map(String);

    if (marker === 'initialize') {
      const [contractKey, controlKey, leasesKey] = keys;
      const [
        protocol,
        identity,
        keyPrefix,
        approvedLimit,
        leaseMs,
        fairnessWindowMs,
        redisIdentity,
        fingerprint,
        serviceId
      ] = args;
      const contract = this.hash(contractKey);
      const expected = {
        protocol,
        identity,
        keyPrefix,
        approvedLimit,
        leaseMs,
        fairnessWindowMs,
        redisIdentity,
        fingerprint
      };
      if (!contract.has('fingerprint')) {
        if (contract.size > 0) {
          return [0, 'contract_mismatch', 'fingerprint', 'partial-contract', fingerprint];
        }
        for (const [field, value] of Object.entries(expected)) contract.set(field, value);
      } else {
        for (const [field, value] of Object.entries(expected)) {
          const actual = contract.get(field);
          if (actual !== value) return [0, 'contract_mismatch', field, actual || '', value];
        }
      }
      contract.set(`lastSeen:${serviceId}`, String(this.nowMs));
      const control = this.hash(controlKey);
      if (!control.has('limit')) control.set('limit', '1');
      if (!control.has('paused')) control.set('paused', '0');
      const limit = Number(control.get('limit'));
      const approved = Number(approvedLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > approved) {
        return [0, 'invalid_limit', 'limit', control.get('limit'), approvedLimit];
      }
      this.prune(leasesKey);
      return [
        1,
        'ok',
        limit,
        control.get('paused') === '1' ? 1 : 0,
        this.sortedSet(leasesKey).size,
        this.nowMs
      ];
    }

    if (marker === 'acquire') {
      const [contractKey, controlKey, leasesKey] = keys;
      const [fingerprint, leaseMs, token, serviceId, fairnessWindowMs] = args;
      if (await this.hget(contractKey, 'fingerprint') !== fingerprint) {
        return [0, 'contract_mismatch', 0, 0, this.nowMs];
      }
      this.prune(leasesKey);
      const limit = Number(await this.hget(controlKey, 'limit'));
      const approved = Number(await this.hget(contractKey, 'approvedLimit'));
      const active = this.sortedSet(leasesKey).size;
      if (!Number.isInteger(limit) || limit < 1 || limit > approved) {
        return [0, 'invalid_limit', limit || 0, active, this.nowMs];
      }
      const control = this.hash(controlKey);
      control.set(`waiting:${serviceId}`, String(this.nowMs));
      if (await this.hget(controlKey, 'paused') === '1') {
        return [0, 'paused', limit, active, this.nowMs];
      }
      if (active >= limit) return [0, 'full', limit, active, this.nowMs];
      const otherService = serviceId === 'recruiter' ? 'ai-interview' : 'recruiter';
      const otherWaitingField = `waiting:${otherService}`;
      let otherSeenAt = Number(control.get(otherWaitingField));
      if (
        Number.isFinite(otherSeenAt)
        && this.nowMs - otherSeenAt > Number(fairnessWindowMs)
      ) {
        control.delete(otherWaitingField);
        otherSeenAt = NaN;
      }
      if (
        Number.isFinite(otherSeenAt)
        && control.get('lastGrantedService') === serviceId
      ) {
        return [0, 'fairness', limit, active, this.nowMs];
      }
      const expiresAt = this.nowMs + Number(leaseMs);
      control.delete(`waiting:${serviceId}`);
      control.set('lastGrantedService', serviceId);
      this.sortedSet(leasesKey).set(token, expiresAt);
      return [1, 'acquired', limit, active + 1, this.nowMs, expiresAt];
    }

    if (marker === 'renew') {
      const [contractKey, leasesKey] = keys;
      const [fingerprint, token, leaseMs] = args;
      if (await this.hget(contractKey, 'fingerprint') !== fingerprint) {
        return [0, 'contract_mismatch', this.nowMs, 0];
      }
      const leases = this.sortedSet(leasesKey);
      if (this.loseNextRenew) {
        this.loseNextRenew = false;
        leases.delete(token);
      }
      const expiresAt = Number(leases.get(token));
      if (!Number.isFinite(expiresAt)) return [0, 'missing', this.nowMs, 0];
      if (expiresAt <= this.nowMs) {
        leases.delete(token);
        return [0, 'expired', this.nowMs, expiresAt];
      }
      const renewedUntil = this.nowMs + Number(leaseMs);
      leases.set(token, renewedUntil);
      return [1, 'renewed', this.nowMs, renewedUntil];
    }

    if (marker === 'release') {
      const [contractKey, leasesKey] = keys;
      const [fingerprint, token] = args;
      if (await this.hget(contractKey, 'fingerprint') !== fingerprint) {
        return [0, 'contract_mismatch', this.nowMs];
      }
      const removed = await this.zrem(leasesKey, token);
      return [removed, removed ? 'released' : 'missing', this.nowMs];
    }

    if (marker === 'state') {
      const [contractKey, controlKey, leasesKey] = keys;
      const [fingerprint] = args;
      if (await this.hget(contractKey, 'fingerprint') !== fingerprint) {
        return [0, 'contract_mismatch', 0, 0, this.nowMs];
      }
      this.prune(leasesKey);
      const limit = Number(await this.hget(controlKey, 'limit'));
      const approved = Number(await this.hget(contractKey, 'approvedLimit'));
      const active = this.sortedSet(leasesKey).size;
      if (!Number.isInteger(limit) || limit < 1 || limit > approved) {
        return [0, 'invalid_limit', limit || 0, active, this.nowMs];
      }
      return [
        1,
        'ok',
        limit,
        await this.hget(controlKey, 'paused') === '1' ? 1 : 0,
        active,
        this.nowMs
      ];
    }

    if (marker === 'set-control') {
      const [contractKey, controlKey] = keys;
      const [fingerprint, field, value] = args;
      if (await this.hget(contractKey, 'fingerprint') !== fingerprint) {
        return [0, 'contract_mismatch'];
      }
      await this.hset(controlKey, field, value);
      return [1, 'updated'];
    }

    throw new Error('Unexpected Redis script');
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function timerHarness() {
  const timers = [];
  return {
    setTimeoutFn(callback, delay) {
      const timer = {
        callback,
        delay,
        cancelled: false,
        unref() {}
      };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      if (timer) timer.cancelled = true;
    },
    fireNext() {
      const timer = timers.find((item) => !item.cancelled);
      assert.ok(timer, 'expected a pending renewal timer');
      timer.cancelled = true;
      timer.callback();
    }
  };
}

function coordinator(factory, redis, serviceId, {
  identity = 'test-cv-inference',
  keyPrefix = 'test:cv-global-dispatch',
  approvedLimit = 1,
  leaseMs = 1_000,
  fairnessWindowMs = 10_000,
  pollMs = 10,
  timers
} = {}) {
  let token = 0;
  return factory({
    redis,
    serviceId,
    identity,
    keyPrefix,
    approvedLimit,
    leaseMs,
    fairnessWindowMs,
    pollMs,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    tokenFactory: () => `${serviceId}-${token += 1}`,
    ...(timers ? {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    } : {})
  });
}

function assertState(actual, expected) {
  assert.deepEqual(
    {
      limit: actual.limit,
      paused: actual.paused,
      active: actual.active
    },
    expected
  );
  assert.ok(Number.isFinite(actual.serverTimeMs));
}

function redisClusterSlot(key) {
  const match = String(key).match(/\{([^{}]+)\}/);
  const input = Buffer.from(match?.[1] || String(key));
  let crc = 0;
  for (const byte of input) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc % 16384;
}

test('shared Redis URL parsing preserves auth, TLS, and database while diagnostics omit credentials', () => {
  const env = {
    CV_GLOBAL_DISPATCH_REDIS_URL: 'rediss://dispatch-user:s3cr%40t@redis.example.test:6380/4',
    CV_GLOBAL_DISPATCH_TLS_REJECT_UNAUTHORIZED: 'false',
    CV_GLOBAL_DISPATCH_TLS_SERVERNAME: 'redis.internal',
    CV_GLOBAL_DISPATCH_IDENTITY: 'production-cv-inference',
    CV_GLOBAL_DISPATCH_KEY_PREFIX: 'production:cv:dispatch',
    CV_GLOBAL_DISPATCH_APPROVED_LIMIT: '3',
    CV_GLOBAL_DISPATCH_LEASE_MS: '9000',
    CV_GLOBAL_DISPATCH_POLL_MS: '75'
  };
  const config = recruiterDispatch.resolveGlobalDispatchConfig({
    env,
    enabled: true,
    serviceId: 'recruiter',
    defaultApprovedLimit: 1
  });
  assert.equal(config.redisUrl, env.CV_GLOBAL_DISPATCH_REDIS_URL);
  assert.equal(config.redisEndpoint, 'rediss://redis.example.test:6380/4');
  assert.equal(config.redisEndpoint.includes('dispatch-user'), false);
  assert.equal(config.redisEndpoint.includes('s3cr'), false);
  assert.equal(config.tls, true);
  assert.equal(config.tlsRejectUnauthorized, false);
  assert.equal(config.tlsServername, 'redis.internal');
  assert.equal(config.contract.approvedLimit, 3);

  let constructed;
  class CapturingRedis {
    constructor(url, options) {
      constructed = { url, options };
    }
  }
  recruiterDispatch.createGlobalDispatchConnection(config, { Redis: CapturingRedis });
  assert.equal(constructed.url, env.CV_GLOBAL_DISPATCH_REDIS_URL);
  assert.deepEqual(constructed.options.tls, {
    rejectUnauthorized: false,
    servername: 'redis.internal'
  });
  assert.equal(constructed.options.connectionName, 'cv-global-dispatch:recruiter');

  assert.throws(
    () => recruiterDispatch.resolveGlobalDispatchConfig({
      env: {},
      enabled: true,
      serviceId: 'recruiter'
    }),
    (error) => error.code === 'CV_GLOBAL_DISPATCH_REDIS_URL_REQUIRED'
  );
});

test('legacy production Redis settings derive one credential-safe shared URL and fingerprint', () => {
  const env = {
    REDIS_HOST: 'dokploy-redis',
    REDIS_PORT: '6381',
    REDIS_USERNAME: 'dispatch worker',
    REDIS_PASSWORD: 'p@ss/word',
    REDIS_DB: '7',
    REDIS_TLS: 'true',
    CV_GLOBAL_DISPATCH_APPROVED_LIMIT: '2'
  };
  const recruiter = recruiterDispatch.resolveGlobalDispatchConfig({
    env,
    enabled: true,
    serviceId: 'recruiter',
    defaultApprovedLimit: 1,
    legacyRedis: { host: 'ignored-recruiter-host', port: 6379 }
  });
  const aiInterview = aiInterviewDispatch.resolveGlobalDispatchConfig({
    env,
    enabled: true,
    serviceId: 'ai-interview',
    defaultApprovedLimit: 1,
    legacyRedis: { host: 'ignored-ai-interview-host', port: 6379 }
  });
  assert.equal(
    recruiter.redisUrl,
    'rediss://dispatch%20worker:p%40ss%2Fword@dokploy-redis:6381/7'
  );
  assert.equal(recruiter.redisEndpoint, 'rediss://dokploy-redis:6381/7');
  assert.equal(recruiter.redisSource, 'legacy-derived');
  assert.equal(recruiter.contract.redisIdentity, 'rediss://dokploy-redis:6381/7');
  assert.equal(recruiter.contract.fingerprint, aiInterview.contract.fingerprint);
  assert.equal(recruiter.keys.contractKey, aiInterview.keys.contractKey);
  assert.equal(recruiter.redisEndpoint.includes('dispatch'), false);
  assert.equal(recruiter.redisEndpoint.includes('p@ss'), false);
});

test('deployed dispatch module copies stay byte-for-byte identical', () => {
  const recruiterSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cvGlobalDispatch.js'),
    'utf8'
  );
  const aiInterviewSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'ai-interview', 'backend', 'src', 'cvGlobalDispatch.js'),
    'utf8'
  );
  assert.equal(aiInterviewSource, recruiterSource);
});

test('both services use the same v2 contract and every Lua key shares one Redis Cluster slot', () => {
  const recruiterKeys = recruiterDispatch.globalDispatchKeys('tenant:cv:dispatch');
  const aiInterviewKeys = aiInterviewDispatch.globalDispatchKeys('tenant:cv:dispatch');
  assert.deepEqual(aiInterviewKeys, recruiterKeys);
  assert.equal(recruiterDispatch.PROTOCOL_VERSION, aiInterviewDispatch.PROTOCOL_VERSION);
  assert.equal(recruiterDispatch.REDIS_HASH_TAG, aiInterviewDispatch.REDIS_HASH_TAG);
  const slots = Object.values(recruiterKeys).map(redisClusterSlot);
  assert.equal(new Set(slots).size, 1);
  assert.equal(Object.values(recruiterKeys).every((key) => key.includes('{seemplify-cv-global-dispatch}')), true);
});

test('recruiter and AI Interview serialize inference through one global permit', async () => {
  const redis = new FakeRedis();
  const recruiter = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter'
  );
  const aiInterview = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview'
  );
  await recruiter.initialize();
  await aiInterview.initialize();

  const holdRecruiter = deferred();
  const recruiterStarted = deferred();
  const order = [];
  let active = 0;
  let maximumActive = 0;
  const recruiterRun = recruiter.withPermit('recruiter-cv', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('recruiter:start');
    recruiterStarted.resolve();
    await holdRecruiter.promise;
    order.push('recruiter:end');
    active -= 1;
  });
  await recruiterStarted.promise;

  let aiStarted = false;
  const aiRun = aiInterview.withPermit('ai-interview-cv', async () => {
    aiStarted = true;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('ai-interview:start');
    active -= 1;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(aiStarted, false);
  assertState(await recruiter.state(), { limit: 1, paused: false, active: 1 });

  holdRecruiter.resolve();
  await Promise.all([recruiterRun, aiRun]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['recruiter:start', 'recruiter:end', 'ai-interview:start']);
  assertState(await recruiter.state(), { limit: 1, paused: false, active: 0 });
});

test('identity, prefix, approved-limit, and lease disagreements fail startup explicitly', async () => {
  const variants = [
    { field: 'identity', override: { identity: 'different-cv-inference' } },
    { field: 'keyPrefix', override: { keyPrefix: 'different:cv:dispatch' } },
    { field: 'approvedLimit', override: { approvedLimit: 3 } },
    { field: 'leaseMs', override: { leaseMs: 2_000 } },
    { field: 'fairnessWindowMs', override: { fairnessWindowMs: 20_000 } }
  ];
  for (const variant of variants) {
    const redis = new FakeRedis();
    const recruiter = coordinator(
      recruiterDispatch.createGlobalDispatchCoordinator,
      redis,
      'recruiter',
      { approvedLimit: 2 }
    );
    await recruiter.initialize();
    const aiInterview = coordinator(
      aiInterviewDispatch.createGlobalDispatchCoordinator,
      redis,
      'ai-interview',
      { approvedLimit: 2, ...variant.override }
    );
    await assert.rejects(
      aiInterview.initialize(),
      (error) => error.code === 'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH'
        && error.message.includes(variant.field)
    );
  }
});

test('a waiting peer service gets the next free permit and stale wait signals cannot deadlock capacity', async () => {
  const redis = new FakeRedis();
  const recruiter = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter',
    { fairnessWindowMs: 1_000 }
  );
  const aiInterview = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview',
    { fairnessWindowMs: 1_000 }
  );
  await recruiter.initialize();
  await aiInterview.initialize();

  const firstRecruiter = await recruiter.acquire('first-recruiter');
  assert.equal((await aiInterview.tryAcquire('waiting-ai-interview')).reason, 'full');
  await firstRecruiter.release();
  assert.equal((await recruiter.tryAcquire('recruiter-cannot-cut-line')).reason, 'fairness');
  const aiPermit = await aiInterview.acquire('waiting-ai-interview');
  assert.equal((await recruiter.tryAcquire('waiting-recruiter')).reason, 'full');
  await aiPermit.release();
  assert.equal((await aiInterview.tryAcquire('ai-cannot-cut-line')).reason, 'fairness');
  const nextRecruiter = await recruiter.acquire('waiting-recruiter');
  await nextRecruiter.release();

  redis.advance(1_001);
  const afterStaleWindow = await recruiter.tryAcquire('recruiter-after-stale-waiter');
  assert.equal(afterStaleWindow.acquired, true);
  await afterStaleWindow.permit.release();
});

test('restart preserves the persisted limit and never resets or clamps it silently', async () => {
  const redis = new FakeRedis();
  const first = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter',
    { approvedLimit: 3 }
  );
  assertState(await first.initialize(), { limit: 1, paused: false, active: 0 });
  await first.setLimit(2);

  const restarted = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter',
    { approvedLimit: 3 }
  );
  assertState(await restarted.initialize(), { limit: 2, paused: false, active: 0 });
  assert.equal(await redis.hget(restarted.keys.controlKey, 'limit'), '2');

  await assert.rejects(
    restarted.setLimit(4),
    (error) => error.code === 'CV_GLOBAL_DISPATCH_LIMIT_NOT_APPROVED'
  );
  assert.equal(await redis.hget(restarted.keys.controlKey, 'limit'), '2');

  await redis.hset(restarted.keys.controlKey, 'limit', '4');
  const invalidRestart = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview',
    { approvedLimit: 3 }
  );
  await assert.rejects(
    invalidRestart.initialize(),
    (error) => error.code === 'CV_GLOBAL_DISPATCH_PERSISTED_LIMIT_INVALID'
  );
  assert.equal(await redis.hget(restarted.keys.controlKey, 'limit'), '4');
});

test('paused and full dispatch return BullMQ jobs to delayed storage without entering inference', async () => {
  class SyntheticDelayedError extends Error {}
  const redis = new FakeRedis();
  const coordinatorInstance = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter'
  );
  await coordinatorInstance.initialize();
  const runner = recruiterDispatch.createGlobalDispatchInferenceRunner({
    coordinator: coordinatorInstance,
    retryDelayMs: 250,
    now: () => 1_000,
    DelayedErrorType: SyntheticDelayedError
  });

  const held = await coordinatorInstance.acquire('held-cv');
  const moves = [];
  const deferrals = [];
  let inferenceCalls = 0;
  await assert.rejects(
    runner({
      id: 'full-cv',
      moveToDelayed: async (timestamp, token) => moves.push({ timestamp, token })
    }, 'worker-token', async () => {
      inferenceCalls += 1;
    }, async (event) => deferrals.push(event.reason)),
    (error) => error instanceof SyntheticDelayedError
      && error.code === 'CV_GLOBAL_DISPATCH_DEFERRED'
      && error.dispatchReason === 'full'
  );
  await held.release();

  await coordinatorInstance.setPaused(true);
  await assert.rejects(
    runner({
      id: 'paused-cv',
      moveToDelayed: async (timestamp, token) => moves.push({ timestamp, token })
    }, 'worker-token', async () => {
      inferenceCalls += 1;
    }, async (event) => deferrals.push(event.reason)),
    (error) => error instanceof SyntheticDelayedError
      && error.dispatchReason === 'paused'
  );
  assert.equal(inferenceCalls, 0);
  assert.deepEqual(deferrals, ['full', 'paused']);
  assert.deepEqual(moves, [
    { timestamp: 1_250, token: 'worker-token' },
    { timestamp: 1_250, token: 'worker-token' }
  ]);
});

for (const failureMode of ['missing', 'redis-error']) {
  test(`renewal ${failureMode} aborts and drains inference before a durable retry`, async () => {
    class SyntheticDelayedError extends Error {}
    const redis = new FakeRedis();
    const timers = timerHarness();
    const coordinatorInstance = coordinator(
      recruiterDispatch.createGlobalDispatchCoordinator,
      redis,
      'recruiter',
      { timers }
    );
    await coordinatorInstance.initialize();
    const runner = recruiterDispatch.createGlobalDispatchInferenceRunner({
      coordinator: coordinatorInstance,
      retryDelayMs: 50,
      now: () => 5_000,
      DelayedErrorType: SyntheticDelayedError
    });
    const started = deferred();
    const moves = [];
    const deferrals = [];
    let aborted = false;
    let operationSettled = false;
    const run = runner({
      id: `renewal-${failureMode}`,
      moveToDelayed: async (timestamp, token) => {
        assert.equal(operationSettled, true, 'provider call must drain before the job is delayed');
        moves.push({ timestamp, token });
      }
    }, 'worker-token', async ({ signal }) => {
      started.resolve();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          operationSettled = true;
          reject(signal.reason);
        }, { once: true });
      });
    }, async ({ reason, error }) => {
      deferrals.push({ reason, code: error?.code });
    });
    await started.promise;
    if (failureMode === 'missing') redis.loseNextRenew = true;
    else redis.failNext('renew');
    timers.fireNext();

    await assert.rejects(
      run,
      (error) => error instanceof SyntheticDelayedError
        && error.code === 'CV_GLOBAL_DISPATCH_DEFERRED'
        && error.dispatchReason === 'lease-lost'
    );
    assert.equal(aborted, true);
    assert.deepEqual(moves, [{ timestamp: 5_050, token: 'worker-token' }]);
    assert.equal(deferrals.length, 1);
    assert.equal(deferrals[0].reason, 'lease-lost');
    assert.match(deferrals[0].code, /^CV_GLOBAL_DISPATCH_/);
    assert.equal(coordinatorInstance.health().healthy, false);
    assert.equal(coordinatorInstance.health().localPermits, 0);
  });
}

test('Redis acquisition errors fail closed and preserve the delayed durable retry path', async () => {
  class SyntheticDelayedError extends Error {}
  const redis = new FakeRedis();
  const coordinatorInstance = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview'
  );
  await coordinatorInstance.initialize();
  redis.failNext('acquire');
  const runner = aiInterviewDispatch.createGlobalDispatchInferenceRunner({
    coordinator: coordinatorInstance,
    retryDelayMs: 100,
    now: () => 10_000,
    DelayedErrorType: SyntheticDelayedError
  });
  let inferenceCalls = 0;
  const moves = [];
  await assert.rejects(
    runner({
      id: 'redis-error-cv',
      moveToDelayed: async (timestamp) => moves.push(timestamp)
    }, 'worker-token', async () => {
      inferenceCalls += 1;
    }),
    (error) => error instanceof SyntheticDelayedError
      && error.dispatchReason === 'unhealthy'
  );
  assert.equal(inferenceCalls, 0);
  assert.deepEqual(moves, [10_100]);
});

test('server time drives expiry and crash recovery independently of worker clocks', async () => {
  const redis = new FakeRedis({ nowMs: 50_000 });
  const crashedWorker = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter'
  );
  const recoveryWorker = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview'
  );
  assert.equal((await crashedWorker.initialize()).serverTimeMs, 50_000);
  await recoveryWorker.initialize();
  await crashedWorker.acquire('crashed-cv');
  assert.equal((await recoveryWorker.tryAcquire('blocked-before-expiry')).reason, 'full');

  redis.advance(1_001);
  assertState(await recoveryWorker.state(), { limit: 1, paused: false, active: 0 });
  const recovered = await recoveryWorker.acquire('recovered-after-expiry');
  await recovered.release();
  assertState(await recoveryWorker.state(), { limit: 1, paused: false, active: 0 });
});

test('graceful shutdown refuses new work and releases every locally owned lease', async () => {
  const redis = new FakeRedis();
  const coordinatorInstance = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter',
    { approvedLimit: 2 }
  );
  await coordinatorInstance.initialize();
  await coordinatorInstance.setLimit(2);
  await Promise.all([
    coordinatorInstance.acquire('shutdown-one'),
    coordinatorInstance.acquire('shutdown-two')
  ]);
  coordinatorInstance.beginShutdown();
  assert.equal((await coordinatorInstance.tryAcquire('shutdown-refused')).reason, 'stopping');
  await coordinatorInstance.releaseAll();
  assertState(await coordinatorInstance.state(), { limit: 2, paused: false, active: 0 });
  assert.equal(coordinatorInstance.health().localPermits, 0);
});

test('queue source acquires only around model inference, after preprocessing and before finalization', () => {
  const cases = [
    {
      file: path.join(__dirname, '..', 'services', 'cvAnalysisQueueService.js'),
      preprocessing: ['durableFileStore.materialize', 'cloudinary.uploadFile', 'cvParser.parseCV'],
      inference: 'runInferenceWithGlobalPermit(',
      model: 'cvParser.analyzeText(',
      finalization: 'createCandidateOnce(',
      usageIdentity: 'usageExecutionId: cvUsageExecutionId(processingJob)',
      worker: /new Worker\(queueName,\s*processJob,/
    },
    {
      file: path.join(__dirname, '..', '..', '..', 'ai-interview', 'backend', 'src', 'cvProcessingQueueService.js'),
      preprocessing: ['durableCvFileStore.readBuffer', 'cvParsingService.extractText'],
      inference: 'runInferenceWithGlobalPermit(',
      model: 'analyzeResume(',
      finalization: 'completionHandler(',
      usageIdentity: 'usageExecutionId: `ai-interview-cv-queue:${processingJob.publicId}`',
      worker: /new Worker\(QUEUE_NAME,\s*processJob,/
    }
  ];
  for (const item of cases) {
    const source = fs.readFileSync(item.file, 'utf8');
    const processSource = source.slice(
      source.indexOf('async function processJob('),
      source.indexOf('async function retryStorageCleanup(', source.indexOf('async function processJob('))
    );
    const inferenceIndex = processSource.indexOf(item.inference);
    assert.ok(inferenceIndex > 0);
    for (const preprocessingCall of item.preprocessing) {
      assert.ok(
        processSource.indexOf(preprocessingCall) < inferenceIndex,
        `${preprocessingCall} must run before permit acquisition`
      );
    }
    const modelIndex = processSource.indexOf(item.model);
    const attemptIndex = processSource.includes('recordInferenceAttempt(')
      ? processSource.indexOf('recordInferenceAttempt(')
      : processSource.indexOf('$inc: { attempts: 1 }');
    const usageExecutionIndex = processSource.indexOf('usageExecutionId:');
    assert.ok(modelIndex > inferenceIndex);
    assert.ok(attemptIndex > inferenceIndex);
    assert.ok(attemptIndex < modelIndex);
    assert.ok(usageExecutionIndex > attemptIndex);
    assert.match(processSource, new RegExp(item.usageIdentity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(processSource.slice(usageExecutionIndex, processSource.indexOf('\n', usageExecutionIndex)), /attempt/);
    assert.ok(processSource.indexOf(item.finalization) > modelIndex);
    assert.match(source, item.worker);
    assert.match(processSource, /waiting_for_chatgpt/);
    assert.match(processSource, /\{ signal \}/);
  }
});

test('legacy bulk worker only migrates idempotently into the durable CV queue', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'bulkUploadService.js'),
    'utf8'
  );
  const workerSource = source.slice(
    source.indexOf('worker = new Worker('),
    source.indexOf("worker.on('completed'")
  );

  assert.match(source, /createGlobalDispatchConnection\(globalDispatchConfig,/);
  assert.match(source, /require\('\.\/cvAnalysisQueueService'\)\.submitUpload\(req, 'bulk'\)/);
  assert.match(source, /const idempotencyKey = `legacy-bulk:\$\{job\.id\}`/);
  assert.match(workerSource, /await migrateLegacyJob\(job\)/);
  assert.match(source, /waitForDurableCompletion\(/);
  assert.doesNotMatch(source, /cvParsingService|parseAndAnalyze|parseCV\(|analyzeText\(/);
  assert.doesNotMatch(source, /runWithGlobalInferencePermit|usageExecutionId:/);
});

function findRedisServerBinary() {
  const candidates = [
    process.env.CV_GLOBAL_DISPATCH_REDIS_SERVER_BINARY,
    'redis-server'
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = childProcess.spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2_000
    });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForRedis(redis, serverProcess) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverProcess.exitCode != null) {
      throw new Error(`Disposable redis-server exited with ${serverProcess.exitCode}`);
    }
    try {
      await redis.ping();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError || new Error('Disposable redis-server did not become ready');
}

const redisServerBinary = findRedisServerBinary();

test('disposable real Redis enforces the cross-service contract, restart persistence, and lease ownership', {
  skip: redisServerBinary ? false : 'redis-server binary is not installed',
  timeout: 15_000
}, async () => {
  const port = await availablePort();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-global-dispatch-'));
  const serverProcess = childProcess.spawn(redisServerBinary, [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--save', '',
    '--appendonly', 'no',
    '--dir', temporaryDirectory,
    '--loglevel', 'warning'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const redis = new IORedis(`redis://127.0.0.1:${port}/0`, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    retryStrategy: () => 25
  });
  const common = {
    identity: `real-test-${process.pid}`,
    keyPrefix: `test:real:cv:dispatch:${process.pid}`,
    approvedLimit: 2,
    leaseMs: 2_000,
    pollMs: 10
  };
  const recruiter = coordinator(
    recruiterDispatch.createGlobalDispatchCoordinator,
    redis,
    'recruiter',
    common
  );
  const aiInterview = coordinator(
    aiInterviewDispatch.createGlobalDispatchCoordinator,
    redis,
    'ai-interview',
    common
  );
  try {
    await waitForRedis(redis, serverProcess);
    assertState(await recruiter.initialize(), { limit: 1, paused: false, active: 0 });
    await aiInterview.initialize();
    await recruiter.setLimit(2);
    const first = await recruiter.acquire('real-recruiter');
    const second = await aiInterview.acquire('real-ai-interview');
    assert.equal((await recruiter.tryAcquire('real-full')).reason, 'full');
    await Promise.all([first.release(), second.release()]);

    const restarted = coordinator(
      recruiterDispatch.createGlobalDispatchCoordinator,
      redis,
      'recruiter',
      common
    );
    assertState(await restarted.initialize(), { limit: 2, paused: false, active: 0 });

    const mismatched = coordinator(
      aiInterviewDispatch.createGlobalDispatchCoordinator,
      redis,
      'ai-interview',
      { ...common, approvedLimit: 3 }
    );
    await assert.rejects(
      mismatched.initialize(),
      (error) => error.code === 'CV_GLOBAL_DISPATCH_CONTRACT_MISMATCH'
    );

    const lost = await restarted.acquire('real-lost-lease');
    await redis.zrem(restarted.keys.leasesKey, lost.token);
    await assert.rejects(
      lost.run(async () => 'discarded-result'),
      (error) => error.code === 'CV_GLOBAL_DISPATCH_LEASE_LOST'
    );
    await lost.release();
  } finally {
    recruiter.beginShutdown();
    aiInterview.beginShutdown();
    await Promise.all([
      recruiter.releaseAll(),
      aiInterview.releaseAll()
    ]);
    await redis.del(
      recruiter.keys.contractKey,
      recruiter.keys.controlKey,
      recruiter.keys.leasesKey
    ).catch(() => {});
    await redis.quit().catch(() => {});
    serverProcess.kill();
    await Promise.race([
      new Promise((resolve) => serverProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
