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
const cvCandidateResults = require('../src/cvCandidateResultRepository');
const { createCvProcessingJobRepository } = require('../src/cvProcessingJobRepository');
const {
  createCvProcessingIntakeRepository
} = require('../src/cvProcessingIntakeRepository');
const { completeCvProcessingJob } = require('../src/server');
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

test('ChatGPT gateway outages remain retryable and receive bounded exponential backoff', () => {
  assert.equal(queueService.isOfflineError({ code: 'CHATGPT_GATEWAY_UNAVAILABLE' }), true);
  assert.equal(queueService.isOfflineError({ code: 'CHATGPT_GATEWAY_BUSY' }), true);
  assert.equal(queueService.isOfflineError({ message: 'Seemplify AI gateway could not be reached before the request deadline.' }), true);
  assert.equal(queueService.isOfflineError({ message: 'The CV has no email address.' }), false);
  assert.equal(queueService.backoffDelay(1, { code: 'CHATGPT_GATEWAY_UNAVAILABLE' }), 30_000);
  assert.equal(queueService.backoffDelay(2, { code: 'CHATGPT_GATEWAY_UNAVAILABLE' }), 60_000);
  assert.equal(queueService.backoffDelay(20, { code: 'CHATGPT_GATEWAY_UNAVAILABLE' }), 300_000);
});

test('retryable service failures enter a deferred retry window after five attempts', () => {
  const transient = { retryable: true, status: 503 };
  assert.equal(queueService.isRetryableProcessingError(transient), true);
  assert.equal(queueService.backoffDelay(4, transient), 240_000);
  assert.equal(queueService.backoffDelay(5, transient), 1_800_000);
  assert.equal(queueService.backoffDelay(10, transient), 3_600_000);
  assert.equal(queueService.isRetryableProcessingError(new Error('invalid document')), false);
});

test('five transient AI Interview CV failures remain durable and are parked for later', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Katherine Johnson\nkatherine@example.com\nSenior mathematician with extensive orbital mechanics experience.'),
      originalname: 'katherine.txt', mimetype: 'text/plain', size: 104
    },
    organizationId: 'org-deferred', actorId: 'user-deferred', jobId: 'job-deferred',
    mode: 'import', idempotencyKey: 'deferred-five-attempts'
  });
  await queueService.init({
    analyze: async () => {
      throw Object.assign(new Error('temporary upstream outage'), {
        code: 'UPSTREAM_UNAVAILABLE', retryable: true, status: 503
      });
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(() => queueService._processJobForTests({
      data: { processingJobId: submitted.job.publicId }, attemptsMade: index,
      async updateProgress() {}, discard() { this.discarded = true; }
    }), /temporary upstream outage/);
  }
  const stored = (await readStore()).cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
  assert.equal(stored.state, 'waiting_for_chatgpt');
  assert.equal(stored.attempts, 5);
  assert.equal(stored.failureCount, 0);
  assert.equal(stored.deferredCycles, 1);
  assert.ok(new Date(stored.nextAttemptAt).getTime() > Date.now());
  assert.equal(stored.expiresAt, undefined);
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
      throw Object.assign(new Error('ChatGPT gateway busy'), { code: 'CHATGPT_GATEWAY_BUSY' });
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    attemptsMade: 2_000_000_000,
    async updateProgress() {},
    discard() { this.discarded = true; }
  };
  await assert.rejects(() => queueService._processJobForTests(delivery), /ChatGPT gateway busy/);
  let stored = (await readStore()).cvProcessingJobs.find((item) => (
    item.publicId === submitted.job.publicId
  ));
  assert.equal(stored.state, 'waiting_for_chatgpt');
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
      throw Object.assign(new Error('ChatGPT gateway busy'), { code: 'CHATGPT_GATEWAY_BUSY' });
    },
    onCompleted: async () => ({ candidate: { _id: 'unused' } })
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    attemptsMade: 0,
    async updateProgress() {}
  };
  await assert.rejects(() => queueService._processJobForTests(delivery), /ChatGPT gateway busy/);
  delivery.attemptsMade = 1;
  await assert.rejects(() => queueService._processJobForTests(delivery), /ChatGPT gateway busy/);
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
    assert.equal(stored.state, 'waiting_for_chatgpt');
    assert.equal(stored.stage, 'analyzing');
    assert.equal(stored.attempts, 0);
    assert.equal(stored.failureCount, 0);
    assert.ok(stored.resumeText);
    assert.deepEqual(moves, [{ timestamp: 1_250, token: 'worker-token' }]);
  } finally {
    queueService._setDispatchInferenceRunnerForTests(null);
  }
});

test('failed durable bytes remain retryable until the bounded retention window then clean up durably', async () => {
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
    assert.equal(job.state, 'failed');
    assert.equal(job.retryable, true);
    assert.ok(new Date(job.retryUntil).getTime() > Date.now());
    assert.equal(job.durableFile.cleanupState, 'retained');
    assert.equal(job.expiresAt, undefined);
    assert.equal(deleteAttempts, 0);
    assert.equal(store.cvStorageCleanupTasks.some((item) => (
      item.ownerPublicId === submitted.job.publicId
    )), false);

    await mutateStore((current) => {
      const storedJob = current.cvProcessingJobs.find((item) => (
        item.publicId === submitted.job.publicId
      ));
      storedJob.retryUntil = new Date(Date.now() - 1_000).toISOString();
    });
    await queueService._retryStorageCleanupForTests({ now: new Date() });
    store = await readStore();
    job = store.cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
    let task = store.cvStorageCleanupTasks.find((item) => (
      item.ownerPublicId === submitted.job.publicId
    ));
    assert.equal(job.durableFile.cleanupState, 'failed');
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
      storedJob.retryUntil = dueAt;
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

test('standalone CV worker concurrency cannot exceed the hosted ChatGPT limit', async () => {
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
  assert.equal(state.jobId, 'aicv_test');
  assert.equal(state.state, 'queued');
  assert.equal(state.progress, 10);
  assert.equal(state.retryable, false);
  assert.equal('resumeText' in state, false);
  assert.equal('statusTokenHash' in state, false);
});

test('CV submission rejects a missing or blank idempotency key before durable storage', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Idempotency Required\nrequired@example.com\nExperienced engineer.'),
      originalname: 'required.txt',
      mimetype: 'text/plain',
      size: 65
    },
    organizationId: 'org-idempotency-required',
    actorId: 'actor-idempotency-required',
    jobId: 'job-idempotency-required',
    mode: 'import'
  };
  const before = await readStore();
  for (const idempotencyKey of [undefined, '', '   ']) {
    await assert.rejects(
      () => queueService.submit({ ...input, idempotencyKey }),
      (error) => error?.statusCode === 400 && error?.code === 'CV_IDEMPOTENCY_KEY_REQUIRED'
    );
  }
  const after = await readStore();
  assert.equal(after.cvProcessingJobs.length, before.cvProcessingJobs.length);
  assert.equal(
    (after.cvProcessingIntakes || []).length,
    (before.cvProcessingIntakes || []).length
  );
});

test('restart recovery paginates past 500 present deliveries to requeue a later missing job', async () => {
  const createdAt = '2026-07-20T00:00:00.000Z';
  const recoveryJobs = Array.from({ length: 501 }, (_value, index) => ({
    _id: `cvjob_recovery_${String(index).padStart(3, '0')}`,
    publicId: `aicv_recovery_${String(index).padStart(3, '0')}`,
    state: 'queued',
    stage: 'ingesting',
    progress: 5,
    organizationId: 'org-recovery-pagination',
    actorId: 'actor-recovery-pagination',
    jobId: 'job-recovery-pagination',
    createdAt,
    updatedAt: createdAt
  }));
  const baseRepository = createCvProcessingJobRepository({
    useMongo: false,
    read: async () => ({ cvProcessingJobs: recoveryJobs })
  });
  const cursors = [];
  const recoveryRepository = {
    ...baseRepository,
    async findRecoverable(staleBefore, limit, options) {
      cursors.push(options?.after || null);
      return baseRepository.findRecoverable(staleBefore, limit, options);
    }
  };
  const present = new Set(recoveryJobs.slice(0, 500).map((job) => job.publicId));
  const enqueued = [];
  const recovered = await queueService._recoverStaleJobsForTests({
    queueInstance: {
      async getJob(deliveryId) {
        return present.has(deliveryId) ? { id: deliveryId } : null;
      }
    },
    repository: recoveryRepository,
    enqueue: async (job) => { enqueued.push(job.publicId); },
    staleBefore: new Date('2026-07-20T00:02:00.000Z'),
    batchSize: 500
  });

  assert.equal(recovered, 1);
  assert.deepEqual(enqueued, ['aicv_recovery_500']);
  assert.equal(cursors.length, 2);
  assert.deepEqual(cursors[1], {
    createdAt,
    publicId: 'aicv_recovery_499'
  });
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

test('lost acceptance is recovered from actor history and exact replay keeps one descriptor', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Mae Jemison\nmae@example.com\nPhysician and engineer with extensive science and leadership experience.'),
      originalname: 'mae.txt',
      mimetype: 'text/plain',
      size: 101
    },
    organizationId: 'org-lost-acceptance',
    actorId: 'actor-lost-acceptance',
    jobId: 'job-science',
    mode: 'import',
    idempotencyKey: 'stable-browser-upload'
  };
  const acceptedButLost = await queueService.submit(input);
  const restored = await queueService.listActorJobs(
    input.organizationId,
    input.actorId,
    { states: ['queued'] }
  );
  assert.equal(restored.length, 1);
  assert.equal(restored[0].jobId, acceptedButLost.job.publicId);
  assert.equal(restored[0].statusToken, acceptedButLost.statusToken);
  assert.equal(restored[0].requestFingerprint, acceptedButLost.job.requestFingerprint);

  const replay = await queueService.submit(input);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.job.publicId, restored[0].jobId);
  assert.equal(replay.statusToken, restored[0].statusToken);
  assert.equal((await queueService.listActorJobs(input.organizationId, input.actorId)).length, 1);
});

test('idempotency is actor scoped and binds the complete CV request fingerprint', async () => {
  const base = {
    file: {
      buffer: Buffer.from('Sally Ride\nsally@example.com\nEngineer and astronaut with extensive mission and research experience.'),
      originalname: 'sally.txt',
      mimetype: 'text/plain',
      size: 98
    },
    organizationId: 'org-actor-scope',
    jobId: 'job-space',
    mode: 'import',
    idempotencyKey: 'shared-browser-key'
  };
  const first = await queueService.submit({ ...base, actorId: 'actor-one' });
  const second = await queueService.submit({ ...base, actorId: 'actor-two' });
  assert.notEqual(first.job.publicId, second.job.publicId);
  assert.notEqual(first.statusToken, second.statusToken);
  assert.equal((await queueService.listActorJobs(base.organizationId, 'actor-one')).length, 1);
  assert.equal((await queueService.listActorJobs(base.organizationId, 'actor-two')).length, 1);
  assert.equal(await queueService.getActorStatus(
    first.job.publicId,
    base.organizationId,
    'actor-two'
  ), null);
  assert.equal(await queueService.getActorHistory(
    first.job.publicId,
    base.organizationId,
    'actor-two'
  ), null);
  assert.equal(await queueService.retry(
    first.job.publicId,
    base.organizationId,
    'actor-two'
  ), null);

  await assert.rejects(
    () => queueService.submit({
      ...base,
      actorId: 'actor-one',
      file: {
        ...base.file,
        buffer: Buffer.from(`${base.file.buffer.toString()} changed`),
        size: base.file.size + 8
      }
    }),
    (error) => error?.statusCode === 409 && error?.code === 'CV_IDEMPOTENCY_CONFLICT'
  );
});

test('a listed terminal failure retries from retained bytes and completes only once', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Ellen Ochoa\nellen@example.com\nEngineer and research leader with extensive optical systems experience.'),
      originalname: 'ellen.txt',
      mimetype: 'text/plain',
      size: 103
    },
    organizationId: 'org-manual-retry',
    actorId: 'actor-manual-retry',
    jobId: 'job-optics',
    mode: 'import',
    idempotencyKey: 'retry-once'
  };
  const submitted = await queueService.submit(input);
  await queueService.init({
    analyze: async () => {
      throw Object.assign(new Error('invalid analysis'), { code: 'CV_ANALYSIS_INVALID' });
    },
    onCompleted: async () => ({ candidate: { _id: submitted.job.candidateId } })
  });
  const delivery = {
    data: { processingJobId: submitted.job.publicId },
    async updateProgress() {},
    discard() { this.discarded = true; }
  };
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(() => queueService._processJobForTests(delivery), /invalid analysis/);
  }
  const [failed] = await queueService.listActorJobs(input.organizationId, input.actorId, {
    states: ['failed']
  });
  assert.equal(failed.retryable, true);

  let completions = 0;
  await queueService.init({
    analyze: async (resumeText) => ({
      profile: { name: 'Ellen Ochoa', email: 'ellen@example.com' },
      resumeText,
      ai: { model: 'test' }
    }),
    onCompleted: async () => {
      completions += 1;
      return { candidate: { _id: submitted.job.candidateId } };
    }
  });
  const retried = await queueService.retry(
    submitted.job.publicId,
    input.organizationId,
    input.actorId
  );
  assert.equal(retried.state, 'queued');
  await queueService._processJobForTests(delivery);
  const replayedRetry = await queueService.retry(
    submitted.job.publicId,
    input.organizationId,
    input.actorId
  );
  assert.equal(replayedRetry.state, 'completed');
  assert.equal(replayedRetry.duplicateRetry, true);
  assert.equal(completions, 1);
});

test('candidate deletion during inference cancels the lease, removes bytes, and prevents profile commit', async () => {
  const candidateId = 'cand_delete_during_ai';
  await mutateStore((store) => {
    store.candidates.push({
      _id: candidateId,
      name: 'Delete During AI',
      email: 'delete-during@example.com',
      jobId: 'job_product_owner',
      createdBy: 'user_recruiter'
    });
  });
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Delete During AI\ndelete-during@example.com\nExperienced product leader with extensive systems delivery experience.'),
      originalname: 'delete-during-ai.txt',
      mimetype: 'text/plain',
      size: 112
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_product_owner',
    candidateId,
    mode: 'enrich',
    idempotencyKey: 'delete-during-ai'
  });
  const durableReference = structuredClone(submitted.job.durableFile);
  let releaseInference;
  let inferenceStarted;
  const started = new Promise((resolve) => { inferenceStarted = resolve; });
  const inference = new Promise((resolve) => { releaseInference = resolve; });
  await queueService.init({
    analyze: async (resumeText) => {
      inferenceStarted();
      await inference;
      return {
        profile: { name: 'Should Not Survive', email: 'delete-during@example.com' },
        resumeText,
        ai: { model: 'test', privateSummary: 'must be redacted' }
      };
    },
    onCompleted: completeCvProcessingJob
  });
  const processing = queueService._processJobForTests({
    data: { processingJobId: submitted.job.publicId },
    async updateProgress() {}
  });
  await started;

  const deletion = await cvCandidateResults.beginCandidateDeletion(candidateId, {
    actorId: 'user_recruiter'
  });
  assert.ok(deletion);
  await queueService.cancelForCandidate('settings', candidateId);
  assert.equal(await cvCandidateResults.finishCandidateDeletion(
    candidateId,
    deletion.deletionToken
  ), true);
  releaseInference();
  assert.deepEqual(await processing, { skipped: true });

  const store = await readStore();
  assert.equal(store.candidates.some((candidate) => candidate._id === candidateId), false);
  const job = store.cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
  assert.equal(job.state, 'cancelled');
  assert.equal(job.originalName, undefined);
  assert.equal(job.resumeText, undefined);
  assert.equal(job.result, undefined);
  assert.equal(job.lastError, undefined);
  assert.equal(job.durableFile.cleanupState, 'deleted');
  assert.equal(job.durableFile.storageKey, undefined);
  await assert.rejects(
    () => durableCvFileStore.readBuffer(durableReference),
    (error) => error?.code === 'CV_DURABLE_FILE_MISSING'
  );
});

test('completed candidate deletion persists cleanup and PII redaction across repository restart', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Joan Clarke\njoan@example.com\nCryptanalyst and engineering leader with extensive security experience.'),
      originalname: 'joan-private-name.txt',
      mimetype: 'text/plain',
      size: 99
    },
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_product_owner',
    mode: 'import',
    idempotencyKey: 'completed-delete-redaction'
  });
  await queueService.init({
    analyze: async (resumeText) => ({
      profile: {
        name: 'Joan Clarke',
        email: 'joan@example.com',
        summary: 'private candidate summary'
      },
      resumeText,
      ai: { model: 'test', rationale: 'private model result' }
    }),
    onCompleted: completeCvProcessingJob
  });
  await queueService._processJobForTests({
    data: { processingJobId: submitted.job.publicId },
    async updateProgress() {}
  });
  const completed = await queueService.getActorStatus(
    submitted.job.publicId,
    'settings',
    'user_recruiter'
  );
  assert.equal(completed.state, 'completed');

  const deletion = await cvCandidateResults.beginCandidateDeletion(completed.candidateId, {
    actorId: 'user_recruiter'
  });
  await queueService.cancelForCandidate('settings', completed.candidateId);
  assert.equal(await cvCandidateResults.finishCandidateDeletion(
    completed.candidateId,
    deletion.deletionToken
  ), true);

  const restartedRepository = createCvProcessingJobRepository({ useMongo: false });
  const persisted = await restartedRepository.findByPublicId(submitted.job.publicId);
  assert.equal(persisted.state, 'completed');
  assert.equal(persisted.originalName, undefined);
  assert.equal(persisted.resumeText, undefined);
  assert.equal(persisted.result, undefined);
  assert.equal(persisted.lastError, undefined);
  assert.equal(persisted.durableFile.fileId, undefined);
  assert.equal(persisted.durableFile.storageKey, undefined);
  assert.ok(persisted.redactedAt);
  assert.equal((await readStore()).candidates.some((candidate) => (
    candidate._id === completed.candidateId
  )), false);
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
  const originalPersist = durableCvFileStore.persistBuffer;
  let persistenceOwners = 0;
  durableCvFileStore.persistBuffer = async (...args) => {
    persistenceOwners += 1;
    return originalPersist(...args);
  };
  let submissions;
  try {
    submissions = await Promise.all(
      Array.from({ length: 20 }, () => queueService.submit(input))
    );
  } finally {
    durableCvFileStore.persistBuffer = originalPersist;
  }
  assert.equal(new Set(submissions.map((item) => item.job.publicId)).size, 1);
  assert.equal(new Set(submissions.map((item) => item.statusToken)).size, 1);
  assert.equal(submissions.filter((item) => item.duplicate === false).length, 1);
  assert.equal(persistenceOwners, 1);

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

test('restart cleanup reclaims an intake interrupted after durable persist and before job creation', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Orphaned Intake\norphaned-intake@example.com\nPrivate CV bytes that must be reclaimed after a crash.'),
      originalname: 'orphaned-intake-private.txt',
      mimetype: 'text/plain',
      size: 99
    },
    organizationId: 'org-orphaned-intake',
    actorId: 'actor-orphaned-intake',
    jobId: 'job-orphaned-intake',
    mode: 'import',
    idempotencyKey: 'crash-after-durable-persist'
  };
  queueService._setAfterDurablePersistForTests(async () => {
    const error = new Error('simulated process exit after durable persist');
    error.code = 'SIMULATED_PROCESS_EXIT';
    throw error;
  });
  try {
    await assert.rejects(
      () => queueService.submit(input),
      (error) => error?.code === 'SIMULATED_PROCESS_EXIT'
    );
  } finally {
    queueService._setAfterDurablePersistForTests(null);
  }

  let store = await readStore();
  const interrupted = (store.cvProcessingIntakes || []).find((item) => (
    item.idempotencyKey === input.idempotencyKey
  ));
  assert.equal(interrupted.state, 'persisted');
  assert.equal(store.cvProcessingJobs.some((item) => (
    item.idempotencyKey === input.idempotencyKey
  )), false);
  assert.match(
    (await durableCvFileStore.readBuffer(interrupted.durableFile)).toString('utf8'),
    /Private CV bytes/
  );

  const restartedJobs = createCvProcessingJobRepository({ useMongo: false });
  const restartedIntakes = createCvProcessingIntakeRepository({ useMongo: false });
  const recovery = await queueService._recoverOrphanedStorageForTests({
    now: new Date(Date.now() + 60_000),
    graceMs: 0,
    repository: restartedJobs,
    intakeRepository: restartedIntakes
  });
  assert.equal(recovery.abandonedIntakes, 1);
  await assert.rejects(
    () => durableCvFileStore.readBuffer(interrupted.durableFile),
    (error) => error?.code === 'CV_DURABLE_FILE_MISSING'
  );
  store = await readStore();
  assert.equal((store.cvProcessingIntakes || []).find((item) => (
    item.intakeId === interrupted.intakeId
  )).state, 'cleaned');
});

test('a failed storage owner cleans and rotates its binding before same-key retry', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Storage Retry\nstorage-retry@example.com\nPrivate bytes for a storage retry.'),
      originalname: 'storage-retry.txt',
      mimetype: 'text/plain',
      size: 75
    },
    organizationId: 'org-storage-retry',
    actorId: 'actor-storage-retry',
    jobId: 'job-storage-retry',
    mode: 'import',
    idempotencyKey: 'storage-owner-binding-rotation'
  };
  const originalPersist = durableCvFileStore.persistBuffer;
  durableCvFileStore.persistBuffer = async (...args) => {
    await originalPersist(...args);
    throw Object.assign(new Error('synthetic post-write storage failure'), { code: 'EIO' });
  };
  try {
    await assert.rejects(() => queueService.submit(input), /synthetic post-write storage failure/);
  } finally {
    durableCvFileStore.persistBuffer = originalPersist;
  }
  let store = await readStore();
  const failedIntake = (store.cvProcessingIntakes || []).find((item) => (
    item.idempotencyKey === input.idempotencyKey
  ));
  const failedReference = structuredClone(failedIntake.durableFile);
  assert.equal(failedIntake.state, 'cleaned');
  await assert.rejects(
    () => durableCvFileStore.readBuffer(failedReference),
    (error) => error?.code === 'CV_DURABLE_FILE_MISSING'
  );

  const retry = await queueService.submit(input);
  assert.notEqual(
    durableCvFileStore.referenceKey(retry.job.durableFile),
    durableCvFileStore.referenceKey(failedReference)
  );
  store = await readStore();
  assert.equal(store.cvProcessingJobs.filter((item) => (
    item.idempotencyKey === input.idempotencyKey
  )).length, 1);
  assert.match(
    (await durableCvFileStore.readBuffer(retry.job.durableFile)).toString(),
    /Storage Retry/
  );
});

test('cleanup claim racing a paused submit cannot commit a job that references deleted bytes', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Cleanup Race\ncleanup-race@example.com\nPrivate bytes protected by the intake binding CAS.'),
      originalname: 'cleanup-race-private.txt',
      mimetype: 'text/plain',
      size: 86
    },
    organizationId: 'org-cleanup-race',
    actorId: 'actor-cleanup-race',
    jobId: 'job-cleanup-race',
    mode: 'import',
    idempotencyKey: 'cleanup-race-binding-cas'
  };
  let releaseSubmit;
  let persisted;
  const submitPaused = new Promise((resolve) => { persisted = resolve; });
  const resumeSubmit = new Promise((resolve) => { releaseSubmit = resolve; });
  let paused = false;
  queueService._setAfterDurablePersistForTests(async () => {
    if (paused) return;
    paused = true;
    persisted();
    await resumeSubmit;
  });
  const submission = queueService.submit(input);
  await submitPaused;

  const recovery = await queueService._recoverOrphanedStorageForTests({
    now: new Date(Date.now() + 60_000),
    graceMs: 0
  });
  assert.equal(recovery.abandonedIntakes, 1);
  releaseSubmit();
  try {
    await assert.rejects(
      submission,
      (error) => ['CV_INTAKE_RESERVATION_LOST', 'CV_INTAKE_BINDING_LOST'].includes(error?.code)
    );
  } finally {
    queueService._setAfterDurablePersistForTests(null);
  }

  let store = await readStore();
  assert.equal(store.cvProcessingJobs.some((item) => (
    item.idempotencyKey === input.idempotencyKey
  )), false);
  const reclaimed = (store.cvProcessingIntakes || []).find((item) => (
    item.idempotencyKey === input.idempotencyKey
  ));
  await assert.rejects(
    () => durableCvFileStore.readBuffer(reclaimed.durableFile),
    (error) => error?.code === 'CV_DURABLE_FILE_MISSING'
  );

  // The same request can safely rearm the cleaned receipt with a new planned
  // reference; no new logical job identity is minted.
  const replay = await queueService.submit(input);
  assert.equal(replay.job.publicId, reclaimed.publicId);
  store = await readStore();
  assert.equal(store.cvProcessingJobs.filter((item) => (
    item.idempotencyKey === input.idempotencyKey
  )).length, 1);
  assert.match(
    (await durableCvFileStore.readBuffer(replay.job.durableFile)).toString(),
    /Cleanup Race/
  );
});

test('restart recovery finalizes a persisted binding lease instead of orphaning its bytes', async () => {
  const bytes = Buffer.from(
    'Binding Recovery\nbinding-recovery@example.com\nDurable bytes committed before the process stopped.'
  );
  const organizationId = 'org-binding-recovery';
  const actorId = 'actor-binding-recovery';
  const idempotencyKey = 'binding-restart-finalization';
  const publicId = 'aicv_binding_restart_finalization';
  const jobId = 'job-binding-recovery';
  const fingerprint = queueService.requestFingerprint({
    mode: 'import',
    jobId,
    fileSha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  });
  const statusToken = queueService.deterministicStatusToken(
    organizationId,
    actorId,
    idempotencyKey
  );
  const intakeRepository = createCvProcessingIntakeRepository({ useMongo: false });
  const planned = durableCvFileStore.planReference(bytes);
  const { intake } = await intakeRepository.reserve({
    organizationId,
    actorId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    publicId,
    statusTokenHash: queueService.tokenHash(statusToken),
    jobId,
    candidateId: 'cand_binding_restart_finalization',
    mode: 'import',
    originalName: 'binding-recovery.txt',
    mimeType: 'text/plain',
    fileSize: bytes.length,
    durableFile: planned
  });
  const storageClaim = await intakeRepository.claimStorage(intake.intakeId, intake.durableFile);
  const durableFile = await durableCvFileStore.persistBuffer(bytes, {
    originalName: 'binding-recovery.txt',
    mimeType: 'text/plain',
    organizationId,
    actorId,
    intakeId: intake.intakeId
  }, { reference: storageClaim.durableFile });
  await intakeRepository.markPersisted(
    intake.intakeId,
    durableFile,
    storageClaim.storageToken,
    durableFile.persistedAt
  );
  const binding = await intakeRepository.claimBinding(intake.intakeId, durableFile);
  assert.equal(binding.state, 'binding');

  const recovery = await queueService._recoverOrphanedStorageForTests({
    intakeRepository,
    repository: createCvProcessingJobRepository({ useMongo: false })
  });
  assert.equal(recovery.bindingRecovered, 1);
  const store = await readStore();
  const job = store.cvProcessingJobs.find((item) => item.publicId === publicId);
  assert.equal(job.state, 'queued');
  assert.deepEqual(await durableCvFileStore.readBuffer(job.durableFile), bytes);
  assert.equal((store.cvProcessingIntakes || []).find((item) => (
    item.intakeId === intake.intakeId
  )).state, 'bound');
});

test('exact idempotent replay reuses one bound file without leaking another copy', async () => {
  const input = {
    file: {
      buffer: Buffer.from('Replay Safe\nreplay-safe@example.com\nExperienced privacy and reliability engineer.'),
      originalname: 'replay-safe.txt',
      mimetype: 'text/plain',
      size: 79
    },
    organizationId: 'org-replay-file',
    actorId: 'actor-replay-file',
    jobId: 'job-replay-file',
    mode: 'import',
    idempotencyKey: 'exact-replay-one-file'
  };
  const storageDirectory = path.join(testDirectory, 'cv-files');
  const before = (await fs.promises.readdir(storageDirectory)).filter((name) => name.endsWith('.cv'));
  const first = await queueService.submit(input);
  const afterFirst = (await fs.promises.readdir(storageDirectory)).filter((name) => name.endsWith('.cv'));
  const replay = await queueService.submit(input);
  const afterReplay = (await fs.promises.readdir(storageDirectory)).filter((name) => name.endsWith('.cv'));

  assert.equal(replay.duplicate, true);
  assert.equal(replay.job.publicId, first.job.publicId);
  assert.deepEqual(replay.job.durableFile, first.job.durableFile);
  assert.equal(afterFirst.length, before.length + 1);
  assert.equal(afterReplay.length, afterFirst.length);
  const store = await readStore();
  assert.equal((store.cvProcessingIntakes || []).filter((item) => (
    item.organizationId === input.organizationId
    && item.actorId === input.actorId
    && item.idempotencyKey === input.idempotencyKey
  )).length, 1);
});

test('orphan sweep retains queued and failed-retry files while deleting an unreferenced file', async () => {
  const queued = await queueService.submit({
    file: {
      buffer: Buffer.from('Queued Retention\nqueued-retention@example.com\nExperienced operations leader.'),
      originalname: 'queued-retention.txt',
      mimetype: 'text/plain',
      size: 77
    },
    organizationId: 'org-orphan-retention',
    actorId: 'actor-orphan-retention',
    jobId: 'job-orphan-retention',
    mode: 'import',
    idempotencyKey: 'queued-reference-retained'
  });
  const failed = await queueService.submit({
    file: {
      buffer: Buffer.from('Retry Retention\nretry-retention@example.com\nExperienced platform engineer.'),
      originalname: 'retry-retention.txt',
      mimetype: 'text/plain',
      size: 76
    },
    organizationId: 'org-orphan-retention',
    actorId: 'actor-orphan-retention',
    jobId: 'job-orphan-retention',
    mode: 'import',
    idempotencyKey: 'failed-retry-reference-retained'
  });
  const repository = createCvProcessingJobRepository({ useMongo: false });
  for (let index = 0; index < 5; index += 1) {
    await repository.recordFailure(
      failed.job.publicId,
      Object.assign(new Error('synthetic terminal parse failure'), {
        code: 'CV_ANALYSIS_INVALID'
      })
    );
  }
  const failedJob = await repository.findByPublicId(failed.job.publicId);
  assert.equal(failedJob.state, 'failed');
  assert.equal(failedJob.retryable, true);

  const orphan = await durableCvFileStore.persistBuffer(
    Buffer.from('unreferenced private CV bytes'),
    { originalName: 'legacy-orphan.txt', mimeType: 'text/plain' }
  );
  const recovery = await queueService._recoverOrphanedStorageForTests({
    now: new Date(Date.now() + 60_000),
    graceMs: 0
  });
  assert.ok(recovery.legacyOrphans >= 1);
  assert.match((await durableCvFileStore.readBuffer(queued.job.durableFile)).toString(), /Queued/);
  assert.match((await durableCvFileStore.readBuffer(failed.job.durableFile)).toString(), /Retry/);
  await assert.rejects(
    () => durableCvFileStore.readBuffer(orphan),
    (error) => error?.code === 'CV_DURABLE_FILE_MISSING'
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
