import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseRuntime } from '../src/databaseAdapter.js';
import { purgeExpiredJourneyOperationalStageFeed } from '../src/journeyOperationalStageFeedRetention.js';
import { validateJourneyOperationalStageFeedConfiguration } from '../src/journeyOperationalStageFeedRuntime.js';
import { JourneyOperationalStageFeedWorker } from '../src/journeyOperationalStageFeedWorker.js';

test('worker reports idle without manufacturing an effect', () => {
  const repository = { claim: () => null, complete: () => assert.fail('must not execute'), fail: () => false };
  assert.deepEqual(new JourneyOperationalStageFeedWorker(repository as never).runOnce('worker'), { state: 'idle' });
});

test('worker fences failure through the durable repository without exposing error content', () => {
  const claim = { id: 'outbox-a', lease_owner: 'worker', lease_token: 'token', lease_generation: 2 };
  const failed: Array<{ claim: unknown; code: string }> = []; const telemetry: unknown[] = [];
  const repository = {
    claim: () => claim,
    complete: () => { throw Object.assign(new Error('private provider response'), { code: 'PROJECTION_INVALID' }); },
    fail: (row: unknown, code: string) => { failed.push({ claim: row, code }); return true; }
  };
  const result = new JourneyOperationalStageFeedWorker(repository as never, (event) => telemetry.push(event))
    .runOnce('worker', '2026-08-08T10:00:00.000Z');
  assert.deepEqual(result, { state: 'failed', outboxId: 'outbox-a', errorCode: 'PROJECTION_INVALID' });
  assert.deepEqual(failed, [{ claim, code: 'PROJECTION_INVALID' }]);
  assert.equal(JSON.stringify(telemetry).includes('private provider response'), false);
});

test('worker batches only its explicit tenant scope and does not overlap', async() => {
  const claims: unknown[] = []; let remaining = 2;
  const repository = { claim: (input: unknown) => { claims.push(input); return remaining-- > 0
    ? { id: `outbox-${remaining}`, lease_owner: 'worker', lease_token: 'token', lease_generation: 1 } : null; },
  complete: () => true, fail: () => false };
  const worker = new JourneyOperationalStageFeedWorker(repository as never, undefined,
    { owner: 'worker', batchSize: 10, spaceIds: ['space-a'], leaseMs: 10_000 });
  assert.deepEqual(await worker.runBatch('2026-08-08T10:00:00.000Z'), { processed: 2, busy: false });
  assert.ok(claims.every((claim: any) => claim.spaceIds?.[0] === 'space-a' && claim.leaseMs === 10_000));
  assert.equal(await worker.drain(), true);
});

test('retention cursor advances past a failed early tenant', () => {
  const runtime = { prepare: () => ({ all: () => [{ space_id: 'a' }, { space_id: 'b' }, { space_id: 'c' }] }) } as unknown as DatabaseRuntime;
  const result = purgeExpiredJourneyOperationalStageFeed({ runtime, spaceIds: ['a', 'b', 'c'], limit: 2,
    asOf: '2027-08-08T00:00:00.000Z', repository: { purgeExpired: ({ spaceId }: { spaceId: string }) => {
      if (spaceId === 'a') throw new Error('private database detail'); return { purgedCount: 1, hasMore: false }; } } as never });
  assert.equal(result.failedSpaces, 1); assert.equal(result.spacesPurged, 1); assert.equal(result.nextCursor, 'b');
  assert.equal(result.failureFingerprints.length, 1); assert.match(result.failureFingerprints[0], /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes('private database detail'), false);
});

test('production lifecycle is disabled by default and requires PostgreSQL plus explicit tenants', () => {
  const base = { enabled: true, databaseProvider: 'postgres', pollMs: 1_000, batchSize: 10, leaseMs: 30_000,
    retentionPollMs: 60_000, spaceIds: ['space-a'], postgres: {} as never };
  assert.doesNotThrow(() => validateJourneyOperationalStageFeedConfiguration(base));
  assert.throws(() => validateJourneyOperationalStageFeedConfiguration({ ...base, databaseProvider: 'sqlite' }), /requires PostgreSQL/u);
  assert.throws(() => validateJourneyOperationalStageFeedConfiguration({ ...base, spaceIds: [] }), /explicit bounded tenant scope/u);
  assert.doesNotThrow(() => validateJourneyOperationalStageFeedConfiguration({ ...base, enabled: false, spaceIds: [] }));
});
