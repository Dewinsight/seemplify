'use strict';
const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const APP = 'performance-management', ORG = 'analytics-access-org';
let mongo, app, principal, catalog, access;
async function identity(role = 'staff', { grants = [], denies = [], organizationId = ORG } = {}) {
  const managed = ['line_manager', 'team_lead'].includes(role), id = managed ? 'manager' : role === 'staff' ? 'employee' : role;
  const member = { account: id, role: managed ? 'staff' : role, status: 'active', appAccess: { mode: 'all' }, accessControl: { grants: [{ appId: APP, permissions: grants }], denies: [{ appId: APP, permissions: denies }] } };
  const authorization = await access.resolveOrganizationAuthorization({ account: { _id: id, teams: managed ? [{ organization: organizationId, role }] : [] }, organization: { _id: organizationId, members: [member] }, policy: { schemaVersion: catalog.ACCESS_CONTROL_SCHEMA_VERSION, revision: 1, roles: catalog.DEFAULT_ACCESS_ROLES } });
  const organization = { id: organizationId, role: member.role, appAccess: member.appAccess, authorization };
  return { id, sub: id, name: id, email: `${id}@example.test`, organizations: [organization], currentOrganization: organization, idpTeams: [{ id: 'team-a', organizationId, role: managed ? role : 'member', directReports: managed ? ['employee'] : [] }] };
}
before(async () => {
  catalog = await import('../../../Identityprovider/src/config/accessControlCatalog.js');
  access = await import('../../../Identityprovider/src/services/accessControlService.js');
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: principal, currentOrganizationId: principal.currentOrganization.id }; next(); });
  app.use('/analytics', require('../routes/analytics'));
});
beforeEach(async () => {
  await Appraisal.deleteMany({}); principal = await identity();
  await Appraisal.collection.insertMany(['employee', 'other'].map((userId) => ({ organizationId: ORG, cycleId: new mongoose.Types.ObjectId(), status: 'not_started', employee: { userId, teamId: userId === 'employee' ? 'team-a' : 'team-b' } })));
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test('staff cannot read team/organization analytics; personal dashboard remains available', async () => {
  assert.equal((await request(app).get('/analytics/performance')).status, 403);
  assert.equal((await request(app).get('/analytics/team/team-a')).status, 403);
  assert.equal((await request(app).get('/analytics/dashboard')).status, 200);
});
for (const role of ['line_manager', 'team_lead', 'hr_manager']) test(`${role} analytics respects canonical grants and explicit denies`, async () => {
  principal = await identity(role);
  const allowed = await request(app).get('/analytics/performance');
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(allowed.body.data.scope.organization, role === 'hr_manager');
  principal = await identity(role, { denies: ['analytics:view:team', 'analytics:view:direct_reports', 'analytics:view:organization'] });
  assert.equal((await request(app).get('/analytics/performance')).status, 403);
  assert.equal((await request(app).get('/analytics/team/team-a')).status, 403);
});
test('review-only permission does not imply report access; explicit organization analytics grant does', async () => {
  principal = await identity('staff', { grants: ['review:conduct:direct_reports'] });
  assert.equal((await request(app).get('/analytics/performance')).status, 403);
  principal = await identity('staff', { grants: ['analytics:view:organization'] });
  const response = await request(app).get('/analytics/performance');
  assert.equal(response.status, 200); assert.equal(response.body.data.scope.organization, true);
  assert.equal(response.body.data.summary.participants, 2);
});
test('resource scope survives role labels, denied organization access and cross-tenant requests', async () => {
  principal = await identity('line_manager');
  assert.equal((await request(app).get('/analytics/performance')).body.data.summary.participants, 1);
  assert.equal((await request(app).get('/analytics/performance?teamId=team-b')).status, 403);
  principal = await identity('hr_manager', { denies: ['analytics:view:organization'] });
  const restricted = await request(app).get('/analytics/performance');
  assert.equal(restricted.status, 200); assert.equal(restricted.body.data.scope.organization, false);
  assert.equal(restricted.body.data.summary.participants, 0);
  principal = await identity('owner', { organizationId: 'foreign-org' });
  assert.equal((await request(app).get('/analytics/performance')).body.data.summary.participants, 0);
});
test('own-team membership alone cannot expand an explicit analytics grant into managed-team access', async () => {
  principal = await identity('staff', { grants: ['analytics:view:team'] });
  assert.equal((await request(app).get('/analytics/team/team-a')).status, 403);
});
test('explicit denial of every analytics action also blocks personal dashboard', async () => {
  principal = await identity('owner', { denies: ['analytics:view:own', 'analytics:view:team', 'analytics:view:direct_reports', 'analytics:view:organization'] });
  assert.equal((await request(app).get('/analytics/dashboard')).status, 403);
});