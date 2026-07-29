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
const cvParsingService = require('../src/cvParsingService');
const durableCvFileStore = require('../src/durableCvFileStore');
const { mutateStore, readStore } = require('../src/store');

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
  assert.equal(queueService.isOfflineError({ code: 'LOCAL_LLM_BUSY' }), true);
  assert.equal(queueService.isOfflineError({ message: 'Seemplify AI gateway could not be reached before the request deadline.' }), true);
  assert.equal(queueService.isOfflineError({ message: 'The CV has no email address.' }), false);
  assert.equal(queueService.backoffDelay(1, { code: 'AI_LOCAL_UNAVAILABLE' }), 30_000);
  assert.equal(queueService.backoffDelay(2, { code: 'AI_LOCAL_UNAVAILABLE' }), 60_000);
  assert.equal(queueService.backoffDelay(20, { code: 'AI_LOCAL_UNAVAILABLE' }), 300_000);
});

test('worker terminality uses stored real failures rather than BullMQ attemptsMade', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Dorothy Vaughan\\ndorothy@example.com\\nEngineering manager with extensive numerical computing and aerospace experience.'),
      originalname: 'dorothy.txt',
      mimetype: 'text/plain',
      size: 113
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    mode: 'import',
    idempotencyKey: 'retry-budget-attempts-made'
  });
  await queueService.init({
    analyze: async () => {
      throw Object.assign(new Error('local runtime busy'), { code: 'LOCAL_LLM_BUSY' });
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    attemptsMade: 2_000_000_000,
    async updateProgress() {},
    discard() { this.discarded = true; }
  };
  await assert.rejects(() => queueService._processJobForTests(delivery), /local runtime busy/);
  let stored = (await readStore()).cvProcessingJobs.find((item) => (
    item.publicId === submitted.job.publicId
  ));
  assert.equal(stored.state, 'waiting_for_local_runtime');
  assert.equal(stored.attempts, 1);
  assert.equal(stored.failureCount, 0);
  assert.equal(stored.expiresAt, undefined);
  assert.equal(delivery.discarded, undefined);

  await queueService.init({
    analyze: async () => {
      throw Object.assign(new Error('non-runtime analysis failure'), { code: 'CV_ANALYSIS_INVALID' });
    }
  });
  for (let index = 1; index <= 5; index += 1) {
    delivery.attemptsMade = 0;
    await assert.rejects(() => queueService._processJobForTests(delivery), /non-runtime analysis failure/);
    stored = (await readStore()).cvProcessingJobs.find((item) => (
      item.publicId === submitted.job.publicId
    ));
    assert.equal(stored.failureCount, index);
    assert.equal(stored.state, index === 5 ? 'failed' : 'queued');
  }
  assert.equal(delivery.discarded, true);
  assert.equal(stored.expiresAt, undefined);
  assert.equal(stored.queueEventPending, true);
});

test('BullMQ retries keep one logical local usage execution identity', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Annie Easley\nannie@example.com\nComputer scientist with extensive software, energy systems, and aerospace experience.'),
      originalname: 'annie.txt',
      mimetype: 'text/plain',
      size: 108
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    mode: 'import',
    idempotencyKey: 'stable-local-usage-execution-id'
  });
  const contexts = [];
  await queueService.init({
    analyze: async (_text, context) => {
      contexts.push(context);
      throw Object.assign(new Error('local runtime busy'), { code: 'LOCAL_LLM_BUSY' });
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    attemptsMade: 0,
    async updateProgress() {}
  };
  await assert.rejects(() => queueService._processJobForTests(delivery), /local runtime busy/);
  delivery.attemptsMade = 1;
  await assert.rejects(() => queueService._processJobForTests(delivery), /local runtime busy/);
  assert.deepEqual(
    contexts.map((context) => context.usageExecutionId),
    [
      `ai-interview-cv-queue:${submitted.job.publicId}`,
      `ai-interview-cv-queue:${submitted.job.publicId}`
    ]
  );
});

test('full shared capacity preserves durable waiting state without counting an inference attempt', async () => {
  class SyntheticDelayedError extends Error {}
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Katherine Johnson\nkatherine@example.com\nMathematician with extensive orbital mechanics and aerospace systems experience.'),
      originalname: 'katherine.txt',
      mimetype: 'text/plain',
      size: 115
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    mode: 'import',
    idempotencyKey: 'shared-capacity-does-not-count-attempt'
  });
  await queueService.init({
    analyze: async () => {
      throw new Error('inference must not start while shared capacity is full');
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  const runner = queueService._createGlobalDispatchInferenceRunner({
    coordinator: {
      tryAcquire: async () => ({
        acquired: false,
        reason: 'full',
        limit: 1,
        active: 1
      })
    },
    retryDelayMs: 250,
    now: () => 1_000,
    DelayedErrorType: SyntheticDelayedError
  });
  queueService._setDispatchInferenceRunnerForTests(runner);
  const moves = [];
  const delivery = {
    id: submitted.job.publicId,
    data: { processingJobId: submitted.job.publicId },
    async updateProgress() {},
    async moveToDelayed(timestamp, token) {
      moves.push({ timestamp, token });
    }
  };
  try {
    await assert.rejects(
      () => queueService._processJobForTests(delivery, 'worker-token'),
      (error) => error instanceof SyntheticDelayedError
        && error.code === 'CV_GLOBAL_DISPATCH_DEFERRED'
    );
    const stored = (await readStore()).cvProcessingJobs.find((item) => (
      item.publicId === submitted.job.publicId
    ));
    assert.equal(stored.state, 'waiting_for_local_runtime');
    assert.equal(stored.stage, 'analyzing');
    assert.equal(stored.attempts, 0);
    assert.equal(stored.failureCount, 0);
    assert.ok(stored.resumeText);
    assert.deepEqual(moves, [{ timestamp: 1_250, token: 'worker-token' }]);
  } finally {
    queueService._setDispatchInferenceRunnerForTests(null);
  }
});

test('failed durable deletion is retained outside terminal TTL and succeeds on cleanup retry', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Mary Jackson\nmary@example.com\nAerospace engineer with extensive analysis, leadership, and systems experience.'),
      originalname: 'mary.txt',
      mimetype: 'text/plain',
      size: 106
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    mode: 'import',
    idempotencyKey: 'cleanup-retry-outbox'
  });
  await queueService.init({
    analyze: async () => {
      throw Object.assign(new Error('synthetic terminal analysis failure'), {
        code: 'CV_ANALYSIS_INVALID'
      });
    }
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    attemptsMade: 0,
    async updateProgress() {},
    discard() {
      this.discarded = true;
    }
  };
  const originalRemove = durableCvFileStore.remove;
  let deleteAttempts = 0;
  try {
    for (let index = 0; index < 4; index += 1) {
      await assert.rejects(
        () => queueService._processJobForTests(delivery),
        /synthetic terminal analysis failure/
      );
    }
    durableCvFileStore.remove = async () => {
      deleteAttempts += 1;
      throw Object.assign(new Error('synthetic filesystem delete outage'), { code: 'EIO' });
    };
    await assert.rejects(
      () => queueService._processJobForTests(delivery),
      /synthetic terminal analysis failure/
    );

    let store = await readStore();
    let job = store.cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
    let task = store.cvStorageCleanupTasks.find((item) => (
      item.ownerPublicId === submitted.job.publicId
    ));
    assert.equal(job.state, 'failed');
    assert.equal(job.durableFile.cleanupState, 'failed');
    assert.equal(job.expiresAt, undefined);
    assert.equal(task.state, 'failed');
    assert.equal(task.expiresAt, undefined);

    durableCvFileStore.remove = async (reference) => {
      deleteAttempts += 1;
      return originalRemove(reference);
    };
    await mutateStore((current) => {
      const dueAt = new Date(Date.now() - 1_000).toISOString();
      const storedJob = current.cvProcessingJobs.find((item) => (
        item.publicId === submitted.job.publicId
      ));
      const storedTask = current.cvStorageCleanupTasks.find((item) => (
        item.ownerPublicId === submitted.job.publicId
      ));
      storedJob.durableFile.cleanupNextAttemptAt = dueAt;
      storedTask.nextAttemptAt = dueAt;
    });
    await queueService._retryStorageCleanupForTests({ now: new Date() });

    store = await readStore();
    job = store.cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
    task = store.cvStorageCleanupTasks.find((item) => item.ownerPublicId === submitted.job.publicId);
    assert.equal(deleteAttempts, 2);
    assert.equal(job.durableFile.cleanupState, 'deleted');
    assert.ok(job.durableFile.releasedAt);
    assert.equal(job.expiresAt, undefined);
    assert.equal(job.queueEventPending, true);
    assert.equal(task.state, 'completed');
    assert.ok(task.expiresAt);
  } finally {
    durableCvFileStore.remove = originalRemove;
  }
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
    stage: null,
    progress: 10,
    position: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    failedAt: null,
    attempts: 0,
    failureCount: 0,
    candidateId: null,
    error: undefined
  });
  assert.equal('resumeText' in state, false);
  assert.equal('statusTokenHash' in state, false);
});

test('offline submissions persist durable bytes and status-token isolation before dispatch', async () => {
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
  assert.equal(first.job.stage, 'ingesting');
  assert.match(first.job.publicId, /^aicv_/);
  const stored = await readStore();
  const persisted = stored.cvProcessingJobs.find((item) => item.publicId === first.job.publicId);
  assert.ok(persisted.durableFile);
  assert.match((await durableCvFileStore.readBuffer(persisted.durableFile)).toString('utf8'), /Ada Lovelace/);
  assert.equal(persisted.resumeText, undefined);
  assert.equal(persisted.expiresAt, undefined);
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
  assert.equal((await readStore()).cvProcessingJobs.filter((item) => (
    item.organizationId === input.organizationId
    && item.idempotencyKey === input.idempotencyKey
  )).length, 1);
});

test('concurrent submissions with one idempotency key keep one job and one status identity', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Margaret Hamilton\\nmargaret@example.com\\nSoftware engineering leader for safety-critical aerospace systems.'),
      originalname: 'margaret.txt',
      mimetype: 'text/plain',
      size: 108
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_product_owner',
    mode: 'import',
    idempotencyKey: 'concurrent-upload-1'
  };
  const submissions = await Promise.all(
    Array.from({ length: 20 }, () => queueService.submit(input))
  );
  assert.equal(new Set(submissions.map((item) => item.job.publicId)).size, 1);
  assert.equal(new Set(submissions.map((item) => item.statusToken)).size, 1);
  assert.equal(submissions.filter((item) => item.duplicate === false).length, 1);

  const stored = await readStore();
  const matching = stored.cvProcessingJobs.filter((item) => (
    item.organizationId === input.organizationId
    && item.idempotencyKey === input.idempotencyKey
  ));
  assert.equal(matching.length, 1);
  assert.equal(matching[0].expiresAt, undefined);
  assert.match(
    (await durableCvFileStore.readBuffer(matching[0].durableFile)).toString('utf8'),
    /Margaret Hamilton/
  );
});

test('submission returns without waiting for extraction and the worker retries extraction from durable storage', async () => {
  const originalExtractText = cvParsingService.extractText;
  let extractionCalls = 0;
  cvParsingService.extractText = async () => {
    extractionCalls += 1;
    if (extractionCalls === 1) throw Object.assign(new Error('synthetic extraction failure'), { code: 'CV_TEXT_EXTRACTION_FAILED' });
    return 'Katherine Johnson\\nkatherine@example.com\\nSenior engineer with extensive aerospace and numerical systems experience.';
  };
  try {
    const startedAt = Date.now();
    const submitted = await queueService.submit({
      file: {
        buffer: Buffer.from('durable bytes that are intentionally not extracted on the HTTP path'),
        originalname: 'katherine.txt',
        mimetype: 'text/plain',
        size: 68
      },
      organizationId: 'settings',
      actorId: 'user_recruiter',
      jobId: 'job_engineering',
      mode: 'import',
      idempotencyKey: 'worker-extraction-retry'
    });
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(extractionCalls, 0);

    await queueService.init({
      analyze: async (resumeText) => ({
        profile: { name: 'Katherine Johnson', email: 'katherine@example.com' },
        resumeText,
        ai: { model: 'test', analyzedAt: new Date().toISOString() }
      }),
      onCompleted: async (_processingJob, parsed) => ({
        candidate: { _id: 'cand_katherine' },
        profile: parsed.profile
      })
    });
    const firstDelivery = {
      data: { processingJobId: submitted.job.publicId },
      attemptsMade: 0,
      async updateProgress() {},
      discard() { this.discarded = true; }
    };
    await assert.rejects(() => queueService._processJobForTests(firstDelivery), /synthetic extraction failure/);
    let stored = (await readStore()).cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
    assert.equal(stored.state, 'queued');
    assert.equal(stored.stage, 'extracting');

    await queueService._processJobForTests({ ...firstDelivery, attemptsMade: 1 });
    stored = (await readStore()).cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
    assert.equal(stored.state, 'completed');
    assert.equal(stored.stage, 'completed');
    assert.equal(stored.expiresAt, undefined);
    assert.equal(stored.queueEventPending, true);
  } finally {
    cvParsingService.extractText = originalExtractText;
  }
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
    const events = body.jobs || [body.job];
    assert.ok(events.length >= 1 && events.length <= 100);
    assert.ok(events.every((event) => /^aicv_/.test(event.publicId)));
    assert.ok(events.some((event) => event.state === 'queued'));
    assert.equal(events.some((event) => 'resumeText' in event), false);
    assert.equal(events.some((event) => 'originalName' in event), false);
    assert.equal(typeof published.init.headers['x-seemplify-signature'], 'string');
    for (let index = 0; index < 10; index += 1) {
      await queueService.flushQueueEvents();
    }
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.AI_GATEWAY_HMAC_SECRET;
    else process.env.AI_GATEWAY_HMAC_SECRET = originalSecret;
    if (originalGateway === undefined) delete process.env.SEEMPLIFY_AI_GATEWAY_URL;
    else process.env.SEEMPLIFY_AI_GATEWAY_URL = originalGateway;
  }
});
