import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCvRequestFingerprint,
  getOrCreateCvUploadAttempt,
  loadCvUploadAttempts,
  reconcileAcceptedCvUploads
} from '../utils/cvUploadPersistence.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('lost 202 acceptance reloads one stable actor-scoped CV upload descriptor', async () => {
  const storage = memoryStorage();
  const file = new File(
    ['Ada Lovelace\nada@example.com\nExperienced systems engineer.'],
    'ada.txt',
    { type: 'text/plain' }
  );
  const fingerprint = await buildCvRequestFingerprint(file, {
    mode: 'import',
    jobId: 'job-engineering'
  });
  const first = getOrCreateCvUploadAttempt('actor-one', {
    fingerprint,
    mode: 'import',
    jobId: 'job-engineering'
  }, storage);

  // Simulate a response being lost after the server accepted the request.
  const afterReload = getOrCreateCvUploadAttempt('actor-one', {
    fingerprint,
    mode: 'import',
    jobId: 'job-engineering'
  }, storage);
  assert.equal(afterReload.idempotencyKey, first.idempotencyKey);
  assert.equal(loadCvUploadAttempts('actor-one', storage).length, 1);

  reconcileAcceptedCvUploads('actor-one', [{
    jobId: 'aicv-accepted-once',
    state: 'queued',
    progress: 5,
    position: null,
    requestFingerprint: fingerprint,
    statusToken: 'status-token',
    statusUrl: '/api/cv-processing/jobs/aicv-accepted-once'
  }], storage);
  const [restored] = loadCvUploadAttempts('actor-one', storage);
  assert.deepEqual(restored.accepted, {
    jobId: 'aicv-accepted-once',
    statusToken: 'status-token',
    statusUrl: '/api/cv-processing/jobs/aicv-accepted-once'
  });

  const otherActor = getOrCreateCvUploadAttempt('actor-two', {
    fingerprint,
    mode: 'import',
    jobId: 'job-engineering'
  }, storage);
  assert.notEqual(otherActor.idempotencyKey, first.idempotencyKey);
  assert.equal(loadCvUploadAttempts('actor-two', storage).length, 1);
});
