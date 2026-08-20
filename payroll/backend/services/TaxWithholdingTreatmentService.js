const WITHHOLDING_MODES = new Set(['payroll_withholding', 'employee_responsible']);

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return WITHHOLDING_MODES.has(mode) ? mode : 'payroll_withholding';
}

function resolveTaxWithholdingTreatment(taxConfig = {}, paymentDate = new Date()) {
  const mode = normalizeMode(taxConfig.withholdingMode);
  const date = normalizeDate(paymentDate) || new Date();
  const effectiveFrom = normalizeDate(taxConfig.withholdingEffectiveFrom);
  const effectiveTo = normalizeDate(taxConfig.withholdingEffectiveTo);
  const effectiveToBoundary = effectiveTo ? new Date(effectiveTo) : null;
  effectiveToBoundary?.setUTCHours(23, 59, 59, 999);
  const inEffectivePeriod = (!effectiveFrom || date >= effectiveFrom)
    && (!effectiveToBoundary || date <= effectiveToBoundary);

  return {
    mode,
    employeeResponsible: mode === 'employee_responsible' && inEffectivePeriod,
    reason: String(taxConfig.withholdingReason || '').trim(),
    effectiveFrom,
    effectiveTo,
  };
}

function applyTaxWithholdingTreatment(taxResult = {}, taxConfig = {}, paymentDate = new Date()) {
  const treatment = resolveTaxWithholdingTreatment(taxConfig, paymentDate);
  const components = Array.isArray(taxResult?.statutoryContributions?.components)
    ? taxResult.statutoryContributions.components
    : [];
  const calculatedIncomeTax = Number(taxResult?.incomeTax?.taxAmount || 0);
  const employeeComponents = components.filter((component) => component?.payer !== 'employer');
  const employerComponents = components.filter((component) => component?.payer === 'employer');

  return {
    ...treatment,
    calculatedIncomeTax,
    incomeTaxAmount: treatment.employeeResponsible ? 0 : calculatedIncomeTax,
    statutoryComponents: treatment.employeeResponsible ? employerComponents : components,
    employeeStatutoryAmount: treatment.employeeResponsible
      ? 0
      : employeeComponents.reduce((sum, component) => sum + Number(component?.amount || 0), 0),
    suppressedIncomeTax: treatment.employeeResponsible ? calculatedIncomeTax : 0,
    suppressedEmployeeStatutoryAmount: treatment.employeeResponsible
      ? employeeComponents.reduce((sum, component) => sum + Number(component?.amount || 0), 0)
      : 0,
  };
}

module.exports = {
  applyTaxWithholdingTreatment,
  normalizeMode,
  resolveTaxWithholdingTreatment,
};
