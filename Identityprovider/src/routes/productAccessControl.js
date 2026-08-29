import express from 'express'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { PRODUCT_PERMISSION_CATALOG } from '../config/accessControlCatalog.js'
import { createPlatformIntegrationServiceAuth } from '../middleware/platformIntegrationAuth.js'
import {
  canManageOrganizationAccess,
  canViewOrganizationAccess,
  deleteOrganizationProductRole,
  getProductAccessControlView,
  resetOrganizationProductRoleOverride,
  saveMemberProductAccessControl,
  saveOrganizationProductRoleOverride
} from '../services/accessControlService.js'

const router = express.Router()

export const PRODUCT_ACCESS_SERVICES = Object.freeze([
  'identity-provider', 'workspace', 'messaging', 'community', 'automation-hub',
  'recruiter', 'smarthr', 'leave-management', 'performance', 'performance-management',
  'payroll', 'payroll-management', 'time-attendance', 'lms', 'seemplify-learning',
  'approver', 'experience-management', 'openwebui', 'outline'
])

const SERVICE_PRODUCT_ALIASES = Object.freeze({
  workspace: ['messaging', 'community', 'automation-hub'],
  messaging: ['messaging', 'community'],
  recruiter: ['smarthr'],
  performance: ['performance-management'],
  payroll: ['payroll-management']
})

export function canServiceManageProduct(serviceId, appId) {
  const service = String(serviceId || '').trim().toLowerCase()
  const product = String(appId || '').trim().toLowerCase()
  if (!PRODUCT_PERMISSION_CATALOG.some((entry) => entry.appId === product)) return false
  if (service === 'identity-provider' || service === product) return true
  return (SERVICE_PRODUCT_ALIASES[service] || []).includes(product)
}

router.use(createPlatformIntegrationServiceAuth(PRODUCT_ACCESS_SERVICES, { requireBodyHash: true }))

function sendError(res, error) {
  const status = error.statusCode || (error.code === 'MEMBER_NOT_FOUND' ? 404 : (error.code ? 400 : 500))
  return res.status(status).json({
    error: error.message || 'Product access-control operation failed.',
    code: error.code || 'PRODUCT_ACCESS_CONTROL_ERROR'
  })
}

async function loadContext(req, res, next) {
  try {
    const appId = String(req.params.appId || '').trim().toLowerCase()
    if (!canServiceManageProduct(req.platformIntegrationService, appId)) {
      return res.status(403).json({
        error: 'This service cannot manage the requested product.',
        code: 'PRODUCT_SERVICE_SCOPE_REQUIRED'
      })
    }
    const organizationId = String(req.body?.organizationId || '').trim()
    const actorSubject = String(req.body?.actorSubject || '').trim()
    const [organization, actor] = await Promise.all([
      Organization.findById(organizationId),
      Account.findOne({ sub: actorSubject })
    ])
    if (!organization) return res.status(404).json({ error: 'Organization not found', code: 'ORGANIZATION_NOT_FOUND' })
    if (!actor) return res.status(404).json({ error: 'Acting account not found', code: 'ACTOR_NOT_FOUND' })
    req.productAccessContext = { appId, organization, actor }
    return next()
  } catch (error) {
    return sendError(res, error)
  }
}

async function requireView(req, res, next) {
  try {
    const { actor, organization } = req.productAccessContext
    if (await canViewOrganizationAccess(actor, organization)) return next()
    return res.status(403).json({
      error: 'Permission to view organization roles and permissions is required.',
      code: 'ACCESS_CONTROL_READ_REQUIRED'
    })
  } catch (error) {
    return sendError(res, error)
  }
}

async function requireManage(req, res, next) {
  try {
    const { actor, organization } = req.productAccessContext
    if (await canManageOrganizationAccess(actor, organization)) return next()
    return res.status(403).json({
      error: 'Permission to manage organization roles and permissions is required.',
      code: 'ACCESS_CONTROL_MANAGE_REQUIRED'
    })
  } catch (error) {
    return sendError(res, error)
  }
}

async function viewForRequest(req) {
  const { actor, organization, appId } = req.productAccessContext
  return getProductAccessControlView({ organization, account: actor, appId })
}

router.post('/:appId/view', loadContext, requireView, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await viewForRequest(req))
  } catch (error) {
    return sendError(res, error)
  }
})

router.put('/:appId/roles/:roleKey', loadContext, requireManage, async (req, res) => {
  try {
    const { organization, actor, appId } = req.productAccessContext
    await saveOrganizationProductRoleOverride({
      organization, actor, appId, roleKey: req.params.roleKey, input: req.body || {}
    })
    return res.json(await viewForRequest(req))
  } catch (error) {
    return sendError(res, error)
  }
})

router.post('/:appId/roles/:roleKey/reset', loadContext, requireManage, async (req, res) => {
  try {
    const { organization, actor, appId } = req.productAccessContext
    await resetOrganizationProductRoleOverride({
      organization, actor, appId, roleKey: req.params.roleKey,
      expectedRevision: req.body?.expectedRevision
    })
    return res.json(await viewForRequest(req))
  } catch (error) {
    return sendError(res, error)
  }
})

router.delete('/:appId/roles/:roleKey', loadContext, requireManage, async (req, res) => {
  try {
    const { organization, actor, appId } = req.productAccessContext
    await deleteOrganizationProductRole({
      organization, actor, appId, roleKey: req.params.roleKey,
      expectedRevision: req.body?.expectedRevision
    })
    return res.json(await viewForRequest(req))
  } catch (error) {
    return sendError(res, error)
  }
})

router.put('/:appId/members/:accountId', loadContext, requireManage, async (req, res) => {
  try {
    const { organization, actor, appId } = req.productAccessContext
    await saveMemberProductAccessControl({
      organization, actor, appId, accountId: req.params.accountId, input: req.body || {}
    })
    return res.json(await viewForRequest(req))
  } catch (error) {
    return sendError(res, error)
  }
})

export default router
