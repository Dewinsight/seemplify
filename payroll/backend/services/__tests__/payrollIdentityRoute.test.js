const express = require('express');
const axios = require('axios');

jest.mock('axios');

jest.mock('../../middleware/rbac', () => {
  const allow = (req, _res, next) => {
    req.session = {
      user: {
        sub: 'admin-idp-sub',
        name: 'Payroll Admin',
        accessToken: 'verified-session-token',
      },
      currentOrganizationId: 'org-idp',
    };
    req.currentOrganization = { id: 'org-idp', role: 'owner' };
    next();
  };

  return {
    requireAuth: allow,
    requireHRAdmin: allow,
    requireManager: allow,
    requirePermission: () => allow,
  };
});

jest.mock('../../models/PayrollProfile', () => {
  class PayrollProfileMock {
    constructor(values) {
      Object.assign(this, values);
      this.save = jest.fn().mockResolvedValue(this);
    }
  }

  PayrollProfileMock.findOne = jest.fn();
  PayrollProfileMock.find = jest.fn();
  PayrollProfileMock.countDocuments = jest.fn();
  PayrollProfileMock.updateMany = jest.fn();
  return PayrollProfileMock;
});

jest.mock('../OrganizationCurrencyService', () => ({
  getPolicy: jest.fn().mockResolvedValue({}),
  getDefaultPaymentCurrency: jest.fn().mockResolvedValue('NGN'),
  assertPaymentCurrency: jest.fn(async (_organizationId, currency) => currency),
}));

const PayrollProfile = require('../../models/PayrollProfile');
const payrollRouter = require('../../routes/payroll');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', payrollRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

describe('payroll identity ownership routes', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ server, baseUrl } = await startApp());
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('retires arbitrary payroll-only employee creation', async () => {
    const response = await fetch(`${baseUrl}/api/payroll/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'ghost-worker',
        employeeInfo: { name: 'Payroll-only Person' },
        basicSalary: 100000,
      }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYROLL_PROFILE_REQUIRES_IDP_MEMBER',
      replacement: '/api/payroll/profiles/sync-from-idp',
    });
    expect(axios.get).not.toHaveBeenCalled();
    expect(PayrollProfile.findOne).not.toHaveBeenCalled();
  });

  test('does not configure a person absent from the selected IDP organization', async () => {
    axios.get.mockRejectedValueOnce({
      response: { status: 404, data: { error: 'Member not found' } },
    });

    const response = await fetch(`${baseUrl}/api/payroll/profiles/sync-from-idp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'not-an-org-member' }),
    });

    expect(response.status).toBe(404);
    expect(PayrollProfile.findOne).not.toHaveBeenCalled();
  });

  test('initializes only a payroll overlay from the authoritative IDP member', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        id: 'member-record-id',
        sub: 'verified-idp-sub',
        name: 'Verified IDP Worker',
        email: 'verified@example.invalid',
        employeeId: 'IDP-0042',
        designation: 'Analyst',
        departmentName: 'Operations',
        teamIds: ['team-ops'],
        teamNames: ['Operations'],
      },
    });
    PayrollProfile.findOne.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/api/payroll/profiles/sync-from-idp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'member-record-id',
        employeeInfo: { name: 'Forged Browser Name' },
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      identitySource: 'identity_provider',
      existed: false,
      profile: {
        userId: 'verified-idp-sub',
        organizationId: 'org-idp',
        employeeInfo: {
          name: 'Verified IDP Worker',
          email: 'verified@example.invalid',
          employeeId: 'IDP-0042',
        },
        basicSalary: 0,
      },
    });
    expect(payload.profile.employeeInfo.name).not.toBe('Forged Browser Name');
  });
});
