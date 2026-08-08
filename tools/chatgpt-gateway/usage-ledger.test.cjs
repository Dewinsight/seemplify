'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PlatformUsageLedger } = require('./usage-ledger.cjs');

function usage(sourceApp, suffix) {
  const hash = crypto.createHash('sha256').update(suffix).digest('hex').slice(0, 48);
  return {
    eventId: `usage_${hash}`,
    gatewayExecutionId: `chatgptexec_${hash}`,
    requestId: `request-${suffix}`,
    sourceApp,
    activity: 'test.activity',
    provider: 'chatgpt-connect',
    model: 'connected-account',
    status: 'success',
    occurredAt: '2026-08-08T12:00:00.000Z',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15
  };
}

test('platform ledger stores queryable metadata for registered apps without prompt content', async (context) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seemplify-ai-ledger-'));
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const ledger = new PlatformUsageLedger({ directory });
  await ledger.record(usage('recruiter', 'one'));
  await ledger.record(usage('recruiter', 'one'));
  await ledger.record(usage('performance-management', 'two'));
  assert.equal((await ledger.query({ sourceApp: 'recruiter' })).length, 1);
  assert.deepEqual((await ledger.summary()).bySourceApp, { 'performance-management': 1, recruiter: 1 });
  const stored = await Promise.all((await fs.promises.readdir(ledger.eventsDirectory))
    .map((name) => fs.promises.readFile(path.join(ledger.eventsDirectory, name), 'utf8')));
  assert.equal(stored.join('').includes('messages'), false);
});

test('platform ledger rejects Experience Management until it is intentionally onboarded', async (context) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seemplify-ai-ledger-'));
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const ledger = new PlatformUsageLedger({ directory });
  await assert.rejects(ledger.record(usage('experience-management', 'excluded')), { code: 'AI_SOURCE_APP_NOT_ALLOWED' });
});
