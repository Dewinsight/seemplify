const CompensationApprovalPolicy = require('../../models/CompensationApprovalPolicy');
const CompensationRequest = require('../../models/CompensationRequest');
const PayrollApprovalPolicy = require('../../models/PayrollApprovalPolicy');
const PayrollProfile = require('../../models/PayrollProfile');
const {
  defaultCompensationPolicy,
  seedDefaultCompensationPolicies,
} = require('../compensationPolicyService');

afterEach(() => jest.restoreAllMocks());

describe('manual overtime default policy seeding', () => {
  test('creates safe defaults', () => {
    expect(defaultCompensationPolicy('org-1')).toMatchObject({
      organizationId: 'org-1',
      approvalRequired: true,
      requireSeparationOfDuties: true,
      defaultOvertimeMultiplier: 1.5,
      allowMultiplierOverride: false,
      preventTimesheetOverlap: true,
      maximumHoursPerRequest: 24,
      approverRoles: ['hr_admin'],
    });
  });

  test('discovers tenants and inserts each missing policy once', async () => {
    jest.spyOn(CompensationApprovalPolicy, 'distinct').mockResolvedValue(['org-1']);
    jest.spyOn(CompensationRequest, 'distinct').mockResolvedValue(['org-1', 'org-2']);
    jest.spyOn(PayrollApprovalPolicy, 'distinct').mockResolvedValue([]);
    jest.spyOn(PayrollProfile, 'distinct').mockResolvedValue(['org-2']);
    jest.spyOn(CompensationApprovalPolicy, 'exists').mockImplementation(({ organizationId }) => Promise.resolve(organizationId === 'org-1'));
    const update = jest.spyOn(CompensationApprovalPolicy, 'findOneAndUpdate').mockResolvedValue({ organizationId: 'org-2' });

    await expect(seedDefaultCompensationPolicies()).resolves.toEqual({ organizations: 2, created: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({ organizationId: 'org-2' });
  });

  test('allows only supported non-empty approver roles', () => {
    const missing = new CompensationApprovalPolicy({ organizationId: 'org-empty', approverRoles: [] }).validateSync();
    const unsupported = new CompensationApprovalPolicy({ organizationId: 'org-unsupported', approverRoles: ['employee'] }).validateSync();
    expect(missing.errors.approverRoles).toBeDefined();
    expect(unsupported.errors['approverRoles.0']).toBeDefined();
  });
});
