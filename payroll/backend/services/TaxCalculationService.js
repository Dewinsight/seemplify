const taxJurisdictionService = require('./TaxJurisdictionService');
const currencyService = require('./CurrencyService');

const PAY_PERIODS_PER_YEAR = {
  monthly: 12,
  'semi-monthly': 24,
  'bi-weekly': 26,
  weekly: 52,
};

const LEGACY_REGIME_TO_CONFIG = {
  flat: { calculationMode: 'manual', manualCalculationType: 'flat' },
  none: { calculationMode: 'manual', manualCalculationType: 'none' },
  progressive_generic: { calculationMode: 'manual', manualCalculationType: 'progressive' },
  progressive_uk: { calculationMode: 'configured', jurisdictionCode: 'GB' },
  progressive_us: { calculationMode: 'configured', jurisdictionCode: 'US' },
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundCurrency(value, currencyCode) {
  return currencyService.roundAmount(toNumber(value), currencyCode);
}

function normalizeCode(value, fallback = '') {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  return normalized || fallback || '';
}

function getTaxYearMode(config = {}) {
  const code = normalizeCode(config.jurisdictionCode || '');
  if (code === 'GB') return 'uk_apr_6';
  if (code === 'ZA') return 'south_africa_mar_1';
  return 'calendar';
}

class TaxCalculationService {
  getSupportedJurisdictions() {
    return taxJurisdictionService.seedDefinitions.map((seed) => ({
      code: seed.countryCode,
      name: seed.countryName,
      mode: seed.countryCode === 'OTHER' ? 'manual_only' : 'configured',
    }));
  }

  resolveEffectivePensionSettings(config = {}, statutoryContributions = {}) {
    const jurisdictionCode = normalizeCode(config?.jurisdictionCode || 'OTHER', 'OTHER');
    const enabled = statutoryContributions?.pensionOptIn !== false;
    let employeePercent = Math.max(0, toNumber(statutoryContributions?.pensionContributionPercent));
    let employerPercent = Math.max(0, toNumber(statutoryContributions?.employerPensionPercent));
    const source = 'profile_override';

    return {
      enabled,
      employeePercent: roundMoney(employeePercent),
      employerPercent: roundMoney(employerPercent),
      source,
      profile: {
        code: jurisdictionCode,
      },
    };
  }

  normalizeConfig(config = {}) {
    const legacy = LEGACY_REGIME_TO_CONFIG[config.calculationRegime] || {};
    const jurisdictionCode = normalizeCode(
      config.jurisdictionCode || config.jurisdictionCountry || legacy.jurisdictionCode || 'OTHER',
      'OTHER'
    );

    return {
      taxId: String(config.taxId || '').trim(),
      taxRegime: String(config.taxRegime || 'standard').trim().toLowerCase(),
      calculationMode: String(config.calculationMode || legacy.calculationMode || 'configured').trim().toLowerCase(),
      jurisdictionCode,
      jurisdictionName: String(config.jurisdictionName || '').trim(),
      jurisdictionConfigId: config.jurisdictionConfigId || config.configId || '',
      // Employees pin the jurisdiction, not a law version. The effective
      // published version is selected from the pay date and snapshotted on the payslip.
      jurisdictionVersionId: '',
      employeeTaxInputs: (config.employeeTaxInputs && typeof config.employeeTaxInputs === 'object')
        ? config.employeeTaxInputs
        : {},
      taxValidation: (config.taxValidation && typeof config.taxValidation === 'object')
        ? config.taxValidation
        : {},
      taxSubdivision: String(config.taxSubdivision || '').trim().toLowerCase(),
      residencyStatus: String(config.residencyStatus || 'resident').trim().toLowerCase(),
      manualCalculationType: String(config.manualCalculationType || legacy.manualCalculationType || 'progressive').trim().toLowerCase(),
      manualTaxFreeAllowance: Math.max(0, toNumber(config.manualTaxFreeAllowance)),
      calculationRegime: config.calculationRegime || '',
      flatTaxRate: Math.max(0, toNumber(config.flatTaxRate)),
      customBrackets: Array.isArray(config.customBrackets) ? config.customBrackets : [],
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
    return taxJurisdictionService.buildTaxYearContext({
      taxYear: { mode: getTaxYearMode(config) },
    }, payDate);
  }

  async resolveTaxYearContext(config = {}, payDate = new Date(), organizationId = '') {
    const normalizedConfig = this.normalizeConfig(config);
    const resolved = await taxJurisdictionService.resolveJurisdictionConfig({
      organizationId,
      taxConfig: normalizedConfig,
      paymentDate: payDate,
    });
    const version = resolved.version || { taxYear: { mode: getTaxYearMode(normalizedConfig) } };
    return {
      taxYear: taxJurisdictionService.buildTaxYearContext(version, payDate),
      calculationCurrency: normalizeCode(version.calculationCurrency || ''),
      jurisdictionVersion: resolved.version || null,
      jurisdictionConfig: resolved.config || null,
    };
  }

  async calculatePayrollTaxes(input = {}) {
    const normalizedConfig = this.normalizeConfig(input.taxConfig || {});
    const preliminary = await taxJurisdictionService.resolveJurisdictionConfig({
      ...input,
      taxConfig: normalizedConfig,
    });
    const calculationCurrency = normalizeCode(preliminary.version?.calculationCurrency || input.currency || '');
    const payrollCurrency = normalizeCode(input.currency || calculationCurrency || '');
    const ytdCurrency = normalizeCode(input.ytdCurrency || payrollCurrency || calculationCurrency || '');
    let calculationInput = {
      ...input,
      taxConfig: {
        ...normalizedConfig,
        employeeTaxInputs: preliminary.employeeTaxInputs || normalizedConfig.employeeTaxInputs || {},
      },
      versionDefinition: preliminary.version,
      configDefinition: preliminary.config,
    };
    let conversion = null;

    if (calculationCurrency && payrollCurrency && calculationCurrency !== payrollCurrency) {
      if (!input.organizationId) {
        const error = new Error(`A ${payrollCurrency}/${calculationCurrency} exchange rate cannot be resolved without an organization.`);
        error.code = 'TAX_CURRENCY_CONVERSION_REQUIRED';
        throw error;
      }
      conversion = await currencyService.convert(
        input.organizationId,
        1,
        payrollCurrency,
        calculationCurrency,
        input.paymentDate || new Date()
      );
      const rate = toNumber(conversion.rate, toNumber(conversion.convertedAmount));
      if (!(rate > 0)) {
        const error = new Error(`No valid ${payrollCurrency}/${calculationCurrency} exchange rate is available for the pay date.`);
        error.code = 'TAX_CURRENCY_RATE_MISSING';
        throw error;
      }
      const convertInputAmount = (value) => roundCurrency(toNumber(value) * rate, calculationCurrency);
      calculationInput = {
        ...calculationInput,
        grossPay: convertInputAmount(input.grossPay),
        taxableIncome: convertInputAmount(input.taxableIncome),
        basicSalary: convertInputAmount(input.basicSalary),
        preTaxDeductions: convertInputAmount(input.preTaxDeductions),
        statutoryBases: Object.fromEntries(Object.entries(input.statutoryBases || {}).map(([key, value]) => [key, convertInputAmount(value)])),
      };
    }

    if (calculationCurrency && ytdCurrency && ytdCurrency !== calculationCurrency) {
      if (!input.organizationId) {
        const error = new Error(`A ${ytdCurrency}/${calculationCurrency} year-to-date exchange rate cannot be resolved without an organization.`);
        error.code = 'TAX_YTD_CURRENCY_CONVERSION_REQUIRED';
        throw error;
      }
      const ytdConversion = await currencyService.convert(
        input.organizationId,
        1,
        ytdCurrency,
        calculationCurrency,
        input.paymentDate || new Date()
      );
      const ytdRate = toNumber(ytdConversion.rate, toNumber(ytdConversion.convertedAmount));
      if (!(ytdRate > 0)) {
        const error = new Error(`No valid ${ytdCurrency}/${calculationCurrency} exchange rate is available for year-to-date payroll.`);
        error.code = 'TAX_YTD_CURRENCY_RATE_MISSING';
        throw error;
      }
      calculationInput = {
        ...calculationInput,
        ytdGrossPay: roundCurrency(toNumber(input.ytdGrossPay) * ytdRate, calculationCurrency),
        ytdTaxableIncome: roundCurrency(toNumber(input.ytdTaxableIncome) * ytdRate, calculationCurrency),
        ytdIncomeTax: roundCurrency(toNumber(input.ytdIncomeTax) * ytdRate, calculationCurrency),
      };
    }

    const fieldDefinitions = Array.isArray(preliminary.version?.fieldDefinitions)
      ? preliminary.version.fieldDefinitions
      : [];
    const employeeTaxInputs = {
      ...(calculationInput.taxConfig?.employeeTaxInputs || {}),
    };
    const inputRateCache = new Map();
    if (conversion && payrollCurrency) {
      inputRateCache.set(payrollCurrency, toNumber(conversion.rate, toNumber(conversion.convertedAmount)));
    }
    for (const field of fieldDefinitions) {
      if (field?.type !== 'currency' || employeeTaxInputs[field.key] === undefined) continue;
      const scope = String(field.currencyScope || 'calculation_currency');
      const sourceCurrency = normalizeCode(
        field.currencyCode || (scope === 'payroll_currency' ? payrollCurrency : calculationCurrency)
      );
      if (!sourceCurrency || !calculationCurrency || sourceCurrency === calculationCurrency) continue;
      if (!input.organizationId) {
        const error = new Error(`A ${sourceCurrency}/${calculationCurrency} exchange rate is required for tax field ${field.label || field.key}.`);
        error.code = 'TAX_FIELD_CURRENCY_CONVERSION_REQUIRED';
        throw error;
      }
      let fieldRate = inputRateCache.get(sourceCurrency);
      if (!(fieldRate > 0)) {
        const fieldConversion = await currencyService.convert(
          input.organizationId,
          1,
          sourceCurrency,
          calculationCurrency,
          input.paymentDate || new Date()
        );
        fieldRate = toNumber(fieldConversion.rate, toNumber(fieldConversion.convertedAmount));
        inputRateCache.set(sourceCurrency, fieldRate);
      }
      if (!(fieldRate > 0)) {
        const error = new Error(`No valid ${sourceCurrency}/${calculationCurrency} rate is available for tax field ${field.label || field.key}.`);
        error.code = 'TAX_FIELD_CURRENCY_RATE_MISSING';
        throw error;
      }
      employeeTaxInputs[field.key] = roundCurrency(toNumber(employeeTaxInputs[field.key]) * fieldRate, calculationCurrency);
    }
    calculationInput = {
      ...calculationInput,
      taxConfig: {
        ...calculationInput.taxConfig,
        employeeTaxInputs,
      },
    };

    const result = await taxJurisdictionService.calculate(calculationInput);
    const calculationBases = {
      currency: calculationCurrency || payrollCurrency,
      grossPay: roundCurrency(calculationInput.grossPay, calculationCurrency || payrollCurrency),
      taxableIncome: roundCurrency(calculationInput.taxableIncome, calculationCurrency || payrollCurrency),
      basicSalary: roundCurrency(calculationInput.basicSalary, calculationCurrency || payrollCurrency),
      preTaxDeductions: roundCurrency(calculationInput.preTaxDeductions, calculationCurrency || payrollCurrency),
      ytdGrossPay: roundCurrency(calculationInput.ytdGrossPay, calculationCurrency || payrollCurrency),
      ytdTaxableIncome: roundCurrency(calculationInput.ytdTaxableIncome, calculationCurrency || payrollCurrency),
      ytdIncomeTax: roundCurrency(calculationInput.ytdIncomeTax, calculationCurrency || payrollCurrency),
      incomeTaxAmount: roundCurrency(result.incomeTax?.taxAmount, calculationCurrency || payrollCurrency),
    };
    if (!conversion) {
      const outputCurrency = payrollCurrency || calculationCurrency;
      const incomeTax = { ...(result.incomeTax || {}) };
      for (const field of [
        'taxAmount', 'grossTaxableIncome', 'taxExemptIncome', 'deductionsBeforeTax', 'netTaxableIncome',
        'annualizedIncome', 'annualizedTaxableIncome', 'taxableIncomeAfterReliefs',
      ]) {
        if (incomeTax[field] !== undefined) incomeTax[field] = roundCurrency(incomeTax[field], outputCurrency);
      }
      const components = (result.statutoryContributions?.components || []).map((component) => ({
        ...component,
        amount: roundCurrency(component.amount, outputCurrency),
        taxableAmount: roundCurrency(component.taxableAmount, outputCurrency),
      }));
      const employeeComponents = components.filter((component) => component.payer !== 'employer');
      const employerComponents = components.filter((component) => component.payer === 'employer');
      return {
        ...result,
        incomeTax,
        statutoryContributions: {
          ...result.statutoryContributions,
          totalAmount: roundCurrency(employeeComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), outputCurrency),
          totalEmployeeAmount: roundCurrency(employeeComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), outputCurrency),
          totalEmployerAmount: roundCurrency(employerComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), outputCurrency),
          components,
          employeeComponents,
          employerComponents,
        },
        calculationCurrency: calculationCurrency || payrollCurrency,
        payrollCurrency: outputCurrency,
        yearToDateIncomeTax: roundCurrency(calculationInput.ytdIncomeTax, outputCurrency),
        yearToDateIncomeTaxCurrency: outputCurrency,
        calculationBases,
        currencyConversion: null,
      };
    }

    const rate = toNumber(conversion.rate, toNumber(conversion.convertedAmount));
    const toPayrollCurrency = (value) => roundCurrency(toNumber(value) / rate, payrollCurrency);
    const incomeTax = result.incomeTax || {};
    const monetaryIncomeFields = [
      'taxAmount', 'grossTaxableIncome', 'taxExemptIncome', 'deductionsBeforeTax', 'netTaxableIncome',
      'annualizedIncome', 'annualizedTaxableIncome', 'taxableIncomeAfterReliefs',
    ];
    const convertedIncomeTax = { ...incomeTax };
    for (const field of monetaryIncomeFields) {
      if (incomeTax[field] !== undefined) convertedIncomeTax[field] = toPayrollCurrency(incomeTax[field]);
    }
    const convertedComponents = (result.statutoryContributions?.components || []).map((component) => ({
      ...component,
      calculationAmount: component.amount,
      calculationTaxableAmount: component.taxableAmount,
      amount: toPayrollCurrency(component.amount),
      taxableAmount: toPayrollCurrency(component.taxableAmount),
      cap: component.cap ? toPayrollCurrency(component.cap) : component.cap,
      floor: component.floor ? toPayrollCurrency(component.floor) : component.floor,
      threshold: component.threshold ? toPayrollCurrency(component.threshold) : component.threshold,
      calculationCurrency,
      payrollCurrency,
      conversionRate: rate,
    }));
    const employeeComponents = convertedComponents.filter((component) => component.payer !== 'employer');
    const employerComponents = convertedComponents.filter((component) => component.payer === 'employer');

    return {
      ...result,
      incomeTax: convertedIncomeTax,
      statutoryContributions: {
        ...result.statutoryContributions,
        totalAmount: roundCurrency(employeeComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), payrollCurrency),
        totalEmployeeAmount: roundCurrency(employeeComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), payrollCurrency),
        totalEmployerAmount: roundCurrency(employerComponents.reduce((sum, component) => sum + toNumber(component.amount), 0), payrollCurrency),
        reducesTaxableIncome: toPayrollCurrency(result.statutoryContributions?.reducesTaxableIncome),
        components: convertedComponents,
        employeeComponents,
        employerComponents,
      },
      calculationCurrency,
      payrollCurrency,
      yearToDateIncomeTax: toPayrollCurrency(calculationInput.ytdIncomeTax),
      yearToDateIncomeTaxCurrency: payrollCurrency,
      calculationBases,
      currencyConversion: {
        from: payrollCurrency,
        to: calculationCurrency,
        rate,
        effectiveDate: conversion.effectiveDate || input.paymentDate || null,
        source: conversion.source || '',
        exchangeRateId: conversion.exchangeRateId || conversion._id || null,
        rateLegs: Array.isArray(conversion.rateLegs) ? conversion.rateLegs : [],
      },
    };
  }

  getJurisdictionName(config = {}) {
    return config.jurisdictionName
      || taxJurisdictionService.seedDefinitions.find((seed) => seed.countryCode === normalizeCode(config.jurisdictionCode))?.countryName
      || 'Custom jurisdiction';
  }
}

module.exports = new TaxCalculationService();
