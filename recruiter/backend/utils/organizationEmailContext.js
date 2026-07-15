const { normalizeOrganizationBrand } = require('./organizationBrand');
const { syncOrganizationNameFromIdp } = require('./organizationIdentitySync');

const getOrganizationId = (value) => {
  if (!value) return null;
  return value._id || value;
};

async function findOrganizationById(organizationId) {
  const Organization = require('../models/Organization');
  return Organization.findById(organizationId)
    .select('name logo website idpOrganizationId')
    .lean();
}

async function fetchIdpOrganization(idpOrganizationId, userId) {
  const idpService = require('../services/idpService');
  return idpService.getOrganization(idpOrganizationId, userId);
}

async function refreshOrganizationFromIdp(
  organization,
  userId,
  {
    fetchOrganization = fetchIdpOrganization,
    syncOrganization = syncOrganizationNameFromIdp
  } = {}
) {
  if (!organization?.idpOrganizationId || !userId) {
    return null;
  }

  const idpOrganization = await fetchOrganization(organization.idpOrganizationId, userId);
  return syncOrganization(organization, idpOrganization);
}

/**
 * Resolve the authoritative organization for an organization-scoped email.
 * The related job wins over request/user context so an email cannot be branded
 * as another organization when stale user data is present.
 */
async function resolveOrganizationForEmail(
  { job, interview, organization, organizationId, userId } = {},
  {
    lookupOrganization = findOrganizationById,
    refreshOrganization = refreshOrganizationFromIdp
  } = {}
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

  const refreshableOrganization = resolved || (
    typeof source === 'object' && source?.idpOrganizationId ? source : null
  );
  if (refreshableOrganization && userId) {
    const refreshed = await refreshOrganization(refreshableOrganization, userId);
    if (normalizeOrganizationBrand(refreshed?.name)) {
      return refreshed;
    }
  }

  throw new Error('Cannot send organization email because its organization could not be resolved');
}

module.exports = {
  refreshOrganizationFromIdp,
  resolveOrganizationForEmail
};
