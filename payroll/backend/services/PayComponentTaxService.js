function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function periodKey(payDate) {
  const date = payDate instanceof Date ? payDate : new Date(payDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const ALWAYS_TAXABLE = new Set([
  'cash_allowance', 'housing_allowance', 'transport_allowance', 'cash_bonus', 'company_car',
  'housing_benefit', 'cheap_loan', 'phone_benefit', 'benefit_in_kind',
]);

const ALWAYS_NON_TAXABLE = new Set([
  'business_expense_reimbursement', 'statutory_reimbursement',
]);

function evidenceFor(item = {}) {
  return {
    authorityReason: String(item.taxAuthorityReason || item.authorityReason || '').trim(),
    evidenceReference: String(item.taxEvidenceReference || item.evidenceReference || '').trim(),
  };
}

function documentedExemption(item, source, reviewMessage) {
  const evidence = evidenceFor(item);
  const hasEvidence = !!(evidence.authorityReason && evidence.evidenceReference);
  return {
    treatment: 'non_taxable',
    taxablePercentage: 0,
    source,
    ...evidence,
    requiresReview: !hasEvidence,
    reviewMessage: hasEvidence ? '' : reviewMessage,
  };
}

class PayComponentTaxService {
  getJurisdictionDefault(item = {}, jurisdictionCode = '') {
    const code = String(item.classificationCode || '').trim().toLowerCase();
    const jurisdiction = String(jurisdictionCode || '').trim().toUpperCase();
    const value = Math.max(0, toNumber(item.fairValue ?? item.amount));

    if (ALWAYS_TAXABLE.has(code)) {
      return { treatment: 'taxable', taxablePercentage: 100, source: 'jurisdiction_classification' };
    }
    if (ALWAYS_NON_TAXABLE.has(code)) {
      return documentedExemption(
        item,
        'jurisdiction_classification',
        `The non-taxable reimbursement "${item.name || 'component'}" needs a legal reason and receipt or evidence reference.`
      );
    }
    if (jurisdiction === 'KE' && code === 'employer_medical_cover') {
      return documentedExemption(
        item,
        'kenya_employer_medical_exemption',
        `The Kenya medical-cover exemption for "${item.name || 'component'}" needs eligibility evidence.`
      );
    }
    if (jurisdiction === 'KE' && code === 'employer_meal') {
      return value <= 5000
        ? documentedExemption(
          item,
          'kenya_meal_threshold',
          `The Kenya meal exemption for "${item.name || 'component'}" needs supporting evidence for this pay period.`
        )
        : { treatment: 'taxable', taxablePercentage: 100, source: 'kenya_meal_threshold' };
    }
    if (['NG', 'GH', 'CM', 'MZ', 'ZA'].includes(jurisdiction) && code) {
      return { treatment: 'taxable', taxablePercentage: 100, source: 'country_conservative_default' };
    }
    if (!code && item.isTaxable !== undefined) {
      const legacyExemption = item.isTaxable === false;
      return {
        treatment: legacyExemption ? 'non_taxable' : 'taxable',
        taxablePercentage: legacyExemption ? 0 : 100,
        source: 'legacy_profile_flag',
        requiresReview: legacyExemption,
        reviewMessage: legacyExemption
          ? `Legacy non-taxable component "${item.name || 'component'}" must be reclassified with a legal reason and evidence reference.`
          : '',
      };
    }
    return {
      treatment: 'taxable',
      taxablePercentage: 100,
      source: 'unclassified_conservative_default',
      requiresReview: true,
      reviewMessage: `Pay component "${item.name || code || 'Unnamed component'}" has no reviewed tax classification.`,
    };
  }

  resolveTreatment(item = {}, payDate = new Date(), jurisdictionCode = '') {
    const classificationCode = String(item.classificationCode || '').trim().toLowerCase();
    // A statutory classification cannot be weakened by an organization or
    // one-period override. Corrections must change the controlled
    // classification itself and leave that change in the component audit log.
    if (ALWAYS_TAXABLE.has(classificationCode)) {
      return this.getJurisdictionDefault(item, jurisdictionCode);
    }

    const key = periodKey(payDate);
    const override = (Array.isArray(item.taxTreatmentOverrides) ? item.taxTreatmentOverrides : [])
      .find((entry) => String(entry?.periodKey || '') === key);
    if (override) {
      const hasEvidence = String(override.authorityReason || '').trim() && String(override.evidenceReference || '').trim();
      return {
        treatment: override.taxTreatment,
        taxablePercentage: override.taxTreatment === 'partially_taxable'
          ? Math.min(100, Math.max(0, toNumber(override.taxablePercentage, 100)))
          : override.taxTreatment === 'non_taxable' ? 0 : 100,
        source: 'period_override',
        overridePeriod: key,
        authorityReason: override.authorityReason || '',
        evidenceReference: override.evidenceReference || '',
        requiresReview: !hasEvidence,
        reviewMessage: !hasEvidence ? `The ${key} tax override needs a legal reason and evidence reference.` : '',
      };
    }

    const treatment = String(item.taxTreatment || 'jurisdiction_default');
    if (treatment !== 'jurisdiction_default') {
      const hasEvidence = String(item.taxAuthorityReason || '').trim() && String(item.taxEvidenceReference || '').trim();
      return {
        treatment,
        taxablePercentage: treatment === 'partially_taxable'
          ? Math.min(100, Math.max(0, toNumber(item.taxablePercentage, 100)))
          : treatment === 'non_taxable' ? 0 : 100,
        source: 'organization_asserted',
        authorityReason: item.taxAuthorityReason || '',
        evidenceReference: item.taxEvidenceReference || '',
        requiresReview: !hasEvidence,
        reviewMessage: !hasEvidence ? `The asserted tax treatment for "${item.name || 'component'}" needs a legal reason and evidence reference.` : '',
      };
    }

    return this.getJurisdictionDefault(item, jurisdictionCode);
  }

  resolveComponent(item = {}, payDate = new Date(), jurisdictionCode = '') {
    const value = Math.max(0, toNumber(item.fairValue ?? item.amount));
    const treatment = this.resolveTreatment(item, payDate, jurisdictionCode);
    const taxableAmount = roundMoney(value * (toNumber(treatment.taxablePercentage) / 100));
    return {
      ...treatment,
      value: roundMoney(value),
      taxableAmount,
      taxable: taxableAmount > 0,
      cashPayable: item.paymentKind
        ? item.paymentKind !== 'non_cash'
        : item.cashPayable !== false,
    };
  }
}

module.exports = new PayComponentTaxService();
module.exports.periodKey = periodKey;
