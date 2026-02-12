const Payslip = require('../models/Payslip');
const PayrollRun = require('../models/PayrollRun');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const taxService = require('./TaxCalculationService');
const LeaveIntegrationService = require('./LeaveIntegrationService');

// Instantiate integration services
const leaveService = new LeaveIntegrationService();

const ALLOWED_DEDUCTION_TYPES = new Set([
  'income_tax',
  'social_security',
  'pension',
  'health_insurance',
  'life_insurance',
  'loan_repayment',
  'advance_recovery',
  'unpaid_leave',
  'late_penalty',
  'union_dues',
  'garnishment',
  'voluntary_contribution',
  'parking',
  'other',
]);

function roundMoney(amount, precision = 2) {
  const n = Number(amount || 0);
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function startOfDay(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function daysBetweenInclusive(start, end) {
  const a = startOfDay(start).getTime();
  const b = startOfDay(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function inPeriod(payStart, payEnd, itemStart, itemEnd) {
  const s = itemStart ? new Date(itemStart) : null;
  const e = itemEnd ? new Date(itemEnd) : null;
  if (s && payEnd < s) return false;
  if (e && payStart > e) return false;
  return true;
}

function normalizeDeductionType(type) {
  if (!type) return 'other';
  return ALLOWED_DEDUCTION_TYPES.has(type) ? type : 'other';
}

function maskSensitive(value) {
  if (!value) return undefined;
  const s = String(value);
  if (s.length <= 4) return s;
  return `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

/**
 * Payroll Engine Service
 *
 * Centralized logic for calculating payroll runs and individual employee pay.
 * This prepares payroll (no direct payout / tax remittance).
 */
class PayrollEngineService {
  /**
   * Process a payroll run for an organization (used by scheduler)
   * @param {string} organizationId
   * @param {Object} options - { month, year, includeBonuses, includeOvertime, paymentDate }
   */
  async processPayrollRun(organizationId, options) {
    const { month, year, includeBonuses, includeOvertime, paymentDate } = options || {};

    if (!month || !year) {
      throw new Error('month and year are required');
    }

    const exists = await PayrollRun.existsForPeriod(organizationId, year, month);
    if (exists) {
      return { skipped: true, reason: 'Payroll run already exists for this period' };
    }

    const runNumber = await PayrollRun.generateRunNumber(organizationId, year, month);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const defaultPaymentDate = paymentDate ? new Date(paymentDate) : endDate;

    const run = new PayrollRun({
      runNumber,
      organizationId,
      payPeriod: {
        type: 'monthly',
        month,
        year,
        startDate,
        endDate,
        paymentDate: defaultPaymentDate,
      },
      status: 'calculating',
      settings: {
        includeAllowances: true,
        includeBonuses: includeBonuses !== false,
        includeOvertime: includeOvertime !== false,
        includeCommissions: true,
        processStatutoryDeductions: true,
        processUnpaidLeave: true,
        calculateTax: true,
        prorate: true,
      },
      createdBy: 'system-scheduler',
      createdByName: 'Automated Scheduler',
      processedBy: 'system-scheduler',
      processedByName: 'Automated Scheduler',
    });

    await run.save();

    const result = await this.calculateRun(run._id, organizationId);
    const payslips = await Payslip.find({ payrollRunId: run._id });

    return {
      payslips: payslips.map(p => p.toObject()),
      totalEmployees: result.summary.totalEmployees,
      totalPayrollCost: result.summary.totalNetPayroll,
      run: result.run,
      summary: result.summary,
      errors: result.errors,
    };
  }

  /**
   * Calculate a full Payroll Run
   * @param {string} runId
   * @param {string} organizationId
   */
  async calculateRun(runId, organizationId) {
    const run = await PayrollRun.findById(runId);
    if (!run) throw new Error('Payroll Run not found');
    if (String(run.organizationId) !== String(organizationId)) {
      throw new Error('Organization mismatch for payroll run');
    }

    const { settings = {}, payPeriod } = run;
    const payStart = new Date(payPeriod.startDate);
    const payEnd = new Date(payPeriod.endDate);

    // 1. Fetch eligible profiles (with optional filters)
    const profileQuery = {
      organizationId,
      isActive: true,
      'payrollFlags.includeInNextRun': true,
    };

    if (Array.isArray(settings.departments) && settings.departments.length > 0) {
      profileQuery['employeeInfo.department'] = { $in: settings.departments };
    }
    if (Array.isArray(settings.teams) && settings.teams.length > 0) {
      profileQuery['employeeInfo.teamId'] = { $in: settings.teams };
    }
    if (Array.isArray(settings.employmentTypes) && settings.employmentTypes.length > 0) {
      profileQuery['employeeInfo.employmentType'] = { $in: settings.employmentTypes };
    }

    const profiles = await PayrollProfile.find(profileQuery);

    // Reset run summary/breakdown for idempotent recalculation
    run.employees = [];
    run.errors = [];
    run.initializeSummary(profiles.length, run.summary?.currency || 'USD');

    const payslips = [];
    const errors = [];
    let skippedCount = 0;

    for (const profile of profiles) {
      const employeeName = profile.employeeInfo?.name || 'Employee';
      try {
        // Skip on hold
        if (profile.payrollFlags?.holdPayment) {
          skippedCount += 1;
          run.employees.push({
            userId: profile.userId,
            employeeName,
            grossPay: 0,
            deductions: 0,
            netPay: 0,
            status: 'skipped',
            errorMessage: profile.payrollFlags?.holdReason || 'Payment is on hold',
          });
          continue;
        }

        const payslip = await this.calculateEmployeePay(profile, run);
        payslips.push(payslip);

        run.employees.push({
          userId: profile.userId,
          employeeName,
          grossPay: payslip.earningsSummary?.grossPay || 0,
          deductions: payslip.deductionsSummary?.totalDeductions || 0,
          netPay: payslip.netPay || 0,
          status: 'processed',
          payslipId: payslip._id,
        });
      } catch (profileError) {
        console.error(`Error processing profile ${profile.userId}:`, profileError);

        errors.push({
          userId: profile.userId,
          employeeName,
          errorType: 'processing_error',
          errorMessage: profileError.message,
        });

        run.logError(profile.userId, employeeName, 'processing_error', profileError.message);

        run.employees.push({
          userId: profile.userId,
          employeeName,
          grossPay: 0,
          deductions: 0,
          netPay: 0,
          status: 'error',
          errorMessage: profileError.message,
        });
      }
    }

    // Save payslips (idempotent)
    await Payslip.deleteMany({ payrollRunId: run._id });
    if (payslips.length > 0) {
      await Payslip.insertMany(payslips);
    }

    // Totals & status
    run.updateTotalsFromPayslips(payslips);
    run.summary.totalEmployees = profiles.length;
    run.summary.processedCount = payslips.length;
    run.summary.errorCount = errors.length;
    run.summary.skippedCount = skippedCount;

    run.calculatedAt = new Date();
    run.status = errors.length > 0 ? 'pending_review' : 'calculated';
    run.processedBy = run.processedBy || run.createdBy;
    run.processedByName = run.processedByName || run.createdByName;

    await run.save();

    return {
      run,
      summary: {
        totalEmployees: profiles.length,
        processed: payslips.length,
        skipped: skippedCount,
        errors: errors.length,
        totalGrossPayroll: run.summary.totalGrossPayroll,
        totalNetPayroll: run.summary.totalNetPayroll,
        totalTaxWithheld: run.summary.totalTaxWithheld,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Calculate Pay for a Single Employee
   * @param {Object} profile - PayrollProfile document
   * @param {Object} run - PayrollRun document
   */
  async calculateEmployeePay(profile, run) {
    const { month, year, startDate, endDate, paymentDate } = run.payPeriod;
    const settings = run.settings || {};
    const payStart = new Date(startDate);
    const payEnd = new Date(endDate);

    // Generate payslip number
    const payslipNumber = await Payslip.generatePayslipNumber(run.organizationId, year, month);

    // Bank snapshot (masked)
    const bank = (profile.bankAccounts || []).find(b => b.isPrimary) || profile.bankAccounts?.[0];

    const payslip = new Payslip({
      payslipNumber,
      payrollRunId: run._id,
      userId: profile.userId,
      organizationId: run.organizationId,
      payPeriod: {
        type: run.payPeriod.type || 'monthly',
        month,
        year,
        startDate: payStart,
        endDate: payEnd,
        paymentDate: new Date(paymentDate),
      },
      employeeSnapshot: {
        name: profile.employeeInfo?.name || 'Employee',
        email: profile.employeeInfo?.email,
        employeeId: profile.employeeInfo?.employeeId,
        designation: profile.employeeInfo?.designation,
        department: profile.employeeInfo?.department,
        teamName: profile.employeeInfo?.teamName,
        teamId: profile.employeeInfo?.teamId,
        managerName: profile.employeeInfo?.managerName,
        managerId: profile.employeeInfo?.managerId,
        employmentType: profile.employeeInfo?.employmentType,
        dateOfJoining: profile.employeeInfo?.dateOfJoining,
        costCenter: profile.employeeInfo?.costCenter,
        location: profile.employeeInfo?.workLocation,
        bankAccount: bank ? {
          bankName: bank.bankName,
          accountNumber: maskSensitive(bank.accountNumber),
          routingNumber: maskSensitive(bank.routingNumber),
        } : undefined,
      },
      salaryGrade: profile.salaryGrade,
      currency: profile.currency || 'USD',
      status: 'draft',
      createdBy: run.createdBy,
      employerContributions: [],
    });

    // =====================================================
    // 1) Earnings
    // =====================================================

    // Base salary (optionally prorated)
    let basicSalary = Number(profile.basicSalary || 0);
    let prorationFactor = 1;

    if (settings.prorate !== false) {
      const periodDays = daysBetweenInclusive(payStart, payEnd) || 30;
      const joinDate = profile.employeeInfo?.dateOfJoining ? new Date(profile.employeeInfo.dateOfJoining) : null;
      const termDate = profile.terminationDate ? new Date(profile.terminationDate) : null;

      const employedStart = joinDate && joinDate > payStart ? joinDate : payStart;
      const employedEnd = termDate && termDate < payEnd ? termDate : payEnd;

      const employedDays = daysBetweenInclusive(employedStart, employedEnd);
      if (employedDays > 0 && employedDays < periodDays) {
        prorationFactor = employedDays / periodDays;
      }
    }

    const proratedBasic = roundMoney(basicSalary * prorationFactor);
    payslip.addEarning(
      'basic',
      prorationFactor < 1 ? `Basic Salary (Prorated ${(prorationFactor * 100).toFixed(1)}%)` : 'Basic Salary',
      proratedBasic,
      { taxable: true, isRecurring: true }
    );

    // Recurring allowances
    if (settings.includeAllowances !== false && Array.isArray(profile.allowances)) {
      for (const allowance of profile.allowances) {
        if (!allowance?.isActive) continue;
        if (!inPeriod(payStart, payEnd, allowance.effectiveFrom, allowance.effectiveTo)) continue;
        payslip.addEarning(allowance.type, allowance.name, roundMoney(allowance.amount), {
          taxable: allowance.isTaxable,
          isRecurring: true,
        });
      }
    }

    // Variable compensation (approved requests) - do not mutate request status during calculation
    const includeVariable =
      settings.includeBonuses !== false ||
      settings.includeOvertime !== false ||
      settings.includeCommissions !== false;

    if (includeVariable) {
      const requests = await CompensationRequest.find({
        userId: profile.userId,
        organizationId: run.organizationId,
        status: 'approved',
        effectiveDate: { $gte: payStart, $lte: payEnd },
      });

      for (const req of requests) {
        const linkedRequestId = req._id.toString();

        if (req.type === 'overtime' && settings.includeOvertime !== false) {
          const hourlyRate = basicSalary > 0 ? (basicSalary / 176) : 0; // default working hours/month
          const hours = Number(req.overtimeHours || 0);
          const multiplier = Number(req.overtimeMultiplier || 1.5);

          const overtimePayFromHours = hours > 0 ? roundMoney(hourlyRate * hours * multiplier) : 0;
          const overtimePay = overtimePayFromHours > 0 ? overtimePayFromHours : roundMoney(req.amount || 0);

          if (overtimePay > 0) {
            payslip.addEarning('overtime', req.reason || `Overtime${hours ? ` (${hours}h @ ${multiplier}x)` : ''}`, overtimePay, {
              linkedRequestId,
              isRecurring: false,
              taxable: req.taxable !== undefined ? !!req.taxable : true,
            });
          }
          continue;
        }

        if ((req.type === 'bonus' || req.type === 'commission' || req.type === 'incentive') && settings.includeBonuses !== false) {
          const earningType = req.type; // matches Payslip earning types
          const amt = roundMoney(req.amount || 0);
          if (amt > 0) {
            payslip.addEarning(earningType, req.reason || earningType.replace(/_/g, ' '), amt, {
              linkedRequestId,
              isRecurring: false,
              taxable: req.taxable !== undefined ? !!req.taxable : true,
            });
          }
          continue;
        }

        if (req.type === 'reimbursement') {
          const amt = roundMoney(req.amount || 0);
          if (amt > 0) {
            payslip.addEarning('reimbursement', req.reason || 'Reimbursement', amt, {
              linkedRequestId,
              isRecurring: false,
              taxable: req.taxable !== undefined ? !!req.taxable : false,
            });
          }
          continue;
        }

        if (req.type === 'allowance') {
          const amt = roundMoney(req.amount || 0);
          if (amt > 0) {
            payslip.addEarning('other', req.reason || 'Allowance', amt, {
              linkedRequestId,
              isRecurring: false,
              taxable: req.taxable !== undefined ? !!req.taxable : true,
            });
          }
          continue;
        }
      }
    }

    // =====================================================
    // 2) Pre-tax deductions (e.g., pension contributions)
    // =====================================================

    // Pension contribution (employee)
    if (profile.statutoryContributions?.pensionOptIn && (profile.statutoryContributions?.pensionContributionPercent || 0) > 0) {
      const pensionAmt = roundMoney((payslip.earningsSummary?.grossPay || 0) * (profile.statutoryContributions.pensionContributionPercent / 100));
      if (pensionAmt > 0) {
        payslip.addDeduction('pension', 'Pension Contribution', pensionAmt, { isPreTax: true });
      }
    }

    // Employer pension contribution (not deducted from employee)
    if (profile.statutoryContributions?.pensionOptIn && (profile.statutoryContributions?.employerPensionPercent || 0) > 0) {
      const employerAmt = roundMoney((payslip.earningsSummary?.grossPay || 0) * (profile.statutoryContributions.employerPensionPercent / 100));
      if (employerAmt > 0) {
        payslip.employerContributions.push({
          type: 'pension_match',
          name: 'Employer Pension Contribution',
          amount: employerAmt,
        });
      }
    }

    // =====================================================
    // 3) Unpaid leave deduction (post-tax by default)
    // =====================================================
    if (settings.processUnpaidLeave !== false) {
      try {
        const unpaidLeave = await leaveService.calculateUnpaidLeaveDeduction(
          profile.userId,
          basicSalary,
          month,
          year
        );

        if (unpaidLeave.days > 0 && unpaidLeave.amount > 0) {
          payslip.addDeduction('unpaid_leave', `Unpaid Leave (${unpaidLeave.days} days)`, roundMoney(unpaidLeave.amount), {
            isPreTax: false,
            metadata: { unpaidDays: unpaidLeave.days },
          });
        }
      } catch (leaveError) {
        console.warn(`Leave integration unavailable for ${profile.userId}:`, leaveError.message);
      }
    }

    // =====================================================
    // 4) Profile recurring deductions (pre-tax then post-tax)
    // =====================================================
    const currentGross = payslip.earningsSummary?.grossPay || 0;

    const recurring = Array.isArray(profile.recurringDeductions) ? profile.recurringDeductions : [];

    // Apply pre-tax first
    for (const deduction of recurring.filter(d => d?.isActive && d?.isPreTax)) {
      if (!inPeriod(payStart, payEnd, deduction.startDate, deduction.endDate)) continue;

      const calcAmount = deduction.isPercentage
        ? (currentGross * (Number(deduction.percentage || 0) / 100))
        : Number(deduction.amount || 0);

      const amt = roundMoney(calcAmount);
      if (amt <= 0) continue;

      const type = normalizeDeductionType(deduction.type);
      const metadata = type === 'other' && deduction.type && deduction.type !== 'other'
        ? { originalType: deduction.type }
        : undefined;

      payslip.addDeduction(type, deduction.name, amt, { isPreTax: true, metadata });
    }

    // =====================================================
    // 5) Statutory deductions (income tax, social security)
    // =====================================================

    if (settings.processStatutoryDeductions !== false) {
      // Compute taxable base: sum of taxable earnings - pre-tax deductions
      const taxableEarnings = (payslip.earnings || [])
        .filter(e => e?.taxable !== false)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

      const preTaxDeductions = (payslip.deductions || [])
        .filter(d => d?.isPreTax)
        .reduce((sum, d) => sum + (d.amount || 0), 0);

      const netTaxableIncome = Math.max(0, roundMoney(taxableEarnings - preTaxDeductions));

      // Income tax
      if (settings.calculateTax !== false) {
        const taxCfg = profile.taxConfig || {};

        const regime = taxCfg.taxRegime === 'exempt' ? 'none' : (taxCfg.calculationRegime || 'flat');
        let taxAmount = 0;
        let taxRate = 0;

        if (regime !== 'none') {
          const taxResult = taxService.calculateIncomeTax(netTaxableIncome, {
            taxRegime: regime,
            taxRate: taxCfg.flatTaxRate,
            customBrackets: Array.isArray(taxCfg.customBrackets)
              ? taxCfg.customBrackets.map(b => ({
                min: Number(b.min || 0),
                max: b.max === null || b.max === undefined ? Infinity : Number(b.max),
                rate: Number(b.rate || 0),
              }))
              : undefined,
          });
          taxAmount = roundMoney(taxResult.taxAmount || 0);
          taxRate = Number(taxResult.taxRate || 0);
        }

        // Add employee-specific additional withholding (monthly)
        if (Number(taxCfg.additionalWithholding || 0) > 0) {
          taxAmount = roundMoney(taxAmount + Number(taxCfg.additionalWithholding || 0));
        }

        if (taxAmount > 0) {
          payslip.addDeduction('income_tax', 'Income Tax', taxAmount, { isPreTax: false });
        }

        payslip.taxBreakdown = {
          grossTaxableIncome: roundMoney(taxableEarnings),
          deductionsBeforeTax: roundMoney(preTaxDeductions),
          netTaxableIncome,
          taxRate: roundMoney(taxRate),
          taxAmount,
        };
      }

      // Social security (employee)
      if (profile.statutoryContributions?.socialSecurityOptIn !== false) {
        const taxCfg = profile.taxConfig || {};
        const ssResult = taxService.calculateSocialSecurity(netTaxableIncome, {
          socialSecurityRate: taxCfg.socialSecurityRate,
          socialSecurityCap: taxCfg.socialSecurityCap,
          ytdEarnings: 0, // TODO: support cumulative mode
        });
        if (ssResult.amount > 0) {
          payslip.addDeduction('social_security', 'Social Security', roundMoney(ssResult.amount), { isPreTax: false });
        }
      }
    }

    // Apply post-tax recurring deductions (including loans)
    for (const deduction of recurring.filter(d => d?.isActive && !d?.isPreTax)) {
      if (!inPeriod(payStart, payEnd, deduction.startDate, deduction.endDate)) continue;

      const calcAmount = deduction.isPercentage
        ? (currentGross * (Number(deduction.percentage || 0) / 100))
        : Number(deduction.amount || 0);

      let amt = roundMoney(calcAmount);
      if (amt <= 0) continue;

      // Cap loan repayment to remaining balance
      if (deduction.type === 'loan_repayment' && Number.isFinite(Number(deduction.remainingAmount))) {
        const remaining = Number(deduction.remainingAmount || 0);
        amt = Math.min(amt, remaining);
        amt = roundMoney(amt);
        if (amt <= 0) continue;
      }

      const type = normalizeDeductionType(deduction.type);
      const metadata = type === 'other' && deduction.type && deduction.type !== 'other'
        ? { originalType: deduction.type }
        : undefined;

      payslip.addDeduction(type, deduction.name, amt, { isPreTax: false, metadata });
    }

    // Finalize totals
    payslip.calculateTotals();

    return payslip;
  }
}

module.exports = PayrollEngineService;

