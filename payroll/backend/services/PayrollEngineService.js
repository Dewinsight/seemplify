const Payslip = require('../models/Payslip');
const PayrollRun = require('../models/PayrollRun');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const TimeAttendanceImport = require('../models/TimeAttendanceImport');
const taxService = require('./TaxCalculationService');
const LeaveIntegrationService = require('./LeaveIntegrationService');
const currencyService = require('./CurrencyService');
const employerEntityService = require('./PayrollEmployerEntityService');
const payComponentTaxService = require('./PayComponentTaxService');
const taxWithholdingTreatmentService = require('./TaxWithholdingTreatmentService');
const organizationCurrencyService = require('./OrganizationCurrencyService');
const { calculateContractBasePay } = require('./contractPayService');

// Instantiate integration services
const leaveService = new LeaveIntegrationService();

const ALLOWED_DEDUCTION_TYPES = new Set([
  'income_tax',
  'payroll_tax',
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
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function daysBetweenInclusive(start, end) {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  if (!startDate || !endDate) return 0;
  const a = startDate.getTime();
  const b = endDate.getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function employmentPeriod(profile, payStart, payEnd) {
  const periodStart = startOfDay(payStart);
  const periodEnd = startOfDay(payEnd);
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    return { eligible: false, periodDays: 0, employedDays: 0, factor: 0 };
  }

  const usesContractPeriod = profile?.workTerms?.payBasis === 'fixed_contract'
    || profile?.employeeInfo?.employmentType === 'contract';
  const starts = [
    profile?.employeeInfo?.dateOfJoining,
    usesContractPeriod ? profile?.workTerms?.contractStartDate : null,
  ]
    .filter(Boolean)
    .map(startOfDay)
    .filter(Boolean);
  const ends = [
    profile?.terminationDate,
    usesContractPeriod ? profile?.workTerms?.contractEndDate : null,
  ]
    .filter(Boolean)
    .map(startOfDay)
    .filter(Boolean);
  const employedStart = starts.reduce(
    (latest, value) => (value > latest ? value : latest),
    periodStart
  );
  const employedEnd = ends.reduce(
    (earliest, value) => (value < earliest ? value : earliest),
    periodEnd
  );
  const periodDays = daysBetweenInclusive(periodStart, periodEnd);
  const employedDays = daysBetweenInclusive(employedStart, employedEnd);
  const eligible = employedDays > 0 && employedStart <= periodEnd && employedEnd >= periodStart;
  return {
    eligible,
    periodDays,
    employedDays: eligible ? employedDays : 0,
    factor: eligible && periodDays > 0 ? Math.min(1, employedDays / periodDays) : 0,
  };
}

function resolveProfileHourlyRate(profile, basePay, basicSalary) {
  const standardHours = Number(profile.workTerms?.standardHoursPerMonth || profile.standardHoursPerMonth || 176);
  return Number(
    basePay.payBasis === 'hourly'
      ? basePay.rate
      : profile.hourlyRate || (Number(basicSalary || 0) > 0 ? Number(basicSalary) / standardHours : 0)
  );
}

function refreshMutableRunEmployerSnapshot(run, employerContext) {
  const entity = employerContext?.entity;
  const readiness = employerContext?.readiness;
  if (!run || !entity || !readiness) return run;
  run.employerEntitySnapshot = {
    ...(run.employerEntitySnapshot?.toObject?.() || run.employerEntitySnapshot || {}),
    code: entity.code,
    legalName: entity.legalName,
    employerType: entity.employerType,
    countryCode: entity.countryCode,
    jurisdictionCode: entity.jurisdictionCode,
    currency: entity.defaultCurrency,
    taxJurisdictionConfigId: entity.taxJurisdictionConfigId,
    taxJurisdictionVersionId: entity.taxJurisdictionVersionId,
    taxAdapterCandidateId: entity.taxAdapterCandidateId,
    taxPackContentHash: readiness.taxPack?.contentHash || '',
    payrollRunnableAtCreation: readiness.payrollRunnable,
    blockingIssuesAtCreation: readiness.blockingIssues || [],
  };
  return run;
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

function normalizeStatutoryComponentType(type, payer = 'employee') {
  const normalized = String(type || '').trim().toLowerCase();
  const allowed = payer === 'employer'
    ? new Set(['payroll_tax', 'social_security', 'health_insurance', 'life_insurance', 'other'])
    : ALLOWED_DEDUCTION_TYPES;
  if (normalized === 'pension' && payer === 'employer') return 'pension_match';
  return allowed.has(normalized) ? normalized : 'social_security';
}

function isVariableCompensationEnabled(type, settings = {}) {
  if (type === 'overtime') return settings.includeOvertime !== false;
  if (type === 'commission') return settings.includeCommissions !== false;
  if (type === 'bonus' || type === 'incentive') return settings.includeBonuses !== false;
  return true;
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

    const precision = await organizationCurrencyService.getMinorUnits(organizationId, targetCurrency);
    return roundMoney(conversion.convertedAmount, precision);
  }

  async applyRunCurrencySummary(run, payslips) {
    const breakdownMap = new Map();
    const payDate = run?.payPeriod?.paymentDate ? new Date(run.payPeriod.paymentDate) : new Date();
    const requestedReportingCurrency = run?.settings?.reportingCurrency
      ? normalizeCurrencyCode(run.settings.reportingCurrency)
      : null;
    let reportingPrecision = requestedReportingCurrency
      ? await organizationCurrencyService.getMinorUnits(run.organizationId, requestedReportingCurrency)
      : 2;
    const roundReporting = (value) => roundMoney(value, reportingPrecision);

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
        totalEmployerCost: 0,
      };

      current.employeeCount += 1;
      current.totalGrossPayroll = currencyService.roundAmount(current.totalGrossPayroll + Number(payslip.earningsSummary?.grossPay || 0), currency);
      current.totalDeductions = currencyService.roundAmount(current.totalDeductions + Number(payslip.deductionsSummary?.totalDeductions || 0), currency);
      current.totalNetPayroll = currencyService.roundAmount(current.totalNetPayroll + Number(payslip.netPay || 0), currency);
      current.totalTaxWithheld = currencyService.roundAmount(current.totalTaxWithheld + Number(payslip.taxBreakdown?.taxAmount || 0), currency);
      current.totalEmployerContributions = currencyService.roundAmount(current.totalEmployerContributions + Number(payslip.totalEmployerContributions || 0), currency);
      current.totalEmployerCost = currencyService.roundAmount(
        current.totalEmployerCost
        + Number(payslip.earningsSummary?.grossPay || 0)
        + Number(payslip.totalEmployerContributions || 0),
        currency
      );

      breakdownMap.set(currency, current);
    }

    const currencyBreakdown = Array.from(breakdownMap.values())
      .sort((a, b) => a.currency.localeCompare(b.currency));
    const currencies = currencyBreakdown.map((entry) => entry.currency);
    const isMultiCurrency = currencies.length > 1;
    if (!requestedReportingCurrency && currencies.length === 1) {
      reportingPrecision = await organizationCurrencyService.getMinorUnits(run.organizationId, currencies[0]);
    }

    let summaryCurrency = currencies[0] || requestedReportingCurrency || normalizeCurrencyCode(run?.summary?.currency);
    let reportingCurrency = null;
    let hasAggregateTotals = true;
    let totalGrossPayroll = 0;
    let totalDeductions = 0;
    let totalNetPayroll = 0;
    let totalTaxWithheld = 0;
    let totalEmployerContributions = 0;
    let totalEmployerCost = 0;
    const unconvertedCurrencies = [];
    const conversionWarnings = [];

    if (requestedReportingCurrency) {
      reportingCurrency = requestedReportingCurrency;
      summaryCurrency = requestedReportingCurrency;

      try {
        for (const entry of currencyBreakdown) {
          totalGrossPayroll = roundReporting(totalGrossPayroll + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalGrossPayroll,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalDeductions = roundReporting(totalDeductions + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalDeductions,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalNetPayroll = roundReporting(totalNetPayroll + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalNetPayroll,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalTaxWithheld = roundReporting(totalTaxWithheld + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalTaxWithheld,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalEmployerContributions = roundReporting(totalEmployerContributions + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalEmployerContributions,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
          totalEmployerCost = roundReporting(totalEmployerCost + await this.convertAmountToCurrency(
            run.organizationId,
            entry.totalEmployerCost,
            entry.currency,
            requestedReportingCurrency,
            payDate
          ));
        }
      } catch (conversionError) {
        hasAggregateTotals = false;
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
          totalEmployerCost = entry.totalEmployerCost;
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
      totalEmployerCost = entry.totalEmployerCost;
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
      totalGrossPayroll: hasAggregateTotals ? roundReporting(totalGrossPayroll) : 0,
      totalDeductions: hasAggregateTotals ? roundReporting(totalDeductions) : 0,
      totalNetPayroll: hasAggregateTotals ? roundReporting(totalNetPayroll) : 0,
      totalTaxWithheld: hasAggregateTotals ? roundReporting(totalTaxWithheld) : 0,
      totalEmployerContributions: hasAggregateTotals ? roundReporting(totalEmployerContributions) : 0,
      totalEmployerCost: hasAggregateTotals ? roundReporting(totalEmployerCost) : 0,
    };
  }

  async getEmployeeYearToDatePayrollContext(profile, paymentDate) {
    const payDate = paymentDate ? new Date(paymentDate) : new Date();
    const resolvedContext = await taxService.resolveTaxYearContext(
      profile?.taxConfig || {},
      payDate,
      profile.organizationId
    );
    const taxYear = resolvedContext.taxYear;
    const calculationCurrency = normalizeCurrencyCode(
      resolvedContext.calculationCurrency || profile.currency
    );

    const priorPayslips = await Payslip.find({
      organizationId: profile.organizationId,
      userId: profile.userId,
      status: { $in: ['approved', 'exported', 'paid'] },
      'payPeriod.paymentDate': {
        $gte: taxYear.start,
        $lt: payDate,
      },
    })
      .select('earningsSummary taxBreakdown currency payPeriod status')
      .lean();

    const totals = { ytdGrossPay: 0, ytdTaxableIncome: 0, ytdIncomeTax: 0 };
    for (const slip of priorPayslips) {
      const storedBases = slip?.taxBreakdown?.calculationBases || {};
      const storedBaseCurrency = String(storedBases.currency || '').trim().toUpperCase();
      if (storedBaseCurrency && storedBaseCurrency === calculationCurrency) {
        totals.ytdGrossPay += Number(storedBases.grossPay || 0);
        totals.ytdTaxableIncome += Number(storedBases.taxableIncome || 0);
        totals.ytdIncomeTax += Number(storedBases.incomeTaxAmount || 0);
        continue;
      }

      const payrollCurrency = normalizeCurrencyCode(slip.currency || slip?.taxBreakdown?.payrollCurrency);
      const storedCalculationCurrency = String(slip?.taxBreakdown?.calculationCurrency || '').trim().toUpperCase();
      const storedRate = Number(slip?.taxBreakdown?.currencyConversion?.rate || 0);
      const legacyValues = {
        ytdGrossPay: Number(slip?.earningsSummary?.grossPay || 0),
        ytdTaxableIncome: Number(slip?.taxBreakdown?.grossTaxableIncome || 0),
        ytdIncomeTax: Number(slip?.taxBreakdown?.taxAmount || 0),
      };

      if (storedCalculationCurrency === calculationCurrency && storedRate > 0) {
        totals.ytdGrossPay += legacyValues.ytdGrossPay * storedRate;
        totals.ytdTaxableIncome += legacyValues.ytdTaxableIncome * storedRate;
        totals.ytdIncomeTax += legacyValues.ytdIncomeTax * storedRate;
        continue;
      }

      for (const [field, amount] of Object.entries(legacyValues)) {
        totals[field] += await this.convertAmountToCurrency(
          profile.organizationId,
          amount,
          payrollCurrency,
          calculationCurrency,
          slip?.payPeriod?.paymentDate || payDate
        );
      }
    }

    return {
      taxYear,
      calculationCurrency,
      ytdGrossPay: currencyService.roundAmount(totals.ytdGrossPay, calculationCurrency),
      ytdTaxableIncome: currencyService.roundAmount(totals.ytdTaxableIncome, calculationCurrency),
      ytdIncomeTax: currencyService.roundAmount(totals.ytdIncomeTax, calculationCurrency),
    };
  }

  /**
   * Process a payroll run for an organization (used by scheduler)
   * @param {string} organizationId
   * @param {Object} options - { month, year, includeBonuses, includeOvertime, paymentDate }
   */
  async processPayrollRun(organizationId, options) {
    const { month, year, includeBonuses, includeOvertime, paymentDate } = options || {};

    if (!Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12
      || !Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 2200) {
      throw new Error('month must be 1-12 and year must be a supported integer');
    }

    const normalizedMonth = Number(month);
    const normalizedYear = Number(year);

    const runFrequency = 'monthly';
    const exists = await PayrollRun.existsForPeriod(organizationId, normalizedYear, normalizedMonth, { type: runFrequency });
    if (exists) {
      return { skipped: true, reason: 'Payroll run already exists for this period' };
    }

    const runNumber = await PayrollRun.generateRunNumber(organizationId, normalizedYear, normalizedMonth);
    const startDate = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, 1));
    const endDate = new Date(Date.UTC(normalizedYear, normalizedMonth, 0, 23, 59, 59, 999));
    const defaultPaymentDate = paymentDate ? new Date(paymentDate) : endDate;
    if (Number.isNaN(defaultPaymentDate.getTime())) {
      throw new Error('paymentDate is invalid');
    }

    const currencyPolicy = await organizationCurrencyService.getPolicy(organizationId, {
      userId: 'system-scheduler',
      name: 'Automated Scheduler',
    });
    const reportingCurrency = await organizationCurrencyService.assertReportingCurrency(
      organizationId,
      currencyPolicy.reportingCurrency || currencyPolicy.functionalCurrency
    );

    const run = new PayrollRun({
      runNumber,
      organizationId,
      payPeriod: {
        type: runFrequency,
        month: normalizedMonth,
        year: normalizedYear,
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
        reportingCurrency,
      },
      createdBy: 'system-scheduler',
      createdByName: 'Automated Scheduler',
      processedBy: 'system-scheduler',
      processedByName: 'Automated Scheduler',
    });

    try {
      await run.save();
    } catch (error) {
      if (error?.code === 11000) {
        return { skipped: true, reason: 'Payroll run already exists for this period' };
      }
      throw error;
    }

    const result = await this.calculateRun(run._id, organizationId);
    const payslips = await Payslip.find({ payrollRunId: run._id });

    return {
      payslips: payslips.map(p => p.toObject()),
      totalEmployees: result.summary.totalEmployees,
      totalPayrollCost: result.summary.totalEmployerCost,
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
    if (!run.employerEntityId) {
      const error = new Error('Assign a legal employer before calculating this payroll run.');
      error.code = 'PAYROLL_EMPLOYER_ENTITY_REQUIRED';
      error.statusCode = 422;
      throw error;
    }
    const employerContext = await employerEntityService.assertRunEntity(
      run.employerEntityId,
      organizationId,
      payPeriod?.paymentDate
    );
    // Draft/calculated runs are intentionally mutable. Refresh their pinned
    // employer evidence during calculation so a newly released platform pack
    // can be adopted by Recalculate without altering finalized history.
    refreshMutableRunEmployerSnapshot(run, employerContext);
    if ((payPeriod?.type || 'monthly') !== 'monthly') {
      const error = new Error('Only monthly payroll runs are currently certified. Non-monthly payroll requires a reviewed salary-frequency and period-overlap configuration.');
      error.code = 'PAY_FREQUENCY_NOT_CERTIFIED';
      throw error;
    }
    const payStart = new Date(payPeriod.startDate);
    const payEnd = new Date(payPeriod.endDate);

    // 1. Fetch eligible profiles (with optional filters)
    const profileQuery = {
      organizationId,
      employerEntityId: run.employerEntityId,
      isActive: true,
      'payrollFlags.includeInNextRun': true,
      $or: [
        { basicSalary: { $gt: 0 } },
        { 'workTerms.payBasis': { $in: ['hourly', 'daily'] }, 'workTerms.rate': { $gt: 0 } },
        { 'workTerms.payBasis': 'fixed_contract', 'workTerms.contractAmount': { $gt: 0 } },
      ],
    };
    if ((payPeriod.type || 'monthly') === 'monthly') {
      profileQuery.$and = [{
        $or: [
          { payFrequency: 'monthly' },
          { payFrequency: { $exists: false } },
        ],
      }];
    } else {
      profileQuery.payFrequency = payPeriod.type;
    }

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
    let nextPayslipSequence = await Payslip.reservePayslipSequences(
      run.organizationId,
      payPeriod.year,
      payPeriod.month,
      Math.max(1, profiles.length)
    );

    for (const profile of profiles) {
      const employeeName = profile.employeeInfo?.name || 'Employee';
      const employeeCurrency = normalizeCurrencyCode(profile.currency);
      try {
        employerEntityService.assertProfileAssignment(profile, employerContext.entity);
        await organizationCurrencyService.assertPaymentCurrency(organizationId, employeeCurrency);
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

        const workInput = (run.workInputs || []).find(input => String(input.userId) === String(profile.userId));
        const payslip = await this.calculateEmployeePay(profile, run, { payslipNumber, workInput });
        if (!payslip) {
          skippedCount += 1;
          run.employees.push({
            userId: profile.userId,
            employeeName,
            currency: employeeCurrency,
            grossPay: 0,
            deductions: 0,
            netPay: 0,
            status: 'skipped',
            errorMessage: 'Contract is outside this pay period',
          });
          continue;
        }
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
        const errorType = String(profileError.code || 'processing_error');
        errors.push({
          userId: profile.userId,
          employeeName,
          errorType,
          errorMessage: profileError.message,
        });

        run.logError(profile.userId, employeeName, errorType, profileError.message);

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
    const appliedImportIds = payslips.flatMap(payslip => payslip.timeAttendance?.importIds || []);
    if (appliedImportIds.length > 0) {
      await TimeAttendanceImport.updateMany(
        { _id: { $in: appliedImportIds }, $or: [{ status: 'accepted' }, { status: 'applied', appliedPayrollRunId: run._id }] },
        { $set: { status: 'applied', appliedPayrollRunId: run._id } }
      );
    }

    // Totals & status
    run.updateTotalsFromPayslips(payslips);
    await this.applyRunCurrencySummary(run, payslips);
    if (run.summary?.hasAggregateTotals === false) {
      const reportingError = {
        userId: '',
        employeeName: 'Payroll run',
        errorType: 'REPORTING_CURRENCY_CONVERSION_MISSING',
        errorMessage: `Reporting totals could not be calculated in ${run.summary?.reportingCurrency || run.summary?.currency || 'the configured currency'}: ${(run.summary?.conversionWarnings || []).join(' ') || 'one or more pay-date exchange rates are missing.'}`,
      };
      errors.push(reportingError);
      run.logError('', reportingError.employeeName, reportingError.errorType, reportingError.errorMessage);
    }
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
        totalEmployerContributions: run.summary.totalEmployerContributions,
        totalEmployerCost: run.summary.totalEmployerCost,
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
    const workInput = options.workInput || {};
    const basePay = calculateContractBasePay(profile, run.payPeriod, workInput);
    if (!basePay.eligible) return null;
    const employment = employmentPeriod(profile, payStart, payEnd);
    if (!employment.eligible) return null;

    // Bank snapshot (masked)
    const bank = (profile.bankAccounts || []).find(b => b.isPrimary) || profile.bankAccounts?.[0];

    const payslip = new Payslip({
      payslipNumber,
      payrollRunId: run._id,
      userId: profile.userId,
      organizationId: run.organizationId,
      employerEntityId: run.employerEntityId,
      employerEntitySnapshot: {
        code: run.employerEntitySnapshot?.code,
        legalName: run.employerEntitySnapshot?.legalName,
        countryCode: run.employerEntitySnapshot?.countryCode,
        jurisdictionCode: run.employerEntitySnapshot?.jurisdictionCode,
        currency: run.employerEntitySnapshot?.currency,
      },
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
      calculationBasis: {
        payBasis: basePay.payBasis,
        rate: basePay.rate,
        units: basePay.units,
        unitLabel: basePay.unitLabel,
        contractReference: profile.workTerms?.contractReference,
        contractStartDate: profile.workTerms?.contractStartDate,
        contractEndDate: profile.workTerms?.contractEndDate,
        workInputNotes: workInput.notes,
      },
      currency: payslipCurrency,
      status: 'draft',
      createdBy: run.createdBy,
      employerContributions: [],
    });

    const attendanceImports = await TimeAttendanceImport.find({
      organizationId: run.organizationId,
      userId: profile.userId,
      $or: [
        { status: 'accepted', eventType: 'adjustment' },
        { status: 'accepted', 'period.endAt': { $gte: payStart, $lte: payEnd } },
        { status: 'applied', appliedPayrollRunId: run._id },
      ],
    }).sort({ acceptedAt: 1 });
    const attendanceLines = attendanceImports.flatMap(item => (item.payCodeLines || []).map(line => ({
      line,
      importId: item._id,
    })));
    payslip.timeAttendance = {
      importIds: attendanceImports.map(item => item._id),
      sourceTimesheets: attendanceImports.map(item => ({ sourceTimesheetId: item.sourceTimesheetId, sourceVersion: item.sourceVersion, eventType: item.eventType })),
      payCodeLines: attendanceLines.map(item => item.line),
      regularHours: attendanceLines.reduce((sum, item) => sum + (item.line.category === 'regular' || item.line.metadata?.adjustmentCategory === 'regular' ? Number(item.line.quantity || 0) : 0), 0),
      overtimeHours: attendanceLines.reduce((sum, item) => sum + (item.line.category === 'overtime' || item.line.metadata?.adjustmentCategory === 'overtime' ? Number(item.line.quantity || 0) : 0), 0),
      disclaimer: 'Imported approved attendance; payroll remains the owner of financial calculation.',
    };

    // =====================================================
    // 1) Earnings
    // =====================================================

    // Base salary (optionally prorated)
    let basicSalary = Number(basePay.amount || 0);
    let prorationFactor = 1;

    if (basePay.payBasis === 'salary' && settings.prorate !== false) {
      prorationFactor = employment.factor;
    }

    const importedRegularTime = attendanceLines.some(({ line }) => {
      const category = line.category === 'adjustment' ? line.metadata?.adjustmentCategory : line.category;
      return category === 'regular';
    });
    const attendanceDrivenBase = importedRegularTime && ['hourly', 'daily'].includes(basePay.payBasis);
    const proratedBasic = attendanceDrivenBase ? 0 : roundMoney(basicSalary * prorationFactor);
    if (proratedBasic > 0) {
      payslip.addEarning(
        'basic',
        basePay.payBasis === 'salary'
          ? (prorationFactor < 1 ? `Basic Salary (Prorated ${(prorationFactor * 100).toFixed(1)}%)` : 'Basic Salary')
          : `${basePay.payBasis === 'fixed_contract' ? 'Contract fee' : 'Regular pay'} (${basePay.units} ${basePay.unitLabel}${basePay.payBasis === 'fixed_contract' ? '' : ` @ ${basePay.rate}`})`,
        proratedBasic,
        { taxable: true, isRecurring: true }
      );
    }

    const hourlyRate = resolveProfileHourlyRate(profile, basePay, basicSalary);
    const addAttendanceAmount = (line, importId, amount, earningType = 'other') => {
      const rounded = roundMoney(amount);
      if (rounded > 0) {
        payslip.addEarning(earningType, `${line.payCode} (${Number(line.quantity || 0)} ${line.unit || 'hours'})`, rounded, {
          linkedRequestId: `time-attendance:${importId}`,
          isRecurring: false,
          taxable: true,
        });
      } else if (rounded < 0) {
        payslip.addDeduction('other', `${line.payCode} adjustment`, Math.abs(rounded), { isRecurring: false, metadata: { source: 'time-attendance', payCode: line.payCode } });
      }
    };
    for (const attendanceLine of attendanceLines) {
      const { line, importId } = attendanceLine;
      const category = line.category === 'adjustment' ? line.metadata?.adjustmentCategory : line.category;
      const quantity = Number(line.quantity || 0);
      const multiplier = Number(line.rateMultiplier ?? 1);
      const unitAmount = line.unit === 'amount' ? quantity : quantity * hourlyRate * multiplier;
      if (category === 'regular' && ['hourly', 'daily'].includes(basePay.payBasis)) addAttendanceAmount(line, importId, unitAmount, 'basic');
      else if (category === 'overtime' && settings.includeOvertime !== false) addAttendanceAmount(line, importId, unitAmount, 'overtime');
      else if (category === 'holiday') {
        const holidayAmount = ['hourly', 'daily'].includes(basePay.payBasis) ? unitAmount : quantity * hourlyRate * Math.max(0, multiplier - 1);
        addAttendanceAmount(line, importId, holidayAmount, 'other');
      } else if (['allowance', 'differential'].includes(category)) addAttendanceAmount(line, importId, unitAmount, 'other');
    }

    // Recurring allowances
    if (settings.includeAllowances !== false && Array.isArray(profile.allowances)) {
      for (const allowance of profile.allowances) {
        if (!allowance?.isActive) continue;
        if (!inPeriod(payStart, payEnd, allowance.effectiveFrom, allowance.effectiveTo)) continue;
        const treatment = payComponentTaxService.resolveComponent(
          allowance.toObject ? allowance.toObject() : allowance,
          paymentDate,
          profile.taxConfig?.jurisdictionCode
        );
        if (treatment.requiresReview) {
          const error = new Error(treatment.reviewMessage || `Tax treatment for ${allowance.name} requires review.`);
          error.code = 'PAY_COMPONENT_TAX_REVIEW_REQUIRED';
          throw error;
        }
        payslip.addEarning(allowance.type, allowance.name, treatment.value, {
          taxable: treatment.taxable,
          taxableAmount: treatment.taxableAmount,
          cashPayable: treatment.cashPayable,
          classificationCode: allowance.classificationCode || allowance.type,
          taxTreatment: treatment.treatment,
          taxTreatmentSource: treatment.source,
          metadata: {
            authorityReason: treatment.authorityReason || '',
            evidenceReference: treatment.evidenceReference || '',
            overridePeriod: treatment.overridePeriod || '',
          },
          isRecurring: true,
        });
      }
    }

    // Recurring benefits may be cash or non-cash. Non-cash value is included in
    // the relevant taxable base without being added to employee cash pay.
    if (Array.isArray(profile.benefitItems)) {
      for (const benefit of profile.benefitItems) {
        if (!benefit?.isActive) continue;
        if (!inPeriod(payStart, payEnd, benefit.effectiveFrom, benefit.effectiveTo)) continue;
        const treatment = payComponentTaxService.resolveComponent(
          benefit.toObject ? benefit.toObject() : benefit,
          paymentDate,
          profile.taxConfig?.jurisdictionCode
        );
        if (treatment.requiresReview) {
          const error = new Error(treatment.reviewMessage || `Tax treatment for ${benefit.name} requires review.`);
          error.code = 'PAY_COMPONENT_TAX_REVIEW_REQUIRED';
          throw error;
        }
        payslip.addEarning('benefit_in_kind', benefit.name, treatment.value, {
          taxable: treatment.taxable,
          taxableAmount: treatment.taxableAmount,
          cashPayable: benefit.cashPayable === true,
          classificationCode: benefit.classificationCode,
          taxTreatment: treatment.treatment,
          taxTreatmentSource: treatment.source,
          metadata: {
            authorityReason: treatment.authorityReason || '',
            evidenceReference: treatment.evidenceReference || '',
            overridePeriod: treatment.overridePeriod || '',
          },
          isRecurring: true,
        });
        if (Number(benefit.employerPaidAmount || 0) > 0) {
          payslip.employerContributions.push({
            type: benefit.classificationCode === 'employer_medical_cover' ? 'health_insurance' : 'other',
            name: `${benefit.name} - Employer Paid`,
            amount: roundMoney(benefit.employerPaidAmount),
            description: 'Employer-paid benefit cost; not deducted from employee cash pay.',
            metadata: { classificationCode: benefit.classificationCode },
          });
          payslip.calculateTotals();
        }
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

        if (req.type === 'overtime' && isVariableCompensationEnabled(req.type, settings)) {
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
              taxable: true,
              classificationCode: 'cash_allowance',
              taxTreatment: 'taxable',
              taxTreatmentSource: 'statutory_compensation_default',
            });
          }
          continue;
        }

        if ((req.type === 'bonus' || req.type === 'commission' || req.type === 'incentive')
          && isVariableCompensationEnabled(req.type, settings)) {
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
              taxable: true,
              classificationCode: 'cash_bonus',
              taxTreatment: 'taxable',
              taxTreatmentSource: 'statutory_compensation_default',
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
            const metadata = req.metadata && typeof req.metadata === 'object' ? req.metadata : {};
            const treatment = payComponentTaxService.resolveComponent({
              name: req.reason || 'Reimbursement',
              amount: amt,
              fairValue: amt,
              paymentKind: 'cash',
              classificationCode: 'business_expense_reimbursement',
              taxTreatment: req.taxable === false ? 'non_taxable' : 'taxable',
              taxAuthorityReason: metadata.taxAuthorityReason || metadata.authorityReason || '',
              taxEvidenceReference: metadata.taxEvidenceReference
                || metadata.evidenceReference
                || metadata.receiptReference
                || metadata.receiptUrl
                || '',
            }, req.effectiveDate || paymentDate, profile.taxConfig?.jurisdictionCode);
            if (treatment.requiresReview) {
              const error = new Error(treatment.reviewMessage || 'The reimbursement tax treatment requires evidence.');
              error.code = 'PAY_COMPONENT_TAX_REVIEW_REQUIRED';
              throw error;
            }
            payslip.addEarning('reimbursement', req.reason || 'Reimbursement', amt, {
              linkedRequestId,
              isRecurring: false,
              taxable: treatment.taxable,
              taxableAmount: treatment.taxableAmount,
              classificationCode: 'business_expense_reimbursement',
              taxTreatment: treatment.treatment,
              taxTreatmentSource: treatment.source,
              metadata: {
                authorityReason: treatment.authorityReason || '',
                evidenceReference: treatment.evidenceReference || '',
              },
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
              taxable: true,
              classificationCode: 'cash_allowance',
              taxTreatment: 'taxable',
              taxTreatmentSource: 'statutory_compensation_default',
            });
          }
          continue;
        }
      }
    }

    // =====================================================
    // 2) Unpaid leave reduces earned salary before tax/statutory bases.
    // =====================================================
    if (basePay.payBasis === 'salary' && settings.processUnpaidLeave === false) {
      const error = new Error('Approved unpaid-leave verification cannot be disabled for salaried payroll.');
      error.code = 'LEAVE_VERIFICATION_DISABLED';
      throw error;
    }
    if (basePay.payBasis === 'salary') {
      try {
        const unpaidLeave = await leaveService.calculateUnpaidLeaveDeduction(
          run.organizationId,
          profile.userId,
          Number((payslip.earnings || []).find((earning) => earning.type === 'basic')?.amount || 0),
          payStart,
          payEnd
        );

        if (unpaidLeave.days > 0 && unpaidLeave.amount > 0) {
          const basicEarning = (payslip.earnings || []).find((earning) => earning.type === 'basic');
          if (basicEarning) {
            const originalAmount = Number(basicEarning.amount || 0);
            const originalTaxableAmount = Number(basicEarning.taxableAmount ?? originalAmount);
            const reduction = Math.min(originalAmount, Math.max(0, Number(unpaidLeave.amount || 0)));
            basicEarning.amount = roundMoney(originalAmount - reduction);
            basicEarning.taxableAmount = roundMoney(Math.max(0, originalTaxableAmount - reduction));
            basicEarning.description = [
              basicEarning.description,
              `Reduced by ${roundMoney(reduction)} for ${unpaidLeave.days} unpaid leave day(s).`,
            ].filter(Boolean).join(' ');
            basicEarning.metadata = {
              ...(basicEarning.metadata || {}),
              unpaidLeaveDays: unpaidLeave.days,
              unpaidLeaveReduction: roundMoney(reduction),
            };
            payslip.calculateTotals();
          }
        }
      } catch (leaveError) {
        const error = new Error(`Approved unpaid-leave data could not be verified for ${profile.employeeInfo?.name || profile.userId}: ${leaveError.message}`);
        error.code = leaveError.code || 'LEAVE_DATA_UNAVAILABLE';
        throw error;
      }
    }

    // Voluntary profile pension percentages affect cash pay, but they are not
    // assumed to reduce taxable income. Statutory relief belongs to the pack.
    const effectivePension = taxService.resolveEffectivePensionSettings(
      profile.taxConfig || {},
      profile.statutoryContributions || {}
    );
    const pensionIsPackManaged = String(profile.taxConfig?.jurisdictionCode || '').toUpperCase() === 'NG';
    if (!pensionIsPackManaged && effectivePension.enabled && effectivePension.employeePercent > 0) {
      const pensionAmt = roundMoney((payslip.earningsSummary?.grossPay || 0) * (effectivePension.employeePercent / 100));
      if (pensionAmt > 0) {
        payslip.addDeduction('pension', 'Voluntary Pension Contribution', pensionAmt, {
          isPreTax: false,
          metadata: { taxTreatment: 'post_tax_until_pack_verified' },
        });
      }
    }
    if (!pensionIsPackManaged && effectivePension.enabled && effectivePension.employerPercent > 0) {
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
    // 3) Profile recurring deductions. Statutory pre-tax treatment must be
    // owned by the effective tax pack rather than an unrestricted profile flag.
    // =====================================================
    const currentGross = payslip.earningsSummary?.grossPay || 0;

    const recurring = Array.isArray(profile.recurringDeductions) ? profile.recurringDeductions : [];

    const ungovernedPreTax = recurring.find((deduction) => (
      deduction?.isActive && deduction?.isPreTax
      && inPeriod(payStart, payEnd, deduction.startDate, deduction.endDate)
    ));
    if (ungovernedPreTax) {
      const error = new Error(`Recurring deduction "${ungovernedPreTax.name || 'Unnamed deduction'}" cannot reduce taxable income from a profile flag. Configure the statutory deduction and evidence in the employee's effective tax pack.`);
      error.code = 'PRETAX_DEDUCTION_NOT_PACK_MANAGED';
      throw error;
    }

    // =====================================================
    // 4) Statutory deductions (income tax, social security)
    // =====================================================

    {
      // Compute taxable base: sum of taxable earnings - pre-tax deductions
      const taxableEarnings = (payslip.earnings || [])
        .filter(e => e?.taxable !== false)
        .reduce((sum, e) => sum + Number(e.taxableAmount ?? e.amount ?? 0), 0);

      const preTaxDeductions = (payslip.deductions || [])
        .filter(d => d?.isPreTax)
        .reduce((sum, d) => sum + (d.amount || 0), 0);

      const netTaxableIncome = Math.max(0, roundMoney(taxableEarnings - preTaxDeductions));
      const pensionablePay = (payslip.earnings || [])
        .filter((earning) => ['basic', 'hra', 'transport'].includes(earning.type))
        .reduce((sum, earning) => sum + Number(earning.amount || 0), 0);
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
        ytdIncomeTax: ytdContext.ytdIncomeTax,
        ytdCurrency: ytdContext.calculationCurrency,
        currency: payslipCurrency,
        statutoryBases: {
          pensionablePay: roundMoney(pensionablePay),
          socialSecurityPay: roundMoney(taxableEarnings),
          insurablePay: roundMoney(taxableEarnings),
        },
      });

      if (taxResult?.payrollRunnable === false) {
        const error = new Error((taxResult.blockingErrors || taxResult.validationErrors || []).join(' ') || 'The selected statutory pack is not approved for payroll.');
        error.code = 'STATUTORY_PACK_NOT_RUNNABLE';
        error.details = taxResult.blockingErrors || taxResult.validationErrors || [];
        throw error;
      }

      const withholdingTreatment = taxWithholdingTreatmentService.applyTaxWithholdingTreatment(
        taxResult,
        profile.taxConfig || {},
        taxPaymentDate
      );
      const incomeTaxAmount = roundMoney(withholdingTreatment.incomeTaxAmount);
      if (settings.calculateTax === false && incomeTaxAmount > 0) {
        const error = new Error('Income-tax withholding cannot be disabled while the selected statutory pack calculates a liability. Record an approved statutory exemption instead.');
        error.code = 'INCOME_TAX_PROCESSING_DISABLED';
        throw error;
      }

      if (settings.calculateTax !== false) {

        if (incomeTaxAmount > 0) {
          payslip.addDeduction('income_tax', 'Income Tax', incomeTaxAmount, { isPreTax: false });
        }

        payslip.taxBreakdown = {
          grossTaxableIncome: roundMoney(taxResult?.incomeTax?.grossTaxableIncome ?? taxableEarnings),
          taxExemptIncome: roundMoney(taxResult?.incomeTax?.taxExemptIncome ?? 0),
          deductionsBeforeTax: roundMoney(taxResult?.incomeTax?.deductionsBeforeTax ?? preTaxDeductions),
          netTaxableIncome: roundMoney(taxResult?.incomeTax?.netTaxableIncome ?? netTaxableIncome),
          taxRate: roundMoney(taxResult?.incomeTax?.taxRate ?? 0),
          taxAmount: incomeTaxAmount,
          yearToDateTax: roundMoney((taxResult?.yearToDateIncomeTax ?? 0) + incomeTaxAmount),
          jurisdictionCode: taxResult?.incomeTax?.jurisdictionCode || '',
          jurisdictionName: taxResult?.incomeTax?.jurisdictionName || '',
          jurisdictionConfigId: taxResult?.jurisdictionConfig?._id || null,
          jurisdictionVersionId: taxResult?.jurisdictionVersion?._id || null,
          taxYearLabel: taxResult?.incomeTax?.taxYearLabel || ytdContext.taxYear?.label || '',
          calculationMode: taxResult?.incomeTax?.calculationMode || '',
          method: withholdingTreatment.employeeResponsible
            ? 'employee_responsible'
            : (taxResult?.incomeTax?.method || ''),
          annualizedIncome: roundMoney(taxResult?.incomeTax?.annualizedIncome ?? 0),
          annualizedTaxableIncome: roundMoney(taxResult?.incomeTax?.annualizedTaxableIncome ?? 0),
          taxableIncomeAfterReliefs: roundMoney(taxResult?.incomeTax?.taxableIncomeAfterReliefs ?? 0),
          notes: [
            ...(Array.isArray(taxResult?.incomeTax?.notes) ? taxResult.incomeTax.notes : []),
            ...(withholdingTreatment.employeeResponsible
              ? ['No employee tax was withheld because this employee is responsible for their own tax.']
              : []),
          ],
          details: taxResult?.incomeTax?.details || undefined,
          calculationTrace: {
            validationErrors: Array.isArray(taxResult?.validationErrors) ? taxResult.validationErrors : [],
            employeeTaxInputs: taxResult?.employeeTaxInputs || {},
            statutoryPackHash: taxResult?.compliance?.contentHash || '',
            sourceLinks: taxResult?.compliance?.sourceLinks || [],
            withholdingTreatment: {
              mode: withholdingTreatment.mode,
              reason: withholdingTreatment.reason,
              suppressedIncomeTax: roundMoney(withholdingTreatment.suppressedIncomeTax),
              suppressedEmployeeStatutoryAmount: roundMoney(withholdingTreatment.suppressedEmployeeStatutoryAmount),
            },
          },
          calculationCurrency: taxResult?.calculationCurrency || payslipCurrency,
          payrollCurrency: payslipCurrency,
          currencyConversion: taxResult?.currencyConversion || null,
          calculationBases: taxResult?.calculationBases || null,
          compliance: taxResult?.compliance || {},
        };
      }

      const statutoryComponents = withholdingTreatment.statutoryComponents;
      const hasStatutoryLiability = statutoryComponents.some((component) => Number(component?.amount || 0) > 0);
      if (settings.processStatutoryDeductions === false && hasStatutoryLiability) {
        const error = new Error('Statutory deductions and employer liabilities cannot be disabled while the selected pack calculates an amount. Record an approved statutory exemption instead.');
        error.code = 'STATUTORY_PROCESSING_DISABLED';
        throw error;
      }

      if (settings.processStatutoryDeductions !== false) {
      for (const component of statutoryComponents) {
        if (Number(component?.amount || 0) <= 0) continue;
        if (component.payer === 'employer') {
          payslip.employerContributions.push({
            type: normalizeStatutoryComponentType(component.type, 'employer'),
            name: component.name || 'Employer Statutory Contribution',
            amount: roundMoney(component.amount),
            liabilityCode: component.liabilityCode || '',
            remittanceAuthority: component.remittanceAuthority || '',
            metadata: {
              source: component.source,
              taxableAmount: roundMoney(component.taxableAmount || 0),
              rate: component.rate,
              cap: component.cap,
              threshold: component.threshold,
              hitCap: component.hitCap,
              calculationCurrency: component.calculationCurrency,
              conversionRate: component.conversionRate,
            },
          });
          payslip.calculateTotals();
          continue;
        }
        payslip.addDeduction(
          normalizeStatutoryComponentType(component.type, 'employee'),
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
              liabilityCode: component.liabilityCode,
              remittanceAuthority: component.remittanceAuthority,
              calculationCurrency: component.calculationCurrency,
              conversionRate: component.conversionRate,
            },
          }
        );
      }
      }
    }

    // Apply post-tax recurring deductions (including loans)
    for (const deduction of recurring.filter(d => d?.isActive && !d?.isPreTax)) {
      if (!inPeriod(payStart, payEnd, deduction.startDate, deduction.endDate)) continue;
      if (deduction.type === 'loan_repayment' && settings.processLoans === false) continue;

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
    payslip.normalizeCurrencyAmounts();

    if (Number(payslip.netPay || 0) < 0) {
      const error = new Error('Statutory and other deductions exceed this employee\'s cash earnings. Review withholding caps, deduction priority, or carry-forward handling before approval.');
      error.code = 'PAYROLL_NEGATIVE_NET_PAY';
      error.details = {
        cashGrossPay: roundMoney(payslip.earningsSummary?.cashGrossPay ?? payslip.earningsSummary?.grossPay ?? 0),
        totalDeductions: roundMoney(payslip.deductionsSummary?.totalDeductions ?? 0),
        netPay: roundMoney(payslip.netPay),
      };
      throw error;
    }

    return payslip;
  }
}

module.exports = PayrollEngineService;
module.exports.isVariableCompensationEnabled = isVariableCompensationEnabled;
module.exports.daysBetweenInclusive = daysBetweenInclusive;
module.exports.employmentPeriod = employmentPeriod;
module.exports.refreshMutableRunEmployerSnapshot = refreshMutableRunEmployerSnapshot;
module.exports.resolveProfileHourlyRate = resolveProfileHourlyRate;
