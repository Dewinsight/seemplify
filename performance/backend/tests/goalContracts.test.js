const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OKR = require('../models/OKR');
const okrRouter = require('../routes/okrs');
const goalPeriodRouter = require('../routes/goalPeriods');
const legacyReviewRouter = require('../routes/reviews');
const appraisalRouter = require('../routes/appraisals');
const {
  canAssignGoal,
  canEditGoal,
  canRequestGoalChange,
  canSubmitGoal,
  canViewGoal
} = require('../services/goalPermissionService');

function requestContext(overrides = {}) {
  return {
    session: { user: { id: 'manager-1', sub: 'manager-1' } },
    currentOrganization: { id: 'org-1' },
    userRole: 'line_manager',
    directReports: ['employee-1'],
    managedTeams: [{ id: 'team-1' }],
    userTeams: [{ id: 'team-1', organizationId: 'org-1', role: 'line_manager' }],
    ...overrides
  };
}

test('goal permissions require the active tenant and relationship scope', () => {
  const req = requestContext();
  const directReportGoal = {
    organizationId: 'org-1',
    ownerId: 'employee-1',
    type: 'individual',
    lifecycle: { state: 'active' }
  };

  assert.equal(canViewGoal(req, directReportGoal), true);
  assert.equal(canAssignGoal(req, { ownerId: 'employee-1', type: 'individual' }), true);
  assert.equal(canAssignGoal(req, { ownerId: 'employee-2', type: 'individual' }), false);
  assert.equal(canViewGoal(req, { ...directReportGoal, organizationId: 'org-2' }), false);
});

test('period policy can disable employee change requests', () => {
  const req = requestContext({
    session: { user: { id: 'employee-1', sub: 'employee-1' } },
    userRole: 'employee',
    directReports: []
  });
  const goal = {
    organizationId: 'org-1',
    ownerId: 'employee-1',
    lifecycle: { state: 'pending_acknowledgement' },
    assignment: { assignedBy: { userId: 'manager-1' } },
    periodId: { settings: { allowEmployeeChangeRequests: false } }
  };

  assert.equal(canRequestGoalChange(req, goal), false);
  goal.periodId.settings.allowEmployeeChangeRequests = true;
  assert.equal(canRequestGoalChange(req, goal), true);
  assert.equal(canEditGoal(req, goal), false);
  goal.lifecycle.state = 'changes_requested';
  assert.equal(canSubmitGoal(req, goal), false);
});

test('version snapshots retain structural history without a database write', () => {
  const goal = new OKR({
    type: 'individual',
    ownerId: 'employee-1',
    organizationId: 'org-1',
    period: 'Q1 2027',
    objectives: [{
      title: 'Grow retention',
      keyResults: [{ title: 'Retention', startValue: 80, targetValue: 90 }]
    }]
  });

  goal.captureVersion('created', { userId: 'employee-1' });
  goal.title = 'Grow customer retention';
  goal.captureVersion('renamed', { userId: 'employee-1' }, { title: goal.title });

  assert.equal(goal.version, 2);
  assert.equal(goal.versionHistory.length, 2);
  assert.equal(goal.versionHistory[0].snapshot.objectives[0].title, 'Grow retention');
  assert.equal(goal.versionHistory[1].snapshot.title, 'Grow customer retention');
});

test('static OKR routes precede every dynamic goal route', () => {
  const paths = okrRouter.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  const firstDynamicRoute = paths.findIndex((path) => path.startsWith('/:id'));

  assert.ok(firstDynamicRoute > -1);
  for (const path of ['/', '/direct-reports', '/hierarchy', '/alignable/list', '/bulk-assign']) {
    assert.ok(paths.indexOf(path) > -1 && paths.indexOf(path) < firstDynamicRoute, `${path} must be static-first`);
  }
});

test('static goal-period routes precede period-id routes', () => {
  const paths = goalPeriodRouter.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  const firstDynamicRoute = paths.findIndex((path) => path.startsWith('/:periodId'));

  assert.ok(firstDynamicRoute > -1);
  for (const path of ['/current', '/upcoming', '/generate-fiscal', '/']) {
    assert.ok(paths.indexOf(path) > -1 && paths.indexOf(path) < firstDynamicRoute, `${path} must be static-first`);
  }
});

test('legacy review compatibility routes are static-first and read-only', () => {
  const routePaths = legacyReviewRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);
  const detailIndex = routePaths.indexOf('/:id');

  assert.ok(detailIndex > -1);
  for (const path of ['/cycles', '/cycles/:id', '/pending', '/direct-reports', '/']) {
    assert.ok(routePaths.indexOf(path) > -1 && routePaths.indexOf(path) < detailIndex, `${path} must be static-first`);
  }

  const mutationGuard = legacyReviewRouter.stack.find((layer) => !layer.route && layer.name === '<anonymous>');
  assert.ok(mutationGuard, 'a legacy mutation guard must be installed');
});

test('static appraisal AI suggestion route precedes appraisal-id routes', () => {
  const routePaths = appraisalRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);
  const aiSuggestIndex = routePaths.indexOf('/ai-suggest');
  const firstAppraisalIdIndex = routePaths.findIndex((path) => path.startsWith('/:appraisalId'));

  assert.ok(aiSuggestIndex > -1);
  assert.ok(firstAppraisalIdIndex > -1);
  assert.ok(aiSuggestIndex < firstAppraisalIdIndex, '/ai-suggest must be static-first');
});

test('domain routes cannot bypass the durable worker for Zulip chat delivery', () => {
  const routeDirectory = path.join(__dirname, '..', 'routes');
  for (const fileName of fs.readdirSync(routeDirectory).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(routeDirectory, fileName), 'utf8');
    assert.doesNotMatch(source, /zulipService|sendPrivateMessage/, `${fileName} must emit a domain event instead`);
  }
});
