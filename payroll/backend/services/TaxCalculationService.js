const taxJurisdictionService = require('./TaxJurisdictionService');

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
    let source = 'custom';

    if (enabled && jurisdictionCode === 'NG' && employeePercent <= 0 && employerPercent <= 0) {
      employeePercent = 8;
      employerPercent = 10;
      source = 'builtin_default';
    }

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
      jurisdictionVersionId: config.jurisdictionVersionId || config.versionId || '',
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

  async calculatePayrollTaxes(input = {}) {
    const normalizedConfig = this.normalizeConfig(input.taxConfig || {});
    return taxJurisdictionService.calculate({
      ...input,
      taxConfig: normalizedConfig,
    });
  }

  getJurisdictionName(config = {}) {
    return config.jurisdictionName
      || taxJurisdictionService.seedDefinitions.find((seed) => seed.countryCode === normalizeCode(config.jurisdictionCode))?.countryName
      || 'Custom jurisdiction';
  }
}

module.exports = new TaxCalculationService();
