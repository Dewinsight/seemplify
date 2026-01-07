const Payslip = require('../models/Payslip');
const PayrollRun = require('../models/PayrollRun');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const taxService = require('./TaxCalculationService');
const LeaveIntegrationService = require('./LeaveIntegrationService');

// Instantiate integration services
const leaveService = new LeaveIntegrationService();

/**
 * Payroll Engine Service
 * 
 * Centralized logic for calculating payroll runs and individual employee pay.
 * Moves complex logic out of route handlers.
 */
class PayrollEngineService {

  /**
   * Calculate a full Payroll Run
   * @param {string} runId - ID of the PayrollRun to calculate
   * @param {string} organizationId - Organization ID
   * @returns {Object} result - { run, summary, errors }
   */
  async calculateRun(runId, organizationId) {
    const run = await PayrollRun.findById(runId);
    if (!run) throw new Error('Payroll Run not found');

    // 1. Fetch all active profiles
    const profiles = await PayrollProfile.find({
      organizationId,
      isActive: true,
      'payrollFlags.includeInNextRun': true
    });

    // Initialize run summary
    run.initializeSummary(profiles.length, 'USD'); // TODO: Support multi-currency

    const payslips = [];
    const errors = [];

    for (const profile of profiles) {
      try {
        const payslip = await this.calculateEmployeePay(profile, run);
        payslips.push(payslip);

        // Add to run employees list
        run.addEmployee(
          profile.userId,
          profile.employeeInfo?.name || 'Employee',
          payslip.earningsSummary?.grossPay || 0,
          payslip.deductionsSummary?.totalDeductions || 0,
          payslip.netPay || 0
        );

      } catch (profileError) {
        console.error(`Error processing profile ${profile.userId}:`, profileError);
        errors.push({
          userId: profile.userId,
          employeeName: profile.employeeInfo?.name,
          errorType: 'processing_error',
          errorMessage: profileError.message
        });
        run.logError(profile.userId, profile.employeeInfo?.name, 'processing_error', profileError.message);
      }
    }

    // Save all payslips
    if (payslips.length > 0) {
      // Clear existing payslips for this run first (idempotency)
      await Payslip.deleteMany({ payrollRunId: run._id });
      await Payslip.insertMany(payslips);
    }

    // Update run with totals from actual payslips
    run.updateTotalsFromPayslips(payslips);
    run.calculatedAt = new Date();
    run.status = errors.length > 0 ? 'pending_review' : 'calculated';

    // Note: Caller is responsible for saving the run to persist changes
    await run.save();

    return {
      run,
      summary: {
        totalEmployees: profiles.length,
        processed: payslips.length,
        errors: errors.length,
        totalGrossPayroll: run.summary.totalGrossPayroll,
        totalNetPayroll: run.summary.totalNetPayroll
      },
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Calculate Pay for a Single Employee
   * @param {Object} profile - PayrollProfile document
   * @param {Object} run - PayrollRun document (contains context like dates, settings)
   * @returns {Object} payslip - The calculated Payslip document (not saved yet)
   */
  async calculateEmployeePay(profile, run) {
    const { month, year, startDate, endDate, paymentDate } = run.payPeriod;
    const { settings } = run;

    // Generate payslip number
    const payslipNumber = await Payslip.generatePayslipNumber(run.organizationId, year, month);

    // Create base payslip
    const payslip = new Payslip({
      payslipNumber,
      payrollRunId: run._id,
      userId: profile.userId,
      organizationId: run.organizationId,
      payPeriod: {
        type: 'monthly',
        month,
        year,
        startDate,
        endDate,
        paymentDate
      },
      employeeSnapshot: {
        name: profile.employeeInfo?.name || 'Employee',
        email: profile.employeeInfo?.email,
        employeeId: profile.employeeInfo?.employeeId,
        designation: profile.employeeInfo?.designation,
        department: profile.employeeInfo?.department,
        teamName: profile.employeeInfo?.teamName,
        managerName: profile.employeeInfo?.managerName,
        employmentType: profile.employeeInfo?.employmentType
      },
      salaryGrade: profile.salaryGrade,
      currency: profile.currency || 'USD',
      status: 'draft',
      createdBy: run.createdBy
    });

    // 1. Add Earnings
    // Basic Salary
    payslip.addEarning('basic', 'Basic Salary', profile.basicSalary);

    // Recurring Allowances
    if (settings.includeAllowances && profile.allowances) {
      profile.allowances.forEach(allowance => {
        if (allowance.isActive) {
          payslip.addEarning(allowance.type, allowance.name, allowance.amount, {
            taxable: allowance.isTaxable
          });
        }
      });
    }

    // Bonuses / Compensation Requests
    if (settings.includeBonuses) {
      const bonuses = await CompensationRequest.find({
        userId: profile.userId,
        organizationId: run.organizationId,
        status: 'processed',
        effectiveDate: { $gte: startDate, $lte: endDate }
      });

      bonuses.forEach(bonus => {
        payslip.addEarning('bonus', bonus.reason || 'Bonus', bonus.amount, {
          linkedRequestId: bonus._id.toString(),
          isRecurring: false
        });
      });
    }

    // =====================================================
    // OVERTIME - Process approved overtime requests
    // =====================================================
    if (settings.includeOvertime) {
      const overtimeRequests = await CompensationRequest.find({
        userId: profile.userId,
        organizationId: run.organizationId,
        type: 'overtime',
        status: { $in: ['approved', 'processed'] },
        effectiveDate: { $gte: startDate, $lte: endDate }
      });

      for (const ot of overtimeRequests) {
        // Calculate overtime pay: hours * hourly rate * multiplier
        const hourlyRate = profile.basicSalary / 176; // Assume 176 working hours/month
        const multiplier = ot.overtimeMultiplier || 1.5; // Default 1.5x
        const hours = ot.overtimeHours || 0;
        const overtimePay = Math.round(hourlyRate * hours * multiplier * 100) / 100;

        if (overtimePay > 0) {
          payslip.addEarning('overtime', `Overtime (${hours}h @ ${multiplier}x)`, overtimePay, {
            linkedRequestId: ot._id.toString(),
            isRecurring: false
          });

          // Mark OT request as processed
          ot.status = 'processed';
          await ot.save();
        }
      }
    }

    // 2. Add Deductions
    const currentGross = payslip.calculateGrossPay ? payslip.calculateGrossPay() : payslip.earnings.reduce((sum, e) => sum + e.amount, 0);

    // =====================================================
    // UNPAID LEAVE - Integrate with Leave Management
    // =====================================================
    try {
      const unpaidLeave = await leaveService.calculateUnpaidLeaveDeduction(
        profile.userId,
        profile.basicSalary,
        month,
        year
      );

      if (unpaidLeave.days > 0 && unpaidLeave.amount > 0) {
        payslip.addDeduction('unpaid_leave', `Unpaid Leave (${unpaidLeave.days} days)`, unpaidLeave.amount, {
          isPreTax: false,
          metadata: { unpaidDays: unpaidLeave.days }
        });
      }
    } catch (leaveError) {
      console.warn(`Leave integration unavailable for ${profile.userId}:`, leaveError.message);
    }

    // Statutory Deductions
    if (settings.processStatutoryDeductions) {
      // Income Tax
      if (settings.calculateTax) {
        const taxResult = taxService.calculateIncomeTax(currentGross, {
          // Pass any profile-specific tax config here if needed
        });

        payslip.addDeduction('income_tax', 'Income Tax', taxResult.taxAmount, { isPreTax: false });

        // Update tax breakdown metadata
        payslip.taxBreakdown = {
          grossTaxableIncome: taxResult.grossTaxableIncome,
          netTaxableIncome: taxResult.netTaxableIncome,
          taxRate: taxResult.taxRate,
          taxAmount: taxResult.taxAmount
        };
      }

      // Social Security
      const ssResult = taxService.calculateSocialSecurity(currentGross);
      payslip.addDeduction('social_security', 'Social Security', ssResult.amount);
    }

    // Recurring Deductions (from Profile)
    if (profile.recurringDeductions) {
      profile.recurringDeductions.forEach(deduction => {
        if (deduction.isActive) {
          const amount = deduction.isPercentage
            ? currentGross * (deduction.percentage / 100)
            : deduction.amount;
          payslip.addDeduction(deduction.type, deduction.name, amount, {
            isPreTax: deduction.isPreTax
          });
        }
      });
    }

    // 3. Finalize
    payslip.calculateTotals();

    return payslip;
  }
}

module.exports = new PayrollEngineService();