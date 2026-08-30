import { Account } from '../models/Account.js'
import { findOidcAccessToken } from '../middleware/apiAuth.js'
import { buildOrganizationClaims } from '../utils/permissions.js'
import { memberCanAccessApp, normalizeAppAccess } from '../utils/appAccess.js'

const text = (value) => String(value || '').trim()

const accessError = (message, status, code) => Object.assign(new Error(message), { status, code })
export const N8N_WORKSPACE_NODE_CLIENT_ID = 'n8n-workspace-node'
const MAX_SESSION_CLOCK_SKEW_SECONDS = 60
const PROTECTED_APPROVER_ROLES = new Set([
  'owner',
  'admin',
  'hr_manager',
  'recruiter',
  'interviewer',
  'staff'
])

const protectedApproverRequirement = (productId, ...permissions) => Object.freeze({
  productId,
  permissions: Object.freeze(permissions)
})

// This is deliberately an explicit, closed contract. Identity verifies only
// whether the checker still holds the exact product permissions; it never
// receives or executes the protected target input.
export const WORKSPACE_PROTECTED_APPROVER_AUTHORIZATION = Object.freeze({
  'boards.board.archive': Object.freeze([
    protectedApproverRequirement('messaging', 'boards.manage')
  ]),
  'leave.record_decision': Object.freeze([
    protectedApproverRequirement('leave-management', 'approve_leaves')
  ]),
  'payroll.finalize_run': Object.freeze([
    protectedApproverRequirement('payroll-management', 'payrollrun:approve')
  ]),
  'time.block_expected_absence': Object.freeze([
    protectedApproverRequirement('leave-management', 'approve_leaves')
  ])
})

const requireActiveIdentitySession = ({ account, sessionIssuedAt, now = Date.now() }) => {
  const issuedAt = Number(sessionIssuedAt)
  const currentSeconds = Math.floor(Number(now) / 1000)
  if (
    !Number.isInteger(issuedAt)
    || issuedAt < 1
    || issuedAt > currentSeconds + MAX_SESSION_CLOCK_SKEW_SECONDS
  ) {
    throw accessError(
      'The originating Seemplify Identity session is required.',
      401,
      'N8N_IDENTITY_SESSION_INVALID'
    )
  }
  const invalidBefore = new Date(account?.security?.sessionInvalidBefore || 0).getTime()
  if (Number.isFinite(invalidBefore) && invalidBefore > 0 && issuedAt * 1000 <= invalidBefore) {
    throw accessError(
      'The originating Seemplify Identity session was signed out.',
      401,
      'N8N_IDENTITY_SESSION_REVOKED'
    )
  }
  return issuedAt
}

/**
 * Rebuild the requested Workspace organization claim from Identity's canonical
 * account and organization membership records. This deliberately bypasses the
 * Workspace session and its local membership mirror so n8n session issuance
 * fails closed immediately after an Identity revocation.
 */
export async function resolveWorkspaceAutomationAccess({ subject, organizationId, sessionIat }, {
  AccountModel = Account,
  buildClaims = buildOrganizationClaims,
  requireSessionIssuedAt = true,
  now = Date.now
} = {}) {
  const normalizedSubject = text(subject)
  const normalizedOrganizationId = text(organizationId)
  if (!normalizedSubject || !normalizedOrganizationId) {
    throw accessError('Identity subject and organization are required.', 400, 'IDENTITY_CONTEXT_REQUIRED')
  }

  const query = AccountModel.findOne({ sub: normalizedSubject })
  const account = typeof query?.select === 'function'
    ? await query.select('sub email emailVerified profile organizations teams security.sessionInvalidBefore').lean()
    : await query
  if (!account || account.emailVerified !== true) {
    throw accessError('The Seemplify Identity account is not active and verified.', 403, 'IDENTITY_ACCESS_REVOKED')
  }
  if (requireSessionIssuedAt) {
    requireActiveIdentitySession({
      account,
      sessionIssuedAt: sessionIat,
      now: typeof now === 'function' ? now() : now
    })
  }

  const organizationClaims = await buildClaims(account)
  const organization = organizationClaims.find((candidate) => text(candidate?.id) === normalizedOrganizationId)
  if (!organization) {
    throw accessError('The Seemplify Identity membership is no longer active.', 403, 'IDENTITY_ACCESS_REVOKED')
  }

  return {
    sub: text(account.sub),
    email: text(account.email),
    email_verified: true,
    name: text(account.profile?.name),
    preferred_username: text(account.profile?.preferred_username),
    organizations: [organization],
    current_organization: organization,
    currentOrganization: organization,
    authorization: organization.authorization || null,
    roles: organization.authorization?.roleKeys || [],
    product_permissions: organization.authorization?.permissionsByApp || {}
  }
}

/**
 * Validate the opaque delegated access token at Identity, including the exact
 * OAuth client that received it, before rebuilding current organization
 * claims. Generic userinfo success is deliberately insufficient here.
 */
export async function resolveWorkspaceAutomationTokenAccess({ accessToken, organizationId }, {
  findAccessToken = findOidcAccessToken,
  AccountModel = Account,
  buildClaims = buildOrganizationClaims
} = {}) {
  const token = text(accessToken)
  if (!token || token.length > 8192) {
    throw accessError('A valid delegated n8n access token is required.', 401, 'N8N_ACCESS_TOKEN_INVALID')
  }

  let tokenRecord
  try {
    tokenRecord = await findAccessToken(token)
  } catch (error) {
    if (Number(error?.status) >= 500) throw error
    throw accessError('The delegated n8n access token could not be verified.', 503, 'N8N_TOKEN_CHECK_FAILED')
  }
  if (!tokenRecord || tokenRecord.isExpired || !text(tokenRecord.accountId)) {
    throw accessError('The delegated n8n access token is invalid or expired.', 401, 'N8N_ACCESS_TOKEN_INVALID')
  }
  if (text(tokenRecord.clientId) !== N8N_WORKSPACE_NODE_CLIENT_ID) {
    throw accessError('This token was not issued to the Workspace n8n client.', 403, 'N8N_ACCESS_TOKEN_WRONG_CLIENT')
  }

  return resolveWorkspaceAutomationAccess({
    subject: text(tokenRecord.accountId),
    organizationId
  }, { AccountModel, buildClaims, requireSessionIssuedAt: false })
}

function positiveRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0
}

/**
 * Rebuild the current checker projection for one exact protected action.
 *
 * The caller is the HMAC-authenticated Workspace backend, not a browser, so an
 * interactive session timestamp is neither available nor treated as proof.
 * Canonical account and organization membership are still rebuilt directly at
 * Identity, and the response is reduced to the minimum authorization data the
 * Workspace needs for a second, local-mirror-bounded decision.
 */
export async function resolveWorkspaceProtectedApproverAccess({
  subject,
  organizationId,
  actionId
}, {
  AccountModel = Account,
  buildClaims = buildOrganizationClaims
} = {}) {
  const normalizedSubject = text(subject)
  const normalizedOrganizationId = text(organizationId)
  const normalizedActionId = text(actionId)
  const requirements = WORKSPACE_PROTECTED_APPROVER_AUTHORIZATION[normalizedActionId]
  if (!normalizedSubject || !normalizedOrganizationId || !requirements?.length) {
    throw accessError(
      'An exact protected action, Identity subject, and organization are required.',
      400,
      'N8N_APPROVER_CONTEXT_INVALID'
    )
  }

  const identity = await resolveWorkspaceAutomationAccess({
    subject: normalizedSubject,
    organizationId: normalizedOrganizationId
  }, {
    AccountModel,
    buildClaims,
    requireSessionIssuedAt: false
  })
  const organization = identity.current_organization
  const authorization = organization?.authorization
  const rawAppAccessMode = text(organization?.appAccess?.mode).toLowerCase()
  const schemaVersion = positiveRevision(authorization?.schemaVersion)
  const policyRevision = positiveRevision(authorization?.policyRevision)
  const organizationRevision = positiveRevision(authorization?.organizationRevision)
  const role = text(organization?.role).toLowerCase()
  if (
    text(identity.sub) !== normalizedSubject
    || text(organization?.id) !== normalizedOrganizationId
  ) {
    throw accessError(
      'The current Identity membership cannot approve this action.',
      403,
      'N8N_APPROVER_ACCESS_REVOKED'
    )
  }
  if (
    !authorization
    || typeof authorization.permissionsByApp !== 'object'
    || Array.isArray(authorization.permissionsByApp)
    || !['all', 'selected'].includes(rawAppAccessMode)
    || !Array.isArray(organization?.appAccess?.appIds)
    || !schemaVersion
    || !policyRevision
    || !organizationRevision
    || !PROTECTED_APPROVER_ROLES.has(role)
  ) {
    throw accessError(
      'The current Identity authorization projection is unavailable.',
      503,
      'N8N_APPROVER_PROJECTION_UNAVAILABLE'
    )
  }

  const appAccess = normalizeAppAccess(organization.appAccess)
  const permissionsByApp = {}
  for (const requirement of requirements) {
    const productPermissions = authorization.permissionsByApp[requirement.productId]
    if (!Array.isArray(productPermissions)) {
      throw accessError(
        'The current Identity membership cannot approve this action.',
        403,
        'N8N_APPROVER_ACCESS_REVOKED'
      )
    }
    const granted = new Set(productPermissions)
    if (
      !memberCanAccessApp(appAccess, requirement.productId)
      || !requirement.permissions.every((permission) => granted.has(permission))
    ) {
      throw accessError(
        'The current Identity membership cannot approve this action.',
        403,
        'N8N_APPROVER_ACCESS_REVOKED'
      )
    }
    permissionsByApp[requirement.productId] = [...requirement.permissions]
  }

  return {
    subject: normalizedSubject,
    organizationId: normalizedOrganizationId,
    actionId: normalizedActionId,
    status: 'active',
    role,
    appAccess,
    authorization: {
      schemaVersion,
      policyRevision,
      organizationRevision,
      permissionsByApp
    }
  }
}
