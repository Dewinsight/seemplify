'use strict';

const User = require('../../models/User');
const Organization = require('../../models/Organization');

function id(value) {
  const candidate = value?._id || value?.id || value;
  const text = String(candidate || '').trim();
  return text || undefined;
}

function isHydratedRecord(value) {
  return Boolean(value && typeof value === 'object' && (value._id || value.id));
}

function actorName(actor) {
  const displayName = String(actor?.profile?.displayName || '').trim();
  if (displayName) return displayName;
  const fullName = [actor?.profile?.firstName, actor?.profile?.lastName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return fullName || undefined;
}

function canonicalAIContextFromRecords({
  actor,
  organization,
  actorId,
  organizationId
} = {}) {
  const localActorId = id(actorId || actor);
  const localOrganizationId = id(organizationId || organization);
  const canonicalActorId = String(actor?.idpSubject || '').trim() || localActorId;
  const canonicalOrganizationId = String(organization?.idpOrganizationId || '').trim()
    || localOrganizationId;

  return {
    ...(canonicalActorId ? { actorId: canonicalActorId } : {}),
    ...(localActorId ? { runtimeActorId: localActorId } : {}),
    ...(actorName(actor) ? { actorName: actorName(actor) } : {}),
    ...(actor?.email ? { actorEmail: String(actor.email).trim().toLowerCase() } : {}),
    ...(canonicalOrganizationId ? { organizationId: canonicalOrganizationId } : {}),
    ...(localOrganizationId ? { localOrganizationId } : {}),
    ...(organization?.name ? { organizationName: String(organization.name).trim() } : {})
  };
}

async function leanRecord(query) {
  if (!query) return null;
  const selected = typeof query.select === 'function'
    ? query.select('idpSubject email profile.firstName profile.lastName profile.displayName name idpOrganizationId')
    : query;
  return typeof selected?.lean === 'function' ? selected.lean() : selected;
}

async function hydrateCanonicalAIContext({
  actor,
  organization,
  actorId,
  organizationId
} = {}, {
  UserModel = User,
  OrganizationModel = Organization
} = {}) {
  const localActorId = id(actorId || actor);
  const localOrganizationId = id(organizationId || organization);
  const [hydratedActor, hydratedOrganization] = await Promise.all([
    isHydratedRecord(actor) && (actor.idpSubject || actor.email || actor.profile)
      ? actor
      : (localActorId ? leanRecord(UserModel.findById(localActorId)) : null),
    isHydratedRecord(organization) && (organization.idpOrganizationId || organization.name)
      ? organization
      : (localOrganizationId ? leanRecord(OrganizationModel.findById(localOrganizationId)) : null)
  ]);

  return canonicalAIContextFromRecords({
    actor: hydratedActor,
    organization: hydratedOrganization,
    actorId: localActorId,
    organizationId: localOrganizationId
  });
}

module.exports = {
  actorName,
  canonicalAIContextFromRecords,
  hydrateCanonicalAIContext
};
