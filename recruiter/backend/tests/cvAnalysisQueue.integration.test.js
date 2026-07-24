const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.REDIS_HOST = process.env.CV_TEST_REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.CV_TEST_REDIS_PORT || '46379';
process.env.REDIS_ENABLED = 'true';
process.env.CV_ANALYSIS_QUEUE_CONCURRENCY = '1';
process.env.CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY = '2';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const embeddingService = require('../services/embeddingService');
const { controlFetch } = require('../../../tools/local-llm/control-auth.cjs');

embeddingService.createCandidateEmbedding = async () => ({ skipped: true });

const Candidate = require('../models/Candidate');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingJob = require('../models/CVProcessingJob');
const cvQueue = require('../services/cvAnalysisQueueService');

let mongo;
let inspectionConnection;
let inspectionQueue;
let initialGatewayControl;

const resumeText = [
  'Ada Lovelace',
  'Email: ada.lovelace@example.com',
  'Phone: +44 7700 900123',
  'Location: London, United Kingdom',
  'Senior Software Engineer with 8 years of experience.',
  'Skills: JavaScript, TypeScript, Node.js, MongoDB, Redis, Docker.',
  'Education: BSc Computer Science, University of London.',
  'Experience: Senior Engineer at Analytical Engines Ltd from 2019 to 2026.'
].join('\n');

function createJob(overrides = {}) {
  const publicId = overrides.publicId || `cv_test_${new mongoose.Types.ObjectId()}`;
  const statusToken = overrides.statusToken || `token-${publicId}`;
  return CVProcessingJob.create({
    publicId,
    statusTokenHash: cvQueue.tokenHash(statusToken),
    state: 'queued',
    progress: 10,
    organization: overrides.organization || new mongoose.Types.ObjectId(),
    source: overrides.source || 'private',
    originalName: 'ada-lovelace.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    resumeText,
    cloudinary: {
      resumeUrl: 'https://example.invalid/ada-lovelace.pdf',
      publicId: `cv-test/${publicId}`,
      resourceType: 'raw'
    },
    formData: {},
    ...overrides
  }).then((job) => ({ job, statusToken }));
}

async function setGatewayIngress(enabled) {
  const response = await controlFetch('http://127.0.0.1:11435/control/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, ingressEnabled: enabled, paused: false })
  });
  assert.equal(response.ok, true, `Gateway control returned ${response.status}`);
}

async function setGatewayControl(control) {
  const response = await controlFetch('http://127.0.0.1:11435/control/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(control)
  });
  assert.equal(response.ok, true, `Gateway control returned ${response.status}`);
}

async function waitForJobState(publicId, expected, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await CVProcessingJob.findOne({ publicId });
    if (job && expected.includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const latest = await CVProcessingJob.findOne({ publicId });
  assert.fail(`Timed out waiting for ${publicId}; last state was ${latest?.state || 'missing'}`);
}

test.before(async () => {
  const gatewayStatus = await controlFetch('http://127.0.0.1:11435/control/status').then((response) => response.json());
  initialGatewayControl = {
    enabled: gatewayStatus.state.enabled !== false,
    ingressEnabled: gatewayStatus.state.ingressEnabled !== false,
    paused: gatewayStatus.state.paused === true,
    concurrency: Math.max(1, Number(gatewayStatus.state.concurrency || 1)),
    selectionMode: gatewayStatus.state.selectionMode === 'manual' ? 'manual' : 'automatic'
  };
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  inspectionConnection = new IORedis(Number(process.env.REDIS_PORT), process.env.REDIS_HOST, {
    maxRetriesPerRequest: null
  });
  inspectionQueue = new Queue('cv-analysis-local', { connection: inspectionConnection });
  await inspectionQueue.obliterate({ force: true });
});

test('retry backoff grows exponentially and caps local-runtime outages', () => {
  const offline = Object.assign(new Error('local CV runtime could not be reached'), { code: 'LOCAL_LLM_UNAVAILABLE' });
  assert.deepEqual(
    [1, 2, 3, 4, 5, 9].map((attempt) => cvQueue.cvBackoffDelay(attempt, offline)),
    [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]
  );
  assert.equal(cvQueue.isOfflineError(offline), true);
  assert.equal(cvQueue.isOfflineError(new Error('schema mismatch')), false);
});

test.after(async () => {
  if (initialGatewayControl) await setGatewayControl(initialGatewayControl).catch(() => {});
  await cvQueue.closeForTests();
  if (inspectionQueue) await inspectionQueue.close();
  if (inspectionConnection) await inspectionConnection.quit();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await inspectionQueue.obliterate({ force: true });
  await inspectionQueue.pause();
  await CVProcessingJob.deleteMany({});
  await CVProcessingAudit.deleteMany({});
  await Candidate.deleteMany({});
});

test('status tokens are isolated and compared without exposing the stored hash', async () => {
  const { job, statusToken } = await createJob();
  assert.equal(await cvQueue.getStatus(job.publicId, 'wrong-token'), null);
  const status = await cvQueue.getStatus(job.publicId, statusToken);
  assert.equal(status.jobId, job.publicId);
  assert.equal(status.state, 'queued');
  assert.equal(Object.hasOwn(status, 'statusTokenHash'), false);
});

test('priority preserves FIFO inside an organisation and interleaves organisations', async () => {
  const organizationA = new mongoose.Types.ObjectId();
  const organizationB = new mongoose.Types.ObjectId();
  const firstA = await createJob({ organization: organizationA });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const secondA = await createJob({ organization: organizationA });
  const firstB = await createJob({ organization: organizationB });

  const queuedFirstA = await cvQueue.enqueueExistingJob(firstA.job._id);
  const queuedSecondA = await cvQueue.enqueueExistingJob(secondA.job._id);
  const queuedFirstB = await cvQueue.enqueueExistingJob(firstB.job._id);

  assert.equal(queuedFirstA.opts.priority, 1);
  assert.equal(queuedSecondA.opts.priority, 2);
  assert.equal(queuedFirstB.opts.priority, 1);
  assert.equal((await cvQueue.telemetry()).paused, true);
});

test('telemetry reports durable states, worker capacity, throughput, and privacy-safe recent jobs', async () => {
  const now = Date.now();
  await createJob({ createdAt: new Date(now - 90_000) });
  await createJob({
    state: 'waiting_for_local_runtime',
    progress: 20,
    attempts: 2,
    createdAt: new Date(now - 60_000)
  });
  await createJob({
    state: 'completed',
    progress: 100,
    attempts: 1,
    startedAt: new Date(now - 5_000),
    completedAt: new Date(now - 2_000)
  });
  await createJob({
    state: 'failed',
    attempts: 5,
    failedAt: new Date(now - 1_000),
    lastError: { code: 'CV_SCHEMA_INVALID', message: 'Synthetic failure', at: new Date(now - 1_000) }
  });

  const snapshot = await cvQueue.telemetry();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.paused, true);
  assert.equal(snapshot.durable.queued, 1);
  assert.equal(snapshot.durable.waitingForRuntime, 1);
  assert.equal(snapshot.durable.completed, 1);
  assert.equal(snapshot.durable.failed, 1);
  assert.equal(snapshot.durable.retrying, 1);
  assert.equal(snapshot.rates.completedLast5Minutes, 1);
  assert.equal(snapshot.rates.completedLastHour, 1);
  assert.equal(snapshot.rates.failedLastHour, 1);
  assert.equal(snapshot.rates.averageProcessingMs, 3_000);
  assert.equal(snapshot.rates.p95ProcessingMs, 3_000);
  assert.ok(snapshot.oldestWaitMs >= 60_000);
  assert.equal(snapshot.worker.concurrency >= 1, true);
  assert.equal(snapshot.worker.availableSlots >= 0, true);
  assert.equal(snapshot.recentJobs.length, 4);
  assert.ok(['queued', 'waiting_for_local_runtime', 'processing'].includes(snapshot.recentJobs[0].state));
  assert.ok(['queued', 'waiting_for_local_runtime', 'processing'].includes(snapshot.recentJobs[1].state));
  assert.equal(Object.hasOwn(snapshot.recentJobs[0], 'originalName'), false);
  assert.equal(Object.hasOwn(snapshot.recentJobs[0], 'errorCode'), true);
});

test('history backfills retained jobs with lifecycle data and supports retry pagination without CV contents', async () => {
  const now = Date.now();
  await createJob({ publicId: 'cv_history_completed', state: 'completed', progress: 100, completedAt: new Date(now - 1_000) });
  await createJob({ publicId: 'cv_history_failed', state: 'failed', failedAt: new Date(now - 500) });
  await createJob({ publicId: 'cv_history_retrying', state: 'queued', progress: 20, attempts: 2 });
  const history = await cvQueue.listHistory({ state: 'completed', page: 1, limit: 10 });
  assert.equal(history.total, 1);
  assert.equal(history.retainedIndefinitely, true);
  assert.ok(history.coverageStartedAt);
  assert.equal(history.jobs[0].jobId, 'cv_history_completed');
  assert.equal(history.jobs[0].state, 'completed');
  assert.equal(history.jobs[0].phase, 'completed');
  assert.equal(history.jobs[0].transitions.length, 1);
  assert.equal(history.jobs[0].transitions[0].phase, 'completed');
  assert.equal(Object.hasOwn(history.jobs[0], 'resumeText'), false);

  const retrying = await cvQueue.listHistory({ state: 'retrying', search: 'cv_history_retrying', page: 1, limit: 10 });
  assert.equal(retrying.total, 1);
  assert.equal(retrying.jobs[0].phase, 'retrying');
});

test('signed AI Interview queue events join permanent history and aggregate telemetry', async () => {
  const publicId = 'aicv_external_history_12345678';
  const base = {
    publicId,
    organizationId: 'settings_external',
    actorId: 'user_external',
    jobId: 'job_external',
    createdAt: new Date(Date.now() - 5_000).toISOString()
  };
  await cvQueue.ingestExternalQueueEvent('ai-interview', {
    job: { ...base, state: 'queued', progress: 10, attempts: 0, sequence: 0, updatedAt: base.createdAt }
  });
  await cvQueue.ingestExternalQueueEvent('ai-interview', {
    job: {
      ...base,
      state: 'processing',
      progress: 30,
      attempts: 1,
      sequence: 1,
      startedAt: new Date(Date.now() - 3_000).toISOString(),
      updatedAt: new Date(Date.now() - 3_000).toISOString()
    }
  });
  await cvQueue.ingestExternalQueueEvent('ai-interview', {
    job: {
      ...base,
      state: 'completed',
      progress: 100,
      attempts: 1,
      sequence: 2,
      startedAt: new Date(Date.now() - 3_000).toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
  await cvQueue.ingestExternalQueueEvent('ai-interview', {
    job: {
      ...base,
      state: 'queued',
      progress: 10,
      attempts: 0,
      sequence: 0,
      updatedAt: new Date(Date.now() + 10_000).toISOString()
    }
  });

  const history = await cvQueue.listHistory({ source: 'ai-interview', search: publicId, page: 1, limit: 10 });
  assert.equal(history.total, 1);
  assert.equal(history.jobs[0].state, 'completed');
  assert.equal(history.jobs[0].producer, 'ai-interview');
  assert.equal(history.jobs[0].queue, 'ai-interview-cv-analysis-local');
  assert.deepEqual(
    history.jobs[0].transitions.map((transition) => transition.phase),
    ['queued', 'processing', 'completed']
  );
  const snapshot = await cvQueue.telemetry();
  assert.equal(snapshot.durable.completed, 1);
  assert.equal(snapshot.recentJobs[0].jobId, publicId);
  assert.equal(snapshot.recentJobs[0].producer, 'ai-interview');
  assert.equal(snapshot.queues.some((queue) => queue.name === 'ai-interview-cv-analysis-local'), true);
  const adminSnapshot = await cvQueue.adminTelemetry();
  assert.equal(adminSnapshot.recentJobs.some((job) => job.jobId === publicId && job.producer === 'ai-interview'), true);
  const adminDetail = await cvQueue.getAdminJobDetail(publicId);
  assert.equal(adminDetail.jobId, publicId);
  assert.equal(adminDetail.queue, 'ai-interview-cv-analysis-local');
  assert.deepEqual(adminDetail.transitions.map((transition) => transition.sequence), [0, 1, 2]);

  await assert.rejects(
    () => cvQueue.ingestExternalQueueEvent('unknown-service', { job: { ...base, state: 'queued' } }),
    { code: 'CV_QUEUE_PRODUCER_FORBIDDEN' }
  );
});

test('stale Mongo jobs are recovered after a queue restart', async () => {
  const { job } = await createJob();
  await CVProcessingJob.collection.updateOne(
    { _id: job._id },
    { $set: { updatedAt: new Date(Date.now() - 120_000) } }
  );

  assert.equal(await cvQueue.recoverStaleJobs(), 1);
  assert.ok(await inspectionQueue.getJob(job.publicId));
  assert.equal(await cvQueue.recoverStaleJobs(), 0);
});

test('signed telemetry applies Control Center pause and approved concurrency to BullMQ', async () => {
  await inspectionQueue.resume();
  await cvQueue.initWorker();
  try {
    await setGatewayControl({ concurrency: 1, paused: true });
    assert.equal(await cvQueue.publishTelemetry(), true);
    const paused = await cvQueue.telemetry();
    assert.equal(paused.concurrency, 1);
    assert.equal(paused.paused, true);
  } finally {
    await setGatewayControl({ concurrency: 1, paused: false });
    await cvQueue.publishTelemetry();
    await cvQueue.publishTelemetry();
  }
  const resumed = await cvQueue.telemetry();
  assert.equal(resumed.concurrency, 1);
  assert.equal(resumed.paused, false);
});

test('local runtime outages wait durably and resume without duplicate candidates', { timeout: 180_000 }, async () => {
  await setGatewayIngress(false);
  await inspectionQueue.resume();
  await cvQueue.initWorker();
  const { job } = await createJob();
  const bullJob = await cvQueue.enqueueExistingJob(job._id);

  await waitForJobState(job.publicId, ['waiting_for_local_runtime'], 60_000);
  assert.equal(await Candidate.countDocuments({}), 0);

  await setGatewayIngress(true);
  await bullJob.promote();
  const completed = await waitForJobState(job.publicId, ['completed'], 120_000);
  assert.ok(completed.candidate);
  assert.equal(await Candidate.countDocuments({
    'processingMetadata.cvProcessingJobId': job.publicId
  }), 1);

  await cvQueue.enqueueExistingJob(job._id);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(await Candidate.countDocuments({
    'processingMetadata.cvProcessingJobId': job.publicId
  }), 1);

  const history = await cvQueue.listHistory({ search: job.publicId, page: 1, limit: 10 });
  assert.equal(history.total, 1);
  const phases = history.jobs[0].transitions.map((transition) => transition.phase);
  assert.ok(phases.includes('processing'));
  assert.ok(phases.includes('waiting_for_local_runtime'));
  assert.ok(phases.includes('retrying'));
  assert.equal(phases.at(-1), 'completed');
});
