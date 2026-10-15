'use strict';

const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const rbac = require('../middleware/rbac');
const goals = require('../services/goalPermissionService');
const AppraisalCycle = require('../models/AppraisalCycle');
const Appraisal = require('../models/Appraisal');
const User = require('../models/User');
const OKR = require('../models/OKR');

let mongo;
let app;
let principal;
let catalog;
let access;
let Policy;
let Account;
const APP = 'performance-management';
const ORG = 'authorization-org';
const validCycle = { name: 'Authorization review', periodStart: '2026-01-01', periodEnd: '2026-12-31' };

async function identity(role = 'staff', { grants = [], denies = [], organizationId = ORG } = {}) {
  const teamRole = ['line_manager', 'team_lead'].includes(role);
  const id = teamRole ? 'manager' : role === 'staff' ? 'ben' : role;
  const member = {
    account: id, role: teamRole ? 'staff' : role, status: 'active', appAccess: { mode: 'all' },
    accessControl: { grants: [{ appId: APP, permissions: grants }], denies: [{ appId: APP, permissions: denies }] }
  };
  const authorization = await access.resolveOrganizationAuthorization({
    account: { _id: id, teams: teamRole ? [{ organization: organizationId, role }] : [] },
    organization: { _id: organizationId, members: [member] },
    policy: { revision: 4, roles: catalog.DEFAULT_ACCESS_ROLES }
  });
  const organization = { id: organizationId, role: member.role, appAccess: member.appAccess, authorization };
  return {
    id, sub: id, name: id, email: `${id}@example.test`, organizations: [organization], currentOrganization: organization,
    idpTeams: [{ id: 'team-a', organizationId, role: teamRole ? role : 'member', directReports: teamRole ? ['ada'] : [] }]
  };
}

function goalRequest(user) {
  return { session: { user }, userRole: rbac.getUserRole(user), currentOrganization: user.currentOrganization,
    directReports: rbac.getDirectReports(user), managedTeams: rbac.getManagedTeams(user), userTeams: user.idpTeams };
}

before(async () => {
  catalog = await import('../../../Identityprovider/src/config/accessControlCatalog.js');
  access = await import('../../../Identityprovider/src/services/accessControlService.js');
  ({ AccessControlPolicy: Policy } = await import('../../../Identityprovider/src/models/AccessControlPolicy.js'));
  ({ Account } = await import('../../../Identityprovider/src/models/Account.js'));
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri('performance_authorization_test'));
  await Policy.db.openUri(mongo.getUri('identity_authorization_test'));
  await Policy.createCollection();
  await Policy.init();
  await Account.createCollection();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: principal, currentOrganizationId: principal.currentOrganization.id }; next(); });
  app.use('/appraisals', require('../routes/appraisals'));
  app.use('/analytics', require('../routes/analytics'));
  app.use('/okrs', require('../routes/okrs'));
});

beforeEach(async () => {
  await Promise.all([AppraisalCycle.deleteMany({}), Appraisal.deleteMany({}), User.deleteMany({}), OKR.deleteMany({})]);
  await User.collection.insertMany([
    { idpSub: 'ada', email: 'ada@example.test', currentOrganizationId: ORG, idpTeams: [{ id: 'team-a', organizationId: ORG, role: 'member' }] },
    { idpSub: 'eli', email: 'eli@example.test', currentOrganizationId: ORG, idpTeams: [{ id: 'team-b', organizationId: ORG, role: 'member' }] }
  ]);
  principal = await identity();
});

after(async () => {
  await mongoose.disconnect();
  if (Policy) await Policy.db.close();
  if (mongo) await mongo.stop();
});

test('actual IdP staff matrix forbids peer goal read/edit/assign/decide/check-in', async () => {
  const req = goalRequest(principal);
  const goal = { ownerId: 'ada', organizationId: ORG, type: 'individual', lifecycle: { state: 'draft' } };
  for (const check of [goals.canViewGoal, goals.canEditGoal, goals.canDecideGoal, goals.canCheckInGoal]) assert.equal(check(req, goal), false, check.name);
  assert.equal(goals.canAssignGoal(req, { ownerId: 'ada' }), false);
  assert.equal(goals.canAssignGoal(req, { ownerId: 'ben' }), true);
  assert.equal(goals.canViewGoal(req, { ...goal, ownerId: 'ben' }), true);
});

for (const role of ['line_manager', 'team_lead']) {
  test(`${role} IdP matrix permits direct-report goal actions but not another team`, async () => {
    const req = goalRequest(await identity(role));
    for (const check of [goals.canViewGoal, goals.canEditGoal, goals.canDecideGoal, goals.canCheckInGoal]) {
      assert.equal(check(req, { ownerId: 'ada', organizationId: ORG, type: 'individual', lifecycle: { state: 'draft' } }), true, check.name);
      assert.equal(check(req, { ownerId: 'eli', organizationId: ORG, type: 'individual', lifecycle: { state: 'draft' } }), false, check.name);
      assert.equal(check(req, { ownerId: 'ada', organizationId: 'other-org', type: 'individual' }), false, check.name);
    }
    assert.equal(goals.canAssignGoal(req, { ownerId: 'ada' }), true);
    assert.equal(goals.canAssignGoal(req, { ownerId: 'eli' }), false);
  });
}

test('staff peer goal HTTP requests fail with the actual IdP matrix and leave data unchanged', async () => {
  const id = new mongoose.Types.ObjectId();
  await OKR.collection.insertOne({ _id: id, organizationId: ORG, ownerId: 'ada', type: 'individual',
    title: 'Ada goal', status: 'active', lifecycle: { state: 'active' }, objectives: [] });
  const before = await OKR.collection.findOne({ _id: id });
  assert.equal((await request(app).get(`/okrs/${id}`)).status, 403);
  assert.equal((await request(app).put(`/okrs/${id}`).send({ title: 'Unauthorized edit' })).status, 403);
  assert.equal((await request(app).post(`/okrs/${id}/decision`).send({ decision: 'approve' })).status, 403);
  assert.equal((await request(app).post(`/okrs/${id}/check-ins`).send({ summary: 'Unauthorized check-in' })).status, 403);
  assert.equal((await request(app).post('/okrs').send({ ownerId: 'ada', title: 'Unauthorized assignment', type: 'individual' })).status, 403);
  assert.deepEqual(await OKR.collection.findOne({ _id: id }), before);
  principal = await identity('owner', { organizationId: 'other-org' });
  assert.equal((await request(app).get(`/okrs/${id}`)).status, 404);
});

test('explicit delegated goal decision is honored and explicit deny beats HR role', async () => {
  const goal = { ownerId: 'ada', organizationId: ORG, type: 'individual' };
  assert.equal(goals.canDecideGoal(goalRequest(await identity('staff', { grants: ['okr:decide:all'] })), goal), true);
  const req = goalRequest(await identity('hr_manager', { denies: ['okr:decide:all', 'okr:decide:direct_reports'] }));
  assert.equal(goals.canDecideGoal(req, goal), false);
});

test('valid staff cycle request returns 403 before persistence and analytics reads do not grant writes', async () => {
  for (const grants of [[], ['analytics:view:organization'], ['review:conduct:direct_reports']]) {
    principal = await identity('staff', { grants });
    const response = await request(app).post('/appraisals/cycles').send(validCycle);
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.code, 'PERMISSION_DENIED');
    assert.equal(await AppraisalCycle.countDocuments(), 0);
  }
});

for (const role of ['line_manager', 'team_lead']) {
  test(`${role} may create/update assigned-team cycles only`, async () => {
    principal = await identity(role);
    for (const scope of [undefined, { type: 'organization' }, { type: 'team', targetIds: [] }, { type: 'team', targetIds: ['team-b'] }]) {
      const response = await request(app).post('/appraisals/cycles').send({ ...validCycle, scope });
      assert.equal(response.status, 403, JSON.stringify(response.body));
    }
    const created = await request(app).post('/appraisals/cycles').send({ ...validCycle, scope: { type: 'team', targetIds: ['team-a'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data._id;
    assert.equal((await request(app).put(`/appraisals/cycles/${id}`).send({ name: 'Updated team review' })).status, 200);
    assert.equal((await request(app).put(`/appraisals/cycles/${id}`).send({ scope: { type: 'organization' } })).status, 403);
    principal.idpTeams = [{ id: 'team-b', organizationId: ORG, role }];
    assert.equal((await request(app).put(`/appraisals/cycles/${id}`).send({ name: 'Stale owner' })).status, 403);
  });
}

for (const role of ['hr_manager', 'admin', 'owner']) {
  test(`${role} may create organization cycles but matrix denies override role`, async () => {
    principal = await identity(role);
    const response = await request(app).post('/appraisals/cycles').send(validCycle);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    principal = await identity(role, { denies: ['review_cycle:create', 'review_cycle:create:team'] });
    assert.equal((await request(app).post('/appraisals/cycles').send(validCycle)).status, 403);
    principal = await identity(role, { denies: ['review_cycle:create'] });
    assert.equal((await request(app).post('/appraisals/cycles').send({ ...validCycle, scope: { type: 'team', targetIds: ['team-a'] } })).status, 403);
  });
}

test('explicit organization cycle delegation works without pretending employee is HR', async () => {
  principal = await identity('staff', { grants: ['review_cycle:create', 'review_cycle:manage'] });
  const created = await request(app).post('/appraisals/cycles').send(validCycle);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await request(app).put(`/appraisals/cycles/${created.body.data._id}`).send({ name: 'Delegated update' })).status, 200);
});

test('team-scoped delegation never turns a staff member into an organization cycle writer', async () => {
  principal = await identity('staff', { grants: ['review_cycle:create:team', 'review_cycle:manage:team'] });
  assert.equal((await request(app).post('/appraisals/cycles').send(validCycle)).status, 403);
  assert.equal(await AppraisalCycle.countDocuments(), 0);
});

test('team create-and-launch rejects spoofed employee team before creating a cycle', async () => {
  principal = await identity('line_manager');
  const response = await request(app).post('/appraisals/cycles').send({ ...validCycle, launchNow: true,
    scope: { type: 'team', targetIds: ['team-a'] },
    employees: [{ userId: 'eli', email: 'eli@example.test', name: 'Eli', teamId: 'team-a' }] });
  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.equal(await AppraisalCycle.countDocuments(), 0);
  assert.equal(await Appraisal.countDocuments(), 0);
});

for (const role of ['line_manager', 'team_lead']) {
  test(`${role} launches a legitimate assigned-team appraisal with an actual IdP matrix`, async () => {
    principal = await identity(role);
    const created = await request(app).post('/appraisals/cycles').send({ ...validCycle, scope: { type: 'team', targetIds: ['team-a'] } });
    assert.equal(created.status, 201);
    const response = await request(app).post(`/appraisals/cycles/${created.body.data._id}/launch`).send({
      employees: [{ userId: 'ada', name: 'Ada', email: 'ada@example.test', teamId: 'team-a',
        managerId: 'manager', managerName: 'Manager', managerEmail: 'manager@example.test' }]
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.launched, 1);
    assert.equal(await Appraisal.countDocuments({ 'employee.userId': 'ada' }), 1);
  });
}

test('both launch routes reject outside subjects even when paired with an in-scope email', async () => {
  principal = await identity('line_manager');
  const created = await request(app).post('/appraisals/cycles').send({ ...validCycle, scope: { type: 'team', targetIds: ['team-a'] } });
  for (const path of ['launch', 'launch-for-team']) {
    const response = await request(app).post(`/appraisals/cycles/${created.body.data._id}/${path}`).send({
      employees: [{ userId: 'eli', name: 'Eli', email: 'ada@example.test', teamId: 'team-a' }]
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
  }
  assert.equal(await Appraisal.countDocuments(), 0);
});

test('cycle manage and launch gates honor explicit denies with valid requests', async () => {
  principal = await identity('hr_manager');
  const response = await request(app).post('/appraisals/cycles').send(validCycle);
  const id = response.body.data._id;
  for (const role of ['staff', 'line_manager', 'hr_manager']) {
    principal = await identity(role, { denies: ['review_cycle:manage', 'review_cycle:manage:team'] });
    assert.equal((await request(app).put(`/appraisals/cycles/${id}`).send({ name: 'Forbidden' })).status, 403);
    for (const path of ['launch', 'launch-for-team']) {
      assert.equal((await request(app).post(`/appraisals/cycles/${id}/${path}`).send({ employees: [{ userId: 'ada', name: 'Ada', email: 'ada@example.test' }] })).status, 403);
    }
  }
  assert.equal(await Appraisal.countDocuments(), 0);
});

test('staff reports are forbidden; personal dashboard remains self-service', async () => {
  assert.equal((await request(app).get('/analytics/performance')).status, 403);
  assert.equal((await request(app).get('/analytics/team/team-a')).status, 403);
  assert.equal((await request(app).get('/analytics/dashboard')).status, 200);
});

test('report permissions, not role or review permission, control analytics', async () => {
  for (const role of ['line_manager', 'team_lead', 'hr_manager']) {
    principal = await identity(role);
    const response = await request(app).get('/analytics/performance');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.scope.organization, role === 'hr_manager');
    principal = await identity(role, { denies: ['analytics:view:team', 'analytics:view:direct_reports', 'analytics:view:organization'] });
    assert.equal((await request(app).get('/analytics/performance')).status, 403);
  }
  principal = await identity('staff', { grants: ['analytics:view:organization'] });
  assert.equal((await request(app).get('/analytics/performance')).body.data.scope.organization, true);
  principal = await identity('staff', { grants: ['review:conduct:direct_reports'] });
  assert.equal((await request(app).get('/analytics/performance')).status, 403);
});

test('analytics scope follows matrix when an HR role has organization analytics denied', async () => {
  await Appraisal.collection.insertMany(['ada', 'eli'].map((userId) => ({
    organizationId: ORG, cycleId: new mongoose.Types.ObjectId(), status: 'not_started', employee: { userId, teamId: userId === 'ada' ? 'team-a' : 'team-b' }
  })));
  principal = await identity('line_manager');
  const managerResponse = await request(app).get('/analytics/performance');
  assert.equal(managerResponse.body.data.summary.participants, 1);
  assert.equal((await request(app).get('/analytics/performance?teamId=team-b')).status, 403);
  principal = await identity('hr_manager', { denies: ['analytics:view:organization'] });
  const response = await request(app).get('/analytics/performance');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.scope.organization, false);
  assert.equal(response.body.data.summary.participants, 0);
  principal = await identity('hr_manager');
  assert.equal((await request(app).get('/analytics/performance')).body.data.summary.participants, 2);
  principal = await identity('owner', { organizationId: 'other-org' });
  assert.equal((await request(app).get('/analytics/performance')).body.data.summary.participants, 0);
});

test('stored policy migration is atomic, concurrent-safe and invalidates account authorization once', async () => {
  await Policy.deleteMany({});
  await Account.collection.deleteMany({});
  await Account.collection.insertOne({ authorizationRevision: 9 });
  const oldPermissions = catalog.getKnownPermissionIds(APP).filter((token) => ![
    'review_cycle:create:team', 'review_cycle:manage:team', ...catalog.MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS[APP]
  ].includes(token));
  const roles = catalog.DEFAULT_ACCESS_ROLES.map((role) => role.key === 'employee' ? {
    ...role, grants: [{ appId: APP, permissions: oldPermissions }, { appId: 'messaging', permissions: ['messages.read'] }]
  } : role);
  await Policy.create({ key: 'global', schemaVersion: 3, revision: 17, roles });
  const results = await Promise.all(Array.from({ length: 6 }, () => access.getOrCreateGlobalAccessPolicy()));
  assert.ok(results.every((policy) => policy.schemaVersion === 4 && policy.revision === 18));
  const migrated = await Policy.findOne({ key: 'global' }).lean();
  const employee = migrated.roles.find((role) => role.key === 'employee');
  assert.ok(!employee.grants.find((row) => row.appId === APP).permissions.includes('okr:decide:all'));
  assert.deepEqual(employee.grants.find((row) => row.appId === 'messaging').permissions, ['messages.read']);
  assert.equal((await Account.collection.findOne({})).authorizationRevision, 10);
  assert.equal((await access.getOrCreateGlobalAccessPolicy()).revision, 18);
  assert.equal((await Account.collection.findOne({})).authorizationRevision, 10);
});

test('failed authorization revision invalidation rolls back policy migration', async () => {
  await Policy.updateOne({ key: 'global' }, { $set: { schemaVersion: 3, revision: 20 } });
  const updateMany = Account.updateMany;
  Account.updateMany = async () => { throw new Error('invalidation unavailable'); };
  try {
    await assert.rejects(access.getOrCreateGlobalAccessPolicy(), /invalidation unavailable/);
  } finally {
    Account.updateMany = updateMany;
  }
  const policy = await Policy.findOne({ key: 'global' });
  assert.equal(policy.schemaVersion, 3);
  assert.equal(policy.revision, 20);
  assert.equal((await access.getOrCreateGlobalAccessPolicy()).revision, 21);
});
