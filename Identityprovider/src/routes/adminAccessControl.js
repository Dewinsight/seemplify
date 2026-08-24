import express from 'express'
import {
  adminRateLimit,
  auditLog,
  requireAdminAuth,
  requireSuperAdmin,
  setAdminContext
} from '../middleware/adminAuth.js'
import { requireSameOriginMutation } from '../middleware/sameOriginMutation.js'
import {
  deleteGlobalRole,
  getGlobalAccessControlView,
  saveGlobalRole
} from '../services/accessControlService.js'

export const adminAccessControlViews = express.Router()
export const adminAccessControlApi = express.Router()

function sendError(res, error) {
  const status = error.statusCode || (error.code ? 400 : 500)
  return res.status(status).json({
    error: error.message || 'Access-control operation failed.',
    code: error.code || 'ACCESS_CONTROL_ERROR'
  })
}

adminAccessControlViews.use(requireAdminAuth)
adminAccessControlViews.use(setAdminContext)

adminAccessControlViews.get('/', async (req, res) => {
  try {
    const accessControl = await getGlobalAccessControlView()
    return res.render('admin/access-control', {
      activePage: 'access-control',
      accessControl,
      user: req.user
    })
  } catch (error) {
    console.error('Failed to load global access control:', error)
    return res.status(500).render('error', {
      title: 'Access control unavailable',
      message: 'The global permission policy could not be loaded.'
    })
  }
})

adminAccessControlApi.use(requireAdminAuth)
adminAccessControlApi.use(requireSameOriginMutation)
adminAccessControlApi.use(adminRateLimit({ maxRequests: 120, windowMs: 15 * 60 * 1000, keyPrefix: 'access-control' }))

adminAccessControlApi.get('/', async (_req, res) => {
  try {
    return res.json(await getGlobalAccessControlView())
  } catch (error) {
    console.error('Failed to read global access policy:', error)
    return sendError(res, error)
  }
})

adminAccessControlApi.put('/roles/:roleKey',
  requireSuperAdmin,
  auditLog('update_global_access_role'),
  async (req, res) => {
    try {
      if (String(req.body?.key || req.params.roleKey) !== String(req.params.roleKey)) {
        return res.status(400).json({ error: 'Role key does not match the route.', code: 'ROLE_KEY_MISMATCH' })
      }
      await saveGlobalRole({ ...req.body, key: req.params.roleKey }, req.user)
      return res.json(await getGlobalAccessControlView())
    } catch (error) {
      console.error('Failed to update global access role:', error)
      return sendError(res, error)
    }
  }
)

adminAccessControlApi.post('/roles',
  requireSuperAdmin,
  auditLog('create_global_access_role'),
  async (req, res) => {
    try {
      await saveGlobalRole(req.body || {}, req.user)
      return res.status(201).json(await getGlobalAccessControlView())
    } catch (error) {
      console.error('Failed to create global access role:', error)
      return sendError(res, error)
    }
  }
)

adminAccessControlApi.delete('/roles/:roleKey',
  requireSuperAdmin,
  auditLog('delete_global_access_role'),
  async (req, res) => {
    try {
      await deleteGlobalRole(req.params.roleKey, req.user, req.query.expectedRevision)
      return res.json(await getGlobalAccessControlView())
    } catch (error) {
      console.error('Failed to delete global access role:', error)
      return sendError(res, error)
    }
  }
)
