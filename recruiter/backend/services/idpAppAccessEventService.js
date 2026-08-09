'use strict';

const User = require('../models/User');
const Organization = require('../models/Organization');
const sessionService = require('./sessionService');

function id(value) {
  return String(value?._id || value || '').trim();
}

async function applyMemberAppAccessChanged(data = {}, dependencies = {}) {
  const organizationId = id(data.organizationId);
  const subject = String(data.subject || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  if (!organizationId || (!subject && !email)) {
    const error = new TypeError('The app-access webhook is missing its organization or identity payload.');
    error.code = 'IDP_APP_ACCESS_EVENT_INVALID';
    throw error;
  }

  const findOrganization = dependencies.findOrganization || ((value) => (
    Organization.findOne({ idpOrganizationId: value }).select('_id').lean()
  ));
  const findUser = dependencies.findUser || (({ subject: stableSubject, email: verifiedEmail }) => (
    User.findOne(stableSubject
      ? { idpSubject: stableSubject }
      : { email: verifiedEmail })
  ));
  const revokeSessions = dependencies.revokeSessions || ((userId, reason) => (
    sessionService.revokeSessionsForUser(userId, reason)
  ));

  const [organization, user] = await Promise.all([
    findOrganization(organizationId),
    findUser({ subject, email })
  ]);
  if (!organization || !user) return { applied: false, reason: 'local_identity_unresolved' };

  const localOrganizationId = id(organization);
  // Entitlement webhooks are invalidation signals, never grants. A replayed
  // old "grant" can therefore only keep the user signed out. Fresh OIDC
  // claims rebuild the exact organization authorization on their next login.
  const authorized = new Set((user.recruiterAuthorizedOrganizations || []).map(id).filter(Boolean));
  authorized.delete(localOrganizationId);

  user.recruiterAuthorizedOrganizations = [...authorized];
  user.recruiterAppAccessSyncedAt = new Date();
  if (id(user.currentOrganization) === localOrganizationId) {
    user.currentOrganization = null;
    user.hasCompletedOrganizationSetup = false;
  }
  await user.save();
  await revokeSessions(user._id || user.id, 'idp_app_access_changed');

  return {
    applied: true,
    allowed: false,
    revoked: true,
    userId: id(user),
    organizationId: localOrganizationId
  };
}

async function applyMemberRemoved(data = {}, dependencies = {}) {
  const organizationId = id(data.organizationId);
  const subject = String(data.subject || data.userId || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  if (!organizationId || (!subject && !email)) {
    const error = new TypeError('The member-removal webhook is missing its organization or stable identity.');
    error.code = 'IDP_MEMBER_REMOVED_EVENT_INVALID';
    throw error;
  }
  const findOrganization = dependencies.findOrganization || ((value) => (
    Organization.findOne({ idpOrganizationId: value }).select('_id').lean()
  ));
  const findUser = dependencies.findUser || ((identity) => (
    User.findOne(identity.subject ? { idpSubject: identity.subject } : { email: identity.email })
  ));
  const revokeSessions = dependencies.revokeSessions || ((userId, reason) => (
    sessionService.revokeSessionsForUser(userId, reason)
  ));
  const [organization, user] = await Promise.all([
    findOrganization(organizationId),
    findUser({ subject, email })
  ]);
  if (!organization || !user) return { applied: false, reason: 'local_identity_unresolved' };

  const localOrganizationId = id(organization);
  for (const membership of user.organizationMemberships || []) {
    if (id(membership.organization) === localOrganizationId) membership.isActive = false;
  }
  user.recruiterAuthorizedOrganizations = (user.recruiterAuthorizedOrganizations || [])
    .filter(value => id(value) !== localOrganizationId);
  user.recruiterAppAccessSyncedAt = new Date();
  if (id(user.currentOrganization) === localOrganizationId) {
    user.currentOrganization = null;
    user.hasCompletedOrganizationSetup = false;
  }
  await user.save();
  await revokeSessions(user._id || user.id, 'idp_organization_membership_removed');
  return { applied: true, revoked: true, userId: id(user), organizationId: localOrganizationId };
}

async function applyIdentityClaimsChanged(data = {}, dependencies = {}) {
  const subject = String(data.subject || data.userId || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  if (!subject && !email) {
    const error = new TypeError('The claims-change webhook is missing its stable identity.');
    error.code = 'IDP_CLAIMS_CHANGED_EVENT_INVALID';
    throw error;
  }
  const findUser = dependencies.findUser || ((identity) => (
    User.findOne(identity.subject ? { idpSubject: identity.subject } : { email: identity.email })
  ));
  const revokeSessions = dependencies.revokeSessions || ((userId, reason) => (
    sessionService.revokeSessionsForUser(userId, reason)
  ));
  const user = await findUser({ subject, email });
  if (!user) return { applied: false, reason: 'local_identity_unresolved' };
  await revokeSessions(user._id || user.id, 'idp_authorization_claims_changed');
  return { applied: true, revoked: true, userId: id(user) };
}

module.exports = { applyMemberAppAccessChanged, applyMemberRemoved, applyIdentityClaimsChanged };
