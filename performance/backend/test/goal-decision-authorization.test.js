'use strict';
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const OKR = require('../models/OKR');
const APP = 'performance-management', ORG = 'goal-decision-access-org';
let mongo, app, principal, catalog, access;

async function identity({ role = 'staff', grants = [], denies = [], organizationId = ORG, managed = false } = {}) {
  const id = 'decision-actor';
  const member = { account: id, role, status: 'active', appAccess: { mode: 'all' },
    accessControl: { grants: [{ appId: APP, permissions: grants }], denies: [{ appId: APP, permissions: denies }] } };
  const authorization = await access.resolveOrganizationAuthorization({
    account: { _id: id, teams: managed ? [{ organization: organizationId, role: 'line_manager' }] : [] },
    organization: { _id: organizationId, members: [member] },
    policy: { schemaVersion: catalog.ACCESS_CONTROL_SCHEMA_VERSION, revision: 1, roles: catalog.DEFAULT_ACCESS_ROLES }
  });
  const organization = { id: organizationId, role, appAccess: member.appAccess, authorization };
  return { id, sub: id, name: 'Synthetic decision actor', email: 'decision-actor@example.test', organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: 'team-a', organizationId, role: managed ? 'line_manager' : 'member', directReports: managed ? ['direct-employee'] : [] }] };
}

async function goal(fields = {}) {
  return OKR.create({ organizationId: ORG, ownerId: 'unrelated-employee', type: 'individual', period: 'Synthetic QA',
    title: 'Synthetic pending goal', status: 'pending', approvalStatus: 'pending', lifecycle: { state: 'pending_approval' }, ...fields });
}
const endpoints = [
  { label: 'decision', method: 'post', suffix: 'decision', body: { decision: 'approve', comment: 'Synthetic approval' } },
  { label: 'legacy approve', method: 'patch', suffix: 'approve', body: {} }
];
const decide = (endpoint, record) => request(app)[endpoint.method](`/okrs/${record._id}/${endpoint.suffix}`).send(endpoint.body);

before(async () => {
  catalog = await import('../../../Identityprovider/src/config/accessControlCatalog.js');
  access = await import('../../../Identityprovider/src/services/accessControlService.js');
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await OKR.init();
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = principal ? { user: principal, currentOrganizationId: principal.currentOrganization.id } : {}; next(); });
  app.use('/okrs', require('../routes/okrs'));
});
beforeEach(async () => { await OKR.deleteMany({}); principal = await identity(); });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

for (const endpoint of endpoints) {
  test(`${endpoint.label} honors an explicit all-only decision grant without a manager role`, async () => {
    principal = await identity({ grants: ['okr:decide:all'] });
    const permissions = principal.currentOrganization.authorization.permissionsByApp[APP];
    assert.equal(permissions.includes('okr:decide:all'), true);
    assert.equal(permissions.includes('okr:decide:direct_reports'), false);
    const record = await goal();
    const response = await decide(endpoint, record);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const saved = await OKR.findById(record._id).lean();
    assert.equal(saved.approvalStatus, 'approved'); assert.equal(saved.lifecycle.state, 'active');
    assert.equal(saved.approvedBy, principal.id); assert.equal(saved.lifecycle.decidedBy.userId, principal.id);
  });

  test(`${endpoint.label} rejects explicit deny, self-approval and cross-tenant goals without changing them`, async () => {
    for (const scenario of ['denied', 'self', 'foreign', 'ungranted']) {
      principal = await identity({ grants: scenario === 'ungranted' ? [] : ['okr:decide:all'], denies: scenario === 'denied' ? ['okr:decide:all'] : [] });
      const record = await goal({ ...(scenario === 'self' ? { ownerId: principal.id } : {}), ...(scenario === 'foreign' ? { organizationId: 'foreign-org' } : {}) });
      const original = await OKR.findById(record._id).lean();
      const response = await decide(endpoint, record);
      assert.equal(response.status, scenario === 'foreign' ? 404 : 403, `${scenario}: ${JSON.stringify(response.body)}`);
      assert.deepEqual(await OKR.findById(record._id).lean(), original);
    }
  });

  test(`${endpoint.label} retains direct-report scope and cannot turn an unrelated employee into a report`, async () => {
    principal = await identity({ managed: true, denies: ['okr:decide:all'] });
    const allowed = await goal({ ownerId: 'direct-employee' });
    assert.equal((await decide(endpoint, allowed)).status, 200);
    const outside = await goal();
    const original = await OKR.findById(outside._id).lean();
    assert.equal((await decide(endpoint, outside)).status, 403);
    assert.deepEqual(await OKR.findById(outside._id).lean(), original);
  });
}

test('an all-only grant does not bypass pending-state validation or authenticate an anonymous caller', async () => {
  principal = await identity({ grants: ['okr:decide:all'] });
  const active = await goal({ status: 'active', approvalStatus: 'approved', lifecycle: { state: 'active' } });
  const original = await OKR.findById(active._id).lean();
  assert.equal((await decide(endpoints[0], active)).status, 409);
  assert.deepEqual(await OKR.findById(active._id).lean(), original);
  principal = null;
  assert.equal((await decide(endpoints[0], active)).status, 401);
  assert.equal((await decide(endpoints[1], active)).status, 401);
});
