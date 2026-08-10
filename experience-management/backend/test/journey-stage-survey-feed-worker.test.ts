import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JourneyStageSurveyFeedWorker } from '../src/journeyStageSurveyFeedWorker.js';
import { JourneyStageSurveyFeedRetentionWorker } from '../src/journeyStageSurveyFeedRetention.js';

test('worker applies one fenced claim and emits count-only telemetry', async () => {
  const events: Record<string, unknown>[] = []; let executeCount = 0;
  const repository = {
    claim: () => ({ id: 'private-outbox-id', space_id: 'private-space', lease_owner: 'owner',
      lease_token: 'secret-token', lease_generation: 1 }),
    execute: () => { executeCount += 1; return { applied: 1, complete: true }; },
    fail: () => true
  } as any;
  const worker = new JourneyStageSurveyFeedWorker(repository, 60_000, (_level, event) => events.push(event));
  worker.start(); await worker.drain(); worker.stop();
  assert.equal(executeCount, 1); assert.deepEqual(events, [{ event: 'survey_feed_applied', appliedCount: 1, complete: true }]);
  assert.equal(JSON.stringify(events).includes('private-outbox-id'), false);
  assert.equal(JSON.stringify(events).includes('secret-token'), false);
});

test('worker converts failures to durable repository failure without logging payloads', async () => {
  const events: Record<string, unknown>[] = []; const failed: string[] = [];
  const claim = { id: 'private-outbox-id', space_id: 'private-space', lease_owner: 'owner',
    lease_token: 'secret-token', lease_generation: 2 };
  const repository = { claim: () => claim, execute: () => { throw Object.assign(new Error('private answer'),
    { code: 'JOURNEY_STAGE_SURVEY_PROJECTION_INVALID' }); }, fail: (_claim: unknown, code: string) => { failed.push(code); return true; } } as any;
  const worker = new JourneyStageSurveyFeedWorker(repository, 60_000, (_level, event) => events.push(event));
  worker.start(); await worker.drain(); worker.stop();
  assert.deepEqual(failed, ['JOURNEY_STAGE_SURVEY_PROJECTION_INVALID']);
  assert.match(String(events[0]?.errorFingerprint), /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(events).includes('private answer'), false);
});

test('retention lifecycle resumes from its durable page cursor and logs counts and hashes only', () => {
  const cursors: Array<string | null | undefined> = []; const events: Record<string, unknown>[] = [];
  const run = (_asOf?: string, _limit?: number, cursor?: string | null) => {
    cursors.push(cursor); return { spacesScanned: 100, spacesPurged: 99, failedSpaces: 1, purgedCount: 400,
      failureFingerprints: ['a'.repeat(64)], nextCursor: cursor ? null : 'space-private-cursor' };
  };
  const worker = new JourneyStageSurveyFeedRetentionWorker(60_000, run, (_level, event) => events.push(event));
  worker.start(); worker.runOnce('2026-08-08T00:00:00.000Z'); worker.stop();
  assert.deepEqual(cursors, [null, 'space-private-cursor']);
  assert.equal(JSON.stringify(events).includes('space-private-cursor'), false);
  assert.equal(events.every((event) => event.event === 'survey_feed_retention_pass'), true);
});
