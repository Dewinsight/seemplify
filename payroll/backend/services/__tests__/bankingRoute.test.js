jest.mock('../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  requireHRAdmin: (_req, _res, next) => next(),
}));

jest.mock('../../models/BankAccountChangeRequest', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../../models/PayrollProfile', () => ({ findOne: jest.fn() }));

jest.mock('../PayrollCountryAutomationService', () => {
  const actual = jest.requireActual('../PayrollCountryAutomationService');
  return {
    ...actual,
    reconcileProfile: jest.fn(async () => ({ bankComplete: true })),
    applyReadiness: jest.fn(),
  };
});

const BankAccountChangeRequest = require('../../models/BankAccountChangeRequest');
const PayrollProfile = require('../../models/PayrollProfile');
const automation = require('../PayrollCountryAutomationService');
const router = require('../../routes/banking');

function handler(path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function request(body = {}, params = {}) {
  return {
    body,
    params,
    query: {},
    currentOrganization: { id: 'org-1' },
    session: { user: { id: 'employee-1', name: 'Ada Okafor' } },
  };
}

describe('Payroll banking routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('employee change creates a pending request without replacing the active account', async () => {
    const activeAccount = {
      country: 'Nigeria', countryCode: 'NG', bankName: 'Old Bank', accountName: 'Ada Okafor',
      accountNumber: '1111111111', branchCode: '011', accountType: 'current', isPrimary: true,
    };
    const profile = { employeeInfo: { name: 'Ada Okafor' }, taxAssignment: { workCountryCode: 'NG' }, bankAccounts: [activeAccount] };
    PayrollProfile.findOne.mockResolvedValue(profile);
    BankAccountChangeRequest.updateMany.mockResolvedValue({ modifiedCount: 0 });
    BankAccountChangeRequest.create.mockImplementation(async (payload) => ({ ...payload, _id: 'request-1', toObject: () => ({ ...payload, _id: 'request-1' }) }));
    const req = request({ account: {
      country: 'Nigeria', bankName: 'Access Bank', accountName: 'Ada Okafor',
      accountNumber: '1234567890', branchCode: '044', accountType: 'current',
    } });
    const res = response();

    await handler('/requests', 'post')(req, res);

    expect(res.statusCode).toBe(201);
    expect(BankAccountChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', userId: 'employee-1',
      proposedAccount: expect.objectContaining({ bankName: 'Access Bank', branchCode: '044' }),
    }));
    expect(profile.bankAccounts).toEqual([activeAccount]);
  });

  test('HR approval atomically promotes the proposal to the verified payroll account', async () => {
    const change = {
      _id: 'request-1', userId: 'employee-1', status: 'processing',
      proposedAccount: {
        country: 'Nigeria', countryCode: 'NG', bankName: 'Access Bank', accountName: 'Ada Okafor',
        accountNumber: '1234567890', branchCode: '044', accountType: 'current',
      },
      save: jest.fn(async function save() { return this; }),
      toObject() { return { _id: this._id, status: this.status }; },
    };
    BankAccountChangeRequest.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(change) });
    const profile = { taxAssignment: { workCountryCode: 'NG' }, bankAccounts: [], save: jest.fn() };
    PayrollProfile.findOne.mockResolvedValue(profile);
    const req = request({ action: 'approve', comment: 'Verified against evidence' }, { id: 'request-1' });
    req.session.user = { id: 'hr-1', name: 'HR Admin' };
    const res = response();

    await handler('/requests/:id/action', 'post')(req, res);

    expect(res.statusCode).toBe(200);
    expect(profile.bankAccounts[0]).toMatchObject({ bankName: 'Access Bank', isVerified: true, isPrimary: true });
    expect(profile.save).toHaveBeenCalled();
    expect(change).toMatchObject({ status: 'approved', reviewedBy: 'hr-1', reviewComment: 'Verified against evidence' });
    expect(automation.reconcileProfile).toHaveBeenCalled();
  });
});
