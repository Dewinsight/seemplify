const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, afterEach, before, beforeEach, mock, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AIQuotaSnapshot = require('../models/AIQuotaSnapshot');
const AIUsageDailyRollup = require('../models/AIUsageDailyRollup');
const AIUsageEvent = require('../models/AIUsageEvent');
const AIUsageLogicalRequest = require('../models/AIUsageLogicalRequest');
const AIUsageProjectionState = require('../models/AIUsageProjectionState');
const {
  COMPATIBILITY_STATE_ID,
  COMPATIBILITY_VERSION,
  EVENT_RETENTION_DAYS,
  PROJECTION_VERSION,
  PROJECTION_REPAIR_STATE_ID,
  buildUsageEnvelope,
  coordinateUsageProjectionCompatibility,
  defaultProjectionRepairSince,
  migrateLegacyUsageEvents,
  persistUsageEnvelope,
  rebuildAllUsageProjections,
  recordUsage,
  repairPendingUsageProjectionsOnStartup,
  repairUsageProjections,
  resetUsageProjectionCompatibilityForTests,
  resetUsageProjectionRepairSchedulerForTests,
  scheduleUsageProjectionRepair,
  setUsageMeteringOutboxForTests,
  usageProjectionRepairHealth,
  usageProjectionRepairSchedulerState,
  utcDay
} = require('../services/aiRuntime/usageService');

let mongo;

function usageInput(overrides = {}) {
  return {
    eventId: 'usage-event-1',
    requestId: 'request-1',
    sourceApp: 'recruiter',
    activity: 'candidate.insights',
    provider: 'chatgpt',
    model: 'chatgpt-connected-account',
    quotaGroup: 'chatgpt-primary',
    organizationId: 'org-1',
    organizationName: 'Example Ltd',
    actorId: 'actor-1',
    actorName: 'Ada',
    status: 'success',
    latencyMs: 120,
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15
    },
    createdAt: new Date('2026-07-24T10:15:20.000Z'),
    rateLimit: {
      requestLimitDaily: 1000,
      requestRemainingDaily: 999,
      requestResetAt: new Date('2026-07-25T00:00:00.000Z'),
      tokenLimitMinute: 8000,
      tokenRemainingMinute: 7985,
      tokenResetAt: new Date('2026-07-24T10:16:00.000Z')
    },
    ...overrides
  };
}

function localMeteringPair(seed = 'default') {
  const eventId = `usage_${crypto.createHash('sha256').update(`terra-metering:${seed}`).digest('hex').slice(0, 48)}`;
  const gatewayExecutionId = `localexec_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`;
  const common = {
    eventId,
    gatewayExecutionId,
    requestId: `terra-request-${seed}`,
    providerRequestId: `chatgpt-provider-${seed}`,
    sourceApp: 'recruiter',
    activity: 'candidate.cv_parse',
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra',
    status: 'success',
    usageReported: true,
    usageSource: 'codex-response',
    usage: {
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 600 },
      completion_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 25 },
      total_tokens: 1100
    },
    createdAt: new Date('2026-07-24T10:15:20.000Z')
  };
  return {
    atSource: {
      ...common,
      meteringOrigin: 'local-gateway-at-source',
      atSourceOnly: true,
      latencyMs: 800
    },
    backend: {
      ...common,
      meteringOrigin: 'backend-response',
      atSourceOnly: false,
      quotaGroup: 'chatgpt-connect',
      organizationId: 'org-terra',
      organizationName: 'Terra Ltd',
      actorId: 'actor-terra',
      actorName: 'Ada',
      latencyMs: 850
    }
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AIUsageEvent.syncIndexes(),
    AIUsageDailyRollup.syncIndexes(),
    AIUsageLogicalRequest.syncIndexes(),
    AIQuotaSnapshot.syncIndexes(),
    AIUsageProjectionState.syncIndexes()
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  resetUsageProjectionCompatibilityForTests();
  setUsageMeteringOutboxForTests();
  await Promise.all([
    AIUsageEvent.deleteMany({}),
    AIUsageDailyRollup.deleteMany({}),
    AIUsageLogicalRequest.deleteMany({}),
    AIQuotaSnapshot.deleteMany({}),
    AIUsageProjectionState.deleteMany({})
  ]);
});

afterEach(() => {
  resetUsageProjectionRepairSchedulerForTests();
  setUsageMeteringOutboxForTests();
  mock.restoreAll();
});

async function waitFor(predicate, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Condition was not met within ${timeoutMs}ms`);
}

test('automatic rebuilds exclude the partially retained 90th UTC day', () => {
  assert.equal(
    defaultProjectionRepairSince(new Date('2026-07-24T19:45:00.000Z')).toISOString(),
    '2026-04-26T00:00:00.000Z'
  );
});

test('legacy event fingerprints remain stable when new metering fields are absent', () => {
  const input = usageInput();
  assert.equal(
    buildUsageEnvelope(input).fingerprint,
    buildUsageEnvelope({
      ...input,
      gatewayExecutionId: undefined,
      meteringOrigin: undefined,
      atSourceOnly: false
    }).fingerprint
  );
});

test('cross-process compatibility lease runs one rebuild while another replica waits', async () => {
  let releaseOwner;
  let ownerStarted;
  const ownerStartedPromise = new Promise((resolve) => {
    ownerStarted = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    releaseOwner = resolve;
  });
  let runs = 0;
  const owner = coordinateUsageProjectionCompatibility({
    ownerId: 'replica-owner',
    leaseMs: 120,
    waitTimeoutMs: 1_000,
    pollMs: 10,
    runCompatibility: async () => {
      runs += 1;
      ownerStarted();
      await releasePromise;
      return {
        migration: { migrated: 2, duplicates: 0 },
        rebuild: { events: 2 }
      };
    }
  });
  await ownerStartedPromise;
  const waiter = coordinateUsageProjectionCompatibility({
    ownerId: 'replica-waiter',
    leaseMs: 120,
    waitTimeoutMs: 1_000,
    pollMs: 10,
    runCompatibility: async () => {
      runs += 1;
      return { migration: {}, rebuild: {} };
    }
  });
  releaseOwner();

  const [ownerResult, waiterResult] = await Promise.all([owner, waiter]);
  assert.equal(runs, 1);
  assert.equal(ownerResult.compatibilityCoordinator, 'owner');
  assert.equal(waiterResult.compatibilityCoordinator, 'waiter');
  assert.deepEqual(waiterResult.migration, { migrated: 2, duplicates: 0 });
  const state = await AIUsageProjectionState.findById(COMPATIBILITY_STATE_ID).lean();
  assert.equal(state.compatibilityVersion, COMPATIBILITY_VERSION);
  assert.equal(state.compatibilityStatus, 'complete');
  assert.equal(state.compatibilityOwner, 'replica-owner');
});

test('compatibility lease is renewed while a long rebuild is running', async () => {
  let releaseOwner;
  let ownerStarted;
  const ownerStartedPromise = new Promise((resolve) => {
    ownerStarted = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    releaseOwner = resolve;
  });
  const owner = coordinateUsageProjectionCompatibility({
    ownerId: 'renewing-replica',
    leaseMs: 60,
    waitTimeoutMs: 1_000,
    pollMs: 5,
    runCompatibility: async () => {
      ownerStarted();
      await releasePromise;
      return { migration: {}, rebuild: {} };
    }
  });
  await ownerStartedPromise;
  const initial = await AIUsageProjectionState.findById(COMPATIBILITY_STATE_ID).lean();
  await waitFor(async () => {
    const current = await AIUsageProjectionState.findById(COMPATIBILITY_STATE_ID).lean();
    return current.compatibilityLeaseUntil.getTime() > initial.compatibilityLeaseUntil.getTime();
  });
  releaseOwner();
  await owner;
});

test('an expired compatibility lease is safely taken over', async () => {
  await AIUsageProjectionState.create({
    _id: COMPATIBILITY_STATE_ID,
    compatibilityVersion: COMPATIBILITY_VERSION,
    compatibilityStatus: 'running',
    compatibilityOwner: 'dead-replica',
    compatibilityLeaseUntil: new Date(Date.now() - 1_000)
  });
  let runs = 0;
  const result = await coordinateUsageProjectionCompatibility({
    ownerId: 'replacement-replica',
    leaseMs: 100,
    waitTimeoutMs: 500,
    pollMs: 5,
    runCompatibility: async () => {
      runs += 1;
      return { migration: { migrated: 0 }, rebuild: { events: 0 } };
    }
  });

  assert.equal(runs, 1);
  assert.equal(result.compatibilityCoordinator, 'owner');
  const state = await AIUsageProjectionState.findById(COMPATIBILITY_STATE_ID).lean();
  assert.equal(state.compatibilityStatus, 'complete');
  assert.equal(state.compatibilityOwner, 'replacement-replica');
});

test('startup wait is bounded while another replica holds an active lease', async () => {
  await AIUsageProjectionState.create({
    _id: COMPATIBILITY_STATE_ID,
    compatibilityVersion: COMPATIBILITY_VERSION,
    compatibilityStatus: 'running',
    compatibilityOwner: 'slow-replica',
    compatibilityLeaseUntil: new Date(Date.now() + 60_000)
  });

  await assert.rejects(
    () => coordinateUsageProjectionCompatibility({
      ownerId: 'bounded-waiter',
      leaseMs: 100,
      waitTimeoutMs: 30,
      pollMs: 5,
      runCompatibility: async () => {
        assert.fail('active lease must not run a second compatibility rebuild');
      }
    }),
    (error) => error.code === 'AI_USAGE_COMPATIBILITY_WAIT_TIMEOUT'
  );
});

test('duplicate recordUsage calls persist and project one authoritative event', async () => {
  const input = usageInput();
  const results = await Promise.all([
    recordUsage(input),
    recordUsage(input),
    recordUsage(input)
  ]);

  assert.equal(await AIUsageEvent.countDocuments({ eventId: input.eventId }), 1);
  const rollup = await AIUsageDailyRollup.findOne({}).lean();
  const quota = await AIQuotaSnapshot.findOne({}).lean();
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 15);
  assert.equal(quota.localRequestsToday, 1);
  assert.equal(quota.localTokensToday, 15);
  assert.equal(results.filter((result) => result.duplicate).length, 2);
});

test('backend-first local metering treats the later at-source delivery as one duplicate event', async () => {
  const { atSource, backend } = localMeteringPair();
  const first = await recordUsage(backend);
  const second = await recordUsage(atSource);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.reconciled, false);
  assert.equal(await AIUsageEvent.countDocuments({ eventId: backend.eventId }), 1);
  const stored = await AIUsageEvent.findOne({ eventId: backend.eventId }).lean();
  assert.equal(stored.meteringOrigin, 'backend-response');
  assert.equal(stored.organizationId, 'org-terra');
  assert.equal(stored.totalTokens, 1100);
  const rollup = await AIUsageDailyRollup.findOne({ organizationId: 'org-terra' }).lean();
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 1100);
  assert.equal(rollup.meteredExecutions, 1);
  assert.equal(rollup.unmeteredExecutions, 0);
  assert.equal(rollup.unknownMeteringExecutions, 0);
});

test('at-source-first local metering reconciles backend attribution without double counting', async () => {
  const { atSource, backend } = localMeteringPair();
  const first = await recordUsage(atSource);
  assert.equal(first.duplicate, false);
  assert.equal(await AIUsageDailyRollup.countDocuments({ organizationId: '' }), 1);

  const second = await recordUsage(backend);
  assert.equal(second.duplicate, false);
  assert.equal(second.reconciled, true);
  assert.equal(await AIUsageEvent.countDocuments({ eventId: backend.eventId }), 1);
  const stored = await AIUsageEvent.findOne({ eventId: backend.eventId }).lean();
  assert.equal(stored.meteringOrigin, 'reconciled');
  assert.equal(stored.atSourceOnly, false);
  assert.equal(stored.organizationId, 'org-terra');
  assert.ok(stored.reconciledAt);
  assert.equal(await AIUsageDailyRollup.countDocuments({ organizationId: '' }), 0);
  const rollup = await AIUsageDailyRollup.findOne({ organizationId: 'org-terra' }).lean();
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 1100);
});

test('concurrent backend and at-source delivery leaves one attributed event and no anonymous rollup', async () => {
  const pairs = Array.from({ length: 8 }, (_value, index) => localMeteringPair(`race-${index}`));
  await Promise.all(pairs.flatMap(({ atSource, backend }) => [
    recordUsage(atSource),
    recordUsage(backend)
  ]));

  assert.equal(await AIUsageEvent.countDocuments({}), pairs.length);
  const stored = await AIUsageEvent.find({}).lean();
  assert.ok(stored.every((event) => ['backend-response', 'reconciled'].includes(event.meteringOrigin)));
  assert.ok(stored.every((event) => event.organizationId === 'org-terra'));
  assert.equal(await AIUsageDailyRollup.countDocuments({ organizationId: '' }), 0);
  const rollups = await AIUsageDailyRollup.find({}).lean();
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].organizationId, 'org-terra');
  assert.equal(rollups[0].calls, pairs.length);
  assert.equal(rollups[0].totalTokens, 1100 * pairs.length);
});

test('Mongo and outbox failure is observable and cannot create projections', async () => {
  mock.method(AIUsageEvent, 'create', async () => {
    const error = new Error('event store unavailable');
    error.code = 'TEST_EVENT_WRITE_FAILURE';
    throw error;
  });
  setUsageMeteringOutboxForTests({
    enqueue: async () => {
      throw Object.assign(new Error('outbox unavailable'), { code: 'TEST_OUTBOX_FAILURE' });
    }
  });

  await assert.rejects(
    () => recordUsage(usageInput()),
    (error) => error.code === 'AI_USAGE_PERSISTENCE_FAILED'
      && error.eventId === 'usage-event-1'
  );
  assert.equal(await AIUsageDailyRollup.countDocuments({}), 0);
  assert.equal(await AIQuotaSnapshot.countDocuments({}), 0);
});

test('a failed raw insert is queued with the exact envelope and replayed exactly once', async () => {
  const input = usageInput();
  const expectedEnvelope = buildUsageEnvelope(input);
  let queuedEnvelope;
  mock.method(AIUsageEvent, 'create', async () => {
    throw Object.assign(new Error('event store unavailable'), { code: 'TEST_EVENT_WRITE_FAILURE' });
  });
  setUsageMeteringOutboxForTests({
    enqueue: async (envelope) => {
      queuedEnvelope = envelope;
      return { jobId: 'fake-outbox-job', duplicate: false };
    }
  });

  const queued = await recordUsage(input);
  assert.equal(queued.persistencePending, true);
  assert.equal(queued.outboxJobId, 'fake-outbox-job');
  assert.deepEqual(queuedEnvelope, expectedEnvelope);

  mock.restoreAll();
  await persistUsageEnvelope(queuedEnvelope);
  const duplicate = await persistUsageEnvelope(queuedEnvelope);
  assert.equal(duplicate.duplicate, true);
  assert.equal(await AIUsageEvent.countDocuments({ eventId: input.eventId }), 1);
  assert.equal((await AIUsageDailyRollup.findOne({}).lean()).calls, 1);
  assert.equal((await AIQuotaSnapshot.findOne({}).lean()).localRequestsToday, 1);
});

test('one logical request stores distinct explicit execution events', async () => {
  const requestId = 'logical-cv-request';
  await recordUsage(usageInput({ eventId: 'execution-A', requestId }));
  await recordUsage(usageInput({
    eventId: 'execution-B',
    requestId,
    createdAt: new Date('2026-07-24T10:15:21.000Z')
  }));

  assert.equal(await AIUsageEvent.countDocuments({ requestId }), 2);
});

test('logical request projection is replay-safe and success-dominates concurrent attempts', async () => {
  const requestId = 'logical-failover-request';
  const failed = usageInput({
    eventId: 'logical-failed-attempt',
    requestId,
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra',
    quotaGroup: '',
    status: 'failed',
    failovers: 0,
    latencyMs: 80,
    createdAt: new Date('2026-07-24T10:15:21.000Z')
  });
  const succeeded = usageInput({
    eventId: 'logical-success-attempt',
    requestId,
    provider: 'chatgpt',
    status: 'success',
    failovers: 1,
    latencyMs: 120,
    createdAt: new Date('2026-07-24T10:15:20.000Z')
  });

  await Promise.all([recordUsage(failed), recordUsage(succeeded)]);
  await Promise.all([recordUsage(succeeded), recordUsage(failed)]);

  const logical = await AIUsageLogicalRequest.findOne({}).lean();
  assert.equal(await AIUsageLogicalRequest.countDocuments({}), 1);
  assert.equal(logical.status, 'success');
  assert.equal(logical.latencyTotalMs, 200);
  assert.equal(logical.failovers, 1);
  assert.equal(logical.executionCount, 2);
  assert.equal(logical.meteredExecutions, 2);
  assert.equal(logical.unmeteredExecutions, 0);
  assert.equal(logical.unknownMeteringExecutions, 0);
  assert.equal(logical.day.toISOString(), '2026-07-24T00:00:00.000Z');
});

test('Terra-shaped usage reaches the raw ledger and projection', async () => {
  await recordUsage(usageInput({
    eventId: 'terra-execution-1',
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra',
    usageSource: 'local-gateway',
    usageReported: true,
    usage: {
      inputTokens: 12_858,
      cachedInputTokens: 10_496,
      outputTokens: 9,
      reasoningTokens: 4,
      totalTokens: 12_867
    }
  }));

  const event = await AIUsageEvent.findOne({ eventId: 'terra-execution-1' }).lean();
  const rollup = await AIUsageDailyRollup.findOne({
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra'
  }).lean();
  assert.equal(event.inputTokens, 12_858);
  assert.equal(event.cachedInputTokens, 10_496);
  assert.equal(event.outputTokens, 9);
  assert.equal(event.reasoningTokens, 4);
  assert.equal(event.totalTokens, 12_867);
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 12_867);
  assert.equal(rollup.meteredExecutions, 1);
  assert.equal(rollup.unmeteredExecutions, 0);
  assert.equal(rollup.unknownMeteringExecutions, 0);
});

test('legacy metering backfill preserves unknown zeroes and rebuilds exact permanent counters', async () => {
  const createdAt = new Date('2026-07-24T09:00:00.000Z');
  const base = {
    sourceApp: 'recruiter',
    activity: 'historical.metering',
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra',
    quotaGroup: '',
    organizationId: '',
    actorId: '',
    status: 'success',
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    createdAt,
    updatedAt: createdAt,
    recordedAt: createdAt,
    expiresAt: new Date('2026-10-22T09:00:00.000Z')
  };
  await AIUsageEvent.collection.insertMany([
    { ...base, requestId: 'legacy-metering-unknown' },
    { ...base, requestId: 'legacy-metering-unmetered', usageReported: false },
    {
      ...base,
      requestId: 'legacy-metering-token-bearing',
      usageReported: false,
      inputTokens: 12,
      totalTokens: 12
    }
  ]);

  const migration = await migrateLegacyUsageEvents();
  assert.equal(migration.migrated, 3);
  await rebuildAllUsageProjections({ since: new Date('2026-07-24T00:00:00.000Z') });

  const unknown = await AIUsageEvent.findOne({ requestId: 'legacy-metering-unknown' }).lean();
  assert.equal(unknown.usageReported, undefined);

  const rollup = await AIUsageDailyRollup.findOne({ activity: 'historical.metering' }).lean();
  assert.equal(rollup.projectionVersion, PROJECTION_VERSION);
  assert.equal(rollup.calls, 3);
  assert.equal(rollup.meteredExecutions, 1);
  assert.equal(rollup.unmeteredExecutions, 1);
  assert.equal(rollup.unknownMeteringExecutions, 1);

  const logical = await AIUsageLogicalRequest.find({ activity: 'historical.metering' }).lean();
  assert.equal(logical.length, 3);
  assert.equal(logical.reduce((total, item) => total + item.executionCount, 0), 3);
  assert.equal(logical.reduce((total, item) => total + item.meteredExecutions, 0), 1);
  assert.equal(logical.reduce((total, item) => total + item.unmeteredExecutions, 0), 1);
  assert.equal(logical.reduce((total, item) => total + item.unknownMeteringExecutions, 0), 1);
});

test('a projection failure is repaired in the background without duplicate event replay', async () => {
  const original = AIUsageDailyRollup.findOneAndUpdate;
  let failed = false;
  mock.method(AIUsageDailyRollup, 'findOneAndUpdate', function (...args) {
    if (!failed) {
      failed = true;
      throw new Error('rollup temporarily unavailable');
    }
    return original.apply(this, args);
  });

  const first = await recordUsage(usageInput());
  assert.equal(first.projectionPending, true);
  assert.equal(await AIUsageEvent.countDocuments({}), 1);
  assert.equal(await AIUsageDailyRollup.countDocuments({}), 0);
  assert.equal(usageProjectionRepairSchedulerState().scheduled, true);
  // Replace the production one-second delay with a short deterministic test
  // delay. The next call to the mocked projection uses the real model method.
  resetUsageProjectionRepairSchedulerForTests();
  assert.equal(scheduleUsageProjectionRepair({
    delayMs: 5,
    baseDelayMs: 5,
    maxDelayMs: 20,
    repairFn: (options) => repairUsageProjections({
      ...options,
      since: new Date('2026-07-24T00:00:00.000Z')
    })
  }), true);
  await waitFor(async () => (
    await AIUsageDailyRollup.countDocuments({}) === 1
    && !usageProjectionRepairSchedulerState().scheduled
    && !usageProjectionRepairSchedulerState().inFlight
  ));

  const rollup = await AIUsageDailyRollup.findOne({}).lean();
  const event = await AIUsageEvent.findOne({}).lean();
  assert.equal(await AIUsageEvent.countDocuments({}), 1);
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 15);
  assert.ok(event.dailyRollupProjectedAt);
  assert.ok(event.quotaProjectedAt);
  assert.equal(event.projectionLastError, undefined);
});

test('startup repair durably rebuilds every pending projection before reporting healthy', async () => {
  await recordUsage(usageInput());
  await Promise.all([
    AIUsageDailyRollup.deleteMany({}),
    AIUsageLogicalRequest.deleteMany({}),
    AIQuotaSnapshot.deleteMany({})
  ]);
  await AIUsageEvent.updateMany({}, {
    $unset: {
      dailyRollupProjectedAt: '',
      logicalRollupProjectedAt: '',
      quotaProjectedAt: ''
    }
  });

  const repaired = await repairPendingUsageProjectionsOnStartup({
    batchLimit: 10,
    maxBatches: 3
  });
  assert.equal(repaired.remaining, 0);
  assert.equal(await AIUsageDailyRollup.countDocuments({}), 1);
  assert.equal(await AIUsageLogicalRequest.countDocuments({}), 1);
  assert.equal(await AIQuotaSnapshot.countDocuments({}), 1);
  const event = await AIUsageEvent.findOne({}).lean();
  assert.ok(event.dailyRollupProjectedAt);
  assert.ok(event.logicalRollupProjectedAt);
  assert.ok(event.quotaProjectedAt);
  const durable = await AIUsageProjectionState.findById(PROJECTION_REPAIR_STATE_ID).lean();
  assert.equal(durable.repairStatus, 'complete');
  assert.equal(durable.repairRemaining, 0);
  assert.equal(usageProjectionRepairHealth().healthy, true);
});

test('background repair preserves the partially retained 90th-day rollup', async () => {
  const repairSince = new Date('2026-04-26T00:00:00.000Z');
  const partialDay = new Date('2026-04-25T00:00:00.000Z');
  const oldCreatedAt = new Date('2026-04-25T23:15:00.000Z');
  await AIUsageEvent.collection.insertOne({
    eventId: 'partial-boundary-event',
    eventFingerprint: 'partial-boundary-fingerprint',
    projectionSequence: 1,
    requestId: 'partial-boundary-request',
    sourceApp: 'recruiter',
    activity: 'historical.partial',
    provider: 'chatgpt',
    model: 'historical-model',
    quotaGroup: '',
    organizationId: '',
    actorId: '',
    status: 'success',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    createdAt: oldCreatedAt,
    recordedAt: oldCreatedAt,
    expiresAt: new Date('2026-07-25T23:15:00.000Z')
  });
  await AIUsageDailyRollup.create({
    day: partialDay,
    sourceApp: 'recruiter',
    activity: 'historical.partial',
    provider: 'chatgpt',
    model: 'historical-model',
    quotaGroup: '',
    organizationId: '',
    actorId: '',
    calls: 42,
    successes: 42,
    totalTokens: 420
  });

  const original = AIUsageDailyRollup.findOneAndUpdate;
  let failed = false;
  mock.method(AIUsageDailyRollup, 'findOneAndUpdate', function (...args) {
    if (!failed) {
      failed = true;
      throw new Error('new-event projection temporarily unavailable');
    }
    return original.apply(this, args);
  });
  const result = await recordUsage(usageInput({
    eventId: 'newer-repair-event',
    requestId: 'newer-repair-request'
  }));
  assert.equal(result.projectionPending, true);

  resetUsageProjectionRepairSchedulerForTests();
  assert.equal(scheduleUsageProjectionRepair({
    delayMs: 5,
    baseDelayMs: 5,
    maxDelayMs: 20,
    repairFn: (options) => repairUsageProjections({ ...options, since: repairSince })
  }), true);
  await waitFor(async () => {
    const newer = await AIUsageEvent.findOne({ eventId: 'newer-repair-event' }).lean();
    return Boolean(
      newer?.dailyRollupProjectedAt
      && newer?.quotaProjectedAt
      && !usageProjectionRepairSchedulerState().scheduled
      && !usageProjectionRepairSchedulerState().inFlight
    );
  });

  const historicalRollup = await AIUsageDailyRollup.findOne({
    activity: 'historical.partial'
  }).lean();
  const historicalEvent = await AIUsageEvent.findOne({
    eventId: 'partial-boundary-event'
  }).lean();
  assert.equal(historicalRollup.calls, 42);
  assert.equal(historicalRollup.totalTokens, 420);
  assert.equal(historicalEvent.dailyRollupProjectedAt, undefined);
  assert.equal(historicalEvent.quotaProjectedAt, undefined);
});

test('background repair is single-flight and exponentially backs off within its cap', async () => {
  const started = [];
  let active = 0;
  let maxActive = 0;
  const repairFn = async () => {
    started.push(Date.now());
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return started.length === 1
      ? { remaining: 1, errors: [{ error: 'retry' }] }
      : { remaining: 0, errors: [] };
  };

  assert.equal(scheduleUsageProjectionRepair({
    delayMs: 5,
    baseDelayMs: 5,
    maxDelayMs: 20,
    repairFn
  }), true);
  assert.equal(scheduleUsageProjectionRepair({
    delayMs: 1,
    repairFn
  }), false);
  await waitFor(() => (
    started.length === 2
    && !usageProjectionRepairSchedulerState().scheduled
    && !usageProjectionRepairSchedulerState().inFlight
  ));

  assert.equal(maxActive, 1);
  assert.ok(started[1] - started[0] >= 8, `Expected backoff, observed ${started[1] - started[0]}ms`);
});

test('a repair request arriving during an active pass is coalesced into the next pass', async () => {
  let calls = 0;
  let releaseFirst;
  let signalStarted;
  const firstStarted = new Promise((resolve) => { signalStarted = resolve; });
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
  const repairFn = async () => {
    calls += 1;
    if (calls === 1) {
      signalStarted();
      await firstRelease;
    }
    return { remaining: 0, errors: [] };
  };

  assert.equal(scheduleUsageProjectionRepair({
    delayMs: 1,
    baseDelayMs: 1,
    maxDelayMs: 5,
    repairFn
  }), true);
  await firstStarted;
  assert.equal(usageProjectionRepairSchedulerState().inFlight, true);
  assert.equal(scheduleUsageProjectionRepair({ delayMs: 1, repairFn }), false);
  assert.equal(usageProjectionRepairSchedulerState().requested, true);
  releaseFirst();
  await waitFor(() => (
    calls === 2
    && !usageProjectionRepairSchedulerState().scheduled
    && !usageProjectionRepairSchedulerState().inFlight
  ));
});

test('concurrent distinct events produce exact daily and quota totals', async () => {
  const inputs = Array.from({ length: 24 }, (_, index) => usageInput({
    eventId: `usage-event-${index}`,
    requestId: `request-${index}`,
    usage: {
      prompt_tokens: 10 + index,
      completion_tokens: 5,
      total_tokens: 15 + index
    },
    createdAt: new Date(`2026-07-24T10:15:${String(index).padStart(2, '0')}.000Z`)
  }));
  await Promise.all(inputs.map(recordUsage));

  const expectedTokens = inputs.reduce((total, item) => total + item.usage.total_tokens, 0);
  const rollup = await AIUsageDailyRollup.findOne({}).lean();
  const quota = await AIQuotaSnapshot.findOne({}).lean();
  assert.equal(await AIUsageEvent.countDocuments({ projectionExcluded: { $ne: true } }), 24);
  assert.equal(rollup.calls, 24);
  assert.equal(rollup.successes, 24);
  assert.equal(rollup.totalTokens, expectedTokens);
  assert.equal(quota.localRequestsToday, 24);
  assert.equal(quota.localTokensToday, expectedTokens);
  assert.equal(quota.localRequestsMinute, 24);
  assert.equal(quota.localTokensMinute, expectedTokens);
});

test('quota projection keeps provider limits and exact counters from the newest event', async () => {
  await recordUsage(usageInput());
  await recordUsage(usageInput({
    eventId: 'usage-event-2',
    requestId: 'request-2',
    createdAt: new Date('2026-07-24T10:15:40.000Z'),
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    rateLimit: {
      requestLimitDaily: 1000,
      requestRemainingDaily: 998,
      requestResetAt: new Date('2026-07-25T00:00:00.000Z'),
      tokenLimitMinute: 8000,
      tokenRemainingMinute: 7960,
      tokenResetAt: new Date('2026-07-24T10:16:00.000Z')
    }
  }));

  const quota = await AIQuotaSnapshot.findOne({}).lean();
  assert.equal(quota.localRequestsToday, 2);
  assert.equal(quota.localTokensToday, 40);
  assert.equal(quota.localRequestsMinute, 2);
  assert.equal(quota.localTokensMinute, 40);
  assert.equal(quota.requestRemainingDaily, 998);
  assert.equal(quota.tokenRemainingMinute, 7960);
});

test('repair and rebuild restore corrupted projections and remove recent ghosts', async () => {
  await recordUsage(usageInput());
  await recordUsage(usageInput({
    eventId: 'usage-event-2',
    requestId: 'request-2',
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
  }));
  await AIUsageDailyRollup.updateOne({}, { $set: { calls: 999, totalTokens: 999 } });
  await AIUsageEvent.updateMany({}, {
    $unset: {
      dailyRollupProjectedAt: '',
      logicalRollupProjectedAt: '',
      quotaProjectedAt: ''
    },
    $set: { projectionLastError: 'simulated crash' }
  });
  await AIUsageDailyRollup.create({
    day: utcDay('2026-07-24T00:00:00.000Z'),
    sourceApp: 'recruiter',
    activity: 'ghost.activity',
    provider: 'chatgpt',
    model: 'ghost-model'
  });
  await AIQuotaSnapshot.create({
    provider: 'chatgpt',
    quotaGroup: 'ghost-quota',
    model: 'ghost-model',
    localDay: utcDay('2026-07-24T00:00:00.000Z'),
    localRequestsToday: 4,
    localTokensToday: 0,
    localMinute: new Date('2026-07-24T10:15:00.000Z'),
    localRequestsMinute: 4,
    localTokensMinute: 0,
    requestRemainingDaily: 996
  });
  await AIUsageLogicalRequest.create([
    {
      requestKey: 'a'.repeat(64),
      sourceApp: 'recruiter',
      activity: 'ghost.activity',
      day: utcDay('2026-07-24T00:00:00.000Z'),
      status: 'failed',
      projectionWatermark: 999,
      projectionVersion: 3,
      projectionHash: 'recent-ghost',
      projectedAt: new Date('2026-07-24T12:00:00.000Z')
    },
    {
      requestKey: 'b'.repeat(64),
      sourceApp: 'recruiter',
      activity: 'historical.coverage',
      day: utcDay('2026-04-01T00:00:00.000Z'),
      status: 'success',
      projectionWatermark: 1,
      projectionVersion: 3,
      projectionHash: 'preserved-history',
      projectedAt: new Date('2026-04-01T12:00:00.000Z')
    }
  ]);

  const repair = await repairUsageProjections({
    limit: 10,
    since: new Date('2026-07-24T00:00:00.000Z')
  });
  assert.equal(repair.errors.length, 0);
  assert.equal(repair.remaining, 0);
  let rollup = await AIUsageDailyRollup.findOne({ activity: 'candidate.insights' }).lean();
  assert.equal(rollup.calls, 2);
  assert.equal(rollup.totalTokens, 40);

  await AIUsageDailyRollup.updateOne(
    { activity: 'candidate.insights' },
    // Regression for production drift where rollups showed fewer calls than
    // raw audit events even though the token sum happened to match.
    { $set: { calls: 35, totalTokens: 40 } }
  );
  const rebuild = await rebuildAllUsageProjections({
    since: new Date('2026-07-24T00:00:00.000Z')
  });
  rollup = await AIUsageDailyRollup.findOne({ activity: 'candidate.insights' }).lean();
  assert.equal(rollup.calls, 2);
  assert.equal(rollup.totalTokens, 40);
  assert.equal(rebuild.removedGhostRollups, 1);
  assert.equal(rebuild.removedGhostLogicalRequests, 1);
  assert.equal(rebuild.resetGhostQuotaSnapshots, 1);
  assert.equal(await AIUsageDailyRollup.countDocuments({ activity: 'ghost.activity' }), 0);
  assert.equal(await AIUsageLogicalRequest.countDocuments({ activity: 'ghost.activity' }), 0);
  assert.equal(await AIUsageLogicalRequest.countDocuments({ activity: 'historical.coverage' }), 1);
  const ghostQuota = await AIQuotaSnapshot.findOne({ quotaGroup: 'ghost-quota' }).lean();
  assert.equal(ghostQuota.localRequestsToday, 0);
  assert.equal(ghostQuota.localTokensToday, 0);
  assert.equal(ghostQuota.requestRemainingDaily, 996);
});

test('legacy duplicate events are retained for audit but excluded from exact projections', async () => {
  const createdAt = new Date('2026-07-24T10:15:20.000Z');
  const expiresAt = new Date(createdAt.getTime() + EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const legacy = {
    requestId: 'legacy-request',
    sourceApp: 'recruiter',
    activity: 'candidate.insights',
    provider: 'chatgpt',
    model: 'chatgpt-connected-account',
    quotaGroup: 'chatgpt-primary',
    organizationId: 'org-1',
    actorId: 'actor-1',
    status: 'success',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    latencyMs: 100,
    createdAt,
    updatedAt: createdAt,
    expiresAt
  };
  // Simulate startup from a deployment which already wrote duplicate explicit
  // identities before the unique index existed. The migration must run before
  // recreating that index.
  await AIUsageEvent.collection.dropIndex('uniq_ai_usage_event_id');
  await AIUsageEvent.collection.insertMany([
    { ...legacy, eventId: 'legacy-shared-event-id' },
    {
      ...legacy,
      eventId: 'legacy-shared-event-id',
      createdAt: new Date(createdAt.getTime() + 1000)
    }
  ]);
  await AIUsageDailyRollup.create({
    day: utcDay(createdAt),
    sourceApp: 'recruiter',
    activity: legacy.activity,
    provider: legacy.provider,
    model: legacy.model,
    quotaGroup: legacy.quotaGroup,
    organizationId: legacy.organizationId,
    actorId: legacy.actorId,
    calls: 8,
    totalTokens: 120
  });

  const migration = await migrateLegacyUsageEvents();
  const rebuild = await rebuildAllUsageProjections({
    since: new Date('2026-07-24T00:00:00.000Z')
  });
  const events = await AIUsageEvent.find({}).sort({ projectionSequence: 1 }).lean();
  const rollup = await AIUsageDailyRollup.findOne({}).lean();
  assert.equal(migration.migrated, 2);
  assert.equal(migration.duplicates, 1);
  assert.equal(events.filter((event) => event.projectionExcluded).length, 1);
  assert.ok(events.every((event) => event.eventId && event.projectionSequence));
  const uniqueIndex = (await AIUsageEvent.collection.indexes())
    .find((index) => index.name === 'uniq_ai_usage_event_id');
  assert.equal(uniqueIndex.unique, true);
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.totalTokens, 15);
  assert.equal(rebuild.events, 1);
});

test('raw usage events retain the configured 90-day expiry and reject conflicting identities', async () => {
  const input = usageInput();
  await recordUsage(input);
  const stored = await AIUsageEvent.findOne({ eventId: input.eventId }).lean();
  assert.equal(
    stored.expiresAt.getTime() - stored.createdAt.getTime(),
    EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  await assert.rejects(
    () => recordUsage(usageInput({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    })),
    (error) => error.code === 'AI_USAGE_IDENTITY_CONFLICT'
  );
  assert.equal(await AIUsageEvent.countDocuments({}), 1);
});
