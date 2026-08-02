const { normalizeOrganizationBrand } = require('./organizationBrand');

function getAuthoritativeOrganizationName(idpOrganization) {
  return normalizeOrganizationBrand(idpOrganization?.name);
}

function organizationNameNeedsSync(localOrganization, idpOrganization) {
  const authoritativeName = getAuthoritativeOrganizationName(idpOrganization);
  return Boolean(
    authoritativeName &&
    normalizeOrganizationBrand(localOrganization?.name) !== authoritativeName
  );
}

async function updateOrganizationName(organizationId, name) {
  const Organization = require('../models/Organization');
  await Organization.updateOne(
    { _id: organizationId },
    { $set: { name, updatedAt: new Date() } },
    { runValidators: true }
  );
}

async function syncOrganizationNameFromIdp(
  localOrganization,
  idpOrganization,
  { persistName = updateOrganizationName } = {}
) {
  if (!localOrganization || !organizationNameNeedsSync(localOrganization, idpOrganization)) {
    return localOrganization;
  }

  const authoritativeName = getAuthoritativeOrganizationName(idpOrganization);
  await persistName(localOrganization._id, authoritativeName);

  if (typeof localOrganization.set === 'function') {
    localOrganization.set('name', authoritativeName);
  } else {
    localOrganization.name = authoritativeName;
  }

  return localOrganization;
}

module.exports = {
  getAuthoritativeOrganizationName,
  organizationNameNeedsSync,
  syncOrganizationNameFromIdp
};
