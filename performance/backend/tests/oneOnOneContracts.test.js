const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const OneOnOne = require('../models/OneOnOne');
const oneOnOneRouter = require('../routes/oneOnOnes');
const nylasService = require('../services/nylasService');
const { EVENT_PRESENTATIONS } = require('../services/outboxService');
const { isTargetComplete } = require('../services/reminderScheduler');

function sessionUser(overrides = {}) {
  const organization = {
    id: 'org-1',
    role: 'line_manager',
    appAccess: { mode: 'all', appIds: [] }
  };
  return {
    id: 'manager-1',
    sub: 'manager-1',
    email: 'manager@example.test',
    name: 'Manager',
    currentOrganization: organization,
    organizations: [organization],
    teams: [{
      id: 'team-1',
      organizationId: 'org-1',
      role: 'line_manager',
      isManager: true,
      directReports: ['employee-1']
    }],
    ...overrides
  };
}

function testApp(user = sessionUser()) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user };
    next();
  });
  app.use('/api/one-on-ones', oneOnOneRouter);
  return app;
}

test('1:1 router applies authentication and organization context before every route', () => {
  const layers = oneOnOneRouter.stack;
  const firstRoute = layers.findIndex(layer => layer.route);
  assert.deepEqual(layers.slice(0, firstRoute).map(layer => layer.name), [
    'requireAuth',
    'requireOrganization'
  ]);
  assert.equal(oneOnOneRouter.params.id.length, 1);

  const paths = layers.filter(layer => layer.route).map(layer => layer.route.path);
  assert.ok(paths.indexOf('/upcoming') < paths.indexOf('/:id'));
  assert.ok(paths.indexOf('/with/:userId') < paths.indexOf('/:id'));
});

test('meeting lists always include the active organization and participant scope', async (t) => {
  const originalFind = OneOnOne.find;
  t.after(() => { OneOnOne.find = originalFind; });
  let capturedQuery;
  const meeting = new OneOnOne({
    managerId: 'manager-1',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    employeeNotes: 'employee private notes'
  });
  OneOnOne.find = query => {
    capturedQuery = query;
    return {
      sort() { return this; },
      limit() { return this; },
      select() { return Promise.resolve([meeting]); }
    };
  };

  const response = await request(testApp()).get('/api/one-on-ones?limit=9999');
  assert.equal(response.status, 200);
  assert.equal(capturedQuery.organizationId, 'org-1');
  assert.deepEqual(capturedQuery.$or, [
    { managerId: 'manager-1' },
    { employeeId: 'manager-1' }
  ]);
  assert.equal(response.body.data[0].employeeNotes, undefined);
});

test('cross-tenant or missing meeting IDs are returned as not found', async (t) => {
  const originalFindOne = OneOnOne.findOne;
  t.after(() => { OneOnOne.findOne = originalFindOne; });
  let capturedQuery;
  OneOnOne.findOne = async query => {
    capturedQuery = query;
    return null;
  };

  const meetingId = '64b000000000000000000001';
  const response = await request(testApp()).get(`/api/one-on-ones/${meetingId}`);
  assert.equal(response.status, 404);
  assert.equal(capturedQuery.organizationId, 'org-1');
  assert.equal(String(capturedQuery._id), meetingId);
});

test('same-tenant meetings remain inaccessible to non-participants', async (t) => {
  const originalFindOne = OneOnOne.findOne;
  t.after(() => { OneOnOne.findOne = originalFindOne; });
  OneOnOne.findOne = async () => ({
    managerId: 'manager-2',
    employeeId: 'employee-2',
    organizationId: 'org-1'
  });

  const response = await request(testApp())
    .get('/api/one-on-ones/64b000000000000000000004');
  assert.equal(response.status, 403);
});

test('meeting creation rejects assignment outside the manager direct-report scope', async () => {
  const response = await request(testApp())
    .post('/api/one-on-ones')
    .send({
      employeeId: 'employee-2',
      scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'NOT_DIRECT_REPORT');
});

test('generic meeting updates reject identity and tenant mass assignment', async (t) => {
  const originalFindOne = OneOnOne.findOne;
  t.after(() => { OneOnOne.findOne = originalFindOne; });
  const meeting = new OneOnOne({
    _id: '64b000000000000000000002',
    managerId: 'manager-1',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  OneOnOne.findOne = async () => meeting;

  const response = await request(testApp())
    .put('/api/one-on-ones/64b000000000000000000002')
    .send({ organizationId: 'org-2', employeeId: 'attacker', status: 'completed' });

  assert.equal(response.status, 400);
  assert.equal(meeting.organizationId, 'org-1');
  assert.equal(meeting.employeeId, 'employee-1');
  assert.equal(meeting.status, 'scheduled');
});

test('location remains in the model contract used by the UI and calendar sync', () => {
  const meeting = new OneOnOne({
    managerId: 'manager-1',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    location: 'Conference room 2'
  });
  assert.equal(meeting.location, 'Conference room 2');
  assert.equal(meeting.validateSync(), undefined);
});

test('permitted scheduling changes synchronize the existing calendar event', async (t) => {
  const originalFindOne = OneOnOne.findOne;
  const originalUpdateCalendarEvent = nylasService.updateCalendarEvent;
  t.after(() => {
    OneOnOne.findOne = originalFindOne;
    nylasService.updateCalendarEvent = originalUpdateCalendarEvent;
  });

  const meeting = new OneOnOne({
    _id: '64b000000000000000000005',
    managerId: 'manager-1',
    managerInfo: { name: 'Manager', email: 'manager@example.test' },
    employeeId: 'employee-1',
    employeeInfo: { name: 'Employee', email: 'employee@example.test' },
    organizationId: 'org-1',
    title: 'Weekly 1:1',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    duration: 30,
    location: 'Room 1',
    nylas: { grantId: 'grant-1', eventId: 'event-1', syncStatus: 'synced' }
  });
  meeting.save = async () => meeting;
  OneOnOne.findOne = async () => meeting;

  let updateCall;
  nylasService.updateCalendarEvent = async (...args) => {
    updateCall = args;
    return {};
  };

  const response = await request(testApp())
    .put('/api/one-on-ones/64b000000000000000000005')
    .send({ location: 'Room 7' });

  assert.equal(response.status, 200);
  assert.equal(updateCall[0], 'grant-1');
  assert.equal(updateCall[1], 'event-1');
  assert.equal(updateCall[2].location, 'Room 7');
  assert.equal(meeting.nylas.syncStatus, 'synced');
  assert.ok(meeting.nylas.lastSyncAt);
});

test('1:1 event presentations are generic and action lifecycle targets are explicit', () => {
  assert.equal(EVENT_PRESENTATIONS['one_on_one.scheduled'].targetType, 'one_on_one');
  assert.equal(EVENT_PRESENTATIONS['one_on_one.rescheduled'].action.kind, 'review');
  assert.equal(EVENT_PRESENTATIONS['one_on_one.cancelled'].isAction, false);
  assert.equal(EVENT_PRESENTATIONS['one_on_one.completed'].isAction, false);
  assert.equal(EVENT_PRESENTATIONS['one_on_one.prep_ready'].isAction, false);
  assert.equal(EVENT_PRESENTATIONS['one_on_one.action_item_due'].targetType, 'one_on_one_action_item');
  assert.equal(EVENT_PRESENTATIONS['one_on_one.action_item_completed'].isAction, false);
});

test('action-item completion resolver is tenant-scoped and recognizes terminal items', async (t) => {
  const originalFindOne = OneOnOne.findOne;
  t.after(() => { OneOnOne.findOne = originalFindOne; });
  let capturedQuery;
  let target = {
    status: 'completed',
    actionItems: [{ id: 'action-1', status: 'pending' }]
  };
  OneOnOne.findOne = query => {
    capturedQuery = query;
    return {
      select() { return this; },
      lean() { return Promise.resolve(target); }
    };
  };

  const input = {
    organizationId: 'org-1',
    targetType: 'one_on_one_action_item',
    targetId: '64b000000000000000000003:action-1'
  };
  assert.equal(await isTargetComplete(input), false, 'meeting completion must not discard follow-up work');
  assert.equal(capturedQuery.organizationId, 'org-1');
  assert.equal(String(capturedQuery._id), '64b000000000000000000003');

  target = { ...target, actionItems: [{ id: 'action-1', status: 'completed' }] };
  assert.equal(await isTargetComplete(input), true);
});
