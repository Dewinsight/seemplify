const { PayrollCycleService, hash, periodFromInput, runTotals } = require('../PayrollCycleService');

function run(id, status = 'pending_approval') {
  return {
    _id: id,
    status,
    calculationRevision: 1,
    summary: { currency: id === 'run-ng' ? 'NGN' : 'GBP', processedCount: 1, totalGrossPayroll: 100, totalDeductions: 20, totalNetPayroll: 80, totalEmployerCost: 105 },
    addApproval: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function cycleFor(runs, overrides = {}) {
  const totalsHash = hash(runs.map(runTotals));
  return {
    _id: 'cycle-1', organizationId: 'org-1', status: 'pending_approval', revision: 1,
    totalsHash, submittedRevision: 1, submittedTotalsHash: totalsHash, submittedBy: 'submitter',
    currentApprovalLevel: 0,
    approvalPolicySnapshot: { requireSeparationOfDuties: true, levels: [{ name: 'Approval', roles: ['admin'], minimumApprovals: 1 }] },
    approvals: [],
    childRuns: runs.map(item => ({ payrollRunId: item._id, status: item.status === 'exported' ? 'released' : 'submitted' })),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function workflow(cycle, runs, finalization = { finalizeRun: jest.fn().mockResolvedValue({ status: 'exported' }) }) {
  return {
    service: new PayrollCycleService({
      PayrollCycle: { findOne: jest.fn().mockResolvedValue(cycle) },
      PayrollRun: { find: jest.fn().mockResolvedValue(runs) },
      finalization,
    }),
    finalization,
  };
}

describe('PayrollCycleService controls', () => {
  test('creates canonical monthly boundaries in UTC', () => {
    const period = periodFromInput({ month: 2, year: 2028, paymentDate: '2028-02-25' });
    expect(period.startDate.toISOString()).toBe('2028-02-01T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2028-02-29T23:59:59.999Z');
    expect(period.paymentDate.toISOString()).toBe('2028-02-25T00:00:00.000Z');
  });

  test('rejects invalid periods before any payroll record is created', () => {
    expect(() => periodFromInput({ month: 13, year: 2028 })).toThrow('Month must be 1 to 12');
  });

  test('totals hash is deterministic regardless of object key order', () => {
    expect(hash({ gross: 100, currency: 'GBP' })).toBe(hash({ currency: 'GBP', gross: 100 }));
    expect(hash({ gross: 101, currency: 'GBP' })).not.toBe(hash({ currency: 'GBP', gross: 100 }));
  });

  test('run totals retain native currency and calculation revision', () => {
    expect(runTotals({ _id: 'run-1', calculationRevision: 3, summary: { currency: 'NGN', processedCount: 2, totalGrossPayroll: 5000, totalDeductions: 500, totalNetPayroll: 4500, totalEmployerCost: 5200 } })).toEqual({
      runId: 'run-1', revision: 3, currency: 'NGN', employees: 2, gross: 5000, deductions: 500, net: 4500, employerCost: 5200, errors: 0,
    });
  });

  test('enforces separation of duties before recording approval', async () => {
    const runs = [run('run-ng')];
    const cycle = cycleFor(runs);
    const { service, finalization } = workflow(cycle, runs);
    await expect(service.approveAndRelease('cycle-1', { organizationId: 'org-1', userId: 'submitter', role: 'admin' }, '', jest.fn()))
      .rejects.toMatchObject({ code: 'PAYROLL_SEPARATION_OF_DUTIES', statusCode: 403 });
    expect(finalization.finalizeRun).not.toHaveBeenCalled();
  });

  test('final approval releases every native-currency child run', async () => {
    const runs = [run('run-ng'), run('run-gb')];
    const cycle = cycleFor(runs);
    const { service, finalization } = workflow(cycle, runs);
    const result = await service.approveAndRelease('cycle-1', { organizationId: 'org-1', userId: 'approver', name: 'Approver', role: 'admin' }, 'Approved', jest.fn());
    expect(result.released).toBe(true);
    expect(finalization.finalizeRun).toHaveBeenCalledTimes(2);
    expect(cycle.status).toBe('released');
    expect(cycle.childRuns.every(child => child.status === 'released')).toBe(true);
  });

  test('a release retry skips an already exported child and resumes the failed child', async () => {
    const runs = [run('run-ng', 'exported'), run('run-gb', 'approved')];
    const cycle = cycleFor(runs, { status: 'release_failed', currentApprovalLevel: 1 });
    const { service, finalization } = workflow(cycle, runs);
    const result = await service.approveAndRelease('cycle-1', { organizationId: 'org-1', userId: 'approver', role: 'admin' }, 'Retry', jest.fn());
    expect(result.released).toBe(true);
    expect(finalization.finalizeRun).toHaveBeenCalledTimes(1);
    expect(finalization.finalizeRun.mock.calls[0][0].runId).toBe('run-gb');
  });

  test('preflight reports missing variable-work inputs without mutating payroll', async () => {
    const profileQuery = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ userId: 'hourly-1', workTerms: { payBasis: 'hourly' }, payrollFlags: {} }]) };
    const service = new PayrollCycleService({
      PayrollRun: { existsForPeriod: jest.fn().mockResolvedValue(false) },
      PayrollProfile: { find: jest.fn().mockReturnValue(profileQuery) },
      employers: { assertRunEntity: jest.fn().mockResolvedValue({ entity: { _id: 'entity-1', legalName: 'UK Employer', countryCode: 'GB', jurisdictionCode: 'GB', defaultCurrency: 'GBP' }, readiness: { blockingIssues: [], warnings: [], taxPack: { versionId: 'v1' } } }) },
      currency: { assertReportingCurrency: jest.fn().mockResolvedValue('GBP') },
      exchange: { convert: jest.fn() },
    });
    const result = await service.preflight({ organizationId: 'org-1', employerEntityIds: ['entity-1'], month: 8, year: 2026, reportingCurrency: 'GBP' });
    expect(result.ready).toBe(false);
    expect(result.entities[0].missingVariableInputs).toEqual([{ userId: 'hourly-1', payBasis: 'hourly' }]);
    expect(result.entities[0].blockers[0]).toMatch('variable-paid worker');
  });

  test('a no-approval policy proceeds directly to automatic release', async () => {
    const runs = [run('run-ng')];
    const cycle = cycleFor(runs, { approvalPolicySnapshot: { approvalRequired: false, automaticRelease: true, requireSeparationOfDuties: true, levels: [] } });
    const { service, finalization } = workflow(cycle, runs);
    const result = await service.approveAndRelease('cycle-1', { organizationId: 'org-1', userId: 'system-release:creator', role: 'admin' }, '', jest.fn());
    expect(result.released).toBe(true);
    expect(finalization.finalizeRun).toHaveBeenCalledTimes(1);
  });
});
