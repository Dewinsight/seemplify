const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');

const OrganizationFeatureConfig = require('../models/OrganizationFeatureConfig');
const bulkRouter = require('../routes/bulk');
const organizationFeatureRouter = require('../routes/organizationFeatures');
const reportsRouter = require('../routes/reports');
const userRouter = require('../routes/user');
const User = require('../models/User');
const OKR = require('../models/OKR');
const Appraisal = require('../models/Appraisal');
const Feedback = require('../models/Feedback');
const {
  DEFAULT_ORGANIZATION_FEATURES,
  effectiveOrganizationFeatures,
  getOrganizationFeatureState,
  requireOrganizationFeature
} = require('../services/organizationFeatureService');

function sessionUser({ hr = true } = {}) {
  return {
    id: hr ? 'hr-1' : 'employee-1',
    sub: hr ? 'hr-1' : 'employee-1',
    email: hr ? 'hr@example.test' : 'employee@example.test',
    currentOrganization: { id: 'org-1', role: hr ? 'hr_manager' : 'employee' },
    organizations: [{ id: 'org-1', role: hr ? 'hr_manager' : 'employee' }],
    teams: []
  };
}

function settingsApp(user = sessionUser()) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user };
    next();
  });
  app.use('/api/organization-features', organizationFeatureRouter);
  return app;
}

function mixedCanonicalRoutesApp(user = sessionUser()) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user };
    next();
  });
  app.use('/api/bulk', bulkRouter);
  app.use('/api/reports', reportsRouter);
  return app;
}

test('organizations without configuration retain the backward-compatible enabled defaults', async (t) => {
  const originalFindOne = OrganizationFeatureConfig.findOne;
  t.after(() => { OrganizationFeatureConfig.findOne = originalFindOne; });
  OrganizationFeatureConfig.findOne = () => ({
    select() { return this; },
    lean() { return Promise.resolve(null); }
  });

  const state = await getOrganizationFeatureState('org-1');
  assert.equal(state.configured, false);
  assert.deepEqual(state.features, DEFAULT_ORGANIZATION_FEATURES);
  assert.deepEqual(state.overrides, {});
});

test('only an explicit false disables a feature', () => {
  assert.deepEqual(effectiveOrganizationFeatures({ notifications: false }), {
    canonicalAppraisals: true,
    goalPeriods: true,
    notifications: false,
    continuousPerformance: true
  });
  assert.equal(effectiveOrganizationFeatures({ notifications: undefined }).notifications, true);
});

test('an explicitly disabled organization feature fails closed', async () => {
  const app = express();
  app.use((req, res, next) => {
    req.organizationId = 'org-1';
    next();
  });
  app.get('/protected', requireOrganizationFeature('notifications', {
    loader: async organizationId => ({
      organizationId,
      features: { ...DEFAULT_ORGANIZATION_FEATURES, notifications: false }
    })
  }), (req, res) => res.json({ success: true }));

  const response = await request(app).get('/protected');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'ORGANIZATION_FEATURE_DISABLED');
  assert.equal(response.body.feature, 'notifications');
});

test('organization feature updates require HR-admin authority', async () => {
  const response = await request(settingsApp(sessionUser({ hr: false })))
    .patch('/api/organization-features')
    .send({ features: { notifications: false } });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'HR_ADMIN_REQUIRED');
});

test('HR updates are tenant-scoped and cannot mass-assign an organization', async (t) => {
  const originalFindOneAndUpdate = OrganizationFeatureConfig.findOneAndUpdate;
  t.after(() => { OrganizationFeatureConfig.findOneAndUpdate = originalFindOneAndUpdate; });
  let capturedFilter;
  let capturedUpdate;
  OrganizationFeatureConfig.findOneAndUpdate = (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return {
      lean: async () => ({
        organizationId: 'org-1',
        features: { notifications: false },
        createdBy: 'hr-1',
        updatedBy: 'hr-1'
      })
    };
  };

  const response = await request(settingsApp())
    .patch('/api/organization-features')
    .send({
      organizationId: 'org-2',
      features: { notifications: false }
    });

  assert.equal(response.status, 200);
  assert.deepEqual(capturedFilter, { organizationId: 'org-1' });
  assert.equal(capturedUpdate.$set['features.notifications'], false);
  assert.equal(capturedUpdate.$set.updatedBy, 'hr-1');
  assert.equal(response.body.data.organizationId, 'org-1');
  assert.equal(response.body.data.features.notifications, false);
});

test('HR reads only the active tenant feature state', async (t) => {
  const originalFindOne = OrganizationFeatureConfig.findOne;
  t.after(() => { OrganizationFeatureConfig.findOne = originalFindOne; });
  let capturedFilter;
  OrganizationFeatureConfig.findOne = filter => {
    capturedFilter = filter;
    return {
      select() { return this; },
      lean: async () => ({ organizationId: 'org-1', features: { goalPeriods: false } })
    };
  };

  const response = await request(settingsApp()).get('/api/organization-features');
  assert.equal(response.status, 200);
  assert.deepEqual(capturedFilter, { organizationId: 'org-1' });
  assert.equal(response.body.data.features.goalPeriods, false);
  assert.equal(response.body.data.features.canonicalAppraisals, true);
});

test('core route groups are mounted behind their organization rollout guards', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const expectedMounts = [
    ["'/api/appraisals'", 'canonicalAppraisalsEnabled'],
    ["'/api/calibration'", 'canonicalAppraisalsEnabled'],
    ["'/api/goal-periods'", 'goalPeriodsEnabled'],
    ["'/api/actions'", 'notificationsEnabled'],
    ["'/api/notifications'", 'notificationsEnabled'],
    ["'/api/check-ins'", 'continuousPerformanceEnabled'],
    ["'/api/feedback'", 'continuousPerformanceEnabled'],
    ["'/api/one-on-ones'", 'continuousPerformanceEnabled'],
    ["'/api/development-plans'", 'continuousPerformanceEnabled']
  ];

  for (const [mount, guard] of expectedMounts) {
    assert.match(
      appSource,
      new RegExp(`app\\.use\\(${mount}, requireAuth, requireOrganization, ${guard}`),
      `${mount} must use ${guard}`
    );
  }
});

test('mixed routers reject only canonical appraisal operations when rollout is disabled', async (t) => {
  const originalFindOne = OrganizationFeatureConfig.findOne;
  t.after(() => { OrganizationFeatureConfig.findOne = originalFindOne; });
  OrganizationFeatureConfig.findOne = () => ({
    select() { return this; },
    lean: async () => ({
      organizationId: 'org-1',
      features: { canonicalAppraisals: false }
    })
  });

  const app = mixedCanonicalRoutesApp();
  const guardedRequests = [
    request(app).post('/api/bulk/reviews/remind').send({}),
    request(app).get('/api/bulk/export/reviews'),
    request(app).get('/api/reports/review-cycle/not-an-object-id')
  ];

  for (const guardedRequest of guardedRequests) {
    const response = await guardedRequest;
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ORGANIZATION_FEATURE_DISABLED');
    assert.equal(response.body.feature, 'canonicalAppraisals');
  }

  const legacyResponse = await request(app)
    .post('/api/bulk/reviews/create')
    .send({});
  assert.equal(legacyResponse.status, 410);
});

test('mixed-router rollout guards preserve legacy, OKR, and feedback route contracts', () => {
  const bulkSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bulk.js'), 'utf8');
  const reportsSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reports.js'), 'utf8');

  assert.match(bulkSource, /router\.post\('\/reviews\/remind', requireHRAdmin, canonicalAppraisalsEnabled,/);
  assert.match(bulkSource, /router\.get\('\/export\/reviews', requireHRAdmin, canonicalAppraisalsEnabled,/);
  assert.match(reportsSource, /router\.get\('\/review-cycle\/:cycleId', requireHRAdmin, canonicalAppraisalsEnabled,/);

  assert.match(bulkSource, /router\.post\('\/reviews\/create', requireHRAdmin, \(req, res\) =>/);
  assert.match(bulkSource, /router\.get\('\/export\/okrs', requireHRAdmin, async/);
  assert.match(reportsSource, /router\.get\('\/okr-trends', requireHRAdmin, async/);
  assert.match(reportsSource, /router\.get\('\/feedback-analytics', requireHRAdmin, async/);
});

test('appraisal finalization does not create development work when continuous performance is disabled', () => {
  const appraisalSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'appraisals.js'), 'utf8');

  assert.match(
    appraisalSource,
    /continuousPerformanceEnabled = organizationFeatureState\.features\.continuousPerformance === true/
  );
  assert.match(
    appraisalSource,
    /if \(continuousPerformanceEnabled\) \{\s*developmentPlan = await ensureDraftDevelopmentPlan/
  );
  assert.match(
    appraisalSource,
    /if \(continuousPerformanceEnabled && isAiAssistEnabledForCycle\(cycle\)\)/
  );
});

test('effective rollout flags are exposed to ordinary employee context', async (t) => {
  const originals = {
    configFindOne: OrganizationFeatureConfig.findOne,
    userFindOne: User.findOne,
    okrCount: OKR.countDocuments,
    appraisalCount: Appraisal.countDocuments,
    feedbackCount: Feedback.countDocuments
  };
  t.after(() => {
    OrganizationFeatureConfig.findOne = originals.configFindOne;
    User.findOne = originals.userFindOne;
    OKR.countDocuments = originals.okrCount;
    Appraisal.countDocuments = originals.appraisalCount;
    Feedback.countDocuments = originals.feedbackCount;
  });

  OrganizationFeatureConfig.findOne = () => ({
    select() { return this; },
    lean: async () => ({
      organizationId: 'org-1',
      features: { canonicalAppraisals: false, continuousPerformance: false }
    })
  });
  User.findOne = async () => null;
  OKR.countDocuments = async () => 0;
  Appraisal.countDocuments = async () => 0;
  Feedback.countDocuments = async () => 0;

  const app = express();
  app.use((req, res, next) => {
    req.session = { user: sessionUser({ hr: false }) };
    next();
  });
  app.use('/api/user', userRouter);

  const response = await request(app).get('/api/user/context');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.role.name, 'employee');
  assert.equal(response.body.data.features.canonicalAppraisals, false);
  assert.equal(response.body.data.features.continuousPerformance, false);
  assert.equal(response.body.data.features.goalPeriods, true);
  assert.equal(response.body.data.features.notifications, true);
});
