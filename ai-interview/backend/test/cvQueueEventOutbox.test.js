const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = 'false';

const {
  createCvProcessingJobRepository
} = require('../src/cvProcessingJobRepository');
const {
  _deliverQueueEventBatchForTests: deliverQueueEventBatch,
  _queuedOperationalEventsForTests: queuedOperationalEvents,
  _startQueueEventPublisherForTests: startQueueEventPublisher,
  closeForTests
} = require('../src/cvProcessingQueueService');

function createMemoryStore() {
  const state = { cvProcessingJobs: [] };
  return {
    state,
    async read() {
      return structuredClone(state);
    },
    async mutate(operation) {
      return operation(state);
    }
  };
}

function jobInput(publicId, createdAt) {
  return {
    _id: `cvjob_${publicId}`,
    publicId,
    statusTokenHash: `hash_${publicId}`,
    state: 'queued',
    stage: 'ingesting',
    progress: 5,
    attempts: 0,
    failureCount: 0,
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    mode: 'import',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString()
  };
}

test('queue-event publisher starts and repairs persisted history without Redis', async () => {
  let repairs = 0;
  let flushes = 0;
  let heartbeat;
  let heartbeatDelay;
  const scheduled = [];
  await startQueueEventPublisher({
    repository: {
      async repairQueueEventOutbox(limit) {
        assert.equal(limit, 500);
        repairs += 1;
      }
    },
    schedule: (delay) => scheduled.push(delay),
    flush: async () => { flushes += 1; },
    setIntervalImpl: (callback, delay) => {
      heartbeat = callback;
      heartbeatDelay = delay;
      return setInterval(() => {}, 60_000);
    }
  });
  assert.equal(repairs, 1);
  assert.deepEqual(scheduled, [0]);
  assert.equal(heartbeatDelay, 5_000);
  heartbeat();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flushes, 1);
  await closeForTests();
});

test('durable queue-event outbox survives restart, bounds batches, retries, and duplicate acknowledgements', async () => {
  const memory = createMemoryStore();
  let clock = new Date('2026-07-24T12:00:00.000Z');
  const dependencies = {
    useMongo: false,
    read: memory.read,
    mutate: memory.mutate,
    now: () => new Date(clock)
  };
  const firstProcess = createCvProcessingJobRepository(dependencies);
  const created = await firstProcess.createOrGet(jobInput('aicv_outbox_restart', clock));
  for (let index = 1; index <= 150; index += 1) {
    clock = new Date(clock.getTime() + 1_000);
    await firstProcess.updateStage(
      created.job.publicId,
      index % 2 ? 'extracting' : 'analyzing',
      10 + (index % 80)
    );
  }

  const persisted = memory.state.cvProcessingJobs[0];
  assert.equal(persisted.transitions.length, 100);
  assert.equal(persisted.queueEventOutbox.length, 151);
  assert.equal(persisted.queueEventPending, true);

  const restartedProcess = createCvProcessingJobRepository(dependencies);
  let batch = await restartedProcess.listPendingQueueEventJobs({
    at: clock,
    jobLimit: 1,
    eventLimit: 25
  });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].queueEventOutbox.length, 25);
  assert.deepEqual(
    batch[0].queueEventOutbox.map((event) => event.sequence),
    Array.from({ length: 25 }, (_value, index) => index)
  );

  await restartedProcess.acknowledgeQueueEvents(created.job.publicId, 24);
  const afterFirstAck = await restartedProcess.findByPublicId(created.job.publicId);
  assert.equal(afterFirstAck.queueEventOutbox.length, 126);
  await restartedProcess.acknowledgeQueueEvents(created.job.publicId, 24);
  const afterDuplicateAck = await restartedProcess.findByPublicId(created.job.publicId);
  assert.equal(afterDuplicateAck.queueEventOutbox.length, 126);
  assert.equal(afterDuplicateAck.queueEventLastAckSequence, 24);

  const retryAt = new Date(clock.getTime() + 60_000);
  await restartedProcess.deferQueueEventJobs(
    [created.job.publicId],
    new Error('synthetic recruiter outage'),
    retryAt
  );
  assert.equal((await restartedProcess.listPendingQueueEventJobs({
    at: clock,
    jobLimit: 1,
    eventLimit: 25
  })).length, 0);
  clock = retryAt;
  batch = await restartedProcess.listPendingQueueEventJobs({
    at: clock,
    jobLimit: 1,
    eventLimit: 25
  });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].queueEventFailureCount, 1);

  while (batch.length) {
    const events = batch[0].queueEventOutbox;
    await restartedProcess.acknowledgeQueueEvents(
      created.job.publicId,
      events.at(-1).sequence
    );
    batch = await restartedProcess.listPendingQueueEventJobs({
      at: clock,
      jobLimit: 1,
      eventLimit: 25
    });
  }
  const delivered = await restartedProcess.findByPublicId(created.job.publicId);
  assert.equal(delivered.queueEventOutbox.length, 0);
  assert.equal(delivered.queueEventPending, false);
  assert.equal(delivered.queueEventLastAckSequence, 150);
});

test('event construction has a strict global batch bound and omits CV contents', () => {
  const jobs = Array.from({ length: 50 }, (_value, jobIndex) => ({
    publicId: `aicv_high_volume_${jobIndex}`,
    state: 'processing',
    organizationId: `org_${jobIndex}`,
    actorId: `actor_${jobIndex}`,
    jobId: `job_${jobIndex}`,
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:01:00.000Z',
    originalName: `private-${jobIndex}.pdf`,
    resumeText: `private CV text ${jobIndex}`,
    queueEventOutbox: Array.from({ length: 10 }, (_unused, sequence) => ({
      eventKey: `${jobIndex}:${sequence}`,
      state: 'processing',
      stage: 'analyzing',
      progress: sequence,
      attempts: 1,
      failureCount: 0,
      at: '2026-07-24T12:01:00.000Z',
      sequence,
      errorCode: null
    }))
  }));
  const events = queuedOperationalEvents(jobs, 100);
  assert.equal(events.length, 100);
  assert.equal(new Set(events.map((event) => event.publicId)).size, 10);
  assert.equal(events.some((event) => 'resumeText' in event), false);
  assert.equal(events.some((event) => 'originalName' in event), false);
});

test('startup repair converts pre-outbox transitions without leaving a terminal TTL race', async () => {
  const memory = createMemoryStore();
  const at = new Date('2026-07-24T12:00:00.000Z');
  memory.state.cvProcessingJobs.push({
    ...jobInput('aicv_pre_outbox', at),
    state: 'completed',
    stage: 'completed',
    progress: 100,
    revision: 2,
    completedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 60_000).toISOString(),
    transitions: [0, 1, 2].map((sequence) => ({
      eventKey: `legacy:${sequence}`,
      state: sequence === 2 ? 'completed' : sequence === 1 ? 'processing' : 'queued',
      stage: sequence === 2 ? 'completed' : sequence === 1 ? 'analyzing' : 'ingesting',
      progress: sequence === 2 ? 100 : sequence === 1 ? 50 : 5,
      attempts: sequence > 0 ? 1 : 0,
      failureCount: 0,
      at: new Date(at.getTime() + sequence * 1_000).toISOString(),
      sequence,
      errorCode: null
    }))
  });
  const repository = createCvProcessingJobRepository({
    useMongo: false,
    read: memory.read,
    mutate: memory.mutate,
    now: () => at
  });
  assert.equal(await repository.repairQueueEventOutbox(1), 1);
  const repaired = await repository.findByPublicId('aicv_pre_outbox');
  assert.equal(repaired.queueEventInitialized, true);
  assert.equal(repaired.queueEventPending, true);
  assert.deepEqual(repaired.queueEventOutbox.map((event) => event.sequence), [0, 1, 2]);
  assert.equal(repaired.expiresAt, undefined);
});

test('publisher retains events through an outage and acknowledges them after recovery', async () => {
  const memory = createMemoryStore();
  let clockMs = new Date('2026-07-24T12:00:00.000Z').getTime();
  const dependencies = {
    useMongo: false,
    read: memory.read,
    mutate: memory.mutate,
    now: () => new Date(clockMs)
  };
  const firstProcess = createCvProcessingJobRepository(dependencies);
  const created = await firstProcess.createOrGet(
    jobInput('aicv_publisher_recovery', new Date(clockMs))
  );
  const scheduled = [];
  assert.equal(await deliverQueueEventBatch({
    repository: firstProcess,
    fetchImpl: async () => {
      throw new Error('synthetic network outage');
    },
    secret: 'publisher-test-secret',
    url: 'https://api.example.test/api/internal/ai/v1/cv-queue/events',
    now: () => clockMs,
    schedule: (delay) => scheduled.push(delay)
  }), false);

  let pending = await firstProcess.findByPublicId(created.job.publicId);
  assert.equal(pending.queueEventPending, true);
  assert.equal(pending.queueEventOutbox.length, 1);
  assert.equal(pending.queueEventFailureCount, 1);
  assert.deepEqual(scheduled, [1_000]);

  clockMs += scheduled[0];
  const restartedProcess = createCvProcessingJobRepository(dependencies);
  let request;
  assert.equal(await deliverQueueEventBatch({
    repository: restartedProcess,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200 };
    },
    secret: 'publisher-test-secret',
    url: 'https://api.example.test/api/internal/ai/v1/cv-queue/events',
    now: () => clockMs,
    schedule: () => {}
  }), true);
  assert.match(request.url, /\/api\/internal\/ai\/v1\/cv-queue\/events$/);
  assert.equal(typeof request.init.headers['x-seemplify-signature'], 'string');
  const event = JSON.parse(request.init.body).job;
  assert.equal(event.publicId, created.job.publicId);
  assert.equal('resumeText' in event, false);

  pending = await restartedProcess.findByPublicId(created.job.publicId);
  assert.equal(pending.queueEventPending, false);
  assert.equal(pending.queueEventOutbox.length, 0);
  assert.equal(pending.queueEventLastAckSequence, 0);
});

test('Mongo pending-event query is index-shaped, projected, and bounded before materialization', async () => {
  const calls = [];
  const cursor = {
    sort(value) {
      calls.push({ method: 'sort', value });
      return this;
    },
    limit(value) {
      calls.push({ method: 'limit', value });
      return this;
    },
    async toArray() {
      return [];
    }
  };
  const collection = {
    async createIndexes(indexes) {
      calls.push({ method: 'createIndexes', indexes });
    },
    find(filter, options) {
      calls.push({ method: 'find', filter, options });
      return cursor;
    }
  };
  const repository = createCvProcessingJobRepository({
    useMongo: true,
    getDb: async () => ({ collection: () => collection }),
    now: () => new Date('2026-07-24T12:00:00.000Z')
  });
  await repository.listPendingQueueEventJobs({ jobLimit: 7, eventLimit: 31 });

  const findCall = calls.find((call) => call.method === 'find');
  assert.equal(findCall.filter.queueEventPending, true);
  assert.deepEqual(findCall.filter.queueEventNextAttemptAt, {
    $lte: '2026-07-24T12:00:00.000Z'
  });
  assert.deepEqual(findCall.options.projection.queueEventOutbox, { $slice: 31 });
  assert.equal(calls.find((call) => call.method === 'limit').value, 7);
  assert.deepEqual(calls.find((call) => call.method === 'sort').value, {
    queueEventNextAttemptAt: 1,
    createdAt: 1
  });
  const indexes = calls.find((call) => call.method === 'createIndexes').indexes;
  assert.ok(indexes.some((index) => (
    index.name === 'cv_queue_event_pending'
    && index.key.queueEventPending === 1
    && index.key.queueEventNextAttemptAt === 1
  )));
});
