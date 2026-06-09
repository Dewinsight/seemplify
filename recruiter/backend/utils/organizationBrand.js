const { decodeHtmlEntities } = require('./htmlDecode');

// Product brand shown when an organization has no name of its own.
const DEFAULT_ORGANIZATION_BRAND = 'Seemplify';

// Stale / placeholder values that must never surface as a sender brand.
// "mega" is a leftover deployment value; "organization" is the old generic default.
const INVALID_BRAND_VALUES = new Set(['mega', 'organization']);

function normalizeBrand(value) {
  if (!value) return '';
  return decodeHtmlEntities(String(value)).replace(/\s+/g, ' ').trim();
}

// Env-configured brands are sanitized so leftover junk (e.g. "Mega") is ignored.
function envBrand(value) {
  const brand = normalizeBrand(value);
  return INVALID_BRAND_VALUES.has(brand.toLowerCase()) ? '' : brand;
}

/**
 * Resolve the brand name for outbound emails and calendar invites.
 *
 * Order of preference:
 *   1. The organization's own name (passed by the caller).
 *   2. An env-configured brand, ignoring stale placeholders like "Mega".
 *   3. The Seemplify product brand.
 *
 * Seemplify — never "Mega" — is always the final fallback.
 *
 * @param {string|null} organizationName
 * @returns {string}
 */
function resolveOrganizationBrand(organizationName = null) {
  return (
    normalizeBrand(organizationName) ||
    envBrand(process.env.DEFAULT_ORGANIZATION_NAME) ||
    envBrand(process.env.ORGANIZATION_NAME) ||
    envBrand(process.env.BREVO_SENDER_NAME) ||
    DEFAULT_ORGANIZATION_BRAND
  );
}

module.exports = {
  resolveOrganizationBrand,
  DEFAULT_ORGANIZATION_BRAND
};
