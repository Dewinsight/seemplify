const prisma = require('../db/client');
const { isObjectIdLike } = require('../db/objectId');
const { RECOMMENDED_CREDIT_COSTS } = require('../config/creditEconomics');

const DEFAULT_CUSTOM_PLAN_TOTAL_CREDITS = 2000;

// Inlined replacement for Plan#toPublicJSON: convert 'unlimited' limits to Infinity.
const planToPublicJSON = (plan) => {
  if (!plan) return plan;
  const planObject = { ...plan };
  if (planObject.limits && typeof planObject.limits === 'object') {
    planObject.limits = { ...planObject.limits };
    Object.keys(planObject.limits).forEach((key) => {
      if (planObject.limits[key] === 'unlimited') {
        planObject.limits[key] = Infinity;
      }
    });
  }
  return planObject;
};

// Get all plans (with filter options)
exports.getPlans = async (req, res) => {
  try {
    const { published, isDefault, planType } = req.query;
    let query = {};

    // Filter options
    if (published === 'true') {
      query.isPublished = true;
    }
    
    if (isDefault === 'true') {
      query.isDefault = true;
    }
    
    if (planType && planType === 'organization') {
      query.planType = planType;
    }

    // Get plans sorted by display order
    const plans = await prisma.plan.findMany({ where: query, orderBy: { displayOrder: 'asc' } });

    // Format response for frontend
    const formattedPlans = plans.map(plan => {
      // Convert to regular object and handle 'unlimited' values
      const planData = planToPublicJSON(plan);
      return planData;
    });

    res.status(200).json({
      success: true,
      count: formattedPlans.length,
      plans: formattedPlans
    });
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subscription plans',
      error: error.message
    });
  }
};

// Get a single plan by ID
exports.getPlanById = async (req, res) => {
  try {
    const plan = isObjectIdLike(req.params.planId)
      ? await prisma.plan.findUnique({ where: { id: req.params.planId } })
      : null;

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.status(200).json({
      success: true,
      plan: planToPublicJSON(plan)
    });
  } catch (error) {
    console.error('Error getting plan by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subscription plan',
      error: error.message
    });
  }
};

// Get a single plan by code
exports.getPlanByCode = async (req, res) => {
  try {
    const plan = await prisma.plan.findFirst({ where: { code: req.params.planCode.toLowerCase() } });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.status(200).json({
      success: true,
      plan: planToPublicJSON(plan)
    });
  } catch (error) {
    console.error('Error getting plan by code:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subscription plan',
      error: error.message
    });
  }
};

// Create a new plan (admin only)
exports.createPlan = async (req, res) => {
  try {
    const {
      name,
      code,
      price,
      currency,
      billingCycle,
      features,
      limits,
      credits,
      trialDays,
      isPublished,
      displayOrder,
      planType
    } = req.body;

    // Check if a plan with this code already exists
    const existingPlan = await prisma.plan.findFirst({ where: { code: code.toLowerCase() } });
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: 'A plan with this code already exists'
      });
    }

    // Create new plan
    const newPlan = await prisma.plan.create({
      data: {
        name,
        code: code.toLowerCase(),
        price,
        currency: currency || 'USD',
        billingCycle: billingCycle || 'monthly',
        features: features || [],
        limits: limits || {},
        credits: credits || {
          totalCredits: DEFAULT_CUSTOM_PLAN_TOTAL_CREDITS,
          creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
          rolloverEnabled: false,
          rolloverPercentage: 0
        },
        trialDays: trialDays || 0,
        isPublished: isPublished !== undefined ? isPublished : true,
        displayOrder: displayOrder || 0,
        planType: 'organization', // Only organization plans supported now
        isDefault: false, // New plans are never default
        isCustom: true    // New plans are considered custom
      }
    });

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan: planToPublicJSON(newPlan)
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating subscription plan',
      error: error.message
    });
  }
};

// Update a plan (admin only)
exports.updatePlan = async (req, res) => {
  try {
    const plan = isObjectIdLike(req.params.planId)
      ? await prisma.plan.findUnique({ where: { id: req.params.planId } })
      : null;

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Get fields to update
    const {
      name,
      price,
      currency,
      billingCycle,
      features,
      limits,
      credits,
      trialDays,
      isPublished,
      displayOrder,
      planType
    } = req.body;

    // Update plan fields if provided
    const data = {};
    if (name !== undefined) data.name = name;
    if (price !== undefined) data.price = price;
    if (currency !== undefined) data.currency = currency;
    if (billingCycle !== undefined) data.billingCycle = billingCycle;
    if (features !== undefined) data.features = features;
    if (limits !== undefined) data.limits = limits;
    if (credits !== undefined) data.credits = credits;
    if (trialDays !== undefined) data.trialDays = trialDays;
    if (isPublished !== undefined) data.isPublished = isPublished;
    if (displayOrder !== undefined) data.displayOrder = displayOrder;
    if (planType !== undefined && planType === 'organization') data.planType = planType;

    // Note: We do not allow changing the code of a plan
    // Note: We do not allow changing isDefault status via this API

    const updatedPlan = await prisma.plan.update({ where: { id: plan.id }, data });

    res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      plan: planToPublicJSON(updatedPlan)
    });
  } catch (error) {
    console.error('Error updating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating subscription plan',
      error: error.message
    });
  }
};

// Delete a plan (admin only)
exports.deletePlan = async (req, res) => {
  try {
    const plan = isObjectIdLike(req.params.planId)
      ? await prisma.plan.findUnique({ where: { id: req.params.planId } })
      : null;

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Check if this is a default plan (cannot delete default plans)
    if (plan.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Default plans cannot be deleted. Try unpublishing it instead.'
      });
    }

    // Check if any users or organizations are using this plan
    const usersWithPlan = await prisma.user.count({ where: { subscription: { path: ['plan'], equals: plan.code } } });
    const orgsWithPlan = await prisma.organization.count({ where: { subscription: { path: ['plan'], equals: plan.code } } });

    if (usersWithPlan > 0 || orgsWithPlan > 0) {
      return res.status(400).json({
        success: false,
        message: 'This plan is currently in use and cannot be deleted',
        usersCount: usersWithPlan,
        organizationsCount: orgsWithPlan
      });
    }

    // Delete the plan
    await prisma.plan.delete({ where: { id: plan.id } });

    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting subscription plan',
      error: error.message
    });
  }
};

// Get usage statistics for a plan (admin only)
exports.getPlanUsageStats = async (req, res) => {
  try {
    const plan = isObjectIdLike(req.params.planId)
      ? await prisma.plan.findUnique({ where: { id: req.params.planId } })
      : null;

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Get counts of users and organizations on this plan
    const usersCount = await prisma.user.count({ where: { subscription: { path: ['plan'], equals: plan.code } } });
    const orgsCount = await prisma.organization.count({ where: { subscription: { path: ['plan'], equals: plan.code } } });

    res.status(200).json({
      success: true,
      plan: {
        id: plan.id,
        code: plan.code,
        name: plan.name
      },
      stats: {
        usersCount,
        orgsCount,
        totalSubscriptions: usersCount + orgsCount
      }
    });
  } catch (error) {
    console.error('Error getting plan usage statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving plan usage statistics',
      error: error.message
    });
  }
};

// Public endpoint to get published plans for the frontend
exports.getPublishedPlans = async (req, res) => {
  try {
    const { planType } = req.query;
    let query = { isPublished: true };
    
    // Filter by plan type if specified
    if (planType && planType === 'organization') {
      query.planType = planType;
    }
    
    // Get only published plans, sorted by display order
    const plans = await prisma.plan.findMany({ where: query, orderBy: { displayOrder: 'asc' } });

    // Format response for frontend
    const formattedPlans = plans.map(plan => {
      return planToPublicJSON(plan);
    });

    res.status(200).json({
      success: true,
      count: formattedPlans.length,
      plans: formattedPlans
    });
  } catch (error) {
    console.error('Error getting published plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving published subscription plans',
      error: error.message
    });
  }
};

