const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertUser } = require('./bootstrap-arango.cjs');

test('repeated user provisioning patches credentials without replacing tenant grants', async () => {
  const calls = [];
  const request = async (url, options = {}) => { calls.push({ url, ...options }); return { user: 'existing-app' }; };
  await upsertUser('existing-app', 'synthetic-test-secret', request);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].body.active, true);
  assert.equal(calls[1].body.databases, undefined);
});

test('a missing service user is created without treating a server failure as absence', async () => {
  const calls = [];
  await upsertUser('new-app', 'synthetic-test-secret', async (url, options = {}) => {
    calls.push({ url, ...options });
    if (!options.method) throw new Error('user not found');
    return {};
  });
  assert.equal(calls[1].method, 'POST');
  await assert.rejects(upsertUser('new-app', 'synthetic-test-secret', async () => { throw new Error('server unavailable'); }), /unavailable/);
});
