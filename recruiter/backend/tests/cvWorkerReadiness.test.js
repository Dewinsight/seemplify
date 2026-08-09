'use strict';

process.env.REDIS_ENABLED = 'false';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  _evaluateWorkerReadinessForTests: evaluateWorkerReadiness
} = require('../services/cvAnalysisQueueService');

const healthyDispatch = Object.freeze({
  initialized: true,
  healthy: true,
  stopping: false,
  errorCode: null
});

test('production CV readiness requires durable storage, indexes, worker, and global dispatch', () => {
  const ready = evaluateWorkerReadiness({
    environment: 'production',
    queueEnabled: true,
    mongoReady: true,
    indexesReady: true,
    workerInitialized: true,
    dispatchHealth: healthyDispatch
  });

  assert.equal(ready.healthy, true);
  assert.equal(ready.durableStorage.ready, true);
  assert.equal(ready.indexes.ready, true);
  assert.equal(ready.dispatcher.required, true);
  assert.equal(ready.dispatcher.ready, true);
});

test('production CV readiness fails closed for every infrastructure boundary', () => {
  const base = {
    environment: 'production',
    queueEnabled: true,
    mongoReady: true,
    indexesReady: true,
    workerInitialized: true,
    dispatchHealth: healthyDispatch
  };

  assert.equal(evaluateWorkerReadiness({ ...base, mongoReady: false }).healthy, false);
  assert.equal(evaluateWorkerReadiness({ ...base, indexesReady: false }).healthy, false);
  assert.equal(evaluateWorkerReadiness({ ...base, workerInitialized: false }).healthy, false);
  assert.equal(evaluateWorkerReadiness({
    ...base,
    dispatchHealth: { ...healthyDispatch, healthy: false, errorCode: 'CV_GLOBAL_DISPATCH_REDIS_ERROR' }
  }).healthy, false);
  assert.equal(evaluateWorkerReadiness({ ...base, queueEnabled: false }).healthy, false);
});

test('parked CV work does not participate in infrastructure readiness', () => {
  const ready = evaluateWorkerReadiness({
    environment: 'production',
    queueEnabled: true,
    mongoReady: true,
    indexesReady: true,
    workerInitialized: true,
    dispatchHealth: healthyDispatch
  });

  assert.equal(ready.healthy, true);
  assert.equal(Object.hasOwn(ready, 'jobs'), false);
  assert.equal(Object.hasOwn(ready, 'backlog'), false);
});

test('development can deliberately disable the dispatcher after durable indexes initialize', () => {
  const ready = evaluateWorkerReadiness({
    environment: 'development',
    queueEnabled: false,
    mongoReady: true,
    indexesReady: true,
    workerInitialized: false,
    dispatchHealth: {
      initialized: false,
      healthy: true,
      stopping: false,
      errorCode: null
    }
  });

  assert.equal(ready.healthy, true);
  assert.equal(ready.dispatcher.required, false);
});

test('the public health route gates deployment on CV ingestion readiness', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /const cvIngestion = require\('\.\/services\/cvAnalysisQueueService'\)\.readiness\(\)/);
  assert.match(source, /&& cvIngestion\.healthy/);
  assert.match(source, /aiUsageProjectionRepair: projectionRepair,\s*cvIngestion/);
});
