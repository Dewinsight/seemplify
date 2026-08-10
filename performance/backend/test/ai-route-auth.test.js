'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

// The backend test bundle intentionally has no installed production packages.
// Stub axios while loading RBAC; the exercised session path never calls it.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'axios') return { get: async () => ({ data: {} }) };
  if (request === '../services/appraisalAccessService') {
    return {
      getOrganizationRole: (user) => user?.currentOrganization?.role || user?.organizations?.[0]?.role || null,
      isHrPlusRole: (role) => ['owner', 'admin', 'hr_manager'].includes(String(role || '').toLowerCase())
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { requireAuth } = require('../middleware/rbac');
Module._load = originalLoad;
const { requirePerformancePermission } = require('../middleware/performanceMiddleware');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function runAIBoundary(req) {
  const res = responseRecorder();
  let handlerReached = false;
  await requireAuth(req, res, async () => {
    await requirePerformancePermission('create:okrs')(req, res, () => {
      handlerReached = true;
    });
  });
  return { res, handlerReached };
}

test('AI route mount authenticates before Performance permission and normalizes the session principal', async () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(appSource, /app\.use\('\/api\/ai', requireAuth, aiRoutes\);/);

  const unauthenticated = await runAIBoundary({ session: {}, headers: {} });
  assert.equal(unauthenticated.res.statusCode, 401);
  assert.equal(unauthenticated.res.body.code, 'AUTH_REQUIRED');
  assert.equal(unauthenticated.handlerReached, false);

  const sessionUser = {
    sub: 'idp-performance-1',
    email: 'manager@example.com',
    currentOrganization: { id: 'org-1', name: 'Example Org', role: 'owner', appAccess: { mode: 'all', appIds: [] } },
    organizations: [{ id: 'org-1', name: 'Example Org', role: 'owner', appAccess: { mode: 'all', appIds: [] } }],
    teams: []
  };
  const request = { session: { user: sessionUser }, headers: {} };
  const authenticated = await runAIBoundary(request);
  assert.equal(authenticated.res.statusCode, 200);
  assert.equal(authenticated.handlerReached, true);
  assert.equal(request.user, request.session.user);
  assert.equal(request.user.sub, sessionUser.sub);
  assert.equal(request.user.email, sessionUser.email);
  assert.equal(request.currentOrganization.id, 'org-1');
});
