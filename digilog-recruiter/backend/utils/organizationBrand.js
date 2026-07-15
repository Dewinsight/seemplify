const { decodeHtmlEntities } = require('./htmlDecode');

const DEFAULT_ORGANIZATION_BRAND = 'diGiLog';
const ORGANIZATION_EMAIL_CONTEXT_ERROR =
  'Cannot send organization email because its organization could not be resolved';
const INVALID_BRAND_VALUES = new Set(['mega', 'organization']);

function normalizeOrganizationBrand(value) {
  if (!value) return '';
  const brand = decodeHtmlEntities(String(value)).replace(/\s+/g, ' ').trim();
  return INVALID_BRAND_VALUES.has(brand.toLowerCase()) ? '' : brand;
}

function requireOrganizationBrand(value) {
  const brand = normalizeOrganizationBrand(value);
  if (!brand) {
    throw new Error(ORGANIZATION_EMAIL_CONTEXT_ERROR);
  }
  return brand;
}

function resolveOrganizationBrand(organizationName = null) {
  return (
    normalizeOrganizationBrand(organizationName) ||
    normalizeOrganizationBrand(process.env.DEFAULT_ORGANIZATION_NAME) ||
    normalizeOrganizationBrand(process.env.ORGANIZATION_NAME) ||
    normalizeOrganizationBrand(process.env.BREVO_SENDER_NAME) ||
    DEFAULT_ORGANIZATION_BRAND
  );
}

module.exports = {
  DEFAULT_ORGANIZATION_BRAND,
  ORGANIZATION_EMAIL_CONTEXT_ERROR,
  normalizeOrganizationBrand,
  requireOrganizationBrand,
  resolveOrganizationBrand
};
