const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const CheckIn = require('../models/PerformanceCheckIn');
const SuccessionPlan = require('../models/SuccessionPlan');
const ORG = 'check-in-hierarchy-org';
const teams = {
  parent: { id: 'parent-team', departmentId: 'dept-a' },
  lead: { id: 'child-team', parentTeamId: 'parent-team', departmentId: 'dept-a' },
  employee: { id: 'grandchild-team', parentTeamId: 'child-team', departmentId: 'dept-a' },
  sibling: { id: 'department-sibling', departmentId: 'dept-a' },
  unmanaged: { id: 'other-department', departmentId: 'dept-b' }
};
function principal(actor, org = ORG) {
  const identity = actor.replace(/-(denied|delegated|stale)$/, '');
  const organization = { id: org, role: identity === 'hr' ? 'hr_manager' : 'employee', appAccess: { mode: 'all', appIds: [] },
    ...(identity === 'head' ? { departmentHeadPermissions: [{ id: 'dept-a' }] } : {}),
    ...(actor.endsWith('-denied') ? { authorization: { permissionsByApp: { 'performance-management': [] } } } : {}) };
  const team = teams[identity] || teams.unmanaged;
  return { id: identity, sub: identity, email: `${identity}@example.test`, currentOrganization: organization, organizations: [organization],
    idpTeams: [{ ...team, organizationId: org, name: team.id,
      role: identity === 'parent' ? 'line_manager' : identity === 'lead' ? 'team_lead' : 'member',
      ...(actor.endsWith('-stale') ? { directReports: ['unmanaged', 'foreign', 'nonexistent'] } : {}) }],
    ...(actor.endsWith('-delegated') ? { accessToken: 'synthetic-delegated-directory-token' } : {}) };
}
let mongo, app;
const call = (method, path, actor = 'parent', org = ORG) => request(app)[method](path).set('x-check-actor', actor).set('x-check-org', org);
const payload = (employeeId = 'lead') => ({ employeeId, cadence: 'ad_hoc', periodStart: '2026-10-01', periodEnd: '2026-10-07', wins: ['A wholly synthetic update'] });
const row = (employeeId = 'lead', visibility = 'employee_manager', organizationId = ORG) =>
  CheckIn.create({ ...payload(employeeId), organizationId, authorId: employeeId, visibility });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => {
    const actor = req.get('x-check-actor') || 'parent';
    if (actor !== 'logged-out') req.session = { user: principal(actor, req.get('x-check-org') || ORG), currentOrganizationId: req.get('x-check-org') || ORG };
    next();
  });
  app.use('/check-ins', require('../routes/checkIns')); app.use('/talent', require('../routes/talent'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  for (const actor of ['parent', 'lead', 'employee', 'sibling', 'unmanaged', 'head', 'hr', 'foreign']) {
    const user = principal(actor, actor === 'foreign' ? 'foreign-org' : ORG);
    await User.create({ idpSub: user.id, email: user.email, currentOrganizationId: user.currentOrganization.id, idpTeams: user.idpTeams });
  }
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test.each(['parent', 'head'])('%s reads and responds to real descendants without directReports claims', async actor => {
  const item = await row();
  const listed = await call('get', '/check-ins?employeeId=lead', actor).expect(200);
  expect(listed.body.data.map(value => value._id)).toEqual([String(item._id)]);
  await call('patch', `/check-ins/${item._id}`, actor).send({ managerResponse: 'Reviewed descendant progress', wins: ['Cannot replace staff update'] }).expect(200);
  const loaded = await call('get', '/check-ins', 'lead').expect(200);
  expect(loaded.body.data[0]).toMatchObject({ wins: payload().wins, managerResponse: { text: 'Reviewed descendant progress', authorId: actor } });
  expect((await CheckIn.findById(item._id)).audit.at(-1)).toMatchObject({ action: 'manager_responded', actorId: actor });
  await call('post', `/check-ins/${item._id}/submit`, actor).send({}).expect(403);
});
test('parent manages deeper descendants; department head also manages sibling teams', async () => {
  await row('employee'); await row('sibling');
  await call('get', '/check-ins?employeeId=employee').expect(200);
  await call('get', '/check-ins?employeeId=sibling').expect(403);
  await call('get', '/check-ins?employeeId=sibling', 'head').expect(200);
  const created = await call('post', '/check-ins').send(payload('employee')).expect(201);
  expect(created.body.data).toMatchObject({ employeeId: 'employee', authorId: 'parent' });
});
test('employee-only notes remain owner/HR-only, including mutation by known ID', async () => {
  const item = await row('lead', 'employee_only'); const before = JSON.parse(JSON.stringify(item));
  for (const actor of ['parent', 'head']) {
    expect((await call('get', '/check-ins?employeeId=lead', actor).expect(200)).body.data).toEqual([]);
    await call('patch', `/check-ins/${item._id}`, actor).send({ managerResponse: 'Private note intrusion' }).expect(403);
  }
  expect(JSON.parse(JSON.stringify(await CheckIn.findById(item._id)))).toEqual(before);
  expect((await call('get', '/check-ins', 'lead').expect(200)).body.data).toHaveLength(1);
  expect((await call('get', '/check-ins?employeeId=lead', 'hr').expect(200)).body.data).toHaveLength(1);
});
test('stale claims do not authorize unmanaged, foreign or nonexistent staff', async () => {
  for (const target of ['unmanaged', 'foreign', 'nonexistent']) {
    const item = await row(target, 'employee_manager', target === 'foreign' ? 'foreign-org' : ORG);
    await call('get', `/check-ins?employeeId=${target}`, 'parent-stale').expect(403);
    await call('post', '/check-ins', 'parent-stale').send(payload(target)).expect(403);
    await call('patch', `/check-ins/${item._id}`, 'parent-stale').send({ managerResponse: 'Forbidden' }).expect(403);
  }
  await call('post', '/check-ins', 'hr').send(payload('foreign')).expect(403);
  expect(await CheckIn.countDocuments()).toBe(3);
});
test.each(['parent-denied', 'hr-denied'])('%s explicit denial blocks staff access but preserves own draft and submission', async actor => {
  const item = await row();
  await call('get', '/check-ins?employeeId=lead', actor).expect(403);
  await call('post', '/check-ins', actor).send(payload()).expect(403);
  await call('patch', `/check-ins/${item._id}`, actor).send({ managerResponse: 'Denied' }).expect(403);
  const ownId = actor.startsWith('parent') ? 'parent' : 'hr';
  const created = await call('post', '/check-ins', actor).send(payload(ownId)).expect(201);
  await call('patch', `/check-ins/${created.body.data._id}`, actor).send({ wins: ['Own revised progress'] }).expect(200);
  await call('post', `/check-ins/${created.body.data._id}/submit`, actor).send({}).expect(200);
  await call('patch', `/check-ins/${created.body.data._id}`, actor).send({ wins: ['Cannot replace submitted progress'] }).expect(409);
});
test('delegated directory outage returns actionable503 without stale fallback or write', async () => {
  const item = await row(); const before = JSON.parse(JSON.stringify(item));
  jest.spyOn(axios, 'get').mockRejectedValue(new Error('Named synthetic directory transport outage'));
  const failed = await call('get', '/check-ins?employeeId=lead', 'parent-delegated').expect(503);
  expect(failed.body.error).toMatch(/refresh people and teams/);
  await call('patch', `/check-ins/${item._id}`, 'parent-delegated').send({ managerResponse: 'Must not persist' }).expect(503);
  expect(JSON.parse(JSON.stringify(await CheckIn.findById(item._id)))).toEqual(before);
  await call('get', '/check-ins', 'logged-out').expect(401);
});
test.each(['confirmed', 'removed'])('closed succession slate rejects %s without changing history or audit', async state => {
  const plan = await SuccessionPlan.create({ organizationId: ORG, role: { title: 'Synthetic specialist' }, state: 'closed', ownerId: 'hr',
    candidates: [{ employee: { userId: 'employee', name: 'Synthetic employee' }, readiness: 'ready_now', rationale: 'Original evidence-backed synthetic rationale', nominatedBy: 'hr' }],
    audit: [{ action: 'created', actorId: 'hr' }] });
  const before = JSON.parse(JSON.stringify(plan));
  const path = `/talent/succession-plans/${plan._id}/candidates/${plan.candidates[0]._id}`;
  await call('patch', path, 'hr').send({ state }).expect(409);
  expect(JSON.parse(JSON.stringify(await SuccessionPlan.findById(plan._id)))).toEqual(before);
  await call('patch', `/talent/succession-plans/${plan._id}`, 'hr').send({ state: 'active' }).expect(200);
  await call('patch', path, 'hr').send({ state }).expect(200);
  expect((await SuccessionPlan.findById(plan._id)).candidates[0]).toMatchObject({ state, confirmedBy: 'hr', rationale: before.candidates[0].rationale });
});
