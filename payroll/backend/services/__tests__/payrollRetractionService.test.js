const PayrollRunModel = require('../../models/PayrollRun');
const { PayrollRetractionService } = require('../PayrollRetractionService');

function clone(value) {
  return structuredClone(value);
}

function initialState() {
  return {
    run: {
      _id: 'run-1',
      organizationId: 'org-1',
      runNumber: 'PR-2026-08-001',
      status: 'exported',
      activePeriodKey: 'monthly:2026:08',
      currentApprovalLevel: 1,
      internalNotes: 'Finalized for accounting.',
      approvals: [{ action: 'finalized', actionBy: 'admin-1' }],
    },
    payslips: [{
      _id: 'payslip-1',
      payrollRunId: 'run-1',
      organizationId: 'org-1',
      userId: 'employee-1',
      status: 'exported',
      deductions: [{ type: 'loan_repayment', name: 'Laptop loan', amount: 50 }],
      earnings: [{ type: 'bonus', linkedRequestId: 'request-1', amount: 100 }],
    }],
    profiles: [{
      userId: 'employee-1',
      organizationId: 'org-1',
      recurringDeductions: [{
        type: 'loan_repayment',
        name: 'Laptop loan',
        totalAmount: 200,
        remainingAmount: 150,
        isActive: true,
        notes: '[Finalized via Run PR-2026-08-001]',
      }],
    }],
    requests: [{
      _id: 'request-1',
      organizationId: 'org-1',
      status: 'processed',
      processedInRunId: 'run-1',
      processedAt: new Date('2026-08-31T11:00:00.000Z'),
    }],
    imports: [{
      _id: 'attendance-1',
      organizationId: 'org-1',
      status: 'applied',
      appliedPayrollRunId: 'run-1',
    }],
  };
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
    return expected.$in.some((value) => String(value) === String(actual));
  }
  return String(actual) === String(expected);
}

function matchesIdentity(row, filter) {
  if (!row) return false;
  for (const key of ['_id', 'organizationId', 'userId', 'payrollRunId', 'status', 'processedInRunId', 'appliedPayrollRunId']) {
    if (filter[key] !== undefined && !matchesValue(row[key], filter[key])) return false;
  }
  return true;
}

function applyUpdate(row, update) {
  if (update.$set) Object.assign(row, update.$set);
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) delete row[key];
  }
  if (update.$push?.approvals) row.approvals.push(update.$push.approvals);
}

function createHarness(seed = initialState()) {
  let persistentState = clone(seed);
  let transactionTail = Promise.resolve();
  let failAt = null;
  const stats = {
    sessionsStarted: 0,
    sessionsEnded: 0,
    profileSaves: 0,
    requestUpdates: 0,
    attendanceUpdates: 0,
    payslipDeletes: 0,
  };

  async function acquireTransactionLock() {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }

  function transactionState(options) {
    if (!options?.session?.state) {
      throw new Error('Expected every database operation to use the transaction session');
    }
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
    findOne: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      return matchesIdentity(state.run, filter) ? state.run : null;
    }),
    findOneAndUpdate: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      if (!matchesIdentity(state.run, filter)) return null;
      if (failAt === 'finalRunUpdate' && filter.status === 'retracting') {
        throw new Error('Injected final run update failure');
      }
      applyUpdate(state.run, update);
      return state.run;
    }),
  };

  const Payslip = {
    find: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      return state.payslips.filter((payslip) => matchesIdentity(payslip, filter));
    }),
    deleteMany: jest.fn(async (filter, options) => {
      const state = transactionState(options);
      stats.payslipDeletes += 1;
      if (failAt === 'payslipDelete') throw new Error('Injected payslip delete failure');
      const retained = state.payslips.filter((payslip) => !matchesIdentity(payslip, filter));
      const deletedCount = state.payslips.length - retained.length;
      state.payslips = retained;
      return { deletedCount };
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
          if (saveOptions?.session !== options.session) {
            throw new Error('Profile save escaped the transaction session');
          }
          stats.profileSaves += 1;
          if (failAt === 'profileSave') throw new Error('Injected profile save failure');
          return profile;
        }),
      };
    }),
  };

  const CompensationRequest = {
    find: jest.fn(async (filter, _projection, options) => {
      const state = transactionState(options);
      return state.requests.filter((request) => matchesIdentity(request, filter));
    }),
    updateMany: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      stats.requestUpdates += 1;
      if (failAt === 'requestUpdate') throw new Error('Injected request update failure');
      const matches = state.requests.filter((request) => matchesIdentity(request, filter));
      for (const request of matches) applyUpdate(request, update);
      return { matchedCount: matches.length, modifiedCount: matches.length };
    }),
  };

  const TimeAttendanceImport = {
    updateMany: jest.fn(async (filter, update, options) => {
      const state = transactionState(options);
      stats.attendanceUpdates += 1;
      if (failAt === 'attendanceUpdate') throw new Error('Injected attendance update failure');
      const matches = state.imports.filter((item) => matchesIdentity(item, filter));
      for (const item of matches) applyUpdate(item, update);
      return { matchedCount: matches.length, modifiedCount: matches.length };
    }),
  };

  const service = new PayrollRetractionService({
    mongoose,
    PayrollRun,
    Payslip,
    PayrollProfile,
    CompensationRequest,
    TimeAttendanceImport,
    now: () => new Date('2026-09-02T12:00:00.000Z'),
  });

  return {
    service,
    stats,
    state: () => clone(persistentState),
    failAt: (value) => { failAt = value; },
  };
}

const retractionInput = {
  runId: 'run-1',
  organizationId: 'org-1',
  adminId: 'admin-2',
  adminName: 'Organization Admin',
  comments: 'Correct employee input',
};

describe('PayrollRetractionService', () => {
  test('the PayrollRun schema accepts the transactional retracting state', () => {
    const run = new PayrollRunModel({
      runNumber: 'PR-2026-08-001',
      organizationId: 'org-1',
      createdBy: 'admin-1',
      status: 'retracting',
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

  test('atomically restores loans, reopens requests, deletes payslips, and cancels the run', async () => {
    const harness = createHarness();

    const result = await harness.service.retractRun(retractionInput);
    const state = harness.state();

    expect(result).toMatchObject({
      deletedPayslips: 1,
      resetCompensationRequests: 1,
      resetTimeAttendanceImports: 1,
      alreadyRetracted: false,
      run: { status: 'cancelled' },
    });
    expect(state.run).toMatchObject({
      status: 'cancelled',
      retractedBy: 'admin-2',
      retractedByName: 'Organization Admin',
      retractionReason: 'Correct employee input',
      retractionSummary: {
        originalStatus: 'exported',
        deletedPayslips: 1,
        resetCompensationRequests: 1,
        resetTimeAttendanceImports: 1,
      },
    });
    expect(state.run.activePeriodKey).toBeUndefined();
    expect(state.run.approvals).toHaveLength(2);
    expect(state.run.approvals[1]).toMatchObject({
      action: 'retracted',
      actionBy: 'admin-2',
      comments: 'Correct employee input',
    });
    expect(state.profiles[0].recurringDeductions[0]).toMatchObject({
      remainingAmount: 200,
      isActive: true,
    });
    expect(state.profiles[0].recurringDeductions[0].notes).toContain('[Retracted via Run PR-2026-08-001]');
    expect(state.requests[0]).toMatchObject({ status: 'approved', processedInRunId: null });
    expect(state.requests[0].processedAt).toBeUndefined();
    expect(state.imports[0]).toMatchObject({ status: 'accepted' });
    expect(state.imports[0].appliedPayrollRunId).toBeUndefined();
    expect(state.payslips).toHaveLength(0);
    expect(harness.stats).toMatchObject({
      sessionsStarted: 1,
      sessionsEnded: 1,
      profileSaves: 1,
      requestUpdates: 1,
      attendanceUpdates: 1,
      payslipDeletes: 1,
    });
  });

  test('a retry after success is idempotent and reports the committed retraction summary', async () => {
    const harness = createHarness();

    await harness.service.retractRun(retractionInput);
    const retryResult = await harness.service.retractRun(retractionInput);
    const state = harness.state();

    expect(retryResult).toMatchObject({
      deletedPayslips: 1,
      resetCompensationRequests: 1,
      resetTimeAttendanceImports: 1,
      alreadyRetracted: true,
      run: { status: 'cancelled' },
    });
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(200);
    expect(state.run.approvals).toHaveLength(2);
    expect(harness.stats.profileSaves).toBe(1);
    expect(harness.stats.requestUpdates).toBe(1);
    expect(harness.stats.attendanceUpdates).toBe(1);
    expect(harness.stats.payslipDeletes).toBe(1);
  });

  test('attendance-linked earnings do not become compensation request ids during retraction', async () => {
    const seed = initialState();
    seed.payslips[0].earnings.push({
      type: 'overtime',
      linkedRequestId: 'time-attendance:507f1f77bcf86cd799439011',
      amount: 75,
    });
    const harness = createHarness(seed);

    await expect(harness.service.retractRun(retractionInput))
      .resolves.toMatchObject({ resetCompensationRequests: 1, resetTimeAttendanceImports: 1 });
    expect(harness.state().requests[0].status).toBe('approved');
  });

  test('concurrent retraction requests serialize on the run claim', async () => {
    const harness = createHarness();

    const results = await Promise.all([
      harness.service.retractRun(retractionInput),
      harness.service.retractRun(retractionInput),
    ]);
    const state = harness.state();

    expect(results.map((result) => result.run.status)).toEqual(['cancelled', 'cancelled']);
    expect(results.map((result) => result.alreadyRetracted)).toEqual([false, true]);
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(200);
    expect(state.run.approvals).toHaveLength(2);
    expect(harness.stats.profileSaves).toBe(1);
  });

  test('rolls every mutation back on failure and permits a clean retry', async () => {
    const harness = createHarness();
    harness.failAt('payslipDelete');

    await expect(harness.service.retractRun(retractionInput))
      .rejects.toThrow('Injected payslip delete failure');
    expect(harness.state()).toEqual(initialState());

    harness.failAt(null);
    await expect(harness.service.retractRun(retractionInput))
      .resolves.toMatchObject({ run: { status: 'cancelled' } });
    const recoveredState = harness.state();
    expect(recoveredState.profiles[0].recurringDeductions[0].remainingAmount).toBe(200);
    expect(recoveredState.run.approvals).toHaveLength(2);
  });

  test('rolls the retraction back when attendance reopening fails', async () => {
    const harness = createHarness();
    harness.failAt('attendanceUpdate');

    await expect(harness.service.retractRun(retractionInput))
      .rejects.toThrow('Injected attendance update failure');
    expect(harness.state()).toEqual(initialState());
  });

  test('organization scope is applied to the run claim and every mutation', async () => {
    const harness = createHarness();

    await expect(harness.service.retractRun({
      ...retractionInput,
      organizationId: 'org-2',
    })).rejects.toMatchObject({ statusCode: 404, code: 'PAYROLL_RUN_NOT_FOUND' });

    expect(harness.state()).toEqual(initialState());
    expect(harness.stats.profileSaves).toBe(0);
  });

  test('a changed compensation request aborts without committing the loan restoration', async () => {
    const seed = initialState();
    seed.requests[0].status = 'cancelled';
    const harness = createHarness(seed);

    await expect(harness.service.retractRun(retractionInput)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_RETRACTION_COMPENSATION_REQUEST_CHANGED',
    });

    const state = harness.state();
    expect(state.run.status).toBe('exported');
    expect(state.profiles[0].recurringDeductions[0].remainingAmount).toBe(150);
    expect(state.payslips).toHaveLength(1);
    expect(state.requests[0].status).toBe('cancelled');
  });
});
