const crypto = require('crypto');

const LeaveBalance = require('../models/LeaveBalance');
const LeaveRequest = require('../models/LeaveRequest');
const {
  getDefaultLeaveTypes,
  normalizeLeaveTypeKey,
  serializeBalance,
  synchronizeEntitlements,
} = require('../services/leaveEntitlementService');
const { fetchOrganizationRoster } = require('../services/rosterService');
const { buildLeaveData, buildPerformanceLeaveData } = require('../services/attendanceIntegrationService');

describe('dynamic leave entitlement contracts', () => {
  test('shares a privacy-safe leave label with attendance without sharing the reason', () => {
    const data = buildLeaveData({
      _id: { toString: () => 'leave-1' },
      organizationId: 'org-1',
      userId: 'employee-1',
      leaveType: 'study',
      leaveTypeName: 'Study Leave',
      startDate: new Date('2026-08-10T00:00:00Z'),
      endDate: new Date('2026-08-12T00:00:00Z'),
      timezone: 'Europe/London',
      status: 'approved',
      updatedAt: new Date('2026-08-01T12:00:00Z'),
      reason: 'Private examination details',
    });

    expect(data).toMatchObject({ leaveType: 'study', leaveTypeName: 'Study Leave' });
    expect(data).not.toHaveProperty('reason');
    expect(buildPerformanceLeaveData(data)).not.toHaveProperty('leaveTypeName');
  });

  test('seeds migration-safe defaults from legacy policy values', () => {
    const defaults = getDefaultLeaveTypes({ annualLeaveDays: 30, sickLeaveDays: 12 });
    expect(defaults.find((item) => item.key === 'annual').defaultDays).toBe(30);
    expect(defaults.find((item) => item.key === 'sick').defaultDays).toBe(12);
    expect(defaults.find((item) => item.key === 'unpaid').paid).toBe(false);
  });

  test('normalizes administrator-created leave type keys', () => {
    expect(normalizeLeaveTypeKey('  Study & Exam Leave  ')).toBe('study-exam-leave');
    expect(normalizeLeaveTypeKey('---')).toBe('');
  });

  test('synchronizes policy defaults without overwriting employee overrides', () => {
    const balance = new LeaveBalance({
      userId: 'employee-1', userEmail: 'person@example.com', organizationId: 'org-1', year: 2026,
      entitlements: [
        { leaveTypeKey: 'annual', leaveTypeName: 'Annual Leave', total: 25, used: 2, remaining: 23, pending: 1, policyDefault: 20, source: 'override' },
        { leaveTypeKey: 'sick', leaveTypeName: 'Sick Leave', total: 10, used: 1, remaining: 9, pending: 0, policyDefault: 10, source: 'policy' },
      ],
    });
    const policy = {
      leaveTypes: [
        { key: 'annual', name: 'Annual Leave', defaultDays: 30, active: true, paid: true, order: 10 },
        { key: 'sick', name: 'Wellbeing Leave', defaultDays: 15, active: true, paid: true, order: 20 },
        { key: 'study', name: 'Study Leave', defaultDays: 5, active: true, paid: true, order: 30 },
      ],
    };

    expect(synchronizeEntitlements(balance, policy)).toBe(true);
    expect(balance.getEntitlement('annual').total).toBe(25);
    expect(balance.getEntitlement('annual').policyDefault).toBe(30);
    expect(balance.getEntitlement('sick').total).toBe(15);
    expect(balance.getEntitlement('sick').leaveTypeName).toBe('Wellbeing Leave');
    expect(balance.getEntitlement('study').total).toBe(5);
  });

  test('preserves a legacy individual balance difference as an override during migration', () => {
    const balance = new LeaveBalance({
      userId: 'employee-legacy', userEmail: 'legacy@example.com', organizationId: 'org-1', year: 2026,
      annual: { total: 27, used: 3, remaining: 24, pending: 1 },
      entitlements: [],
    });
    synchronizeEntitlements(balance, {
      leaveTypes: [{ key: 'annual', name: 'Annual Leave', defaultDays: 20, active: true, paid: true, order: 10 }],
    });
    expect(balance.getEntitlement('annual')).toMatchObject({
      total: 27,
      used: 3,
      pending: 1,
      source: 'override',
      policyDefault: 20,
      overrideReason: 'Migrated from an existing individual balance',
    });
  });

  test('reserves, uses, and restores a custom leave type', () => {
    const balance = new LeaveBalance({
      userId: 'employee-1', userEmail: 'person@example.com', organizationId: 'org-1', year: 2026,
      entitlements: [{ leaveTypeKey: 'study', leaveTypeName: 'Study Leave', total: 8, remaining: 8, used: 0, pending: 0, policyDefault: 8, source: 'policy' }],
    });
    expect(balance.hasBalance('study', 3)).toEqual({ hasBalance: true, available: 8 });
    balance.reserveBalance('study', 3);
    expect(balance.getEntitlement('study').pending).toBe(3);
    balance.useBalance('study', 3);
    expect(balance.getEntitlement('study').used).toBe(3);
    expect(balance.getEntitlement('study').pending).toBe(0);
    balance.restoreBalance('study', 2);
    expect(balance.getEntitlement('study').used).toBe(1);
  });

  test('serializes active state and available days for the UI', () => {
    const balance = new LeaveBalance({
      userId: 'employee-1', userEmail: 'person@example.com', organizationId: 'org-1', year: 2026,
      entitlements: [{ leaveTypeKey: 'study', leaveTypeName: 'Study Leave', total: 8, remaining: 6, used: 2, pending: 1, policyDefault: 8, source: 'policy' }],
    });
    const result = serializeBalance(balance, { leaveTypes: [{ key: 'study', name: 'Study Leave', defaultDays: 8, active: false, paid: true, order: 1 }] });
    expect(result.entitlements[0]).toMatchObject({ available: 5, active: false, total: 8 });
  });

  test('accepts custom leave type keys on requests while retaining a display snapshot', async () => {
    const request = new LeaveRequest({
      userId: 'employee-1', userEmail: 'person@example.com', organizationId: 'org-1',
      leaveType: 'study-leave', leaveTypeName: 'Study Leave', startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-02'), numberOfDays: 2,
    });
    await expect(request.validate()).resolves.toBeUndefined();
    expect(request.leaveType).toBe('study-leave');
  });
});

describe('Identity Provider roster client', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', IDP_INTERNAL_API_URL: 'http://idp.test', LEAVE_IDP_SERVICE_SECRET: 'shared-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('signs the request and maps the organization roster to OIDC subjects', async () => {
    global.fetch = jest.fn(async (_url, options) => {
      const timestamp = options.headers['x-service-timestamp'];
      const expected = crypto.createHmac('sha256', 'shared-secret')
        .update(`${timestamp}.${options.body}`)
        .digest('hex');
      expect(options.headers['x-service-signature']).toBe(`sha256=${expected}`);
      return {
        ok: true,
        json: async () => ({ memberships: [
          { userId: 'mongo-id', idpSubject: 'oidc-sub', email: 'employee@example.com', name: 'Employee One', status: 'active', teamIds: ['team-1'] },
          { userId: 'inactive-id', idpSubject: 'inactive-sub', email: 'inactive@example.com', status: 'inactive' },
        ] }),
      };
    });
    const roster = await fetchOrganizationRoster('org-1');
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ userId: 'oidc-sub', accountId: 'mongo-id', name: 'Employee One' });
  });

  test('fails closed in production without an internal service secret', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'production', IDP_INTERNAL_API_URL: 'http://idp.test' };
    delete process.env.INTERNAL_SERVICE_SECRET;
    delete process.env.LEAVE_IDP_SERVICE_SECRET;
    await expect(fetchOrganizationRoster('org-1')).rejects.toThrow('authentication is not configured');
  });
});
