const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const Candidate = require('../models/Candidate');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingJob = require('../models/CVProcessingJob');
const CVProcessingBatch = require('../models/CVProcessingBatch');
const Job = require('../models/Job');
const Organization = require('../models/Organization');
const User = require('../models/User');
const CVParsingService = require('./cvParsingService');
const CloudinaryUploadService = require('./cloudinaryUploadService');
const embeddingService = require('./embeddingService');
const { runWithAIRequestContext } = require('./aiRuntime/requestContext');
const { signLocalRequest } = require('./aiRuntime/aiRuntimeService');

const unlinkAsync = promisify(fs.unlink);
const queueName = 'cv-analysis-local';
const redisHost = process.env.REDIS_HOST || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisEnabled = process.env.REDIS_ENABLED
  ? process.env.REDIS_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.REDIS_HOST);
const connection = redisEnabled ? new IORedis(redisPort, redisHost, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true
}) : null;
const concurrency = Math.max(1, Number(process.env.CV_ANALYSIS_QUEUE_CONCURRENCY || 1));
const cvParser = new CVParsingService();
const cloudinary = new CloudinaryUploadService();
let queue;
let worker;
let maintenanceTimer;
let telemetryTimer;
let initRetryTimer;
let historyBackfillPromise;

function workerConcurrency() {
  return Math.max(1, Number(worker?.concurrency || concurrency));
}

function elapsedMs(start, end = Date.now()) {
  const startedAt = start ? new Date(start).getTime() : NaN;
  const endedAt = end instanceof Date ? end.getTime() : new Date(end).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function operationalJob(job, sampledAt) {
  const terminalAt = job.completedAt || job.failedAt || sampledAt;
  return {
    jobId: job.publicId,
    source: job.source,
    state: job.state,
    progress: Number(job.progress || 0),
    attempts: Number(job.attempts || 0),
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    updatedAt: job.updatedAt,
    waitMs: elapsedMs(job.createdAt, job.startedAt || terminalAt),
    processingMs: job.startedAt ? elapsedMs(job.startedAt, terminalAt) : null,
    errorCode: job.lastError?.code || null
  };
}

function auditDocument(job) {
  const sampledAt = new Date(job.updatedAt || Date.now());
  const operational = operationalJob(job, sampledAt);
  return {
    publicId: job.publicId,
    source: job.source,
    state: job.state,
    progress: operational.progress,
    attempts: operational.attempts,
    organization: job.organization,
    actor: job.actor || undefined,
    jobAppliedFor: job.jobAppliedFor || undefined,
    candidate: job.candidate || undefined,
    originalName: job.originalName || '',
    fileType: job.fileType || '',
    fileSize: Number(job.fileSize || 0),
    jobCreatedAt: job.createdAt,
    startedAt: job.startedAt || undefined,
    completedAt: job.completedAt || undefined,
    failedAt: job.failedAt || undefined,
    lastUpdatedAt: job.updatedAt || sampledAt,
    waitMs: operational.waitMs,
    processingMs: operational.processingMs,
    errorCode: operational.errorCode || undefined
  };
}

function auditOperationalJob(job) {
  return operationalJob({
    publicId: job.publicId,
    source: job.source,
    state: job.state,
    progress: job.progress,
    attempts: job.attempts,
    createdAt: job.jobCreatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    updatedAt: job.lastUpdatedAt,
    lastError: job.errorCode ? { code: job.errorCode } : null
  }, new Date(job.lastUpdatedAt || Date.now()));
}

async function syncHistory(processingJobId) {
  const job = processingJobId && typeof processingJobId === 'object' && processingJobId.publicId
    ? processingJobId
    : await CVProcessingJob.findById(processingJobId)
      .select('publicId source state progress attempts organization actor jobAppliedFor candidate originalName fileType fileSize createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .lean();
  if (!job) return false;
  await CVProcessingAudit.updateOne(
    { publicId: job.publicId },
    { $set: auditDocument(job) },
    { upsert: true }
  );
  return true;
}

async function syncHistorySafely(processingJobId) {
  try {
    return await syncHistory(processingJobId);
  } catch (error) {
    console.error('CV processing history sync failed:', error.message);
    return false;
  }
}

async function backfillHistory() {
  if (historyBackfillPromise) return historyBackfillPromise;
  historyBackfillPromise = (async () => {
    const rows = await CVProcessingJob.find({})
      .select('publicId source state progress attempts organization actor jobAppliedFor candidate originalName fileType fileSize createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .sort({ createdAt: 1 })
      .lean();
    for (let index = 0; index < rows.length; index += 500) {
      const batch = rows.slice(index, index + 500);
      if (!batch.length) continue;
      await CVProcessingAudit.bulkWrite(batch.map((job) => ({
        updateOne: {
          filter: { publicId: job.publicId },
          update: { $set: auditDocument(job) },
          upsert: true
        }
      })), { ordered: false });
    }
    return rows.length;
  })().catch((error) => {
    historyBackfillPromise = null;
    throw error;
  });
  return historyBackfillPromise;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listHistory(input = {}) {
  await backfillHistory();
  const page = Math.max(1, Math.min(100_000, Number(input.page) || 1));
  const limit = Math.max(10, Math.min(100, Number(input.limit) || 25));
  const filter = {};
  const allowedStates = new Set(['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed']);
  const allowedSources = new Set(['private', 'public', 'bulk', 'ai-interview']);
  if (allowedStates.has(String(input.state || ''))) filter.state = String(input.state);
  if (allowedSources.has(String(input.source || ''))) filter.source = String(input.source);
  const search = String(input.search || '').trim().slice(0, 100);
  if (search) filter.publicId = { $regex: escapeRegex(search), $options: 'i' };
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  if ((from && Number.isFinite(from.getTime())) || (to && Number.isFinite(to.getTime()))) {
    filter.jobCreatedAt = {};
    if (from && Number.isFinite(from.getTime())) filter.jobCreatedAt.$gte = from;
    if (to && Number.isFinite(to.getTime())) filter.jobCreatedAt.$lte = to;
  }
  const [total, rows] = await Promise.all([
    CVProcessingAudit.countDocuments(filter),
    CVProcessingAudit.find(filter)
      .sort({ jobCreatedAt: -1, publicId: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    jobs: rows.map(auditOperationalJob),
    retainedIndefinitely: true,
    measuredAt: new Date().toISOString()
  };
}

function personName(person) {
  if (!person) return '';
  return person.profile?.displayName
    || [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ')
    || person.email
    || '';
}

function adminOperationalJob(job, sampledAt) {
  const operational = operationalJob(job, sampledAt);
  const actor = job.actor && typeof job.actor === 'object' ? job.actor : null;
  const organization = job.organization && typeof job.organization === 'object' ? job.organization : null;
  const appliedJob = job.jobAppliedFor && typeof job.jobAppliedFor === 'object' ? job.jobAppliedFor : null;
  const candidate = job.candidate && typeof job.candidate === 'object' ? job.candidate : null;
  const applicantName = [job.formData?.firstName, job.formData?.lastName].filter(Boolean).join(' ');
  return {
    ...operational,
    organization: {
      id: String(organization?._id || job.organization || ''),
      name: organization?.name || 'Unknown organization'
    },
    uploader: actor ? {
      id: String(actor._id),
      name: personName(actor),
      email: actor.email || '',
      type: 'member'
    } : {
      id: '',
      name: applicantName || 'Public applicant',
      email: job.formData?.email || '',
      type: 'public'
    },
    application: appliedJob ? { id: String(appliedJob._id), title: appliedJob.title || 'Untitled job' } : null,
    candidate: candidate ? {
      id: String(candidate._id),
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Candidate',
      email: candidate.email || ''
    } : null,
    file: {
      name: job.originalName || '',
      type: job.fileType || '',
      size: Number(job.fileSize || 0)
    }
  };
}

function isOfflineError(error) {
  return ['AI_LOCAL_UNAVAILABLE', 'AI_LOCAL_NOT_CONFIGURED'].includes(error?.code)
    || String(error?.code || '').startsWith('LOCAL_LLM_')
    || /local cv runtime|local[- ]llm|ollama|vllm|fetch failed|could not be reached/i.test(String(error?.message || ''));
}

function cvBackoffDelay(attemptsMade, error) {
  const exponent = Math.max(0, Math.min(10, Number(attemptsMade || 1) - 1));
  const exponential = 30_000 * (2 ** exponent);
  return Math.min(exponential, isOfflineError(error) ? 5 * 60_000 : 10 * 60_000);
}

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

function idempotentStatusToken(organizationId, idempotencyKey) {
  const secret = String(process.env.CV_STATUS_TOKEN_SECRET || process.env.JWT_SECRET || 'development-only-cv-status-secret');
  return crypto.createHmac('sha256', secret).update(`${organizationId}:${idempotencyKey}`).digest('base64url');
}

function publicState(job) {
  return {
    jobId: job.publicId,
    state: job.state,
    progress: job.progress,
    position: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    candidateId: job.candidate ? String(job.candidate) : null,
    error: job.state === 'failed' ? job.lastError : undefined
  };
}

async function ensureConnection() {
  if (!connection) {
    const error = new Error('CV analysis Redis queue is disabled');
    error.code = 'CV_QUEUE_DISABLED';
    throw error;
  }
  if (connection.status === 'wait') await connection.connect();
}

async function getQueue() {
  await ensureConnection();
  if (!queue) queue = new Queue(queueName, { connection });
  return queue;
}

async function resolveOrganization(req) {
  const selected = req.user?.currentOrganization;
  if (selected) return String(selected);
  if (req.body?.jobId) {
    const job = await Job.findById(req.body.jobId).select('organization');
    if (job?.organization) return String(job.organization);
  }
  return null;
}

function safeFormData(body = {}) {
  const allowed = ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'skills', 'coverLetter', 'jobId'];
  return Object.fromEntries(allowed.filter((key) => body[key] != null).map((key) => [key, String(body[key]).slice(0, 20_000)]));
}

async function submitUpload(req, source = 'private') {
  if (!req.file) {
    const error = new Error('No CV file was uploaded');
    error.statusCode = 400;
    throw error;
  }
  const organizationId = await resolveOrganization(req);
  if (!organizationId) {
    const error = new Error('Organization required. Public applications must include a valid jobId.');
    error.statusCode = 400;
    throw error;
  }

  const idempotencyKey = String(req.get?.('Idempotency-Key') || '').trim() || undefined;
  if (idempotencyKey) {
    const existing = await CVProcessingJob.findOne({ organization: organizationId, idempotencyKey });
    if (existing) return { job: existing, statusToken: idempotentStatusToken(organizationId, idempotencyKey), duplicate: true };
  }

  let upload;
  let resumeText;
  try {
    [upload, resumeText] = await Promise.all([
      cloudinary.uploadFile(req.file.path, req.file.mimetype),
      cvParser.parseCV(req.file.path, req.file.mimetype)
    ]);
  } finally {
    try { await unlinkAsync(req.file.path); } catch {}
  }
  if (!upload?.success) {
    const error = new Error(upload?.error || 'CV document upload failed');
    error.statusCode = 502;
    throw error;
  }
  if (!resumeText || resumeText.trim().length < 50) {
    const error = new Error('Could not extract readable text from this CV. Use a text-based PDF or DOCX.');
    error.statusCode = 422;
    throw error;
  }

  let resumeUrl = upload.resumeUrl;
  if (req.file.mimetype === 'application/pdf') {
    try { resumeUrl = cloudinary.getAccessiblePdfUrl(upload.publicId); } catch {}
  }
  const statusToken = idempotencyKey
    ? idempotentStatusToken(organizationId, idempotencyKey)
    : crypto.randomBytes(32).toString('base64url');
  const publicId = `cv_${crypto.randomUUID()}`;
  let job;
  try {
    job = await CVProcessingJob.create({
      publicId,
      statusTokenHash: tokenHash(statusToken),
      idempotencyKey,
      state: 'queued',
      progress: 10,
      organization: organizationId,
      actor: req.user?.id || undefined,
      jobAppliedFor: req.body?.jobId || undefined,
      source,
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      resumeText,
      cloudinary: { resumeUrl, publicId: upload.publicId, resourceType: upload.resourceType },
      formData: safeFormData(req.body)
    });
    await syncHistorySafely(job);
  } catch (error) {
    if (error?.code !== 11000 || !idempotencyKey) throw error;
    const existing = await CVProcessingJob.findOne({ organization: organizationId, idempotencyKey });
    if (!existing) throw error;
    return {
      job: existing,
      statusToken: idempotentStatusToken(organizationId, idempotencyKey),
      duplicate: true
    };
  }

  let enqueueDeferred = false;
  try {
    await addQueueJob(job);
  } catch (error) {
    enqueueDeferred = true;
    await CVProcessingJob.updateOne({ _id: job._id }, {
      $set: {
        lastError: {
          code: error.code || 'CV_QUEUE_UNAVAILABLE',
          message: String(error.message).slice(0, 1000),
          at: new Date()
        }
      }
    });
    await syncHistorySafely(job._id);
  }
  return { job, statusToken, duplicate: false, enqueueDeferred };
}

function candidatePayload(job, result) {
  const fields = result.extractedFields || {};
  const form = job.formData || {};
  return {
    firstName: fields.firstName || form.firstName || 'REVIEW',
    lastName: fields.lastName || form.lastName || 'REQUIRED',
    email: fields.email || form.email || `cv-${job.publicId}@placeholder.invalid`,
    phone: fields.phone || form.phone || 'Not provided',
    position: form.position || fields.position || 'Position TBD',
    experience: fields.experience || form.experience || 'See CV',
    education: fields.education || form.education || 'See CV',
    skills: Array.isArray(fields.skills) ? fields.skills.join(', ') : (fields.skills || form.skills || ''),
    location: fields.location || form.location || '',
    resumeUrl: job.cloudinary.resumeUrl,
    resumeText: job.resumeText,
    coverLetter: form.coverLetter || '',
    status: 'New',
    source: job.source === 'bulk' ? 'Bulk Upload' : 'Uploaded CV',
    organization: job.organization,
    createdBy: job.actor,
    jobAppliedFor: job.jobAppliedFor,
    cloudinaryPublicId: job.cloudinary.publicId,
    cloudinaryResourceType: job.cloudinary.resourceType,
    parsedData: fields,
    aiAnalysis: result.aiAnalysis || {},
    workExperience: result.workExperience || fields.workExperience,
    educationHistory: fields.educationHistory || [],
    certifications: fields.certifications || [],
    languages: fields.languages || [],
    awards: fields.awards || [],
    projects: fields.projects || [],
    publications: fields.publications || [],
    volunteerWork: fields.volunteerWork || [],
    professionalMemberships: fields.professionalMemberships || [],
    portfolioLinks: fields.portfolioLinks || {},
    additionalSections: fields.additionalSections || {},
    fullCVData: fields.fullCVData || fields,
    processingMetadata: {
      uploadSuccess: true,
      parseSuccess: true,
      aiSuccess: true,
      fileSize: job.fileSize,
      originalName: job.originalName,
      processedAt: new Date(),
      cvProcessingJobId: job.publicId
    }
  };
}

async function processJob(bullJob) {
  const processingJob = await CVProcessingJob.findById(bullJob.data.processingJobId).select('+resumeText +statusTokenHash');
  if (!processingJob) return { skipped: true };
  if (processingJob.state === 'completed' && processingJob.candidate) return { candidateId: String(processingJob.candidate), duplicate: true };
  await CVProcessingJob.updateOne({ _id: processingJob._id }, {
    $set: { state: 'processing', progress: 30, startedAt: processingJob.startedAt || new Date() },
    $inc: { attempts: 1 }
  });
  await syncHistorySafely(processingJob._id);
  await bullJob.updateProgress(30);
  try {
    const [organization, actor] = await Promise.all([
      Organization.findById(processingJob.organization).select('name').lean(),
      processingJob.actor
        ? User.findById(processingJob.actor).select('email profile.firstName profile.lastName profile.displayName').lean()
        : Promise.resolve(null)
    ]);
    const analysis = await runWithAIRequestContext({
      sourceApp: 'recruiter-cv-worker',
      organizationId: String(processingJob.organization),
      organizationName: organization?.name,
      actorId: processingJob.actor ? String(processingJob.actor) : undefined,
      actorName: personName(actor)
        || [processingJob.formData?.firstName, processingJob.formData?.lastName].filter(Boolean).join(' ')
        || (processingJob.source === 'public' ? 'Public applicant' : undefined),
      actorEmail: actor?.email || processingJob.formData?.email,
      jobId: processingJob.publicId,
      requestId: `cv-queue:${processingJob.publicId}`,
      promptVersion: 'candidate-cv-local-v1'
    }, () => cvParser.analyzeText(
      processingJob.resumeText,
      processingJob.source === 'ai-interview' ? 'ai_interview.cv_parse' : 'candidate.cv_parse'
    ));
    if (!analysis.success) {
      const error = new Error(analysis.error || 'Local CV analysis failed');
      error.code = 'AI_LOCAL_UNAVAILABLE';
      throw error;
    }
    await bullJob.updateProgress(75);
    const existing = await Candidate.findOne({ 'processingMetadata.cvProcessingJobId': processingJob.publicId });
    const candidate = existing || await Candidate.create(candidatePayload(processingJob, analysis));
    await CVProcessingJob.updateOne({ _id: processingJob._id }, {
      $set: { state: 'completed', progress: 100, candidate: candidate._id, completedAt: new Date() },
      $unset: { lastError: 1 }
    });
    await syncHistorySafely(processingJob._id);
    await bullJob.updateProgress(100);
    void embeddingService.createCandidateEmbedding(candidate)
      .then(() => Candidate.updateOne({ _id: candidate._id }, { $set: { isEmbedded: true, embeddingCreatedAt: new Date() } }))
      .catch((error) => console.error('CV queue embedding failed:', error.message));
    return { candidateId: String(candidate._id), jobId: processingJob.publicId };
  } catch (error) {
    console.error('CV queue processing attempt failed:', {
      jobId: processingJob.publicId,
      code: error.code || 'CV_ANALYSIS_ERROR',
      message: String(error.message).slice(0, 1000)
    });
    const offline = isOfflineError(error);
    const terminal = !offline && Number(bullJob.attemptsMade || 0) + 1 >= 5;
    await CVProcessingJob.updateOne({ _id: processingJob._id }, {
      $set: {
        state: terminal ? 'failed' : offline ? 'waiting_for_local_runtime' : 'queued',
        progress: terminal ? processingJob.progress : 20,
        ...(terminal ? { failedAt: new Date() } : {}),
        lastError: { code: error.code || 'CV_ANALYSIS_ERROR', message: String(error.message).slice(0, 1000), at: new Date() }
      }
    });
    await syncHistorySafely(processingJob._id);
    if (terminal) bullJob.discard();
    throw error;
  }
}

async function addQueueJob(job) {
  const q = await getQueue();
  const jobsAheadForOrganization = await CVProcessingJob.countDocuments({
    organization: job.organization,
    state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
    createdAt: { $lt: job.createdAt }
  });
  return q.add('analyze-cv', { processingJobId: String(job._id) }, {
    jobId: job.publicId,
    attempts: 2_147_483_647,
    backoff: { type: 'cv-runtime', delay: 30_000 },
    priority: Math.min(2_097_152, jobsAheadForOrganization + 1),
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 }
  });
}

async function enqueueExistingJob(processingJobId) {
  const job = await CVProcessingJob.findById(processingJobId);
  if (!job) throw new Error('CV processing job not found');
  return addQueueJob(job);
}

async function recoverStaleJobs() {
  const q = await getQueue();
  const stale = await CVProcessingJob.find({
    state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
    updatedAt: { $lt: new Date(Date.now() - 60_000) }
  }).sort({ createdAt: 1 }).limit(500);
  let recovered = 0;
  for (const job of stale) {
    const existing = await q.getJob(job.publicId);
    if (!existing) {
      await addQueueJob(job);
      recovered += 1;
    }
  }
  return recovered;
}

async function publishTelemetry() {
  const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  const baseUrl = String(process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, '');
  if (!secret || !baseUrl) return false;
  const snapshot = await telemetry();
  const body = JSON.stringify({
    schemaVersion: 2,
    waiting: Number(snapshot.counts.waiting || 0) + Number(snapshot.counts.prioritized || 0),
    active: snapshot.counts.active,
    delayed: snapshot.counts.delayed,
    completed: snapshot.counts.completed,
    failed: snapshot.counts.failed,
    oldestWaitMs: snapshot.oldestQueuedAt ? Date.now() - new Date(snapshot.oldestQueuedAt).getTime() : 0,
    paused: snapshot.paused,
    workerConcurrency: workerConcurrency(),
    available: snapshot.available,
    queue: snapshot.queue,
    sampledAt: snapshot.sampledAt,
    counts: snapshot.counts,
    durable: snapshot.durable,
    rates: snapshot.rates,
    worker: snapshot.worker,
    oldestQueuedAt: snapshot.oldestQueuedAt,
    recentJobs: snapshot.recentJobs
  });
  const signed = signLocalRequest(secret, body);
  const response = await fetch(`${baseUrl}/v1/queue-telemetry`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined
  });
  if (!response.ok) return false;
  const control = await response.json().catch(() => ({}));
  const desiredConcurrency = Math.max(1, Math.min(128, Number(control.desiredConcurrency || concurrency)));
  if (worker && Number.isFinite(desiredConcurrency)) worker.concurrency = desiredConcurrency;
  const q = await getQueue();
  const currentlyPaused = await q.isPaused();
  if (control.desiredPaused === true && !currentlyPaused) await q.pause();
  if (control.desiredPaused === false && currentlyPaused) await q.resume();
  return true;
}

async function initWorker() {
  if (worker) return worker;
  try {
    await getQueue();
  } catch (error) {
    if (!initRetryTimer) {
      initRetryTimer = setInterval(() => {
        void initWorker().catch(() => {});
      }, 30_000);
      initRetryTimer.unref?.();
    }
    throw error;
  }
  if (initRetryTimer) clearInterval(initRetryTimer);
  initRetryTimer = null;
  worker = new Worker(queueName, processJob, {
    connection,
    concurrency,
    settings: {
      backoffStrategy: (attemptsMade, type, error) => {
        if (type !== 'cv-runtime') throw new Error(`Unsupported CV queue backoff type: ${type}`);
        return cvBackoffDelay(attemptsMade, error);
      }
    }
  });
  worker.on('error', (error) => console.error('CV analysis worker error:', error.message));
  worker.on('failed', async (job, error) => {
    if (!job || Number(job.attemptsMade || 0) < Number(job.opts.attempts || 0)) return;
    await CVProcessingJob.updateOne({ publicId: job.id }, {
      $set: {
        state: 'failed',
        failedAt: new Date(),
        lastError: { code: error.code || 'CV_ANALYSIS_FAILED', message: String(error.message).slice(0, 1000), at: new Date() }
      }
    });
    const processingJob = await CVProcessingJob.findOne({ publicId: job.id }).select('_id').lean();
    if (processingJob) await syncHistorySafely(processingJob._id);
  });
  await backfillHistory().catch((error) => {
    console.error('CV processing history backfill failed:', error.message);
  });
  await recoverStaleJobs();
  if (!maintenanceTimer) {
    maintenanceTimer = setInterval(() => {
      void recoverStaleJobs().catch(() => {});
    }, 30_000);
    maintenanceTimer.unref?.();
  }
  if (!telemetryTimer) {
    telemetryTimer = setInterval(() => {
      void publishTelemetry().catch(() => {});
    }, 5_000);
    telemetryTimer.unref?.();
  }
  void publishTelemetry().catch(() => {});
  return worker;
}

async function getStatus(publicId, statusToken) {
  const job = await CVProcessingJob.findOne({ publicId }).select('+statusTokenHash').populate('candidate');
  if (!job || !statusToken || !hashesMatch(tokenHash(statusToken), job.statusTokenHash)) return null;
  const result = publicState(job);
  if (job.state === 'completed' && job.candidate && typeof job.candidate === 'object') {
    result.candidate = job.candidate.toObject ? job.candidate.toObject() : job.candidate;
  }
  if (['queued', 'waiting_for_local_runtime'].includes(job.state)) {
    try {
      const q = await getQueue();
      const waiting = await q.getJobs(['prioritized', 'waiting', 'delayed'], 0, 5000, true);
      const index = waiting.findIndex((item) => item.id === publicId);
      result.position = index >= 0 ? index + 1 : null;
    } catch {
      result.queueAvailable = false;
    }
  }
  return result;
}

async function telemetry() {
  const sampledAt = new Date();
  const oneHourAgo = new Date(sampledAt.getTime() - 60 * 60_000);
  const fiveMinutesAgo = new Date(sampledAt.getTime() - 5 * 60_000);
  const [
    oldest,
    stateRows,
    recentRows,
    recentCompletedRows,
    completedLast5Minutes,
    completedLastHour,
    failedLastHour,
    retrying
  ] = await Promise.all([
    CVProcessingJob.findOne({ state: { $in: ['queued', 'waiting_for_local_runtime'] } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean(),
    CVProcessingJob.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]),
    CVProcessingJob.find({})
      .sort({ updatedAt: -1 })
      .limit(12)
      .select('publicId source state progress attempts createdAt startedAt completedAt failedAt updatedAt lastError.code')
      .lean(),
    CVProcessingJob.find({ state: 'completed', completedAt: { $gte: oneHourAgo }, startedAt: { $ne: null } })
      .sort({ completedAt: -1 })
      .limit(500)
      .select('startedAt completedAt')
      .lean(),
    CVProcessingJob.countDocuments({ state: 'completed', completedAt: { $gte: fiveMinutesAgo } }),
    CVProcessingJob.countDocuments({ state: 'completed', completedAt: { $gte: oneHourAgo } }),
    CVProcessingJob.countDocuments({ state: 'failed', failedAt: { $gte: oneHourAgo } }),
    CVProcessingJob.countDocuments({
      state: { $in: ['queued', 'waiting_for_local_runtime', 'processing'] },
      attempts: { $gt: 1 }
    })
  ]);
  const durable = Object.fromEntries(stateRows.map((row) => [String(row._id), Number(row.count || 0)]));
  const durations = recentCompletedRows
    .map((job) => elapsedMs(job.startedAt, job.completedAt))
    .filter((value) => Number.isFinite(value));
  const operational = {
    sampledAt: sampledAt.toISOString(),
    durable: {
      queued: Number(durable.queued || 0),
      waitingForRuntime: Number(durable.waiting_for_local_runtime || 0),
      processing: Number(durable.processing || 0),
      completed: Number(durable.completed || 0),
      failed: Number(durable.failed || 0),
      retrying
    },
    rates: {
      completedLast5Minutes,
      completedLastHour,
      failedLastHour,
      averageProcessingMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : 0,
      p95ProcessingMs: percentile(durations, 0.95)
    },
    oldestQueuedAt: oldest?.createdAt || null,
    oldestWaitMs: oldest?.createdAt ? elapsedMs(oldest.createdAt, sampledAt) : 0,
    recentJobs: recentRows.map((job) => operationalJob(job, sampledAt))
  };
  try {
    const q = await getQueue();
    const counts = await q.getJobCounts('prioritized', 'waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
    counts.waitingTotal = Number(counts.waiting || 0) + Number(counts.prioritized || 0);
    const active = Number(counts.active || 0);
    const configuredConcurrency = workerConcurrency();
    return {
      queue: queueName,
      concurrency: configuredConcurrency,
      available: true,
      counts,
      paused: await q.isPaused(),
      worker: {
        running: Boolean(worker),
        concurrency: configuredConcurrency,
        active,
        availableSlots: Math.max(0, configuredConcurrency - active),
        utilizationPercent: Math.min(100, Math.round((active / configuredConcurrency) * 100))
      },
      ...operational
    };
  } catch (error) {
    const waiting = operational.durable.queued + operational.durable.waitingForRuntime;
    const active = operational.durable.processing;
    const configuredConcurrency = workerConcurrency();
    return {
      queue: queueName,
      concurrency: configuredConcurrency,
      available: false,
      counts: {
        prioritized: 0,
        waiting,
        waitingTotal: waiting,
        active,
        delayed: operational.durable.waitingForRuntime,
        completed: operational.durable.completed,
        failed: operational.durable.failed,
        paused: 0
      },
      paused: false,
      worker: {
        running: Boolean(worker),
        concurrency: configuredConcurrency,
        active,
        availableSlots: Math.max(0, configuredConcurrency - active),
        utilizationPercent: Math.min(100, Math.round((active / configuredConcurrency) * 100))
      },
      error: error.message,
      ...operational
    };
  }
}

function adminJobQuery(filter, limit) {
  let query = CVProcessingJob.find(filter)
    .sort({ updatedAt: -1 });
  if (limit) query = query.limit(limit);
  return query
    .select('publicId source state progress attempts createdAt startedAt completedAt failedAt updatedAt lastError originalName fileType fileSize organization actor jobAppliedFor candidate formData.firstName formData.lastName formData.email formData.position formData.location')
    .populate('organization', 'name')
    .populate('actor', 'email profile.firstName profile.lastName profile.displayName')
    .populate('jobAppliedFor', 'title')
    .populate('candidate', 'firstName lastName email')
    .lean();
}

async function adminTelemetry() {
  const [snapshot, jobs] = await Promise.all([
    telemetry(),
    adminJobQuery({}, 25)
  ]);
  const sampledAt = new Date(snapshot.sampledAt || Date.now());
  return {
    ...snapshot,
    recentJobs: jobs.map((job) => adminOperationalJob(job, sampledAt))
  };
}

async function getAdminJobDetail(publicId) {
  const jobs = await adminJobQuery({ publicId: String(publicId || '') }, 1);
  if (!jobs[0]) return null;
  return adminOperationalJob(jobs[0], new Date());
}

async function setPaused(paused) {
  const q = await getQueue();
  if (paused) await q.pause(); else await q.resume();
  return telemetry();
}

async function closeForTests() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = null;
  if (initRetryTimer) clearInterval(initRetryTimer);
  initRetryTimer = null;
  historyBackfillPromise = null;
  if (worker) await worker.close();
  worker = null;
  if (queue) await queue.close();
  queue = null;
  if (connection) await connection.quit();
}

async function submitBatch(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    const error = new Error('No CV files were uploaded');
    error.statusCode = 400;
    throw error;
  }
  const organizationId = await resolveOrganization(req);
  if (!organizationId) {
    const error = new Error('Organization required');
    error.statusCode = 400;
    throw error;
  }
  const jobs = [];
  const rejected = [];
  const baseIdempotency = String(req.get?.('Idempotency-Key') || crypto.randomUUID());
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const childRequest = {
        ...req,
        file,
        files: undefined,
        body: req.body || {},
        get: (name) => name.toLowerCase() === 'idempotency-key' ? `${baseIdempotency}:${index}` : req.get?.(name)
      };
      const submitted = await submitUpload(childRequest, 'bulk');
      jobs.push(submitted.job._id);
    } catch (error) {
      rejected.push({ fileName: file.originalname, error: error.message });
    }
  }
  const batch = await CVProcessingBatch.create({
    publicId: `batch_${crypto.randomUUID()}`,
    organization: organizationId,
    actor: req.user?.id,
    jobs,
    rejected,
    totalFiles: files.length
  });
  return getBatchStatus(batch.publicId, organizationId);
}

async function getBatchStatus(publicId, organizationId) {
  const batch = await CVProcessingBatch.findOne({ publicId, organization: organizationId }).populate('jobs');
  if (!batch) return null;
  const jobs = batch.jobs || [];
  const completedJobs = jobs.filter((job) => job.state === 'completed');
  const failedJobs = jobs.filter((job) => job.state === 'failed');
  const waitingJobs = jobs.filter((job) => ['queued', 'waiting_for_local_runtime'].includes(job.state));
  const activeJobs = jobs.filter((job) => job.state === 'processing');
  const completed = completedJobs.length + failedJobs.length + batch.rejected.length;
  return {
    batchId: batch.publicId,
    totalFiles: batch.totalFiles,
    completed,
    successful: completedJobs.length,
    failed: failedJobs.length + batch.rejected.length,
    processing: activeJobs.length,
    queued: waitingJobs.length,
    state: completed >= batch.totalFiles
      ? 'completed'
      : waitingJobs.some((job) => job.state === 'waiting_for_local_runtime') ? 'waiting_for_local_runtime' : 'processing',
    results: completedJobs.map((job) => ({ fileName: job.originalName, candidateId: String(job.candidate), success: true })),
    errors: [
      ...batch.rejected.map((item) => ({ fileName: item.fileName, error: item.error, success: false })),
      ...failedJobs.map((job) => ({ fileName: job.originalName, error: job.lastError?.message, success: false }))
    ],
    startedAt: batch.createdAt,
    completedAt: completed >= batch.totalFiles ? new Date().toISOString() : null
  };
}

module.exports = {
  adminTelemetry,
  closeForTests,
  enqueueExistingJob,
  getBatchStatus,
  getAdminJobDetail,
  getStatus,
  initWorker,
  listHistory,
  publishTelemetry,
  cvBackoffDelay,
  isOfflineError,
  publicState,
  recoverStaleJobs,
  setPaused,
  submitBatch,
  submitUpload,
  telemetry,
  tokenHash
};
