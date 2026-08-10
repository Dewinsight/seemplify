import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkerAuthority } from '../src/journeyActionWorkerDomain.js';
import { JourneyActionWorkerScheduler } from '../src/journeyActionWorkerScheduler.js';
import { NoContentWorkerTelemetry } from '../src/journeyActionWorkerService.js';

const authority: WorkerAuthority = Object.freeze({ kind: 'journey_action_worker', workerIdSha256: 'a'.repeat(64),
  allowedSpaceIds: ['space-a'], allowedAdapters: ['assistant_action'], issuedAt: '2026-08-08T00:00:00.000Z',
  expiresAt: '2026-08-09T00:00:00.000Z', keyId: 'key-a' });

test('scheduler start/stop are idempotent and overlapping ticks are suppressed', async () => {
  let scheduled = 0; let cleared = 0; let claims = 0; let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const service = { reevaluateHeld: async () => ({ checked: 0, released: 0 }), claim: async () => {
    claims += 1; await blocker; return null; } } as never;
  const telemetry = new NoContentWorkerTelemetry();
  const scheduler = new JourneyActionWorkerScheduler(service, authority, telemetry, 10,
    ((callback: () => void) => { scheduled += 1; return { callback } as never; }) as never,
    (() => { cleared += 1; }) as never);
  scheduler.start(); scheduler.start(); assert.equal(scheduled, 1); assert.equal(scheduler.isStarted, true);
  const first = scheduler.tick(); const overlap = scheduler.tick(); await overlap; assert.equal(claims, 1);
  release(); await first; scheduler.stop(); scheduler.stop(); assert.equal(cleared, 1); assert.equal(scheduler.isStarted, false);
});

test('scheduler converts failures to bounded telemetry and does not throw', async () => {
  const service = { reevaluateHeld: async () => { throw new Error('payload must never escape'); } } as never;
  const telemetry = new NoContentWorkerTelemetry();
  const scheduler = new JourneyActionWorkerScheduler(service, authority, telemetry, 10,
    (() => 1 as never) as never, (() => {}) as never);
  scheduler.start(); await scheduler.tick(); scheduler.stop();
  assert.equal(telemetry.events.at(-1)?.reasonCode, 'SCHEDULER_TICK_FAILED');
  assert.doesNotMatch(JSON.stringify(telemetry.events), /payload must never escape/);
});
