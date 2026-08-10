const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-routes-'));
process.env.AI_INTERVIEW_CV_QUEUE_ENABLED = 'false';
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
delete process.env.AI_INTERVIEW_MONGO_URI;
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;

const {
  app,
  assertProductionDurabilityConfig,
  recoverPendingCandidateDeletions
} = require('../src/server');
const queueService = require('../src/cvProcessingQueueService');
const {
  createCvCandidateResultRepository
} = require('../src/cvCandidateResultRepository');
const { signToken } = require('../src/auth');
const { mutateStore, readStore } = require('../src/store');

let server;
let baseUrl;
const actorOne = {
  _id: 'actor_route_one',
  email: 'route-one@example.com',
  name: 'Route One',
  role: 'recruiter',
  status: 'active'
};
const actorTwo = {
  _id: 'actor_route_two',
  email: 'route-two@example.com',
  name: 'Route Two',
  role: 'recruiter',
  status: 'active'
};

function request(pathname, actor, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${signToken(actor)}`,
      ...(options.headers || {})
    }
  });
}

test.before(async () => {
  await mutateStore((store) => {
    store.users.push(actorOne, actorTwo);
  });
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
  await queueService.closeForTests();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('CV processing list, detail, history, and retry routes are actor scoped', async () => {
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Route Actor\nroute.actor@example.com\nExperienced engineer with extensive distributed systems work.'),
      originalname: 'route-actor.txt',
      mimetype: 'text/plain',
      size: 94
    },
    organizationId: 'settings',
    actorId: actorOne._id,
    jobId: 'job_product_owner',
    mode: 'import',
    idempotencyKey: 'route-actor-scope'
  });

  const ownListResponse = await request('/api/cv-processing/jobs', actorOne);
  assert.equal(ownListResponse.status, 200);
  const ownList = await ownListResponse.json();
  assert.equal(ownList.jobs.length, 1);
  assert.equal(ownList.jobs[0].jobId, submitted.job.publicId);
  assert.equal(ownList.jobs[0].statusToken, submitted.statusToken);

  const foreignListResponse = await request('/api/cv-processing/jobs', actorTwo);
  assert.equal(foreignListResponse.status, 200);
  assert.deepEqual((await foreignListResponse.json()).jobs, []);

  for (const pathname of [
    `/api/cv-processing/jobs/${submitted.job.publicId}`,
    `/api/cv-processing/jobs/${submitted.job.publicId}/history`
  ]) {
    const response = await request(pathname, actorTwo);
    assert.equal(response.status, 404);
  }
  const retryResponse = await request(
    `/api/cv-processing/jobs/${submitted.job.publicId}/retry`,
    actorTwo,
    { method: 'POST' }
  );
  assert.equal(retryResponse.status, 404);
});

test('authenticated import and enrich routes require a nonblank Idempotency-Key', async () => {
  for (const pathname of [
    '/api/candidates/import-cv',
    '/api/candidates/cand_michael/cv'
  ]) {
    for (const headerValue of [undefined, '   ']) {
      const form = new FormData();
      form.append('jobId', 'job_product_owner');
      form.append(
        'cv',
        new Blob(['Required Key\nrequired-key@example.com\nExperienced engineer.'], {
          type: 'text/plain'
        }),
        'required-key.txt'
      );
      const response = await request(pathname, actorOne, {
        method: 'POST',
        headers: headerValue === undefined ? {} : { 'Idempotency-Key': headerValue },
        body: form
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'CV_IDEMPOTENCY_KEY_REQUIRED');
    }
  }
});

test('production startup refuses the non-durable local-file fallback', () => {
  assert.throws(
    () => assertProductionDurabilityConfig({ NODE_ENV: 'production' }),
    (error) => error?.code === 'AI_INTERVIEW_DURABLE_STORAGE_REQUIRED'
  );
  assert.equal(assertProductionDurabilityConfig({ NODE_ENV: 'development' }), true);
  assert.equal(assertProductionDurabilityConfig({
    NODE_ENV: 'production',
    AI_INTERVIEW_MONGO_URI: 'mongodb://persistent-mongo/ai-interview'
  }), true);
});

test('candidate delete route cancels and redacts active CV work before removing the profile', async () => {
  const candidateId = 'cand_route_delete';
  await mutateStore((store) => {
    store.candidates.push({
      _id: candidateId,
      name: 'Route Delete',
      email: 'route-delete@example.com',
      jobId: 'job_product_owner',
      createdBy: actorOne._id
    });
  });
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Route Delete\nroute-delete@example.com\nExperienced product manager with extensive delivery experience.'),
      originalname: 'route-delete-private.txt',
      mimetype: 'text/plain',
      size: 99
    },
    organizationId: 'settings',
    actorId: actorOne._id,
    jobId: 'job_product_owner',
    candidateId,
    mode: 'enrich',
    idempotencyKey: 'route-delete-active-job'
  });
  assert.equal((await request(`/api/candidates/${candidateId}`, actorTwo, {
    method: 'DELETE'
  })).status, 404);
  const response = await request(`/api/candidates/${candidateId}`, actorOne, {
    method: 'DELETE'
  });
  assert.equal(response.status, 200);

  const store = await readStore();
  assert.equal(store.candidates.some((candidate) => candidate._id === candidateId), false);
  const job = store.cvProcessingJobs.find((item) => item.publicId === submitted.job.publicId);
  assert.equal(job.state, 'cancelled');
  assert.equal(job.originalName, undefined);
  assert.equal(job.resumeText, undefined);
  assert.equal(job.result, undefined);
  assert.equal(job.durableFile.storageKey, undefined);
});

test('a crash after candidate tombstoning exposes no PII and restart recovery finishes deletion', async () => {
  const candidateId = 'cand_route_crash_tombstone';
  const targetJobId = 'job_route_crash_tombstone';
  const privateEmail = 'crash-tombstone@example.com';
  await mutateStore((store) => {
    store.jobs.push({
      _id: targetJobId,
      title: 'Crash Tombstone Job',
      createdBy: actorOne._id
    });
    store.candidates.push({
      _id: candidateId,
      name: 'Crash Tombstone Private Name',
      email: privateEmail,
      phone: '+44 1234 567890',
      resumeText: 'private resume contents',
      cvAnalysis: { privateSummary: 'private analysis' },
      jobId: targetJobId,
      createdBy: actorOne._id
    });
  });
  const submitted = await queueService.submit({
    file: {
      buffer: Buffer.from('Crash Tombstone\ncrash-tombstone@example.com\nExperienced engineering leader with extensive delivery experience.'),
      originalname: 'crash-tombstone-private.txt',
      mimetype: 'text/plain',
      size: 110
    },
    organizationId: 'settings',
    actorId: actorOne._id,
    jobId: targetJobId,
    candidateId,
    mode: 'enrich',
    idempotencyKey: 'route-crash-tombstone'
  });

  // Inject the process interruption after the durable begin step: cancellation
  // and the token-guarded hard delete have intentionally not run yet.
  const repositoryBeforeRestart = createCvCandidateResultRepository({ useMongo: false });
  const deletion = await repositoryBeforeRestart.beginCandidateDeletion(candidateId, {
    actorId: actorOne._id
  });
  assert.ok(deletion);
  const interruptedStore = await readStore();
  const tombstone = interruptedStore.candidates.find((candidate) => candidate._id === candidateId);
  assert.ok(tombstone.cvDeletionRequestedAt);
  for (const privateField of ['name', 'email', 'phone', 'resumeText', 'cvAnalysis']) {
    assert.equal(tombstone[privateField], undefined);
  }

  const listResponse = await request('/api/candidates', actorOne);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).candidates.some((candidate) => (
    candidate._id === candidateId
  )), false);
  const optionsResponse = await request('/api/ai-interviews/options', actorOne);
  assert.equal(optionsResponse.status, 200);
  assert.equal((await optionsResponse.json()).candidates.some((candidate) => (
    candidate._id === candidateId
  )), false);
  assert.equal((await request(`/api/candidates/${candidateId}`, actorOne, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Must Stay Hidden' })
  })).status, 400);

  const replacementResponse = await request('/api/candidates', actorOne, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Replacement Candidate',
      email: privateEmail,
      jobId: targetJobId
    })
  });
  assert.equal(replacementResponse.status, 201);
  const replacement = (await replacementResponse.json()).candidate;
  assert.notEqual(replacement._id, candidateId);

  const repositoryAfterRestart = createCvCandidateResultRepository({ useMongo: false });
  assert.deepEqual(await recoverPendingCandidateDeletions({
    repository: repositoryAfterRestart,
    queueService
  }), { recovered: 1, failed: 0 });

  const recoveredStore = await readStore();
  assert.equal(recoveredStore.candidates.some((candidate) => candidate._id === candidateId), false);
  assert.equal(recoveredStore.candidates.some((candidate) => candidate._id === replacement._id), true);
  const job = recoveredStore.cvProcessingJobs.find(
    (item) => item.publicId === submitted.job.publicId
  );
  assert.equal(job.state, 'cancelled');
  assert.equal(job.originalName, undefined);
  assert.equal(job.resumeText, undefined);
  assert.equal(job.result, undefined);
  assert.equal(job.durableFile.storageKey, undefined);
});
