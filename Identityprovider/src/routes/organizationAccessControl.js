import express from 'express'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { requireAuth, rateLimit } from '../middleware/permissions.js'
import { requireSameOriginMutation } from '../middleware/sameOriginMutation.js'
import {
  canManageOrganizationAccess,
  canViewOrganizationAccess,
  authorizationHasPermission,
  deleteOrganizationRoleOverride,
  getOrganizationAccessControlView,
  resolveOrganizationAuthorization,
  saveMemberAccessControl,
  saveOrganizationRoleOverride
} from '../services/accessControlService.js'

export const organizationAccessControlViews = express.Router()
export const organizationAccessControlApi = express.Router()

async function loadOrganization(req, res, next) {
  try {
    const organization = await Organization.findById(req.params.orgId)
    if (!organization) return res.status(404).json({ error: 'Organization not found', code: 'ORGANIZATION_NOT_FOUND' })
    req.organization = organization
    return next()
  } catch (error) {
    return next(error)
  }
}

async function requireAccessView(req, res, next) {
  try {
    if (await canViewOrganizationAccess(req.user, req.organization)) return next()
    return res.status(403).json({ error: 'Permission to view organization access control is required.', code: 'ACCESS_CONTROL_READ_REQUIRED' })
  } catch (error) {
    return next(error)
  }
}

async function requireAccessManage(req, res, next) {
  try {
    if (await canManageOrganizationAccess(req.user, req.organization)) return next()
    return res.status(403).json({ error: 'Permission to manage organization access control is required.', code: 'ACCESS_CONTROL_MANAGE_REQUIRED' })
  } catch (error) {
    return next(error)
  }
}

function sendError(res, error) {
  const status = error.statusCode || (error.code === 'MEMBER_NOT_FOUND' ? 404 : (error.code ? 400 : 500))
  return res.status(status).json({
    error: error.message || 'Access-control operation failed.',
    code: error.code || 'ACCESS_CONTROL_ERROR'
  })
}

organizationAccessControlViews.get('/:orgId/access-control',
  requireAuth,
  loadOrganization,
  requireAccessView,
  async (req, res) => {
    try {
      const accessControl = await getOrganizationAccessControlView({
        organization: req.organization,
        account: req.user
      })
      const member = (req.organization.members || []).find((candidate) =>
        candidate.status === 'active' && candidate.account.toString() === req.user._id.toString()
      )
      const authorization = member
        ? await resolveOrganizationAuthorization({ account: req.user, organization: req.organization, member })
        : null
      const hasIdentityPermission = (permission) =>
        authorizationHasPermission(authorization, 'identity', permission)
      return res.render('organization-access-control', {
        accessControl,
        organization: req.organization,
        yourRole: member?.role || (req.user.hasAdminAccess() ? 'system_admin' : 'staff'),
        canManage: await canManageOrganizationAccess(req.user, req.organization),
        canViewMembers: req.user.hasAdminAccess() || hasIdentityPermission('members.view'),
        canInviteMembers: req.user.hasAdminAccess() || hasIdentityPermission('members.invite'),
        canManageInvitations: req.user.hasAdminAccess() || hasIdentityPermission('invitations.manage'),
        canViewAccessControl: true,
        identityPermissions: authorization?.permissionsByApp?.identity || [],
        user: req.user
      })
    } catch (error) {
      console.error('Failed to load organization access control:', error)
      return res.status(500).render('error', {
        title: 'Access control unavailable',
        message: 'The organization permission policy could not be loaded.'
      })
    }
  }
)

organizationAccessControlApi.use(requireAuth)
organizationAccessControlApi.use(requireSameOriginMutation)
organizationAccessControlApi.use(rateLimit({ keyPrefix: 'organization-access-control', maxRequests: 160, windowMs: 15 * 60 * 1000 }))

organizationAccessControlApi.get('/:orgId/access-control', loadOrganization, requireAccessView, async (req, res) => {
  try {
    return res.json(await getOrganizationAccessControlView({ organization: req.organization, account: req.user }))
  } catch (error) {
    console.error('Failed to read organization access control:', error)
    return sendError(res, error)
  }
})

organizationAccessControlApi.put('/:orgId/access-control/roles/:roleKey',
  loadOrganization,
  requireAccessManage,
  async (req, res) => {
    try {
      await saveOrganizationRoleOverride({
        organization: req.organization,
        input: { ...req.body, roleKey: req.params.roleKey },
        actor: req.user
      })
      return res.json(await getOrganizationAccessControlView({ organization: req.organization, account: req.user }))
    } catch (error) {
      console.error('Failed to update organization role override:', error)
      return sendError(res, error)
    }
  }
)

organizationAccessControlApi.delete('/:orgId/access-control/roles/:roleKey',
  loadOrganization,
  requireAccessManage,
  async (req, res) => {
    try {
      await deleteOrganizationRoleOverride({
        organization: req.organization,
        key: req.params.roleKey,
        actor: req.user,
        expectedRevision: req.query.expectedRevision
      })
      return res.json(await getOrganizationAccessControlView({ organization: req.organization, account: req.user }))
    } catch (error) {
      console.error('Failed to delete organization role override:', error)
      return sendError(res, error)
    }
  }
)

organizationAccessControlApi.put('/:orgId/access-control/members/:accountId',
  loadOrganization,
  requireAccessManage,
  async (req, res) => {
    try {
      const account = await Account.findById(req.params.accountId).select('_id')
      if (!account) return res.status(404).json({ error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
      await saveMemberAccessControl({
        organization: req.organization,
        accountId: account._id,
        input: req.body || {},
        actor: req.user
      })
      return res.json(await getOrganizationAccessControlView({ organization: req.organization, account: req.user }))
    } catch (error) {
      console.error('Failed to update member access:', error)
      return sendError(res, error)
    }
  }
)
