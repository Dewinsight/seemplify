const crypto = require('crypto');

function idpEndpoint() {
  return String(process.env.IDP_INTERNAL_API_URL || process.env.IDP_ISSUER_URL || 'http://localhost:4000')
    .replace(/\/$/, '');
}

function signingSecret() {
  return process.env.INTERNAL_SERVICE_SECRET || process.env.LEAVE_IDP_SERVICE_SECRET || '';
}

function normalizeMembership(membership) {
  const userId = String(membership.idpSubject || membership.userId || membership.subjectId || '');
  return {
    userId,
    accountId: String(membership.userId || membership.subjectId || ''),
    email: String(membership.email || ''),
    name: String(membership.name || membership.email || 'Organization member'),
    role: String(membership.role || 'staff'),
    employeeId: membership.employeeId || null,
    departmentId: membership.departmentId || null,
    teamIds: Array.isArray(membership.teamIds) ? membership.teamIds.map(String) : [],
    teamAssignments: Array.isArray(membership.teamAssignments) ? membership.teamAssignments : [],
    managerId: membership.managerId ? String(membership.managerId) : null,
    status: String(membership.status || 'active'),
  };
}

async function fetchOrganizationRoster(organizationId) {
  const body = { organizationId };
  const serialized = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const secret = signingSecret();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('Leave Management to Identity Provider service authentication is not configured');
  }

  const signature = secret
    ? crypto.createHmac('sha256', secret).update(`${timestamp}.${serialized}`).digest('hex')
    : '';
  const response = await fetch(`${idpEndpoint()}/api/internal/v1/memberships/reconcile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-service-id': 'leave-management',
      'x-service-timestamp': timestamp,
      'x-service-signature': signature ? `sha256=${signature}` : '',
    },
    body: serialized,
    signal: AbortSignal.timeout(Number(process.env.IDP_RECONCILIATION_TIMEOUT_MS || 30000)),
  });

  if (!response.ok) {
    throw new Error(`Identity Provider roster request failed with HTTP ${response.status}`);
  }
  const snapshot = await response.json();
  if (!Array.isArray(snapshot.memberships)) {
    throw new Error('Identity Provider roster response did not contain memberships');
  }

  return snapshot.memberships
    .map(normalizeMembership)
    .filter((membership) => membership.userId && ['active', 'scheduled_exit'].includes(membership.status));
}

async function findRosterMember(organizationId, userId) {
  const roster = await fetchOrganizationRoster(organizationId);
  return roster.find((member) => member.userId === String(userId) || member.accountId === String(userId)) || null;
}

module.exports = {
  fetchOrganizationRoster,
  findRosterMember,
  normalizeMembership,
};
