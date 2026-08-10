const PayrollRun = require('../../models/PayrollRun');
const Payslip = require('../../models/Payslip');
const PayrollSequence = require('../../models/PayrollSequence');
const payrollSequenceMigrationService = require('../PayrollSequenceMigrationService');

describe('PayrollSequenceMigrationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('seeds counters above existing organization-scoped run and payslip numbers', async () => {
    jest.spyOn(PayrollRun, 'aggregate').mockResolvedValue([{
      _id: { organizationId: 'org-a', yearMonth: '2026-08' }, maxSequence: 7,
    }]);
    jest.spyOn(Payslip, 'aggregate').mockResolvedValue([{
      _id: { organizationId: 'org-a', yearMonth: '2026-08' }, maxSequence: 42,
    }]);
    const bulkWrite = jest.spyOn(PayrollSequence, 'bulkWrite').mockResolvedValue({});

    await expect(payrollSequenceMigrationService.seedCounters()).resolves.toBe(2);
    expect(bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: 'payroll-run:org-a:2026-08' },
          update: { $max: { value: 7 } },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: { _id: 'payslip:org-a:2026-08' },
          update: { $max: { value: 42 } },
          upsert: true,
        },
      },
    ], { ordered: false });
  });
});
