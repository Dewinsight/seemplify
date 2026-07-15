const {
  normalizeOrganizationBrand,
  ORGANIZATION_EMAIL_CONTEXT_ERROR
} = require('./organizationBrand');

function getOrganizationId(value) {
  if (!value) return null;
  return value._id || value;
}

async function findOrganizationById(organizationId) {
  const Organization = require('../models/Organization');
  return Organization.findById(organizationId)
    .select('name logo website')
    .lean();
}

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
    throw new Error(ORGANIZATION_EMAIL_CONTEXT_ERROR);
  }

  if (normalizeOrganizationBrand(source?.name)) {
    return source;
  }

  const sourceId = getOrganizationId(source);
  const resolved = sourceId ? await lookupOrganization(sourceId) : null;
  if (normalizeOrganizationBrand(resolved?.name)) {
    return resolved;
  }

  throw new Error(ORGANIZATION_EMAIL_CONTEXT_ERROR);
}

module.exports = {
  resolveOrganizationForEmail
};
