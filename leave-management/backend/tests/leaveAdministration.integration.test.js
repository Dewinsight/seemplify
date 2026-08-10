const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const leaveBalanceRoutes = require('../routes/leaveBalances');
const leaveTypeRoutes = require('../routes/leaveTypes');
const { errorHandler } = require('../middleware/errorHandler');
const {
  AuditLog,
  LeaveBalance,
  LeaveEntitlementAdjustment,
  LeavePolicy,
} = require('../models');

jest.setTimeout(120_000);

describe('leave administration API', () => {
  let replSet;
  let app;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LEAVE_IDP_SERVICE_SECRET = 'integration-secret';
    process.env.IDP_INTERNAL_API_URL = 'http://idp.test';
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([
      AuditLog.init(),
      LeaveBalance.init(),
      LeaveEntitlementAdjustment.init(),
      LeavePolicy.init(),
    ]);

    global.fetch = jest.fn(async (_url, options) => {
      const { organizationId } = JSON.parse(options.body);
      const memberships = organizationId === 'org-a'
        ? [{ userId: 'account-a', idpSubject: 'employee-a', name: 'Employee A', email: 'a@example.com', role: 'staff', status: 'active', teamIds: ['team-a'] }]
        : [{ userId: 'account-b', idpSubject: 'employee-b', name: 'Employee B', email: 'b@example.com', role: 'staff', status: 'active', teamIds: ['team-b'] }];
      return { ok: true, json: async () => ({ schemaVersion: '1.0', organizationId, memberships }) };
    });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const organizationId = String(req.get('x-test-organization') || 'org-a');
      const testUser = {
        id: `admin-${organizationId}`,
        name: `Admin ${organizationId}`,
        email: `admin-${organizationId}@example.com`,
        organizations: [{ id: organizationId, name: organizationId, role: 'admin', appPermissions: { 'leave-management': ['*'] } }],
        teams: [],
        currentOrganization: { id: organizationId, name: organizationId },
      };
      req.session = { currentOrganizationId: organizationId, user: testUser };
      req.user = testUser;
      next();
    });
    app.use('/api/leave-types', leaveTypeRoutes);
    app.use('/api/leave-balances', leaveBalanceRoutes);
    app.use(errorHandler);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await mongoose.disconnect();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await replSet.stop();
    consoleWarn.mockRestore();
  });

  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
    await Promise.all([
      LeavePolicy.findOrCreate('org-a', 'Organization A'),
      LeavePolicy.findOrCreate('org-b', 'Organization B'),
    ]);
  });

  test('creates a custom type only in the active tenant and records an audit event', async () => {
    const response = await request(app)
      .post('/api/leave-types')
      .set('x-test-organization', 'org-a')
      .send({ name: 'Study Leave', defaultDays: 80, maxConsecutiveDays: 60, paid: true, requiresApproval: true });

    expect(response.status).toBe(201);
    expect(response.body.leaveType).toMatchObject({
      key: 'study-leave',
      name: 'Study Leave',
      defaultDays: 80,
      maxConsecutiveDays: 60,
      effectiveMaxConsecutiveDays: 60,
    });
    const [policyA, policyB, logs] = await Promise.all([
      LeavePolicy.findOne({ organizationId: 'org-a' }),
      LeavePolicy.findOne({ organizationId: 'org-b' }),
      AuditLog.find({ organizationId: 'org-a', action: 'leave_type_created' }),
    ]);
    expect(policyA.leaveTypes.some((item) => item.key === 'study-leave')).toBe(true);
    expect(policyB.leaveTypes.some((item) => item.key === 'study-leave')).toBe(false);
    expect(logs).toHaveLength(1);
  });

  test('applies an employee override with an immutable adjustment and organization audit log', async () => {
    await request(app)
      .post('/api/leave-types')
      .set('x-test-organization', 'org-a')
      .send({ name: 'Study Leave', defaultDays: 8, paid: true });

    const response = await request(app)
      .patch('/api/leave-balances/user/employee-a/entitlements/study-leave')
      .set('x-test-organization', 'org-a')
      .send({ year: 2026, delta: 2, reason: 'Approved examination period', expectedVersion: 0 });

    expect(response.status).toBe(200);
    const entitlement = response.body.balance.entitlements.find((item) => item.leaveTypeKey === 'study-leave');
    expect(entitlement).toMatchObject({ total: 10, policyDefault: 8, source: 'override' });
    const [balance, adjustments, logs] = await Promise.all([
      LeaveBalance.findOne({ organizationId: 'org-a', userId: 'employee-a', year: 2026 }),
      LeaveEntitlementAdjustment.find({ organizationId: 'org-a', userId: 'employee-a' }),
      AuditLog.find({ organizationId: 'org-a', action: 'leave_entitlement_adjusted' }),
    ]);
    expect(balance.getEntitlement('study-leave').total).toBe(10);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ previousTotal: 8, newTotal: 10, delta: 2, reason: 'Approved examination period' });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata.targetUserId).toBe('employee-a');
  });

  test('rejects cross-organization targets and changes without a reason', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const crossTenant = await request(app)
      .patch('/api/leave-balances/user/employee-b/entitlements/annual')
      .set('x-test-organization', 'org-a')
      .send({ year: 2026, delta: 2, reason: 'Should be denied' });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.code).toBe('MEMBER_NOT_FOUND');

    const missingReason = await request(app)
      .patch('/api/leave-balances/user/employee-a/entitlements/annual')
      .set('x-test-organization', 'org-a')
      .send({ year: 2026, delta: 2 });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.code).toBe('REASON_REQUIRED');
    expect(await LeaveEntitlementAdjustment.countDocuments()).toBe(0);
    consoleError.mockRestore();
  });
});
