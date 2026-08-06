const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.REDIS_ENABLED = 'false';

const CVProcessingAudit = require('../models/CVProcessingAudit');
const cvQueue = require('../services/cvAnalysisQueueService');

test.after(async () => {
  await cvQueue.closeForTests();
});

test('Admin audit snapshots use separate bounded active and recent index-shaped reads', async () => {
  const originalFind = CVProcessingAudit.find;
  const calls = [];
  CVProcessingAudit.find = (filter) => {
    const call = { filter, sort: null, limit: null, select: null };
    calls.push(call);
    const query = {
      sort(value) {
        call.sort = value;
        return query;
      },
      limit(value) {
        call.limit = value;
        return query;
      },
      select(value) {
        call.select = value;
        return query;
      },
      async lean() {
        if (filter.publicId) {
          return [{
            publicId: 'cv_recruiter_1',
            transitions: [{ state: 'queued', progress: 5, attempts: 0, at: new Date() }]
          }];
        }
        if (filter.state) {
          return [{
            publicId: 'aicv_active_1',
            producer: 'ai-interview',
            state: 'processing',
            lastUpdatedAt: new Date('2026-07-24T12:02:00.000Z')
          }];
        }
        return [{
          publicId: 'aicv_active_1',
          producer: 'ai-interview',
          state: 'processing',
          lastUpdatedAt: new Date('2026-07-24T12:02:00.000Z')
        }, {
          publicId: 'aicv_recent_2',
          producer: 'ai-interview',
          state: 'completed',
          lastUpdatedAt: new Date('2026-07-24T12:01:00.000Z')
        }];
      }
    };
    return query;
  };
  try {
    const result = await cvQueue._loadAdminAuditsForTests(['cv_recruiter_1'], 25);
    assert.deepEqual(
      result.externalAudits.map((audit) => audit.publicId),
      ['aicv_active_1', 'aicv_recent_2']
    );
    assert.equal(result.recruiterAudits[0].publicId, 'cv_recruiter_1');

    const externalCalls = calls.filter((call) => call.filter.producer === 'ai-interview');
    assert.equal(externalCalls.length, 2);
    assert.ok(externalCalls.every((call) => call.limit === 25));
    assert.ok(externalCalls.every((call) => (
      call.sort.lastUpdatedAt === -1 && call.sort.publicId === -1
    )));
    assert.deepEqual(externalCalls.find((call) => call.filter.state).filter.state.$in, [
      'queued',
      'waiting_for_local_runtime',
      'processing'
    ]);
    const recruiterCall = calls.find((call) => call.filter.publicId);
    assert.deepEqual(recruiterCall.filter.publicId.$in, ['cv_recruiter_1']);
    assert.equal(recruiterCall.select, 'publicId transitions');
  } finally {
    CVProcessingAudit.find = originalFind;
  }
});

test('audit model has compound indexes for bounded live reads and rate counters', () => {
  const indexes = CVProcessingAudit.schema.indexes();
  const named = new Map(indexes.map(([key, options]) => [options.name, key]));
  assert.deepEqual(named.get('cv_audit_producer_active_recent'), {
    producer: 1,
    state: 1,
    lastUpdatedAt: -1,
    publicId: -1
  });
  assert.deepEqual(named.get('cv_audit_producer_recent'), {
    producer: 1,
    lastUpdatedAt: -1,
    publicId: -1
  });
  assert.equal(named.get('cv_audit_producer_completed_rates').completedAt, -1);
  assert.equal(named.get('cv_audit_producer_failed_rates').failedAt, -1);
  assert.equal(named.get('cv_audit_producer_retries').attempts, 1);
});

test('Admin telemetry no longer computes a collection-wide activity rank sort', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cvAnalysisQueueService.js'),
    'utf8'
  );
  const adminSource = source.match(/async function adminTelemetry\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(adminSource, /\$addFields|adminActiveRank|CVProcessingAudit\.aggregate/);
  assert.match(adminSource, /loadAdminAudits/);
  assert.match(source, /function recentAuditQuery[\s\S]*?\.limit\(limit\)/);
  assert.match(source, /async function listHistory/);
  assert.match(source, /retainedIndefinitely: true/);
});

test('signed event batches are bounded and each job is ingested in sequence order', async () => {
  const originalUpdateOne = CVProcessingAudit.updateOne;
  const inserted = [];
  CVProcessingAudit.updateOne = async (_filter, update) => {
    if (update.$setOnInsert) {
      inserted.push({
        publicId: update.$setOnInsert.publicId,
        sequence: update.$setOnInsert.producerSequence
      });
    }
    return { acknowledged: true };
  };
  const base = {
    organizationId: 'settings',
    actorId: 'user_recruiter',
    jobId: 'job_engineering',
    createdAt: '2026-07-24T12:00:00.000Z'
  };
  try {
    const result = await cvQueue.ingestExternalQueueEvent('ai-interview', {
      jobs: [
        { ...base, publicId: 'aicv_batch_order_12345678', state: 'completed', progress: 100, sequence: 2, updatedAt: '2026-07-24T12:00:02.000Z' },
        { ...base, publicId: 'aicv_other_job_12345678', state: 'queued', progress: 5, sequence: 0, updatedAt: '2026-07-24T12:00:00.000Z' },
        { ...base, publicId: 'aicv_batch_order_12345678', state: 'queued', progress: 5, sequence: 0, updatedAt: '2026-07-24T12:00:00.000Z' },
        { ...base, publicId: 'aicv_batch_order_12345678', state: 'processing', progress: 50, sequence: 1, updatedAt: '2026-07-24T12:00:01.000Z' }
      ]
    });
    assert.equal(result.acceptedCount, 4);
    assert.deepEqual(
      inserted
        .filter((event) => event.publicId === 'aicv_batch_order_12345678')
        .map((event) => event.sequence),
      [0, 1, 2]
    );
    await assert.rejects(
      () => cvQueue.ingestExternalQueueEvent('ai-interview', {
        jobs: Array.from({ length: 101 }, () => ({
          ...base,
          publicId: 'aicv_too_many_12345678',
          state: 'queued'
        }))
      }),
      { code: 'CV_QUEUE_EVENT_INVALID' }
    );
  } finally {
    CVProcessingAudit.updateOne = originalUpdateOne;
  }
});
