const mongoose = require('mongoose');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const TimeAttendanceImport = require('../models/TimeAttendanceImport');

const RETRACTION_BLOCKED_STATUSES = new Set([
  'calculating',
  'finalizing',
  'retracting',
  'processing_payment',
]);
const FINALIZED_STATUSES = new Set(['exported', 'paid', 'partially_paid']);

function payrollRetractionError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function writeMatchedCount(result) {
  return Number(result?.matchedCount ?? result?.n ?? 0);
}

function writeDeletedCount(result) {
  return Number(result?.deletedCount ?? result?.n ?? 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
        throw payrollRetractionError(
          'A payroll loan deduction is missing a valid employee, name, or positive amount.',
          409,
          'PAYROLL_LOAN_DEDUCTION_INVALID'
        );
      }

      if (!byUser.has(userId)) byUser.set(userId, new Map());
      const userDeductions = byUser.get(userId);
      userDeductions.set(name, roundMoney(Number(userDeductions.get(name) || 0) + amount));
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

class PayrollRetractionService {
  constructor(dependencies = {}) {
    this.mongoose = dependencies.mongoose || mongoose;
    this.PayrollRun = dependencies.PayrollRun || PayrollRun;
    this.Payslip = dependencies.Payslip || Payslip;
    this.PayrollProfile = dependencies.PayrollProfile || PayrollProfile;
    this.CompensationRequest = dependencies.CompensationRequest || CompensationRequest;
    this.TimeAttendanceImport = dependencies.TimeAttendanceImport || TimeAttendanceImport;
    this.now = dependencies.now || (() => new Date());
  }

  async retractRun({ runId, organizationId, adminId, adminName, comments }) {
    const session = await this.mongoose.startSession();
    try {
      return await session.withTransaction(
        () => this.retractRunInTransaction({
          runId,
          organizationId,
          adminId,
          adminName,
          comments,
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

  async retractRunInTransaction({
    runId,
    organizationId,
    adminId,
    adminName,
    comments,
    session,
  }) {
    const currentRun = await this.PayrollRun.findOne(
      { _id: runId, organizationId },
      null,
      { session }
    );
    if (!currentRun) {
      throw payrollRetractionError(
        'Payroll run not found',
        404,
        'PAYROLL_RUN_NOT_FOUND'
      );
    }

    if (currentRun.status === 'cancelled') {
      return {
        run: currentRun,
        deletedPayslips: Number(currentRun.retractionSummary?.deletedPayslips || 0),
        resetCompensationRequests: Number(currentRun.retractionSummary?.resetCompensationRequests || 0),
        resetTimeAttendanceImports: Number(currentRun.retractionSummary?.resetTimeAttendanceImports || 0),
        alreadyRetracted: true,
      };
    }

    if (RETRACTION_BLOCKED_STATUSES.has(currentRun.status)) {
      const error = payrollRetractionError(
        currentRun.status === 'retracting'
          ? 'Payroll retraction is already in progress. Retry shortly.'
          : `Cannot retract run while status is ${currentRun.status}`,
        409,
        currentRun.status === 'retracting'
          ? 'PAYROLL_RETRACTION_IN_PROGRESS'
          : 'PAYROLL_RETRACTION_STATUS_BLOCKED'
      );
      if (currentRun.status === 'retracting') error.retryable = true;
      throw error;
    }

    const originalStatus = currentRun.status;
    const retractedAt = this.now();
    const claimedRun = await this.PayrollRun.findOneAndUpdate(
      { _id: runId, organizationId, status: originalStatus },
      {
        $set: {
          status: 'retracting',
          retractionStartedAt: retractedAt,
          retractionStartedBy: adminId,
          retractionStartedByName: adminName,
        },
      },
      { new: true, runValidators: true, session }
    );
    if (!claimedRun) {
      const error = payrollRetractionError(
        'Payroll retraction lost its state claim. Retry shortly.',
        409,
        'PAYROLL_RETRACTION_CLAIM_LOST'
      );
      error.retryable = true;
      throw error;
    }

    const payslips = await this.Payslip.find(
      { payrollRunId: claimedRun._id, organizationId },
      null,
      { session }
    );

    if (FINALIZED_STATUSES.has(originalStatus)) {
      await this.restoreLoanDeductions({
        payslips,
        organizationId,
        run: claimedRun,
        session,
      });
    }

    const resetCompensationRequests = await this.resetCompensationRequests({
      payslips,
      organizationId,
      run: claimedRun,
      requireLinkedRequests: FINALIZED_STATUSES.has(originalStatus),
      session,
    });
    const resetTimeAttendanceImports = await this.resetTimeAttendanceImports({
      organizationId,
      run: claimedRun,
      session,
    });

    const deleteResult = await this.Payslip.deleteMany(
      { payrollRunId: claimedRun._id, organizationId },
      { session }
    );
    const deletedPayslips = writeDeletedCount(deleteResult);
    if (deletedPayslips !== payslips.length) {
      throw payrollRetractionError(
        'The payroll payslip set changed during retraction. No changes were committed.',
        409,
        'PAYROLL_RETRACTION_PAYSLIP_SET_CHANGED'
      );
    }

    const retractionReason = comments || 'Retracted by organization admin';
    const approval = {
      action: 'retracted',
      actionBy: adminId,
      actionByName: adminName,
      actionByRole: 'admin',
      actionAt: retractedAt,
      comments: comments || 'Retracted payroll run',
      level: Number(claimedRun.currentApprovalLevel || 0) + 1,
    };
    const warningNotes = [
      `Retracted on ${retractedAt.toISOString()} by ${adminName || adminId}.`,
      `Removed ${deletedPayslips} payslip(s).`,
      `Reset ${resetCompensationRequests} processed compensation request(s).`,
      `Reopened ${resetTimeAttendanceImports} Time and Attendance import(s).`,
    ];
    const internalNotes = [claimedRun.internalNotes, ...warningNotes].filter(Boolean).join(' ');

    const retractedRun = await this.PayrollRun.findOneAndUpdate(
      { _id: claimedRun._id, organizationId, status: 'retracting' },
      {
        $set: {
          status: 'cancelled',
          retractedAt,
          retractedBy: adminId,
          retractedByName: adminName,
          retractionReason,
          retractionSummary: {
            originalStatus,
            deletedPayslips,
            resetCompensationRequests,
            resetTimeAttendanceImports,
          },
          internalNotes,
        },
        $unset: { activePeriodKey: '' },
        $push: { approvals: approval },
      },
      { new: true, runValidators: true, session }
    );
    if (!retractedRun) {
      throw payrollRetractionError(
        'Payroll retraction lost its state claim. No changes were committed.',
        409,
        'PAYROLL_RETRACTION_CLAIM_LOST'
      );
    }

    return {
      run: retractedRun,
      deletedPayslips,
      resetCompensationRequests,
      resetTimeAttendanceImports,
      alreadyRetracted: false,
    };
  }

  async restoreLoanDeductions({ payslips, organizationId, run, session }) {
    const deductionsByUser = collectLoanDeductions(payslips);
    for (const [userId, deductionsByName] of deductionsByUser) {
      const profile = await this.PayrollProfile.findOne(
        { userId, organizationId },
        null,
        { session }
      );
      if (!profile) {
        throw payrollRetractionError(
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
          throw payrollRetractionError(
            `Expected one loan named "${name}" for employee ${userId}; found ${matches.length}.`,
            409,
            'PAYROLL_LOAN_DEDUCTION_NOT_UNIQUE',
            { userId, name, matches: matches.length }
          );
        }

        const loan = matches[0];
        const remainingAmount = Number(loan.remainingAmount);
        const totalAmount = Number(loan.totalAmount);
        if (!Number.isFinite(remainingAmount) || remainingAmount < 0) {
          throw payrollRetractionError(
            `Loan balance is invalid for "${name}" on employee ${userId}.`,
            409,
            'PAYROLL_LOAN_RETRACTION_BALANCE_INVALID',
            { userId, name, remainingAmount }
          );
        }

        const restoredAmount = roundMoney(remainingAmount + amount);
        if (Number.isFinite(totalAmount) && totalAmount > 0 && restoredAmount - totalAmount > 1e-9) {
          throw payrollRetractionError(
            `Loan balance changed for "${name}" on employee ${userId}. Review later payroll runs before retracting this run.`,
            409,
            'PAYROLL_LOAN_RETRACTION_BALANCE_CHANGED',
            { userId, name, remainingAmount, payrollDeduction: amount, totalAmount }
          );
        }

        loan.remainingAmount = Number.isFinite(totalAmount) && totalAmount > 0
          && Math.abs(restoredAmount - totalAmount) < 1e-9
          ? totalAmount
          : restoredAmount;
        if (loan.remainingAmount > 0) loan.isActive = true;
        const marker = `[Retracted via Run ${run.runNumber}]`;
        if (!String(loan.notes || '').includes(marker)) {
          loan.notes = [loan.notes, marker].filter(Boolean).join(' ');
        }
      }

      await profile.save({ session, validateModifiedOnly: true });
    }
  }

  async resetCompensationRequests({
    payslips,
    organizationId,
    run,
    requireLinkedRequests,
    session,
  }) {
    const requestIds = new Set();
    if (requireLinkedRequests) {
      for (const requestId of collectCompensationRequestIds(payslips)) requestIds.add(requestId);
    }

    const processedRequests = await this.CompensationRequest.find(
      { organizationId, processedInRunId: run._id },
      { _id: 1 },
      { session }
    );
    for (const request of processedRequests) requestIds.add(String(request._id));

    const ids = Array.from(requestIds);
    if (ids.length === 0) return 0;

    const result = await this.CompensationRequest.updateMany(
      {
        _id: { $in: ids },
        organizationId,
        status: 'processed',
        processedInRunId: run._id,
      },
      {
        $set: {
          status: 'approved',
          processedInRunId: null,
        },
        $unset: { processedAt: '' },
      },
      { session }
    );
    if (writeMatchedCount(result) !== ids.length) {
      throw payrollRetractionError(
        'One or more compensation requests changed after this payroll run was finalized. No changes were committed.',
        409,
        'PAYROLL_RETRACTION_COMPENSATION_REQUEST_CHANGED'
      );
    }
    return ids.length;
  }

  async resetTimeAttendanceImports({ organizationId, run, session }) {
    const result = await this.TimeAttendanceImport.updateMany(
      { organizationId, appliedPayrollRunId: run._id, status: 'applied' },
      { $set: { status: 'accepted' }, $unset: { appliedPayrollRunId: '' } },
      { session }
    );
    return writeMatchedCount(result);
  }
}

module.exports = new PayrollRetractionService();
module.exports.PayrollRetractionService = PayrollRetractionService;
module.exports.collectCompensationRequestIds = collectCompensationRequestIds;
module.exports.collectLoanDeductions = collectLoanDeductions;
