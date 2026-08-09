'use strict';

async function materializeRecruiterOrganizations({ Organization, user, claims, existingOrganizations = [] }) {
  const byIdpId = new Map(existingOrganizations.map(org => [String(org.idpOrganizationId), org]));
  const missing = (claims || []).filter(claim => !byIdpId.has(String(claim.id)));
  let legacyOrganization = null;
  if (missing.length) {
    legacyOrganization = await Organization.findOne({
      'members.user': user._id,
      $or: [
        { idpOrganizationId: { $exists: false } },
        { idpOrganizationId: null },
        { idpOrganizationId: '' }
      ]
    }).lean();
  }
  for (const claim of missing) {
    let organization;
    if (legacyOrganization) {
      await Organization.updateOne(
        { _id: legacyOrganization._id },
        { $set: { idpOrganizationId: claim.id } }
      );
      organization = { ...legacyOrganization, idpOrganizationId: claim.id };
      legacyOrganization = null;
    } else {
      organization = new Organization({
        name: claim.name || `Organization ${String(claim.id).slice(-8)}`,
        owner: user._id,
        idpOrganizationId: claim.id,
        members: [{
          user: user._id,
          role: claim.role,
          status: 'active',
          joinedAt: claim.joinedAt || new Date()
        }]
      });
      await organization.save();
    }
    byIdpId.set(String(claim.id), organization);
  }
  return byIdpId;
}

function membershipOrganizationId(membership) {
  const organization = membership?.organization?._id || membership?.organization;
  return organization?.toString?.() || '';
}

function deduplicateOrganizationMemberships(memberships = [], authoritativeRoles = new Map()) {
  const byOrganization = new Map();

  for (const membership of memberships) {
    const organizationId = membershipOrganizationId(membership);
    if (!organizationId) continue;

    const existing = byOrganization.get(organizationId);
    if (!existing) {
      byOrganization.set(organizationId, membership);
      continue;
    }

    existing.isActive = Boolean(existing.isActive || membership.isActive);
    if (membership.joinedAt && (!existing.joinedAt || membership.joinedAt > existing.joinedAt)) {
      existing.joinedAt = membership.joinedAt;
    }
  }

  for (const [organizationId, membership] of byOrganization) {
    const authoritativeRole = authoritativeRoles.get(organizationId);
    if (authoritativeRole) {
      // The signed IdP claim is the authority. Never preserve a stale, more
      // privileged duplicate from older Recruiter membership flows.
      membership.role = authoritativeRole;
      membership.isActive = true;
    }
  }

  return Array.from(byOrganization.values());
}

module.exports = {
  materializeRecruiterOrganizations,
  deduplicateOrganizationMemberships
};
