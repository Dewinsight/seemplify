// Postgres replacement for the Mongoose User org-membership instance methods
// (getOrganizationRole / isOrganizationMember / hasOrganizationPermission) and
// the organizationMiddleware role logic. Memberships now live in the
// OrganizationMember table (not an embedded array), with org owners implicit.
const prisma = require('./client');

const ROLE_PERMISSIONS = {
  owner: ['all'],
  admin: ['manage_users', 'manage_jobs', 'manage_candidates', 'view_analytics', 'manage_settings'],
  hr_manager: ['manage_jobs', 'manage_candidates', 'view_analytics'],
  recruiter: ['manage_candidates', 'view_jobs', 'view_candidates'],
  interviewer: ['view_candidates', 'view_jobs'],
};

function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('all') || perms.includes(permission);
}

async function getActiveMemberships(userId) {
  if (!userId) return [];
  return prisma.organizationMember.findMany({
    where: { userId: String(userId), status: 'active' },
  });
}

async function getMembership(userId, orgId) {
  if (!userId || !orgId) return null;
  return prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: String(orgId), userId: String(userId) } },
  });
}

/** Role of a user in an org — membership role, or 'owner' if they own it. */
async function getOrgRole(userId, orgId) {
  if (!userId || !orgId) return null;
  const m = await getMembership(userId, orgId);
  if (m) return m.role;
  const org = await prisma.organization.findUnique({ where: { id: String(orgId) }, select: { ownerId: true } });
  if (org && org.ownerId === String(userId)) return 'owner';
  return null;
}

async function isMember(userId, orgId) {
  if (!userId || !orgId) return false;
  const m = await getMembership(userId, orgId);
  if (m && m.status === 'active') return true;
  const org = await prisma.organization.findUnique({ where: { id: String(orgId) }, select: { ownerId: true } });
  return !!(org && org.ownerId === String(userId));
}

async function hasOrgPermission(userId, orgId, permission) {
  const role = await getOrgRole(userId, orgId);
  return !!role && hasPermission(role, permission);
}

module.exports = {
  ROLE_PERMISSIONS, hasPermission, getActiveMemberships,
  getMembership, getOrgRole, isMember, hasOrgPermission,
};
