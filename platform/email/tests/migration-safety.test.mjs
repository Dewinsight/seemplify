import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeManifest, verifyManifest } from '../scripts/lib/manifest.mjs';
import { evaluateQueueGate, parsePostfixQueue, parsePostalQueue, shouldMigrateSpool } from '../scripts/lib/queue-gates.mjs';
import { buildCleanupPlan, loadAllowlist } from '../scripts/lib/cleanup-plan.mjs';
import { evaluateSoak, SOAK_DURATION_MS } from '../scripts/lib/soak.mjs';

test('manifest detects tampering after transfer', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mail-manifest-'));
  const file = path.join(root, 'state.tar.gz');
  writeFileSync(file, 'original');
  await writeManifest(root, { phase: 'test' });
  assert.equal((await verifyManifest(root)).ok, true);
  appendFileSync(file, 'tampered');
  assert.equal((await verifyManifest(root)).ok, false);
});

test('queue gate is open only for two readable empty queues', () => {
  const emptyPostfix = parsePostfixQueue('Mail queue is empty');
  const emptyPostal = parsePostalQueue('0');
  assert.equal(evaluateQueueGate({ postfix: emptyPostfix, postal: emptyPostal }).open, true);
  const unreadable = parsePostfixQueue('postqueue: fatal: permission denied');
  assert.equal(evaluateQueueGate({ postfix: unreadable, postal: emptyPostal }).open, false);
  const queued = parsePostfixQueue('ABCDEF1234  123 Fri sender@example.com');
  assert.equal(shouldMigrateSpool(queued), true);
});

test('cleanup excludes unrelated containers and contains exactly four volumes', () => {
  const allowlist = loadAllowlist();
  assert.equal(allowlist.categories.volumes.names.length, 4);
  const plan = buildCleanupPlan({
    containers: [
      { name: 'seemplify-mail-mail-api-1', project: 'seemplify-mail' },
      { name: 'unrelated-production-db', project: 'other' },
    ],
    volumes: ['seemplify-mail_mail-api-data', 'other_data'],
  });
  assert.ok(plan.actions.some((item) => item.target === 'seemplify-mail-mail-api-1'));
  assert.ok(!plan.actions.some((item) => item.target === 'unrelated-production-db'));
  assert.ok(!plan.actions.some((item) => item.target === 'other_data'));
});

test('soak requires continuous healthy coverage for the full 30 minutes', () => {
  const start = Date.parse('2026-08-07T10:00:00Z');
  const samples = [];
  for (let at = start; at <= start + SOAK_DURATION_MS; at += 30_000) samples.push({ at, ok: true });
  assert.equal(evaluateSoak(samples, { startedAt: start }).ok, true);
  samples[10].ok = false;
  assert.equal(evaluateSoak(samples, { startedAt: start }).ok, false);
  assert.equal(evaluateSoak(samples.slice(0, -1), { startedAt: start }).ok, false);
});
