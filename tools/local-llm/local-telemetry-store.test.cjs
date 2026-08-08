const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalTelemetryStore } = require('./local-telemetry-store.cjs');

test('the local runtime owns provider telemetry and activity history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-telemetry-'));
  const store = new LocalTelemetryStore({ directory, maxEvents: 100, maxQueueJobs: 100 });
  await store.record({
    eventId: `usage_${'a'.repeat(48)}`,
    requestId: 'request-1',
    provider: 'local-claude',
    model: 'sonnet',
    activity: 'candidate.cv_parse',
    sourceApp: 'recruiter',
    actorId: 'person-1',
    organizationId: 'company-1',
    status: 'success',
    totalTokens: 42,
    latencyMs: 125,
    occurredAt: new Date().toISOString()
  });

  assert.equal(store.providerTelemetry().providers[0].id, 'local-claude');
  assert.equal(store.analytics('1h').summary.calls, 1);
  assert.equal(store.activityHistory({ range: '1h' }).items[0].requestId, 'request-1');

  const reloaded = new LocalTelemetryStore({ directory, maxEvents: 100, maxQueueJobs: 100 });
  assert.equal(reloaded.analytics('1h').summary.totalTokens, 42);
});

test('queue snapshots are retained locally and bounded', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-queue-history-'));
  const store = new LocalTelemetryStore({ directory, maxEvents: 100, maxQueueJobs: 100 });
  await store.recordQueueSnapshot({ recentJobs: [
    { jobId: 'cv_first_job', source: 'bulk', state: 'completed', createdAt: '2026-08-08T10:00:00Z', updatedAt: '2026-08-08T10:01:00Z' },
    { jobId: 'cv_second_job', source: 'bulk', state: 'failed', createdAt: '2026-08-08T10:02:00Z', updatedAt: '2026-08-08T10:03:00Z' }
  ] });

  const history = store.queueHistory({ state: 'failed', page: 1, limit: 25 });
  assert.equal(history.total, 1);
  assert.equal(history.jobs[0].jobId, 'cv_second_job');
  assert.equal(store.status().maxQueueJobs, 100);
});
