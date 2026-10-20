const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceSession } = require('../lib/presence-session.ts');
const response = (status, data = {}) => ({ ok: status < 400, status, json: async () => data });
const body = () => ({ clientSessionId: 'synthetic-tab', visible: true });

test('a missing session is replaced and later activity uses the replacement', async () => {
  let clock = 0, starts = 0;
  const calls = [];
  const reporter = createPresenceSession(async (path) => {
    calls.push(path);
    return path === '/sessions' ? response(201, { sessionId: `session-${++starts}` }) : response(path.includes('session-1') ? 404 : 200);
  }, body, () => clock);
  await reporter.start(); clock = 15_000;
  await reporter.report('activity', { activityKind: 'action' });
  await reporter.report('heartbeat', { visible: true });
  assert.deepEqual(calls, ['/sessions', '/sessions/session-1/activity', '/sessions', '/sessions/session-2/heartbeat']);
});

test('late 404s cannot invalidate a recovered session, even when its ID is reused', async () => {
  let clock = 0, starts = 0;
  let release;
  const late = new Promise(resolve => { release = resolve; });
  const reporter = createPresenceSession(async (path) => {
    if (path === '/sessions') { starts++; return response(201, { sessionId: 'same-id' }); }
    if (path.endsWith('/activity')) return late;
    return response(404);
  }, body, () => clock);
  await reporter.start(); clock = 15_000;
  const old = reporter.report('activity', {});
  await reporter.report('heartbeat', {});
  clock = 30_000; release(response(404)); await old;
  await reporter.start();
  assert.equal(starts, 2);
});

test('concurrent 404s create only one replacement session', async () => {
  let clock = 0, starts = 0;
  const reporter = createPresenceSession(async path => path === '/sessions'
    ? response(201, { sessionId: `s-${++starts}` }) : response(404), body, () => clock);
  await reporter.start(); clock = 15_000;
  await Promise.all([reporter.report('activity', {}), reporter.report('heartbeat', {}), reporter.report('activity', {})]);
  assert.equal(starts, 2);
});

test('failed starts are bounded and recover without an activity request loop', async () => {
  let clock = 0, starts = 0;
  const reporter = createPresenceSession(async () => { starts++; return starts === 1 ? response(503) : response(201, { sessionId: 'recovered' }); }, body, () => clock);
  await reporter.start();
  for (let i = 0; i < 20; i++) await reporter.report('activity', {});
  assert.equal(starts, 1);
  clock = 10_000; await reporter.start();
  assert.equal(starts, 2);
});

test('unmount prevents late starts and future activity from reviving the old identity', async () => {
  let release, calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const reporter = createPresenceSession(async () => { calls++; return waiting; }, body);
  const pending = reporter.start(); reporter.stop();
  release(response(201, { sessionId: 'old-user-session' })); await pending;
  await reporter.report('activity', {}); await reporter.start();
  assert.equal(calls, 1);
});

test('temporary service errors do not repeatedly create sessions', async () => {
  const calls = [];
  const reporter = createPresenceSession(async path => { calls.push(path); return path === '/sessions' ? response(201, { sessionId: 'active' }) : response(503); }, body);
  await reporter.start(); await reporter.report('activity', {}); await reporter.report('heartbeat', {});
  assert.deepEqual(calls, ['/sessions', '/sessions/active/activity', '/sessions/active/heartbeat']);
});
