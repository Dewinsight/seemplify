'use strict';
// Actual Express/Mongo aggregation: absent fields and explicit null must not
// count as submitted/finalized. The test session is a disposable IdP principal.
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const routes = require('../routes/appraisals');
const ORG = 'admin-funnel-synthetic';
let mongo, app, cycle, progress;
const get = (actor = 'hr', org = ORG) => request(app).get('/api/appraisals/admin/analytics').set('x-funnel-actor', actor).set('x-funnel-org', org);
async function seed(employeeId, values = {}, organizationId = ORG, cycleId = cycle._id) {
  const launchedAt = new Date();
  launchedAt.setUTCDate(15);
  launchedAt.setUTCMonth(launchedAt.getUTCMonth() - 1);
  return Appraisal.create({ organizationId, cycleId, employee: { userId: employeeId, name: 'Synthetic employee', email: `${employeeId}@example.test`, teamName: 'Fictional delivery' },
    manager: { userId: 'manager', name: 'Synthetic manager', email: 'manager@example.test' }, createdAt: launchedAt, ...values });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => {
    const actor = req.get('x-funnel-actor') || 'hr', organizationId = req.get('x-funnel-org') || ORG;
    if (actor !== 'anonymous') {
      const organization = { id: organizationId, role: actor === 'hr' ? 'hr_manager' : 'employee', appAccess: { mode: 'all', appIds: [] } };
      req.session = { currentOrganizationId: organizationId, user: { id: actor, sub: actor, email: `${actor}@example.test`, organizations: [organization], currentOrganization: organization } };
    }
    next();
  }); app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  cycle = await Cycle.create({ organizationId: ORG, name: 'Synthetic stage counts', status: 'active', periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'hr' } });
  const now = new Date();
  for (let index = 0; index < 8; index++) {
    const completed = await seed(`completed-${index}`, { status: 'employee_acknowledged', selfAssessment: { submittedAt: now }, managerReview: { submittedAt: now }, finalRating: { overall: 4, finalizedAt: now } });
    // Read-only analytics must preserve a stored numeric zero as present.
    if (index === 0) await Appraisal.collection.updateOne({ _id: completed._id }, { $set: { 'finalRating.overall': 0 } });
  }
  await seed('discussion', { status: 'discussion_scheduled', selfAssessment: { submittedAt: now }, managerReview: { submittedAt: now } });
  progress = await seed('in-progress', { status: 'manager_review_in_progress', selfAssessment: { submittedAt: now }, finalRating: { overall: null } });
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

function expectCounts(data, total = 10, self = 10, manager = 9, finalized = 8) {
  expect(data.overview).toMatchObject({ totalAppraisals: total, completedAppraisals: 8 });
  expect(data.workflow).toMatchObject({ selfSubmitted: self, managerSubmitted: manager, finalized, completed: 8 });
  const percent = value => Math.round(value / total * 1000) / 10;
  expect(data.workflow).toMatchObject({ selfCompletionRate: percent(self), managerCompletionRate: percent(manager), finalizationRate: percent(finalized) });
  expect(data.teamInsights).toHaveLength(1);
  expect(data.teamInsights[0]).toMatchObject({ total, selfSubmitted: self, managerSubmitted: manager, completed: 8 });
  expect(data.cycleHealth).toHaveLength(1);
  expect(data.cycleHealth[0].stats).toMatchObject({ totalEmployees: total, selfAssessmentSubmitted: self, managerReviewSubmitted: manager, finalized, completedAppraisals: 8 });
  const activeMonth = data.monthlyTrend.find(month => month.launched > 0);
  expect(activeMonth).toMatchObject({ launched: total, selfSubmitted: self, managerSubmitted: manager, completed: 8 });
  expect(Object.values(data.audit.checks).every(Boolean)).toBe(true);
}

test('ten real appraisals produce 100/90/80 over the same denominator instead of counting absent stages', async () => {
  const response = await get().expect(200);
  expectCounts(response.body.data);
  expect(response.body.data.overview.completionRate).toBe(80);
});

test('explicit null submission/final-rating fields are equivalent to missing fields', async () => {
  await Appraisal.collection.updateOne({ _id: progress._id }, { $set: { 'managerReview.submittedAt': null }, $unset: { 'finalRating.overall': '' } });
  expectCounts((await get().expect(200)).body.data);
});

test('pending records with missing or null self submissions do not inflate team or monthly completion', async () => {
  await seed('no-fields', { status: 'self_assessment_pending' });
  await seed('explicit-null', { status: 'self_assessment_pending', selfAssessment: { submittedAt: null }, managerReview: { submittedAt: null }, finalRating: { overall: null } });
  expectCounts((await get().expect(200)).body.data, 12, 10, 9, 8);
});

test('monthly trend includes the current UTC month and twelve distinct consecutive buckets', async () => {
  const now = new Date();
  await Appraisal.collection.updateMany({}, { $set: { createdAt: now } });
  const data = (await get().expect(200)).body.data;
  const expectedMonths = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    return month.toISOString().slice(0, 7);
  });
  expect(data.monthlyTrend.map(month => month.month)).toEqual(expectedMonths);
  expect(data.monthlyTrend.at(-1)).toMatchObject({ launched: 10, selfSubmitted: 10, managerSubmitted: 9, completed: 8 });
});

test('stage counts retain the selected organization and existing HR-only boundary', async () => {
  const foreign = await Cycle.create({ organizationId: 'other-funnel-org', name: 'Foreign synthetic stages', periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'hr' } });
  await seed('foreign', { status: 'completed', selfAssessment: { submittedAt: new Date() }, managerReview: { submittedAt: new Date() }, finalRating: { overall: 5 } }, 'other-funnel-org', foreign._id);
  expectCounts((await get().expect(200)).body.data);
  const selected = (await get('hr', 'other-funnel-org').expect(200)).body.data;
  expect(selected.overview.totalAppraisals).toBe(1); expect(selected.workflow).toMatchObject({ selfSubmitted: 1, managerSubmitted: 1, finalized: 1 });
  await get('employee').expect(403); await get('anonymous').expect(401);
});
