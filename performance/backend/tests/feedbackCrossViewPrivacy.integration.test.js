'use strict';
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const { requireOrganization } = require('../services/tenantPolicy');
const userRoutes = require('../routes/user');
const employeeRoutes = require('../routes/employees');
const reports = require('../routes/reports');
const analytics = require('../routes/analytics');
const insights = require('../routes/managerInsights');
const ORG = 'crossview-feedback-org';
const serviceSecret = 'SYNTHETIC local service contract only';
let app, mongo, named, anonymous, previousSecret, clock = 0;
const call = (path, actor = 'subject', org = ORG) => request(app).get(`/api${path}`).set('x-view-actor', actor).set('x-view-org', org);
const valueAt = (object, path) => path.split('.').reduce((value, field) => value?.[field], object);
const source = extra => ({ organizationId: ORG, receiverId: 'subject', senderId: 'private-reviewer', senderInfo: { name: 'Private reviewer', email: 'private-reviewer@example.test' },
  type: 'general', content: 'Private anonymous content', contextType: '360', anonymity: 'anonymous', cohortId: 'crossview-cohort', minimumCohortSize: 5, visibility: 'public', ...extra });
beforeAll(async () => {
  previousSecret = process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET;
  process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET = serviceSecret;
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get('x-view-actor') || 'subject';
    if (actor === 'logged-out') return next();
    const org = req.get('x-view-org') || ORG;
    const organization = { id: org, name: 'Synthetic cross-view privacy', role: actor === 'hr' ? 'hr_manager' : 'staff', appAccess: { mode: 'all', appIds: [] } };
    const user = { id: actor, sub: actor, name: `Synthetic ${actor}`, email: `${actor}@example.test`, currentOrganization: organization,
      organizations: [organization], idpTeams: [{ id: 'crossview-team', organizationId: org, role: actor === 'manager' ? 'line_manager' : 'member',
        ...(actor === 'manager' ? { directReports: ['subject'] } : {}) }] };
    req.session = { user, currentOrganizationId: org }; next();
  });
  app.use('/api/user', userRoutes); app.use('/api/employees', employeeRoutes);
  app.use('/api/reports', reports); app.use('/api/analytics', analytics);
  app.use('/api/manager-insights', requireAuth, requireOrganization, insights);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await User.create(['subject', 'manager', 'hr'].map(idpSub => ({ idpSub, email: `${idpSub}@example.test`, isActive: true,
    profile: { displayName: `Synthetic ${idpSub}` }, organizationMemberships: [{ organization: ORG, role: 'staff', isActive: true }] })));
  named = await Feedback.create(source({ senderId: 'named-reviewer', senderInfo: { name: 'Named colleague' }, anonymity: 'named', cohortId: undefined, type: 'praise', content: 'Permitted named observation' }));
  anonymous = await Feedback.create(Array.from({ length: 4 }, (_, index) => source({ senderId: `private-reviewer-${index}`, createdAt: new Date(Date.now() - (index + 1) * 60000) })));
  // None of these can unlock the selected employee's cohort.
  await Feedback.create([source({ organizationId: 'foreign-org' }), source({ deletedAt: new Date() }), source({ receiverId: 'different-subject' })]);
});
afterAll(async () => {
  await mongoose.disconnect(); if (mongo) await mongo.stop();
  if (previousSecret === undefined) delete process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET;
  else process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET = previousSecret;
});

test.each([
  ['/user/context', 'subject', 'data.stats.feedbackReceived'],
  ['/analytics/dashboard', 'subject', 'data.recentFeedback'],
  ['/analytics/dashboard', 'hr', 'data.recentFeedback'],
  ['/reports/org-summary', 'hr', 'data.feedback.total'],
  ['/reports/team-performance', 'manager', 'data.feedback.0.totalReceived'],
  ['/reports/individual/subject', 'subject', 'data.stats.feedbackReceived'],
  ['/reports/individual/subject', 'hr', 'data.stats.feedbackReceived']
])('%s as %s counts only released cohorts while preserving named feedback', async (path, actor, field) => {
  const before = await call(path, actor).expect(200);
  expect(valueAt(before.body, field)).toBe(1);
  await Feedback.create(source({ senderId: 'private-reviewer-final' }));
  const released = await call(path, actor).expect(200);
  expect(valueAt(released.body, field)).toBe(6);
  if (path.includes('/individual/')) {
    for (const item of released.body.data.recentFeedback) if (item.id !== String(named._id)) expect(item).not.toHaveProperty('date');
  }
});

test('organization feedback analytics cannot use named feedback to unlock a four-response anonymous cohort', async () => {
  const before = await call('/reports/feedback-analytics', 'hr').expect(200);
  expect(before.body.data).toMatchObject({ total: null, suppressed: true, minimumCohortSize: 5 });
  expect(before.body.data.weeklyVolume).toEqual([]);
  await Feedback.create(source({ senderId: 'private-reviewer-final' }));
  const after = await call('/reports/feedback-analytics', 'hr').expect(200);
  expect(after.body.data.total).toBe(6);
});

test('chronological employee timeline excludes anonymous timestamps and confidential subject identities while retaining named history', async () => {
  await Feedback.create(source({ anonymity: 'confidential', cohortId: undefined, content: 'Confidential supporting text' }));
  for (const phase of ['below', 'released']) {
    if (phase === 'released') await Feedback.create(source({ senderId: 'private-reviewer-final' }));
    const timeline = await call('/employees/subject/timeline').expect(200);
    const feedback = timeline.body.data.filter(item => item.type === 'feedback');
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ id: String(named._id), content: 'Permitted named observation', sender: { name: 'Named colleague' } });
    const text = JSON.stringify(timeline.body.data);
    expect(text).not.toContain('Private anonymous content'); expect(text).not.toContain('private-reviewer');
    for (const item of anonymous) expect(text).not.toContain(item.createdAt.toISOString());
  }
  // Existing HR confidential authority remains; anonymous chronology stays absent.
  const hr = await call('/employees/subject/timeline', 'hr').expect(200);
  expect(hr.body.data.filter(item => item.type === 'feedback')).toHaveLength(2);
  expect(hr.body.data.some(item => item.content === 'Confidential supporting text')).toBe(true);
});

test('manager coaching coverage cannot reveal withheld anonymous progress', async () => {
  await Feedback.deleteOne({ _id: named._id });
  const before = await call('/manager-insights/practices', 'manager').expect(200);
  expect(before.body.data.summary.feedbackCoverage).toBe(0);
  expect(before.body.data.attention.some(item => item.type === 'feedback_gap')).toBe(true);
  await Feedback.create(source({ senderId: 'private-reviewer-final' }));
  const after = await call('/manager-insights/practices', 'manager').expect(200);
  expect(after.body.data.summary.feedbackCoverage).toBe(100);
});

test('authenticated internal summary applies the same cohort threshold, while scoped reads retain boundaries', async () => {
  const internal = () => {
    const timestamp = new Date(Date.now() + ++clock).toISOString();
    return call('/employees/subject/performance-summary').set('x-organization-id', ORG).set('x-service-timestamp', timestamp)
      .set('x-service-signature', crypto.createHmac('sha256', serviceSecret).update(`${timestamp}.{}`).digest('hex'));
  };
  expect((await internal().expect(200)).body.data.feedback.receivedCount).toBe(1);
  await Feedback.create(source({ senderId: 'private-reviewer-final' }));
  expect((await internal().expect(200)).body.data.feedback.receivedCount).toBe(6);
  await call('/reports/individual/subject', 'outsider').expect(403);
  await call('/employees/subject/timeline', 'outsider').expect(403);
  await call('/reports/org-summary', 'subject').expect(403);
  await call('/user/context', 'logged-out').expect(401);
  expect((await call('/user/context', 'subject', 'empty-foreign-org').expect(200)).body.data.stats.feedbackReceived).toBe(0);
});
