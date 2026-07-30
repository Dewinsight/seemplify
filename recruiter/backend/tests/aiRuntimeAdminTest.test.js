const test = require('node:test');
const assert = require('node:assert/strict');
const { afterEach, mock } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const AIAuditEvent = require('../models/AIAuditEvent');
const AIQuotaSnapshot = require('../models/AIQuotaSnapshot');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const AIUsageDailyRollup = require('../models/AIUsageDailyRollup');
const AIUsageEvent = require('../models/AIUsageEvent');
const AIUsageLogicalRequest = require('../models/AIUsageLogicalRequest');
const {
  createDefaultRuntimeSettings,
  GROQ_120B,
  LOCAL_MANAGED_MODEL
} = require('../config/aiRuntimeCatalog');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const { AIRuntimeError } = require('../services/aiRuntime/aiRuntimeService');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const localAIRuntimeHealthService = require('../services/localAIRuntimeHealthService');
const {
  getLiveOperations,
  getOverview,
  listRequests,
  runRuntimeTest,
  serializeUsageEvent,
  updateRoute
} = require('../services/adminAIRuntimeService');
const adminAIRuntimeRouter = require('../routes/adminAIRuntime');

const route = {
  activity: 'recruiter.general',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  reasoningEffort: 'medium',
  routeVersion: 3,
  enabled: true
};

const request = {
  admin: {
    _id: 'admin-1',
    name: 'Runtime Admin',
    email: 'runtime-admin@example.com'
  },
  ip: '127.0.0.1',
  get: () => 'node-test'
};

afterEach(() => mock.restoreAll());

function adminRouteHandler(method, routePath) {
  const layer = adminAIRuntimeRouter.stack.find((item) => (
    item.route?.path === routePath && item.route.methods?.[method] === true
  ));
  assert.ok(layer, `${method.toUpperCase()} ${routePath} route must exist`);
  return layer.route.stack.at(-1).handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('historical token-bearing events are serialized as metered even before the flag backfill', () => {
  const serialized = serializeUsageEvent({
    requestId: 'historical-terra',
    provider: 'local-codex',
    usageReported: false,
    inputTokens: 100,
    outputTokens: 5,
    totalTokens: 105
  });
  assert.equal(serialized.usageReported, true);
  assert.equal(serialized.meteringStatus, 'metered');
  assert.equal(serialized.usageSource, 'historical-token-backfill');

  const unknown = serializeUsageEvent({
    requestId: 'historical-unknown',
    totalTokens: 0
  });
  assert.equal(unknown.usageReported, null);
  assert.equal(unknown.meteringStatus, 'legacy-unknown');
  assert.equal(unknown.usageSource, 'legacy-unknown');

  const unmetered = serializeUsageEvent({
    requestId: 'explicitly-unmetered',
    usageReported: false,
    totalTokens: 0
  });
  assert.equal(unmetered.usageReported, false);
  assert.equal(unmetered.meteringStatus, 'unmetered');
  assert.equal(unmetered.usageSource, 'unreported');
});

test('runtime test endpoint requires system settings access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.post\('\/test', \.\.\.settingsAccess/);
});

test('credential management uses the explicit system settings permission', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /const secretAccess = \[adminAuth, requirePermission\('systemSettings'\)\]/);
  assert.doesNotMatch(routeSource, /requireSuperAdmin/);
});

test('queue telemetry stream is authenticated, unbuffered, and cleans up timers', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.get\('\/local\/queue\/stream', \.\.\.analyticsAccess/);
  assert.match(routeSource, /const queueTelemetryStream = new LiveSnapshotBroadcaster/);
  assert.match(routeSource, /intervalMs: 2_000/);
  assert.match(routeSource, /queueTelemetryStream\.subscribe\(req, res\)/);
});

test('manual local health checks audit safe before and after state', async () => {
  const checkedAt = new Date('2026-07-25T09:00:00.000Z');
  mock.method(aiRuntimeService, 'getSettings', async () => ({
    localFailover: {
      enabled: true,
      active: true,
      status: 'groq_failover',
      reason: 'local_gateway_unreachable',
      engine: 'codex',
      model: 'gpt-5.6-terra',
      checkedAt: new Date('2026-07-25T08:30:00.000Z')
    }
  }));
  mock.method(localAIRuntimeHealthService, 'checkNow', async () => ({
    enabled: true,
    active: false,
    status: 'healthy',
    reason: null,
    engine: 'codex',
    model: 'gpt-5.6-terra',
    checkedAt,
    localRuntime: {
      gatewayUrl: 'https://must-not-be-audited.invalid',
      state: { enabled: true }
    }
  }));
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);
  const res = responseRecorder();

  await adminRouteHandler('post', '/local/health-check')(request, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'local_health_check_succeeded');
  assert.equal(event.category, 'health');
  assert.equal(event.metadata.before.active, true);
  assert.equal(event.metadata.after.active, false);
  assert.equal(event.metadata.after.checkedAt, checkedAt.toISOString());
  assert.equal(JSON.stringify(event.metadata).includes('gatewayUrl'), false);
  assert.deepEqual(Object.keys(event.metadata.after).sort(), [
    'active', 'checkedAt', 'enabled', 'engine', 'model', 'reason', 'status'
  ]);
});

test('failed manual local health checks write a content-free failed audit', async () => {
  mock.method(aiRuntimeService, 'getSettings', async () => ({
    localFailover: { enabled: true, active: false, status: 'healthy' }
  }));
  const error = Object.assign(new Error('private gateway response'), { code: 'LOCAL_GATEWAY_TIMEOUT' });
  mock.method(localAIRuntimeHealthService, 'checkNow', async () => {
    throw error;
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);
  mock.method(console, 'error', () => {});
  const res = responseRecorder();

  await adminRouteHandler('post', '/local/health-check')(request, res);

  assert.equal(res.statusCode, 500);
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'local_health_check_failed');
  assert.equal(event.status, 'failed');
  assert.equal(event.metadata.errorCode, 'LOCAL_GATEWAY_TIMEOUT');
  assert.equal(JSON.stringify(event).includes('private gateway response'), false);
});

test('queue pause and resume audit bounded operational before and after state', async () => {
  let paused = false;
  mock.method(cvAnalysisQueue, 'adminTelemetry', async () => ({
    paused,
    available: true,
    concurrency: 1,
    counts: { waitingTotal: 3, active: 1, delayed: 2 },
    worker: { running: true },
    recentJobs: [{ originalName: 'must-not-be-audited.pdf' }]
  }));
  mock.method(cvAnalysisQueue, 'setPaused', async (nextPaused) => {
    paused = nextPaused;
    return {
      paused,
      available: true,
      concurrency: 1,
      counts: { waitingTotal: 3, active: 1, delayed: 2 },
      worker: { running: true },
      recentJobs: [{ actorEmail: 'must-not-be-audited@example.com' }]
    };
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);

  for (const action of ['pause', 'resume']) {
    const res = responseRecorder();
    await adminRouteHandler('post', '/local/queue/:action')(
      { ...request, params: { action } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.queue.paused, action === 'pause');
  }

  const pauseEvent = audit.mock.calls[0].arguments[0];
  const resumeEvent = audit.mock.calls[1].arguments[0];
  assert.equal(pauseEvent.action, 'cv_queue_paused');
  assert.equal(pauseEvent.metadata.before.paused, false);
  assert.equal(pauseEvent.metadata.before.workerRunning, true);
  assert.equal(pauseEvent.metadata.after.paused, true);
  assert.equal(pauseEvent.metadata.after.workerRunning, true);
  assert.equal(resumeEvent.action, 'cv_queue_resumed');
  assert.equal(resumeEvent.metadata.before.paused, true);
  assert.equal(resumeEvent.metadata.after.paused, false);
  assert.equal(JSON.stringify([pauseEvent.metadata, resumeEvent.metadata]).includes('recentJobs'), false);
  assert.equal(JSON.stringify([pauseEvent.metadata, resumeEvent.metadata]).includes('must-not-be-audited'), false);
});

test('failed queue controls write a safe failed audit', async () => {
  mock.method(cvAnalysisQueue, 'adminTelemetry', async () => ({
    paused: false,
    available: true,
    counts: { waitingTotal: 1, active: 0, delayed: 0 },
    worker: { running: true }
  }));
  mock.method(cvAnalysisQueue, 'setPaused', async () => {
    throw Object.assign(new Error('redis://private-host'), { code: 'QUEUE_CONTROL_UNAVAILABLE' });
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);
  mock.method(console, 'error', () => {});
  const res = responseRecorder();

  await adminRouteHandler('post', '/local/queue/:action')(
    { ...request, params: { action: 'pause' } },
    res
  );

  assert.equal(res.statusCode, 500);
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'cv_queue_pause_failed');
  assert.equal(event.status, 'failed');
  assert.equal(event.metadata.requestedPaused, true);
  assert.equal(event.metadata.errorCode, 'QUEUE_CONTROL_UNAVAILABLE');
  assert.equal(JSON.stringify(event).includes('redis://private-host'), false);
});

test('manual CV retry records the operator and returns the refreshed trail', async () => {
  const retriedJob = {
    publicId: 'cv_manual_retry_test',
    organization: 'organization-1'
  };
  const detail = {
    jobId: retriedJob.publicId,
    state: 'queued',
    retry: { manualRequests: 1 },
    attemptHistory: [{ trigger: 'initial', status: 'failed' }]
  };
  const retry = mock.method(cvAnalysisQueue, 'retryFailedJob', async (_jobId, options) => ({
    job: retriedJob,
    queueAvailable: true,
    requestedStage: options.stage,
    effectiveStage: 'analysis'
  }));
  mock.method(cvAnalysisQueue, 'getAdminJobDetail', async () => detail);
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);
  const res = responseRecorder();

  await adminRouteHandler('post', '/local/queue/jobs/:jobId/retry')(
    {
      ...request,
      params: { jobId: retriedJob.publicId },
      body: { stage: 'analysis' }
    },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, true);
  assert.equal(res.body.job, detail);
  assert.deepEqual(retry.mock.calls[0].arguments, [retriedJob.publicId, {
    administrator: true,
    stage: 'analysis',
    requestedBy: {
      type: 'admin',
      id: request.admin._id,
      name: request.admin.name,
      email: request.admin.email
    }
  }]);
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.category, 'operations');
  assert.equal(event.action, 'cv_job_manual_retry_requested');
  assert.equal(event.targetId, retriedJob.publicId);
  assert.equal(event.metadata.requestedStage, 'analysis');
  assert.equal(event.metadata.effectiveStage, 'analysis');
});

test('manual CV retry reports expired retained assets without leaking the service error', async () => {
  mock.method(cvAnalysisQueue, 'retryFailedJob', async () => {
    throw Object.assign(new Error('The retained CV is no longer available'), {
      code: 'CV_RETRY_ASSET_UNAVAILABLE',
      statusCode: 410
    });
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);
  const res = responseRecorder();

  await adminRouteHandler('post', '/local/queue/jobs/:jobId/retry')(
    {
      ...request,
      params: { jobId: 'cv_expired_retry_test' },
      body: { stage: 'parsing' }
    },
    res
  );

  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'CV_RETRY_ASSET_UNAVAILABLE');
  assert.equal(res.body.msg, 'The retained CV is no longer available');
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'cv_job_manual_retry_failed');
  assert.equal(event.status, 'failed');
  assert.equal(event.metadata.errorCode, 'CV_RETRY_ASSET_UNAVAILABLE');
  assert.equal(JSON.stringify(event).includes('The retained CV is no longer available'), false);
});

test('route updates derive failover policy from the selected provider and ignore client policy', async () => {
  let settings = createDefaultRuntimeSettings();
  settings.models = settings.models.map((model) => (
    model.provider === 'groq' ? { ...model, available: true } : model
  ));
  const persistedRoutes = [];
  mock.method(aiRuntimeService, 'getSettings', async () => settings);
  mock.method(AIRuntimeSettings, 'updateOne', async (_filter, update) => {
    if (update.$set?.routes) {
      persistedRoutes.push(update.$set.routes);
      settings = { ...settings, routes: update.$set.routes };
    }
    return { modifiedCount: 1 };
  });
  mock.method(AIAuditEvent, 'create', async (event) => event);

  await updateRoute('matching.analysis', {
    model: LOCAL_MANAGED_MODEL,
    reasoningEffort: 'high',
    enabled: true,
    failoverPolicy: 'none'
  }, request);
  const local = persistedRoutes[0].find((item) => item.activity === 'matching.analysis');
  assert.equal(local.provider, 'local-ollama');
  assert.equal(local.failoverPolicy, 'groq_immediate');

  await updateRoute('matching.analysis', {
    model: GROQ_120B,
    reasoningEffort: 'high',
    enabled: true,
    failoverPolicy: 'wait_local'
  }, request);
  const groq = persistedRoutes[1].find((item) => item.activity === 'matching.analysis');
  assert.equal(groq.provider, 'groq');
  assert.equal(groq.failoverPolicy, 'none');
});

test('live operations and click-through audit endpoints require analytics access', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminAIRuntime.js'), 'utf8');
  assert.match(routeSource, /router\.get\('\/live\/stream', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/requests\/:id', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/audit\/:id', \.\.\.analyticsAccess/);
  assert.match(routeSource, /router\.get\('\/local\/queue\/jobs\/:jobId', \.\.\.analyticsAccess/);
  assert.match(routeSource, /cvAnalysisQueue\.adminTelemetry\(\)/);
  assert.match(routeSource, /const liveOperationsStream = new LiveSnapshotBroadcaster/);
});

test('live operations compares providers, preserves token composition, and groups requests by application', async () => {
  let aggregateCall = 0;
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    aggregateCall += 1;
    if (aggregateCall === 1) {
      const providerGroup = pipeline.find((stage) => stage.$facet)?.$facet?.providers?.[0]?.$group;
      assert.deepEqual(providerGroup.inputTokens, { $sum: '$inputTokens' });
      assert.deepEqual(providerGroup.cachedInputTokens, { $sum: '$cachedInputTokens' });
      assert.deepEqual(providerGroup.outputTokens, { $sum: '$outputTokens' });
      assert.deepEqual(providerGroup.reasoningTokens, { $sum: '$reasoningTokens' });
      assert.deepEqual(providerGroup.totalTokens, { $sum: '$totalTokens' });
      assert.ok(providerGroup.meteredExecutions);
      assert.ok(providerGroup.unmeteredExecutions);
      assert.ok(providerGroup.unknownMeteringExecutions);
    }
    if (aggregateCall === 2) {
      const requestGroup = pipeline.find((stage) => stage.$group?._id?.requestId?.$ifNull);
      assert.ok(requestGroup, 'live metrics must group failover events into logical requests');
      assert.deepEqual(requestGroup.$group._id.sourceApp, { $ifNull: ['$sourceApp', 'recruiter'] });
      assert.deepEqual(requestGroup.$group._id.requestId, {
        $ifNull: ['$requestId', { $toString: '$_id' }]
      });
    }
    if (aggregateCall === 3) {
      const match = pipeline[0].$match;
      assert.deepEqual(match.projectionExcluded, { $ne: true });
      assert.ok(match.createdAt.$lte instanceof Date);
      assert.equal(match.$or.length, 4);
      return [{
        stalePendingCount: 2,
        staleErroredCount: 1,
        oldestPendingAt: new Date('2026-07-25T08:00:00.000Z')
      }];
    }
    return aggregateCall === 1 ? [{
      hour: [{ calls: 9, successes: 7, failures: 2, tokens: 4000, cost: 0.02, averageLatencyMs: 700, maxLatencyMs: 1900, failovers: 1, meteredExecutions: 7, unmeteredExecutions: 1, unknownMeteringExecutions: 1 }],
      fiveMinutes: [{ calls: 3, successes: 2, failures: 1, tokens: 900, averageLatencyMs: 500, meteredExecutions: 2, unmeteredExecutions: 1, unknownMeteringExecutions: 0 }],
      providers: [
        {
          _id: 'groq',
          calls: 6,
          successes: 5,
          failures: 1,
          inputTokens: 2400,
          cachedInputTokens: 1200,
          outputTokens: 300,
          reasoningTokens: 90,
          totalTokens: 2700,
          meteredExecutions: 5,
          unmeteredExecutions: 1,
          unknownMeteringExecutions: 0,
          averageLatencyMs: 600,
          maxLatencyMs: 1200,
          lastRequestAt: new Date()
        },
        {
          _id: 'local-ollama',
          calls: 3,
          successes: 2,
          failures: 1,
          inputTokens: 1100,
          cachedInputTokens: 500,
          outputTokens: 200,
          reasoningTokens: 75,
          totalTokens: 1300,
          meteredExecutions: 2,
          unmeteredExecutions: 0,
          unknownMeteringExecutions: 1,
          averageLatencyMs: 1000,
          maxLatencyMs: 1900,
          lastRequestAt: new Date()
        }
      ]
    }] : [{
      hour: [{ calls: 8, successes: 7, failures: 1, totalTokens: 4000, cost: 0.02, averageLatencyMs: 700, maxLatencyMs: 1900, failovers: 1, meteredExecutions: 7, unmeteredExecutions: 0, unknownMeteringExecutions: 1 }],
      fiveMinutes: [{ calls: 2, successes: 2, failures: 0, totalTokens: 900, averageLatencyMs: 500, meteredExecutions: 2, unmeteredExecutions: 0, unknownMeteringExecutions: 0 }],
      activities: [{ _id: 'candidate.cv_parse', calls: 2, successes: 2, failures: 0 }],
      timeline: [{ _id: '2026-07-24T10:00:00Z', calls: 2, failures: 0 }]
    }];
  });
  mock.method(AIUsageEvent, 'find', () => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() {
      return [{
        _id: 'usage-1',
        requestId: 'request-1',
        provider: 'local-ollama',
        activity: 'candidate.cv_parse',
        organizationName: 'Example Ltd',
        actorName: 'Ada Recruiter',
        status: 'success'
      }];
    }
  }));

  const result = await getLiveOperations();
  assert.equal(result.totals.hour.calls, 8);
  assert.equal(result.totals.hour.attemptCalls, 9);
  assert.equal(result.totals.hour.successRate, 87.5);
  assert.equal(result.providers[1].id, 'local-ollama');
  assert.equal(result.providers[0].inputTokens, 2400);
  assert.equal(result.providers[0].cachedInputTokens, 1200);
  assert.equal(result.providers[0].outputTokens, 300);
  assert.equal(result.providers[0].reasoningTokens, 90);
  assert.equal(result.providers[0].totalTokens, 2700);
  assert.equal(result.providers[0].tokens, 2700);
  assert.equal(result.providers[0].meteredExecutions, 5);
  assert.equal(result.providers[1].unknownMeteringExecutions, 1);
  assert.equal(result.recent[0].organizationName, 'Example Ltd');
  assert.equal(result.recent[0].actorName, 'Ada Recruiter');
  assert.equal(result.recent[0].meteringStatus, 'legacy-unknown');
  assert.equal(typeof result.accountingHealth.meteringOutbox.ready, 'boolean');
  assert.equal(typeof result.accountingHealth.projectionRepair.healthy, 'boolean');
  assert.equal(result.accountingHealth.healthy, false);
  assert.deepEqual(result.accountingHealth.projectionLedger, {
    healthy: false,
    source: 'ai_usage_events',
    staleAfterSeconds: 60,
    stalePendingCount: 2,
    staleErroredCount: 1,
    oldestPendingAt: '2026-07-25T08:00:00.000Z'
  });
});

test('overview exposes full token, success, and latency detail for local and hosted usage', async () => {
  const aggregatePipelines = [];
  const richRows = {
    '$activity': 'candidate.cv_parse',
    '$model': 'gpt-5.6-terra',
    '$provider': 'local-codex'
  };
  mock.method(AIUsageDailyRollup, 'aggregate', async (pipeline) => {
    aggregatePipelines.push(pipeline);
    const groupId = pipeline[1]?.$group?._id;
    if (groupId === null) {
      return [{
        calls: 4,
        successes: 3,
        failures: 1,
        inputTokens: 40000,
        cachedInputTokens: 32000,
        outputTokens: 1200,
        reasoningTokens: 600,
        totalTokens: 41200,
        estimatedCostUsd: 0.0123,
        latencyTotalMs: 10000,
        meteredExecutions: 3,
        unmeteredExecutions: 1,
        unknownMeteringExecutions: 0
      }];
    }
    if (richRows[groupId]) {
      return [{
        _id: richRows[groupId],
        calls: 4,
        successes: 3,
        failures: 1,
        inputTokens: 40000,
        cachedInputTokens: 32000,
        outputTokens: 1200,
        reasoningTokens: 600,
        totalTokens: 41200,
        estimatedCostUsd: 0.0123,
        latencyTotalMs: 10000,
        meteredExecutions: 3,
        unmeteredExecutions: 1,
        unknownMeteringExecutions: 0
      }];
    }
    return [];
  });
  mock.method(AIQuotaSnapshot, 'find', () => ({
    sort() { return this; },
    async lean() { return []; }
  }));
  mock.method(AIUsageEvent, 'find', () => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() { return [{ latencyMs: 1000 }, { latencyMs: 4000 }]; }
  }));
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    const requestGroup = pipeline.find((stage) => stage.$group?._id?.requestId?.$ifNull);
    assert.ok(requestGroup, 'overview must group failover attempts by logical request id');
    assert.deepEqual(requestGroup.$group._id.sourceApp, { $ifNull: ['$sourceApp', 'recruiter'] });
    return [{
      calls: 3,
      successes: 3,
      failures: 0,
      averageLatencyMs: 3333,
      tokens: 41200
    }];
  });

  const result = await getOverview({ range: '30d' });

  assert.deepEqual(result.byModel[0], {
    _id: 'gpt-5.6-terra',
    calls: 4,
    successes: 3,
    failures: 1,
    successRate: 75,
    inputTokens: 40000,
    cachedInputTokens: 32000,
    outputTokens: 1200,
    reasoningTokens: 600,
    totalTokens: 41200,
    tokens: 41200,
    estimatedCostUsd: 0.0123,
    cost: 0.0123,
    averageLatencyMs: 2500,
    meteredExecutions: 3,
    unmeteredExecutions: 1,
    unknownMeteringExecutions: 0
  });
  assert.equal(result.byActivity[0].totalTokens, 41200);
  assert.equal(result.byProvider[0]._id, 'local-codex');
  assert.equal(result.totals.calls, 3);
  assert.equal(result.totals.attemptCalls, 4);
  assert.equal(result.totals.successRate, 100);
  assert.equal(result.totals.meteredExecutions, 3);
  assert.equal(result.totals.unmeteredExecutions, 1);
  for (const groupId of ['$activity', '$model', '$provider']) {
    const pipeline = aggregatePipelines.find((item) => item[1]?.$group?._id === groupId);
    const group = pipeline[1].$group;
    assert.deepEqual(group.inputTokens, { $sum: '$inputTokens' });
    assert.deepEqual(group.cachedInputTokens, { $sum: '$cachedInputTokens' });
    assert.deepEqual(group.outputTokens, { $sum: '$outputTokens' });
    assert.deepEqual(group.reasoningTokens, { $sum: '$reasoningTokens' });
    assert.deepEqual(group.latencyTotalMs, { $sum: '$latencyTotalMs' });
    assert.equal(
      group.unknownMeteringExecutions.$sum.$cond[2].$ifNull[0],
      '$calls',
      'pre-v4 rollup calls must remain legacy-unknown rather than measured zero'
    );
  }
});

test('all-time overview uses permanent logical requests and exposes unrecoverable legacy coverage', async () => {
  mock.method(AIUsageDailyRollup, 'aggregate', async (pipeline) => {
    if (pipeline[1]?.$group?._id !== null) return [];
    return [{
      calls: 12,
      successes: 10,
      failures: 2,
      totalTokens: 900,
      latencyTotalMs: 1200,
      legacyAttemptCalls: 4,
      meteredExecutions: 6,
      unmeteredExecutions: 2,
      unknownMeteringExecutions: 4
    }];
  });
  mock.method(AIUsageLogicalRequest, 'aggregate', async (pipeline) => {
    const group = pipeline[0].$group;
    assert.ok(group.meteredExecutions);
    assert.ok(group.unmeteredExecutions);
    assert.ok(group.unknownMeteringExecutions);
    assert.ok(group.legacyMeteringLogicalRequests);
    return [{
      calls: 7,
      successes: 6,
      failures: 1,
      averageLatencyMs: 300,
      legacyMeteringLogicalRequests: 3,
      coverageStart: new Date('2026-05-01T00:00:00.000Z')
    }];
  });
  mock.method(AIQuotaSnapshot, 'find', () => ({
    sort() { return this; },
    async lean() { return []; }
  }));
  mock.method(AIUsageEvent, 'find', () => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    async lean() { return []; }
  }));
  mock.method(AIUsageEvent, 'aggregate', async () => {
    assert.fail('all-time logical totals must not depend on the expiring raw event ledger');
  });

  const result = await getOverview({ range: 'all' });
  assert.equal(result.totals.calls, 7);
  assert.equal(result.totals.successes, 6);
  assert.equal(result.totals.failures, 1);
  assert.equal(result.totals.attemptCalls, 12);
  assert.equal(result.totals.meteredExecutions, 6);
  assert.equal(result.totals.unmeteredExecutions, 2);
  assert.equal(result.totals.unknownMeteringExecutions, 4);
  assert.equal(result.totals.logicalCoverage.complete, false);
  assert.equal(result.totals.logicalCoverage.legacyAttemptCalls, 4);
  assert.equal(result.totals.logicalCoverage.meteringComplete, false);
  assert.equal(result.totals.logicalCoverage.legacyMeteringLogicalRequests, 3);
  assert.equal(
    result.totals.logicalCoverage.start.toISOString(),
    '2026-05-01T00:00:00.000Z'
  );
});

function mockUsageQuery(value) {
  return {
    select() { return this; },
    sort() { return this; },
    async lean() { return value; }
  };
}

test('admin runtime test uses production routing with a fixed synthetic prompt', async () => {
  let completionInput;
  let usageFilter;
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [route] }));
  mock.method(aiRuntimeService, 'complete', async (activity, input) => {
    assert.equal(activity, route.activity);
    completionInput = input;
    return {
      requestId: 'runtime-test-1',
      content: 'AI runtime test passed.',
      finishReason: 'stop',
      model: route.model,
      usage: { inputTokens: 18, outputTokens: 6, totalTokens: 24 }
    };
  });
  mock.method(AIUsageEvent, 'find', (filter) => {
    usageFilter = filter;
    return mockUsageQuery([
      {
        provider: 'local-codex',
        model: 'gpt-5.6-terra',
        reasoningEffort: 'high',
        routeVersion: 2,
        latencyMs: 80,
        attempts: 1,
        failovers: 0,
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 2,
        reasoningTokens: 1,
        totalTokens: 12,
        usageReported: true,
        usageSource: 'gateway-response',
        estimatedCostUsd: 0.00002
      },
      {
        provider: 'groq',
        model: route.model,
        reasoningEffort: 'medium',
        routeVersion: 3,
        quotaGroup: 'groq-primary',
        latencyMs: 125,
        attempts: 2,
        failovers: 1,
        failoverFrom: 'local-codex',
        failoverReason: 'local_unavailable',
        inputTokens: 18,
        cachedInputTokens: 0,
        outputTokens: 6,
        reasoningTokens: 2,
        totalTokens: 24,
        usageReported: true,
        usageSource: 'provider-response',
        estimatedCostUsd: 0.00001
      }
    ]);
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);

  const result = await runRuntimeTest(route.activity, request);

  assert.equal(completionInput.context.sourceApp, 'admin-runtime-test');
  assert.equal(completionInput.context.actorId, 'admin-1');
  assert.equal(completionInput.promptVersion, 'admin-runtime-test-v2');
  assert.equal(completionInput.max_tokens, 512);
  assert.equal(completionInput.messages.length, 2);
  assert.equal(JSON.stringify(completionInput).includes('candidate'), false);
  assert.equal(result.success, true);
  assert.equal(result.execution.requestId, 'runtime-test-1');
  assert.deepEqual(usageFilter, {
    sourceApp: 'admin-runtime-test',
    requestId: 'runtime-test-1'
  });
  assert.equal(result.execution.provider, 'groq');
  assert.equal(result.execution.model, route.model);
  assert.equal(result.execution.quotaGroup, 'groq-primary');
  assert.equal(result.execution.usageReported, true);
  assert.equal(result.execution.usageSource, 'aggregated-request-events');
  assert.equal(result.execution.latencyMs, 205);
  assert.equal(result.execution.attempts, 3);
  assert.equal(result.execution.failovers, 1);
  assert.deepEqual(result.execution.usage, {
    inputTokens: 28,
    cachedInputTokens: 2,
    outputTokens: 8,
    reasoningTokens: 3,
    totalTokens: 36,
    estimatedCostUsd: 0.00003
  });
  assert.equal(audit.mock.calls[0].arguments[0].metadata.totalTokens, 36);
  assert.equal(audit.mock.calls[0].arguments[0].action, 'runtime_test_succeeded');
  assert.equal('response' in audit.mock.calls[0].arguments[0].metadata, false);
});

test('admin runtime test exercises strict structured transport for structured activities', async () => {
  const structuredRoute = { ...route, activity: 'interview.questions' };
  let structuredInput;
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [structuredRoute] }));
  mock.method(aiRuntimeService, 'structuredComplete', async (activity, input) => {
    assert.equal(activity, structuredRoute.activity);
    structuredInput = input;
    return {
      requestId: 'runtime-structured-1',
      content: JSON.stringify({ passed: true, activity, message: 'Structured route passed.' }),
      data: { passed: true, activity, message: 'Structured route passed.' },
      finishReason: 'stop',
      model: structuredRoute.model,
      usage: { totalTokens: 30 }
    };
  });
  mock.method(AIUsageEvent, 'find', () => mockUsageQuery([{ provider: 'groq', model: structuredRoute.model, totalTokens: 30 }]));
  mock.method(AIAuditEvent, 'create', async (event) => event);

  const result = await runRuntimeTest(structuredRoute.activity, request);
  assert.equal(structuredInput.schemaStrict, true);
  assert.equal(structuredInput.jsonSchema.additionalProperties, false);
  assert.equal(result.execution.structuredOutput, true);
  assert.match(result.execution.response, /Structured route passed/);
});

test('admin CV runtime test uses the production CV schema accepted by the local gateway', async () => {
  const cvRoute = { ...route, activity: 'candidate.cv_parse', provider: 'local-ollama', model: 'managed-local-gpu' };
  let structuredInput;
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [cvRoute] }));
  mock.method(aiRuntimeService, 'structuredComplete', async (activity, input) => {
    assert.equal(activity, cvRoute.activity);
    structuredInput = input;
    return {
      requestId: 'runtime-cv-1',
      content: JSON.stringify({ firstName: 'Test', lastName: 'Candidate' }),
      data: { firstName: 'Test', lastName: 'Candidate' },
      finishReason: 'stop',
      model: 'gpt-5.6-terra',
      usage: { totalTokens: 12871 }
    };
  });
  mock.method(AIUsageEvent, 'find', () => mockUsageQuery([{
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    totalTokens: 12871
  }]));
  mock.method(AIAuditEvent, 'create', async (event) => event);

  const result = await runRuntimeTest(cvRoute.activity, request);
  const requiredFields = [
    'firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience',
    'education', 'skills', 'summary', 'strengths', 'potentialFlags', 'workExperience',
    'educationHistory', 'certifications', 'languages', 'awards', 'projects', 'publications',
    'volunteerWork', 'professionalMemberships', 'portfolioLinks', 'additionalSections', 'fullCVData'
  ];
  assert.equal(structuredInput.schemaName, 'admin_runtime_test_cv');
  assert.equal(structuredInput.schemaStrict, false);
  assert.ok(requiredFields.every((field) => structuredInput.jsonSchema.required.includes(field)));
  assert.match(structuredInput.messages[1].content, /synthetic CV/);
  assert.equal(result.execution.provider, 'local-codex');
  assert.equal(result.execution.model, 'gpt-5.6-terra');
  assert.equal(result.execution.usage.totalTokens, 12871);
});

test('admin runtime test rejects unknown and disabled activities before provider use', async () => {
  const complete = mock.method(aiRuntimeService, 'complete', async () => { throw new Error('should not run'); });
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [{ ...route, enabled: false }] }));

  await assert.rejects(
    runRuntimeTest(route.activity, request),
    { code: 'AI_RUNTIME_TEST_ACTIVITY_DISABLED', field: 'activity', statusCode: 400 }
  );
  await assert.rejects(
    runRuntimeTest('unknown.activity', request),
    { code: 'AI_RUNTIME_TEST_ACTIVITY_INVALID', field: 'activity', statusCode: 400 }
  );
  assert.equal(complete.mock.calls.length, 0);
});

test('admin runtime test records a content-free failed audit', async () => {
  mock.method(aiRuntimeService, 'getSettings', async () => ({ routes: [route] }));
  mock.method(aiRuntimeService, 'complete', async () => {
    throw new AIRuntimeError('No healthy Groq credential is available', {
      code: 'AI_CREDENTIALS_EXHAUSTED',
      statusCode: 503
    });
  });
  const audit = mock.method(AIAuditEvent, 'create', async (event) => event);

  await assert.rejects(
    runRuntimeTest(route.activity, request),
    { code: 'AI_CREDENTIALS_EXHAUSTED', statusCode: 503 }
  );
  const event = audit.mock.calls[0].arguments[0];
  assert.equal(event.action, 'runtime_test_failed');
  assert.equal(event.status, 'failed');
  assert.deepEqual(Object.keys(event.metadata).sort(), ['errorCode', 'latencyMs']);
});

test('request analytics summarize the complete filtered result set', async () => {
  const filters = [];
  mock.method(AIUsageEvent, 'find', (filter) => {
    filters.push(filter);
    const latencyOnly = Object.hasOwn(filter, 'latencyMs');
    return {
      select() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      async lean() {
        return latencyOnly
          ? [{ latencyMs: 900 }, { latencyMs: 100 }, { latencyMs: 400 }]
          : [{ requestId: 'cv-queue:cv_request_summary', activity: 'interview.questions' }];
      }
    };
  });
  mock.method(AIUsageEvent, 'countDocuments', async () => 42);
  const summaries = mock.method(cvAnalysisQueue, 'getAdminJobSummaries', async (jobIds) => {
    assert.deepEqual(jobIds, ['cv_request_summary']);
    return {
      cv_request_summary: {
        jobId: 'cv_request_summary',
        state: 'failed',
        retry: { available: true }
      }
    };
  });
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.activity, 'interview.questions');
    assert.equal(pipeline[0].$match.status, 'success');
    assert.equal(pipeline[0].$match.organizationId, 'org-1');
    return [{
      calls: 4,
      successes: 4,
      failures: 0,
      inputTokens: 1200,
      cachedInputTokens: 200,
      outputTokens: 600,
      reasoningTokens: 300,
      totalTokens: 2100,
      estimatedCostUsd: 0.01234567,
      averageLatencyMs: 466.6,
      failovers: 2,
      meteredExecutions: 3,
      unmeteredExecutions: 1,
      unknownMeteringExecutions: 0
    }];
  });

  const result = await listRequests({
    activity: 'interview.questions',
    status: 'success',
    organizationId: 'org-1',
    range: '7d',
    page: '2',
    limit: '10'
  });

  assert.equal(result.items[0].requestId, 'cv-queue:cv_request_summary');
  assert.equal(result.items[0].cvProcessing.jobId, 'cv_request_summary');
  assert.equal(result.items[0].cvProcessing.retry.available, true);
  assert.equal(summaries.mock.calls.length, 1);
  assert.deepEqual(result.summary, {
    calls: 4,
    successes: 4,
    failures: 0,
    successRate: 100,
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 600,
    reasoningTokens: 300,
    totalTokens: 2100,
    estimatedCostUsd: 0.012346,
    meteredExecutions: 3,
    unmeteredExecutions: 1,
    unknownMeteringExecutions: 0,
    averageLatencyMs: 467,
    p50LatencyMs: 400,
    p95LatencyMs: 900,
    failovers: 2,
    detailWindow: '7d'
  });
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 42, pages: 5 });
  assert.equal(filters.length, 2);
  assert.equal(filters[0].activity, 'interview.questions');
  assert.ok(filters[0].createdAt.$gte instanceof Date);
});

test('all-time request details remain bounded to the raw-event retention window', async () => {
  const matches = [];
  mock.method(AIUsageEvent, 'find', (filter) => {
    matches.push(filter);
    return {
      select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
      async lean() { return []; }
    };
  });
  mock.method(AIUsageEvent, 'countDocuments', async (filter) => {
    matches.push(filter);
    return 0;
  });
  mock.method(AIUsageEvent, 'aggregate', async (pipeline) => {
    matches.push(pipeline[0].$match);
    return [];
  });

  const result = await listRequests({ range: 'all' });
  assert.equal(result.summary.detailWindow, 'retained-90d');
  assert.ok(matches.length >= 4);
  for (const match of matches) assert.ok(match.createdAt.$gte instanceof Date);
});
