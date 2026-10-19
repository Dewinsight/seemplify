'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPerformanceColleagues } = require('../services/performanceColleagueDirectoryService');
const principal = () => ({ currentOrganization: { id: 'org-a' }, session: { currentOrganizationId: 'org-a', user: { accessToken: 'verified-synthetic-token' } },
  headers: { authorization: 'Bearer untrusted-other-account' } });
const payload = () => ({ organizationId: 'org-a', members: [{ userId: 'peer', name: 'Peer', email: 'peer@example.test', jobTitle: 'Designer',
  roles: ['owner'], teams: [{ id: 'private-team' }], reviewers: ['private-reviewer'], internalNotes: 'private' }] });

test('uses only verified delegated identity, bounded literal query and projects minimal contact fields', async () => {
  let request;
  const req = principal(), original = structuredClone(req);
  const client = { get: async (url, options) => { request = { url, options }; return { data: payload() }; } };
  const result = await loadPerformanceColleagues(req, { q: '  Peer.*  ', limit: 999 }, client);
  assert.match(request.url, /\/api\/organizations\/org-a\/performance-colleagues$/);
  assert.equal(request.options.headers.Authorization, 'Bearer verified-synthetic-token');
  assert.deepEqual(request.options.params, { q: 'Peer.*', limit: 25 });
  assert.equal(request.options.maxRedirects, 0); assert.equal(request.options.timeout, 10000);
  assert.deepEqual(result, { organizationId: 'org-a', members: [{ userId: 'peer', name: 'Peer', email: 'peer@example.test', jobTitle: 'Designer' }] });
  assert.deepEqual(req, original);
});

for (const status of [401, 403, 503]) test(`upstream${status} remains failclosed without exposing provider errors`, async () => {
  const client = { get: async () => { throw { response: { status }, message: 'private-token-contents' }; } };
  await assert.rejects(loadPerformanceColleagues(principal(), { q: 'peer' }, client), error => error.status === status && !error.message.includes('private-token'));
});

test('foreign or malformed upstream identities failclosed without partial results', async () => {
  for (const data of [{ ...payload(), organizationId: 'foreign' }, { ...payload(), members: [{ userId: 'peer', name: 'Peer' }] },
    { ...payload(), members: [...payload().members, null] }, { ...payload(), members: Array(26).fill(payload().members[0]) }]) {
    await assert.rejects(loadPerformanceColleagues(principal(), { q: 'peer' }, { get: async () => ({ data }) }), error => error.status === 503);
  }
});

test('production never falls back to stale local records or trusts an unrelated raw bearer token', async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production'; const req = principal(); delete req.session.user.accessToken;
    let calls = 0;
    await assert.rejects(loadPerformanceColleagues(req, { q: 'peer' }, { get: async () => { calls++; } }), error => error.status === 401);
    assert.equal(calls, 0);
    process.env.NODE_ENV = 'test'; assert.equal(await loadPerformanceColleagues(req, { q: 'peer' }), null);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('short queries never call IdP and an empty fresh result stays empty', async () => {
  let calls = 0;
  const client = { get: async () => { calls++; return { data: { organizationId: 'org-a', members: [] } }; } };
  assert.deepEqual(await loadPerformanceColleagues(principal(), { q: 'p' }, client), { organizationId: 'org-a', members: [] });
  assert.equal(calls, 0);
  assert.deepEqual(await loadPerformanceColleagues(principal(), { q: 'peer' }, client), { organizationId: 'org-a', members: [] });
  assert.equal(calls, 1);
});

test('exact write lookup uses recipient ID and action without a search limit or accepting a different identity', async () => {
  let params;
  const client = { get: async (_url, options) => { params = options.params; return { data: payload() }; } };
  assert.equal((await loadPerformanceColleagues(principal(), { userId: 'peer', action: 'feedback:send' }, client)).members[0].userId, 'peer');
  assert.deepEqual(params, { userId: 'peer', action: 'feedback:send', limit: 1 });
  await assert.rejects(loadPerformanceColleagues(principal(), { userId: 'different' }, client), error => error.status === 503);
});
