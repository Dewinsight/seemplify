const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.REDIS_ENABLED = 'false';
process.env.LOCAL_LLM_SHARED_SECRET = '';
process.env.LOCAL_LLM_BASE_URL = '';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Candidate = require('../models/Candidate');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingBatch = require('../models/CVProcessingBatch');
const CVProcessingJob = require('../models/CVProcessingJob');
const CVStorageCleanupTask = require('../models/CVStorageCleanupTask');
const durableCvFileStore = require('../services/durableCvFileStore');
const embeddingService = require('../services/embeddingService');
const creditsService = require('../services/creditsService');
const { deductCredits } = require('../middleware/creditsMiddleware');

embeddingService.createCandidateEmbedding = async () => ({ skipped: true });

const cvQueue = require('../services/cvAnalysisQueueService');

const organizationId = new mongoose.Types.ObjectId();
const resumeBytes = Buffer.from([
  'Ada Lovelace',
  'ada.lovelace@example.com',
  'Senior Software Engineer with extensive distributed systems experience.',
  'Skills include JavaScript, Node.js, MongoDB, Redis, Docker, and Kubernetes.'
].join('\n'));
const extractedText = resumeBytes.toString('utf8');

let mongo;
let fixtureDirectory;

function requestFor(filePath, idempotencyKey = cryptoKey()) {
  return {
    file: {
      path: filePath,
      originalname: 'ada-lovelace.txt',
      mimetype: 'text/plain',
      size: resumeBytes.length
    },
    body: {},
    user: { currentOrganization: organizationId },
    get(name) {
      return String(name).toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined;
    }
  };
}

function cryptoKey() {
  return `durable-${new mongoose.Types.ObjectId()}`;
}

async function fixtureFile() {
  const filePath = path.join(fixtureDirectory, `${new mongoose.Types.ObjectId()}.txt`);
  await fs.promises.writeFile(filePath, resumeBytes);
  return filePath;
}

function bullJob(processingJob, attemptsMade = 0) {
  return {
    data: { processingJobId: String(processingJob._id) },
    attemptsMade,
    progress: [],
    async updateProgress(value) {
      this.progress.push(value);
    },
    discard() {
      this.discarded = true;
    }
  };
}

function successfulAnalysis() {
  return {
    success: true,
    extractedFields: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.lovelace@example.com',
      phone: '+44 7700 900123',
      position: 'Senior Software Engineer',
      experience: 'Eight years',
      education: 'BSc Computer Science',
      skills: ['JavaScript', 'Node.js'],
      location: 'London'
    },
    aiAnalysis: { summary: 'Experienced software engineer' }
  };
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Candidate.syncIndexes();
  fixtureDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seemplify-durable-cv-test-'));
});

test.after(async () => {
  await cvQueue.closeForTests();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fixtureDirectory) await fs.promises.rm(fixtureDirectory, { recursive: true, force: true });
});

test.beforeEach(async () => {
  durableCvFileStore._resetDependenciesForTests();
  cvQueue._resetDependenciesForTests();
  cvQueue._setDependenciesForTests({
    enqueueJob: async () => ({ id: 'queued-for-test' })
  });
  await Promise.all([
    Candidate.deleteMany({}),
    CVProcessingJob.deleteMany({}),
    CVProcessingAudit.deleteMany({}),
    CVStorageCleanupTask.deleteMany({})
  ]);
});

test('submission is immediately visible and does not await Cloudinary or text extraction', async () => {
  let extractionCalls = 0;
  let cloudinaryCalls = 0;
  let durableWrites = 0;
  cvQueue._setDependenciesForTests({
    durableFileStore: {
      async persistPath() {
        durableWrites += 1;
        return {
          provider: 'gridfs',
          bucket: 'test',
          fileId: new mongoose.Types.ObjectId().toString(),
          sha256: 'a'.repeat(64),
          length: resumeBytes.length,
          persistedAt: new Date()
        };
      },
      async remove() {
        return true;
      }
    },
    cvParser: {
      async parseCV() {
        extractionCalls += 1;
        await new Promise(() => {});
      }
    },
    cloudinary: {
      async uploadFile() {
        cloudinaryCalls += 1;
        await new Promise(() => {});
      }
    }
  });
  const startedAt = Date.now();
  const idempotencyKey = cryptoKey();
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile(), idempotencyKey), 'private');
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1_000, `submission waited ${elapsedMs} ms`);
  assert.equal(result.job.state, 'queued');
  assert.equal(result.job.stage, 'ingesting');
  assert.equal(result.job.progress, 5);
  assert.equal(result.job.expiresAt, undefined);
  assert.equal(extractionCalls, 0);
  assert.equal(cloudinaryCalls, 0);
  assert.equal(durableWrites, 1);

  const visible = await CVProcessingJob.findOne({ publicId: result.job.publicId }).select('+resumeText').lean();
  assert.ok(visible?.durableFile?.fileId);
  assert.equal(visible.resumeText, '');

  const duplicate = await cvQueue.submitUpload(requestFor(await fixtureFile(), idempotencyKey), 'private');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.publicId, result.job.publicId);
  assert.equal(durableWrites, 1);
  assert.equal(await CVProcessingJob.countDocuments({}), 1);
});

test('an idempotent upload replay cannot trigger a second credit debit', async () => {
  const originalConsumeCredits = creditsService.consumeCredits;
  let deductions = 0;
  creditsService.consumeCredits = async () => {
    deductions += 1;
  };
  try {
    const req = {
      method: 'POST',
      path: '/upload-cv',
      user: { currentOrganization: organizationId, id: new mongoose.Types.ObjectId() },
      creditsAction: { action: 'uploadCandidate', cost: 1, entityType: 'candidate' },
      params: {}
    };
    const res = {
      status() {
        return this;
      },
      json(data) {
        this.body = data;
        return data;
      }
    };
    deductCredits(req, res, () => {});
    await res.status(202).json({
      jobId: 'cv_idempotent_replay',
      idempotentReplay: true
    });
    assert.equal(deductions, 0);
  } finally {
    creditsService.consumeCredits = originalConsumeCredits;
  }
});

test('durable bytes survive removal of the request temp file and can be materialized after reload', async () => {
  const filePath = await fixtureFile();
  const result = await cvQueue.submitUpload(requestFor(filePath), 'private');
  assert.equal(fs.existsSync(filePath), false);

  const reloaded = await CVProcessingJob.findById(result.job._id).lean();
  const materialized = await durableCvFileStore.materialize(reloaded.durableFile, {
    originalName: reloaded.originalName
  });
  try {
    assert.deepEqual(await fs.promises.readFile(materialized.filePath), resumeBytes);
  } finally {
    await materialized.cleanup();
  }
});

test('completed GridFS upload is deleted when SHA metadata finalization fails', async () => {
  const files = mongoose.connection.db.collection('cv_ingestion_files.files');
  const chunks = mongoose.connection.db.collection('cv_ingestion_files.chunks');
  const filePath = await fixtureFile();
  const [filesBefore, chunksBefore] = await Promise.all([
    files.countDocuments({}),
    chunks.countDocuments({})
  ]);
  durableCvFileStore._setMetadataFinalizerForTests(async () => {
    throw new Error('synthetic metadata update failure');
  });
  try {
    await assert.rejects(
      () => durableCvFileStore.persistPath(filePath, {
        originalName: 'metadata-failure.txt',
        fileType: 'text/plain',
        organizationId
      }),
      /synthetic metadata update failure/
    );
  } finally {
    durableCvFileStore._resetDependenciesForTests();
  }
  assert.equal(await files.countDocuments({}), filesBefore);
  assert.equal(await chunks.countDocuments({}), chunksBefore);
});

test('materialize rejects corrupt durable bytes and removes its worker output', async () => {
  const reference = await durableCvFileStore.persistPath(await fixtureFile(), {
    originalName: 'corrupt-reference.txt',
    fileType: 'text/plain',
    organizationId
  });
  const workerDirectories = () => new Set(
    fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('seemplify-cv-worker-'))
  );
  const before = workerDirectories();
  try {
    await assert.rejects(
      () => durableCvFileStore.materialize({
        ...reference,
        sha256: '0'.repeat(64)
      }, { originalName: 'corrupt-reference.txt' }),
      (error) => error.code === 'CV_DURABLE_FILE_CORRUPT'
    );
    const after = workerDirectories();
    assert.deepEqual([...after].filter((name) => !before.has(name)), []);
  } finally {
    await durableCvFileStore.remove(reference);
  }
});

test('worker cleanup refuses recursive removal outside its dedicated temp directory', () => {
  const safeDirectory = path.join(os.tmpdir(), 'seemplify-cv-worker-unit-test');
  assert.equal(durableCvFileStore.assertWorkerTempDirectory(safeDirectory), path.resolve(safeDirectory));
  assert.throws(
    () => durableCvFileStore.assertWorkerTempDirectory(path.join(os.tmpdir(), 'unrelated-directory')),
    (error) => error.code === 'CV_WORKER_TEMP_PATH_UNSAFE'
  );
});

test('upload and extraction failures retry from durable bytes and complete without duplicate candidates', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  let uploadCalls = 0;
  let extractionCalls = 0;
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async uploadFile() {
        uploadCalls += 1;
        if (uploadCalls === 1) return { success: false, error: 'synthetic upload failure' };
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      }
    },
    cvParser: {
      async parseCV() {
        extractionCalls += 1;
        return extractionCalls === 1 ? '' : extractedText;
      },
      async analyzeText() {
        return successfulAnalysis();
      }
    }
  });

  await assert.rejects(() => cvQueue._processJobForTests(bullJob(result.job, 0)), /synthetic upload failure/);
  let stored = await CVProcessingJob.findById(result.job._id).select('+resumeText');
  assert.equal(stored.state, 'queued');
  assert.equal(stored.stage, 'uploading');
  assert.equal(await Candidate.countDocuments({}), 0);

  await assert.rejects(() => cvQueue._processJobForTests(bullJob(result.job, 1)), /Could not extract readable text/);
  stored = await CVProcessingJob.findById(result.job._id).select('+resumeText');
  assert.equal(stored.state, 'queued');
  assert.equal(stored.stage, 'extracting');
  assert.equal(uploadCalls, 2);

  await cvQueue._processJobForTests(bullJob(result.job, 2));
  stored = await CVProcessingJob.findById(result.job._id);
  assert.equal(stored.state, 'completed');
  assert.equal(stored.stage, 'completed');
  assert.ok(stored.expiresAt > stored.completedAt);
  assert.equal(await Candidate.countDocuments({
    'processingMetadata.cvProcessingJobId': result.job.publicId
  }), 1);
});

test('full shared capacity preserves preprocessed durable state without counting an inference attempt', async () => {
  class SyntheticDelayedError extends Error {}
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  const runner = cvQueue._createGlobalDispatchInferenceRunner({
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
  cvQueue._setDependenciesForTests({
    dispatchInferenceRunner: runner,
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      }
    },
    cvParser: {
      async parseCV() {
        return extractedText;
      },
      async analyzeText() {
        throw new Error('inference must not start while shared capacity is full');
      }
    }
  });
  const delivery = bullJob(result.job);
  const moves = [];
  delivery.moveToDelayed = async (timestamp, token) => {
    moves.push({ timestamp, token });
  };
  await assert.rejects(
    () => cvQueue._processJobForTests(delivery, 'worker-token'),
    (error) => error instanceof SyntheticDelayedError
      && error.code === 'CV_GLOBAL_DISPATCH_DEFERRED'
  );
  const stored = await CVProcessingJob.findById(result.job._id).select('+resumeText').lean();
  assert.equal(stored.state, 'waiting_for_local_runtime');
  assert.equal(stored.stage, 'analyzing');
  assert.equal(stored.attempts, 0);
  assert.equal(stored.boundedFailureAttempts, 0);
  assert.equal(stored.resumeText, extractedText);
  assert.ok(stored.cloudinary?.publicId);
  assert.deepEqual(moves, [{ timestamp: 1_250, token: 'worker-token' }]);
});

test('offline and BUSY deliveries do not consume the five bounded failure attempts', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  const deferredErrors = [
    Object.assign(new Error('Local CV runtime could not be reached'), { code: 'AI_LOCAL_UNAVAILABLE' }),
    Object.assign(new Error('Local CV runtime could not be reached'), { code: 'LOCAL_LLM_UNAVAILABLE' }),
    Object.assign(new Error('Inference capacity is occupied'), { code: 'LOCAL_LLM_BUSY' }),
    Object.assign(new Error('Inference capacity is occupied'), { code: 'LOCAL_LLM_BUSY' })
  ];
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile() {
        return { success: true, result: 'ok' };
      }
    },
    cvParser: {
      async parseCV() {
        return extractedText;
      },
      async analyzeText() {
        if (deferredErrors.length) throw deferredErrors.shift();
        throw Object.assign(new Error('Synthetic schema validation failure'), {
          code: 'CV_SCHEMA_INVALID'
        });
      }
    }
  });

  for (let index = 0; index < 4; index += 1) {
    const delivery = bullJob(result.job, 10_000 + index);
    await assert.rejects(
      () => cvQueue._processJobForTests(delivery),
      /could not be reached|capacity is occupied/i
    );
    const stored = await CVProcessingJob.findById(result.job._id);
    assert.equal(stored.state, 'waiting_for_local_runtime');
    assert.equal(stored.boundedFailureAttempts, 0);
    assert.notEqual(delivery.discarded, true);
  }

  for (let failure = 1; failure <= 5; failure += 1) {
    const delivery = bullJob(result.job, 20_000 + failure);
    await assert.rejects(
      () => cvQueue._processJobForTests(delivery),
      /Synthetic schema validation failure/
    );
    const stored = await CVProcessingJob.findById(result.job._id);
    assert.equal(stored.boundedFailureAttempts, failure);
    assert.equal(stored.state, failure === 5 ? 'failed' : 'queued');
    assert.equal(delivery.discarded === true, failure === 5);
  }
});

test('terminal failure retains private CV assets and exposes a retryable audit trail', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  await CVProcessingJob.updateOne(
    { _id: result.job._id },
    { $set: { boundedFailureAttempts: 4 } }
  );
  const deletions = [];
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile(...args) {
        deletions.push(args);
        return { success: true, result: 'ok' };
      }
    },
    cvParser: {
      async parseCV() {
        return '';
      }
    }
  });

  const delivery = bullJob(result.job, 50_000);
  await assert.rejects(
    () => cvQueue._processJobForTests(delivery),
    /Could not extract readable text/
  );

  const stored = await CVProcessingJob.findById(result.job._id);
  assert.equal(stored.state, 'failed');
  assert.equal(stored.boundedFailureAttempts, 5);
  assert.equal(delivery.discarded, true);
  assert.equal(stored.expiresAt, undefined);
  assert.equal(stored.cloudinary.cleanupState, 'retained');
  assert.equal(stored.durableFile.cleanupState, 'retained');
  assert.equal(stored.cloudinary.releasedAt, undefined);
  assert.equal(stored.durableFile.releasedAt, undefined);
  assert.ok(stored.retry.availableUntil > stored.failedAt);
  assert.ok(stored.cloudinary.cleanupNextAttemptAt >= stored.retry.availableUntil);
  assert.ok(stored.durableFile.cleanupNextAttemptAt >= stored.retry.availableUntil);
  assert.deepEqual(deletions, []);

  const detail = await cvQueue.getAdminJobDetail(result.job.publicId);
  assert.equal(detail.retry.available, true);
  assert.equal(detail.retry.canRetryParsing, true);
  assert.equal(detail.retry.canRetryAnalysis, false);
  assert.equal(detail.retry.storage.cloudinary, true);
  assert.equal(detail.retry.storage.durable, true);
  assert.equal(detail.attemptHistory.length, 1);
  assert.equal(detail.attemptHistory[0].trigger, 'initial');
  assert.equal(detail.attemptHistory[0].status, 'failed');
  assert.equal(detail.attemptHistory[0].stage, 'extracting');
  assert.equal(detail.attemptHistory[0].errorCode, 'CV_TEXT_EXTRACTION_FAILED');

  const staleDelivery = await cvQueue._processJobForTests(bullJob(stored, 5));
  assert.deepEqual(staleDelivery, { skipped: true });
  const unchanged = await CVProcessingJob.findById(result.job._id);
  assert.equal(unchanged.processingAttempts, 1);
  assert.equal(unchanged.attemptHistory.length, 1);
});

test('five retryable service failures park the recruiter CV for a later durable cycle', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile() { return { success: true, result: 'ok' }; }
    },
    cvParser: {
      async parseCV() { return extractedText; },
      async analyzeText() {
        throw Object.assign(new Error('Temporary inference service failure'), {
          code: 'INFERENCE_UPSTREAM_FAILED', retryable: true, status: 503
        });
      }
    }
  });
  for (let failure = 1; failure <= 5; failure += 1) {
    const delivery = bullJob(result.job, failure - 1);
    await assert.rejects(() => cvQueue._processJobForTests(delivery), /Temporary inference service failure/);
    const stored = await CVProcessingJob.findById(result.job._id);
    assert.equal(stored.state, failure === 5 ? 'waiting_for_local_runtime' : 'queued');
    assert.equal(stored.boundedFailureAttempts, failure === 5 ? 0 : failure);
    assert.notEqual(delivery.discarded, true);
  }
  const parked = await CVProcessingJob.findById(result.job._id).select('+resumeText');
  assert.equal(parked.retry.deferredCycles, 1);
  assert.ok(parked.retry.nextAttemptAt > new Date());
  assert.ok(parked.resumeText);
  assert.ok(parked.durableFile.fileId);
  assert.equal(parked.expiresAt, undefined);
});

test('retained failed assets are deleted only after retry availability expires', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  await CVProcessingJob.updateOne(
    { _id: result.job._id },
    { $set: { boundedFailureAttempts: 4 } }
  );
  let deletionAttempts = 0;
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile() {
        deletionAttempts += 1;
        return deletionAttempts === 1
          ? { success: false, error: 'synthetic Cloudinary outage' }
          : { success: true, result: 'not_found' };
      }
    },
    cvParser: {
      async parseCV() {
        return '';
      }
    }
  });

  await assert.rejects(
    () => cvQueue._processJobForTests(bullJob(result.job, 99_999)),
    /Could not extract readable text/
  );

  let stored = await CVProcessingJob.findById(result.job._id);
  assert.equal(stored.state, 'failed');
  assert.equal(stored.cloudinary.cleanupState, 'retained');
  assert.equal(stored.expiresAt, undefined);
  assert.equal(deletionAttempts, 0);
  assert.equal(await CVStorageCleanupTask.countDocuments({}), 0);

  const dueAt = new Date(Date.now() - 1_000);
  await CVProcessingJob.updateOne(
    { _id: result.job._id },
    {
      $set: {
        'retry.availableUntil': dueAt,
        'cloudinary.cleanupNextAttemptAt': dueAt,
        'durableFile.cleanupNextAttemptAt': dueAt
      }
    }
  );
  await cvQueue._retryStorageCleanupForTests({ now: new Date() });

  stored = await CVProcessingJob.findById(result.job._id);
  let cleanupTask = await CVStorageCleanupTask.findOne({
    provider: 'cloudinary',
    jobPublicId: result.job.publicId
  });
  assert.equal(deletionAttempts, 1);
  assert.equal(stored.cloudinary.cleanupState, 'failed');
  assert.ok(stored.durableFile.releasedAt);
  assert.equal(stored.expiresAt, undefined);
  assert.equal(cleanupTask.state, 'failed');
  assert.equal(cleanupTask.expiresAt, undefined);

  await Promise.all([
    CVProcessingJob.updateOne(
      { _id: result.job._id },
      { $set: { 'cloudinary.cleanupNextAttemptAt': dueAt } }
    ),
    CVStorageCleanupTask.updateOne(
      { _id: cleanupTask._id },
      { $set: { nextAttemptAt: dueAt } }
    )
  ]);
  await cvQueue._retryStorageCleanupForTests({ now: new Date() });

  stored = await CVProcessingJob.findById(result.job._id);
  cleanupTask = await CVStorageCleanupTask.findById(cleanupTask._id);
  assert.equal(deletionAttempts, 2);
  assert.equal(stored.cloudinary.cleanupState, 'deleted');
  assert.ok(stored.expiresAt instanceof Date);
  assert.equal(cleanupTask.state, 'completed');
  assert.ok(cleanupTask.expiresAt instanceof Date);
});

test('manual analysis retry preserves the failed-to-success trail and candidate Cloudinary CV', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  await CVProcessingJob.updateOne(
    { _id: result.job._id },
    { $set: { boundedFailureAttempts: 4 } }
  );
  let analysisCalls = 0;
  let cloudinaryDeletes = 0;
  const queueRequests = [];
  cvQueue._setDependenciesForTests({
    enqueueJob: async (job, options) => {
      queueRequests.push({ jobId: job.publicId, options });
      return { id: job.publicId };
    },
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile() {
        cloudinaryDeletes += 1;
        return { success: true, result: 'ok' };
      }
    },
    cvParser: {
      async parseCV() {
        return extractedText;
      },
      async analyzeText() {
        analysisCalls += 1;
        if (analysisCalls === 1) {
          throw Object.assign(new Error('Synthetic terminal analysis failure'), {
            code: 'CV_SCHEMA_INVALID'
          });
        }
        return successfulAnalysis();
      }
    }
  });

  await assert.rejects(
    () => cvQueue._processJobForTests(bullJob(result.job, 4)),
    /Synthetic terminal analysis failure/
  );
  let stored = await CVProcessingJob.findById(result.job._id).select('+resumeText');
  assert.equal(stored.state, 'failed');
  assert.equal(stored.lastError.stage, 'analyzing');
  assert.equal(stored.resumeText, extractedText);

  const requestedBy = {
    type: 'admin',
    id: String(new mongoose.Types.ObjectId()),
    name: 'Platform Operator',
    email: 'operator@example.com'
  };
  const retry = await cvQueue.retryFailedJob(result.job.publicId, {
    organizationId,
    requestedBy,
    stage: 'analysis'
  });
  assert.equal(retry.queueAvailable, true);
  assert.equal(retry.effectiveStage, 'analysis');
  assert.deepEqual(queueRequests, [{
    jobId: result.job.publicId,
    options: { replaceTerminal: true }
  }]);

  stored = await CVProcessingJob.findById(result.job._id).select('+resumeText');
  assert.equal(stored.state, 'queued');
  assert.equal(stored.stage, 'analyzing');
  assert.equal(stored.retry.manualRequests, 1);
  assert.equal(stored.retry.pendingTrigger, 'manual');
  assert.equal(stored.retry.lastRequestedBy.email, requestedBy.email);
  assert.equal(stored.resumeText, extractedText);

  await assert.rejects(
    () => cvQueue.retryFailedJob(result.job.publicId, {
      organizationId,
      requestedBy,
      stage: 'analysis'
    }),
    (error) => error.code === 'CV_RETRY_NOT_FAILED'
  );

  await cvQueue._processJobForTests(bullJob(stored, 0));
  stored = await CVProcessingJob.findById(result.job._id);
  assert.equal(stored.state, 'completed');
  assert.equal(stored.processingAttempts, 2);
  assert.equal(stored.retry.manualRequests, 1);
  assert.equal(stored.attemptHistory.length, 2);
  assert.deepEqual(
    stored.attemptHistory.map((attempt) => [attempt.trigger, attempt.status]),
    [['initial', 'failed'], ['manual', 'completed']]
  );
  assert.equal(stored.attemptHistory[1].requestedBy.email, requestedBy.email);
  assert.ok(stored.durableFile.releasedAt);
  assert.equal(cloudinaryDeletes, 0);

  const candidate = await Candidate.findOne({
    'processingMetadata.cvProcessingJobId': result.job.publicId
  }).lean();
  assert.equal(candidate.resumeUrl, 'https://example.invalid/private-signed-cv');
  assert.equal(candidate.cloudinaryPublicId, `resumes/documents/${result.job.publicId}`);

  const detail = await cvQueue.getAdminJobDetail(result.job.publicId);
  assert.equal(detail.state, 'completed');
  assert.equal(detail.retry.manualRetries, 1);
  assert.equal(detail.attemptHistory[0].errorCode, 'CV_SCHEMA_INVALID');
  assert.equal(detail.attemptHistory[1].status, 'completed');

  const audit = await CVProcessingAudit.findOne({ publicId: result.job.publicId }).lean();
  assert.equal(audit.state, 'completed');
  assert.equal(audit.retry.manualRequests, 1);
  assert.deepEqual(
    audit.attemptHistory.map((attempt) => [attempt.trigger, attempt.status]),
    [['initial', 'failed'], ['manual', 'completed']]
  );
});

test('manual parsing retry is organization-scoped and reuses the retained original', async () => {
  const result = await cvQueue.submitUpload(requestFor(await fixtureFile()), 'private');
  await CVProcessingJob.updateOne(
    { _id: result.job._id },
    { $set: { boundedFailureAttempts: 4 } }
  );
  const queueRequests = [];
  cvQueue._setDependenciesForTests({
    enqueueJob: async (job, options) => {
      queueRequests.push({ jobId: job.publicId, options });
      return { id: job.publicId };
    },
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/private-signed-cv',
          publicId: `resumes/documents/${result.job.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      }
    },
    cvParser: {
      async parseCV() {
        return '';
      }
    }
  });
  await assert.rejects(
    () => cvQueue._processJobForTests(bullJob(result.job, 4)),
    /Could not extract readable text/
  );

  await assert.rejects(
    () => cvQueue.retryFailedJob(result.job.publicId, {
      organizationId: new mongoose.Types.ObjectId(),
      stage: 'parsing'
    }),
    (error) => error.code === 'CV_JOB_NOT_FOUND' && error.statusCode === 404
  );
  await assert.rejects(
    () => cvQueue.retryFailedJob(result.job.publicId, {
      organizationId,
      stage: 'analysis'
    }),
    (error) => error.code === 'CV_RETRY_ANALYSIS_UNAVAILABLE'
  );

  const retry = await cvQueue.retryFailedJob(result.job.publicId, {
    organizationId,
    requestedBy: { type: 'user', id: String(new mongoose.Types.ObjectId()) },
    stage: 'parsing'
  });
  assert.equal(retry.effectiveStage, 'parsing');
  assert.equal(retry.job.stage, 'extracting');
  assert.equal(retry.job.resumeText, '');
  assert.equal(retry.job.durableFile.cleanupState, 'retained');
  assert.equal(retry.job.cloudinary.cleanupState, 'retained');
  assert.deepEqual(queueRequests, [{
    jobId: result.job.publicId,
    options: { replaceTerminal: true }
  }]);
});

test('concurrent duplicate deliveries atomically create one candidate for one processing job', async () => {
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_atomic_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: cvQueue.tokenHash('atomic-token'),
    state: 'queued',
    stage: 'analyzing',
    progress: 50,
    organization: organizationId,
    source: 'private',
    originalName: 'legacy.pdf',
    fileType: 'application/pdf',
    fileSize: 1_024,
    resumeText: extractedText,
    cloudinary: {
      resumeUrl: 'https://example.invalid/private-signed-cv',
      publicId: 'resumes/documents/atomic',
      resourceType: 'raw',
      deliveryType: 'authenticated'
    },
    formData: {}
  });
  let analysisCalls = 0;
  cvQueue._setDependenciesForTests({
    cvParser: {
      async analyzeText() {
        analysisCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return successfulAnalysis();
      }
    }
  });

  const deliveries = await Promise.all([
    cvQueue._processJobForTests(bullJob(processingJob, 0)),
    cvQueue._processJobForTests(bullJob(processingJob, 0))
  ]);

  assert.equal(analysisCalls, 1);
  assert.equal(deliveries.filter((delivery) => delivery?.skipped === true).length, 1);
  assert.equal(await Candidate.countDocuments({
    'processingMetadata.cvProcessingJobId': processingJob.publicId
  }), 1);
  const completed = await CVProcessingJob.findById(processingJob._id).lean();
  assert.equal(completed.state, 'completed');
  assert.ok(completed.candidate);
});

test('a regressed queue state repairs from its committed candidate without another AI call', async () => {
  const publicId = `cv_committed_${new mongoose.Types.ObjectId()}`;
  const candidate = await Candidate.create({
    firstName: 'Already',
    lastName: 'Committed',
    email: `committed-${Date.now()}@example.com`,
    phone: '+44 20 7946 0958',
    position: 'Product Manager',
    experience: '10+',
    education: 'bachelors',
    organization: organizationId,
    processingMetadata: { cvProcessingJobId: publicId }
  });
  const processingJob = await CVProcessingJob.create({
    publicId,
    statusTokenHash: cvQueue.tokenHash('committed-token'),
    state: 'queued',
    stage: 'analyzing',
    progress: 50,
    organization: organizationId,
    source: 'bulk',
    originalName: 'committed.pdf',
    fileType: 'application/pdf',
    fileSize: 1_024,
    resumeText: extractedText,
    candidate: candidate._id,
    lastError: {
      code: 'AI_RUNTIME_ACCOUNT_REQUIRED',
      message: 'A duplicate delivery failed after completion',
      stage: 'analyzing',
      at: new Date()
    },
    formData: {}
  });
  let analysisCalls = 0;
  cvQueue._setDependenciesForTests({
    cvParser: {
      async analyzeText() {
        analysisCalls += 1;
        return successfulAnalysis();
      }
    }
  });

  const batch = await CVProcessingBatch.create({
    publicId: `batch_committed_${new mongoose.Types.ObjectId()}`,
    organization: organizationId,
    jobs: [processingJob._id],
    totalFiles: 1,
    rejected: []
  });
  const batchStatus = await cvQueue.getBatchStatus(batch.publicId, organizationId);
  assert.equal(batchStatus.successful, 1);
  assert.equal(batchStatus.processing, 0);
  assert.equal(batchStatus.queued, 0);

  const result = await cvQueue._processJobForTests(bullJob(processingJob, 0));

  assert.equal(result.duplicate, true);
  assert.equal(result.candidateId, String(candidate._id));
  assert.equal(analysisCalls, 0);
  const repaired = await CVProcessingJob.findById(processingJob._id).lean();
  assert.equal(repaired.state, 'completed');
  assert.equal(repaired.stage, 'completed');
  assert.equal(repaired.progress, 100);
  assert.equal(repaired.lastError, undefined);
});
