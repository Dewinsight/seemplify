const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const test = require('node:test');

process.env.REDIS_ENABLED = 'false';
process.env.PUBLIC_APPLICATION_IP_JOB_LIMIT = '100';
process.env.PUBLIC_CV_UPLOAD_IP_APPLICATION_LIMIT = '100';
process.env.JWT_SECRET = 'cv-ingestion-test-secret';

const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Candidate = require('../models/Candidate');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingBatch = require('../models/CVProcessingBatch');
const CVProcessingJob = require('../models/CVProcessingJob');
const CVStorageCleanupTask = require('../models/CVStorageCleanupTask');
const Interview = require('../models/Interview');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const User = require('../models/User');
const candidateController = require('../controllers/candidateController');
const interviewController = require('../controllers/interviewController');
const candidateRouter = require('../routes/candidate');
const jobRouter = require('../routes/job');
const cvRouter = require('../routes/cv');
const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
const embeddingService = require('../services/embeddingService');
const cvQueue = require('../services/cvAnalysisQueueService');
const durableCvFileStore = require('../services/durableCvFileStore');
const publicApplicationCapability = require('../services/publicApplicationCapabilityService');
const publicApplicationCapacityService = require('../services/publicApplicationCapacityService');
const publicFeedbackCapability = require('../services/publicFeedbackCapabilityService');
const publicFeedbackReissueService = require('../services/publicFeedbackReissueService');
const cvProcessingCompatibility = require('../services/cvProcessingCompatibilityService');
const requirePublicFeedbackAccess = require('../middleware/publicFeedbackAccess');
const organizationErasureService = require('../services/organizationErasureService');
const organizationCvWriteFence = require('../services/organizationCvWriteFenceService');
const { requirePermission } = require('../middleware/organizationMiddleware');
const bulkUploadRouter = require('../routes/bulkUpload');

let mongo;
let server;
let baseUrl;
let fixtureDirectory;

const originalConfirmation = candidateEmailNotificationService.sendApplicationConfirmationEmail;
const originalLimitEmail = candidateEmailNotificationService.sendJobApplicationLimitReachedEmail;
const originalDeleteEmbedding = embeddingService.deleteEmbedding;

function jobPayload(organization, overrides = {}) {
  return {
    title: 'Platform Engineer',
    department: new mongoose.Types.ObjectId(),
    location: 'London',
    type: 'Full-time',
    level: 'Senior',
    description: 'Build reliable systems',
    requirements: 'Production engineering experience',
    responsibilities: 'Own services',
    experience: '5 years',
    education: 'Degree or equivalent',
    organization,
    status: 'active',
    isPublic: true,
    candidateApplyLimit: 5,
    reservedCredits: 100,
    publicApplicationCreditUnitCost: 1,
    ...overrides
  };
}

function organizationPayload(name) {
  return { name, owner: new mongoose.Types.ObjectId() };
}

function applicationBody(jobId, email = 'ada@example.com') {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email,
    phone: '+44 7700 900123',
    coverLetter: 'I build reliable systems.',
    jobId: String(jobId),
    isOrganizationStaff: false
  };
}

async function postJson(url, body, headers = {}) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function controllerResponse() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    json(body) { this.body = body; return body; }
  };
}

async function uploadPublicCv({ jobId, candidateId, token, key, bytes = 'readable cv bytes' }) {
  const form = new FormData();
  form.append('resume', new Blob([bytes], { type: 'application/pdf' }), 'candidate.pdf');
  return fetch(`${baseUrl}/api/candidates/public/upload-cv`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': key,
      'X-Public-Application-Token': token,
      'X-Public-Job-Id': String(jobId),
      'X-Public-Candidate-Id': String(candidateId)
    },
    body: form
  });
}

async function privateRequestFile(bytes = 'private durable resume') {
  const filePath = path.join(fixtureDirectory, `${new mongoose.Types.ObjectId()}.pdf`);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

function privateRequest(filePath, organizationId, key, candidateId) {
  const size = fs.statSync(filePath).size;
  return {
    file: {
      path: filePath,
      originalname: 'candidate.pdf',
      mimetype: 'application/pdf',
      size
    },
    body: candidateId ? { candidateId: String(candidateId) } : {},
    user: { currentOrganization: organizationId, id: new mongoose.Types.ObjectId() },
    get(name) {
      return String(name).toLowerCase() === 'idempotency-key' ? key : undefined;
    }
  };
}

async function batchFiles(entries) {
  return Promise.all(entries.map(async ({ name, bytes }) => {
    const filePath = await privateRequestFile(bytes);
    return {
      path: filePath,
      originalname: name,
      mimetype: 'application/pdf',
      size: Buffer.byteLength(bytes)
    };
  }));
}

function batchRequest(files, organizationId, actorId, key) {
  return {
    files,
    body: {},
    user: { currentOrganization: organizationId, id: actorId },
    get(name) {
      return String(name).toLowerCase() === 'idempotency-key' ? key : undefined;
    }
  };
}

function delivery(job) {
  return {
    data: { processingJobId: String(job._id) },
    attemptsMade: 0,
    async updateProgress() {},
    discard() { this.discarded = true; }
  };
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    Candidate.syncIndexes(),
    CVProcessingJob.syncIndexes(),
    CVProcessingAudit.syncIndexes(),
    CVProcessingBatch.syncIndexes(),
    CVStorageCleanupTask.syncIndexes(),
    Interview.syncIndexes()
  ]);
  fixtureDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cv-ingestion-security-'));
  candidateEmailNotificationService.sendApplicationConfirmationEmail = async () => true;
  candidateEmailNotificationService.sendJobApplicationLimitReachedEmail = async () => true;
  embeddingService.deleteEmbedding = async () => true;

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/candidates', candidateRouter);
  app.use('/api/jobs', jobRouter);
  app.use('/api/cv', cvRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  candidateEmailNotificationService.sendApplicationConfirmationEmail = originalConfirmation;
  candidateEmailNotificationService.sendJobApplicationLimitReachedEmail = originalLimitEmail;
  embeddingService.deleteEmbedding = originalDeleteEmbedding;
  await cvQueue.closeForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (fixtureDirectory) await fs.promises.rm(fixtureDirectory, { recursive: true, force: true });
});

test.beforeEach(async () => {
  cvQueue._resetDependenciesForTests();
  cvQueue._setDependenciesForTests({
    enqueueJob: async () => ({ id: 'queued' }),
    completionEffectHandlers: {
      candidateNotification: async () => {},
      gptCacheInvalidation: async () => {},
      websocketBroadcast: async () => {},
      embedding: async () => {},
      limitReachedNotification: async () => {}
    }
  });
  await Promise.all([
    Candidate.deleteMany({}),
    CVProcessingJob.deleteMany({}),
    CVProcessingAudit.deleteMany({}),
    CVProcessingBatch.deleteMany({}),
    CVStorageCleanupTask.deleteMany({}),
    Interview.deleteMany({}),
    Job.deleteMany({}),
    Notification.deleteMany({}),
    Organization.deleteMany({})
  ]);
});

test('public application capability is stable, non-enumerating, capacity-committed, and required before multipart parsing', async () => {
  const organization = await Organization.create(organizationPayload('Capability Org'));
  const job = await Job.create(jobPayload(organization._id, { candidateApplyLimit: 1 }));
  const key = 'application-request-ada';
  const body = applicationBody(job._id);

  const firstResponse = await postJson('/api/candidates/public', body, { 'Idempotency-Key': key });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.ok(first.candidate?._id);
  assert.ok(first.applicationCapability?.token);

  const exactReplays = await Promise.all(Array.from({ length: 20 }, () => (
    postJson('/api/candidates/public', body, { 'Idempotency-Key': key }).then(async (response) => ({
      status: response.status,
      body: await response.json()
    }))
  )));
  assert.ok(exactReplays.every((response) => response.status === 200));
  assert.ok(exactReplays.every((response) => (
    response.body.applicationCapability.token === first.applicationCapability.token
  )));

  const changedReplay = await postJson('/api/candidates/public', {
    ...body,
    phone: '+44 7700 900999'
  }, { 'Idempotency-Key': key });
  assert.equal(changedReplay.status, 409);

  const committedJob = await Job.findById(job._id).lean();
  assert.equal(committedJob.publicApplicationCount, 1);
  assert.equal(committedJob.shortlist.length, 1);
  assert.equal(String(committedJob.shortlist[0].candidate), String(first.candidate._id));
  const placeholder = await Candidate.findById(first.candidate._id).lean();
  assert.equal(placeholder.processingMetadata.cvIngestionState, 'not_received');

  const otherJob = await Job.create(jobPayload(organization._id, {
    title: 'Other Public Role',
    candidateApplyLimit: 5
  }));
  const crossJobShortlist = await postJson(
    `/api/jobs/public/${otherJob._id}/shortlist`,
    { candidateId: first.candidate._id },
    { 'X-Public-Application-Token': first.applicationCapability.token }
  );
  assert.equal(crossJobShortlist.status, 403);
  assert.equal((await Job.findById(otherJob._id).lean()).shortlist.length, 0);

  const retiredLegacyApply = await postJson('/api/jobs/public/apply', {
    jobId: otherJob._id,
    email: 'legacy@example.com'
  });
  assert.equal(retiredLegacyApply.status, 410);

  const enumeration = await postJson('/api/candidates/public', body, {
    'Idempotency-Key': 'attacker-fresh-key'
  });
  assert.equal(enumeration.status, 202);
  const enumerationBody = await enumeration.json();
  assert.equal(enumerationBody.accessGranted, false);
  assert.equal(enumerationBody.candidate, undefined);
  assert.equal(enumerationBody.applicationCapability, undefined);

  const secondApplicant = await postJson(
    '/api/candidates/public',
    applicationBody(job._id, 'grace@example.com'),
    { 'Idempotency-Key': 'application-request-grace' }
  );
  assert.equal(secondApplicant.status, 409);
  assert.equal(await Candidate.countDocuments({ organization: organization._id }), 1);

  const missingCapabilityForm = new FormData();
  missingCapabilityForm.append('resume', new Blob(['blocked'], { type: 'application/pdf' }), 'blocked.pdf');
  const missingCapability = await fetch(`${baseUrl}/api/candidates/public/upload-cv`, {
    method: 'POST',
    body: missingCapabilityForm
  });
  assert.equal(missingCapability.status, 403);
  assert.equal(await CVProcessingJob.countDocuments({}), 0);

  const nonPublicJob = await Job.create(jobPayload(organization._id, {
    title: 'Private Role',
    isPublic: false
  }));
  const nonPublicUpload = await uploadPublicCv({
    jobId: nonPublicJob._id,
    candidateId: first.candidate._id,
    token: first.applicationCapability.token,
    key: 'non-public-upload'
  });
  assert.equal(nonPublicUpload.status, 403);

  const uncommittedJob = await Job.create(jobPayload(organization._id, {
    title: 'Uncommitted Role',
    candidateApplyLimit: 5
  }));
  const uncommittedCandidate = await Candidate.create({
    firstName: 'Uncommitted',
    lastName: 'Applicant',
    email: 'uncommitted@example.com',
    phone: '+44 7700 900001',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'public',
    jobAppliedFor: uncommittedJob._id
  });
  const uncommittedCapability = publicApplicationCapability.issue({
    organizationId: organization._id,
    jobId: uncommittedJob._id,
    candidateId: uncommittedCandidate._id,
    requestKey: 'uncommitted-request'
  });
  await Candidate.updateOne(
    { _id: uncommittedCandidate._id },
    {
      $set: {
        publicApplicationCapabilityHash: uncommittedCapability.hash,
        publicApplicationCapabilityExpiresAt: uncommittedCapability.expiresAt
      }
    }
  );
  const uncommittedUpload = await uploadPublicCv({
    jobId: uncommittedJob._id,
    candidateId: uncommittedCandidate._id,
    token: uncommittedCapability.token,
    key: 'uncommitted-upload'
  });
  assert.equal(uncommittedUpload.status, 403);
  assert.equal((await uncommittedUpload.json()).code, 'PUBLIC_APPLICATION_CAPABILITY_INVALID');

  const accepted = await uploadPublicCv({
    jobId: job._id,
    candidateId: first.candidate._id,
    token: first.applicationCapability.token,
    key: 'public-upload-one',
    bytes: 'first corrected readable public CV'
  });
  assert.equal(accepted.status, 202);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.stage, 'stored');
  assert.equal(await CVProcessingJob.countDocuments({ source: 'public' }), 1);

  const parallel = await Promise.all(Array.from({ length: 20 }, (_, index) => uploadPublicCv({
    jobId: job._id,
    candidateId: first.candidate._id,
    token: first.applicationCapability.token,
    key: `fresh-upload-key-${index}`,
    bytes: 'first corrected readable public CV'
  })));
  assert.ok(parallel.every((response) => response.status === 202));
  assert.equal(await CVProcessingJob.countDocuments({ source: 'public' }), 1);

  const changedBytes = await uploadPublicCv({
    jobId: job._id,
    candidateId: first.candidate._id,
    token: first.applicationCapability.token,
    key: 'fresh-but-different-file',
    bytes: 'a different CV must not silently replay the old job'
  });
  assert.equal(changedBytes.status, 409);
  assert.equal((await changedBytes.json()).code, 'CV_IDEMPOTENCY_KEY_REUSED');

  const jobCountBeforeDeletion = await CVProcessingJob.countDocuments({});
  await cvQueue.eraseCandidateProcessingData(organization._id, [first.candidate._id]);
  const delayedUpload = await uploadPublicCv({
    jobId: job._id,
    candidateId: first.candidate._id,
    token: first.applicationCapability.token,
    key: 'delayed-upload-after-erasure',
    bytes: 'must be rejected before multipart storage'
  });
  assert.equal(delayedUpload.status, 403);
  assert.equal(await CVProcessingJob.countDocuments({}), jobCountBeforeDeletion);
});

test('the final public slot has one winner and returns the loser an actionable capacity conflict', async () => {
  const organization = await Organization.create(organizationPayload('Capacity Conflict Org'));
  const job = await Job.create(jobPayload(organization._id, { candidateApplyLimit: 1 }));
  const [first, second] = await Promise.all([
    postJson(
      '/api/candidates/public',
      applicationBody(job._id, 'capacity-one@example.com'),
      { 'Idempotency-Key': 'capacity-race-one' }
    ),
    postJson(
      '/api/candidates/public',
      applicationBody(job._id, 'capacity-two@example.com'),
      { 'Idempotency-Key': 'capacity-race-two' }
    )
  ]);
  const responses = await Promise.all([first, second].map(async (response) => ({
    status: response.status,
    body: await response.json()
  })));
  assert.deepEqual(responses.map((entry) => entry.status).sort(), [201, 409]);
  const conflict = responses.find((entry) => entry.status === 409);
  assert.equal(conflict.body.code, 'PUBLIC_APPLICATION_LIMIT_REACHED');
  assert.match(conflict.body.msg, /limit|applications/i);
  const storedJob = await Job.findById(job._id).lean();
  assert.equal(storedJob.publicApplicationCount, 1);
  assert.equal(storedJob.shortlist.length, 1);
  assert.equal(await Candidate.countDocuments({
    organization: organization._id,
    publicApplicationCommitState: 'committed'
  }), 1);
});

test('a public received receipt is not enqueued and the same capability repairs it with resent bytes', async () => {
  const organization = await Organization.create(organizationPayload('Public Receipt Repair Org'));
  const job = await Job.create(jobPayload(organization._id));
  const key = 'public-receipt-repair-application';
  const createdResponse = await postJson(
    '/api/candidates/public',
    applicationBody(job._id, 'receipt-repair@example.com'),
    { 'Idempotency-Key': key }
  );
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const request = async (filePath) => ({
    file: {
      path: filePath,
      originalname: 'receipt-repair.pdf',
      mimetype: 'application/pdf',
      size: fs.statSync(filePath).size
    },
    body: { jobId: String(job._id), candidateId: String(created.candidate._id) },
    get(name) {
      const header = String(name).toLowerCase();
      if (header === 'idempotency-key') return key;
      if (header === 'x-public-application-token') return created.applicationCapability.token;
      return undefined;
    }
  });
  cvQueue._setDependenciesForTests({
    durableFileStore: {
      async persistPath() {
        throw Object.assign(new Error('synthetic public intake interruption'), {
          code: 'CV_DURABLE_STORAGE_WRITE_FAILED'
        });
      },
      async remove() { return true; }
    }
  });
  await assert.rejects(
    async () => cvQueue.submitUpload(await request(await privateRequestFile('public repair bytes')), 'public'),
    /synthetic public intake interruption/
  );
  const receipt = await CVProcessingJob.findOne({
    organization: organization._id,
    linkedCandidate: created.candidate._id,
    source: 'public'
  }).lean();
  assert.equal(receipt.stage, 'received');
  const enqueued = [];
  cvQueue._setDependenciesForTests({
    durableFileStore: durableCvFileStore,
    queue: {
      async getJob() { return null; },
      async add(_name, _data, options) { enqueued.push(options.jobId); return { id: options.jobId }; }
    }
  });
  await CVProcessingJob.collection.updateOne(
    { _id: receipt._id },
    { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } }
  );
  assert.equal(await cvQueue.recoverStaleJobs(), 0);
  assert.deepEqual(enqueued, []);
  const repaired = await cvQueue.submitUpload(
    await request(await privateRequestFile('public repair bytes')),
    'public'
  );
  assert.equal(repaired.duplicate, true);
  assert.equal(String(repaired.job._id), String(receipt._id));
  assert.equal(repaired.job.stage, 'stored');
  assert.ok(repaired.job.durableFile?.fileId);
});

test('public reapplication generations never reuse a deleted candidate CV receipt', async () => {
  const organization = await Organization.create(organizationPayload('Public Reapply CV Org'));
  const job = await Job.create(jobPayload(organization._id));
  const email = 'repeat-applicant@example.com';
  const applyAndUpload = async (applicationKey, bytes) => {
    const response = await postJson(
      '/api/candidates/public',
      applicationBody(job._id, email),
      { 'Idempotency-Key': applicationKey }
    );
    assert.ok([200, 201].includes(response.status));
    const application = await response.json();
    const filePath = await privateRequestFile(bytes);
    const submitted = await cvQueue.submitUpload({
      file: {
        path: filePath,
        originalname: 'repeat-applicant.pdf',
        mimetype: 'application/pdf',
        size: fs.statSync(filePath).size
      },
      body: { jobId: String(job._id), candidateId: String(application.candidate._id) },
      get(name) {
        const header = String(name).toLowerCase();
        if (header === 'idempotency-key') return applicationKey;
        if (header === 'x-public-application-token') return application.applicationCapability.token;
        return undefined;
      }
    }, 'public');
    return { application, submitted };
  };

  const first = await applyAndUpload('reapply-generation-one', 'same public CV bytes');
  await cvQueue.eraseCandidateProcessingData(organization._id, [first.application.candidate._id]);
  const second = await applyAndUpload('reapply-generation-two', 'same public CV bytes');
  assert.notEqual(second.submitted.job.publicId, first.submitted.job.publicId);
  await cvQueue.eraseCandidateProcessingData(organization._id, [second.application.candidate._id]);
  const third = await applyAndUpload('reapply-generation-three', 'corrected and different public CV bytes');
  assert.notEqual(third.submitted.job.publicId, second.submitted.job.publicId);

  const jobs = await CVProcessingJob.find({ organization: organization._id, source: 'public' })
    .sort({ createdAt: 1 }).lean();
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map((entry) => entry.state), ['cancelled', 'cancelled', 'queued']);
  assert.equal(String(third.application.candidate._id), String(first.application.candidate._id));
});

test('public application Job commit survives Candidate projection failure and restart reconciliation', async () => {
  const organization = await Organization.create(organizationPayload('Application Repair Org'));
  const job = await Job.create(jobPayload(organization._id));
  const originalUpdateOne = Candidate.updateOne;
  let finalizationFailed = false;
  Candidate.updateOne = async function patchedUpdateOne(filter, update, ...rest) {
    if (
      !finalizationFailed
      && update?.$set?.publicApplicationCommitState === 'committed'
    ) {
      finalizationFailed = true;
      throw new Error('synthetic crash after Job application commit');
    }
    return originalUpdateOne.call(this, filter, update, ...rest);
  };
  let response;
  try {
    response = await postJson(
      '/api/candidates/public',
      applicationBody(job._id, 'restart-repair@example.com'),
      { 'Idempotency-Key': 'restart-repair-application' }
    );
  } finally {
    Candidate.updateOne = originalUpdateOne;
  }
  assert.equal(response.status, 500);
  assert.equal(finalizationFailed, true);

  const committedJob = await Job.findById(job._id).lean();
  assert.equal(committedJob.shortlist.length, 1);
  const candidateId = committedJob.shortlist[0].candidate;
  let candidate = await Candidate.findById(candidateId)
    .select('+publicApplicationCommitState +publicApplicationProvisionalExpiresAt +publicApplicationCommitStartedAt')
    .lean();
  assert.equal(candidate.publicApplicationCommitState, 'committing');
  assert.equal(candidate.publicApplicationProvisionalExpiresAt, undefined);
  assert.ok(candidate.publicApplicationCommitStartedAt);

  const hiddenResponse = controllerResponse();
  await candidateController.getAllCandidates({
    user: { currentOrganization: organization._id },
    query: { page: 1, limit: 20 }
  }, hiddenResponse);
  assert.equal(hiddenResponse.body.total, 0);

  const repair = await publicApplicationCapacityService.reconcileCandidateCommitStates({
    candidateId,
    organizationId: organization._id,
    jobId: job._id
  });
  assert.equal(repair.committed, 1);
  candidate = await Candidate.findById(candidateId)
    .select('+publicApplicationCommitState +publicApplicationProvisionalExpiresAt +publicApplicationCommitStartedAt')
    .lean();
  assert.equal(candidate.publicApplicationCommitState, 'committed');
  assert.equal(candidate.publicApplicationProvisionalExpiresAt, undefined);
  assert.equal(candidate.publicApplicationCommitStartedAt, undefined);

  const visibleResponse = controllerResponse();
  await candidateController.getAllCandidates({
    user: { currentOrganization: organization._id },
    query: { page: 1, limit: 20 }
  }, visibleResponse);
  assert.equal(visibleResponse.body.total, 1);
  assert.equal(String(visibleResponse.body.candidates[0]._id), String(candidateId));

  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../controllers/candidateController.js'),
    'utf8'
  );
  const listSource = fs.readFileSync(path.join(__dirname, '../routes/candidateLists.js'), 'utf8');
  assert.match(controllerSource, /publicApplicationCommitState:\s*\{ \$nin: \['provisional', 'committing'\] \}/);
  assert.match(listSource, /publicApplicationCommitState:\s*\{ \$nin: \['provisional', 'committing'\] \}/);
});

test('public application repair pages beyond 500 receipts and leaves a live commit untouched', async () => {
  const organization = await Organization.create(organizationPayload('Commit Pagination Org'));
  const job = await Job.create(jobPayload(organization._id, {
    candidateApplyLimit: 1000,
    reservedCredits: 2000
  }));
  const old = new Date(Date.now() - 20 * 60 * 1000);
  const candidateIds = Array.from({ length: 501 }, () => new mongoose.Types.ObjectId());
  await Candidate.insertMany(candidateIds.map((candidateId, index) => ({
    _id: candidateId,
    firstName: 'Repair',
    lastName: `Applicant ${index}`,
    email: `repair-${index}@example.com`,
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'public',
    jobAppliedFor: job._id,
    publicApplicationCommitState: 'committing',
    publicApplicationCommitStartedAt: old,
    createdAt: old,
    updatedAt: old
  })));
  const liveCandidate = await Candidate.create({
    firstName: 'Live',
    lastName: 'Commit',
    email: 'live-commit@example.com',
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'public',
    jobAppliedFor: job._id,
    publicApplicationCommitState: 'committing',
    publicApplicationCommitStartedAt: new Date()
  });
  await Job.updateOne(
    { _id: job._id },
    {
      $set: {
        shortlist: [
          { candidate: candidateIds.at(-1), status: 'shortlisted', addedAt: old },
          { candidate: liveCandidate._id, status: 'shortlisted', addedAt: new Date() }
        ]
      }
    }
  );

  const result = await publicApplicationCapacityService.reconcileCandidateCommitStates({
    organizationId: organization._id,
    limit: 500,
    now: new Date()
  });
  assert.equal(result.examined, 501);
  assert.equal(result.committed, 1);
  assert.equal(result.restored, 500);
  assert.equal(
    (await Candidate.findById(candidateIds.at(-1))
      .select('+publicApplicationCommitState')
      .lean()).publicApplicationCommitState,
    'committed'
  );
  const live = await Candidate.findById(liveCandidate._id)
    .select('+publicApplicationCommitState +publicApplicationProvisionalExpiresAt')
    .lean();
  assert.equal(live.publicApplicationCommitState, 'committing');
  assert.equal(live.publicApplicationProvisionalExpiresAt, undefined);
});

test('a public placeholder is not falsely recovered as complete and is enriched only after parser and AI run', async () => {
  const organization = await Organization.create(organizationPayload('Public Parse Org'));
  const job = await Job.create(jobPayload(organization._id));
  const createResponse = await postJson(
    '/api/candidates/public',
    applicationBody(job._id),
    { 'Idempotency-Key': 'public-parse-application' }
  );
  const created = await createResponse.json();
  const uploadResponse = await uploadPublicCv({
    jobId: job._id,
    candidateId: created.candidate._id,
    token: created.applicationCapability.token,
    key: 'public-parse-upload',
    bytes: 'Ada Lovelace\nSenior engineer\nJavaScript Node MongoDB Redis Docker Kubernetes'
  });
  const upload = await uploadResponse.json();
  const processingJob = await CVProcessingJob.findOne({ publicId: upload.jobId }).select('+resumeText');
  let parseCalls = 0;
  let aiCalls = 0;
  cvQueue._setDependenciesForTests({
    dispatchInferenceRunner: async (_bull, _token, run) => run({ signal: undefined }),
    cloudinary: {
      async uploadFile() {
        return {
          success: true,
          resumeUrl: 'https://example.invalid/public-cv',
          publicId: `cv/${processingJob.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated'
        };
      },
      async deleteFile() { return { success: true }; }
    },
    cvParser: {
      async parseCV() {
        parseCalls += 1;
        return 'Ada Lovelace\nSenior engineer with ten years experience in JavaScript Node MongoDB Redis Docker Kubernetes';
      },
      async analyzeText() {
        aiCalls += 1;
        return {
          success: true,
          extractedFields: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            phone: '+44 7700 900123',
            position: 'Principal Engineer',
            experience: 'Ten years of distributed systems engineering',
            education: 'BSc Computer Science',
            skills: ['JavaScript', 'Node.js']
          },
          aiAnalysis: { summary: 'Experienced engineer' }
        };
      }
    }
  });
  await cvQueue._processJobForTests(delivery(processingJob));
  const enriched = await Candidate.findById(created.candidate._id).lean();
  const completed = await CVProcessingJob.findById(processingJob._id).lean();
  assert.equal(parseCalls, 1);
  assert.equal(aiCalls, 1);
  assert.equal(enriched.experience, 'Ten years of distributed systems engineering');
  assert.equal(enriched.processingMetadata.cvIngestionState, 'completed');
  assert.equal(completed.state, 'completed');
});

test('idempotency fingerprints reject changed bytes and projection failures remain durable after job commit', async () => {
  const organization = await Organization.create(organizationPayload('Fingerprint Org'));
  const firstPath = await privateRequestFile('same request first bytes');
  const first = await cvQueue.submitUpload(
    privateRequest(firstPath, organization._id, 'private-fingerprint-key'),
    'private'
  );
  const changedPath = await privateRequestFile('same request changed bytes');
  await assert.rejects(
    () => cvQueue.submitUpload(
      privateRequest(changedPath, organization._id, 'private-fingerprint-key'),
      'private'
    ),
    (error) => error.code === 'CV_IDEMPOTENCY_KEY_REUSED'
  );
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 1);

  const linked = await Candidate.create({
    firstName: 'Projection',
    lastName: 'Failure',
    email: 'projection@example.com',
    phone: '123',
    position: 'Engineer',
    experience: 'Unknown',
    education: 'Unknown',
    organization: organization._id,
    source: 'public'
  });
  const projectionPath = await privateRequestFile('projection failure bytes remain durable');
  const originalUpdateOne = Candidate.updateOne;
  let projectionCalls = 0;
  Candidate.updateOne = async function patchedUpdateOne(...args) {
    if (args[0]?._id && String(args[0]._id) === String(linked._id)) {
      projectionCalls += 1;
      throw new Error('synthetic candidate projection failure');
    }
    return originalUpdateOne.apply(this, args);
  };
  let projected;
  try {
    projected = await cvQueue.submitUpload(
      privateRequest(projectionPath, organization._id, 'projection-failure-key', linked._id),
      'replacement'
    );
  } finally {
    Candidate.updateOne = originalUpdateOne;
  }
  assert.equal(projectionCalls, 3);
  assert.ok(projected.job.durableFile.fileId);
  assert.ok(await CVProcessingJob.exists({ _id: projected.job._id, state: 'queued' }));
  assert.equal(await CVStorageCleanupTask.countDocuments({ provider: 'gridfs' }), 0);
  const hiddenFingerprint = await CVProcessingJob.findById(first.job._id).lean();
  assert.ok(hiddenFingerprint.requestFingerprint === undefined, 'fingerprints remain hidden by default');
});

test('replacement activation repairs both crash points, blocks old retry, and only the current revision can enrich', async () => {
  const organization = await Organization.create(organizationPayload('Replacement Repair Org'));
  const job = await Job.create(jobPayload(organization._id));
  const createChain = async (suffix, pointerAlreadySwitched = false) => {
    const candidate = await Candidate.create({
      firstName: 'Revision',
      lastName: suffix,
      email: `revision-${suffix.toLowerCase()}@example.com`,
      phone: '123',
      position: 'Engineer',
      experience: 'Old profile',
      education: 'BSc',
      organization: organization._id,
      source: 'public',
      jobAppliedFor: job._id
    });
    const prior = await CVProcessingJob.create({
      publicId: `cv_prior_${suffix}_${new mongoose.Types.ObjectId()}`,
      statusTokenHash: 'a'.repeat(64),
      state: 'failed',
      stage: 'failed',
      progress: 60,
      organization: organization._id,
      jobAppliedFor: job._id,
      source: 'public',
      originalName: `${suffix}-old.pdf`,
      fileType: 'application/pdf',
      fileSize: 100,
      linkedCandidate: candidate._id,
      revision: 1,
      retry: { availableUntil: new Date(Date.now() + 60 * 60 * 1000) }
    });
    const replacement = await CVProcessingJob.create({
      publicId: `cv_replacement_${suffix}_${new mongoose.Types.ObjectId()}`,
      statusTokenHash: 'b'.repeat(64),
      state: 'queued',
      stage: 'stored',
      progress: 30,
      organization: organization._id,
      jobAppliedFor: job._id,
      source: 'replacement',
      originalName: `${suffix}-corrected.pdf`,
      fileType: 'application/pdf',
      fileSize: 110,
      linkedCandidate: candidate._id,
      supersedes: prior._id,
      revision: 2
    });
    await Candidate.updateOne(
      { _id: candidate._id },
      {
        $set: {
          'processingMetadata.cvProcessingJobId': pointerAlreadySwitched
            ? replacement.publicId
            : prior.publicId,
          'processingMetadata.cvIngestionState': 'failed'
        }
      }
    );
    return { candidate, prior, replacement };
  };

  const afterCreate = await createChain('AfterCreate');
  const afterSwitch = await createChain('AfterSwitch', true);
  const repair = await cvQueue._repairReplacementActivationsForTests();
  assert.equal(repair.examined, 2);
  for (const chain of [afterCreate, afterSwitch]) {
    const [prior, candidate] = await Promise.all([
      CVProcessingJob.findById(chain.prior._id).lean(),
      Candidate.findById(chain.candidate._id).lean()
    ]);
    assert.equal(String(prior.supersededBy), String(chain.replacement._id));
    assert.equal(prior.retry?.availableUntil, undefined);
    assert.equal(candidate.processingMetadata.cvProcessingJobId, chain.replacement.publicId);
    await assert.rejects(
      () => cvQueue.retryFailedJob(chain.prior.publicId, {
        organizationId: organization._id,
        requestedBy: { type: 'user', id: new mongoose.Types.ObjectId() }
      }),
      (error) => error.code === 'CV_RETRY_SUPERSEDED'
    );
  }

  await assert.rejects(
    () => cvQueue._mergeAnalysisOntoCandidateForTests(afterCreate.prior, {
      extractedFields: { experience: 'Stale revision must never overwrite' }
    }),
    (error) => error.code === 'CV_LINKED_CANDIDATE_NOT_CURRENT'
  );
  await cvQueue._mergeAnalysisOntoCandidateForTests(afterCreate.replacement, {
    extractedFields: { experience: 'Corrected current revision' }
  });
  assert.equal(
    (await Candidate.findById(afterCreate.candidate._id).lean()).experience,
    'Corrected current revision'
  );
});

test('bulk submission replays only an identical ordered SHA manifest', async () => {
  const organization = await Organization.create(organizationPayload('Batch Fingerprint Org'));
  const actorId = new mongoose.Types.ObjectId();
  const manifest = [
    { name: 'ada.pdf', bytes: 'Ada batch CV bytes' },
    { name: 'grace.pdf', bytes: 'Grace batch CV bytes' }
  ];
  const first = await cvQueue.submitBatch(batchRequest(
    await batchFiles(manifest),
    organization._id,
    actorId,
    'ordered-batch-key'
  ));
  assert.equal(first.duplicate, false);
  assert.equal(first.totalFiles, 2);

  const exact = await cvQueue.submitBatch(batchRequest(
    await batchFiles(manifest),
    organization._id,
    actorId,
    'ordered-batch-key'
  ));
  assert.equal(exact.duplicate, true);
  assert.equal(exact.batchId, first.batchId);

  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(
      await batchFiles([...manifest].reverse()),
      organization._id,
      actorId,
      'ordered-batch-key'
    )),
    (error) => error.code === 'CV_IDEMPOTENCY_KEY_REUSED' && error.statusCode === 409
  );
  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(
      await batchFiles([
        manifest[0],
        { name: manifest[1].name, bytes: 'replacement bytes' }
      ]),
      organization._id,
      actorId,
      'ordered-batch-key'
    )),
    (error) => error.code === 'CV_IDEMPOTENCY_KEY_REUSED' && error.statusCode === 409
  );
  assert.equal(await CVProcessingBatch.countDocuments({}), 1);
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 2);
});

test('bulk receipt commits before children and rejects a changed manifest after an intake crash', async () => {
  const organization = await Organization.create(organizationPayload('Batch Receipt Org'));
  const actorId = new mongoose.Types.ObjectId();
  const key = 'batch-receipt-before-children';
  const manifest = [
    { name: 'one.pdf', bytes: 'first durable batch body' },
    { name: 'two.pdf', bytes: 'second durable batch body' }
  ];
  cvQueue._setDependenciesForTests({
    batchLifecycleHooks: {
      async afterReceipt() {
        throw new Error('synthetic process exit after batch receipt');
      }
    }
  });
  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(await batchFiles(manifest), organization._id, actorId, key)),
    /synthetic process exit/
  );
  let receipt = await CVProcessingBatch.findOne({ organization: organization._id, actor: actorId })
    .select('+requestFingerprint +intakeLeaseId');
  assert.equal(receipt.intakeState, 'accepting');
  assert.equal(receipt.jobs.length, 0);
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 0);

  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(
      await batchFiles(manifest), organization._id, actorId, key
    )),
    (error) => error.code === 'CV_BATCH_INTAKE_IN_PROGRESS'
      && error.statusCode === 425
      && error.retryAfterSeconds > 0
  );

  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(
      await batchFiles([{ ...manifest[0], bytes: 'changed body' }, manifest[1]]),
      organization._id,
      actorId,
      key
    )),
    (error) => error.code === 'CV_IDEMPOTENCY_KEY_REUSED' && error.statusCode === 409
  );

  cvQueue._setDependenciesForTests({ batchLifecycleHooks: {} });
  await CVProcessingBatch.updateOne(
    { _id: receipt._id },
    { $set: { intakeLeaseAt: new Date(Date.now() - 10 * 60 * 1000) } }
  );
  const resumed = await cvQueue.submitBatch(batchRequest(
    await batchFiles(manifest), organization._id, actorId, key
  ));
  assert.equal(resumed.duplicate, true);
  receipt = await CVProcessingBatch.findById(receipt._id).lean();
  assert.equal(receipt.intakeState, 'accepted');
  assert.equal(receipt.jobs.length, 2);
  assert.equal(receipt.rejected.length, 0);
});

test('concurrent identical bulk requests have one intake owner and one tracked child', async () => {
  const organization = await Organization.create(organizationPayload('Batch Lease Org'));
  const actorId = new mongoose.Types.ObjectId();
  const manifest = [{ name: 'only.pdf', bytes: 'one leased batch candidate' }];
  let releaseOwner;
  let ownerEntered;
  const entered = new Promise((resolve) => { ownerEntered = resolve; });
  cvQueue._setDependenciesForTests({
    batchLifecycleHooks: {
      async afterReceipt() {
        ownerEntered();
        await new Promise((resolve) => { releaseOwner = resolve; });
      }
    }
  });
  const first = cvQueue.submitBatch(batchRequest(
    await batchFiles(manifest), organization._id, actorId, 'concurrent-batch-key'
  ));
  await entered;
  await assert.rejects(
    async () => cvQueue.submitBatch(batchRequest(
      await batchFiles(manifest), organization._id, actorId, 'concurrent-batch-key'
    )),
    (error) => error.code === 'CV_BATCH_INTAKE_IN_PROGRESS' && error.statusCode === 425
  );
  releaseOwner();
  const accepted = await first;
  assert.equal(accepted.duplicate, false);
  const batch = await CVProcessingBatch.findOne({ organization: organization._id }).lean();
  assert.equal(batch.jobs.length, 1);
  assert.equal(batch.rejected.length, 0);
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 1);
});

test('two actors may reuse a bulk key without sharing child jobs', async () => {
  const organization = await Organization.create(organizationPayload('Actor Batch Key Org'));
  const actorA = new mongoose.Types.ObjectId();
  const actorB = new mongoose.Types.ObjectId();
  const manifest = [{ name: 'shared.pdf', bytes: 'same bytes but independent actor batches' }];
  const [first, second] = await Promise.all([
    cvQueue.submitBatch(batchRequest(await batchFiles(manifest), organization._id, actorA, 'shared-key')),
    cvQueue.submitBatch(batchRequest(await batchFiles(manifest), organization._id, actorB, 'shared-key'))
  ]);
  assert.notEqual(first.batchId, second.batchId);
  const batches = await CVProcessingBatch.find({ organization: organization._id }).lean();
  assert.equal(batches.length, 2);
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 2);
  assert.notEqual(String(batches[0].jobs[0]), String(batches[1].jobs[0]));
});

test('bulk manifest hashing honors the configured ingestion concurrency bound', async () => {
  const organization = await Organization.create(organizationPayload('Bounded Hash Org'));
  const actorId = new mongoose.Types.ObjectId();
  const previous = process.env.CV_BULK_INGEST_CONCURRENCY;
  process.env.CV_BULK_INGEST_CONCURRENCY = '3';
  let active = 0;
  let maximum = 0;
  cvQueue._setDependenciesForTests({
    batchFileHasher: async (filePath) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return crypto.createHash('sha256').update(filePath).digest('hex');
    }
  });
  try {
    const manifest = Array.from({ length: 12 }, (_, index) => ({
      name: `candidate-${index}.pdf`,
      bytes: `candidate body ${index}`
    }));
    await cvQueue.submitBatch(batchRequest(
      await batchFiles(manifest), organization._id, actorId, 'bounded-hash-key'
    ));
    assert.ok(maximum <= 3, `observed ${maximum} concurrent hash streams`);
  } finally {
    if (previous == null) delete process.env.CV_BULK_INGEST_CONCURRENCY;
    else process.env.CV_BULK_INGEST_CONCURRENCY = previous;
  }
});

test('bulk staging enforces an aggregate disk quota before the durable intake begins', async () => {
  const previous = process.env.CV_BULK_MAX_TOTAL_BYTES;
  process.env.CV_BULK_MAX_TOTAL_BYTES = String(10 * 1024 * 1024);
  const quotaApp = express();
  quotaApp.post(
    '/bulk',
    bulkUploadRouter._prepareBulkStagingForTests,
    bulkUploadRouter._receiveBulkCvFilesForTests,
    (_req, res) => res.status(204).end()
  );
  const quotaServer = http.createServer(quotaApp);
  try {
    await new Promise((resolve) => quotaServer.listen(0, '127.0.0.1', resolve));
    const form = new FormData();
    form.append('resumes', new Blob([Buffer.alloc(6 * 1024 * 1024, 1)], {
      type: 'application/pdf'
    }), 'one.pdf');
    form.append('resumes', new Blob([Buffer.alloc(6 * 1024 * 1024, 2)], {
      type: 'application/pdf'
    }), 'two.pdf');
    const response = await fetch(
      `http://127.0.0.1:${quotaServer.address().port}/bulk`,
      { method: 'POST', body: form }
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'CV_BULK_AGGREGATE_LIMIT_EXCEEDED');

    // Multer cleanup and the response-finish hook remove both staged files and
    // the per-request directory even though the route handler never ran.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const entries = await fs.promises.readdir(bulkUploadRouter._bulkUploadRootForTests)
      .catch(() => []);
    assert.equal(entries.filter((entry) => entry.startsWith('cv-bulk-')).length, 0);
  } finally {
    if (previous == null) delete process.env.CV_BULK_MAX_TOTAL_BYTES;
    else process.env.CV_BULK_MAX_TOTAL_BYTES = previous;
    if (quotaServer.listening) await new Promise((resolve) => quotaServer.close(resolve));
  }
});

test('active bulk batches have no TTL and become expirable only after every child is terminal', async () => {
  const organization = await Organization.create(organizationPayload('Batch Retention Org'));
  const child = await CVProcessingJob.create({
    publicId: `cv_batch_waiting_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: 'f'.repeat(64), state: 'waiting_for_chatgpt', stage: 'retry_scheduled', progress: 40,
    organization: organization._id, source: 'bulk', originalName: 'waiting.pdf',
    fileType: 'application/pdf', fileSize: 64
  });
  const batch = await CVProcessingBatch.create({
    publicId: `batch_waiting_${new mongoose.Types.ObjectId()}`,
    organization: organization._id, actor: new mongoose.Types.ObjectId(),
    intakeState: 'accepted', jobs: [child._id], rejected: [], totalFiles: 1,
    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
  });
  await cvQueue._reconcileBatchRetentionForTests({ now: new Date(), pageSize: 1 });
  assert.equal((await CVProcessingBatch.findById(batch._id).lean()).expiresAt, undefined);
  await CVProcessingJob.updateOne(
    { _id: child._id },
    { $set: { state: 'completed', stage: 'completed', completedAt: new Date(), progress: 100 } }
  );
  await cvQueue._reconcileBatchRetentionForTests({ now: new Date(), pageSize: 1 });
  const terminal = await CVProcessingBatch.findById(batch._id).lean();
  assert.ok(terminal.expiresAt > new Date());
});

test('candidate deletion during AI tombstones the job, removes assets, redacts history, and never resurrects the candidate', async () => {
  const organization = await Organization.create(organizationPayload('Deletion Org'));
  const jobId = new mongoose.Types.ObjectId();
  const candidate = await Candidate.create({
    firstName: 'Delete',
    lastName: 'During AI',
    email: 'delete@example.com',
    phone: '123',
    position: 'Engineer',
    experience: 'Pending',
    education: 'Pending',
    organization: organization._id,
    source: 'public',
    jobAppliedFor: jobId
  });
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_delete_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64),
    state: 'queued',
    stage: 'stored',
    progress: 40,
    organization: organization._id,
    actor: new mongoose.Types.ObjectId(),
    jobAppliedFor: jobId,
    source: 'public',
    originalName: 'delete-me.pdf',
    fileType: 'application/pdf',
    fileSize: 100,
    resumeText: 'Readable extracted resume text with enough content for analysis and profile creation.',
    durableFile: {
      provider: 'gridfs',
      bucket: 'cv_ingestion_files',
      fileId: new mongoose.Types.ObjectId().toString(),
      sha256: 'c'.repeat(64),
      length: 100,
      persistedAt: new Date(),
      cleanupState: 'retained'
    },
    cloudinary: {
      resumeUrl: 'https://example.invalid/delete-me',
      publicId: 'cv/delete-me',
      resourceType: 'raw',
      deliveryType: 'authenticated',
      cleanupState: 'retained'
    },
    linkedCandidate: candidate._id,
    formData: { firstName: 'Delete', lastName: 'During AI', email: 'delete@example.com' }
  });
  await Candidate.updateOne(
    { _id: candidate._id },
    { $set: { 'processingMetadata.cvProcessingJobId': processingJob.publicId } }
  );
  await Notification.create({
    user: new mongoose.Types.ObjectId(),
    type: 'candidate_uploaded',
    title: 'Candidate uploaded',
    message: 'Delete During AI was added',
    data: {
      candidateId: candidate._id,
      candidateName: 'Delete During AI',
      email: candidate.email,
      organizationId: organization._id
    },
    eventKey: `cv-completed:${processingJob.publicId}`
  });

  let releaseAnalysis;
  let analysisStarted;
  const started = new Promise((resolve) => { analysisStarted = resolve; });
  let gridDeleted = 0;
  let cloudDeleted = 0;
  cvQueue._setDependenciesForTests({
    dispatchInferenceRunner: async (_bull, _token, run) => run({ signal: undefined }),
    durableFileStore: {
      async remove() { gridDeleted += 1; return true; }
    },
    cloudinary: {
      async deleteFile() { cloudDeleted += 1; return { success: true }; }
    },
    cvParser: {
      async analyzeText() {
        analysisStarted();
        await new Promise((resolve) => { releaseAnalysis = resolve; });
        return {
          success: true,
          extractedFields: {
            firstName: 'Delete', lastName: 'During AI', email: 'delete@example.com',
            phone: '123', position: 'Engineer', experience: 'Should never commit', education: 'BSc'
          }
        };
      }
    }
  });
  const running = cvQueue._processJobForTests(delivery(processingJob));
  await started;
  await cvQueue.redactCandidateProcessingData(organization._id, [candidate._id]);
  await Candidate.deleteOne({ _id: candidate._id });
  releaseAnalysis();
  const result = await running;
  assert.equal(result.cancelled, true);
  const tombstone = await CVProcessingJob.findById(processingJob._id).select('+resumeText').lean();
  const audit = await CVProcessingAudit.findOne({ publicId: processingJob.publicId }).lean();
  assert.equal(tombstone.state, 'cancelled');
  assert.equal(tombstone.originalName, '[redacted]');
  assert.equal(tombstone.linkedCandidate, undefined);
  assert.equal(tombstone.actor, undefined);
  assert.equal(tombstone.resumeText, '');
  assert.equal(await Candidate.countDocuments({ _id: candidate._id }), 0);
  assert.ok(gridDeleted >= 1);
  assert.ok(cloudDeleted >= 1);
  assert.equal(audit.originalName, '[redacted]');
  assert.equal(audit.actor, undefined);
  assert.equal(audit.linkedCandidate, undefined);
  assert.equal(audit.error?.message, undefined);
  assert.equal(await Notification.countDocuments({ 'data.candidateId': candidate._id }), 0);
});

test('candidate deletion during an external upload cleans the precommitted Cloudinary intent', async () => {
  const organization = await Organization.create(organizationPayload('Upload Intent Erasure Org'));
  const candidate = await Candidate.create({
    firstName: 'Upload', lastName: 'Intent', email: 'upload-intent@example.com', phone: '123',
    position: 'Engineer', experience: 'Five years', education: 'BSc',
    organization: organization._id, source: 'manual'
  });
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_upload_intent_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: '9'.repeat(64),
    state: 'queued',
    stage: 'stored',
    progress: 30,
    organization: organization._id,
    actor: new mongoose.Types.ObjectId(),
    source: 'private',
    originalName: 'upload-intent.pdf',
    fileType: 'application/pdf',
    fileSize: 64,
    linkedCandidate: candidate._id,
    durableFile: {
      provider: 'gridfs', bucket: 'cv_ingestion_files',
      fileId: new mongoose.Types.ObjectId().toString(), sha256: '8'.repeat(64),
      length: 64, persistedAt: new Date(), cleanupState: 'retained'
    }
  });
  await Candidate.updateOne(
    { _id: candidate._id },
    { $set: { 'processingMetadata.cvProcessingJobId': processingJob.publicId } }
  );

  let releaseUpload;
  let uploadStarted;
  const started = new Promise((resolve) => { uploadStarted = resolve; });
  let cloudDeletes = 0;
  cvQueue._setDependenciesForTests({
    durableFileStore: {
      async materialize() { return { filePath: 'synthetic-upload-intent.pdf', async cleanup() {} }; },
      async remove() { return true; }
    },
    cloudinary: {
      async uploadFile(_filePath, _fileType, options) {
        uploadStarted();
        await new Promise((resolve) => { releaseUpload = resolve; });
        return {
          success: true,
          resumeUrl: 'https://provider.invalid/intent.pdf',
          publicId: `resumes/documents/${options.publicId}`,
          resourceType: 'raw',
          deliveryType: 'authenticated',
          uploadResult: { asset_id: 'upload-intent-asset' }
        };
      },
      async deleteFile() { cloudDeletes += 1; return { success: true }; }
    },
    cvParser: { async parseCV() { return 'unused because cancellation wins before extraction'; } }
  });
  const running = cvQueue._processJobForTests(delivery(processingJob));
  await started;
  const duringUpload = await CVProcessingJob.findById(processingJob._id).lean();
  assert.match(
    duringUpload.cloudinaryUploadIntent.publicId,
    new RegExp(`^resumes/documents/${processingJob.publicId}_`)
  );
  await cvQueue.eraseCandidateProcessingData(organization._id, [candidate._id]);
  releaseUpload();
  await running.catch(() => {});

  const cancelled = await CVProcessingJob.findById(processingJob._id).lean();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.cloudinaryUploadIntent, undefined);
  assert.ok(cloudDeletes >= 1);
  assert.equal(await Candidate.exists({ _id: candidate._id }), null);
  await cvQueue._retryStorageCleanupForTests({
    now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    limit: 100
  });
  assert.equal(await CVStorageCleanupTask.countDocuments({
    provider: 'cloudinary',
    state: { $in: ['held', 'pending'] }
  }), 0);
});

test('an old upload-intent cleanup cannot delete a successful retry generation', async () => {
  const organization = await Organization.create(organizationPayload('Cloud Retry Generation Org'));
  const filePath = await privateRequestFile('generation-safe cloudinary upload bytes');
  const accepted = await cvQueue.submitUpload(
    privateRequest(filePath, organization._id, 'cloud-retry-generation'),
    'private'
  );
  await CVProcessingJob.updateOne(
    { _id: accepted.job._id },
    { $set: { boundedFailureAttempts: 4 } }
  );

  const providerIds = [];
  const deletedProviderIds = [];
  let uploadCalls = 0;
  cvQueue._setDependenciesForTests({
    enqueueJob: async () => ({ id: accepted.job.publicId }),
    durableFileStore: {
      async materialize() {
        return { filePath: 'synthetic-generation-retry.pdf', async cleanup() {} };
      },
      async remove() { return true; }
    },
    cloudinary: {
      async uploadFile(_path, _type, options) {
        uploadCalls += 1;
        providerIds.push(`resumes/documents/${options.publicId}`);
        if (uploadCalls === 1) return { success: false, error: 'synthetic uncertain upload failure' };
        return {
          success: true,
          resumeUrl: 'https://provider.invalid/current-generation.pdf',
          publicId: providerIds.at(-1),
          resourceType: 'raw',
          deliveryType: 'authenticated',
          uploadResult: { asset_id: 'current-generation-asset' }
        };
      },
      async deleteFile(publicId) {
        deletedProviderIds.push(publicId);
        return { success: true };
      }
    },
    cvParser: {
      async parseCV() {
        return 'Generation safe extracted CV text with enough characters to pass validation.';
      },
      async analyzeText() {
        return {
          success: true,
          candidate: {
            firstName: 'Generation', lastName: 'Safe', email: 'generation-safe@example.com',
            phone: '123', position: 'Engineer', experience: 'Five years', education: 'BSc',
            skills: ['Node.js'], status: 'New'
          }
        };
      }
    }
  });

  await assert.rejects(
    () => cvQueue._processJobForTests(delivery(accepted.job)),
    /synthetic uncertain upload failure/
  );
  assert.equal((await CVProcessingJob.findById(accepted.job._id)).state, 'failed');

  // Maintenance durably records cleanup for the uncertain first attempt.
  await cvQueue._retryStorageCleanupForTests({ now: new Date(), limit: 100 });
  const oldTask = await CVStorageCleanupTask.findOne({
    jobPublicId: accepted.job.publicId,
    reason: 'terminal-cloudinary-upload-intent'
  });
  assert.ok(oldTask);
  const oldProviderId = oldTask.resource.publicId;

  await cvQueue.retryFailedJob(accepted.job.publicId, {
    organizationId: organization._id,
    requestedBy: { type: 'user', id: String(new mongoose.Types.ObjectId()) },
    stage: 'parsing'
  });
  const queued = await CVProcessingJob.findById(accepted.job._id);
  await cvQueue._processJobForTests(delivery(queued));

  const completed = await CVProcessingJob.findById(accepted.job._id);
  assert.equal(completed.state, 'completed');
  assert.equal(providerIds.length, 2);
  assert.notEqual(providerIds[0], providerIds[1]);
  assert.equal(completed.cloudinary.publicId, providerIds[1]);

  // Even a cleanup task that was already in flight targets the immutable old
  // provider identity, never the current retry asset.
  await CVStorageCleanupTask.updateOne(
    { _id: oldTask._id },
    {
      $set: {
        state: 'pending',
        nextAttemptAt: new Date(Date.now() - 1),
        reconcileUntil: new Date(Date.now() - 1)
      },
      $unset: { completedAt: 1, expiresAt: 1 }
    }
  );
  await cvQueue._retryStorageCleanupForTests({
    now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    limit: 100
  });
  assert.ok(deletedProviderIds.includes(oldProviderId));
  assert.ok(!deletedProviderIds.includes(completed.cloudinary.publicId));
});

test('an in-flight Cloudinary intent remains a recurring cleanup receipt after worker loss', async () => {
  const organization = await Organization.create(organizationPayload('Cloud Uncertainty Org'));
  const candidate = await Candidate.create({
    firstName: 'Cloud', lastName: 'Uncertain', email: 'cloud-uncertain@example.com', phone: '123',
    position: 'Engineer', experience: 'Five years', education: 'BSc',
    organization: organization._id, source: 'manual'
  });
  const generation = crypto.randomUUID();
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_cloud_uncertain_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: '7'.repeat(64), state: 'processing', stage: 'uploading', progress: 20,
    processingLeaseId: crypto.randomUUID(), organization: organization._id,
    source: 'private', originalName: 'uncertain.pdf', fileType: 'application/pdf', fileSize: 64,
    linkedCandidate: candidate._id,
    cloudinaryUploadIntent: {
      publicId: 'resumes/documents/uncertain-provider-asset',
      resourceType: 'raw', deliveryType: 'authenticated', generation, preparedAt: new Date()
    }
  });
  await Candidate.updateOne(
    { _id: candidate._id },
    { $set: { 'processingMetadata.cvProcessingJobId': processingJob.publicId } }
  );
  let assetPresent = false;
  let deletes = 0;
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async deleteFile() {
        deletes += 1;
        assetPresent = false;
        return { success: true };
      }
    },
    durableFileStore: { async remove() { return true; } }
  });
  await cvQueue.eraseCandidateProcessingData(organization._id, [candidate._id]);
  const receipt = await CVStorageCleanupTask.findOne({
    provider: 'cloudinary',
    'resource.publicId': 'resumes/documents/uncertain-provider-asset',
    reason: /upload-intent/
  });
  assert.ok(receipt);
  assert.equal(receipt.state, 'pending');
  assert.equal(deletes, 0, 'cleanup must not declare not-found while upload can still commit');

  await cvQueue._retryStorageCleanupForTests({
    now: new Date(Date.now() + 60 * 60 * 1000),
    limit: 100
  });
  assert.ok(deletes >= 1);
  assert.equal((await CVStorageCleanupTask.findById(receipt._id)).state, 'pending');

  // Simulate Cloudinary committing after the first not-found destroy and the
  // worker process exiting before it could run its local compensation.
  assetPresent = true;
  await CVStorageCleanupTask.updateOne(
    { _id: receipt._id },
    {
      $set: {
        nextAttemptAt: new Date(Date.now() - 1),
        reconcileUntil: new Date(Date.now() - 1)
      }
    }
  );
  await cvQueue._retryStorageCleanupForTests({
    now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    limit: 100
  });
  assert.ok(deletes >= 2);
  assert.equal(assetPresent, false);
  assert.equal((await CVStorageCleanupTask.findById(receipt._id)).state, 'completed');
});

test('completion effects compensate notification and embedding writes that finish after candidate deletion', async () => {
  const organization = await Organization.create(organizationPayload('Completion Cancellation Org'));
  const createCompleted = async (suffix, effectState = {}) => {
    const candidate = await Candidate.create({
      firstName: 'Completion', lastName: suffix,
      email: `completion-${suffix.toLowerCase()}@example.com`, phone: '123',
      position: 'Engineer', experience: 'Five years', education: 'BSc',
      organization: organization._id, source: 'manual'
    });
    const job = await CVProcessingJob.create({
      publicId: `cv_completion_${suffix.toLowerCase()}_${new mongoose.Types.ObjectId()}`,
      statusTokenHash: crypto.createHash('sha256').update(`completion-${suffix}`).digest('hex'),
      state: 'completed', stage: 'completed', progress: 100,
      organization: organization._id, source: 'private',
      originalName: `${suffix}.pdf`, fileType: 'application/pdf', fileSize: 32,
      candidate: candidate._id,
      linkedCandidate: candidate._id,
      completedAt: new Date(),
      completionEffects: effectState
    });
    await Candidate.updateOne(
      { _id: candidate._id },
      { $set: { 'processingMetadata.cvProcessingJobId': job.publicId } }
    );
    return { candidate, job };
  };

  const notificationCase = await createCompleted('Notification');
  let releaseNotification;
  let notificationStarted;
  const notificationBarrier = new Promise((resolve) => { notificationStarted = resolve; });
  cvQueue._setDependenciesForTests({
    completionEffectHandlers: {
      async candidateNotification(job, candidate) {
        await Notification.create({
          user: new mongoose.Types.ObjectId(),
          type: 'candidate_uploaded',
          title: `Candidate ${candidate.firstName}`,
          message: `Candidate ${candidate.email}`,
          data: {
            candidateId: candidate._id,
            candidateName: candidate.firstName,
            email: candidate.email,
            organizationId: candidate.organization
          },
          eventKey: `cv-completed:${job.publicId}`
        });
        notificationStarted();
        await new Promise((resolve) => { releaseNotification = resolve; });
      }
    }
  });
  const notificationDelivery = cvQueue._deliverCompletionEffectsForTests(notificationCase.job._id);
  await notificationBarrier;
  await cvQueue.eraseCandidateProcessingData(organization._id, [notificationCase.candidate._id]);
  releaseNotification();
  await notificationDelivery;
  assert.equal(await Notification.countDocuments({
    eventKey: `cv-completed:${notificationCase.job.publicId}`
  }), 0);

  const embeddingCase = await createCompleted('Embedding', {
    candidateNotification: { status: 'skipped' },
    gptCacheInvalidation: { status: 'skipped' },
    websocketBroadcast: { status: 'skipped' },
    embedding: { status: 'pending' },
    limitReachedNotification: { status: 'skipped' }
  });
  let vectorExists = false;
  let releaseEmbedding;
  let embeddingStarted;
  const embeddingBarrier = new Promise((resolve) => { embeddingStarted = resolve; });
  const previousDeleteEmbedding = embeddingService.deleteEmbedding;
  embeddingService.deleteEmbedding = async () => { vectorExists = false; return true; };
  cvQueue._setDependenciesForTests({
    completionEffectHandlers: {
      async embedding() {
        embeddingStarted();
        await new Promise((resolve) => { releaseEmbedding = resolve; });
        vectorExists = true;
      }
    }
  });
  try {
    const embeddingDelivery = cvQueue._deliverCompletionEffectsForTests(embeddingCase.job._id);
    await embeddingBarrier;
    await cvQueue.eraseCandidateProcessingData(organization._id, [embeddingCase.candidate._id]);
    releaseEmbedding();
    await embeddingDelivery;
    assert.equal(vectorExists, false);
  } finally {
    embeddingService.deleteEmbedding = previousDeleteEmbedding;
  }
});

test('candidate deletion commits cleanup safely and a failed hard delete leaves only a recoverable tombstone', async () => {
  const organization = await Organization.create(organizationPayload('Erasure Outbox Org'));
  const createCandidate = (email, publicId) => Candidate.create({
    firstName: 'Erasure',
    lastName: 'Applicant',
    email,
    phone: '+44 7700 900002',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual',
    cloudinaryPublicId: publicId,
    cloudinaryResourceType: 'raw',
    cloudinaryDeliveryType: 'authenticated'
  });

  const retained = await createCandidate('registration-failure@example.com', 'cv/registration-failure');
  const originalRegister = CVStorageCleanupTask.findOneAndUpdate;
  CVStorageCleanupTask.findOneAndUpdate = async () => {
    throw new Error('synthetic cleanup registration outage');
  };
  try {
    const response = controllerResponse();
    await candidateController.deleteCandidate({
      params: { id: String(retained._id) },
      user: { currentOrganization: organization._id }
    }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'CV_ERASURE_REGISTRATION_FAILED');
    assert.ok(await Candidate.exists({ _id: retained._id }));
  } finally {
    CVStorageCleanupTask.findOneAndUpdate = originalRegister;
  }

  const deferred = await createCandidate('provider-failure@example.com', 'cv/provider-failure');
  const previousDeleteEmbedding = embeddingService.deleteEmbedding;
  embeddingService.deleteEmbedding = async () => {
    throw new Error('synthetic embedding provider outage');
  };
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async deleteFile() { return { success: false, error: 'synthetic cloud provider outage' }; }
    }
  });
  try {
    const response = controllerResponse();
    await candidateController.deleteCandidate({
      params: { id: String(deferred._id) },
      user: { currentOrganization: organization._id }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.deletedCandidate.pending, false);
    assert.equal(await Candidate.exists({ _id: deferred._id }), null);
    const tasks = await CVStorageCleanupTask.find({
      provider: { $in: ['embedding', 'cloudinary'] },
      state: 'failed'
    }).lean();
    assert.ok(tasks.length >= 2);
    assert.ok(tasks.some((task) => task.provider === 'embedding'));
    assert.ok(tasks.some((task) => task.provider === 'cloudinary'));
  } finally {
    embeddingService.deleteEmbedding = previousDeleteEmbedding;
  }

  const hardDeleteFailure = await createCandidate(
    'hard-delete-failure@example.com',
    'cv/hard-delete-failure'
  );
  const originalDeleteOne = Candidate.deleteOne;
  Candidate.deleteOne = async function patchedDeleteOne(filter, ...rest) {
    if (
      String(filter?._id || '') === String(hardDeleteFailure._id)
      && filter?.deletionState === 'tombstoned'
    ) {
      throw new Error('synthetic final candidate delete outage');
    }
    return originalDeleteOne.call(this, filter, ...rest);
  };
  try {
    const response = controllerResponse();
    await candidateController.deleteCandidate({
      params: { id: String(hardDeleteFailure._id) },
      user: { currentOrganization: organization._id }
    }, response);
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.deletedCandidate.pending, true);
    assert.equal(response.body.deletedCandidate.hardDeleted, false);
    const tombstone = await Candidate.findById(hardDeleteFailure._id)
      .select('+deletionState +deletionToken +deletionRequestedAt')
      .lean();
    assert.equal(tombstone.deletionState, 'tombstoned');
    assert.ok(tombstone.deletionToken);
    assert.ok(tombstone.deletionRequestedAt);
    assert.equal(tombstone.firstName, '[deleted]');
    assert.equal(tombstone.lastName, '[deleted]');
    assert.match(tombstone.email, /^deleted-[a-f0-9]+@redacted\.invalid$/);
    assert.equal(tombstone.resumeUrl, undefined);
    assert.equal(tombstone.cloudinaryPublicId, undefined);

    const listResponse = controllerResponse();
    await candidateController.getAllCandidates({
      user: { currentOrganization: organization._id },
      query: { page: 1, limit: 100 }
    }, listResponse);
    assert.equal(
      listResponse.body.candidates.some((candidate) => (
        String(candidate._id) === String(hardDeleteFailure._id)
      )),
      false
    );
  } finally {
    Candidate.deleteOne = originalDeleteOne;
  }
  const recovered = await cvQueue._recoverTombstonedCandidateErasuresForTests();
  assert.equal(recovered.recovered, 1);
  assert.equal(await Candidate.exists({ _id: hardDeleteFailure._id }), null);
});

test('held erasure receipts survive an activation crash and deletion generations do not reuse completed tasks', async () => {
  const organization = await Organization.create(organizationPayload('Erasure Generation Org'));
  const candidateId = new mongoose.Types.ObjectId();
  const createGeneration = (email, cloudinaryPublicId) => Candidate.create({
    _id: candidateId,
    firstName: 'Generation',
    lastName: 'Applicant',
    email,
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual',
    isEmbedded: true,
    ...(cloudinaryPublicId ? {
      cloudinaryPublicId,
      cloudinaryResourceType: 'raw',
      cloudinaryDeliveryType: 'authenticated'
    } : {})
  });
  await createGeneration('generation-one@example.com', 'cv/generation-one');

  let embeddingDeletes = 0;
  let cloudDeletes = 0;
  const previousDeleteEmbedding = embeddingService.deleteEmbedding;
  embeddingService.deleteEmbedding = async () => { embeddingDeletes += 1; return true; };
  cvQueue._setDependenciesForTests({
    cloudinary: {
      async deleteFile(publicId) {
        if (publicId === 'cv/generation-one') cloudDeletes += 1;
        return { success: true };
      }
    }
  });

  const originalUpdateOne = CVStorageCleanupTask.updateOne;
  CVStorageCleanupTask.updateOne = async function patchedUpdateOne(filter, update, ...rest) {
    if (filter?.state === 'held' && update?.$set?.state === 'pending') {
      throw new Error('synthetic crash after candidate tombstone');
    }
    return originalUpdateOne.call(this, filter, update, ...rest);
  };
  try {
    await assert.rejects(
      () => cvQueue.eraseCandidateProcessingData(organization._id, [candidateId]),
      /synthetic crash after candidate tombstone/
    );
  } finally {
    CVStorageCleanupTask.updateOne = originalUpdateOne;
  }

  const tombstone = await Candidate.findById(candidateId)
    .select('+deletionState +deletionToken cloudinaryPublicId')
    .lean();
  assert.equal(tombstone.deletionState, 'tombstoned');
  assert.equal(tombstone.cloudinaryPublicId, undefined);
  const held = await CVStorageCleanupTask.find({ state: 'held' }).lean();
  assert.ok(held.some((task) => task.resource.publicId === 'cv/generation-one'));
  assert.ok(held.every((task) => !task.expiresAt));

  // Simulate a row written by the pre-cutover 24-hour TTL implementation.
  await CVStorageCleanupTask.updateMany(
    { state: 'held' },
    { $set: { expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
  );
  const migration = await cvProcessingCompatibility._ensureCleanupTaskRetentionForTests();
  assert.ok(migration.protectedReceipts >= 1);
  assert.equal(await CVStorageCleanupTask.countDocuments({ state: 'held', expiresAt: { $exists: true } }), 0);
  const ttlIndex = (await CVStorageCleanupTask.collection.indexes())
    .find((index) => index.key?.expiresAt === 1);
  assert.equal(ttlIndex.partialFilterExpression?.state, 'completed');

  const recovery = await cvQueue._recoverTombstonedCandidateErasuresForTests({ limit: 1 });
  assert.equal(recovery.recovered, 1);
  await cvQueue._retryStorageCleanupForTests({ now: new Date(), limit: 100 });
  assert.equal(cloudDeletes, 1);
  const firstGenerationEmbeddingDeletes = embeddingDeletes;
  assert.ok(firstGenerationEmbeddingDeletes >= 1);

  await createGeneration('generation-two@example.com');
  await cvQueue.eraseCandidateProcessingData(organization._id, [candidateId]);
  await cvQueue._retryStorageCleanupForTests({ now: new Date(), limit: 100 });
  assert.ok(
    embeddingDeletes > firstGenerationEmbeddingDeletes,
    'a completed receipt from the first deterministic Candidate ID generation must not suppress the second'
  );
  const embeddingTasks = await CVStorageCleanupTask.find({
    provider: 'embedding',
    'resource.candidateId': String(candidateId)
  }).lean();
  assert.ok(embeddingTasks.length >= 3);
  embeddingService.deleteEmbedding = previousDeleteEmbedding;
});

test('a partial cleanup registration retry reuses and activates the durable preparation generation', async () => {
  const organization = await Organization.create(organizationPayload('Partial Registration Org'));
  const candidate = await Candidate.create({
    firstName: 'Partial',
    lastName: 'Registration',
    email: 'partial-registration@example.com',
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual',
    cloudinaryPublicId: 'cv/partial-registration',
    cloudinaryResourceType: 'raw',
    cloudinaryDeliveryType: 'authenticated'
  });
  cvQueue._setDependenciesForTests({
    cloudinary: { async deleteFile() { return { success: true }; } }
  });
  const originalRegister = CVStorageCleanupTask.findOneAndUpdate;
  let registrations = 0;
  CVStorageCleanupTask.findOneAndUpdate = async function patchedRegister(...args) {
    registrations += 1;
    if (registrations === 2) throw new Error('synthetic partial registration outage');
    return originalRegister.apply(this, args);
  };
  try {
    await assert.rejects(
      () => cvQueue.eraseCandidateProcessingData(organization._id, [candidate._id]),
      (error) => error.code === 'CV_ERASURE_REGISTRATION_FAILED'
    );
  } finally {
    CVStorageCleanupTask.findOneAndUpdate = originalRegister;
  }
  const prepared = await Candidate.findById(candidate._id)
    .select('+deletionState +deletionPreparationToken')
    .lean();
  assert.equal(prepared.deletionState, 'active');
  assert.ok(prepared.deletionPreparationToken);
  assert.equal(await CVStorageCleanupTask.countDocuments({ state: 'held' }), 1);

  const result = await cvQueue.eraseCandidateProcessingData(organization._id, [candidate._id]);
  assert.equal(result.candidates[0].hardDeleted, true);
  assert.equal(await Candidate.exists({ _id: candidate._id }), null);
  assert.equal(await CVStorageCleanupTask.countDocuments({ state: 'held' }), 0);
  assert.ok(await CVStorageCleanupTask.exists({
    activationKey: prepared.deletionPreparationToken,
    state: 'completed'
  }));
});

test('a failed old embedding cleanup cannot erase a recreated deterministic candidate generation', async () => {
  const organization = await Organization.create(organizationPayload('Embedding Generation Fence Org'));
  const candidateId = new mongoose.Types.ObjectId();
  const createCandidate = (email) => Candidate.create({
    _id: candidateId,
    firstName: 'Embedding', lastName: 'Generation', email, phone: '123',
    position: 'Engineer', experience: 'Five years', education: 'BSc',
    organization: organization._id, source: 'manual', isEmbedded: true
  });
  await createCandidate('embedding-generation-one@example.com');

  const previousDeleteEmbedding = embeddingService.deleteEmbedding;
  let providerCalls = 0;
  let failProvider = true;
  embeddingService.deleteEmbedding = async () => {
    providerCalls += 1;
    if (failProvider) throw new Error('synthetic first-generation vector outage');
    return true;
  };
  try {
    await cvQueue.eraseCandidateProcessingData(organization._id, [candidateId]);
    assert.ok(await CVStorageCleanupTask.exists({
      provider: 'embedding',
      'resource.candidateId': String(candidateId),
      state: 'failed'
    }));
    await createCandidate('embedding-generation-two@example.com');
    failProvider = false;
    const callsBeforeOldRetry = providerCalls;
    await cvQueue._retryStorageCleanupForTests({
      now: new Date(Date.now() + 24 * 60 * 60 * 1000),
      limit: 100
    });
    assert.equal(
      providerCalls,
      callsBeforeOldRetry,
      'old failed tasks must be fenced while a replacement candidate generation is active'
    );

    await cvQueue.eraseCandidateProcessingData(organization._id, [candidateId]);
    assert.ok(providerCalls > callsBeforeOldRetry, 'the replacement generation must erase its own vector');
    assert.equal(await Candidate.exists({ _id: candidateId }), null);
  } finally {
    embeddingService.deleteEmbedding = previousDeleteEmbedding;
  }
});

test('candidate and organization tombstone recovery scan past permanently failing head pages', async () => {
  const organization = await Organization.create(organizationPayload('Candidate Recovery Pagination Org'));
  const [firstCandidate, secondCandidate] = await Candidate.create([
    {
      firstName: '[deleted]', lastName: '[deleted]', email: 'deleted-first@redacted.invalid',
      phone: '[deleted]', position: '[deleted]', experience: '[deleted]', education: '[deleted]',
      organization: organization._id, source: 'manual', deletionState: 'tombstoned',
      deletionToken: crypto.randomUUID(), deletionRequestedAt: new Date(Date.now() - 2000)
    },
    {
      firstName: '[deleted]', lastName: '[deleted]', email: 'deleted-second@redacted.invalid',
      phone: '[deleted]', position: '[deleted]', experience: '[deleted]', education: '[deleted]',
      organization: organization._id, source: 'manual', deletionState: 'tombstoned',
      deletionToken: crypto.randomUUID(), deletionRequestedAt: new Date(Date.now() - 1000)
    }
  ]);
  const originalCandidateDeleteOne = Candidate.deleteOne;
  Candidate.deleteOne = async function patchedDeleteOne(filter, ...rest) {
    if (String(filter?._id || '') === String(firstCandidate._id)) {
      throw new Error('persistent first candidate delete outage');
    }
    return originalCandidateDeleteOne.call(this, filter, ...rest);
  };
  try {
    const result = await cvQueue._recoverTombstonedCandidateErasuresForTests({ limit: 1 });
    assert.equal(result.examined, 2);
    assert.equal(result.recovered, 1);
    assert.ok(await Candidate.exists({ _id: firstCandidate._id }));
    assert.equal(await Candidate.exists({ _id: secondCandidate._id }), null);
  } finally {
    Candidate.deleteOne = originalCandidateDeleteOne;
  }

  const [firstOrganization, secondOrganization] = await Organization.create([
    organizationPayload('First Persistent Org Tombstone'),
    organizationPayload('Second Recoverable Org Tombstone')
  ]);
  await Promise.all([
    organizationErasureService.commitOrganizationTombstone(firstOrganization._id),
    organizationErasureService.commitOrganizationTombstone(secondOrganization._id)
  ]);
  const originalOrganizationDeleteOne = Organization.deleteOne;
  Organization.deleteOne = async function patchedDeleteOne(filter, ...rest) {
    if (String(filter?._id || '') === String(firstOrganization._id)) {
      throw new Error('persistent first organization delete outage');
    }
    return originalOrganizationDeleteOne.call(this, filter, ...rest);
  };
  try {
    const result = await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
    assert.equal(result.examined, 2);
    assert.equal(result.recovered, 1);
    assert.ok(await Organization.exists({ _id: firstOrganization._id }));
    assert.equal(await Organization.exists({ _id: secondOrganization._id }), null);
  } finally {
    Organization.deleteOne = originalOrganizationDeleteOne;
  }
});

test('organization erasure is restartable, registers every CV asset before child deletion, and tolerates provider/final-delete failures', async () => {
  const organization = await Organization.create(organizationPayload('Organization Erasure Org'));
  const job = await Job.create(jobPayload(organization._id));
  const candidate = await Candidate.create({
    firstName: 'Organization',
    lastName: 'Erasure',
    email: 'organization-erasure@example.com',
    phone: '+44 7700 900010',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual',
    cloudinaryPublicId: 'candidate-only/retained-after-job-ttl',
    cloudinaryResourceType: 'raw',
    cloudinaryDeliveryType: 'authenticated'
  });
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_org_erasure_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: 'd'.repeat(64),
    state: 'queued',
    stage: 'stored',
    progress: 30,
    organization: organization._id,
    actor: new mongoose.Types.ObjectId(),
    jobAppliedFor: job._id,
    source: 'private',
    originalName: 'organization-private-cv.pdf',
    fileType: 'application/pdf',
    fileSize: 128,
    resumeText: 'organization private CV PII',
    durableFile: {
      provider: 'gridfs',
      bucket: 'cv_ingestion_files',
      fileId: new mongoose.Types.ObjectId().toString(),
      sha256: 'e'.repeat(64),
      length: 128,
      persistedAt: new Date(),
      cleanupState: 'retained'
    },
    cloudinary: {
      publicId: 'organization/unlinked-processing-cv',
      resumeUrl: 'https://example.invalid/organization-cv',
      resourceType: 'raw',
      deliveryType: 'authenticated',
      cleanupState: 'retained'
    },
    formData: { email: 'organization-erasure@example.com' }
  });
  await CVProcessingAudit.create({
    publicId: processingJob.publicId,
    source: 'private',
    state: 'queued',
    stage: 'stored',
    progress: 30,
    organization: organization._id,
    organizationKey: String(organization._id),
    actor: processingJob.actor,
    originalName: processingJob.originalName,
    jobCreatedAt: new Date(),
    lastUpdatedAt: new Date()
  });
  await CVProcessingBatch.create({
    publicId: `batch_org_erasure_${new mongoose.Types.ObjectId()}`,
    organization: organization._id,
    actor: new mongoose.Types.ObjectId(),
    idempotencyKey: 'org-erasure-batch',
    requestFingerprint: 'f'.repeat(64),
    jobs: [processingJob._id],
    rejected: [{ fileName: 'rejected-private.pdf', error: 'email@example.com' }],
    totalFiles: 2
  });
  const interview = await Interview.create({
    jobId: job._id,
    candidateId: candidate._id,
    interviewerId: new mongoose.Types.ObjectId(),
    organizationId: organization._id,
    title: 'Organization erasure interview',
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    duration: 60
  });
  const feedback = await publicFeedbackCapability.issue(interview._id);
  assert.ok(feedback?.token);

  const originalRegister = CVStorageCleanupTask.findOneAndUpdate;
  CVStorageCleanupTask.findOneAndUpdate = async () => {
    throw new Error('synthetic organization cleanup registration outage');
  };
  try {
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    const tombstone = await Organization.findById(organization._id)
      .select('+erasureState +erasureToken +erasureLastError')
      .lean();
    assert.equal(tombstone.erasureState, 'tombstoned');
    assert.ok(tombstone.erasureToken);
    assert.match(tombstone.name, /^\[deleted organization/);
    assert.ok(await Candidate.exists({ _id: candidate._id }));
    assert.ok(await Job.exists({ _id: job._id }));
    assert.ok(await CVProcessingJob.exists({ _id: processingJob._id }));
    assert.equal(await CVStorageCleanupTask.countDocuments({}), 0);
    assert.equal(await publicFeedbackCapability.verify(interview._id, feedback.token), null);
  } finally {
    CVStorageCleanupTask.findOneAndUpdate = originalRegister;
  }

  const originalDeleteEmbedding = embeddingService.deleteEmbedding;
  embeddingService.deleteEmbedding = async () => {
    throw new Error('synthetic organization embedding provider outage');
  };
  cvQueue._setDependenciesForTests({
    durableFileStore: {
      async remove() { throw new Error('synthetic organization GridFS provider outage'); }
    },
    cloudinary: {
      async deleteFile() { return { success: false, error: 'synthetic organization cloud provider outage' }; }
    }
  });
  try {
    const recovered = await organizationErasureService.recoverOrganizationErasures();
    assert.equal(recovered.recovered, 1);
  } finally {
    embeddingService.deleteEmbedding = originalDeleteEmbedding;
  }
  assert.equal(await Organization.exists({ _id: organization._id }), null);
  assert.equal(await Candidate.exists({ organization: organization._id }), null);
  assert.equal(await Job.exists({ organization: organization._id }), null);
  assert.equal(await Interview.exists({ _id: interview._id }), null);
  assert.equal(await CVProcessingJob.exists({ organization: organization._id }), null);
  assert.equal(await CVProcessingAudit.exists({ organizationKey: String(organization._id) }), null);
  assert.equal(await CVProcessingBatch.exists({ organization: organization._id }), null);
  const retainedTasks = await CVStorageCleanupTask.find({ state: 'failed' }).lean();
  assert.ok(retainedTasks.some((task) => task.provider === 'embedding'));
  assert.ok(retainedTasks.some((task) => (
    task.provider === 'cloudinary'
    && task.resource.publicId === 'candidate-only/retained-after-job-ttl'
  )));
  assert.ok(retainedTasks.some((task) => task.provider === 'gridfs'));

  const finalDeleteOrganization = await Organization.create(organizationPayload('Final Delete Failure Org'));
  const originalDeleteOne = Organization.deleteOne;
  Organization.deleteOne = async () => {
    throw new Error('synthetic final organization delete outage');
  };
  try {
    const pending = await organizationErasureService.eraseOrganization(finalDeleteOrganization._id);
    assert.equal(pending.pending, true);
    const tombstone = await Organization.findById(finalDeleteOrganization._id)
      .select('+erasureState +erasureToken')
      .lean();
    assert.equal(tombstone.erasureState, 'tombstoned');
    assert.ok(tombstone.erasureToken);
  } finally {
    Organization.deleteOne = originalDeleteOne;
  }
  assert.equal((await organizationErasureService.recoverOrganizationErasures()).recovered, 1);
  assert.equal(await Organization.exists({ _id: finalDeleteOrganization._id }), null);

  const organizationControllerSource = fs.readFileSync(
    path.join(__dirname, '../controllers/organizationController.js'),
    'utf8'
  );
  assert.equal((organizationControllerSource.match(/\.eraseOrganization\(organizationId\)/g) || []).length, 2);
  assert.doesNotMatch(organizationControllerSource, /Candidate\.deleteMany\(\{ organization: organizationId \}\)/);
});

test('organization erasure continues past a candidate registration failure before deferring final deletion', async () => {
  const organization = await Organization.create(organizationPayload('Per Candidate Erasure Recovery Org'));
  const candidateIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Candidate.create(candidateIds.map((candidateId, index) => ({
    _id: candidateId,
    firstName: 'Organization',
    lastName: `Candidate ${index}`,
    email: `org-candidate-${index}@example.com`,
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual'
  })));

  const originalRegister = CVStorageCleanupTask.findOneAndUpdate;
  CVStorageCleanupTask.findOneAndUpdate = async function patchedRegister(filter, update, ...rest) {
    if (String(update?.$setOnInsert?.resource?.candidateId || '') === String(candidateIds[0])) {
      throw new Error('persistent first candidate registration outage');
    }
    return originalRegister.call(this, filter, update, ...rest);
  };
  try {
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    assert.equal(pending.errorCode, 'ORGANIZATION_CANDIDATE_ERASURE_PENDING');
    assert.ok(await Candidate.exists({ _id: candidateIds[0] }));
    assert.equal(
      await Candidate.exists({ _id: candidateIds[1] }),
      null,
      'a failed first child must not starve later candidate erasure'
    );
    assert.ok(await Organization.exists({ _id: organization._id }));
  } finally {
    CVStorageCleanupTask.findOneAndUpdate = originalRegister;
  }
  const recovered = await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
  assert.equal(recovered.recovered, 1);
  assert.equal(await Organization.exists({ _id: organization._id }), null);
  assert.equal(await Candidate.exists({ organization: organization._id }), null);
});

test('organization deletion fences paused private, bulk, and public application writers until a zero-row drain', async () => {
  const runPausedPrivate = async () => {
    const organization = await Organization.create(organizationPayload('Paused Private Writer Org'));
    const filePath = await privateRequestFile('private writer paused at receipt');
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    let persisted = 0;
    cvQueue._setDependenciesForTests({
      intakeLifecycleHooks: {
        async afterReceipt() {
          enter();
          await new Promise((resolve) => { release = resolve; });
        }
      },
      durableFileStore: {
        async persistPath() { persisted += 1; throw new Error('must not persist after tombstone'); }
      }
    });
    const submission = cvQueue.submitUpload(
      privateRequest(filePath, organization._id, 'paused-private-writer'),
      'private'
    );
    await entered;
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    assert.ok(await Organization.exists({ _id: organization._id }));
    release();
    await assert.rejects(
      submission,
      (error) => error.code === 'ORGANIZATION_ERASURE_IN_PROGRESS'
    );
    assert.equal(persisted, 0);
    await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
    assert.equal(await Organization.exists({ _id: organization._id }), null);
    assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 0);
  };

  const runPausedBulk = async () => {
    cvQueue._resetDependenciesForTests();
    cvQueue._setDependenciesForTests({ enqueueJob: async () => ({ id: 'queued' }) });
    const organization = await Organization.create(organizationPayload('Paused Bulk Writer Org'));
    const actorId = new mongoose.Types.ObjectId();
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    cvQueue._setDependenciesForTests({
      batchLifecycleHooks: {
        async afterReceipt() {
          enter();
          await new Promise((resolve) => { release = resolve; });
        }
      }
    });
    const submission = cvQueue.submitBatch(batchRequest(
      await batchFiles([{ name: 'paused.pdf', bytes: 'paused bulk writer bytes' }]),
      organization._id,
      actorId,
      'paused-bulk-writer'
    ));
    await entered;
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    release();
    await assert.rejects(
      submission,
      (error) => error.code === 'ORGANIZATION_ERASURE_IN_PROGRESS'
    );
    await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
    assert.equal(await Organization.exists({ _id: organization._id }), null);
    assert.equal(await CVProcessingBatch.countDocuments({ organization: organization._id }), 0);
    assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 0);
  };

  const runPausedPublic = async () => {
    cvQueue._resetDependenciesForTests();
    const organization = await Organization.create(organizationPayload('Paused Public Writer Org'));
    const job = await Job.create(jobPayload(organization._id));
    const originalReconcile = publicApplicationCapacityService.reconcileInflatedCount;
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    publicApplicationCapacityService.reconcileInflatedCount = async () => {
      enter();
      await new Promise((resolve) => { release = resolve; });
      return { applicationCount: 0 };
    };
    try {
      const response = controllerResponse();
      const request = {
        body: applicationBody(job._id, 'paused-public@example.com'),
        get(name) {
          return String(name).toLowerCase() === 'idempotency-key'
            ? 'paused-public-writer'
            : undefined;
        }
      };
      const application = candidateController.createPublicCandidate(request, response);
      await entered;
      const pending = await organizationErasureService.eraseOrganization(organization._id);
      assert.equal(pending.pending, true);
      release();
      await application;
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'ORGANIZATION_ERASURE_IN_PROGRESS');
      assert.equal(await Candidate.countDocuments({ organization: organization._id }), 0);
    } finally {
      publicApplicationCapacityService.reconcileInflatedCount = originalReconcile;
    }
    await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
    assert.equal(await Organization.exists({ _id: organization._id }), null);
  };

  await runPausedPrivate();
  await runPausedBulk();
  await runPausedPublic();
});

test('organization erasure cursor-pages every candidate, job, audit, batch, and interview', async () => {
  const organization = await Organization.create(organizationPayload('Paged Organization Erasure Org'));
  const jobs = await Job.create(Array.from({ length: 5 }, (_, index) => (
    jobPayload(organization._id, { title: `Paged Job ${index}` })
  )));
  const candidates = await Candidate.create(Array.from({ length: 5 }, (_, index) => ({
    firstName: 'Paged', lastName: `Candidate ${index}`,
    email: `paged-candidate-${index}@example.com`, phone: '123',
    position: 'Engineer', experience: 'Five years', education: 'BSc',
    organization: organization._id, source: 'manual'
  })));
  const processingJobs = await CVProcessingJob.create(Array.from({ length: 5 }, (_, index) => ({
    publicId: `cv_org_page_${index}_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: crypto.createHash('sha256').update(`org-page-${index}`).digest('hex'),
    state: 'queued', stage: 'stored', progress: 10, organization: organization._id,
    jobAppliedFor: jobs[index]._id, source: 'private', originalName: `private-${index}.pdf`,
    fileType: 'application/pdf', fileSize: 64, formData: { email: `private-${index}@example.com` }
  })));
  await Promise.all(processingJobs.map((processingJob, index) => CVProcessingAudit.create({
    publicId: processingJob.publicId, source: 'private', state: 'queued', stage: 'stored',
    progress: 10, organization: organization._id, organizationKey: String(organization._id),
    originalName: processingJob.originalName, jobCreatedAt: new Date(), lastUpdatedAt: new Date()
  })));
  await Promise.all(processingJobs.map((processingJob, index) => CVProcessingBatch.create({
    publicId: `batch_org_page_${index}_${new mongoose.Types.ObjectId()}`,
    organization: organization._id, actor: new mongoose.Types.ObjectId(),
    jobs: [processingJob._id], rejected: [], totalFiles: 1, intakeState: 'accepted'
  })));
  await Promise.all(jobs.map((job, index) => Interview.create({
    jobId: job._id, candidateId: candidates[index]._id,
    interviewerId: new mongoose.Types.ObjectId(), organizationId: organization._id,
    title: `Paged Interview ${index}`, scheduledAt: new Date(Date.now() + 60_000), duration: 30
  })));

  const tombstone = await organizationErasureService.commitOrganizationTombstone(organization._id);
  const result = await organizationErasureService.runOrganizationCleanup(tombstone, {
    candidatePageSize: 2
  });
  assert.equal(result.hardDeleted, true);
  assert.equal(await Candidate.countDocuments({ organization: organization._id }), 0);
  assert.equal(await Job.countDocuments({ organization: organization._id }), 0);
  assert.equal(await Interview.countDocuments({ organizationId: organization._id }), 0);
  assert.equal(await CVProcessingJob.countDocuments({ organization: organization._id }), 0);
  assert.equal(await CVProcessingAudit.countDocuments({ organizationKey: String(organization._id) }), 0);
  assert.equal(await CVProcessingBatch.countDocuments({ organization: organization._id }), 0);
});

test('a transient organization writer-fence outage retries CV processing instead of cancelling it', async () => {
  const organization = await Organization.create(organizationPayload('Worker Fence Retry Org'));
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_worker_fence_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: '6'.repeat(64), state: 'queued', stage: 'analyzing', progress: 50,
    organization: organization._id, actor: new mongoose.Types.ObjectId(), source: 'private',
    originalName: 'worker-fence.pdf', fileType: 'application/pdf', fileSize: 64,
    resumeText: 'Worker fence retry CV text with enough characters for a valid analysis payload.',
    cloudinary: {
      publicId: 'worker-fence/current', resumeUrl: 'https://example.invalid/worker-fence',
      resourceType: 'raw', deliveryType: 'authenticated', cleanupState: 'retained'
    }
  });
  cvQueue._setDependenciesForTests({
    cvParser: {
      async analyzeText() {
        return {
          success: true,
          candidate: {
            firstName: 'Fence', lastName: 'Retry', email: 'fence-retry@example.com',
            phone: '123', position: 'Engineer', experience: 'Five years', education: 'BSc',
            skills: ['Node.js'], status: 'New'
          }
        };
      }
    }
  });
  const originalAcquire = organizationCvWriteFence.acquire;
  organizationCvWriteFence.acquire = async (_organizationId, kind) => {
    if (kind === 'cv-worker:candidate-commit') throw new Error('synthetic fence database outage');
    return originalAcquire(_organizationId, kind);
  };
  try {
    await assert.rejects(
      () => cvQueue._processJobForTests(delivery(processingJob)),
      /synthetic fence database outage/
    );
  } finally {
    organizationCvWriteFence.acquire = originalAcquire;
  }
  const retryable = await CVProcessingJob.findById(processingJob._id).lean();
  assert.equal(retryable.state, 'queued');
  assert.equal(retryable.stage, 'retry_scheduled');
  assert.equal(retryable.cancellationReason, undefined);
});

test('organization erasure waits for in-flight completion provider effects before cleanup', async () => {
  const organization = await Organization.create(organizationPayload('Completion Effect Fence Org'));
  const candidate = await Candidate.create({
    firstName: 'Completion', lastName: 'Fence', email: 'completion-fence@example.com', phone: '123',
    position: 'Engineer', experience: 'Five years', education: 'BSc',
    organization: organization._id, source: 'manual'
  });
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_completion_fence_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: '4'.repeat(64), state: 'completed', stage: 'completed', progress: 100,
    organization: organization._id, actor: new mongoose.Types.ObjectId(), source: 'private',
    originalName: 'completion-fence.pdf', fileType: 'application/pdf', fileSize: 64,
    candidate: candidate._id, completedAt: new Date()
  });
  await Candidate.updateOne(
    { _id: candidate._id },
    { $set: { 'processingMetadata.cvProcessingJobId': processingJob.publicId } }
  );
  let enter;
  let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  let vectorPresent = false;
  const previousDeleteEmbedding = embeddingService.deleteEmbedding;
  embeddingService.deleteEmbedding = async () => { vectorPresent = false; return true; };
  cvQueue._setDependenciesForTests({
    completionEffectHandlers: {
      candidateNotification: async () => {},
      gptCacheInvalidation: async () => {},
      websocketBroadcast: async () => {},
      embedding: async () => {
        enter();
        await new Promise((resolve) => { release = resolve; });
        vectorPresent = true;
      },
      limitReachedNotification: async () => {}
    }
  });
  try {
    const effects = cvQueue._deliverCompletionEffectsForTests(processingJob._id);
    await entered;
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    assert.equal(pending.errorCode, 'ORGANIZATION_WRITER_DRAIN_PENDING');
    assert.ok(await Candidate.exists({ _id: candidate._id }));
    release();
    await effects;
    assert.equal(vectorPresent, true);
    await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
    assert.equal(vectorPresent, false);
    assert.equal(await Organization.exists({ _id: organization._id }), null);
    assert.equal(await Candidate.exists({ _id: candidate._id }), null);
  } finally {
    embeddingService.deleteEmbedding = previousDeleteEmbedding;
  }
});

test('organization history, detail, and retry remain tenant scoped while admin organization filtering is explicit', async () => {
  const [organizationA, organizationB] = await Organization.create([
    organizationPayload('Tenant A'),
    organizationPayload('Tenant B')
  ]);
  const [pathA, pathB] = await Promise.all([
    privateRequestFile('tenant A cv bytes'),
    privateRequestFile('tenant B cv bytes')
  ]);
  const [jobA, jobB] = await Promise.all([
    cvQueue.submitUpload(privateRequest(pathA, organizationA._id, 'tenant-a-key'), 'private'),
    cvQueue.submitUpload(privateRequest(pathB, organizationB._id, 'tenant-b-key'), 'private')
  ]);
  const listA = await cvQueue.listOrganizationHistory(organizationA._id, { limit: 25 });
  assert.deepEqual(listA.jobs.map((job) => job.jobId), [jobA.job.publicId]);
  assert.equal(await cvQueue.getOrganizationJobDetail(organizationA._id, jobB.job.publicId), null);
  await assert.rejects(
    () => cvQueue.retryFailedJob(jobB.job.publicId, { organizationId: organizationA._id }),
    (error) => error.code === 'CV_JOB_NOT_FOUND'
  );
  const adminB = await cvQueue.listAdminHistory({ organizationId: organizationB._id, limit: 25 });
  assert.deepEqual(adminB.jobs.map((job) => job.jobId), [jobB.job.publicId]);
  const organizations = await cvQueue.listAdminOrganizations({ search: 'Tenant', limit: 10 });
  assert.deepEqual(
    organizations.organizations.map((organization) => organization.name).sort(),
    ['Tenant A', 'Tenant B']
  );
});

test('AI Interview cancellation events are accepted, persisted, and idempotently acknowledged', async () => {
  await Organization.create({
    ...organizationPayload('AI Interview Event Org'),
    idpOrganizationId: 'ai-interview-tenant'
  });
  const cancelledAt = new Date();
  const event = {
    job: {
      publicId: `aicv_cancelled_${new mongoose.Types.ObjectId()}`,
      organizationId: 'ai-interview-tenant',
      actorId: 'candidate-runtime',
      jobId: 'ai-interview-job',
      state: 'cancelled',
      stage: 'cancelled',
      progress: 55,
      attempts: 1,
      sequence: 4,
      createdAt: new Date(cancelledAt.getTime() - 5000),
      startedAt: new Date(cancelledAt.getTime() - 3000),
      cancelledAt,
      updatedAt: cancelledAt
    }
  };
  const first = await cvQueue.ingestExternalQueueEvent('ai-interview', event);
  const replay = await cvQueue.ingestExternalQueueEvent('ai-interview', event);
  assert.equal(first.accepted, true);
  assert.equal(replay.accepted, true);
  assert.equal(first.jobId, event.job.publicId);
  const audit = await CVProcessingAudit.findOne({ publicId: event.job.publicId }).lean();
  assert.equal(audit.state, 'cancelled');
  assert.equal(audit.stage, 'cancelled');
  assert.equal(audit.cancelledAt.toISOString(), cancelledAt.toISOString());
  assert.equal(audit.transitions.length, 1);
  assert.equal(audit.transitions[0].state, 'cancelled');
});

test('audit writers hold the organization fence and delayed events cannot resurrect deleted tenant history', async () => {
  const organization = await Organization.create({
    ...organizationPayload('Audit Writer Fence Org'),
    idpOrganizationId: 'idp-audit-writer-fence'
  });
  const processingJob = await CVProcessingJob.create({
    publicId: `cv_audit_fence_${new mongoose.Types.ObjectId()}`,
    statusTokenHash: '5'.repeat(64), state: 'queued', stage: 'stored', progress: 10,
    organization: organization._id, actor: new mongoose.Types.ObjectId(), source: 'private',
    originalName: 'audit-fence-private.pdf', fileType: 'application/pdf', fileSize: 64,
    formData: { email: 'audit-fence@example.com' }
  });
  const originalBulkWrite = CVProcessingAudit.bulkWrite;
  let enter;
  let release;
  let calls = 0;
  const entered = new Promise((resolve) => { enter = resolve; });
  CVProcessingAudit.bulkWrite = async function pausedBulkWrite(...args) {
    calls += 1;
    if (calls === 1) {
      enter();
      await new Promise((resolve) => { release = resolve; });
    }
    return originalBulkWrite.apply(this, args);
  };
  try {
    const backfill = cvQueue._backfillHistoryForTests({ force: true });
    await entered;
    const pending = await organizationErasureService.eraseOrganization(organization._id);
    assert.equal(pending.pending, true);
    assert.equal(pending.errorCode, 'ORGANIZATION_WRITER_DRAIN_PENDING');
    release();
    await backfill;
  } finally {
    CVProcessingAudit.bulkWrite = originalBulkWrite;
  }
  await organizationErasureService.recoverOrganizationErasures({ limit: 1 });
  assert.equal(await Organization.exists({ _id: organization._id }), null);
  assert.equal(await CVProcessingAudit.exists({ publicId: processingJob.publicId }), null);

  const delayedEvent = (organizationId, suffix) => ({
    job: {
      publicId: `aicv_deleted_${suffix}_${new mongoose.Types.ObjectId()}`,
      organizationId,
      actorId: 'deleted-actor',
      jobId: 'deleted-job',
      state: 'cancelled',
      stage: 'cancelled',
      sequence: 1,
      updatedAt: new Date()
    }
  });
  const mongoIdReplay = await cvQueue.ingestExternalQueueEvent(
    'ai-interview',
    delayedEvent(String(organization._id), 'mongo')
  );
  const idpIdReplay = await cvQueue.ingestExternalQueueEvent(
    'ai-interview',
    delayedEvent('idp-audit-writer-fence', 'idp')
  );
  assert.equal(mongoIdReplay.dropped, true);
  assert.equal(idpIdReplay.dropped, true);
  assert.equal(await CVProcessingAudit.countDocuments({ actorKey: 'deleted-actor' }), 0);
});

test('admin date-only history includes the full final day and preserves prior attempt errors', async () => {
  const organization = await Organization.create(organizationPayload('History Boundary Org'));
  const includedId = `cv_history_included_${new mongoose.Types.ObjectId()}`;
  const excludedId = `cv_history_excluded_${new mongoose.Types.ObjectId()}`;
  await CVProcessingAudit.create([
    {
      publicId: includedId,
      source: 'private',
      state: 'completed',
      stage: 'completed',
      progress: 100,
      attempts: 2,
      processingAttempts: 2,
      organization: organization._id,
      organizationKey: String(organization._id),
      originalName: 'included.pdf',
      fileType: 'application/pdf',
      fileSize: 32,
      jobCreatedAt: new Date('2026-08-09T12:00:00.000Z'),
      lastUpdatedAt: new Date('2026-08-09T12:05:00.000Z'),
      completedAt: new Date('2026-08-09T12:05:00.000Z'),
      attemptHistory: [{
        attemptId: 'attempt-one',
        number: 1,
        trigger: 'initial',
        requestedStage: 'failed',
        status: 'failed',
        stage: 'analyzing',
        startedAt: new Date('2026-08-09T12:01:00.000Z'),
        finishedAt: new Date('2026-08-09T12:02:00.000Z'),
        errorCode: 'AI_TEMPORARY_FAILURE',
        errorMessage: 'The first analysis attempt timed out'
      }]
    },
    {
      publicId: excludedId,
      source: 'private',
      state: 'completed',
      stage: 'completed',
      progress: 100,
      organization: organization._id,
      organizationKey: String(organization._id),
      originalName: 'excluded.pdf',
      fileType: 'application/pdf',
      fileSize: 32,
      jobCreatedAt: new Date('2026-08-10T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-08-10T00:01:00.000Z'),
      completedAt: new Date('2026-08-10T00:01:00.000Z')
    }
  ]);
  const result = await cvQueue.listAdminHistory({
    organizationId: organization._id,
    from: '2026-08-09',
    to: '2026-08-09',
    limit: 25
  });
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].jobId, includedId);
  assert.equal(
    result.jobs[0].attemptHistory[0].errorMessage,
    'The first analysis attempt timed out'
  );
});

test('stale-job recovery scans past 500 existing Bull deliveries', async () => {
  const organization = await Organization.create(organizationPayload('Stale Recovery Org'));
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const ids = Array.from({ length: 501 }, () => new mongoose.Types.ObjectId());
  const publicIds = ids.map((id, index) => `cv_stale_${String(index).padStart(3, '0')}_${id}`);
  await CVProcessingJob.insertMany(ids.map((id, index) => ({
    _id: id,
    publicId: publicIds[index],
    statusTokenHash: crypto.createHash('sha256').update(`stale-${index}`).digest('hex'),
    state: 'queued',
    stage: 'stored',
    progress: 30,
    organization: organization._id,
    source: 'private',
    originalName: `stale-${index}.pdf`,
    fileType: 'application/pdf',
    fileSize: 64,
    billing: { required: false, state: 'not_required' },
    createdAt: old,
    updatedAt: old
  })));
  await CVProcessingJob.collection.updateMany(
    { _id: { $in: ids } },
    { $set: { createdAt: old, updatedAt: old } }
  );

  const delivered = new Set(publicIds.slice(0, 500));
  const enqueued = [];
  cvQueue._setDependenciesForTests({
    queue: {
      async getJob(publicId) {
        if (!delivered.has(publicId)) return null;
        return { async getState() { return 'waiting'; } };
      },
      async add(_name, _data, options) {
        enqueued.push(options.jobId);
        return { id: options.jobId };
      }
    }
  });
  const recovered = await cvQueue.recoverStaleJobs();
  assert.equal(recovered, 1);
  assert.deepEqual(enqueued, [publicIds[500]]);
});

test('recruiter CV history routes require candidate-management permission', async () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../routes/cvIngestion.js'), 'utf8');
  for (const declaration of [
    "router.get('/jobs'",
    "router.get('/jobs/:jobId'"
  ]) {
    const start = routeSource.indexOf(declaration);
    assert.ok(start >= 0);
    assert.match(routeSource.slice(start, start + 220), /requirePermission\('manage_candidates'\)/);
  }
  const candidateRouteSource = fs.readFileSync(path.join(__dirname, '../routes/candidate.js'), 'utf8');
  const privateUpload = candidateRouteSource.indexOf("router.post('/upload-cv'");
  assert.ok(privateUpload >= 0);
  const privateUploadDeclaration = candidateRouteSource.slice(privateUpload, privateUpload + 360);
  assert.match(privateUploadDeclaration, /requirePermission\('manage_candidates'\)/);
  assert.ok(
    privateUploadDeclaration.indexOf("requirePermission('manage_candidates')")
      < privateUploadDeclaration.indexOf("upload.single('resume')")
  );

  const bulkRouteSource = fs.readFileSync(path.join(__dirname, '../routes/bulkUpload.js'), 'utf8');
  for (const declaration of [
    "  '/cv',",
    "router.get('/status/recent'",
    "router.get('/status/:batchId'",
    "router.post('/status/:batchId/retry'"
  ]) {
    const start = bulkRouteSource.indexOf(declaration);
    assert.ok(start >= 0, `missing ${declaration}`);
    assert.match(bulkRouteSource.slice(start, start + 300), /requirePermission\('manage_candidates'\)/);
  }
  const bulkRetryStart = bulkRouteSource.indexOf("router.post('/status/:batchId/retry'");
  const bulkRetryDeclaration = bulkRouteSource.slice(bulkRetryStart, bulkRetryStart + 1_500);
  assert.match(bulkRetryDeclaration, /retryBatchNow/);
  assert.doesNotMatch(bulkRetryDeclaration, /codexAccountService|AI_RUNTIME_ACCOUNT_REQUIRED/);
  const bulkPostLayer = bulkUploadRouter.stack.find((layer) => layer.route?.path === '/cv');
  const bulkHandlers = bulkPostLayer.route.stack.map((layer) => layer.handle.name);
  assert.ok(
    bulkHandlers.indexOf('receiveBulkCvFiles') > 2,
    `permission must execute before Multer: ${bulkHandlers.join(',')}`
  );

  const originalFindById = User.findById;
  User.findById = async () => ({
    hasOrganizationPermission: () => false
  });
  try {
    const response = controllerResponse();
    let nextCalled = false;
    await requirePermission('manage_candidates')({
      user: {
        id: new mongoose.Types.ObjectId(),
        currentOrganization: new mongoose.Types.ObjectId()
      }
    }, response, () => { nextCalled = true; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalled, false);
  } finally {
    User.findById = originalFindById;
  }

  User.findById = async () => ({ hasOrganizationPermission: () => true });
  try {
    const response = controllerResponse();
    let nextCalled = false;
    await requirePermission('manage_candidates')({
      user: {
        id: new mongoose.Types.ObjectId(),
        currentOrganization: new mongoose.Types.ObjectId()
      }
    }, response, () => { nextCalled = true; });
    assert.equal(response.statusCode, 200);
    assert.equal(nextCalled, true);
  } finally {
    User.findById = originalFindById;
  }
});

test('legacy generic CV parsing is retired before authentication or multipart storage', async () => {
  const response = await fetch(`${baseUrl}/api/cv/parse`, { method: 'POST' });
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    code: 'CV_PARSE_ENDPOINT_RETIRED',
    msg: 'This CV parsing endpoint has been retired. Use the product-specific durable CV upload flow.'
  });
  const source = fs.readFileSync(path.join(__dirname, '../routes/cv.js'), 'utf8');
  assert.doesNotMatch(source, /upload\.single|submitUpload\(req, 'ai-interview'\)/);
});

test('public feedback capability is stable, expiring, and bound to the interview candidate', async () => {
  const organization = await Organization.create(organizationPayload('Feedback Capability Org'));
  const job = await Job.create(jobPayload(organization._id));
  const candidate = await Candidate.create({
    firstName: 'Feedback',
    lastName: 'Candidate',
    email: 'feedback-candidate@example.com',
    phone: '+44 7700 900003',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual',
    resumeUrl: 'https://provider.invalid/permanent-candidate-resume.pdf',
    cloudinaryPublicId: 'cv/feedback-capability-candidate',
    cloudinaryResourceType: 'raw',
    cloudinaryDeliveryType: 'authenticated'
  });
  const interview = await Interview.create({
    jobId: job._id,
    candidateId: candidate._id,
    interviewerId: new mongoose.Types.ObjectId(),
    organizationId: organization._id,
    title: 'Capability interview',
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    duration: 60
  });

  const issued = await Promise.all(Array.from({ length: 20 }, () => (
    publicFeedbackCapability.issue(interview._id)
  )));
  assert.ok(issued.every((item) => item.token === issued[0].token));
  assert.ok(await publicFeedbackCapability.verify(interview._id, issued[0].token, {
    candidateId: candidate._id
  }));
  assert.equal(await publicFeedbackCapability.verify(interview._id, issued[0].token, {
    candidateId: new mongoose.Types.ObjectId()
  }), null);
  assert.equal(await publicFeedbackCapability.verify(new mongoose.Types.ObjectId(), issued[0].token), null);

  const questionsResponse = controllerResponse();
  await interviewController.getInterviewQuestions(
    { params: { interviewId: String(interview._id) } },
    questionsResponse
  );
  assert.equal(questionsResponse.body.candidateInfo.resumeAvailable, true);
  assert.equal(questionsResponse.body.candidateInfo.resumeUrl, undefined);

  const proxyResponse = controllerResponse();
  await candidateController.getAccessibleResumeUrl({
    params: { interviewId: String(interview._id), id: String(candidate._id) },
    query: {},
    protocol: 'http',
    publicFeedbackInterview: issued[0].interview,
    get(name) {
      if (String(name).toLowerCase() === 'x-public-feedback-token') return issued[0].token;
      if (String(name).toLowerCase() === 'host') return new URL(baseUrl).host;
      return undefined;
    }
  }, proxyResponse);
  assert.equal(proxyResponse.body.resumeAvailable, true);
  assert.equal(proxyResponse.body.originalUrl, undefined);
  assert.equal(proxyResponse.body.accessibleUrl, undefined);
  assert.match(proxyResponse.body.viewUrl, /\/api\/candidates\/public\/interviews\//);
  assert.doesNotMatch(proxyResponse.body.viewUrl, /provider\.invalid|cloudinary/i);
  const revocableViewUrl = proxyResponse.body.viewUrl;

  for (const { viaQuery, authorization } of [
    { viaQuery: false, authorization: 'Bearer expired-auto-injected-token' },
    { viaQuery: true, authorization: 'Bearer authenticated-in-the-wrong-organization' }
  ]) {
    const response = controllerResponse();
    let nextCalled = false;
    await requirePublicFeedbackAccess({
      params: { interviewId: String(interview._id), id: String(candidate._id) },
      query: viaQuery ? { accessToken: issued[0].token } : {},
      user: { currentOrganization: new mongoose.Types.ObjectId() },
      get(name) {
        if (String(name).toLowerCase() === 'x-public-feedback-token' && !viaQuery) {
          return issued[0].token;
        }
        if (String(name).toLowerCase() === 'authorization') return authorization;
        return undefined;
      }
    }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'a valid capability must outrank unrelated Authorization');
    assert.equal(response.statusCode, 200);
  }

  await Interview.updateOne(
    { _id: interview._id },
    { $set: { publicFeedbackTokenExpiresAt: new Date(Date.now() - 1000) } }
  );
  assert.equal(await publicFeedbackCapability.verify(interview._id, issued[0].token), null);
  assert.equal((await fetch(revocableViewUrl)).status, 404);

  const rotated = await publicFeedbackCapability.issue(interview._id);
  assert.ok(rotated?.token);
  await Interview.updateOne(
    { _id: interview._id },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }
  );
  const cancelled = await Interview.findById(interview._id)
    .select('+publicFeedbackTokenHash publicFeedbackTokenExpiresAt publicFeedbackRevokedAt status')
    .lean();
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.publicFeedbackRevokedAt);
  assert.equal(cancelled.publicFeedbackTokenHash, undefined);
  assert.equal(cancelled.publicFeedbackTokenExpiresAt, undefined);
  assert.equal(await publicFeedbackCapability.verify(interview._id, rotated.token), null);
  assert.equal(await publicFeedbackCapability.issue(interview._id), null);

  for (const params of [
    { interviewId: String(interview._id) },
    { interviewId: String(interview._id), id: String(candidate._id) }
  ]) {
    const response = controllerResponse();
    let nextCalled = false;
    await requirePublicFeedbackAccess({
      params,
      query: {},
      get(name) {
        return String(name).toLowerCase() === 'x-public-feedback-token' ? rotated.token : undefined;
      }
    }, response, () => { nextCalled = true; });
    assert.equal(response.statusCode, 404);
    assert.equal(nextCalled, false);
  }

  const tombstoneInterview = await Interview.create({
    jobId: job._id,
    candidateId: candidate._id,
    interviewerId: new mongoose.Types.ObjectId(),
    organizationId: organization._id,
    title: 'Candidate erasure capability',
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    duration: 60
  });
  const tombstoneToken = await publicFeedbackCapability.issue(tombstoneInterview._id);
  await Candidate.updateOne(
    { _id: candidate._id },
    {
      $set: { deletionState: 'tombstoned', deletionToken: crypto.randomUUID() },
      $unset: {
        publicApplicationCapabilityHash: 1,
        publicApplicationCapabilityExpiresAt: 1
      }
    }
  );
  assert.equal(
    await publicFeedbackCapability.verify(tombstoneInterview._id, tombstoneToken.token),
    null,
    'candidate erasure must close questions/resume PII immediately'
  );

  const interviewRoutes = fs.readFileSync(path.join(__dirname, '../routes/interview.js'), 'utf8');
  const candidateRoutes = fs.readFileSync(path.join(__dirname, '../routes/candidate.js'), 'utf8');
  for (const endpoint of [
    'feedback/questions',
    'feedback/public',
    'feedback/bulk',
    'feedback/generate-otp',
    'feedback/verify-otp'
  ]) {
    const routeLine = interviewRoutes.split(/\r?\n/).find((line) => line.includes(endpoint));
    assert.ok(routeLine?.includes('requirePublicFeedbackAccess'), `${endpoint} must require feedback capability`);
  }
  assert.match(candidateRoutes, /public\/interviews\/:interviewId\/candidates\/:id\/accessible-resume-url[\s\S]*requirePublicFeedbackAccess/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '../controllers/candidateController.js'), 'utf8'),
    /accessibleUrl,\s*viewUrl: accessibleUrl,\s*downloadUrl/,
    'public resume response must expose the viewUrl consumed by the feedback page'
  );
});

test('legacy actionable feedback invitations are reissued with capabilities while bare links stay closed', async () => {
  const organization = await Organization.create(organizationPayload('Feedback Reissue Org'));
  const job = await Job.create(jobPayload(organization._id));
  const candidate = await Candidate.create({
    firstName: 'Legacy',
    lastName: 'Invitation',
    email: 'legacy-feedback@example.com',
    phone: '123',
    position: 'Engineer',
    experience: 'Five years',
    education: 'BSc',
    organization: organization._id,
    source: 'manual'
  });
  const interview = await Interview.create({
    jobId: job._id,
    candidateId: candidate._id,
    interviewerId: new mongoose.Types.ObjectId(),
    organizationId: organization._id,
    title: 'Pre-cutover invitation',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    duration: 60,
    notifications: {
      sendQuestionsToInterviewers: true,
      questionsSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      selectedQuestions: []
    }
  });

  const bareResponse = controllerResponse();
  let bareNext = false;
  await requirePublicFeedbackAccess({
    params: { interviewId: String(interview._id) },
    query: {},
    get() { return undefined; }
  }, bareResponse, () => { bareNext = true; });
  assert.equal(bareResponse.statusCode, 404);
  assert.equal(bareNext, false);

  const dryRun = await publicFeedbackReissueService.reissueActionableFeedbackInvitations({
    organizationId: organization._id
  });
  assert.equal(dryRun.dryRun, true);
  assert.deepEqual(dryRun.interviewIds, [String(interview._id)]);
  assert.equal(
    (await Interview.findById(interview._id).select('+publicFeedbackTokenHash').lean())
      .publicFeedbackTokenHash,
    undefined
  );

  let partiallyIssued;
  const partial = await publicFeedbackReissueService.reissueActionableFeedbackInvitations({
    organizationId: organization._id,
    send: true,
    sender: async (eligibleInterview) => {
      partiallyIssued = await publicFeedbackCapability.issue(eligibleInterview._id);
      // Recipient one received the link; recipient two failed. The shared
      // token must now fail closed and the whole invitation remain retryable.
      throw new Error('synthetic second recipient delivery failure');
    }
  });
  assert.equal(partial.failed, 1);
  assert.equal(await publicFeedbackCapability.verify(interview._id, partiallyIssued.token), null);
  assert.equal((await publicFeedbackReissueService.reissueActionableFeedbackInvitations({
    organizationId: organization._id
  })).eligible, 1);

  let issued;
  const applied = await publicFeedbackReissueService.reissueActionableFeedbackInvitations({
    organizationId: organization._id,
    send: true,
    sender: async (eligibleInterview) => {
      issued = await publicFeedbackCapability.issue(eligibleInterview._id);
      return Boolean(issued);
    }
  });
  assert.equal(applied.sent, 1);
  assert.ok(issued?.token);
  assert.ok(await publicFeedbackCapability.verify(interview._id, issued.token));

  const capabilityResponse = controllerResponse();
  let capabilityNext = false;
  await requirePublicFeedbackAccess({
    params: { interviewId: String(interview._id) },
    query: {},
    get(name) {
      return String(name).toLowerCase() === 'x-public-feedback-token' ? issued.token : undefined;
    }
  }, capabilityResponse, () => { capabilityNext = true; });
  assert.equal(capabilityNext, true);

  const stillBareResponse = controllerResponse();
  await requirePublicFeedbackAccess({
    params: { interviewId: String(interview._id) },
    query: {},
    get() { return undefined; }
  }, stillBareResponse, () => {});
  assert.equal(stillBareResponse.statusCode, 404);
});

test('CORS contract permits capability-bound public application headers', () => {
  const { corsOptions } = require('../config/corsOptions');
  const { ipKeyGenerator } = require('express-rate-limit');
  const allowed = new Set(corsOptions.allowedHeaders.map((header) => header.toLowerCase()));
  for (const header of [
    'x-public-application-token',
    'x-public-job-id',
    'x-public-candidate-id',
    'x-public-feedback-token',
    'idempotency-key'
  ]) {
    assert.ok(allowed.has(header), `${header} must be allowed by CORS`);
  }
  assert.equal(
    ipKeyGenerator('2001:db8:abcd:12::1'),
    ipKeyGenerator('2001:db8:abcd:12::ffff'),
    'IPv6 clients in the same network prefix must share the pre-multipart limit'
  );
  assert.match(
    fs.readFileSync(path.join(__dirname, '../routes/candidate.js'), 'utf8'),
    /ipKeyGenerator\(req\.ip/
  );
});
