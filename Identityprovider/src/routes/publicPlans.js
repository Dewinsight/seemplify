import express from 'express'
import { subscriptionService } from '../services/subscriptionService.js'

const router = express.Router()

/**
 * Public Plans API Routes
 * These routes are publicly accessible (no authentication required)
 * Used by organizations to view available plans
 */

/**
 * GET /api/plans
 * Get all active public plans
 */
router.get('/', async (req, res) => {
  try {
    const plans = await subscriptionService.getPublicPlans()

    // Format for public consumption
    const formattedPlans = plans.map(plan => ({
      id: plan._id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      pricing: {
        monthly: plan.pricing.monthly,
        yearly: plan.pricing.yearly,
        yearlyDiscount: plan.pricing.yearlyDiscount,
        currency: plan.pricing.currency,
        formattedMonthly: plan.formattedMonthlyPrice,
        formattedYearly: plan.formattedYearlyPrice
      },
      limits: plan.limits,
      features: plan.features,
      featureList: plan.featureList,
      isFeatured: plan.isFeatured,
      isRequestable: plan.isRequestable !== false,
      badgeText: plan.badgeText,
      color: plan.color,
      isTrial: plan.isTrial,
      trialDays: plan.isTrial ? plan.trialDays : null
    }))

    res.json({ plans: formattedPlans })
  } catch (error) {
    console.error('Error fetching public plans:', error)
    res.status(500).json({ error: 'Failed to fetch plans' })
  }
})

/**
 * GET /api/plans/:slug
 * Get a specific plan by slug
 */
router.get('/:slug', async (req, res) => {
  try {
    const plan = await subscriptionService.getPlanBySlug(req.params.slug)

    if (!plan || !plan.isActive || !plan.isPublic) {
      return res.status(404).json({ error: 'Plan not found' })
    }

    res.json({
      plan: {
        id: plan._id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        pricing: {
          monthly: plan.pricing.monthly,
          yearly: plan.pricing.yearly,
          yearlyDiscount: plan.pricing.yearlyDiscount,
          currency: plan.pricing.currency,
          formattedMonthly: plan.formattedMonthlyPrice,
          formattedYearly: plan.formattedYearlyPrice
        },
        limits: plan.limits,
        features: plan.features,
        featureList: plan.featureList,
        isFeatured: plan.isFeatured,
        isRequestable: plan.isRequestable !== false,
        badgeText: plan.badgeText,
        color: plan.color,
        isTrial: plan.isTrial,
        trialDays: plan.isTrial ? plan.trialDays : null
      }
    })
  } catch (error) {
    console.error('Error fetching plan:', error)
    res.status(500).json({ error: 'Failed to fetch plan' })
  }
})

export default router
