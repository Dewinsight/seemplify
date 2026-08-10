const OrganizationCurrencyPolicy = require('../models/OrganizationCurrencyPolicy');
const currencyService = require('./CurrencyService');

class CurrencyPolicyValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'CurrencyPolicyValidationError';
    this.statusCode = 400;
    this.code = 'CURRENCY_POLICY_INVALID';
    this.details = details;
  }
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function uniqueCodes(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => normalizeCode(typeof entry === 'string' ? entry : entry?.code))
    .filter(Boolean)));
}

function defaultEnabledCurrency(code) {
  return {
    code,
    paymentEnabled: true,
    isActive: true,
    addedAt: new Date(),
  };
}

class OrganizationCurrencyService {
  getIsoCurrency(code) {
    const normalized = normalizeCode(code);
    return currencyService.getSupportedCurrencies().find((currency) => currency.code === normalized) || null;
  }

  assertIsoCurrency(code, fieldName = 'currency') {
    const normalized = normalizeCode(code);
    if (!normalized || !this.getIsoCurrency(normalized)) {
      throw new CurrencyPolicyValidationError(`${fieldName} must be a supported ISO 4217 currency code.`);
    }
    return normalized;
  }

  assertPayrollCalculationCurrency(code, fieldName = 'currency') {
    const normalized = this.assertIsoCurrency(code, fieldName);
    const currency = this.getIsoCurrency(normalized);
    if (currency?.decimals !== 2) {
      throw new CurrencyPolicyValidationError(
        `${fieldName} ${normalized} uses ${currency?.decimals ?? 'non-standard'} minor units. Zero- and three-decimal payment calculations remain blocked until their statutory rounding pipelines are certified; the currency may still be used for reporting.`
      );
    }
    return normalized;
  }

  normalizeCustomCurrency(entry = {}) {
    const code = normalizeCode(entry.code);
    if (!/^[A-Z][A-Z0-9]{2}$/.test(code)) {
      throw new CurrencyPolicyValidationError('Custom reporting currency codes must contain exactly three uppercase letters or numbers and start with a letter.');
    }
    if (this.getIsoCurrency(code)) {
      throw new CurrencyPolicyValidationError(`${code} is already an ISO currency and must be enabled from the standard catalogue.`);
    }

    const name = String(entry.name || '').trim();
    const symbol = String(entry.symbol || '').trim();
    const minorUnits = Number(entry.minorUnits ?? 2);
    if (!name || !symbol || !Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) {
      throw new CurrencyPolicyValidationError('Custom currency name, symbol, and a minor-unit value from 0 to 6 are required.');
    }

    return {
      code,
      name,
      symbol,
      minorUnits,
      isActive: entry.isActive !== false,
      usage: 'reporting_only',
      nonStatutoryOnly: true,
      createdAt: entry.createdAt || new Date(),
    };
  }

  async getPolicy(organizationId, actor = {}) {
    if (!organizationId) {
      throw new CurrencyPolicyValidationError('An active organization is required.');
    }

    let policy = await OrganizationCurrencyPolicy.findOne({ organizationId });
    if (!policy) {
      policy = await OrganizationCurrencyPolicy.findOneAndUpdate(
        { organizationId },
        {
          $setOnInsert: {
            organizationId,
            functionalCurrency: 'USD',
            reportingCurrency: 'USD',
            enabledCurrencies: [defaultEnabledCurrency('USD')],
            requireConfiguredPaymentCurrency: true,
            lastModifiedBy: actor,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return policy;
  }

  async updatePolicy(organizationId, payload = {}, actor = {}) {
    const current = await this.getPolicy(organizationId, actor);
    if (payload.customCurrencies !== undefined && !Array.isArray(payload.customCurrencies)) {
      throw new CurrencyPolicyValidationError('Custom currencies must be provided as an array.');
    }
    if (payload.enabledCurrencies !== undefined && !Array.isArray(payload.enabledCurrencies)) {
      throw new CurrencyPolicyValidationError('Enabled currencies must be provided as an array.');
    }
    const functionalCurrency = this.assertPayrollCalculationCurrency(
      payload.functionalCurrency || current.functionalCurrency,
      'Functional currency'
    );

    const existingCustom = (current.customCurrencies || []).map((entry) => (
      this.normalizeCustomCurrency(entry.toObject ? entry.toObject() : entry)
    ));
    const customCurrencies = payload.customCurrencies === undefined
      ? existingCustom
      : payload.customCurrencies.map((entry) => this.normalizeCustomCurrency(entry));
    const duplicateCustomCodes = customCurrencies
      .map((entry) => entry.code)
      .filter((code, index, codes) => codes.indexOf(code) !== index);
    if (duplicateCustomCodes.length > 0) {
      throw new CurrencyPolicyValidationError(`Custom currency codes must be unique: ${Array.from(new Set(duplicateCustomCodes)).join(', ')}.`);
    }
    const customCodes = new Set(customCurrencies.filter((entry) => entry.isActive).map((entry) => entry.code));

    const requestedEnabled = payload.enabledCurrencies === undefined
      ? (current.enabledCurrencies || []).map((entry) => (entry.toObject ? entry.toObject() : entry))
      : payload.enabledCurrencies;
    const enabledCodes = uniqueCodes(requestedEnabled);
    if (!enabledCodes.includes(functionalCurrency)) enabledCodes.push(functionalCurrency);
    const enabledCurrencies = enabledCodes.map((code) => {
      this.assertIsoCurrency(code, 'Enabled currency');
      const source = (Array.isArray(requestedEnabled) ? requestedEnabled : [])
        .find((entry) => normalizeCode(typeof entry === 'string' ? entry : entry?.code) === code);
      return {
        code,
        paymentEnabled: code === functionalCurrency
          ? true
          : (typeof source === 'object'
            ? (source.paymentEnabled !== false && this.getIsoCurrency(code)?.decimals === 2)
            : this.getIsoCurrency(code)?.decimals === 2),
        isActive: code === functionalCurrency || typeof source !== 'object' || source.isActive !== false,
        addedAt: typeof source === 'object' && source.addedAt ? source.addedAt : new Date(),
      };
    });
    const enabledPaymentCodes = enabledCurrencies
      .filter((entry) => entry.isActive !== false && entry.paymentEnabled !== false)
      .map((entry) => entry.code);
    const PayrollProfile = require('../models/PayrollProfile');
    const referencedDisabledCurrencies = await PayrollProfile.distinct('currency', {
      organizationId,
      isActive: true,
      currency: { $nin: enabledPaymentCodes },
    });
    if (referencedDisabledCurrencies.length > 0) {
      throw new CurrencyPolicyValidationError(
        `Cannot disable payment currencies used by active payroll profiles: ${referencedDisabledCurrencies.join(', ')}. Migrate those profiles first.`
      );
    }

    const reportingCurrency = normalizeCode(payload.reportingCurrency || current.reportingCurrency || functionalCurrency);
    const activeIsoCodes = new Set(enabledCurrencies.filter((entry) => entry.isActive !== false).map((entry) => entry.code));
    if (!activeIsoCodes.has(reportingCurrency) && !customCodes.has(reportingCurrency)) {
      throw new CurrencyPolicyValidationError('Reporting currency must be an enabled ISO currency or an active custom reporting currency.');
    }

    current.functionalCurrency = functionalCurrency;
    current.reportingCurrency = reportingCurrency;
    current.enabledCurrencies = enabledCurrencies;
    current.customCurrencies = customCurrencies;
    current.requireConfiguredPaymentCurrency = payload.requireConfiguredPaymentCurrency === undefined
      ? current.requireConfiguredPaymentCurrency !== false
      : payload.requireConfiguredPaymentCurrency !== false;
    current.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await current.save();
    return current;
  }

  async assertPaymentCurrency(organizationId, code) {
    const normalized = this.assertPayrollCalculationCurrency(code, 'Payment currency');
    const policy = await this.getPolicy(organizationId);
    if (policy.requireConfiguredPaymentCurrency === false) return normalized;
    const enabled = (policy.enabledCurrencies || []).some((entry) => (
      entry.code === normalized && entry.isActive !== false && entry.paymentEnabled !== false
    ));
    if (!enabled) {
      throw new CurrencyPolicyValidationError(`${normalized} is not enabled as a payroll payment currency for this organization.`);
    }
    return normalized;
  }

  async getDefaultPaymentCurrency(organizationId) {
    const policy = await this.getPolicy(organizationId);
    const enabled = (policy.enabledCurrencies || []).filter((entry) => (
      entry.isActive !== false
      && entry.paymentEnabled !== false
      && this.getIsoCurrency(entry.code)?.decimals === 2
    ));
    const functional = enabled.find((entry) => entry.code === policy.functionalCurrency);
    const selected = functional || enabled[0];
    if (!selected) {
      throw new CurrencyPolicyValidationError('At least one active payroll payment currency is required.');
    }
    return this.assertPayrollCalculationCurrency(selected.code, 'Default payment currency');
  }

  async getMinorUnits(organizationId, code) {
    const normalized = normalizeCode(code);
    const iso = this.getIsoCurrency(normalized);
    if (iso) return Number.isInteger(iso.decimals) ? iso.decimals : 2;
    const policy = await this.getPolicy(organizationId);
    const custom = (policy.customCurrencies || []).find((entry) => entry.code === normalized && entry.isActive !== false);
    if (custom && Number.isInteger(custom.minorUnits)) return custom.minorUnits;
    throw new CurrencyPolicyValidationError(`${normalized || 'Currency'} is not configured for this organization.`);
  }

  async assertReportingCurrency(organizationId, code) {
    const normalized = normalizeCode(code);
    const policy = await this.getPolicy(organizationId);
    const enabledIso = (policy.enabledCurrencies || []).some((entry) => (
      entry.code === normalized && entry.isActive !== false
    ));
    const enabledCustom = (policy.customCurrencies || []).some((entry) => (
      entry.code === normalized && entry.isActive !== false && entry.nonStatutoryOnly !== false
    ));
    if (!enabledIso && !enabledCustom) {
      throw new CurrencyPolicyValidationError(`${normalized || 'The selected currency'} is not enabled as a reporting currency for this organization.`);
    }
    return normalized;
  }

  buildCatalog(policy) {
    const enabledByCode = new Map((policy.enabledCurrencies || []).map((entry) => [entry.code, entry]));
    const isoCurrencies = currencyService.getSupportedCurrencies().map((currency) => ({
      ...currency,
      kind: 'iso',
      enabled: enabledByCode.has(currency.code) && enabledByCode.get(currency.code).isActive !== false,
      paymentEnabled: enabledByCode.has(currency.code)
        && enabledByCode.get(currency.code).isActive !== false
        && enabledByCode.get(currency.code).paymentEnabled !== false
        && currency.decimals === 2,
      statutoryEligible: true,
      payrollCalculationReady: currency.decimals === 2,
    }));
    const customCurrencies = (policy.customCurrencies || []).map((entry) => ({
      code: entry.code,
      name: entry.name,
      symbol: entry.symbol,
      decimals: entry.minorUnits,
      label: `${entry.code} - ${entry.name}`,
      kind: 'custom',
      enabled: entry.isActive !== false,
      paymentEnabled: false,
      statutoryEligible: false,
      usage: 'reporting_only',
    }));
    return [...isoCurrencies, ...customCurrencies];
  }
}

module.exports = new OrganizationCurrencyService();
module.exports.CurrencyPolicyValidationError = CurrencyPolicyValidationError;
