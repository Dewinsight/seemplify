const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.REDIS_ENABLED = 'false';
process.env.CHATGPT_GATEWAY_SHARED_SECRET = '';
process.env.CHATGPT_GATEWAY_BASE_URL = '';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Candidate = require('../models/Candidate');
const CVProcessingJob = require('../models/CVProcessingJob');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const User = require('../models/User');
const cvQueue = require('../services/cvAnalysisQueueService');
const publicCapacity = require('../services/publicApplicationCapacityService');
const queueUpload = require('../middleware/cvQueueUploadHandler');
const creditsService = require('../services/creditsService');
const { deductCredits } = require('../middleware/creditsMiddleware');

let mongo;
let fixtureDirectory;
let durableWrites;
let durableRemovals;
let enqueueCalls;

function successfulAnalysis() {
  return {
    success: true,
    extractedFields: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.lovelace@example.com',
      phone: '+44 7700 900123',
      position: 'Engineer',
      experience: '8 years',
      education: 'BSc',
      skills: ['JavaScript'],
      location: 'London'
    },
    aiAnalysis: { summary: 'Experienced engineer' }
  };
}

async function uploadFile() {
  const filePath = path.join(fixtureDirectory, `${new mongoose.Types.ObjectId()}.pdf`);
  await fs.promises.writeFile(filePath, Buffer.from('synthetic cv bytes'));
  return {
    path: filePath,
    originalname: 'ada.pdf',
    mimetype: 'application/pdf',
    size: 18
  };
}

function uploadRequest({ file, organizationId, actorId, jobId, idempotencyKey, credits = true }) {
  return {
    method: 'POST',
    path: '/upload-cv',
    file,
    body: {
      ...(jobId ? { jobId: String(jobId) } : {})
    },
    user: organizationId || actorId
      ? {
        currentOrganization: organizationId,
        id: actorId
      }
      : undefined,
    ...(credits
      ? { creditsAction: { action: 'uploadCandidate', cost: 3, entityType: 'candidate' } }
      : {}),
    get(name) {
      return String(name).toLowerCase() === 'idempotency-key'
        ? idempotencyKey
        : undefined;
    }
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
}

async function seedBilling({ remainingCredits = 20 } = {}) {
  const organizationId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  await Plan.collection.insertOne({
    code: 'cv-business-test',
    credits: {
      totalCredits: 20,
      creditCosts: { uploadCandidate: 3 }
    }
  });
  await Organization.collection.insertOne({
    _id: organizationId,
    name: 'CV Safety Org',
    members: [{ user: actorId, status: 'active' }],
    subscription: {
      plan: 'cv-business-test',
      creditUsage: {
        totalCredits: 20,
        usedCredits: 20 - remainingCredits,
        remainingCredits,
        transactions: [],
        lowCreditWarning: { enabled: false, threshold: 20 }
      }
    }
  });
  await User.collection.insertOne({
    _id: actorId,
    email: 'recruiter@example.com',
    currentOrganization: organizationId
  });
  return { organizationId, actorId };
}

async function seedPublicJob({
  organizationId,
  isPublic = true,
  candidateApplyLimit = 2,
  reservedCredits = 6
}) {
  const _id = new mongoose.Types.ObjectId();
  await Job.collection.insertOne({
    _id,
    title: 'Public Engineer',
    organization: organizationId,
    isPublic,
    status: 'active',
    candidateApplyLimit,
    reservedCredits,
    publicApplicationCount: 0,
    publicApplicationReservations: []
  });
  return _id;
}

function processingJob(overrides = {}) {
  const publicId = overrides.publicId || `cv_business_${new mongoose.Types.ObjectId()}`;
  return CVProcessingJob.create({
    publicId,
    statusTokenHash: cvQueue.tokenHash(`token-${publicId}`),
    state: 'queued',
    stage: 'analyzing',
    progress: 50,
    organization: overrides.organization,
    actor: overrides.actor,
    jobAppliedFor: overrides.jobAppliedFor,
    source: overrides.source || 'public',
    originalName: 'ada.pdf',
    fileType: 'application/pdf',
    fileSize: 100,
    resumeText: 'Ada Lovelace senior engineer with extensive distributed systems experience.',
    cloudinary: {
      resumeUrl: 'https://example.invalid/private-cv',
      publicId: publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated'
    },
    formData: {},
    ...overrides
  });
}

function bullJob(job) {
  return {
    data: { processingJobId: String(job._id) },
    attemptsMade: 0,
    async updateProgress() {},
    discard() {
      this.discarded = true;
    }
  };
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    Candidate.syncIndexes(),
    CVProcessingJob.syncIndexes(),
    Job.syncIndexes(),
    Notification.syncIndexes()
  ]);
  fixtureDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cv-business-safety-'));
});

test.after(async () => {
  await cvQueue.closeForTests();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fixtureDirectory) {
    await fs.promises.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test.beforeEach(async () => {
  await Promise.all([
    Candidate.deleteMany({}),
    CVProcessingJob.deleteMany({}),
    Job.deleteMany({}),
    Notification.deleteMany({}),
    Organization.deleteMany({}),
    Plan.deleteMany({}),
    User.deleteMany({})
  ]);
  durableWrites = 0;
  durableRemovals = 0;
  enqueueCalls = 0;
  cvQueue._resetDependenciesForTests();
  cvQueue._setDependenciesForTests({
    durableFileStore: {
      async persistPath() {
        durableWrites += 1;
        return {
          provider: 'gridfs',
          bucket: 'cv_ingestion_files',
          fileId: String(new mongoose.Types.ObjectId()),
          sha256: 'a'.repeat(64),
          length: 18,
          persistedAt: new Date()
        };
      },
      async remove() {
        durableRemovals += 1;
        return true;
      }
    },
    enqueueJob: async () => {
      enqueueCalls += 1;
      return { id: 'queued' };
    }
  });
});

test('private queue route returns 202, charges its Mongo processing id once, and replay does not re-charge', async () => {
  const { organizationId, actorId } = await seedBilling();
  const handler = queueUpload('private');
  const idempotencyKey = 'private-route-charge-once';

  const firstResponse = responseRecorder();
  await handler(uploadRequest({
    file: await uploadFile(),
    organizationId,
    actorId,
    idempotencyKey
  }), firstResponse);
  assert.equal(firstResponse.statusCode, 202);
  assert.equal(firstResponse.body.billing.status, 'charged');
  assert.equal(firstResponse.body.idempotentReplay, false);

  const replayResponse = responseRecorder();
  await handler(uploadRequest({
    file: await uploadFile(),
    organizationId,
    actorId,
    idempotencyKey
  }), replayResponse);
  assert.equal(replayResponse.statusCode, 202);
  assert.equal(replayResponse.body.idempotentReplay, true);
  assert.equal(replayResponse.body.billing.status, 'charged');

  const processing = await CVProcessingJob.findOne({ idempotencyKey }).lean();
  const organization = await Organization.findById(organizationId).lean();
  const charges = organization.subscription.creditUsage.transactions.filter(
    (transaction) => transaction.action === 'uploadCandidate'
  );
  assert.equal(charges.length, 1);
  assert.equal(mongoose.isValidObjectId(charges[0].entityId), true);
  assert.equal(String(charges[0].entityId), String(processing._id));
  assert.notEqual(String(charges[0].entityId), processing.publicId);
  assert.equal(charges[0].entityType, 'candidate');
  assert.equal(organization.subscription.creditUsage.remainingCredits, 17);
  assert.equal(durableWrites, 1);
});

test('a permanent post-ingestion charge failure returns 202, terminally fails, and releases storage once', async () => {
  const { organizationId, actorId } = await seedBilling({ remainingCredits: 0 });
  const handler = queueUpload('private');
  const response = responseRecorder();
  await handler(uploadRequest({
    file: await uploadFile(),
    organizationId,
    actorId,
    idempotencyKey: 'private-route-charge-failure'
  }), response);

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.state, 'failed');
  assert.equal(response.body.billing.status, 'failed');
  assert.equal(response.body.billing.retryable, false);
  assert.equal(response.body.billing.terminal, true);
  assert.equal(response.body.billing.error.code, 'INSUFFICIENT_CREDITS');
  assert.equal(response.body.queueAvailable, false);
  assert.equal(enqueueCalls, 0);
  const stored = await CVProcessingJob.findOne().lean();
  assert.equal(stored.state, 'failed');
  assert.equal(stored.billing.state, 'failed');
  assert.equal(stored.billing.failureDisposition, 'permanent');
  assert.ok(stored.durableFile.releasedAt);
  assert.ok(stored.expiresAt);
  assert.equal(durableRemovals, 1);

  const replay = responseRecorder();
  await handler(uploadRequest({
    file: await uploadFile(),
    organizationId,
    actorId,
    idempotencyKey: 'private-route-charge-failure'
  }), replay);
  assert.equal(replay.statusCode, 202);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.billing.terminal, true);
  assert.equal(durableRemovals, 1);
});

test('a transient billing failure remains durable and recovery charges then enqueues it', async () => {
  const { organizationId, actorId } = await seedBilling();
  const handler = queueUpload('private');
  const originalConsume = creditsService.consumeCreditsIdempotently;
  let chargeAttempts = 0;
  creditsService.consumeCreditsIdempotently = async (...args) => {
    chargeAttempts += 1;
    if (chargeAttempts === 1) {
      const error = new Error('synthetic transient database outage');
      error.code = 'ECONNRESET';
      throw error;
    }
    return originalConsume.call(creditsService, ...args);
  };
  try {
    const response = responseRecorder();
    await handler(uploadRequest({
      file: await uploadFile(),
      organizationId,
      actorId,
      idempotencyKey: 'private-route-transient-charge'
    }), response);
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.billing.status, 'failed');
    assert.equal(response.body.billing.retryable, true);
    assert.equal(response.body.billing.terminal, false);
    assert.equal(enqueueCalls, 0);
    assert.equal(durableRemovals, 0);

    const queued = await CVProcessingJob.findOne({
      idempotencyKey: 'private-route-transient-charge'
    }).lean();
    assert.equal(queued.state, 'queued');
    assert.equal(queued.billing.failureDisposition, 'retryable');
    assert.ok(queued.billing.nextAttemptAt);
    await CVProcessingJob.updateOne(
      { _id: queued._id },
      {
        $set: {
          'billing.nextAttemptAt': new Date(Date.now() - 1_000)
        }
      }
    );

    assert.equal(await cvQueue.recoverPendingPrivateBilling(), 1);
    const recovered = await CVProcessingJob.findById(queued._id).lean();
    assert.equal(recovered.state, 'queued');
    assert.equal(recovered.billing.state, 'charged');
    assert.equal(enqueueCalls, 1);
    assert.equal(durableRemovals, 0);
  } finally {
    creditsService.consumeCreditsIdempotently = originalConsume;
  }
});

test('repeated transient billing failures terminally fail and clean up at the retry bound', async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const waiting = await processingJob({
    organization: organizationId,
    actor: actorId,
    source: 'private',
    state: 'queued',
    billing: {
      required: true,
      action: 'uploadCandidate',
      cost: 3,
      state: 'failed',
      attempts: 4,
      failureDisposition: 'retryable',
      idempotencyKey: 'cv-upload:bounded-billing'
    },
    durableFile: {
      provider: 'gridfs',
      bucket: 'cv_ingestion_files',
      fileId: String(new mongoose.Types.ObjectId()),
      sha256: 'b'.repeat(64),
      length: 18,
      persistedAt: new Date(),
      cleanupState: 'retained'
    },
    cloudinary: {}
  });
  const originalConsume = creditsService.consumeCreditsIdempotently;
  creditsService.consumeCreditsIdempotently = async () => {
    const error = new Error('synthetic persistent transient outage');
    error.code = 'ETIMEDOUT';
    throw error;
  };
  try {
    const result = await cvQueue.finalizePrivateUploadSubmission(waiting, {
      user: { id: actorId },
      creditsAction: {
        action: 'uploadCandidate',
        cost: 3,
        entityType: 'candidate'
      }
    });
    assert.equal(result.billing.terminal, true);
    assert.equal(result.billing.retryable, false);
    const stored = await CVProcessingJob.findById(waiting._id).lean();
    assert.equal(stored.state, 'failed');
    assert.equal(stored.billing.attempts, 5);
    assert.equal(stored.billing.failureDisposition, 'permanent');
    assert.ok(stored.durableFile.releasedAt);
    assert.ok(stored.expiresAt);
    assert.equal(durableRemovals, 1);
  } finally {
    creditsService.consumeCreditsIdempotently = originalConsume;
  }
});

test('generic credit middleware never treats an opaque CV queue id as a Job ObjectId', async () => {
  const originalConsumeCredits = creditsService.consumeCredits;
  let deductions = 0;
  creditsService.consumeCredits = async () => {
    deductions += 1;
  };
  try {
    const req = {
      method: 'POST',
      path: '/upload-cv',
      user: {
        currentOrganization: new mongoose.Types.ObjectId(),
        id: new mongoose.Types.ObjectId()
      },
      creditsAction: { action: 'uploadCandidate', cost: 3, entityType: 'candidate' },
      params: {}
    };
    const response = responseRecorder();
    deductCredits(req, response, () => {});
    await response.status(202).json({
      jobId: 'cv_opaque-not-a-mongo-id',
      idempotentReplay: false
    });
    assert.equal(deductions, 0);
  } finally {
    creditsService.consumeCredits = originalConsumeCredits;
  }
});

test('concurrent private charge claims append one ledger debit for one processing ObjectId', async () => {
  const { organizationId, actorId } = await seedBilling();
  const entityId = new mongoose.Types.ObjectId();
  const charges = await Promise.all(Array.from({ length: 8 }, () => (
    creditsService.consumeCreditsIdempotently(
      organizationId,
      'uploadCandidate',
      entityId,
      'candidate',
      actorId,
      {
        idempotencyKey: `cv-upload:${entityId}`,
        creditCostOverride: 3
      }
    )
  )));
  assert.equal(charges.filter((result) => result.alreadyConsumed === false).length, 1);
  assert.equal(charges.filter((result) => result.success).length, 8);

  const organization = await Organization.findById(organizationId).lean();
  assert.equal(organization.subscription.creditUsage.remainingCredits, 17);
  assert.equal(organization.subscription.creditUsage.transactions.length, 1);
  assert.equal(
    String(organization.subscription.creditUsage.transactions[0].entityId),
    String(entityId)
  );
});

test('startup recovery completes a crash-window pending charge without duplicate debit', async () => {
  const { organizationId, actorId } = await seedBilling();
  const pending = await processingJob({
    organization: organizationId,
    actor: actorId,
    source: 'private',
    billing: {
      required: true,
      action: 'uploadCandidate',
      cost: 3,
      state: 'pending',
      idempotencyKey: 'cv-upload:pending-recovery'
    }
  });
  await CVProcessingJob.collection.updateOne(
    { _id: pending._id },
    { $set: { updatedAt: new Date(Date.now() - 120_000) } }
  );

  assert.equal(await cvQueue.recoverPendingPrivateBilling(), 1);
  assert.equal(await cvQueue.recoverPendingPrivateBilling(), 0);
  const stored = await CVProcessingJob.findById(pending._id).lean();
  const organization = await Organization.findById(organizationId).lean();
  assert.equal(stored.billing.state, 'charged');
  assert.equal(organization.subscription.creditUsage.transactions.length, 1);
  assert.equal(enqueueCalls, 1);
});

test('public ingestion rejects missing, non-public, and cross-tenant jobs before durable persistence', async () => {
  const { organizationId } = await seedBilling();
  const otherOrganizationId = new mongoose.Types.ObjectId();
  const nonPublicJobId = await seedPublicJob({ organizationId, isPublic: false });

  const missingResponse = responseRecorder();
  await queueUpload('public')(uploadRequest({
    file: await uploadFile(),
    jobId: new mongoose.Types.ObjectId(),
    idempotencyKey: 'missing-public-job',
    credits: false
  }), missingResponse);
  assert.equal(missingResponse.statusCode, 404);

  const privateResponse = responseRecorder();
  await queueUpload('public')(uploadRequest({
    file: await uploadFile(),
    jobId: nonPublicJobId,
    idempotencyKey: 'non-public-job',
    credits: false
  }), privateResponse);
  assert.equal(privateResponse.statusCode, 403);

  const publicJobId = await seedPublicJob({ organizationId });
  const crossTenantRequest = uploadRequest({
    file: await uploadFile(),
    jobId: publicJobId,
    idempotencyKey: 'cross-tenant-public-job',
    credits: false
  });
  crossTenantRequest.body.organizationId = String(otherOrganizationId);
  const crossTenantResponse = responseRecorder();
  await queueUpload('public')(crossTenantRequest, crossTenantResponse);
  assert.equal(crossTenantResponse.statusCode, 403);

  assert.equal(durableWrites, 0);
  assert.equal(await CVProcessingJob.countDocuments({}), 0);
});

test('valid public ingestion persists the job-derived organization and binds replay to that job', async () => {
  const { organizationId } = await seedBilling();
  const firstJobId = await seedPublicJob({ organizationId });
  const secondJobId = await seedPublicJob({ organizationId });
  const idempotencyKey = 'public-job-bound-replay';

  const accepted = responseRecorder();
  await queueUpload('public')(uploadRequest({
    file: await uploadFile(),
    jobId: firstJobId,
    idempotencyKey,
    credits: false
  }), accepted);
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.body.billing.status, 'not_required');
  assert.equal(accepted.body.statusUrl, accepted.body.tracking.statusUrl);
  assert.equal(accepted.body.statusToken, accepted.body.tracking.statusToken);
  assert.equal(accepted.headers.location, accepted.body.statusUrl);
  assert.equal(accepted.headers['x-cv-status-token'], accepted.body.statusToken);

  const stored = await CVProcessingJob.findOne({ idempotencyKey }).lean();
  assert.equal(String(stored.organization), String(organizationId));
  assert.equal(String(stored.jobAppliedFor), String(firstJobId));
  assert.equal(durableWrites, 1);
  assert.equal(enqueueCalls, 1);

  const mismatchedReplay = responseRecorder();
  await queueUpload('public')(uploadRequest({
    file: await uploadFile(),
    jobId: secondJobId,
    idempotencyKey,
    credits: false
  }), mismatchedReplay);
  assert.equal(mismatchedReplay.statusCode, 409);
  assert.equal(mismatchedReplay.body.code, 'CV_IDEMPOTENCY_CONTEXT_MISMATCH');
  assert.equal(await CVProcessingJob.countDocuments({}), 1);
  assert.equal(durableWrites, 1);
});

test('public capacity reservation is atomic, replay-safe, and cannot overrun slot or reserved-credit limits', async () => {
  const { organizationId, actorId } = await seedBilling();
  const oneSlotJobId = await seedPublicJob({
    organizationId,
    candidateApplyLimit: 1,
    reservedCredits: 3
  });
  const first = await processingJob({ organization: organizationId, actor: actorId, jobAppliedFor: oneSlotJobId });
  const second = await processingJob({ organization: organizationId, actor: actorId, jobAppliedFor: oneSlotJobId });

  const slotRace = await Promise.allSettled([
    publicCapacity.reserve({
      jobId: oneSlotJobId,
      organizationId,
      processingJobId: first._id,
      processingJobPublicId: first.publicId
    }),
    publicCapacity.reserve({
      jobId: oneSlotJobId,
      organizationId,
      processingJobId: second._id,
      processingJobPublicId: second.publicId
    })
  ]);
  assert.equal(slotRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(slotRace.filter((result) => result.status === 'rejected').length, 1);
  const oneSlotStored = await Job.findById(oneSlotJobId).lean();
  assert.equal(oneSlotStored.publicApplicationCount, 1);
  assert.equal(oneSlotStored.publicApplicationReservations.length, 1);
  assert.equal(oneSlotStored.publicApplicationReservations[0].limitReached, true);

  const winningProcessingId = oneSlotStored.publicApplicationReservations[0].processingJob;
  const winningProcessing = [first, second].find(
    (job) => String(job._id) === String(winningProcessingId)
  );
  const replay = await publicCapacity.reserve({
    jobId: oneSlotJobId,
    organizationId,
    processingJobId: winningProcessing._id,
    processingJobPublicId: winningProcessing.publicId
  });
  assert.equal(replay.duplicate, true);
  assert.equal((await Job.findById(oneSlotJobId)).publicApplicationCount, 1);

  const creditBoundJobId = await seedPublicJob({
    organizationId,
    candidateApplyLimit: 2,
    reservedCredits: 3
  });
  const third = await processingJob({ organization: organizationId, actor: actorId, jobAppliedFor: creditBoundJobId });
  const fourth = await processingJob({ organization: organizationId, actor: actorId, jobAppliedFor: creditBoundJobId });
  const creditRace = await Promise.allSettled([
    publicCapacity.reserve({
      jobId: creditBoundJobId,
      organizationId,
      processingJobId: third._id,
      processingJobPublicId: third.publicId
    }),
    publicCapacity.reserve({
      jobId: creditBoundJobId,
      organizationId,
      processingJobId: fourth._id,
      processingJobPublicId: fourth.publicId
    })
  ]);
  assert.equal(creditRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(creditRace.filter((result) => result.status === 'rejected').length, 1);
  const creditBoundStored = await Job.findById(creditBoundJobId).lean();
  assert.equal(creditBoundStored.publicApplicationCount, 1);
  assert.equal(creditBoundStored.publicApplicationReservations.length, 1);
});

test('queued CV parsing does not consume another application slot before final submission', async () => {
  const { organizationId, actorId } = await seedBilling();
  const fullJobId = await seedPublicJob({
    organizationId,
    candidateApplyLimit: 1,
    reservedCredits: 3
  });
  await Job.updateOne(
    { _id: fullJobId },
    { $set: { publicApplicationCount: 1 } }
  );
  const queued = await processingJob({
    organization: organizationId,
    actor: actorId,
    jobAppliedFor: fullJobId
  });
  cvQueue._setDependenciesForTests({
    cvParser: {
      async analyzeText() {
        return successfulAnalysis();
      }
    },
    cloudinary: {
      async deleteFile() {
        return { success: true };
      }
    }
  });

  await cvQueue._processJobForTests(bullJob(queued));
  assert.equal(await Candidate.countDocuments({}), 1);
  assert.equal((await Job.findById(fullJobId)).publicApplicationCount, 1);
  assert.equal((await CVProcessingJob.findById(queued._id)).state, 'completed');
});

test('completion delivery restores one durable candidate-uploaded notification per recipient', async () => {
  const { organizationId, actorId } = await seedBilling();
  const candidateId = new mongoose.Types.ObjectId();
  await Candidate.collection.insertOne({
    _id: candidateId,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '1',
    position: 'Engineer',
    experience: '8',
    education: 'BSc',
    source: 'Uploaded CV',
    organization: organizationId
  });
  const completed = await processingJob({
    organization: organizationId,
    actor: actorId,
    source: 'private',
    state: 'completed',
    stage: 'completed',
    progress: 100,
    candidate: candidateId,
    completedAt: new Date()
  });
  cvQueue._setDependenciesForTests({
    completionEffectHandlers: {
      gptCacheInvalidation: async () => {},
      websocketBroadcast: async () => {},
      embedding: async () => {},
      limitReachedNotification: async () => {}
    }
  });

  await cvQueue._deliverCompletionEffectsForTests(completed._id);
  await cvQueue._deliverCompletionEffectsForTests(completed._id);
  const notifications = await Notification.find({
    type: 'candidate_uploaded',
    'data.candidateId': candidateId
  }).lean();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventKey, `cv-completed:${completed.publicId}`);
});

test('completion outbox retries only a failed effect and does not duplicate completed effects', async () => {
  const { organizationId, actorId } = await seedBilling();
  const jobId = await seedPublicJob({
    organizationId,
    candidateApplyLimit: 1,
    reservedCredits: 3
  });
  const candidateId = new mongoose.Types.ObjectId();
  await Candidate.collection.insertOne({
    _id: candidateId,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '1',
    position: 'Engineer',
    experience: '8',
    education: 'BSc',
    organization: organizationId
  });
  const completed = await processingJob({
    organization: organizationId,
    actor: actorId,
    jobAppliedFor: jobId,
    state: 'completed',
    stage: 'completed',
    progress: 100,
    candidate: candidateId,
    completedAt: new Date(),
    publicApplicationReservation: {
      reserved: true,
      job: jobId,
      creditCost: 3,
      applicationCount: 1,
      limitReached: true,
      reservedAt: new Date()
    }
  });

  const calls = {
    candidateNotification: 0,
    gptCacheInvalidation: 0,
    websocketBroadcast: 0,
    embedding: 0,
    limitReachedNotification: 0
  };
  cvQueue._setDependenciesForTests({
    completionEffectHandlers: Object.fromEntries(
      Object.keys(calls).map((effectName) => [
        effectName,
        async () => {
          calls[effectName] += 1;
          if (effectName === 'websocketBroadcast' && calls[effectName] === 1) {
            throw new Error('synthetic websocket outage');
          }
        }
      ])
    )
  });

  await Promise.all([
    cvQueue._deliverCompletionEffectsForTests(completed._id),
    cvQueue._deliverCompletionEffectsForTests(completed._id)
  ]);
  assert.deepEqual(calls, {
    candidateNotification: 1,
    gptCacheInvalidation: 1,
    websocketBroadcast: 1,
    embedding: 1,
    limitReachedNotification: 1
  });
  const awaitingRetry = await CVProcessingJob.findById(completed._id).lean();
  assert.equal(awaitingRetry.expiresAt, undefined);

  await cvQueue._deliverCompletionEffectsForTests(completed._id);
  assert.deepEqual(calls, {
    candidateNotification: 1,
    gptCacheInvalidation: 1,
    websocketBroadcast: 2,
    embedding: 1,
    limitReachedNotification: 1
  });
  const stored = await CVProcessingJob.findById(completed._id).lean();
  assert.ok(stored.completionEffectsCompletedAt);
  assert.ok(stored.expiresAt);
  for (const effectName of Object.keys(calls)) {
    assert.equal(stored.completionEffects[effectName].status, 'completed');
  }
});
