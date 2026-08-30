import { Account } from '../models/Account.js'
import { findOidcAccessToken } from '../middleware/apiAuth.js'
import { buildOrganizationClaims } from '../utils/permissions.js'

const text = (value) => String(value || '').trim()

const accessError = (message, status, code) => Object.assign(new Error(message), { status, code })
export const N8N_WORKSPACE_NODE_CLIENT_ID = 'n8n-workspace-node'

/**
 * Rebuild the requested Workspace organization claim from Identity's canonical
 * account and organization membership records. This deliberately bypasses the
 * Workspace session and its local membership mirror so n8n session issuance
 * fails closed immediately after an Identity revocation.
 */
export async function resolveWorkspaceAutomationAccess({ subject, organizationId }, {
  AccountModel = Account,
  buildClaims = buildOrganizationClaims
} = {}) {
  const normalizedSubject = text(subject)
  const normalizedOrganizationId = text(organizationId)
  if (!normalizedSubject || !normalizedOrganizationId) {
    throw accessError('Identity subject and organization are required.', 400, 'IDENTITY_CONTEXT_REQUIRED')
  }

  const query = AccountModel.findOne({ sub: normalizedSubject })
  const account = typeof query?.select === 'function'
    ? await query.select('sub email emailVerified profile organizations teams').lean()
    : await query
  if (!account || account.emailVerified !== true) {
    throw accessError('The Seemplify Identity account is not active and verified.', 403, 'IDENTITY_ACCESS_REVOKED')
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
  }, { AccountModel, buildClaims })
}
