'use strict';
// Minimum signed IdP policy understood by current Performance permissions.
// A contract test pins this to the central catalogue rather than migrating roles here.
const MIN_AUTHORIZATION_SCHEMA_VERSION = 5;
function hasRetiredAuthorization(user = {}) {
  const organizations = [...(Array.isArray(user.organizations) ? user.organizations : [])];
  const current = user.currentOrganization || user.current_organization;
  if (current) organizations.push(current);
  return organizations.some(org => {
    const version = org?.authorization?.schemaVersion;
    return version !== undefined && (!Number.isInteger(Number(version)) || Number(version) < MIN_AUTHORIZATION_SCHEMA_VERSION);
  });
}
module.exports = { MIN_AUTHORIZATION_SCHEMA_VERSION, hasRetiredAuthorization };
