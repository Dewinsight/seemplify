/**
 * Maps recruiter onboarding form field keys to the IdP payroll-sync payload.
 *
 * Keys correspond to the default onboarding form (see defaultFormFields in
 * onboardingWorkflowService). Custom templates that reuse these keys will be
 * picked up automatically. The IdP remains the source of truth for the employee
 * profile; this only shapes what recruiter pushes on completion.
 */

// Form keys whose values are stored encrypted and must be decrypted before push.
const SENSITIVE_KEYS = new Set(['bankRoutingNumber', 'bankAccountNumber', 'taxId']);

function asString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

/**
 * Build the payroll-sync body from a flat map of decrypted form values.
 * @param {Object} values - { [formKey]: plainValue }
 * @returns {Object} payroll-sync payload (only includes sections with data)
 */
function buildIdpProfilePayload(values = {}) {
  const payload = {};

  const legalName = asString(values.legalName) || asString(values.preferredName);
  if (legalName) payload.name = legalName;

  const personalInfo = {};

  const phone = asString(values.phone);
  if (phone) personalInfo.phoneNumbers = { mobile: phone };

  const addressRaw = values.address;
  if (addressRaw && typeof addressRaw === 'object') {
    personalInfo.mailingAddress = addressRaw;
  } else if (asString(addressRaw)) {
    // Recruiter stores address as free text; place it in the street line so it
    // is not lost. HR can refine the structured fields in the IdP afterwards.
    personalInfo.mailingAddress = { street: asString(addressRaw) };
  }

  const emergencyName = asString(values.emergencyContactName);
  const emergencyPhone = asString(values.emergencyContactPhone);
  if (emergencyName || emergencyPhone) {
    personalInfo.emergencyContact = { name: emergencyName, phone: emergencyPhone };
  }

  if (Object.keys(personalInfo).length) payload.personalInfo = personalInfo;

  const accountHolderName = asString(values.bankAccountName);
  const routingNumber = asString(values.bankRoutingNumber);
  const accountNumber = asString(values.bankAccountNumber);
  if (accountHolderName || routingNumber || accountNumber) {
    const bankCountry = asString(values.bankCountry);
    payload.banking = {
      account: { accountHolderName, routingNumber, accountNumber }
    };
    // Only send a country when the form captured one. Hardcoding a default
    // would mislabel accounts — the IdP applies country-specific normalization
    // (e.g. Nigerian digit-only) — so let the IdP fall back to its own default.
    if (bankCountry) payload.banking.country = bankCountry;
  }

  return payload;
}

module.exports = { buildIdpProfilePayload, SENSITIVE_KEYS };
