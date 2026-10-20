const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ReviewCycle = require('../models/ReviewCycle');
const { PerformanceReview } = require('../models/PerformanceReview');
const routes = require('../routes/reviews');
let mongo, app, review;
const org = 'legacy-private-org';
function principal(actor) {
  const selected = actor === 'unassigned' ? [] : ['performance-management'];
  const role = actor === 'hr' ? 'hr_manager' : 'staff';
  const permissions = actor === 'denied' ? [] : actor === 'hr' ? ['review:view:all', 'review:view:own']
    : ['manager', 'other-manager'].includes(actor) ? ['review:view:own', 'review:view:direct_reports', 'review:conduct:direct_reports']
      : actor === 'restricted-manager' ? ['review:view:own', 'review:conduct:direct_reports'] : ['review:view:own'];
  const organization = { id: actor === 'foreign' ? 'foreign-org' : org, role, appAccess: { mode: 'selected', appIds: selected },
    authorization: { permissionsByApp: { 'performance-management': permissions } } };
  const id = ['denied', 'unassigned', 'foreign'].includes(actor) ? 'employee' : actor;
  return { id, sub: id, name: `Synthetic ${actor}`, email: `${id}@example.test`, currentOrganization: organization, organizations: [organization],
    idpTeams: [{ id: 'legacy-team', organizationId: organization.id, role: actor.includes('manager') ? 'line_manager' : 'member', directReports: actor.includes('manager') ? ['employee'] : [] }] };
}
const call = (suffix, actor = 'employee') => request(app).get(`/api/reviews${suffix}`).set('x-legacy-actor', actor);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); app = express(); app.use(express.json());
  app.use((req, _res, next) => { const user = principal(req.get('x-legacy-actor') || 'employee'); req.session = { user, currentOrganizationId: user.currentOrganization.id }; next(); });
  app.use('/api/reviews', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  const cycle = await ReviewCycle.create({ organizationId: org, title: 'Historical privacy exercise', startDate: '2025-01-01', endDate: '2025-12-31', createdBy: 'hr' });
  review = await PerformanceReview.create({ cycleId: cycle._id, userId: 'employee', managerId: 'manager', status: 'draft',
    selfEvaluation: { content: 'Private employee draft', rating: 3, aiRefinement: 'Private employee refinement' },
    managerEvaluation: { content: 'Private assigned manager draft', rating: 2, aiSummary: 'Private manager summary', biasDetection: { hasBias: true, suggestions: ['Private diagnostic'] } },
    peerReviews: [{ reviewerId: 'private-peer', status: 'requested', content: 'Private peer draft', rating: 1, aiCategorization: { keyPoints: ['Private peer analysis'] } },
      { reviewerId: 'published-peer', status: 'submitted', content: 'Published anonymous peer feedback', rating: 4 }],
    aiInsights: { growthPlan: 'Private unfinished aggregate insight' } });
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('participant retains own draft but cannot see manager or requested peer drafts through detail or list', async () => {
  const detail = (await call(`/${review._id}`).expect(200)).body;
  expect(detail.readOnly).toBe(true); expect(detail.data.selfEvaluation.content).toBe('Private employee draft');
  expect(detail.data.managerEvaluation).toBeUndefined(); expect(detail.data.aiInsights).toBeUndefined();
  expect(detail.data.peerReviews).toEqual([expect.objectContaining({ content: 'Published anonymous peer feedback', status: 'submitted', rating: 4 })]);
  expect(JSON.stringify(detail)).not.toMatch(/Private assigned|Private manager|Private peer|private-peer|published-peer|reviewerId/);
  const list = (await call('').expect(200)).body; expect(list.data).toHaveLength(1); expect(list.data[0].managerEvaluation).toBeUndefined();
});

test('only the assigned authorized manager sees that manager draft; HR and other permitted managers see no private drafts', async () => {
  const author = (await call(`/${review._id}`, 'manager').expect(200)).body.data;
  expect(author.managerEvaluation.content).toBe('Private assigned manager draft'); expect(author.managerEvaluation.biasDetection.suggestions).toEqual(['Private diagnostic']);
  expect(author.selfEvaluation).toBeUndefined();
  for (const who of ['hr', 'other-manager']) {
    const visible = (await call(`/${review._id}`, who).expect(200)).body.data;
    expect(visible.managerEvaluation).toBeUndefined(); expect(visible.selfEvaluation).toBeUndefined();
    expect(JSON.stringify(visible)).not.toMatch(/Private employee|Private assigned|Private manager|Private peer/);
  }
});

test('completed legacy evidence without section timestamps stays readable without author diagnostics or peer identities', async () => {
  await PerformanceReview.updateOne({ _id: review._id }, { $set: { status: 'completed' } });
  const stored = await PerformanceReview.findById(review._id).lean();
  for (const who of ['employee', 'hr', 'other-manager']) {
    const visible = (await call(`/${review._id}`, who).expect(200)).body.data;
    expect(visible.selfEvaluation.content).toBe('Private employee draft'); expect(visible.managerEvaluation.content).toBe('Private assigned manager draft');
    expect(visible.managerEvaluation.biasDetection).toBeUndefined(); expect(visible.peerReviews).toHaveLength(1);
    expect(visible.aiInsights.growthPlan).toBe('Private unfinished aggregate insight');
  }
  expect(await PerformanceReview.findById(review._id).lean()).toEqual(stored);
  await request(app).post(`/api/reviews/${review._id}/submit`).send({ content: 'Attempted mutation' }).expect(410);
});

test('section submission publishes its feedback without publishing unfinished aggregate insights', async () => {
  await PerformanceReview.updateOne({ _id: review._id }, { $set: { status: 'manager-review',
    'selfEvaluation.submittedAt': new Date(), 'managerEvaluation.submittedAt': new Date() } });
  for (const who of ['employee', 'hr', 'other-manager']) {
    const visible = (await call(`/${review._id}`, who).expect(200)).body.data;
    expect(visible.selfEvaluation.content).toBe('Private employee draft');
    expect(visible.managerEvaluation.content).toBe('Private assigned manager draft');
    expect(visible.managerEvaluation.biasDetection).toBeUndefined(); expect(visible.aiInsights).toBeUndefined();
  }
});

test('foreign tenant, unassigned app and explicit central permission denial cannot expose historical evidence', async () => {
  await call(`/${review._id}`, 'foreign').expect(404);
  await call(`/${review._id}`, 'unassigned').expect(403);
  await call(`/${review._id}`, 'outsider').expect(403);
  await call(`/${review._id}`, 'denied').expect(403);
  expect((await call('', 'denied').expect(200)).body.data).toEqual([]);
  await call(`/${review._id}`, 'restricted-manager').expect(403);
  expect((await call('/direct-reports', 'restricted-manager').expect(200)).body.count).toBe(0);
});
