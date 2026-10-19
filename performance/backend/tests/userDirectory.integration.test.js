const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');
const User = require('../models/User');
const routes = require('../routes/user');
let mongo, app, token = true, role = 'owner';
const organizationId = 'fresh-directory-org';
const team = { id: 'product', name: 'Product', organizationId, role: 'member' };
const directory = () => ({ organizationId, organizationRole: role, scope: role === 'owner' ? 'organization' : 'managed_teams', canStartAppraisals: true, teams: [team], members: [{ userId: 'fresh', name: 'New Colleague', email: 'fresh@example.test', organizationRole: 'staff', teams: [team] }], reviewers: [] });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const org = { id: organizationId, role, appAccess: { mode: 'all', appIds: [] } };
    req.session = { currentOrganizationId: organizationId, user: { id: 'manager', sub: 'manager', email: 'manager@example.test', name: 'Manager', organizations: [org], currentOrganization: org, ...(token ? { accessToken: 'synthetic-local-directory-token' } : {}), idpTeams: [{ ...team, role: role === 'staff' ? 'line_manager' : 'member', directReports: ['stale'] }] } };
    next();
  });
  app.use('/user', routes);
});
beforeEach(async () => {
  role = 'owner'; token = true; await mongoose.connection.db.dropDatabase();
  await User.create({ idpSub: 'stale', email: 'stale@example.test', profile: { displayName: 'Stale Colleague' }, currentOrganizationId: organizationId, idpTeams: [team] });
  jest.spyOn(axios, 'get').mockImplementation(async () => ({ data: directory() }));
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test('search and HR selection use current scoped Identity members, including new people', async () => {
  const search = await request(app).get('/user/search?q=Colleague').expect(200);
  expect(search.body.data.map(member => member.id)).toEqual(['fresh']);
  expect(axios.get.mock.calls[0][0]).toMatch(/performance-colleagues$/);
  expect(search.body.data[0]).not.toHaveProperty('teamId');
  const all = await request(app).get('/user/all-employees').expect(200);
  expect(all.body.data.map(member => member.userId)).toEqual(['fresh']);
});
test('valid empty directory cannot revive stale selection or direct-report claims', async () => {
  axios.get.mockResolvedValue({ data: { ...directory(), members: [], reviewers: [] } });
  expect((await request(app).get('/user/search?q=Stale').expect(200)).body.data).toEqual([]);
  expect((await request(app).get('/user/all-employees').expect(200)).body.data).toEqual([]);
  role = 'staff';
  expect((await request(app).get('/user/employees-for-appraisal').expect(200)).body.data.employees).toEqual([]);
});
for (const status of [401, 403, 503]) test(`directory ${status} survives search and selection without fallback`, async () => {
  axios.get.mockRejectedValue({ response: { status } });
  for (const route of ['/user/search?q=Stale', '/user/all-employees', '/user/employees-for-appraisal']) expect((await request(app).get(route).expect(status)).body.success).toBe(false);
});
test('foreign directory cannot add foreign people to search or selection', async () => {
  axios.get.mockResolvedValue({ data: { ...directory(), organizationId: 'foreign-org' } });
  await request(app).get('/user/search?q=Colleague').expect(503);
  expect(await User.countDocuments({ idpSub: 'fresh' })).toBe(0);
});
test('local fixture fallback treats regex syntax as literal search text', async () => {
  token = false;
  await User.create({ idpSub: 'literal', email: 'literal@example.test', profile: { displayName: 'Literal.* Colleague' }, idpTeams: [team] });
  await User.create({ idpSub: 'regex-match', email: 'regex-match@example.test', profile: { displayName: 'LiteralAB Colleague' }, idpTeams: [team] });
  expect((await request(app).get('/user/search?q=Literal.*').expect(200)).body.data.map(person => person.id)).toEqual(['literal']);
});
test('teamless current members never expose cached teams or departments from another organization', async () => {
  await User.create({ idpSub: 'fresh', email: 'fresh@example.test', profile: { displayName: 'Old profile' }, currentOrganizationId: 'foreign-org', idpTeams: [{ id: 'foreign-team', name: 'Private foreign team', organizationId: 'foreign-org', departmentName: 'Private foreign department', role: 'line_manager' }] });
  axios.get.mockResolvedValue({ data: { ...directory(), members: [{ userId: 'fresh', name: 'Fresh teamless member', email: 'fresh@example.test', organizationRole: 'staff', teams: [] }] } });
  const response = await request(app).get('/user/all-employees').expect(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0].teamId).toBe('');
  expect(response.body.data[0].departmentName).toBe('');
  expect(JSON.stringify(response.body)).not.toMatch(/Private foreign/);
});
