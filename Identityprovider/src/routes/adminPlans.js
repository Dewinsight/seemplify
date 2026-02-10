import express from 'express'
import { requireAdminAuth, auditLog, adminRateLimit } from '../middleware/adminAuth.js'
import { subscriptionService } from '../services/subscriptionService.js'

const router = express.Router()

/**
 * Admin Plans API Routes
 * All routes require system admin authentication
 */

// Apply admin auth to all routes
router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 200, windowMs: 15 * 60 * 1000 }))

/**
 * GET /api/admin/plans
 * Get all plans
 */
router.get('/', async (req, res) => {
  try {
    const plans = await subscriptionService.getAllPlans()
    res.json({ plans })
  } catch (error) {
    console.error('Error fetching plans:', error)
    res.status(500).json({ error: 'Failed to fetch plans' })
  }
})

/**
 * GET /api/admin/plans/:planId
 * Get plan by ID
 */
router.get('/:planId', async (req, res) => {
  try {
    const plan = await subscriptionService.getPlanById(req.params.planId)
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' })
    }
    res.json({ plan })
  } catch (error) {
    console.error('Error fetching plan:', error)
    res.status(500).json({ error: 'Failed to fetch plan' })
  }
})

/**
 * POST /api/admin/plans
 * Create a new plan
 */
router.post('/', auditLog('create_plan'), async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      pricing,
      limits,
      features,
      hideHubCards,
      isActive,
      isPublic,
      isFeatured,
      isTrial,
      trialDays,
      displayOrder,
      badgeText,
      color
    } = req.body

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Plan name is required' })
    }

    const planData = {
      name,
      slug,
      description,
      pricing: pricing || {},
      limits: limits || {},
      features: features || {},
      hideHubCards: Array.isArray(hideHubCards) ? hideHubCards : [],
      isActive: isActive !== false,
      isPublic: isPublic !== false,
      isFeatured: isFeatured || false,
      isTrial: isTrial || false,
      trialDays: trialDays || 14,
      displayOrder: displayOrder || 0,
      badgeText,
      color
    }

    const plan = await subscriptionService.createPlan(planData, req.user._id)

    res.status(201).json({
      message: 'Plan created successfully',
      plan
    })
  } catch (error) {
    console.error('Error creating plan:', error)
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Plan name or slug already exists' })
    }
    res.status(500).json({ error: 'Failed to create plan' })
  }
})

/**
 * PUT /api/admin/plans/:planId
 * Update a plan
 */
router.put('/:planId', auditLog('update_plan'), async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      pricing,
      limits,
      features,
      hideHubCards,
      isActive,
      isPublic,
      isFeatured,
      isTrial,
      trialDays,
      displayOrder,
      badgeText,
      color
    } = req.body

    const planData = {}

    // Only include fields that were provided
    if (name !== undefined) planData.name = name
    if (slug !== undefined) planData.slug = slug
    if (description !== undefined) planData.description = description
    if (pricing !== undefined) planData.pricing = pricing
    if (limits !== undefined) planData.limits = limits
    if (features !== undefined) planData.features = features
    if (hideHubCards !== undefined) planData.hideHubCards = Array.isArray(hideHubCards) ? hideHubCards : []
    if (isActive !== undefined) planData.isActive = isActive
    if (isPublic !== undefined) planData.isPublic = isPublic
    if (isFeatured !== undefined) planData.isFeatured = isFeatured
    if (isTrial !== undefined) planData.isTrial = isTrial
    if (trialDays !== undefined) planData.trialDays = trialDays
    if (displayOrder !== undefined) planData.displayOrder = displayOrder
    if (badgeText !== undefined) planData.badgeText = badgeText
    if (color !== undefined) planData.color = color

    const plan = await subscriptionService.updatePlan(req.params.planId, planData, req.user._id)

    res.json({
      message: 'Plan updated successfully',
      plan
    })
  } catch (error) {
    console.error('Error updating plan:', error)
    if (error.message === 'Plan not found') {
      return res.status(404).json({ error: 'Plan not found' })
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Plan name or slug already exists' })
    }
    res.status(500).json({ error: 'Failed to update plan' })
  }
})

/**
 * DELETE /api/admin/plans/:planId
 * Deactivate a plan (soft delete)
 */
router.delete('/:planId', auditLog('deactivate_plan'), async (req, res) => {
  try {
    const plan = await subscriptionService.deactivatePlan(req.params.planId)

    res.json({
      message: 'Plan deactivated successfully',
      plan
    })
  } catch (error) {
    console.error('Error deactivating plan:', error)
    if (error.message === 'Plan not found') {
      return res.status(404).json({ error: 'Plan not found' })
    }
    res.status(500).json({ error: 'Failed to deactivate plan' })
  }
})

/**
 * POST /api/admin/plans/:planId/activate
 * Reactivate a plan
 */
router.post('/:planId/activate', auditLog('activate_plan'), async (req, res) => {
  try {
    const plan = await subscriptionService.updatePlan(req.params.planId, { isActive: true }, req.user._id)

    res.json({
      message: 'Plan activated successfully',
      plan
    })
  } catch (error) {
    console.error('Error activating plan:', error)
    if (error.message === 'Plan not found') {
      return res.status(404).json({ error: 'Plan not found' })
    }
    res.status(500).json({ error: 'Failed to activate plan' })
  }
})

/**
 * GET /api/admin/plans/stats
 * Get plan statistics
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await subscriptionService.getPlanStats()
    res.json({ stats })
  } catch (error) {
    console.error('Error fetching plan stats:', error)
    res.status(500).json({ error: 'Failed to fetch plan statistics' })
  }
})

export default router
