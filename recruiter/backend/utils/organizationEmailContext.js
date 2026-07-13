const hasOrganizationName = (value) => (
  value && typeof value.name === 'string' && value.name.trim().length > 0
);

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
 * Resolve the organization that owns an organization-scoped email.
 * Sources are ordered so the related job wins over request/user context.
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

  if (hasOrganizationName(source)) {
    return source;
  }

  const sourceId = getOrganizationId(source);
  if (!sourceId) {
    throw new Error('Cannot send organization email because the organization name could not be resolved');
  }

  const resolved = await lookupOrganization(sourceId);

  if (hasOrganizationName(resolved)) {
    return resolved;
  }

  throw new Error('Cannot send organization email because the organization name could not be resolved');
}

module.exports = {
  resolveOrganizationForEmail
};
