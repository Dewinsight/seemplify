const { normalizeOrganizationBrand } = require('./organizationBrand');

const getOrganizationId = (value) => {
  if (!value) return null;
  return value._id || value;
};

async function findOrganizationById(organizationId) {
  const Organization = require('../models/Organization');
  return Organization.findById(organizationId)
    .select('name logo website')
    .lean();
}

/**
 * Resolve the authoritative organization for an organization-scoped email.
 * The related job wins over request/user context so an email cannot be branded
 * as another organization when stale user data is present.
 */
async function resolveOrganizationForEmail(
  { job, interview, organization, organizationId } = {},
  { lookupOrganization = findOrganizationById } = {}
) {
  const sources = [
    job?.organization,
    interview?.jobId?.organization,
    organization,
    organizationId,
    interview?.organizationId
  ];

  const source = sources.find(Boolean);
  if (!source) {
    throw new Error('Cannot send organization email because its organization could not be resolved');
  }

  if (normalizeOrganizationBrand(source?.name)) {
    return source;
  }

  const sourceId = getOrganizationId(source);
  const resolved = sourceId ? await lookupOrganization(sourceId) : null;

  if (normalizeOrganizationBrand(resolved?.name)) {
    return resolved;
  }

  throw new Error('Cannot send organization email because its organization could not be resolved');
}

module.exports = {
  resolveOrganizationForEmail
};
