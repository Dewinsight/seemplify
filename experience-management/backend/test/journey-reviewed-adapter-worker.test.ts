import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { reviewedWorkerAdapters } from '../src/journeyReviewedAdapterWorker.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const workerSource=fs.readFileSync(path.resolve(here,'../src/journeyReviewedAdapterWorker.ts'),'utf8');
const runtimeSource=fs.readFileSync(path.resolve(here,'../src/journeyActionWorkerRuntime.ts'),'utf8');

test('durable reviewed worker exposes only adapters with a safe execution contract',()=>{
  assert.deepEqual([...reviewedWorkerAdapters].sort(),
    ['assistant_action','internal_notification','service_recovery_ticket','signed_webhook']);
  assert.doesNotMatch(reviewedWorkerAdapters.join(','),/survey_invitation/);
  assert.match(workerSource,/WORKER_SURVEY_PROVIDER_IDEMPOTENCY_REQUIRED/);
});

test('worker execution delegates the single usage settlement and never calls application usage consumption',()=>{
  assert.doesNotMatch(workerSource,/consumeSubscriptionUsage/);
  assert.match(workerSource,/completeReviewedEffect/);
  assert.match(runtimeSource,/new JourneyReviewedAdapterWorker\(workerDb,service\)/);
  assert.match(runtimeSource,/adapterWorker\.execute/);
});

test('internal effects are passed into atomic settlement while webhook replay uses durable dispatch identity',()=>{
  assert.match(workerSource,/applyInternalEffect:effect/);
  assert.match(workerSource,/SELECT \* FROM journey_webhook_dispatches WHERE queue_id=\? AND space_id=\?/);
  assert.match(workerSource,/idempotency-key':row\.idempotency_key/);
  assert.match(workerSource,/dispatch\.state!==['"]succeeded['"]/);
});
