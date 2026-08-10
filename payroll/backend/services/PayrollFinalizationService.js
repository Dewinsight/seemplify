const mongoose = require('mongoose');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');

const APPROVED_REQUEST_STATUSES = ['approved', 'approved_l1', 'approved_l2'];

function payrollFinalizationError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function writeMatchedCount(result) {
  return Number(result?.matchedCount ?? result?.n ?? 0);
}

function collectLoanDeductions(payslips = []) {
  const byUser = new Map();
  for (const payslip of payslips) {
    const userId = String(payslip?.userId || '').trim();
    for (const deduction of payslip?.deductions || []) {
      if (deduction?.type !== 'loan_repayment') continue;
      const name = String(deduction?.name || '').trim();
      const amount = Number(deduction?.amount);
      if (!userId || !name || !Number.isFinite(amount) || amount <= 0) {
        throw payrollFinalizationError(
          'A payroll loan deduction is missing a valid employee, name, or positive amount.',
          409,
          'PAYROLL_LOAN_DEDUCTION_INVALID'
        );
      }

      if (!byUser.has(userId)) byUser.set(userId, new Map());
      const userDeductions = byUser.get(userId);
      userDeductions.set(name, Number(userDeductions.get(name) || 0) + amount);
    }
  }
  return byUser;
}

function collectCompensationRequestIds(payslips = []) {
  const requestIds = new Set();
  for (const payslip of payslips) {
    for (const earning of payslip?.earnings || []) {
      const requestId = String(earning?.linkedRequestId || '').trim();
      if (requestId) requestIds.add(requestId);
    }
  }
  return Array.from(requestIds);
}

class PayrollFinalizationService {
  constructor(dependencies = {}) {
    this.mongoose = dependencies.mongoose || mongoose;
    this.PayrollRun = dependencies.PayrollRun || PayrollRun;
    this.Payslip = dependencies.Payslip || Payslip;
    this.PayrollProfile = dependencies.PayrollProfile || PayrollProfile;
    this.CompensationRequest = dependencies.CompensationRequest || CompensationRequest;
    this.now = dependencies.now || (() => new Date());
  }

  async finalizeRun({ runId, organizationId, adminId, adminName, comments, assertRunReady }) {
    const session = await this.mongoose.startSession();
    try {
      return await session.withTransaction(
        () => this.finalizeRunInTransaction({
          runId,
          organizationId,
          adminId,
          adminName,
          comments,
          assertRunReady,
          session,
        }),
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        }
      );
    } finally {
      await session.endSession();
    }
  }

  async finalizeRunInTransaction({
    runId,
    organizationId,
    adminId,
    adminName,
    comments,
    assertRunReady,
    session,
  }) {
    const finalizedAt = this.now();
    const claimedRun = await this.PayrollRun.findOneAndUpdate(
      { _id: runId, organizationId, status: 'approved' },
      {
        $set: {
          status: 'finalizing',
          finalizationStartedAt: finalizedAt,
          finalizationStartedBy: adminId,
          finalizationStartedByName: adminName,
        },
      },
      { new: true, runValidators: true, session }
    );

    if (!claimedRun) {
      const currentRun = await this.PayrollRun.findOne(
        { _id: runId, organizationId },
        null,
        { session }
      );
      if (!currentRun) {
        throw payrollFinalizationError(
          'Payroll run not found',
          404,
          'PAYROLL_RUN_NOT_FOUND'
        );
      }
      if (['exported', 'paid'].includes(currentRun.status)) return currentRun;
      if (currentRun.status === 'finalizing') {
        const error = payrollFinalizationError(
          'Payroll finalization is already in progress. Retry shortly.',
          409,
          'PAYROLL_FINALIZATION_IN_PROGRESS'
        );
        error.retryable = true;
        throw error;
      }
      throw payrollFinalizationError(
        `Cannot finalize run with status: ${currentRun.status}`,
        409,
        'PAYROLL_RUN_NOT_APPROVED'
      );
    }

    if (typeof assertRunReady === 'function') {
      await assertRunReady(claimedRun);
    }

    const payslips = await this.Payslip.find(
      { payrollRunId: claimedRun._id, organizationId },
      null,
      { session }
    );

    await this.applyLoanDeductions({
      payslips,
      organizationId,
      run: claimedRun,
      session,
    });

    await this.processCompensationRequests({
      payslips,
      organizationId,
      run: claimedRun,
      processedAt: finalizedAt,
      session,
    });

    const payslipUpdate = await this.Payslip.updateMany(
      { payrollRunId: claimedRun._id, organizationId },
      { $set: { status: 'exported' } },
      { session }
    );
    if (writeMatchedCount(payslipUpdate) !== payslips.length) {
      throw payrollFinalizationError(
        'The payroll payslip set changed during finalization. Retry after reviewing the run.',
        409,
        'PAYROLL_PAYSLIP_SET_CHANGED'
      );
    }

    const approval = {
      action: 'finalized',
      actionBy: adminId,
      actionByName: adminName,
      actionByRole: 'hr_admin',
      actionAt: finalizedAt,
      level: Number(claimedRun.currentApprovalLevel || 0) + 1,
    };
    if (comments) approval.comments = comments;

    const finalizedRun = await this.PayrollRun.findOneAndUpdate(
      { _id: claimedRun._id, organizationId, status: 'finalizing' },
      {
        $set: {
          status: 'exported',
          exportedAt: finalizedAt,
          exportedBy: adminId,
          exportedByName: adminName,
        },
        $push: { approvals: approval },
      },
      { new: true, runValidators: true, session }
    );

    if (!finalizedRun) {
      throw payrollFinalizationError(
        'Payroll finalization lost its state claim. No changes were committed.',
        409,
        'PAYROLL_FINALIZATION_CLAIM_LOST'
      );
    }
    return finalizedRun;
  }

  async applyLoanDeductions({ payslips, organizationId, run, session }) {
    const deductionsByUser = collectLoanDeductions(payslips);
    for (const [userId, deductionsByName] of deductionsByUser) {
      const profile = await this.PayrollProfile.findOne(
        { userId, organizationId },
        null,
        { session }
      );
      if (!profile) {
        throw payrollFinalizationError(
          `Payroll profile not found for loan deduction employee ${userId}.`,
          409,
          'PAYROLL_LOAN_PROFILE_NOT_FOUND',
          { userId }
        );
      }

      for (const [name, amount] of deductionsByName) {
        const matches = (profile.recurringDeductions || []).filter((deduction) => (
          deduction?.type === 'loan_repayment'
          && String(deduction?.name || '').trim() === name
        ));
        if (matches.length !== 1) {
          throw payrollFinalizationError(
            `Expected one active loan named "${name}" for employee ${userId}; found ${matches.length}.`,
            409,
            'PAYROLL_LOAN_DEDUCTION_NOT_UNIQUE',
            { userId, name, matches: matches.length }
          );
        }

        const loan = matches[0];
        const remainingAmount = Number(loan.remainingAmount);
        if (!Number.isFinite(remainingAmount) || remainingAmount < 0 || amount - remainingAmount > 1e-9) {
          throw payrollFinalizationError(
            `Loan balance changed for "${name}" on employee ${userId}. Recalculate the payroll run.`,
            409,
            'PAYROLL_LOAN_BALANCE_CHANGED',
            { userId, name, remainingAmount, payrollDeduction: amount }
          );
        }

        const nextRemainingAmount = Math.max(0, remainingAmount - amount);
        loan.remainingAmount = nextRemainingAmount < 1e-9 ? 0 : nextRemainingAmount;
        if (loan.remainingAmount === 0) {
          loan.isActive = false;
          const marker = `[Finalized via Run ${run.runNumber}]`;
          if (!String(loan.notes || '').includes(marker)) {
            loan.notes = [loan.notes, marker].filter(Boolean).join(' ');
          }
        }
      }

      await profile.save({ session, validateModifiedOnly: true });
    }
  }

  async processCompensationRequests({ payslips, organizationId, run, processedAt, session }) {
    const requestIds = collectCompensationRequestIds(payslips);
    if (requestIds.length === 0) return;

    const result = await this.CompensationRequest.updateMany(
      {
        _id: { $in: requestIds },
        organizationId,
        $or: [
          { status: { $in: APPROVED_REQUEST_STATUSES } },
          { status: 'processed', processedInRunId: run._id },
        ],
      },
      {
        $set: {
          status: 'processed',
          processedAt,
          processedInRunId: run._id,
        },
      },
      { session }
    );

    if (writeMatchedCount(result) !== requestIds.length) {
      throw payrollFinalizationError(
        'One or more linked compensation requests are no longer approved for this payroll run.',
        409,
        'PAYROLL_COMPENSATION_REQUEST_CHANGED'
      );
    }
  }
}

module.exports = new PayrollFinalizationService();
module.exports.PayrollFinalizationService = PayrollFinalizationService;
module.exports.collectCompensationRequestIds = collectCompensationRequestIds;
module.exports.collectLoanDeductions = collectLoanDeductions;
