const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LiveSnapshotBroadcaster } = require('../services/aiRuntime/liveSnapshotBroadcaster');

function fakeRequest(headers = {}) {
  const request = new EventEmitter();
  request.headers = headers;
  request.get = (name) => headers[String(name).toLowerCase()];
  return request;
}

function fakeResponse({ blockFirstWrite = false } = {}) {
  const response = new EventEmitter();
  response.writes = [];
  response.headers = {};
  response.statusCode = null;
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.set = (headers) => {
    response.headers = headers;
    return response;
  };
  response.flushHeaders = () => {};
  response.write = (frame) => {
    response.writes.push(frame);
    if (blockFirstWrite) {
      blockFirstWrite = false;
      return false;
    }
    return true;
  };
  return response;
}

function manualIntervals() {
  const timers = new Set();
  return {
    timers,
    setIntervalFn(callback, intervalMs) {
      const timer = { callback, intervalMs, unref() {} };
      timers.add(timer);
      return timer;
    },
    clearIntervalFn(timer) {
      timers.delete(timer);
    }
  };
}

test('shares one in-flight telemetry sample across every SSE client', async () => {
  const clock = manualIntervals();
  let samples = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const broadcaster = new LiveSnapshotBroadcaster({
    sampler: async () => {
      samples += 1;
      await gate;
      return { sampledAt: '2026-07-24T20:00:00.000Z', calls: 4 };
    },
    intervalMs: 3_000,
    ...clock
  });
  const requestA = fakeRequest();
  const requestB = fakeRequest();
  const responseA = fakeResponse();
  const responseB = fakeResponse();

  broadcaster.subscribe(requestA, responseA);
  broadcaster.subscribe(requestB, responseB);
  release();
  await broadcaster.sampleNow();

  assert.equal(samples, 1);
  assert.equal(responseA.statusCode, 200);
  assert.equal(responseA.headers['X-Accel-Buffering'], 'no');
  assert.equal(responseA.writes.length, 1);
  assert.equal(responseB.writes.length, 1);
  assert.match(responseA.writes[0], /^id: .+\nevent: snapshot\n/);
  assert.match(responseA.writes[0], /"staleAfterMs":9000/);
  assert.equal(clock.timers.size, 2);

  requestA.emit('close');
  assert.equal(clock.timers.size, 2);
  requestB.emit('close');
  assert.equal(clock.timers.size, 0);
});

test('coalesces snapshots while a slow SSE client applies backpressure', async () => {
  const clock = manualIntervals();
  let revision = 0;
  const broadcaster = new LiveSnapshotBroadcaster({
    sampler: async () => ({
      sampledAt: `2026-07-24T20:00:0${revision}.000Z`,
      revision: ++revision
    }),
    intervalMs: 2_000,
    ...clock
  });
  const request = fakeRequest();
  const response = fakeResponse({ blockFirstWrite: true });
  broadcaster.subscribe(request, response);
  await broadcaster.sampleNow();
  await broadcaster.sampleNow();
  await broadcaster.sampleNow();

  assert.equal(response.writes.length, 1);
  response.emit('drain');
  assert.equal(response.writes.length, 2);
  assert.match(response.writes[1], /"revision":3/);
  assert.doesNotMatch(response.writes[1], /"revision":2/);
  request.emit('close');
});

test('reports sampler failures without discarding last-good snapshot metadata', async () => {
  const clock = manualIntervals();
  let fail = false;
  const broadcaster = new LiveSnapshotBroadcaster({
    sampler: async () => {
      if (fail) throw new Error('database offline');
      return { sampledAt: '2026-07-24T20:01:00.000Z', calls: 1 };
    },
    intervalMs: 3_000,
    errorMessage: 'Live AI telemetry is temporarily unavailable',
    ...clock
  });
  const request = fakeRequest();
  const response = fakeResponse();
  broadcaster.subscribe(request, response);
  await broadcaster.sampleNow();
  fail = true;
  await broadcaster.sampleNow();

  assert.match(response.writes.at(-1), /event: telemetry-error/);
  assert.match(response.writes.at(-1), /"lastGoodSampledAt":"2026-07-24T20:01:00.000Z"/);
  assert.doesNotMatch(response.writes.at(-1), /database offline/);
  request.emit('close');
});
