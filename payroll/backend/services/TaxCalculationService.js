/**
 * Tax Calculation Service
 *
 * Country-aware payroll tax calculations with a manual fallback.
 * Built-in jurisdictions are driven by the employee's tax jurisdiction,
 * not the employer's country of incorporation.
 */

const PAY_PERIODS_PER_YEAR = {
  monthly: 12,
  'semi-monthly': 24,
  'bi-weekly': 26,
  weekly: 52,
};

const BUILT_IN_JURISDICTIONS = new Map([
  ['GB', { code: 'GB', name: 'United Kingdom' }],
  ['US', { code: 'US', name: 'United States' }],
  ['NG', { code: 'NG', name: 'Nigeria' }],
  ['GH', { code: 'GH', name: 'Ghana' }],
  ['KE', { code: 'KE', name: 'Kenya' }],
  ['ZA', { code: 'ZA', name: 'South Africa' }],
]);

const STATUTORY_PROFILES = Object.freeze({
  GB: Object.freeze({
    code: 'GB',
    name: 'National Insurance',
    allowManualStatutoryOverride: true,
  }),
  US: Object.freeze({
    code: 'US',
    name: 'Social Security and Medicare',
    allowManualStatutoryOverride: true,
  }),
  NG: Object.freeze({
    code: 'NG',
    name: 'Contributory Pension Scheme',
    allowManualStatutoryOverride: false,
    defaultEmployeePensionPercent: 8,
    defaultEmployerPensionPercent: 10,
  }),
  GH: Object.freeze({
    code: 'GH',
    name: 'SSNIT',
    allowManualStatutoryOverride: true,
  }),
  KE: Object.freeze({
    code: 'KE',
    name: 'Statutory Contributions',
    allowManualStatutoryOverride: true,
  }),
  ZA: Object.freeze({
    code: 'ZA',
    name: 'Statutory Contributions',
    allowManualStatutoryOverride: true,
  }),
  EU: Object.freeze({
    code: 'EU',
    name: 'Statutory Contributions',
    allowManualStatutoryOverride: true,
  }),
  OTHER: Object.freeze({
    code: 'OTHER',
    name: 'Statutory Contributions',
    allowManualStatutoryOverride: true,
  }),
});

const LEGACY_REGIME_TO_CONFIG = {
  flat: { calculationMode: 'manual', manualCalculationType: 'flat' },
  none: { calculationMode: 'manual', manualCalculationType: 'none' },
  progressive_generic: { calculationMode: 'manual', manualCalculationType: 'progressive' },
  progressive_uk: { calculationMode: 'builtin', jurisdictionCode: 'GB' },
  progressive_us: { calculationMode: 'builtin', jurisdictionCode: 'US' },
};

const US_ANNUAL_TABLES_2026 = {
  standard: {
    married_filing_jointly: [
      { min: 0, max: 19300, baseTax: 0, rate: 0 },
      { min: 19300, max: 44100, baseTax: 0, rate: 10 },
      { min: 44100, max: 120100, baseTax: 2480, rate: 12 },
      { min: 120100, max: 230700, baseTax: 11600, rate: 22 },
      { min: 230700, max: 422850, baseTax: 35932, rate: 24 },
      { min: 422850, max: 531750, baseTax: 82048, rate: 32 },
      { min: 531750, max: 788000, baseTax: 116896, rate: 35 },
      { min: 788000, max: Infinity, baseTax: 206583.5, rate: 37 },
    ],
    single: [
      { min: 0, max: 7500, baseTax: 0, rate: 0 },
      { min: 7500, max: 19900, baseTax: 0, rate: 10 },
      { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
      { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
      { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
      { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
      { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
      { min: 648100, max: Infinity, baseTax: 192979.25, rate: 37 },
    ],
    married_filing_separately: [
      { min: 0, max: 7500, baseTax: 0, rate: 0 },
      { min: 7500, max: 19900, baseTax: 0, rate: 10 },
      { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
      { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
      { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
      { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
      { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
      { min: 648100, max: Infinity, baseTax: 192979.25, rate: 37 },
    ],
    head_of_household: [
      { min: 0, max: 15550, baseTax: 0, rate: 0 },
      { min: 15550, max: 33250, baseTax: 0, rate: 10 },
      { min: 33250, max: 83000, baseTax: 1770, rate: 12 },
      { min: 83000, max: 121250, baseTax: 7740, rate: 22 },
      { min: 121250, max: 217300, baseTax: 16155, rate: 24 },
      { min: 217300, max: 271750, baseTax: 39207, rate: 32 },
      { min: 271750, max: 656150, baseTax: 56631, rate: 35 },
      { min: 656150, max: Infinity, baseTax: 191171, rate: 37 },
    ],
  },
  multipleJobs: {
    married_filing_jointly: [
      { min: 0, max: 16100, baseTax: 0, rate: 0 },
      { min: 16100, max: 28500, baseTax: 0, rate: 10 },
      { min: 28500, max: 66500, baseTax: 1240, rate: 12 },
      { min: 66500, max: 121800, baseTax: 5800, rate: 22 },
      { min: 121800, max: 217875, baseTax: 17966, rate: 24 },
      { min: 217875, max: 272325, baseTax: 41024, rate: 32 },
      { min: 272325, max: 400450, baseTax: 58448, rate: 35 },
      { min: 400450, max: Infinity, baseTax: 103291.75, rate: 37 },
    ],
    single: [
      { min: 0, max: 8050, baseTax: 0, rate: 0 },
      { min: 8050, max: 14250, baseTax: 0, rate: 10 },
      { min: 14250, max: 33250, baseTax: 620, rate: 12 },
      { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
      { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
      { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
      { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
      { min: 328350, max: Infinity, baseTax: 96489.63, rate: 37 },
    ],
    married_filing_separately: [
      { min: 0, max: 8050, baseTax: 0, rate: 0 },
      { min: 8050, max: 14250, baseTax: 0, rate: 10 },
      { min: 14250, max: 33250, baseTax: 620, rate: 12 },
      { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
      { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
      { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
      { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
      { min: 328350, max: Infinity, baseTax: 96489.63, rate: 37 },
    ],
    head_of_household: [
      { min: 0, max: 12075, baseTax: 0, rate: 0 },
      { min: 12075, max: 20925, baseTax: 0, rate: 10 },
      { min: 20925, max: 45800, baseTax: 885, rate: 12 },
      { min: 45800, max: 64925, baseTax: 3870, rate: 22 },
      { min: 64925, max: 112950, baseTax: 8077.5, rate: 24 },
      { min: 112950, max: 140175, baseTax: 19603.5, rate: 32 },
      { min: 140175, max: 332375, baseTax: 28315.5, rate: 35 },
      { min: 332375, max: Infinity, baseTax: 95585.5, rate: 37 },
    ],
  },
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundRate(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCode(value, fallback = '') {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  return normalized || fallback || '';
}

function normalizeDate(value, fallback = new Date()) {
  if ((value === null || value === undefined || value === '') && fallback === null) {
    return null;
  }
  const date = value ? new Date(value) : new Date(fallback);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }
  if (fallback === null) {
    return null;
  }
  return new Date(fallback);
}

function getPayPeriodsPerYear(payFrequency) {
  return PAY_PERIODS_PER_YEAR[payFrequency] || PAY_PERIODS_PER_YEAR.monthly;
}

function getPeriodAmount(annualAmount, periodsPerYear) {
  return roundMoney(toNumber(annualAmount) / Math.max(1, periodsPerYear));
}

function sumTaxExemptions(exemptions = []) {
  return roundMoney(
    (Array.isArray(exemptions) ? exemptions : []).reduce((sum, item) => sum + toNumber(item?.amount), 0)
  );
}

function calculateProgressiveTaxFromBands(amount, bands = []) {
  const taxable = Math.max(0, toNumber(amount));
  let total = 0;
  const components = [];

  for (const band of bands) {
    const min = Math.max(0, toNumber(band.min));
    const max = band.max === null || band.max === undefined ? Infinity : Math.max(min, toNumber(band.max));
    if (taxable <= min) {
      continue;
    }

    const taxableInBand = Math.min(taxable, max) - min;
    if (taxableInBand <= 0) {
      continue;
    }

    const amountInBand = roundMoney(taxableInBand * (toNumber(band.rate) / 100));
    total += amountInBand;
    components.push({
      min,
      max: Number.isFinite(max) ? max : null,
      rate: roundRate(band.rate),
      taxableAmount: roundMoney(taxableInBand),
      taxAmount: amountInBand,
    });
  }

  return {
    amount: roundMoney(total),
    components,
  };
}

function calculateBaseRateTax(amount, rows = []) {
  const annualAmount = Math.max(0, toNumber(amount));
  const row = rows.find((entry) => annualAmount >= toNumber(entry.min) && annualAmount < toNumber(entry.max, Infinity))
    || rows[rows.length - 1]
    || { min: 0, baseTax: 0, rate: 0 };

  const excess = Math.max(0, annualAmount - toNumber(row.min));
  const tax = toNumber(row.baseTax) + (excess * (toNumber(row.rate) / 100));

  return {
    amount: roundMoney(tax),
    row: {
      min: toNumber(row.min),
      max: Number.isFinite(toNumber(row.max)) ? toNumber(row.max) : null,
      baseTax: roundMoney(row.baseTax),
      rate: roundRate(row.rate),
    },
  };
}

function ageOnDate(dateOfBirth, referenceDate) {
  const dob = normalizeDate(dateOfBirth, null);
  if (!dob || Number.isNaN(dob.getTime())) return null;

  const ref = normalizeDate(referenceDate);
  let age = ref.getFullYear() - dob.getFullYear();
  const monthDiff = ref.getMonth() - dob.getMonth();
  const dayDiff = ref.getDate() - dob.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

class TaxCalculationService {
  getSupportedJurisdictions() {
    return [
      { code: 'GB', name: 'United Kingdom', mode: 'builtin' },
      { code: 'US', name: 'United States', mode: 'builtin' },
      { code: 'NG', name: 'Nigeria', mode: 'builtin' },
      { code: 'GH', name: 'Ghana', mode: 'builtin' },
      { code: 'KE', name: 'Kenya', mode: 'builtin' },
      { code: 'ZA', name: 'South Africa', mode: 'builtin' },
      { code: 'EU', name: 'European Union (manual by member state)', mode: 'manual_only' },
      { code: 'OTHER', name: 'Other / Custom jurisdiction', mode: 'manual_only' },
    ];
  }

  getStatutoryProfile(jurisdictionCode = 'OTHER') {
    const code = normalizeCode(jurisdictionCode, 'OTHER');
    return STATUTORY_PROFILES[code] || STATUTORY_PROFILES.OTHER;
  }

  resolveEffectivePensionSettings(config = {}, statutoryContributions = {}) {
    const profile = this.getStatutoryProfile(config?.jurisdictionCode);
    const enabled = statutoryContributions?.pensionOptIn !== false;
    let employeePercent = Math.max(0, toNumber(statutoryContributions?.pensionContributionPercent));
    let employerPercent = Math.max(0, toNumber(statutoryContributions?.employerPensionPercent));
    let source = 'custom';

    if (
      enabled
      && profile.code === 'NG'
      && employeePercent <= 0
      && employerPercent <= 0
    ) {
      employeePercent = profile.defaultEmployeePensionPercent;
      employerPercent = profile.defaultEmployerPensionPercent;
      source = 'builtin_default';
    }

    return {
      enabled,
      employeePercent: roundRate(employeePercent),
      employerPercent: roundRate(employerPercent),
      source,
      profile,
    };
  }

  normalizeConfig(config = {}) {
    const legacy = LEGACY_REGIME_TO_CONFIG[config.calculationRegime] || {};
    const jurisdictionCode = normalizeCode(
      config.jurisdictionCode || config.jurisdictionCountry || legacy.jurisdictionCode || 'OTHER'
    );

    let calculationMode = String(config.calculationMode || legacy.calculationMode || '').trim().toLowerCase();
    if (!calculationMode) {
      calculationMode = BUILT_IN_JURISDICTIONS.has(jurisdictionCode) ? 'builtin' : 'manual';
    }

    if (!BUILT_IN_JURISDICTIONS.has(jurisdictionCode)) {
      calculationMode = 'manual';
    }

    const manualCalculationType = String(
      config.manualCalculationType
      || legacy.manualCalculationType
      || (config.calculationRegime === 'flat' ? 'flat' : 'progressive')
    ).trim().toLowerCase();

    return {
      taxId: String(config.taxId || '').trim(),
      taxRegime: String(config.taxRegime || 'standard').trim().toLowerCase(),
      calculationMode,
      jurisdictionCode,
      jurisdictionName: String(config.jurisdictionName || '').trim(),
      taxSubdivision: String(config.taxSubdivision || '').trim().toLowerCase(),
      residencyStatus: String(config.residencyStatus || 'resident').trim().toLowerCase(),
      manualCalculationType,
      manualTaxFreeAllowance: Math.max(0, toNumber(config.manualTaxFreeAllowance)),
      calculationRegime: config.calculationRegime || '',
      flatTaxRate: Math.max(0, toNumber(config.flatTaxRate)),
      customBrackets: Array.isArray(config.customBrackets)
        ? config.customBrackets.map((bracket) => ({
          min: Math.max(0, toNumber(bracket?.min)),
          max: bracket?.max === null || bracket?.max === undefined || bracket?.max === ''
            ? null
            : Math.max(0, toNumber(bracket?.max)),
          rate: Math.max(0, toNumber(bracket?.rate)),
        }))
        : [],
      socialSecurityRate: Math.max(0, toNumber(config.socialSecurityRate)),
      socialSecurityCap: Math.max(0, toNumber(config.socialSecurityCap)),
      taxExemptions: Array.isArray(config.taxExemptions) ? config.taxExemptions : [],
      additionalWithholding: Math.max(0, toNumber(config.additionalWithholding)),
      filingStatus: String(config.filingStatus || 'single').trim().toLowerCase(),
      dependents: Math.max(0, Math.floor(toNumber(config.dependents))),
      taxDeclarationSubmitted: !!config.taxDeclarationSubmitted,
      taxDeclarationYear: config.taxDeclarationYear ? toNumber(config.taxDeclarationYear) : null,
      otherIncome: Math.max(0, toNumber(config.otherIncome)),
      deductionsAdjustment: Math.max(0, toNumber(config.deductionsAdjustment)),
      taxCredits: Math.max(0, toNumber(config.taxCredits)),
      multipleJobs: !!config.multipleJobs,
    };
  }

  getTaxYearContext(config = {}, payDate = new Date()) {
    const normalizedConfig = this.normalizeConfig(config);
    const date = normalizeDate(payDate);
    const year = date.getFullYear();
    const jurisdictionCode = normalizedConfig.jurisdictionCode;

    if (jurisdictionCode === 'GB') {
      const startYear = (date.getMonth() > 3 || (date.getMonth() === 3 && date.getDate() >= 6)) ? year : year - 1;
      const start = new Date(startYear, 3, 6);
      const end = new Date(startYear + 1, 3, 5, 23, 59, 59, 999);
      return {
        jurisdictionCode,
        label: `${startYear}/${String(startYear + 1).slice(-2)}`,
        start,
        end,
      };
    }

    if (jurisdictionCode === 'ZA') {
      const startYear = (date.getMonth() > 1 || (date.getMonth() === 1 && date.getDate() >= 1)) ? year : year - 1;
      const start = new Date(startYear, 2, 1);
      const end = new Date(startYear + 1, 1, 28, 23, 59, 59, 999);
      return {
        jurisdictionCode,
        label: `${startYear + 1}`,
        start,
        end,
      };
    }

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return {
      jurisdictionCode,
      label: `${year}`,
      start,
      end,
    };
  }

  calculatePayrollTaxes(input = {}) {
    const payDate = normalizeDate(input.paymentDate);
    const payFrequency = input.payFrequency || 'monthly';
    const periodsPerYear = getPayPeriodsPerYear(payFrequency);
    const grossPay = Math.max(0, toNumber(input.grossPay));
    const taxableIncome = Math.max(0, toNumber(input.taxableIncome, grossPay));
    const basicSalary = Math.max(0, toNumber(input.basicSalary, grossPay));
    const preTaxDeductions = Math.max(0, toNumber(input.preTaxDeductions));
    const employeeInfo = input.employeeInfo || {};
    const statutoryContributions = input.statutoryContributions || {};
    const config = this.normalizeConfig(input.taxConfig || {});
    const taxYear = this.getTaxYearContext(config, payDate);
    const taxExemptIncome = sumTaxExemptions(config.taxExemptions);

    const statutoryResult = this.calculateStatutoryContributions({
      config,
      grossPay,
      taxableIncome,
      basicSalary,
      payDate,
      payFrequency,
      periodsPerYear,
      ytdGrossPay: toNumber(input.ytdGrossPay),
      ytdTaxableIncome: toNumber(input.ytdTaxableIncome),
      statutoryContributions,
      taxYear,
    });

    const taxableIncomeAfterReliefs = Math.max(
      0,
      taxableIncome - statutoryResult.reducesTaxableIncome - taxExemptIncome
    );

    const incomeTaxResult = this.calculateIncomeTax({
      config,
      grossPay,
      taxableIncome,
      taxableIncomeAfterReliefs,
      taxExemptIncome,
      payDate,
      payFrequency,
      periodsPerYear,
      employeeInfo,
      taxYear,
    });

    const effectiveRate = taxableIncome > 0
      ? roundRate((incomeTaxResult.taxAmount / taxableIncome) * 100)
      : 0;

    return {
      config,
      taxYear,
      incomeTax: {
        ...incomeTaxResult,
        grossTaxableIncome: roundMoney(taxableIncome + preTaxDeductions),
        taxExemptIncome: roundMoney(taxExemptIncome + statutoryResult.reducesTaxableIncome),
        deductionsBeforeTax: roundMoney(preTaxDeductions),
        netTaxableIncome: roundMoney(taxableIncomeAfterReliefs),
        taxRate: effectiveRate,
      },
      statutoryContributions: statutoryResult,
    };
  }

  calculateIncomeTax(input = {}) {
    const config = this.normalizeConfig(input.config || input);
    const periodsPerYear = input.periodsPerYear || getPayPeriodsPerYear(input.payFrequency || 'monthly');
    const taxableIncome = Math.max(0, toNumber(input.taxableIncomeAfterReliefs, input.taxableIncome));
    const annualizedTaxableIncome = roundMoney(taxableIncome * periodsPerYear);

    if (config.taxRegime === 'exempt') {
      return {
        taxAmount: 0,
        taxYearLabel: input.taxYear?.label || '',
        jurisdictionCode: config.jurisdictionCode,
        jurisdictionName: this.getJurisdictionName(config),
        calculationMode: config.calculationMode,
        method: 'exempt',
        annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
        annualizedTaxableIncome,
        taxableIncomeAfterReliefs: annualizedTaxableIncome,
        notes: ['Employee is marked as tax exempt.'],
        details: { method: 'exempt' },
      };
    }

    if (config.calculationMode === 'builtin') {
      return this.calculateBuiltInIncomeTax({
        ...input,
        config,
        taxableIncome,
        annualizedTaxableIncome,
        periodsPerYear,
      });
    }

    return this.calculateManualIncomeTax({
      ...input,
      config,
      taxableIncome,
      annualizedTaxableIncome,
      periodsPerYear,
    });
  }

  calculateBuiltInIncomeTax(input = {}) {
    const jurisdictionCode = input.config.jurisdictionCode;

    switch (jurisdictionCode) {
      case 'GB':
        return this.calculateUnitedKingdomTax(input);
      case 'US':
        return this.calculateUnitedStatesTax(input);
      case 'NG':
        return this.calculateNigeriaTax(input);
      case 'GH':
        return this.calculateGhanaTax(input);
      case 'KE':
        return this.calculateKenyaTax(input);
      case 'ZA':
        return this.calculateSouthAfricaTax(input);
      default:
        return this.calculateManualIncomeTax({
          ...input,
          config: {
            ...input.config,
            calculationMode: 'manual',
            manualCalculationType: 'progressive',
          },
          notes: ['Built-in rules are not available for this jurisdiction; manual configuration was used instead.'],
        });
    }
  }

  calculateManualIncomeTax(input = {}) {
    const { config, taxableIncome, annualizedTaxableIncome, periodsPerYear } = input;
    const manualType = config.manualCalculationType || 'progressive';
    const notes = Array.isArray(input.notes) ? [...input.notes] : [];

    if (manualType === 'none') {
      notes.push('Manual tax mode is set to no withholding.');
      return {
        taxAmount: 0,
        taxYearLabel: input.taxYear?.label || '',
        jurisdictionCode: config.jurisdictionCode,
        jurisdictionName: this.getJurisdictionName(config),
        calculationMode: 'manual',
        method: 'manual_none',
        annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
        annualizedTaxableIncome,
        taxableIncomeAfterReliefs: annualizedTaxableIncome,
        notes,
        details: { method: 'manual_none' },
      };
    }

    if (manualType === 'flat') {
      const taxAmount = roundMoney(taxableIncome * (config.flatTaxRate / 100));
      if (config.additionalWithholding > 0) {
        notes.push('Additional withholding was added on top of the flat-rate tax.');
      }

      return {
        taxAmount: roundMoney(taxAmount + config.additionalWithholding),
        taxYearLabel: input.taxYear?.label || '',
        jurisdictionCode: config.jurisdictionCode,
        jurisdictionName: this.getJurisdictionName(config),
        calculationMode: 'manual',
        method: 'manual_flat',
        annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
        annualizedTaxableIncome,
        taxableIncomeAfterReliefs: annualizedTaxableIncome,
        notes,
        details: {
          method: 'manual_flat',
          rate: roundRate(config.flatTaxRate),
          baseTaxAmount: taxAmount,
          additionalWithholding: roundMoney(config.additionalWithholding),
        },
      };
    }

    const manualTaxableAnnual = Math.max(0, annualizedTaxableIncome - toNumber(config.manualTaxFreeAllowance));
    const bracketTax = calculateProgressiveTaxFromBands(
      manualTaxableAnnual,
      (config.customBrackets || []).map((bracket) => ({
        min: toNumber(bracket.min),
        max: bracket.max === null ? Infinity : toNumber(bracket.max),
        rate: toNumber(bracket.rate),
      }))
    );

    const baseTaxPerPeriod = getPeriodAmount(bracketTax.amount, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + config.additionalWithholding);

    if (!config.customBrackets.length) {
      notes.push('Manual progressive mode is configured without custom brackets, so no bracket tax was applied.');
    }

    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added on top of the manual bracket tax.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: input.taxYear?.label || '',
      jurisdictionCode: config.jurisdictionCode,
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'manual',
      method: 'manual_progressive',
      annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(manualTaxableAnnual),
      notes,
      details: {
        method: 'manual_progressive',
        manualTaxFreeAllowance: roundMoney(config.manualTaxFreeAllowance),
        annualTaxBeforeAdditionalWithholding: roundMoney(bracketTax.amount),
        additionalWithholding: roundMoney(config.additionalWithholding),
        bracketBreakdown: bracketTax.components,
      },
    };
  }

  calculateUnitedKingdomTax(input = {}) {
    const { config, periodsPerYear, annualizedTaxableIncome } = input;
    const annualGross = roundMoney(toNumber(input.grossPay) * periodsPerYear);
    const notes = [];
    const taxYearLabel = input.taxYear?.label || '2025/26';

    let personalAllowance = 12570;
    if (annualGross > 100000) {
      const taperReduction = Math.floor((annualGross - 100000) / 2);
      personalAllowance = Math.max(0, personalAllowance - taperReduction);
      notes.push('Personal allowance taper was applied for earnings above GBP 100,000.');
    }

    const additionalRateThreshold = Math.max(37700, 125140 - personalAllowance);
    const restOfUkBands = [
      { min: 0, max: 37700, rate: 20 },
      { min: 37700, max: additionalRateThreshold, rate: 40 },
      { min: additionalRateThreshold, max: Infinity, rate: 45 },
    ];

    const scotlandTopThreshold = Math.max(62430, 125140 - personalAllowance);
    const scotlandBands = [
      { min: 0, max: 2827, rate: 19 },
      { min: 2827, max: 14921, rate: 20 },
      { min: 14921, max: 31092, rate: 21 },
      { min: 31092, max: 62430, rate: 42 },
      { min: 62430, max: scotlandTopThreshold, rate: 45 },
      { min: scotlandTopThreshold, max: Infinity, rate: 48 },
    ];

    const isScotland = config.taxSubdivision === 'scotland';
    const taxableAnnual = Math.max(0, annualizedTaxableIncome - personalAllowance);
    const bracketTax = calculateProgressiveTaxFromBands(taxableAnnual, isScotland ? scotlandBands : restOfUkBands);
    const baseTaxPerPeriod = getPeriodAmount(bracketTax.amount, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + config.additionalWithholding);

    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after the UK PAYE calculation.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel,
      jurisdictionCode: 'GB',
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'builtin',
      method: isScotland ? 'uk_scotland_paye' : 'uk_paye',
      annualizedIncome: annualGross,
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(taxableAnnual),
      notes,
      details: {
        method: isScotland ? 'uk_scotland_paye' : 'uk_paye',
        personalAllowance: roundMoney(personalAllowance),
        region: isScotland ? 'Scotland' : 'England/Wales/Northern Ireland',
        annualTaxBeforeAdditionalWithholding: roundMoney(bracketTax.amount),
        additionalWithholding: roundMoney(config.additionalWithholding),
        bracketBreakdown: bracketTax.components,
      },
    };
  }

  calculateUnitedStatesTax(input = {}) {
    const { config, periodsPerYear, annualizedTaxableIncome } = input;
    const filingStatus = this.normalizeUnitedStatesFilingStatus(config.filingStatus);
    const tableKey = config.multipleJobs ? 'multipleJobs' : 'standard';
    const rows = US_ANNUAL_TABLES_2026[tableKey][filingStatus] || US_ANNUAL_TABLES_2026[tableKey].single;
    const standardDeductionOffset = config.multipleJobs ? 0 : (filingStatus === 'married_filing_jointly' ? 12900 : 8600);
    const adjustedAnnualWages = Math.max(
      0,
      annualizedTaxableIncome + config.otherIncome - config.deductionsAdjustment - standardDeductionOffset
    );
    const annualBaseTax = calculateBaseRateTax(adjustedAnnualWages, rows);
    const annualTaxAfterCredits = Math.max(0, annualBaseTax.amount - config.taxCredits);
    const taxPerPeriod = getPeriodAmount(annualTaxAfterCredits, periodsPerYear);
    const totalTax = roundMoney(taxPerPeriod + config.additionalWithholding);
    const notes = [];

    if (config.multipleJobs) {
      notes.push('IRS Step 2 multiple-jobs tables were used.');
    }
    if (config.taxCredits > 0) {
      notes.push('Annual tax credits reduced the federal withholding amount.');
    }
    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after federal withholding.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: input.taxYear?.label || '2026',
      jurisdictionCode: 'US',
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'builtin',
      method: 'us_federal_withholding',
      annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(adjustedAnnualWages),
      notes,
      details: {
        method: 'us_federal_withholding',
        tableYear: 2026,
        tableType: tableKey,
        filingStatus,
        otherIncome: roundMoney(config.otherIncome),
        deductionsAdjustment: roundMoney(config.deductionsAdjustment),
        standardDeductionOffset: roundMoney(standardDeductionOffset),
        taxCredits: roundMoney(config.taxCredits),
        annualTaxBeforeCredits: roundMoney(annualBaseTax.amount),
        annualTaxAfterCredits: roundMoney(annualTaxAfterCredits),
        additionalWithholding: roundMoney(config.additionalWithholding),
        row: annualBaseTax.row,
      },
    };
  }

  calculateNigeriaTax(input = {}) {
    const { periodsPerYear, annualizedTaxableIncome } = input;
    const annualGross = roundMoney(toNumber(input.grossPay) * periodsPerYear);
    const consolidatedReliefAllowance = roundMoney(
      Math.max(200000, annualGross * 0.01) + (annualGross * 0.20)
    );
    const taxableAnnual = Math.max(0, annualizedTaxableIncome - consolidatedReliefAllowance);
    const bands = [
      { min: 0, max: 300000, rate: 7 },
      { min: 300000, max: 600000, rate: 11 },
      { min: 600000, max: 1100000, rate: 15 },
      { min: 1100000, max: 1600000, rate: 19 },
      { min: 1600000, max: 3200000, rate: 21 },
      { min: 3200000, max: Infinity, rate: 24 },
    ];
    const bracketTax = calculateProgressiveTaxFromBands(taxableAnnual, bands);
    let annualTax = bracketTax.amount;
    const notes = [];

    if (annualGross < 300000) {
      const minimumTax = roundMoney(annualGross * 0.01);
      if (annualTax < minimumTax) {
        annualTax = minimumTax;
        notes.push('Nigeria minimum tax was applied for annual income below NGN 300,000.');
      }
    }

    const baseTaxPerPeriod = getPeriodAmount(annualTax, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + input.config.additionalWithholding);

    if (input.config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after the Nigeria PAYE calculation.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: input.taxYear?.label || '',
      jurisdictionCode: 'NG',
      jurisdictionName: this.getJurisdictionName(input.config),
      calculationMode: 'builtin',
      method: 'nigeria_paye',
      annualizedIncome: annualGross,
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(taxableAnnual),
      notes,
      details: {
        method: 'nigeria_paye',
        consolidatedReliefAllowance,
        annualTaxBeforeAdditionalWithholding: roundMoney(annualTax),
        additionalWithholding: roundMoney(input.config.additionalWithholding),
        bracketBreakdown: bracketTax.components,
      },
    };
  }

  calculateGhanaTax(input = {}) {
    const { config, periodsPerYear, annualizedTaxableIncome } = input;
    const isNonResident = config.residencyStatus === 'non_resident';
    const notes = [];
    let annualTax = 0;
    let details = {};

    if (isNonResident) {
      annualTax = roundMoney(annualizedTaxableIncome * 0.25);
      details = {
        method: 'ghana_non_resident_flat',
        flatRate: 25,
      };
      notes.push('Ghana non-resident employment income was taxed at the flat non-resident rate.');
    } else {
      const bands = [
        { min: 0, max: 5880, rate: 0 },
        { min: 5880, max: 7200, rate: 5 },
        { min: 7200, max: 8760, rate: 10 },
        { min: 8760, max: 46760, rate: 17.5 },
        { min: 46760, max: 238760, rate: 25 },
        { min: 238760, max: 605000, rate: 30 },
        { min: 605000, max: Infinity, rate: 35 },
      ];
      const bracketTax = calculateProgressiveTaxFromBands(annualizedTaxableIncome, bands);
      annualTax = bracketTax.amount;
      details = {
        method: 'ghana_paye',
        bracketBreakdown: bracketTax.components,
      };
    }

    const baseTaxPerPeriod = getPeriodAmount(annualTax, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + config.additionalWithholding);

    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after the Ghana PAYE calculation.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: input.taxYear?.label || '',
      jurisdictionCode: 'GH',
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'builtin',
      method: isNonResident ? 'ghana_non_resident_flat' : 'ghana_paye',
      annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(annualizedTaxableIncome),
      notes,
      details: {
        ...details,
        residencyStatus: config.residencyStatus,
        annualTaxBeforeAdditionalWithholding: roundMoney(annualTax),
        additionalWithholding: roundMoney(config.additionalWithholding),
      },
    };
  }

  calculateKenyaTax(input = {}) {
    const { config, periodsPerYear, annualizedTaxableIncome } = input;
    const isResident = config.residencyStatus !== 'non_resident';
    const bands = [
      { min: 0, max: 288000, rate: 10 },
      { min: 288000, max: 388000, rate: 25 },
      { min: 388000, max: 6000000, rate: 30 },
      { min: 6000000, max: 9600000, rate: 32.5 },
      { min: 9600000, max: Infinity, rate: 35 },
    ];
    const bracketTax = calculateProgressiveTaxFromBands(annualizedTaxableIncome, bands);
    const personalRelief = isResident ? 28800 : 0;
    const annualTax = Math.max(0, bracketTax.amount - personalRelief);
    const baseTaxPerPeriod = getPeriodAmount(annualTax, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + config.additionalWithholding);
    const notes = [];

    if (isResident) {
      notes.push('Kenya resident personal relief was applied.');
    }
    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after the Kenya PAYE calculation.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: input.taxYear?.label || '',
      jurisdictionCode: 'KE',
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'builtin',
      method: 'kenya_paye',
      annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(annualizedTaxableIncome),
      notes,
      details: {
        method: 'kenya_paye',
        residencyStatus: config.residencyStatus,
        personalRelief: roundMoney(personalRelief),
        annualTaxBeforeRelief: roundMoney(bracketTax.amount),
        annualTaxBeforeAdditionalWithholding: roundMoney(annualTax),
        additionalWithholding: roundMoney(config.additionalWithholding),
        bracketBreakdown: bracketTax.components,
      },
    };
  }

  calculateSouthAfricaTax(input = {}) {
    const { config, periodsPerYear, annualizedTaxableIncome, employeeInfo } = input;
    const payDate = normalizeDate(input.payDate);
    const use2027Table = payDate >= new Date(2026, 2, 1);
    const tables = use2027Table
      ? {
        label: '2027',
        rows: [
          { min: 0, max: 245100, baseTax: 0, rate: 18 },
          { min: 245100, max: 383100, baseTax: 44118, rate: 26 },
          { min: 383100, max: 530200, baseTax: 79998, rate: 31 },
          { min: 530200, max: 695800, baseTax: 125599, rate: 36 },
          { min: 695800, max: 887000, baseTax: 185215, rate: 39 },
          { min: 887000, max: 1878600, baseTax: 259783, rate: 41 },
          { min: 1878600, max: Infinity, baseTax: 666339, rate: 45 },
        ],
        rebates: { primary: 17820, secondary: 9765, tertiary: 3249 },
      }
      : {
        label: '2026',
        rows: [
          { min: 0, max: 237100, baseTax: 0, rate: 18 },
          { min: 237100, max: 370500, baseTax: 42678, rate: 26 },
          { min: 370500, max: 512800, baseTax: 77362, rate: 31 },
          { min: 512800, max: 673000, baseTax: 121475, rate: 36 },
          { min: 673000, max: 857900, baseTax: 179147, rate: 39 },
          { min: 857900, max: 1817000, baseTax: 251258, rate: 41 },
          { min: 1817000, max: Infinity, baseTax: 644489, rate: 45 },
        ],
        rebates: { primary: 17235, secondary: 9444, tertiary: 3145 },
      };

    const taxYearEnd = use2027Table ? new Date(2027, 1, 28) : new Date(2026, 1, 28);
    const age = ageOnDate(employeeInfo?.dateOfBirth, taxYearEnd);
    const annualBaseTax = calculateBaseRateTax(annualizedTaxableIncome, tables.rows);
    let rebate = tables.rebates.primary;

    if (age !== null && age >= 65) {
      rebate += tables.rebates.secondary;
    }
    if (age !== null && age >= 75) {
      rebate += tables.rebates.tertiary;
    }

    const annualTax = Math.max(0, annualBaseTax.amount - rebate);
    const baseTaxPerPeriod = getPeriodAmount(annualTax, periodsPerYear);
    const totalTax = roundMoney(baseTaxPerPeriod + config.additionalWithholding);
    const notes = [];

    if (age === null) {
      notes.push('South Africa rebates were calculated using the primary rebate only because date of birth is missing.');
    }
    if (config.additionalWithholding > 0) {
      notes.push('Additional withholding was added after the South Africa PAYE calculation.');
    }

    return {
      taxAmount: totalTax,
      taxYearLabel: tables.label,
      jurisdictionCode: 'ZA',
      jurisdictionName: this.getJurisdictionName(config),
      calculationMode: 'builtin',
      method: 'south_africa_paye',
      annualizedIncome: roundMoney(toNumber(input.grossPay) * periodsPerYear),
      annualizedTaxableIncome,
      taxableIncomeAfterReliefs: roundMoney(annualizedTaxableIncome),
      notes,
      details: {
        method: 'south_africa_paye',
        taxYear: tables.label,
        age,
        rebate: roundMoney(rebate),
        annualTaxBeforeRebate: roundMoney(annualBaseTax.amount),
        annualTaxBeforeAdditionalWithholding: roundMoney(annualTax),
        additionalWithholding: roundMoney(config.additionalWithholding),
        row: annualBaseTax.row,
      },
    };
  }

  calculateStatutoryContributions(input = {}) {
    const { config, grossPay, ytdGrossPay, taxYear, statutoryContributions } = input;
    const statutoryProfile = this.getStatutoryProfile(config.jurisdictionCode);
    const socialSecurityOptIn = statutoryContributions?.socialSecurityOptIn !== false;

    if (
      !socialSecurityOptIn
      && ['GB', 'US', 'GH'].includes(config.jurisdictionCode)
    ) {
      return {
        totalAmount: 0,
        reducesTaxableIncome: 0,
        components: [],
      };
    }

    if (statutoryProfile.allowManualStatutoryOverride && config.socialSecurityRate > 0) {
      if (!socialSecurityOptIn) {
        return {
          totalAmount: 0,
          reducesTaxableIncome: 0,
          components: [],
        };
      }
      return this.calculateManualSocialSecurity({
        rate: config.socialSecurityRate,
        cap: config.socialSecurityCap,
        grossPay,
        ytdGrossPay,
      });
    }

    switch (config.jurisdictionCode) {
      case 'GB':
        return this.calculateUnitedKingdomNi(input);
      case 'US':
        return this.calculateUnitedStatesFica(input);
      case 'GH':
        return this.calculateGhanaSsnit(input);
      default:
        return {
          totalAmount: 0,
          reducesTaxableIncome: 0,
          components: [],
          taxYearLabel: taxYear?.label || '',
        };
    }
  }

  calculateManualSocialSecurity(input = {}) {
    const rate = Math.max(0, toNumber(input.rate));
    const cap = Math.max(0, toNumber(input.cap));
    const periodGross = Math.max(0, toNumber(input.grossPay));
    const ytd = Math.max(0, toNumber(input.ytdGrossPay));

    if (rate <= 0 || periodGross <= 0) {
      return {
        totalAmount: 0,
        reducesTaxableIncome: 0,
        components: [],
      };
    }

    let taxableAmount = periodGross;
    let hitCap = false;

    if (cap > 0) {
      if (ytd >= cap) {
        taxableAmount = 0;
        hitCap = true;
      } else if (ytd + periodGross > cap) {
        taxableAmount = Math.max(0, cap - ytd);
        hitCap = true;
      }
    }

    const amount = roundMoney(taxableAmount * (rate / 100));

    return {
      totalAmount: amount,
      reducesTaxableIncome: 0,
      components: amount > 0 ? [{
        type: 'social_security',
        name: 'Social Security',
        amount,
        rate: roundRate(rate),
        taxableAmount: roundMoney(taxableAmount),
        cap: cap || null,
        hitCap,
        source: 'manual',
      }] : [],
    };
  }

  calculateUnitedKingdomNi(input = {}) {
    const periodsPerYear = input.periodsPerYear || getPayPeriodsPerYear(input.payFrequency);
    const earnings = Math.max(0, toNumber(input.grossPay));
    const primaryThreshold = 12570 / periodsPerYear;
    const upperEarningsLimit = 50270 / periodsPerYear;
    const firstBand = Math.max(0, Math.min(earnings, upperEarningsLimit) - primaryThreshold);
    const secondBand = Math.max(0, earnings - upperEarningsLimit);
    const amount = roundMoney((firstBand * 0.08) + (secondBand * 0.02));

    return {
      totalAmount: amount,
      reducesTaxableIncome: 0,
      components: amount > 0 ? [{
        type: 'social_security',
        name: 'National Insurance',
        amount,
        taxableAmount: roundMoney(earnings),
        thresholds: {
          primaryThreshold: roundMoney(primaryThreshold),
          upperEarningsLimit: roundMoney(upperEarningsLimit),
        },
        source: 'builtin',
      }] : [],
    };
  }

  calculateUnitedStatesFica(input = {}) {
    const earnings = Math.max(0, toNumber(input.grossPay));
    const ytdGrossPay = Math.max(0, toNumber(input.ytdGrossPay));
    const socialSecurityWageBase = 184500;
    const additionalMedicareThreshold = 200000;
    const remainingSocialSecurityBase = Math.max(0, socialSecurityWageBase - ytdGrossPay);
    const socialSecurityTaxable = Math.min(earnings, remainingSocialSecurityBase);
    const medicareTaxable = earnings;
    const additionalMedicareTaxable = Math.max(0, (ytdGrossPay + earnings) - additionalMedicareThreshold)
      - Math.max(0, ytdGrossPay - additionalMedicareThreshold);

    const socialSecurityAmount = roundMoney(socialSecurityTaxable * 0.062);
    const medicareAmount = roundMoney(medicareTaxable * 0.0145);
    const additionalMedicareAmount = roundMoney(Math.max(0, additionalMedicareTaxable) * 0.009);

    const components = [];
    if (socialSecurityAmount > 0) {
      components.push({
        type: 'social_security',
        name: 'Social Security',
        amount: socialSecurityAmount,
        taxableAmount: roundMoney(socialSecurityTaxable),
        cap: socialSecurityWageBase,
        source: 'builtin',
      });
    }
    if (medicareAmount > 0) {
      components.push({
        type: 'social_security',
        name: 'Medicare',
        amount: medicareAmount,
        taxableAmount: roundMoney(medicareTaxable),
        source: 'builtin',
      });
    }
    if (additionalMedicareAmount > 0) {
      components.push({
        type: 'social_security',
        name: 'Additional Medicare',
        amount: additionalMedicareAmount,
        taxableAmount: roundMoney(additionalMedicareTaxable),
        threshold: additionalMedicareThreshold,
        source: 'builtin',
      });
    }

    return {
      totalAmount: roundMoney(socialSecurityAmount + medicareAmount + additionalMedicareAmount),
      reducesTaxableIncome: 0,
      components,
    };
  }

  calculateGhanaSsnit(input = {}) {
    const basicSalary = Math.max(0, toNumber(input.basicSalary));
    if (basicSalary <= 0) {
      return {
        totalAmount: 0,
        reducesTaxableIncome: 0,
        components: [],
      };
    }

    const amount = roundMoney(basicSalary * 0.055);
    return {
      totalAmount: amount,
      reducesTaxableIncome: amount,
      components: amount > 0 ? [{
        type: 'social_security',
        name: 'SSNIT Employee Contribution',
        amount,
        rate: 5.5,
        taxableAmount: roundMoney(basicSalary),
        reducesTaxableIncome: true,
        source: 'builtin',
      }] : [],
    };
  }

  normalizeUnitedStatesFilingStatus(value) {
    const filingStatus = String(value || 'single').trim().toLowerCase();
    if (filingStatus === 'married_filing_jointly') return 'married_filing_jointly';
    if (filingStatus === 'head_of_household') return 'head_of_household';
    if (filingStatus === 'married_filing_separately') return 'married_filing_separately';
    return 'single';
  }

  getJurisdictionName(config = {}) {
    return config.jurisdictionName
      || BUILT_IN_JURISDICTIONS.get(config.jurisdictionCode)?.name
      || (config.jurisdictionCode === 'EU' ? 'European Union member state (manual)' : 'Custom jurisdiction');
  }
}

module.exports = new TaxCalculationService();
