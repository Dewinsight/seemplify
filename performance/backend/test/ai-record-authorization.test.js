'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  canAccessDevelopmentPlan,
  canAccessOneOnOne,
  currentOrganizationRecordFilter
} = require('../services/performanceRecordAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function createRouterRecorder() {
  const routes = new Map();
  const sharedHandlers = [];
  const parameterHandlers = new Map();
  const router = {
    use: (...handlers) => {
      sharedHandlers.push(...handlers.filter((handler) => typeof handler === 'function'));
      return router;
    },
    param: (name, handler) => {
      parameterHandlers.set(name, handler);
      return router;
    }
  };
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (path, ...handlers) => {
      const parameters = [...String(path).matchAll(/:([A-Za-z0-9_]+)/g)]
        .map((match) => match[1])
        .filter((name) => parameterHandlers.has(name))
        .map((name) => (req, res, next) => parameterHandlers.get(name)(req, res, next, req.params[name]));
      routes.set(`${method.toUpperCase()} ${path}`, [...sharedHandlers, ...parameters, ...handlers]);
    };
  }
  return { router, routes };
}

function passMiddleware(req, _res, next) {
  return next();
}

function loadRouteModule(routeName, moduleStubs = {}) {
  const { router, routes } = createRouterRecorder();
  const originalLoad = Module._load;
  const multer = () => ({ single: () => passMiddleware });
  multer.memoryStorage = () => ({});

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === 'multer') return multer;
    if (Object.prototype.hasOwnProperty.call(moduleStubs, request)) {
      return moduleStubs[request];
    }
    if (request === '../middleware/rbac') {
      return {
        requireAuth: passMiddleware,
        requireManager: passMiddleware,
        requireHRAdmin: (req, res, next) => {
          req.checkedPermissions = [...(req.checkedPermissions || []), 'review:calibrate'];
          if (req.userRole !== 'hr_admin') {
            return res.status(403).json({ success: false, error: 'Permission denied', code: 'PERMISSION_DENIED' });
          }
          return next();
        },
        requirePermission: (permission) => (req, res, next) => {
          req.checkedPermissions = [...(req.checkedPermissions || []), permission];
          if (Array.isArray(req.allowedPermissions) && !req.allowedPermissions.includes(permission)) {
            return res.status(403).json({
              success: false,
              error: `Permission denied: ${permission}`,
              code: 'PERMISSION_DENIED'
            });
          }
          return next();
        }
      };
    }
    if (request === '../services/aiPerformanceService') {
      return { parseAIResponse: () => ({ success: false, error: 'not exercised' }) };
    }
    if (request === '../services/aiGatewayService') {
      return {
        sendPerformanceAIError: (res, error) => res.status(500).json({ success: false, error: error.message })
      };
    }
    if (request === '../services/notificationService') return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  const routePath = require.resolve(`../routes/${routeName}`);
  delete require.cache[routePath];
  try {
    require(routePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }
  return routes;
}

async function runHandlers(handlers, req) {
  const res = responseRecorder();
  async function runAt(index) {
    const handler = handlers[index];
    if (!handler || res.body) return;
    await handler(req, res, () => runAt(index + 1));
  }
  await runAt(0);
  return res;
}

function requestFor({ userId = 'manager-a', organizationId = 'org-a', role = 'line_manager' } = {}) {
  const currentOrganization = { id: organizationId };
  return {
    params: { id: '64b000000000000000000001' },
    body: {},
    session: {
      currentOrganizationId: organizationId,
      user: { id: userId, sub: userId, currentOrganization }
    },
    currentOrganization,
    userRole: role,
    allowedPermissions: ['analytics:view:own', 'review:calibrate']
  };
}

test('record filters always combine the record id with the canonical current organization', () => {
  const req = requestFor({ organizationId: 'org-a' });
  assert.deepEqual(currentOrganizationRecordFilter(req, 'record-1'), {
    _id: 'record-1',
    organizationId: 'org-a'
  });
  assert.equal(currentOrganizationRecordFilter({ session: { user: {} } }, 'record-1'), null);
});

test('one-on-one access is limited to same-record participants or an HR admin', () => {
  const meeting = { managerId: 'manager-a', employeeId: 'employee-a' };
  assert.equal(canAccessOneOnOne(requestFor({ userId: 'manager-a' }), meeting), true);
  assert.equal(canAccessOneOnOne(requestFor({ userId: 'employee-a', role: 'employee' }), meeting), true);
  assert.equal(canAccessOneOnOne(requestFor({ userId: 'other-a', role: 'employee' }), meeting), false);
  assert.equal(canAccessOneOnOne(requestFor({ userId: 'hr-a', role: 'hr_admin' }), meeting), true);
});

test('development-plan access is limited to the owner, assigned manager, or an HR admin', () => {
  const plan = { userId: 'employee-a', managerId: 'manager-a' };
  assert.equal(canAccessDevelopmentPlan(requestFor({ userId: 'employee-a', role: 'employee' }), plan), true);
  assert.equal(canAccessDevelopmentPlan(requestFor({ userId: 'manager-a' }), plan), true);
  assert.equal(canAccessDevelopmentPlan(requestFor({ userId: 'other-manager' }), plan), false);
  assert.equal(canAccessDevelopmentPlan(requestFor({ userId: 'hr-a', role: 'hr_admin' }), plan), true);
});

test('every one-on-one AI route hides an org B meeting from an org A requester', async () => {
  const orgBMeeting = {
    _id: '64b000000000000000000001',
    organizationId: 'org-b',
    managerId: 'manager-a',
    employeeId: 'employee-a'
  };
  const queries = [];
  const OneOnOne = {
    findOne: async (query) => {
      queries.push(query);
      return query._id === orgBMeeting._id && query.organizationId === orgBMeeting.organizationId
        ? orgBMeeting
        : null;
    }
  };
  const routes = loadRouteModule('oneOnOnes', { '../models/OneOnOne': OneOnOne });

  for (const key of [
    'POST /:id/chat/ai-assist',
    'POST /:id/analyze',
    'GET /:id/trends',
    'POST /:id/prep'
  ]) {
    const req = requestFor({ userId: 'manager-a', organizationId: 'org-a' });
    const res = await runHandlers(routes.get(key), req);
    assert.equal(res.statusCode, 404, key);
    assert.equal(res.body.error, 'Meeting not found', key);
  }

  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.organizationId === 'org-a'));
});

test('every one-on-one AI route rejects a same-org non-participant before invoking AI', async () => {
  const meeting = {
    _id: 'record-1',
    organizationId: 'org-a',
    managerId: 'manager-a',
    employeeId: 'employee-a'
  };
  const OneOnOne = { findOne: async () => meeting };
  const routes = loadRouteModule('oneOnOnes', { '../models/OneOnOne': OneOnOne });

  for (const key of [
    'POST /:id/chat/ai-assist',
    'POST /:id/analyze',
    'GET /:id/trends',
    'POST /:id/prep'
  ]) {
    const res = await runHandlers(routes.get(key), requestFor({ userId: 'other-a', organizationId: 'org-a' }));
    assert.equal(res.statusCode, 403, key);
    assert.equal(res.body.error, 'Access denied', key);
  }
});

test('development-plan AI route hides org B data and rejects a same-org non-owner', async () => {
  const orgBPlan = {
    _id: '64b000000000000000000001',
    organizationId: 'org-b',
    userId: 'employee-a',
    managerId: 'manager-a'
  };
  const queries = [];
  const DevelopmentPlan = {
    findOne: async (query) => {
      queries.push(query);
      return query.organizationId === orgBPlan.organizationId ? orgBPlan : null;
    }
  };
  let routes = loadRouteModule('developmentPlans', { '../models/DevelopmentPlan': DevelopmentPlan });
  let req = requestFor({ userId: 'manager-a', organizationId: 'org-a' });
  let res = await runHandlers(routes.get('POST /:id/ai-recommendations'), req);
  assert.equal(res.statusCode, 404);
  assert.equal(queries[0].organizationId, 'org-a');

  routes = loadRouteModule('developmentPlans', {
    '../models/DevelopmentPlan': { findOne: async () => ({ ...orgBPlan, organizationId: 'org-a' }) }
  });
  res = await runHandlers(
    routes.get('POST /:id/ai-recommendations'),
    requestFor({ userId: 'other-manager', organizationId: 'org-a' })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Access denied');
});

test('calibration AI analysis requires calibration permission and current-org lookup', async () => {
  const queries = [];
  const Calibration = {
    findOne: async (query) => {
      queries.push(query);
      return query.organizationId === 'org-b' ? { _id: '64b000000000000000000001', organizationId: 'org-b' } : null;
    }
  };
  const routes = loadRouteModule('calibration', {
    '../models/Calibration': Calibration,
    '../models/PerformanceReview': { PerformanceReview: {} },
    '../models/ReviewCycle': {}
  });
  const handlers = routes.get('POST /:id/ai-insights');

  let req = requestFor({ userId: 'hr-a', organizationId: 'org-a', role: 'hr_admin' });
  let res = await runHandlers(handlers, req);
  assert.equal(res.statusCode, 404);
  assert.equal(queries[0].organizationId, 'org-a');
  assert.deepEqual(req.checkedPermissions, ['review:calibrate']);

  req = requestFor({ userId: 'employee-a', organizationId: 'org-a', role: 'employee' });
  req.allowedPermissions = [];
  res = await runHandlers(handlers, req);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PERMISSION_DENIED');
  assert.equal(queries.length, 1, 'permission denial must happen before loading calibration data');
});
