const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const cvParsingService = require('./cvParsingService');
const { id, iso, mutateStore, readStore } = require('./store');

const QUEUE_NAME = 'ai-interview-cv-analysis-local';
const redisHost = process.env.AI_INTERVIEW_REDIS_HOST
  || process.env.REDIS_HOST
  || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const redisPort = Number(process.env.AI_INTERVIEW_REDIS_PORT || process.env.REDIS_PORT || 6379);
const redisEnabled = process.env.AI_INTERVIEW_CV_QUEUE_ENABLED
  ? process.env.AI_INTERVIEW_CV_QUEUE_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.AI_INTERVIEW_REDIS_HOST || process.env.REDIS_HOST);
const defaultConcurrency = Math.max(1, Number(process.env.AI_INTERVIEW_CV_QUEUE_CONCURRENCY || 1));
const connection = redisEnabled ? new IORedis(redisPort, redisHost, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true
}) : null;

let queue;
let worker;
let completionHandler;
let analyzeResume = (resumeText, context) => cvParsingService.analyzeResumeText(resumeText, context);
let maintenanceTimer;
let retryTimer;

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function deterministicStatusToken(organizationId, idempotencyKey) {
  const secret = String(
    process.env.AI_INTERVIEW_CV_STATUS_TOKEN_SECRET
    || process.env.JWT_SECRET
    || 'development-only-ai-interview-cv-status-secret'
  );
  return crypto.createHmac('sha256', secret)
    .update(`${organizationId}:${idempotencyKey}`)
    .digest('base64url');
}

function isOfflineError(error) {
  const code = String(error?.code || '');
  return code === 'AI_LOCAL_UNAVAILABLE'
    || code === 'AI_LOCAL_NOT_CONFIGURED'
    || code === 'LLM_NOT_CONFIGURED'
    || code === 'LLM_REQUEST_FAILED'
    || code.startsWith('LOCAL_LLM_')
    || /local cv runtime|local[- ]llm|ollama|vllm|codex|gateway could not be reached|fetch failed|request deadline/i
      .test(String(error?.message || ''));
}

function backoffDelay(attemptsMade, error) {
  const exponent = Math.max(0, Math.min(10, Number(attemptsMade || 1) - 1));
  const delay = 30_000 * (2 ** exponent);
  return Math.min(delay, isOfflineError(error) ? 5 * 60_000 : 10 * 60_000);
}

function publicState(job) {
  return {
    jobId: job.publicId,
    state: job.state,
    progress: Number(job.progress || 0),
    position: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    candidateId: job.result?.candidate?._id || job.candidateId || null,
    error: job.state === 'failed' ? job.lastError : undefined,
    ...(job.state === 'completed' && job.result ? job.result : {})
  };
}

async function ensureConnection() {
  if (!connection) {
    const error = new Error('AI Interview CV queue is disabled');
    error.code = 'CV_QUEUE_DISABLED';
    throw error;
  }
  if (connection.status === 'wait') await connection.connect();
}

async function getQueue() {
  await ensureConnection();
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
}

async function addQueueJob(job) {
  const queueInstance = await getQueue();
  const store = await readStore();
  const jobsAhead = (store.cvProcessingJobs || []).filter((item) => (
    item.organizationId === job.organizationId
    && ['queued', 'waiting_for_local_runtime', 'processing'].includes(item.state)
    && new Date(item.createdAt).getTime() < new Date(job.createdAt).getTime()
  )).length;
  return queueInstance.add('analyze-ai-interview-cv', { processingJobId: job.publicId }, {
    jobId: job.publicId,
    attempts: 2_147_483_647,
    backoff: { type: 'cv-runtime', delay: 30_000 },
    priority: Math.min(2_097_152, jobsAhead + 1),
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 }
  });
}

async function submit({ file, organizationId, actorId, jobId, candidateId, mode, idempotencyKey }) {
  if (!file?.buffer?.length) {
    const error = new Error('Upload a CV file.');
    error.statusCode = 400;
    throw error;
  }
  const resumeText = await cvParsingService.extractText(file);
  if (!resumeText || resumeText.trim().length < 50) {
    const error = new Error('Could not extract enough text from this CV. Upload a text-based PDF/DOCX or enter the candidate manually.');
    error.statusCode = 422;
    throw error;
  }

  const normalizedKey = String(idempotencyKey || '').trim() || null;
  const statusToken = normalizedKey
    ? deterministicStatusToken(organizationId, normalizedKey)
    : crypto.randomBytes(32).toString('base64url');
  let duplicate = false;
  const processingJob = await mutateStore((store) => {
    store.cvProcessingJobs = store.cvProcessingJobs || [];
    if (normalizedKey) {
      const existing = store.cvProcessingJobs.find((item) => (
        item.organizationId === organizationId && item.idempotencyKey === normalizedKey
      ));
      if (existing) {
        duplicate = true;
        return existing;
      }
    }
    const now = iso(new Date());
    const created = {
      _id: id('cvjob'),
      publicId: `aicv_${crypto.randomUUID()}`,
      statusTokenHash: tokenHash(statusToken),
      idempotencyKey: normalizedKey,
      state: 'queued',
      progress: 10,
      attempts: 0,
      organizationId,
      actorId,
      jobId,
      candidateId: candidateId || null,
      mode,
      originalName: String(file.originalname || 'cv').slice(0, 255),
      mimeType: String(file.mimetype || 'application/octet-stream').slice(0, 127),
      fileSize: Number(file.size || file.buffer.length),
      resumeText,
      createdAt: now,
      updatedAt: now,
      expiresAt: iso(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    };
    store.cvProcessingJobs.push(created);
    return created;
  });

  if (!duplicate) {
    try {
      await addQueueJob(processingJob);
    } catch (error) {
      await mutateStore((store) => {
        const current = (store.cvProcessingJobs || []).find((item) => item.publicId === processingJob.publicId);
        if (current) {
          current.lastError = {
            code: error.code || 'CV_QUEUE_UNAVAILABLE',
            message: String(error.message || error).slice(0, 1000),
            at: iso(new Date())
          };
          current.updatedAt = iso(new Date());
        }
      });
    }
  }

  return {
    job: processingJob,
    statusToken,
    duplicate
  };
}

async function processJob(bullJob) {
  let processingJob;
  await mutateStore((store) => {
    processingJob = (store.cvProcessingJobs || []).find((item) => item.publicId === bullJob.data.processingJobId);
    if (!processingJob || processingJob.state === 'completed') return;
    processingJob.state = 'processing';
    processingJob.progress = 30;
    processingJob.startedAt = processingJob.startedAt || iso(new Date());
    processingJob.updatedAt = iso(new Date());
    processingJob.attempts = Number(processingJob.attempts || 0) + 1;
  });
  if (!processingJob || processingJob.state === 'completed') {
    return { skipped: true };
  }
  if (typeof completionHandler !== 'function') {
    const error = new Error('AI Interview CV queue completion handler is not configured');
    error.code = 'CV_QUEUE_NOT_CONFIGURED';
    throw error;
  }

  try {
    const parsed = await analyzeResume(processingJob.resumeText, {
      organizationId: processingJob.organizationId,
      actorId: processingJob.actorId,
      jobId: processingJob.jobId,
      candidateId: processingJob.candidateId,
      requestId: `ai-interview-cv-queue:${processingJob.publicId}`
    });
    await bullJob.updateProgress(75);
    const result = await completionHandler(processingJob, parsed);
    await bullJob.updateProgress(100);
    return {
      jobId: processingJob.publicId,
      candidateId: result?.candidate?._id || processingJob.candidateId || null
    };
  } catch (error) {
    const offline = isOfflineError(error);
    const terminal = !offline && Number(bullJob.attemptsMade || 0) + 1 >= 5;
    await mutateStore((store) => {
      const current = (store.cvProcessingJobs || []).find((item) => item.publicId === processingJob.publicId);
      if (!current || current.state === 'completed') return;
      current.state = terminal ? 'failed' : offline ? 'waiting_for_local_runtime' : 'queued';
      current.progress = terminal ? Number(current.progress || 30) : 20;
      current.updatedAt = iso(new Date());
      current.lastError = {
        code: error.code || 'CV_ANALYSIS_ERROR',
        message: String(error.message || error).slice(0, 1000),
        at: iso(new Date())
      };
      if (terminal) current.failedAt = iso(new Date());
    });
    if (terminal) bullJob.discard();
    throw error;
  }
}

async function recoverStaleJobs() {
  const queueInstance = await getQueue();
  const store = await readStore();
  const staleThreshold = Date.now() - 60_000;
  const pending = (store.cvProcessingJobs || [])
    .filter((item) => (
      ['queued', 'waiting_for_local_runtime', 'processing'].includes(item.state)
      && new Date(item.updatedAt || item.createdAt).getTime() < staleThreshold
    ))
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .slice(0, 500);
  let recovered = 0;
  for (const job of pending) {
    if (!await queueInstance.getJob(job.publicId)) {
      await addQueueJob(job);
      recovered += 1;
    }
  }
  return recovered;
}

async function getStatus(publicId, statusToken, actorId) {
  const store = await readStore();
  const job = (store.cvProcessingJobs || []).find((item) => item.publicId === publicId);
  if (!job || !statusToken || !hashesMatch(tokenHash(statusToken), job.statusTokenHash)) return null;
  if (actorId && job.actorId && actorId !== job.actorId) return null;
  const result = publicState(job);
  if (['queued', 'waiting_for_local_runtime'].includes(job.state)) {
    try {
      const queueInstance = await getQueue();
      const waiting = await queueInstance.getJobs(['prioritized', 'waiting', 'delayed'], 0, 5000, true);
      const index = waiting.findIndex((item) => item.id === publicId);
      result.position = index >= 0 ? index + 1 : null;
      result.queueAvailable = true;
    } catch {
      result.queueAvailable = false;
    }
  }
  return result;
}

async function telemetry() {
  const store = await readStore();
  const oldest = (store.cvProcessingJobs || [])
    .filter((item) => ['queued', 'waiting_for_local_runtime'].includes(item.state))
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))[0];
  try {
    const queueInstance = await getQueue();
    const counts = await queueInstance.getJobCounts('prioritized', 'waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
    counts.waitingTotal = Number(counts.waiting || 0) + Number(counts.prioritized || 0);
    return {
      queue: QUEUE_NAME,
      available: true,
      concurrency: Number(worker?.concurrency || defaultConcurrency),
      counts,
      oldestQueuedAt: oldest?.createdAt || null,
      paused: await queueInstance.isPaused()
    };
  } catch (error) {
    return {
      queue: QUEUE_NAME,
      available: false,
      concurrency: Number(worker?.concurrency || defaultConcurrency),
      counts: {
        prioritized: 0,
        waiting: (store.cvProcessingJobs || []).filter((item) => ['queued', 'waiting_for_local_runtime'].includes(item.state)).length,
        waitingTotal: (store.cvProcessingJobs || []).filter((item) => ['queued', 'waiting_for_local_runtime'].includes(item.state)).length,
        active: (store.cvProcessingJobs || []).filter((item) => item.state === 'processing').length,
        completed: (store.cvProcessingJobs || []).filter((item) => item.state === 'completed').length,
        failed: (store.cvProcessingJobs || []).filter((item) => item.state === 'failed').length
      },
      oldestQueuedAt: oldest?.createdAt || null,
      paused: false,
      error: error.message
    };
  }
}

async function init({ onCompleted, analyze } = {}) {
  if (onCompleted) completionHandler = onCompleted;
  if (analyze) analyzeResume = analyze;
  if (worker || !connection) return worker;
  try {
    await getQueue();
  } catch (error) {
    if (!retryTimer) {
      retryTimer = setInterval(() => void init().catch(() => {}), 30_000);
      retryTimer.unref?.();
    }
    throw error;
  }
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: defaultConcurrency,
    settings: {
      backoffStrategy: (attemptsMade, type, error) => {
        if (type !== 'cv-runtime') throw new Error(`Unsupported AI Interview CV backoff type: ${type}`);
        return backoffDelay(attemptsMade, error);
      }
    }
  });
  worker.on('error', (error) => console.error('AI Interview CV worker error:', error.message));
  await recoverStaleJobs();
  if (!maintenanceTimer) {
    maintenanceTimer = setInterval(() => void recoverStaleJobs().catch(() => {}), 30_000);
    maintenanceTimer.unref?.();
  }
  return worker;
}

async function setPaused(paused) {
  const queueInstance = await getQueue();
  if (paused) await queueInstance.pause(); else await queueInstance.resume();
  return telemetry();
}

async function closeForTests() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  if (worker) await worker.close();
  worker = null;
  if (queue) await queue.close();
  queue = null;
  if (connection && connection.status !== 'end') await connection.quit();
}

module.exports = {
  QUEUE_NAME,
  backoffDelay,
  closeForTests,
  deterministicStatusToken,
  getStatus,
  init,
  isOfflineError,
  publicState,
  setPaused,
  submit,
  telemetry,
  tokenHash
};
