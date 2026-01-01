const Plan = require('../models/Plan');
const User = require('../models/User');
const Organization = require('../models/Organization');

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
    const plans = await Plan.find(query).sort({ displayOrder: 1 });

    // Format response for frontend
    const formattedPlans = plans.map(plan => {
      // Convert to regular object and handle 'unlimited' values
      const planData = plan.toPublicJSON();
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
    const plan = await Plan.findById(req.params.planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.status(200).json({
      success: true,
      plan: plan.toPublicJSON()
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
    const plan = await Plan.findOne({ code: req.params.planCode.toLowerCase() });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.status(200).json({
      success: true,
      plan: plan.toPublicJSON()
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
    const existingPlan = await Plan.findOne({ code: code.toLowerCase() });
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: 'A plan with this code already exists'
      });
    }

    // Create new plan
    const newPlan = new Plan({
      name,
      code: code.toLowerCase(),
      price,
      currency: currency || 'USD',
      billingCycle: billingCycle || 'monthly',
      features: features || [],
      limits: limits || {},
      credits: credits || {
        totalCredits: 100,
        creditCosts: {
          createJob: 5,
          uploadCandidate: 3,
          scheduleInterview: 2,
          aiMatching: 10,
          generateQuestions: 5,
          aiAnalysis: 8,
          bulkUpload: 2,
          reEmbed: 1
        },
        rolloverEnabled: false,
        rolloverPercentage: 0
      },
      trialDays: trialDays || 0,
      isPublished: isPublished !== undefined ? isPublished : true,
      displayOrder: displayOrder || 0,
      planType: 'organization', // Only organization plans supported now
      isDefault: false, // New plans are never default
      isCustom: true    // New plans are considered custom
    });

    await newPlan.save();

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan: newPlan.toPublicJSON()
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
    const plan = await Plan.findById(req.params.planId);

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
    if (name !== undefined) plan.name = name;
    if (price !== undefined) plan.price = price;
    if (currency !== undefined) plan.currency = currency;
    if (billingCycle !== undefined) plan.billingCycle = billingCycle;
    if (features !== undefined) plan.features = features;
    if (limits !== undefined) plan.limits = limits;
    if (credits !== undefined) plan.credits = credits;
    if (trialDays !== undefined) plan.trialDays = trialDays;
    if (isPublished !== undefined) plan.isPublished = isPublished;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    if (planType !== undefined && planType === 'organization') plan.planType = planType;
    
    // Note: We do not allow changing the code of a plan
    // Note: We do not allow changing isDefault status via this API

    await plan.save();

    res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      plan: plan.toPublicJSON()
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
    const plan = await Plan.findById(req.params.planId);

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
    const usersWithPlan = await User.countDocuments({ 'subscription.plan': plan.code });
    const orgsWithPlan = await Organization.countDocuments({ 'subscription.plan': plan.code });

    if (usersWithPlan > 0 || orgsWithPlan > 0) {
      return res.status(400).json({
        success: false,
        message: 'This plan is currently in use and cannot be deleted',
        usersCount: usersWithPlan,
        organizationsCount: orgsWithPlan
      });
    }

    // Delete the plan
    await Plan.findByIdAndDelete(req.params.planId);

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
    const plan = await Plan.findById(req.params.planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Get counts of users and organizations on this plan
    const usersCount = await User.countDocuments({ 'subscription.plan': plan.code });
    const orgsCount = await Organization.countDocuments({ 'subscription.plan': plan.code });

    res.status(200).json({
      success: true,
      plan: {
        id: plan._id,
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
    const plans = await Plan.find(query).sort({ displayOrder: 1 });

    // Format response for frontend
    const formattedPlans = plans.map(plan => {
      return plan.toPublicJSON();
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

