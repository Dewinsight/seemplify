const Payslip = require('../models/Payslip');
const PayrollRun = require('../models/PayrollRun');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const taxService = require('./TaxCalculationService');
const LeaveIntegrationService = require('./LeaveIntegrationService');
const currencyService = require('./CurrencyService');

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

function normalizeCurrencyCode(code, fallback = 'USD') {
  const normalized = String(code || fallback || 'USD').trim().toUpperCase();
  return normalized || fallback || 'USD';
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
  async convertAmountToCurrency(organizationId, amount, fromCurrency, toCurrency, asOfDate = new Date()) {
    const numericAmount = roundMoney(amount);
    const sourceCurrency = normalizeCurrencyCode(fromCurrency, toCurrency);
    const targetCurrency = normalizeCurrencyCode(toCurrency, sourceCurrency);

    if (numericAmount === 0 || sourceCurrency === targetCurrency) {
      return numericAmount;
    }

    const conversion = await currencyService.convert(
      organizationId,
      numericAmount,
      sourceCurrency,
      targetCurrency,
      asOfDate
    );

    return roundMoney(conversion.convertedAmount);
  }

  async applyRunCurrencySummary(run, payslips) {
    const breakdownMap = new Map();
    const payDate = run?.payPeriod?.paymentDate ? new Date(run.payPeriod.paymentDate) : new Date();
    const requestedReportingCurrency = run?.settings?.reportingCurrency
      ? normalizeCurrencyCode(run.settings.reportingCurrency)
      : null;

    for (const payslip of payslips) {
      const currency = normalizeCurrencyCode(payslip.currency);
      const current = breakdownMap.get(currency) || {
        currency,
        employeeCount: 0,
        totalGrossPayroll: 0,
        totalDeductions: 0,
        totalNetPayroll: 0,
        totalTaxWithheld: 0,
        totalEmployerContributions: 0,
      };

      current.employeeCount += 1;
      current.totalGrossPayroll = roundMoney(current.totalGrossPayroll + Number(payslip.earningsSummary?.grossPay || 0));
      current.totalDeductions = roundMoney(current.totalDeductions + Number(payslip.deductionsSummary?.totalDeductions || 0));
      current.totalNetPayroll = roundMoney(current.totalNetPayroll + Number(payslip.netPay || 0));
      current.totalTaxWithheld = roundMoney(current.totalTaxWithheld + Number(payslip.taxBreakdown?.taxAmount || 0));
      current.totalEmployerContributions = roundMoney(current.totalEmployerContributions + Number(payslip.totalEmployerContributions || 0));

      breakdownMap.set(currency, current);
    }

    const currencyBreakdown = Array.from(breakdownMap.values())
      .sort((a, b) => a.currency.localeCompare(b.currency));
    const currencies = currencyBreakdown.map((entry) => entry.currency);
    const isMultiCurrency = currencies.length > 1;

    let summaryCurrency = currencies[0] || requestedReportingCurrency || normalizeCurrencyCode(run?.summary?.currency);
    let reportingCurrency = null;
    let hasAggregateTotals = true;
    let totalGrossPayroll = 0;
    let totalDeductions = 0;
    let totalNetPayroll = 0;
    let totalTaxWithheld = 0;
    let totalEmployerContributions = 0;
    const unconvertedCurrencies = [];
    const conversionWarnings = [];

    if (requestedReportingCurrency) {
      reportingCurrency = requestedReportingCurrency;
      summaryCurrency = requestedReportingCurrency;

      try {
        for (const entry of currencyBreakdown) {
          totalGrossPayroll = roundMoney(totalGrossPayroll + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalGrossPayroll,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalDeductions = roundMoney(totalDeductions + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalDeductions,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalNetPayroll = roundMoney(totalNetPayroll + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalNetPayroll,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalTaxWithheld = roundMoney(totalTaxWithheld + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalTaxWithheld,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalEmployerContributions = roundMoney(totalEmployerContributions + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalEmployerContributions,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
        }
      } catch (conversionError) {
        hasAggregateTotals = !isMultiCurrency;
        conversionWarnings.push(conversionError.message);
        unconvertedCurrencies.push(...currencies.filter((currency) => currency !== requestedReportingCurrency));

        if (!isMultiCurrency && currencyBreakdown[0]) {
          const [entry] = currencyBreakdown;
          summaryCurrency = entry.currency;
          totalGrossPayroll = entry.totalGrossPayroll;
          totalDeductions = entry.totalDeductions;
          totalNetPayroll = entry.totalNetPayroll;
          totalTaxWithheld = entry.totalTaxWithheld;
          totalEmployerContributions = entry.totalEmployerContributions;
        }
      }
    } else if (currencyBreakdown.length === 1) {
      const [entry] = currencyBreakdown;
      summaryCurrency = entry.currency;
      totalGrossPayroll = entry.totalGrossPayroll;
      totalDeductions = entry.totalDeductions;
      totalNetPayroll = entry.totalNetPayroll;
      totalTaxWithheld = entry.totalTaxWithheld;
      totalEmployerContributions = entry.totalEmployerContributions;
    } else {
      summaryCurrency = 'MIXED';
      hasAggregateTotals = false;
    }

    run.summary = {
      ...(run.summary || {}),
      currency: summaryCurrency,
      reportingCurrency,
      hasAggregateTotals,
      isMultiCurrency,
      currencies,
      currencyBreakdown,
      unconvertedCurrencies: Array.from(new Set(unconvertedCurrencies)),
      conversionWarnings,
      totalGrossPayroll: hasAggregateTotals ? roundMoney(totalGrossPayroll) : 0,
      totalDeductions: hasAggregateTotals ? roundMoney(totalDeductions) : 0,
      totalNetPayroll: hasAggregateTotals ? roundMoney(totalNetPayroll) : 0,
      totalTaxWithheld: hasAggregateTotals ? roundMoney(totalTaxWithheld) : 0,
      totalEmployerContributions: hasAggregateTotals ? roundMoney(totalEmployerContributions) : 0,
    };
  }

  async getEmployeeYearToDatePayrollContext(profile, paymentDate) {
    const payDate = paymentDate ? new Date(paymentDate) : new Date();
    const taxYear = taxService.getTaxYearContext(profile?.taxConfig || {}, payDate);

    const priorPayslips = await Payslip.find({
      organizationId: profile.organizationId,
      userId: profile.userId,
      'payPeriod.paymentDate': {
        $gte: taxYear.start,
        $lt: payDate,
      },
    })
      .select('earningsSummary taxBreakdown')
      .lean();

    return {
      taxYear,
      ytdGrossPay: roundMoney(priorPayslips.reduce((sum, slip) => sum + Number(slip?.earningsSummary?.grossPay || 0), 0)),
      ytdTaxableIncome: roundMoney(priorPayslips.reduce((sum, slip) => sum + Number(slip?.taxBreakdown?.grossTaxableIncome || 0), 0)),
      ytdIncomeTax: roundMoney(priorPayslips.reduce((sum, slip) => sum + Number(slip?.taxBreakdown?.taxAmount || 0), 0)),
    };
  }

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
      basicSalary: { $gt: 0 },
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
    run.initializeSummary(
      profiles.length,
      run.settings?.reportingCurrency || run.summary?.currency || 'USD',
      { reportingCurrency: run.settings?.reportingCurrency || null }
    );

    const payslips = [];
    const errors = [];
    let skippedCount = 0;
    let nextPayslipSequence = await Payslip.getNextPayslipSequence(
      run.organizationId,
      payPeriod.year,
      payPeriod.month,
      { excludePayrollRunId: run._id }
    );

    for (const profile of profiles) {
      const employeeName = profile.employeeInfo?.name || 'Employee';
      const employeeCurrency = normalizeCurrencyCode(profile.currency);
      try {
        // Skip on hold
        if (profile.payrollFlags?.holdPayment) {
          skippedCount += 1;
          run.employees.push({
            userId: profile.userId,
            employeeName,
            currency: employeeCurrency,
            grossPay: 0,
            deductions: 0,
            netPay: 0,
            status: 'skipped',
            errorMessage: profile.payrollFlags?.holdReason || 'Payment is on hold',
          });
          continue;
        }

        const payslipNumber = Payslip.buildPayslipNumber(
          payPeriod.year,
          payPeriod.month,
          nextPayslipSequence
        );
        nextPayslipSequence += 1;

        const payslip = await this.calculateEmployeePay(profile, run, { payslipNumber });
        payslips.push(payslip);

        run.employees.push({
          userId: profile.userId,
          employeeName,
          currency: payslip.currency || employeeCurrency,
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
          currency: employeeCurrency,
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
    await this.applyRunCurrencySummary(run, payslips);
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
  async calculateEmployeePay(profile, run, options = {}) {
    const { month, year, startDate, endDate, paymentDate } = run.payPeriod;
    const settings = run.settings || {};
    const payStart = new Date(startDate);
    const payEnd = new Date(endDate);
    const payslipCurrency = normalizeCurrencyCode(profile.currency);
    const payslipNumber = options.payslipNumber || await Payslip.generatePayslipNumber(run.organizationId, year, month);

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
      currency: payslipCurrency,
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
          const requestCurrency = normalizeCurrencyCode(req.currency, payslipCurrency);

          const overtimePayFromHours = hours > 0 ? roundMoney(hourlyRate * hours * multiplier) : 0;
          let overtimePay = overtimePayFromHours > 0 ? overtimePayFromHours : roundMoney(req.amount || 0);

          if (hours <= 0 && overtimePay > 0 && requestCurrency !== payslipCurrency) {
            overtimePay = await this.convertAmountToCurrency(
              run.organizationId,
              overtimePay,
              requestCurrency,
              payslipCurrency,
              req.effectiveDate || paymentDate
            );
          }

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
          let amt = roundMoney(req.amount || 0);
          const requestCurrency = normalizeCurrencyCode(req.currency, payslipCurrency);
          if (amt > 0 && requestCurrency !== payslipCurrency) {
            amt = await this.convertAmountToCurrency(
              run.organizationId,
              amt,
              requestCurrency,
              payslipCurrency,
              req.effectiveDate || paymentDate
            );
          }
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
          let amt = roundMoney(req.amount || 0);
          const requestCurrency = normalizeCurrencyCode(req.currency, payslipCurrency);
          if (amt > 0 && requestCurrency !== payslipCurrency) {
            amt = await this.convertAmountToCurrency(
              run.organizationId,
              amt,
              requestCurrency,
              payslipCurrency,
              req.effectiveDate || paymentDate
            );
          }
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
          let amt = roundMoney(req.amount || 0);
          const requestCurrency = normalizeCurrencyCode(req.currency, payslipCurrency);
          if (amt > 0 && requestCurrency !== payslipCurrency) {
            amt = await this.convertAmountToCurrency(
              run.organizationId,
              amt,
              requestCurrency,
              payslipCurrency,
              req.effectiveDate || paymentDate
            );
          }
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

    const effectivePension = taxService.resolveEffectivePensionSettings(
      profile.taxConfig || {},
      profile.statutoryContributions || {}
    );

    // Pension contribution (employee)
    if (effectivePension.enabled && effectivePension.employeePercent > 0) {
      const pensionAmt = roundMoney((payslip.earningsSummary?.grossPay || 0) * (effectivePension.employeePercent / 100));
      if (pensionAmt > 0) {
        payslip.addDeduction('pension', 'Pension Contribution', pensionAmt, { isPreTax: true });
      }
    }

    // Employer pension contribution (not deducted from employee)
    if (effectivePension.enabled && effectivePension.employerPercent > 0) {
      const employerAmt = roundMoney((payslip.earningsSummary?.grossPay || 0) * (effectivePension.employerPercent / 100));
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
      const taxPaymentDate = payslip.payPeriod?.paymentDate || payEnd;
      const ytdContext = await this.getEmployeeYearToDatePayrollContext(profile, taxPaymentDate);
      const taxResult = await taxService.calculatePayrollTaxes({
        taxConfig: profile.taxConfig || {},
        organizationId: profile.organizationId,
        statutoryContributions: profile.statutoryContributions || {},
        grossPay: roundMoney(payslip.earningsSummary?.grossPay || taxableEarnings),
        taxableIncome: netTaxableIncome,
        basicSalary: roundMoney(payslip.earningsSummary?.basicSalary || profile.basicSalary || 0),
        preTaxDeductions: roundMoney(preTaxDeductions),
        paymentDate: taxPaymentDate,
        payFrequency: payslip.payPeriod?.type || profile.payFrequency || 'monthly',
        employeeInfo: profile.employeeInfo || {},
        ytdGrossPay: ytdContext.ytdGrossPay,
        ytdTaxableIncome: ytdContext.ytdTaxableIncome,
      });

      if (settings.calculateTax !== false) {
        const incomeTaxAmount = roundMoney(taxResult?.incomeTax?.taxAmount || 0);

        if (incomeTaxAmount > 0) {
          payslip.addDeduction('income_tax', 'Income Tax', incomeTaxAmount, { isPreTax: false });
        }

        payslip.taxBreakdown = {
          grossTaxableIncome: roundMoney(taxResult?.incomeTax?.grossTaxableIncome || taxableEarnings),
          taxExemptIncome: roundMoney(taxResult?.incomeTax?.taxExemptIncome || 0),
          deductionsBeforeTax: roundMoney(taxResult?.incomeTax?.deductionsBeforeTax || preTaxDeductions),
          netTaxableIncome: roundMoney(taxResult?.incomeTax?.netTaxableIncome || netTaxableIncome),
          taxRate: roundMoney(taxResult?.incomeTax?.taxRate || 0),
          taxAmount: incomeTaxAmount,
          yearToDateTax: roundMoney(ytdContext.ytdIncomeTax + incomeTaxAmount),
          jurisdictionCode: taxResult?.incomeTax?.jurisdictionCode || '',
          jurisdictionName: taxResult?.incomeTax?.jurisdictionName || '',
          jurisdictionConfigId: taxResult?.jurisdictionConfig?._id || null,
          jurisdictionVersionId: taxResult?.jurisdictionVersion?._id || null,
          taxYearLabel: taxResult?.incomeTax?.taxYearLabel || ytdContext.taxYear?.label || '',
          calculationMode: taxResult?.incomeTax?.calculationMode || '',
          method: taxResult?.incomeTax?.method || '',
          annualizedIncome: roundMoney(taxResult?.incomeTax?.annualizedIncome || 0),
          annualizedTaxableIncome: roundMoney(taxResult?.incomeTax?.annualizedTaxableIncome || 0),
          taxableIncomeAfterReliefs: roundMoney(taxResult?.incomeTax?.taxableIncomeAfterReliefs || 0),
          notes: Array.isArray(taxResult?.incomeTax?.notes) ? taxResult.incomeTax.notes : [],
          details: taxResult?.incomeTax?.details || undefined,
          calculationTrace: {
            validationErrors: Array.isArray(taxResult?.validationErrors) ? taxResult.validationErrors : [],
            employeeTaxInputs: taxResult?.employeeTaxInputs || {},
          },
        };
      }

      for (const component of taxResult?.statutoryContributions?.components || []) {
        if (Number(component?.amount || 0) <= 0) continue;
        payslip.addDeduction(
          'social_security',
          component.name || 'Social Security',
          roundMoney(component.amount),
          {
            isPreTax: false,
            metadata: {
              source: component.source,
              taxableAmount: roundMoney(component.taxableAmount || 0),
              rate: component.rate,
              cap: component.cap,
              threshold: component.threshold,
              hitCap: component.hitCap,
              reducesTaxableIncome: !!component.reducesTaxableIncome,
            },
          }
        );
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
