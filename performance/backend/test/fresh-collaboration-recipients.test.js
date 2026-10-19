'use strict';
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Recognition = require('../models/Recognition');
const Feedback = require('../models/Feedback');
const FeedbackRequest = require('../models/FeedbackRequest');
const { requireAuth } = require('../middleware/rbac');
const { requireOrganization } = require('../services/tenantPolicy');
const ORG = 'fresh-collaboration-org', APP = 'performance-management';
let mongo, app, principal, organization, catalog, access, build, originalGet, liveDenies, upstreamStatus;
async function authorization(denies = []) {
  return access.resolveOrganizationAuthorization({ account: organization.members[0].account, organization,
    member: { ...organization.members[0], accessControl: { denies: [{ appId: APP, permissions: denies }] } },
    policy: { schemaVersion: catalog.ACCESS_CONTROL_SCHEMA_VERSION, revision: 1, roles: catalog.DEFAULT_ACCESS_ROLES } });
}
const post = (kind, fields = {}) => kind === 'recognition'
  ? request(app).post('/recognition').send({ recipient: { userId: 'sub-new', name: 'Forged name', email: 'forged@elsewhere.test', teamId: 'forged-team' }, message: 'Synthetic recognition evidence', visibility: 'private', ...fields })
  : kind === 'feedback'
    ? request(app).post('/feedback').send({ receiverId: 'sub-new', receiverName: 'Forged name', receiverEmail: 'forged@elsewhere.test', content: 'Synthetic useful feedback', ...fields })
    : request(app).post('/feedback/requests').send({ reviewerIds: ['sub-new'], dueDate: new Date(Date.now() + 86400000).toISOString(), questions: ['Synthetic question'], ...fields });

before(async () => {
  catalog = await import('../../../Identityprovider/src/config/accessControlCatalog.js');
  access = await import('../../../Identityprovider/src/services/accessControlService.js');
  ({ buildPerformanceColleagues: build } = await import('../../../Identityprovider/src/utils/performanceColleagues.js'));
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: principal, currentOrganizationId: ORG }; next(); });
  app.use(requireAuth, requireOrganization);
  app.use('/user', require('../routes/user'));
  app.use('/recognition', require('../routes/recognition'));
  app.use('/feedback', require('../routes/feedback'));
  originalGet = axios.get;
  axios.get = async (url, options) => {
    assert.match(url, /\/performance-colleagues$/);
    assert.equal(options.headers.Authorization, 'Bearer verified-fresh-fixture');
    if (upstreamStatus) throw { response: { status: upstreamStatus } };
    try { return { data: build({ organization, actorId: 'actor', authorization: await authorization(liveDenies), ...options.params }) }; }
    catch (error) { throw { response: { status: error.status || 503 } }; }
  };
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase(); liveDenies = []; upstreamStatus = null;
  organization = { _id: ORG, owner: 'owner', members: [
    { account: { _id: 'actor', sub: 'sub-actor', email: 'actor@example.test', profile: { name: 'Fresh actor' } }, role: 'staff', status: 'active', appAccess: { mode: 'all' } },
    { account: { _id: 'new', sub: 'sub-new', email: 'new@example.test', profile: { name: 'Fresh never-logged-in colleague' } }, role: 'staff', status: 'active', appAccess: { mode: 'all' } }
  ] };
  const org = { id: ORG, role: 'staff', appAccess: { mode: 'all' }, authorization: await authorization() };
  principal = { id: 'sub-actor', sub: 'sub-actor', name: 'Fresh actor', email: 'actor@example.test', organizations: [org], currentOrganization: org, accessToken: 'verified-fresh-fixture' };
});
after(async () => { axios.get = originalGet; await mongoose.disconnect(); if (mongo) await mongo.stop(); });

for (const kind of ['recognition', 'feedback', 'request']) test(`fresh IdP discovery to ${kind} succeeds without first login or a local User and uses canonical labels`, async () => {
  const search = await request(app).get('/user/search?q=never-logged-in').expect(200);
  assert.equal(search.body.data[0].id, 'sub-new'); assert.equal(search.body.data[0].email, 'new@example.test');
  assert.equal(await User.countDocuments(), 0);
  const response = await post(kind);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const saved = kind === 'recognition' ? await Recognition.findOne().lean() : kind === 'feedback' ? await Feedback.findOne().lean() : await FeedbackRequest.findOne().lean();
  const contact = kind === 'recognition' ? saved.recipient : kind === 'feedback' ? saved.receiverInfo : saved.reviewerInfo;
  assert.equal(contact.name, 'Fresh never-logged-in colleague'); assert.equal(contact.email, 'new@example.test');
  assert.ok(!JSON.stringify(saved).includes('forged@elsewhere'));
  assert.equal(await User.countDocuments(), 0, 'contact resolution must not grant local membership, team or role authority');
});

for (const kind of ['recognition', 'feedback', 'request']) test(`${kind} rejects removed/foreign/unassigned recipients and fresh action denies without writes or stale-cache fallback`, async () => {
  const action = kind === 'recognition' ? 'recognition:create' : kind === 'feedback' ? 'feedback:send' : 'feedback:request';
  await User.create({ idpSub: 'sub-new', email: 'stale@example.test', profile: { displayName: 'Stale cached person' }, idpTeams: [{ id: 'old-team', organizationId: ORG, role: 'line_manager' }] });
  const cache = await User.findOne().lean();
  for (const scenario of ['removed', 'foreign', 'unassigned', 'denied', 'unavailable']) {
    organization.members[1].status = 'active'; organization.members[1].appAccess = { mode: 'all' }; liveDenies = []; upstreamStatus = null;
    if (scenario === 'removed') organization.members[1].status = 'inactive';
    if (scenario === 'foreign') organization.members[1].account.sub = 'different-org-user'; else organization.members[1].account.sub = 'sub-new';
    if (scenario === 'unassigned') organization.members[1].appAccess = { mode: 'selected', appIds: [] };
    if (scenario === 'denied') liveDenies = [action];
    if (scenario === 'unavailable') upstreamStatus = 503;
    const response = await post(kind);
    assert.equal(response.status, scenario === 'denied' ? 403 : scenario === 'unavailable' ? 503 : 400, `${scenario}: ${JSON.stringify(response.body)}`);
    assert.equal(await Recognition.countDocuments(), 0); assert.equal(await Feedback.countDocuments(), 0); assert.equal(await FeedbackRequest.countDocuments(), 0);
    assert.deepEqual(await User.findOne().lean(), cache);
  }
});

test('team audience reports unknown eligibility accurately and private retry succeeds without losing caller data', async () => {
  const rejected = await post('recognition', { visibility: 'team' });
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /could not be verified.*Recipient only or Organization/);
  assert.equal(await Recognition.countDocuments(), 0);
  assert.equal((await post('recognition')).status, 201);
});

test('every reviewer is validated before any feedback request is persisted', async () => {
  const response = await post('request', { reviewerIds: ['sub-new', 'foreign-reviewer'] });
  assert.equal(response.status, 400); assert.equal(await FeedbackRequest.countDocuments(), 0);
});
