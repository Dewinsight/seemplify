const test = require('node:test');
const assert = require('node:assert/strict');
const { Issuer } = require('openid-client');
const modulePath = require.resolve('../middleware/claimsRefresh');
const organization = (schemaVersion) => ({ id: 'org', appAccess: { mode: 'all' }, authorization: { schemaVersion, permissionsByApp: { 'performance-management': [] } } });
async function run(fresh, shouldFail = false, token = 'synthetic') {
  const original = Issuer.discover;
  Issuer.discover = async () => ({ Client: class { async userinfo() { if (shouldFail) throw new Error('unavailable'); return fresh; } } });
  delete require.cache[modulePath];
  try {
    const req = { session: { user: { organizations: [organization(3)], accessToken: token }, currentOrganizationId: 'org' } };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    let next = false;
    await require(modulePath).claimsRefreshMiddleware(req, res, () => { next = true; });
    return { req, res, next };
  } finally { Issuer.discover = original; delete require.cache[modulePath]; }
}
test('retired policy refresh failure blocks authorization instead of using old grants', async () => {
  const result = await run({}, true);
  assert.equal(result.next, false); assert.equal(result.res.code, 401);
});
test('rolling-deploy old issuer cannot reauthorize a retired policy', async () => {
  const result = await run({ organizations: [organization(3)] });
  assert.equal(result.next, false); assert.equal(result.res.code, 401);
});
test('successful policy refresh replaces old permissions and continues', async () => {
  const result = await run({ organizations: [organization(4)], currentOrganization: organization(4) });
  assert.equal(result.next, true); assert.equal(result.req.session.user.organizations[0].authorization.schemaVersion, 4);
});
