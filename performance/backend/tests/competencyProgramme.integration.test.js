'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const auth = require('../services/competency/authorizationService');
const Settings = require('../models/CompetencySettings');
const Features = require('../models/OrganizationFeatureConfig');
const Role = require('../models/CompetencyRole');
const Version = require('../models/CompetencyRoleVersion');
let app, mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, res, next) => {
    const organizationId = req.get('x-org') || 'org-a'; const restricted = req.get('x-role') === 'employee';
    req.competencyContext = { req, organizationId, actor: { userId: 'actor', name: 'Synthetic actor' }, organizationWide: !restricted,
      permissions: new Set(restricted ? ['competency.assessment.view'] : auth.ACTIONS), capabilities: { assessmentLaunch: !restricted },
      directory: { scope: restricted ? 'self' : 'organization', members: [{ userId: 'actor', name: 'Synthetic actor', teamIds: [] }], reviewers: [] } };
    next();
  }); app.use('/api/competency', require('../routes/competency'));
});
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); await Settings.createIndexes(); await Features.createIndexes(); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
const get = path => request(app).get('/api/competency' + path);
const patch = (body, revision = 0, role = 'admin') => request(app).patch('/api/competency/settings').set('If-Match', String(revision)).set('x-role', role).send(body);
const enable = () => Features.create({ organizationId: 'org-a', features: { competencyAssessments: true } });
test('rollout is off by default; bootstrap explains configuration while feature routes fail closed', async () => {
  const response = await get('/bootstrap').expect(200); expect(response.body.data.enabled).toBe(false); expect(response.body.data.canEnable).toBe(true);
  expect(response.body.data.settings.aiDraftsEnabled).toBe(false); expect(response.body.data.settings.callEvidenceEnabled).toBe(false);
  await get('/roles').expect(403); await patch({ callEvidenceEnabled: true }).expect(403);
});
test('policy requires notice/retention, rejects forged fields and enforces central management grants', async () => {
  await enable(); await patch({ callEvidenceEnabled: true }).expect(422); await patch({ aiDraftsEnabled: true, noticeText: 'Synthetic notice.' }).expect(422);
  await patch({ organizationId: 'org-b' }).expect(422); await patch({ noticeText: 'Not permitted' }, 0, 'employee').expect(403);
  expect(await Settings.countDocuments()).toBe(0);
});
test('concurrent policy saves accept one revision and retain actor-bound versioned configuration', async () => {
  await enable(); const value = { callEvidenceEnabled: true, aiDraftsEnabled: true, mediaRetentionDays: 30, evidenceRetentionDays: 60, exportRetentionHours: 24, noticeText: 'Synthetic recording and assessment processing notice.' };
  const outcomes = await Promise.all([patch(value), patch({ ...value, noticeText: 'Different concurrent notice' })]);
  expect(outcomes.map(row => row.status).sort()).toEqual([200, 409]);
  const saved = await Settings.findOne({ organizationId: 'org-a' }).lean(); expect(saved.revision).toBe(1); expect(saved.updatedBy.userId).toBe('actor'); expect(saved.noticeVersion).toBeTruthy(); expect(saved.policyVersion).toBeTruthy();
  await patch({ exportRetentionHours: 25 }, 0).expect(409);
  const foreign = await get('/settings').set('x-org', 'org-b').expect(403); expect(foreign.body.data).toBeUndefined();
});
test('a published cycle can still choose its pinned older role after a newer role is published', async () => {
  await enable(); const aggregate = await Role.create({ organizationId: 'org-a', name: 'Synthetic role', slug: 'synthetic-role' });
  const first = await Version.create({ organizationId: 'org-a', roleId: aggregate._id, version: 1, status: 'published', name: 'Synthetic role v1' });
  const second = await Version.create({ organizationId: 'org-a', roleId: aggregate._id, version: 2, status: 'published', name: 'Synthetic role v2' });
  await Role.updateOne({ _id: aggregate._id }, { $set: { currentVersionId: second._id } });
  const bootstrap = (await get('/bootstrap').expect(200)).body.data;
  expect(bootstrap.roles.map(row => row.versionId).sort()).toEqual([String(first._id), String(second._id)].sort());
  const employee = (await get('/bootstrap').set('x-role', 'employee').expect(200)).body.data; expect(employee.roles).toEqual([]); expect(employee.canEnable).toBe(false);
});
