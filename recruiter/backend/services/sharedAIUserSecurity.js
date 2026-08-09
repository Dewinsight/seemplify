'use strict';

const RECRUITER_APP_IDS = Object.freeze(new Set(['smarthr', 'recruiter']));

function isSharedAIOnly(user) {
  return user?.sharedAIOnly === true;
}

function canUseLocalCredentials(user) {
  return Boolean(user) && !isSharedAIOnly(user);
}

function organizationClaimAllowsRecruiter(claim) {
  const access = claim?.appAccess;
  // Older IdP claims predate per-app restrictions; membership meant all apps.
  if (!access || String(access.mode || 'all').toLowerCase() !== 'selected') return true;
  const ids = Array.isArray(access.appIds) ? access.appIds : [];
  return ids.some((id) => RECRUITER_APP_IDS.has(String(id || '').trim().toLowerCase()));
}

function recruiterAuthorizedClaims(claims) {
  return (Array.isArray(claims) ? claims : []).filter(organizationClaimAllowsRecruiter);
}

function firstRecruiterAuthorizedMembership(user, authorizedOrganizationIds) {
  const allowed = new Set(Array.from(authorizedOrganizationIds || []).map((value) => (
    String(value?._id || value || '')
  )).filter(Boolean));
  return (user?.organizationMemberships || []).find((membership) => (
    membership?.isActive !== false
    && allowed.has(String(membership?.organization?._id || membership?.organization || ''))
  )) || null;
}

function recruiterOrganizationAuthorized(user, organizationId) {
  const target = String(organizationId?._id || organizationId || '').trim();
  if (!target || isSharedAIOnly(user)) return false;
  const activeMember = (user?.organizationMemberships || []).some((membership) => (
    membership?.isActive !== false
    && String(membership?.organization?._id || membership?.organization || '') === target
  ));
  if (!activeMember) return false;
  // App access was not represented on legacy Recruiter rows. Treating an
  // unknown entitlement as "all" would let a pre-rollout session enter an
  // organization after its IdP membership became Performance-only. A normal
  // OIDC launch backfills the authoritative set; until then, fail closed.
  if (!user?.recruiterAppAccessSyncedAt) return false;
  return (user.recruiterAuthorizedOrganizations || []).some((organization) => (
    String(organization?._id || organization || '') === target
  ));
}

function passwordResetQuery(token, now = Date.now()) {
  return {
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: now },
    sharedAIOnly: { $ne: true }
  };
}

module.exports = {
  RECRUITER_APP_IDS,
  canUseLocalCredentials,
  firstRecruiterAuthorizedMembership,
  isSharedAIOnly,
  organizationClaimAllowsRecruiter,
  passwordResetQuery,
  recruiterAuthorizedClaims,
  recruiterOrganizationAuthorized
};
