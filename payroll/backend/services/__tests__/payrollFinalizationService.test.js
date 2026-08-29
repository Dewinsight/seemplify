const PayrollRunModel = require('../../models/PayrollRun');
const { PayrollFinalizationService } = require('../PayrollFinalizationService');

function clone(value) {
  return structuredClone(value);
}

function initialState() {
  return {
    run: {
      _id: 'run-1',
      organizationId: 'org-1',
      runNumber: 'PR-2026-08-001',
      status: 'approved',
      currentApprovalLevel: 1,
      approvals: [],
    },
    payslips: [{
      _id: 'payslip-1',
      payrollRunId: 'run-1',
      organizationId: 'org-1',
      userId: 'employee-1',
      status: 'approved',
      deductions: [{ type: 'loan_repayment', name: 'Laptop loan', amount: 50 }],
      earnings: [{ type: 'bonus', linkedRequestId: 'request-1', amount: 100 }],
    }],
    profiles: [{
      userId: 'employee-1',
      organizationId: 'org-1',
      recurringDeductions: [{
        type: 'loan_repayment',
        name: 'Laptop loan',
        remainingAmount: 200,
        isActive: true,
        notes: '',
      }],
    }],
    requests: [{
      _id: 'request-1',
      organizationId: 'org-1',
      status: 'approved',
      processedInRunId: null,
      processedAt: null,
    }],
  };
}

function matchesIdentity(row, filter) {
  if (!row) return false;
  if (filter._id !== undefined && String(row._id) !== String(filter._id)) return false;
  if (filter.organizationId !== undefined && row.organizationId !== filter.organizationId) return false;
  if (filter.userId !== undefined && row.userId !== filter.userId) return false;
  if (filter.payrollRunId !== undefined && String(row.payrollRunId) !== String(filter.payrollRunId)) return false;
  if (filter.status !== undefined && row.status !== filter.status) return false;
  return true;
}

function createHarness(seed = initialState()) {
  let persistentState = clone(seed);
  let transactionTail = Promise.resolve();
  let failAt = null;
  const stats = {
    sessionsStarted: 0,
    sessionsEnded: 0,
    profileSaves: 0,
  };

  async function acquireTransactionLock() {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }

  function transactionState(options) {
    if (!options?.session?.state) throw new Error('Expected every database operation to use the transaction session');
    return options.session.state;
  }

  const mongoose = {
    startSession: jest.fn(async () => {
      stats.sessionsStarted += 1;
      const session = {
        state: null,
        withTransaction: jest.fn(async (callback) => {
          const release = await acquireTransactionLock();
          session.state = clone(persistentState);
          try {
            const result = await callback();
            persistentState = clone(session.state);
            return result;
          } finally {
            session.state = null;
            release();
          }
        }),
        endSession: jest.fn(async () => {
          stats.sessionsEnded += 1;
        }),
      };
      return session;
    }),
  };

  const PayrollRun = {
    findOneAndUpdate: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      if (!matchesIdentity(state.run, filter)) return null;
      if (update.$set) Object.assign(state.run, update.$set);
      if (update.$push?.approvals) state.run.approvals.push(update.$push.approvals);
      return state.run;
    }),
    findOne: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      return matchesIdentity(state.run, filter) ? state.run : null;
    }),
  };

  const Payslip = {
    find: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      return state.payslips.filter((payslip) => matchesIdentity(payslip, filter));
    }),
    updateMany: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      if (failAt === 'payslipUpdate') throw new Error('Injected payslip update failure');
      const matches = state.payslips.filter((payslip) => matchesIdentity(payslip, filter));
      for (const payslip of matches) Object.assign(payslip, update.$set || update);
      return { matchedCount: matches.length, modifiedCount: matches.length };
    }),
  };

  const PayrollProfile = {
    findOne: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      const profile = state.profiles.find((candidate) => matchesIdentity(candidate, filter));
      if (!profile) return null;
      return {
        ...profile,
        recurringDeductions: profile.recurringDeductions,
        save: jest.fn(async (saveOptions) => {
          if (saveOptions?.session !== options.session) throw new Error('Profile save escaped the transaction session');
          stats.profileSaves += 1;
          if (failAt === 'profileSave') throw new Error('Injected profile save failure');
          return profile;
        }),
      };
    }),
  };

  const CompensationRequest = {
    updateMany: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      if (failAt === 'requestUpdate') throw new Error('Injected request update failure');
      const ids = new Set((filter._id?.$in || []).map(String));
      const approvedStatuses = new Set(['approved', 'approved_l1', 'approved_l2']);
      const matches = state.requests.filter((request) => (
        ids.has(String(request._id))
        && request.organizationId === filter.organizationId
        && (
          approvedStatuses.has(request.status)
          || (request.status === 'processed' && String(request.processedInRunId) === String(state.run._id))
        )
      ));
      for (const request of matches) Object.assign(request, update.$set || {});
      return { matchedCount: matches.length, modifiedCount: matches.length };
    }),
  };

  const service = new PayrollFinalizationService({
    mongoose,
    PayrollRun,
    Payslip,
    PayrollProfile,
    CompensationRequest,
    now: () => new Date('2026-08-31T12:00:00.000Z'),
  });

  return {
    service,
    stats,
    state: () => clone(persistentState),
    failAt: (value) => { failAt = value; },
  };
}

const finalizationInput = {
  runId: 'run-1',
  organizationId: 'org-1',
  adminId: 'admin-1',
  adminName: 'Payroll Admin',
  comments: 'Ready for accounting',
  assertRunReady: jest.fn(),
};

describe('PayrollFinalizationService', () => {
  beforeEach(() => {
    finalizationInput.assertRunReady.mockClear();
  });

  test('the PayrollRun schema accepts the transactional finalizing state', () => {
    const run = new PayrollRunModel({
      runNumber: 'PR-2026-08-001',
      organizationId: 'org-1',
      createdBy: 'admin-1',
      status: 'finalizing',
      payPeriod: {
        type: 'monthly',
        month: 8,
        year: 2026,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T00:00:00.000Z'),
        paymentDate: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    expect(run.validateSync()).toBeUndefined();
  });

  test('atomically finalizes loans, requests, payslips, and the run', async () => {
    const harness = createHarness();

    const result = await harness.service.finalizeRun(finalizationInput);
    const state = harness.state();

    expect(result.status).toBe('exported');
    expect(state.run).toMatchObject({
      status: 'exported',
      exportedBy: 'admin-1',
      exportedByName: 'Payroll Admin',
      finalizationStartedBy: 'admin-1',
    });
    expect(state.run.approvals).toEqual([
      expect.objectContaining({ action: 'finalized', actionBy: 'admin-1', comments: 'Ready for accounting' }),
    ]);
    expect(state.profiles[0].recurringDeductions[0]).toMatchObject({
      remainingAmount: 150,
      isActive: true,
    });
    expect(state.requests[0]).toMatchObject({ status: 'processed', processedInRunId: 'run-1' });
    expect(state.payslips[0].status).toBe('exported');
    expect(harness.stats).toMatchObject({ sessionsStarted: 1, sessionsEnded: 1, profileSaves: 1 });
    expect(finalizationInput.assertRunReady).toHaveBeenCalledTimes(1);
  });

  test('a retry after success is idempotent and does not debit the loan twice', async () => {
    const harness = createHarness();

    await harness.service.finalizeRun(finalizationInput);
    const retryResult = await harness.service.finalizeRun(finalizationInput);
    const state = harness.state();

    expect(retryResult.status).toBe('exported');
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(150);
    expect(state.run.approvals).toHaveLength(1);
    expect(harness.stats.profileSaves).toBe(1);
  });

  test('attendance-linked earnings are not cast as compensation request ids', async () => {
    const seed = initialState();
    seed.payslips[0].earnings.push({
      type: 'overtime',
      linkedRequestId: 'time-attendance:507f1f77bcf86cd799439011',
      amount: 75,
    });
    const harness = createHarness(seed);

    await expect(harness.service.finalizeRun(finalizationInput))
      .resolves.toMatchObject({ status: 'exported' });
    expect(harness.state().requests[0]).toMatchObject({ status: 'processed', processedInRunId: 'run-1' });
  });

  test('concurrent finalization requests serialize on the approved claim', async () => {
    const harness = createHarness();

    const results = await Promise.all([
      harness.service.finalizeRun(finalizationInput),
      harness.service.finalizeRun(finalizationInput),
    ]);
    const state = harness.state();

    expect(results.map((run) => run.status)).toEqual(['exported', 'exported']);
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(150);
    expect(state.run.approvals).toHaveLength(1);
    expect(harness.stats.profileSaves).toBe(1);
  });

  test('rolls every mutation back on failure and permits a clean retry', async () => {
    const harness = createHarness();
    harness.failAt('payslipUpdate');

    await expect(harness.service.finalizeRun(finalizationInput))
      .rejects.toThrow('Injected payslip update failure');
    expect(harness.state()).toEqual(initialState());

    harness.failAt(null);
    await expect(harness.service.finalizeRun(finalizationInput))
      .resolves.toMatchObject({ status: 'exported' });
    const recoveredState = harness.state();
    expect(recoveredState.profiles[0].recurringDeductions[0].remainingAmount).toBe(150);
    expect(recoveredState.run.approvals).toHaveLength(1);
  });

  test('organization scope is applied to the claim and every retry read', async () => {
    const harness = createHarness();

    await expect(harness.service.finalizeRun({
      ...finalizationInput,
      organizationId: 'org-2',
    })).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_RUN_NOT_FOUND' });

    expect(harness.state()).toEqual(initialState());
    expect(harness.stats.profileSaves).toBe(0);
  });

  test('a changed linked request aborts before any loan debit is committed', async () => {
    const seed = initialState();
    seed.requests[0].status = 'rejected';
    const harness = createHarness(seed);

    await expect(harness.service.finalizeRun(finalizationInput)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_COMPENSATION_REQUEST_CHANGED',
    });

    const state = harness.state();
    expect(state.run.status).toBe('approved');
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(200);
    expect(state.payslips[0].status).toBe('approved');
    expect(state.requests[0].status).toBe('rejected');
  });
});
