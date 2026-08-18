'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const User = require('../models/User');
const Organization = require('../models/Organization');
const idpService = require('../services/idpService');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const { switchOrganization } = require('../controllers/organizationController');
const { recruiterOrganizationAuthorized } = require('../services/sharedAIUserSecurity');
const { getAIRequestContext, runWithAIRequestContext } = require('../services/aiRuntime/requestContext');

const ORG_A = '507f191e810c19729de86101';
const ORG_B = '507f191e810c19729de86102';

function user() {
  return {
    _id: '507f191e810c19729de86100',
    id: '507f191e810c19729de86100',
    sharedAIOnly: false,
    currentOrganization: ORG_B,
    recruiterAppAccessSyncedAt: new Date(),
    recruiterAuthorizedOrganizations: [ORG_A],
    organizationMemberships: [
      { organization: ORG_A, isActive: true, role: 'owner' },
      { organization: ORG_B, isActive: true, role: 'owner' }
    ],
    async save() { return this; }
  };
}

function responseResult() {
  const result = { statusCode: 200, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return this; }
    }
  };
}

test('Recruiter authorization is exact per organization in an A Recruiter / B Performance-only membership', () => {
  const actor = user();
  assert.equal(recruiterOrganizationAuthorized(actor, ORG_A), true);
  assert.equal(recruiterOrganizationAuthorized(actor, ORG_B), false);
});

test('organization middleware accepts authorized A and rejects header/current fallback to B', async () => {
  const originalFindById = User.findById;
  User.findById = async () => user();
  try {
    const allowed = responseResult();
    const allowedReq = {
      user: { id: user().id, currentOrganization: ORG_B },
      get(name) { return name.toLowerCase() === 'x-organization-id' ? ORG_A : ''; }
    };
    let next = false;
    await requireOrganization(allowedReq, allowed.response, () => { next = true; });
    assert.equal(next, true);
    assert.equal(String(allowedReq.user.currentOrganization), ORG_A);

    const denied = responseResult();
    const deniedReq = {
      user: { id: user().id, currentOrganization: ORG_B },
      get(name) { return name.toLowerCase() === 'x-organization-id' ? ORG_B : ''; }
    };
    await requireOrganization(deniedReq, denied.response, () => assert.fail('B must not be entered'));
    assert.equal(denied.result.statusCode, 403);

    const fallbackDenied = responseResult();
    const fallbackReq = { user: { id: user().id, currentOrganization: ORG_B }, get() { return ''; } };
    await requireOrganization(fallbackReq, fallbackDenied.response, () => assert.fail('B fallback must not be entered'));
    assert.equal(fallbackDenied.result.statusCode, 403);
  } finally {
    User.findById = originalFindById;
  }
});

test('an authorized header organization replaces the auth-time AI organization context', async () => {
  const originalFindById = User.findById;
  const actor = user();
  actor.currentOrganization = ORG_A;
  actor.recruiterAuthorizedOrganizations = [ORG_A, ORG_B];
  User.findById = async () => actor;
  try {
    const output = responseResult();
    const request = {
      user: { id: actor.id, currentOrganization: ORG_A },
      get(name) { return name.toLowerCase() === 'x-organization-id' ? ORG_B : ''; }
    };
    let meteringContext;
    await runWithAIRequestContext({
      requestId: 'tenant-switch-request',
      organizationId: ORG_A,
      organizationName: 'Organization A'
    }, async () => {
      await requireOrganization(request, output.response, () => {
        meteringContext = getAIRequestContext();
      });
    });
    assert.equal(output.result.statusCode, 200);
    assert.equal(String(request.user.currentOrganization), ORG_B);
    assert.equal(meteringContext.organizationId, ORG_B);
    assert.equal(meteringContext.organizationName, undefined);
  } finally {
    User.findById = originalFindById;
  }
});

test('organization middleware meters with canonical IdP org while retaining the local org for authorization', async () => {
  const originalFindById = User.findById;
  const organization = { _id: ORG_A, idpOrganizationId: 'idp-org-a', name: 'Organization A' };
  const actor = user();
  actor.currentOrganization = organization;
  actor.organizationMemberships = [{ organization, isActive: true, role: 'owner' }];
  actor.recruiterAuthorizedOrganizations = [ORG_A];
  User.findById = async () => actor;
  try {
    const output = responseResult();
    const request = {
      user: { id: actor.id, currentOrganization: ORG_A },
      get(name) { return name.toLowerCase() === 'x-organization-id' ? ORG_A : ''; }
    };
    let meteringContext;
    await runWithAIRequestContext({ requestId: 'canonical-metering-request' }, async () => {
      await requireOrganization(request, output.response, () => {
        meteringContext = getAIRequestContext();
      });
    });
    assert.equal(output.result.statusCode, 200);
    assert.equal(String(request.user.currentOrganization), ORG_A);
    assert.equal(meteringContext.organizationId, 'idp-org-a');
    assert.equal(meteringContext.localOrganizationId, ORG_A);
    assert.equal(meteringContext.organizationName, 'Organization A');
  } finally {
    User.findById = originalFindById;
  }
});

test('organization middleware accepts a populated current organization document', async () => {
  const originalFindById = User.findById;
  const organization = { _id: ORG_A, idpOrganizationId: 'idp-org-a', name: 'Organization A' };
  const actor = user();
  actor.currentOrganization = organization;
  actor.organizationMemberships = [{ organization, isActive: true, role: 'owner' }];
  actor.recruiterAuthorizedOrganizations = [ORG_A];
  User.findById = async () => actor;
  try {
    const output = responseResult();
    const request = {
      user: { id: actor.id, currentOrganization: ORG_A },
      get() { return ''; }
    };
    let next = false;
    await requireOrganization(request, output.response, () => { next = true; });
    assert.equal(output.result.statusCode, 200);
    assert.equal(next, true);
    assert.equal(String(request.user.currentOrganization), ORG_A);
  } finally {
    User.findById = originalFindById;
  }
});

test('switchOrganization rejects an IdP membership whose app access excludes Recruiter', async () => {
  const originalUserFind = User.findById;
  const originalOrgFind = Organization.findById;
  const originalExecute = idpService.executeWithTokenRefresh;
  const actor = user();
  User.findById = () => ({ select: async () => actor });
  Organization.findById = async () => ({
    _id: ORG_B,
    name: 'Performance org',
    idpOrganizationId: 'idp-org-b'
  });
  idpService.executeWithTokenRefresh = async () => [{
    id: 'idp-org-b',
    name: 'Performance org',
    appAccess: { mode: 'selected', appIds: ['performance-management'] }
  }];
  const output = responseResult();
  try {
    await switchOrganization(
      { body: { organizationId: ORG_B }, user: { id: actor.id, currentOrganization: ORG_A } },
      output.response
    );
    assert.equal(output.result.statusCode, 403);
    assert.equal(output.result.body.code, 'RECRUITER_APP_ACCESS_REQUIRED');
  } finally {
    User.findById = originalUserFind;
    Organization.findById = originalOrgFind;
    idpService.executeWithTokenRefresh = originalExecute;
  }
});
