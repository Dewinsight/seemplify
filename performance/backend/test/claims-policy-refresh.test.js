const test = require('node:test');
const assert = require('node:assert/strict');
const { Issuer } = require('openid-client');
const { MIN_AUTHORIZATION_SCHEMA_VERSION, hasRetiredAuthorization } = require('../services/authorizationPolicyVersion');
const modulePath = require.resolve('../middleware/claimsRefresh');
const organization = schemaVersion => ({ id: 'refresh-org', appAccess: { mode: 'all' }, authorization: { schemaVersion, permissionsByApp: { 'performance-management': [] } } });
async function run({ version = 4, fresh = {}, fail = false, token = 'synthetic-local-token', stale = false } = {}) {
  const original = Issuer.discover;
  let discoveries = 0;
  Issuer.discover = async () => { discoveries++; return { Client: class { async userinfo() { if (fail) throw new Error('Synthetic unavailable issuer'); return fresh; } } }; };
  delete require.cache[modulePath];
  try {
    const req = { session: { user: { organizations: [organization(version)], accessToken: token }, currentOrganizationId: 'refresh-org', claimsNeedRefresh: stale } };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let next = false;
    await require(modulePath).claimsRefreshMiddleware(req, res, () => { next = true; });
    return { req, res, next, discoveries };
  } finally { Issuer.discover = original; delete require.cache[modulePath]; }
}
test('Performance refresh minimum matches the canonical IdP schema', async () => {
  const catalog = await import('../../../Identityprovider/src/config/accessControlCatalog.js');
  assert.equal(MIN_AUTHORIZATION_SCHEMA_VERSION, catalog.ACCESS_CONTROL_SCHEMA_VERSION);
  assert.equal(hasRetiredAuthorization({ current_organization: organization(4) }), true);
  assert.equal(hasRetiredAuthorization({ organizations: [organization('invalid')] }), true);
});
test('retired policy refresh failure cannot authorize with its old matrix', async () => {
  const result = await run({ fail: true });
  assert.equal(result.next, false); assert.equal(result.res.code, 401);
  assert.equal(result.res.body.code, 'CLAIMS_REFRESH_REQUIRED');
});
test('a retired policy without a token fails before issuer discovery', async () => {
  const result = await run({ token: null });
  assert.equal(result.next, false); assert.equal(result.res.code, 401); assert.equal(result.discoveries, 0);
});
test('rolling-deploy retired issuer cannot restore old privileges', async () => {
  const result = await run({ fresh: { organizations: [organization(4)] } });
  assert.equal(result.next, false); assert.equal(result.res.code, 401);
});
test('successful schema5 refresh replaces the matrix and continues', async () => {
  const current = organization(5);
  const result = await run({ fresh: { organizations: [current], currentOrganization: current, teams: [] } });
  assert.equal(result.next, true); assert.equal(result.req.session.user.organizations[0].authorization.schemaVersion, 5);
  assert.equal(result.req.session.claimsNeedRefresh, false);
});
test('current policy does not trigger unnecessary remote refresh', async () => {
  const result = await run({ version: 5 });
  assert.equal(result.next, true); assert.equal(result.discoveries, 0);
});
test('webhook-marked permissions fail closed on unavailable or missing refresh token', async () => {
  for (const options of [{ fail: true }, { token: null }]) {
    const result = await run({ version: 5, stale: true, ...options });
    assert.equal(result.next, false); assert.equal(result.res.code, 401);
    assert.equal(result.req.session.claimsNeedRefresh, true);
  }
});
test('refresh with withdrawn app access removes the organization rather than reviving stale access', async () => {
  const result = await run({ fresh: { organizations: [], teams: [] } });
  assert.equal(result.next, true); assert.deepEqual(result.req.session.user.organizations, []);
  assert.equal(result.req.session.currentOrganizationId, null);
});