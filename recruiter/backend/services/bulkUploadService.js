const fs = require('fs');
const path = require('path');
const { Queue, QueueEvents, Worker } = require('bullmq');
const {
  createGlobalDispatchConnection,
  resolveGlobalDispatchConfig,
} = require('./cvGlobalDispatch');

const REDIS_ENABLED = process.env.REDIS_ENABLED
  ? process.env.REDIS_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.REDIS_HOST);
const REDIS_HOST = process.env.REDIS_HOST
  || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const APPROVED_CONCURRENCY = Math.max(
  1,
  Number(process.env.CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY || 1)
);
const globalDispatchConfig = resolveGlobalDispatchConfig({
  enabled: REDIS_ENABLED,
  serviceId: 'recruiter',
  defaultApprovedLimit: APPROVED_CONCURRENCY,
  legacyRedis: {
    host: REDIS_HOST,
    port: REDIS_PORT,
  },
});
const connection = REDIS_ENABLED
  ? createGlobalDispatchConnection(globalDispatchConfig, {
    connectionName: 'legacy-bulk-cv-migration:recruiter',
    enableReadyCheck: false,
  })
  : null;

if (connection) {
  connection.on('error', (error) => {
    console.error('Legacy bulk migration Redis connection error:', error.message);
  });
}

const QUEUE_NAME = 'bulk-cv-upload';
const MIGRATION_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.LEGACY_BULK_MIGRATION_CONCURRENCY || 1))
);
const STATUS_POLL_MS = Math.max(
  250,
  Number(process.env.LEGACY_BULK_STATUS_POLL_MS || 2_000)
);

let queue = null;
let worker = null;
let queueEvents = null;
let shuttingDown = false;

const batchStatus = new Map();
const batchCompletions = new Map();

const defaultSubmitDurableUpload = (req) => (
  require('./cvAnalysisQueueService').submitUpload(req, 'bulk')
);
const defaultReadDurableStatus = (publicId, statusToken) => (
  require('./cvAnalysisQueueService').getStatus(publicId, statusToken)
);
let submitDurableUpload = defaultSubmitDurableUpload;
let readDurableStatus = defaultReadDurableStatus;

function getBatchStatus(batchId) {
  return batchStatus.get(batchId) || null;
}

function initBatchStatus(batchId, totalFiles, organizationId, userId) {
  const status = {
    batchId,
    organizationId,
    userId,
    totalFiles,
    completed: 0,
    successful: 0,
    failed: 0,
    processing: totalFiles,
    results: [],
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    state: 'processing',
  };
  batchStatus.set(batchId, status);
  batchCompletions.set(batchId, new Set());
  return status;
}

function updateBatchFile(batchId, legacyJobId, fileResult) {
  const status = batchStatus.get(batchId);
  if (!status) return null;
  const completedJobs = batchCompletions.get(batchId) || new Set();
  const completionKey = String(legacyJobId || fileResult.fileName || status.completed);
  if (completedJobs.has(completionKey)) return status;
  completedJobs.add(completionKey);
  batchCompletions.set(batchId, completedJobs);

  status.completed += 1;
  if (fileResult.success) {
    status.successful += 1;
    status.results.push({
      fileName: fileResult.fileName,
      candidateId: fileResult.candidateId,
      candidateName: fileResult.candidateName,
      durableJobId: fileResult.durableJobId,
      success: true,
    });
  } else {
    status.failed += 1;
    status.errors.push({
      fileName: fileResult.fileName,
      error: fileResult.error,
      durableJobId: fileResult.durableJobId,
      success: false,
    });
  }

  status.processing = Math.max(0, status.totalFiles - status.completed);
  if (status.completed >= status.totalFiles) {
    status.state = 'completed';
    status.completedAt = new Date().toISOString();
  }
  return status;
}

function migrationRequest(job) {
  const data = job.data || {};
  const idempotencyKey = `legacy-bulk:${job.id}`;
  return {
    file: {
      path: data.filePath,
      mimetype: data.fileType || 'application/octet-stream',
      originalname: data.originalName || path.basename(String(data.filePath || 'cv-upload')),
      size: Number(data.fileSize || 0),
    },
    body: {},
    user: {
      id: data.userId || undefined,
      currentOrganization: data.organizationId,
    },
    get(name) {
      return String(name || '').toLowerCase() === 'idempotency-key'
        ? idempotencyKey
        : undefined;
    },
  };
}

async function waitForDurableCompletion(publicId, statusToken, job) {
  let lastProgress = -1;
  while (!shuttingDown) {
    const status = await readDurableStatus(publicId, statusToken);
    if (!status) {
      const error = new Error('The migrated durable CV job could not be read');
      error.code = 'DURABLE_CV_JOB_NOT_FOUND';
      throw error;
    }
    if (status.state === 'completed') return status;
    if (status.state === 'failed') {
      const error = new Error(status.error?.message || 'The durable CV job failed');
      error.code = status.error?.code || 'DURABLE_CV_JOB_FAILED';
      error.durableTerminal = true;
      throw error;
    }
    const progress = Math.min(99, Math.max(10, Number(status.progress || 10)));
    if (progress !== lastProgress) {
      await job.updateProgress(progress);
      lastProgress = progress;
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
  const error = new Error('Legacy migration stopped before the durable CV job completed');
  error.code = 'LEGACY_MIGRATION_SHUTDOWN';
  throw error;
}

async function migrateLegacyJob(job) {
  const data = job.data || {};
  if (!data.filePath || !data.organizationId) {
    const error = new Error('Legacy bulk job is missing its file path or organization');
    error.code = 'LEGACY_BULK_JOB_INVALID';
    throw error;
  }
  if (!Number(data.fileSize || 0)) {
    data.fileSize = await fs.promises.stat(data.filePath)
      .then((stat) => stat.size)
      .catch(() => 0);
  }

  const submitted = await submitDurableUpload(migrationRequest(job));
  const durableJobId = submitted.job.publicId;
  await job.updateProgress(10);
  const status = await waitForDurableCompletion(
    durableJobId,
    submitted.statusToken,
    job
  );
  await job.updateProgress(100);
  return {
    success: true,
    fileName: data.originalName || path.basename(data.filePath),
    candidateId: status.candidateId || null,
    candidateName: status.candidate
      ? [status.candidate.firstName, status.candidate.lastName].filter(Boolean).join(' ')
      : '',
    durableJobId,
  };
}

async function initQueue() {
  if (queue) return { queue, worker, queueEvents };
  if (!REDIS_ENABLED) {
    throw new Error(
      'Legacy bulk migration requires Redis. New uploads must use cvAnalysisQueueService.submitBatch().'
    );
  }

  shuttingDown = false;
  if (connection.status === 'wait') await connection.connect();
  queue = new Queue(QUEUE_NAME, { connection });
  queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  worker = new Worker(QUEUE_NAME, async (job) => {
    const data = job.data || {};
    try {
      const result = await migrateLegacyJob(job);
      updateBatchFile(data.batchId, job.id, result);
      return result;
    } catch (error) {
      const finalAttempt = Number(job.attemptsMade || 0) + 1
        >= Math.max(1, Number(job.opts?.attempts || 1));
      if (
        error.code !== 'LEGACY_MIGRATION_SHUTDOWN'
        && (error.durableTerminal === true || finalAttempt)
      ) {
        updateBatchFile(data.batchId, job.id, {
          success: false,
          fileName: data.originalName || path.basename(String(data.filePath || 'cv-upload')),
          error: error.message,
        });
      }
      throw error;
    }
  }, {
    connection,
    concurrency: MIGRATION_CONCURRENCY,
  });

  worker.on('completed', (job, result) => {
    console.log(
      `Legacy bulk job ${job.id} completed through durable CV job ${result?.durableJobId || 'unknown'}`
    );
  });
  worker.on('failed', (job, error) => {
    console.error(`Legacy bulk migration job ${job?.id || 'unknown'} failed: ${error.message}`);
  });

  console.log(
    `Legacy bulk queue migration worker started (ingestion concurrency: ${MIGRATION_CONCURRENCY}); inference remains in cv-analysis-chatgpt`
  );
  return { queue, worker, queueEvents };
}

async function addBulkUploadJobs(batchId, files, organizationId, userId) {
  const { queue: legacyQueue } = await initQueue();
  const jobs = files.map((file, index) => ({
    name: `cv-${batchId}-${index}`,
    data: {
      filePath: file.path,
      fileType: file.mimetype,
      fileSize: Number(file.size || 0),
      originalName: file.originalname,
      batchId,
      organizationId,
      userId,
    },
    opts: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: { age: 3_600 },
      removeOnFail: { age: 7_200 },
    },
  }));
  await legacyQueue.addBulk(jobs);
  console.log(
    `Accepted ${jobs.length} legacy bulk jobs for migration into the durable CV queue (${batchId})`
  );
}

function setDependenciesForTests(overrides = {}) {
  if (overrides.submitDurableUpload) submitDurableUpload = overrides.submitDurableUpload;
  if (overrides.readDurableStatus) readDurableStatus = overrides.readDurableStatus;
}

function resetDependenciesForTests() {
  submitDurableUpload = defaultSubmitDurableUpload;
  readDurableStatus = defaultReadDurableStatus;
  shuttingDown = false;
}

async function shutdownQueue() {
  shuttingDown = true;
  try {
    if (worker) {
      await worker.close();
      worker = null;
    }
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (queue) {
      await queue.close();
      queue = null;
    }
    if (connection && connection.status !== 'end') {
      await connection.quit().catch(() => {});
    }
  } catch (error) {
    console.warn('bulkUploadService shutdownQueue:', error.message);
  } finally {
    resetDependenciesForTests();
  }
}

module.exports = {
  _migrateLegacyJobForTests: migrateLegacyJob,
  _resetDependenciesForTests: resetDependenciesForTests,
  _setDependenciesForTests: setDependenciesForTests,
  addBulkUploadJobs,
  getBatchStatus,
  initBatchStatus,
  initQueue,
  shutdownQueue,
  QUEUE_NAME,
};
