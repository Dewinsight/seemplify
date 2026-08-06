const Plan = require('../models/Plan');

/**
 * Get plan details by plan code
 * @param {string} planCode - The plan code to fetch
 * @returns {Object} Plan details with limits
 */
const getPlanByCode = async (planCode) => {
  if (!planCode) {
    // Return default free plan limits if no plan code
    return {
      code: 'free',
      name: 'Free',
      limits: {
        memberLimit: 5
      }
    };
  }

  try {
    const plan = await Plan.findOne({ 
      code: planCode.toLowerCase(),
      isPublished: true
    });

    if (!plan) {
      console.warn(`Plan not found for code: ${planCode}, returning default free plan`);
      return {
        code: 'free',
        name: 'Free',
        limits: {
          memberLimit: 5,
          jobLimit: 10,
          candidateLimit: 100
        }
      };
    }

    return {
      code: plan.code,
      name: plan.name,
      limits: {
        memberLimit: plan.limits.memberLimit === 'unlimited' ? 999999 : (plan.limits.memberLimit || 5)
      },
      features: plan.features,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle
    };
  } catch (error) {
    console.error(`Error fetching plan ${planCode}:`, error);
    // Return default on error
    return {
      code: 'free',
      name: 'Free',
      limits: {
        memberLimit: 5
      }
    };
  }
};

/**
 * Get multiple plans by codes
 * @param {Array<string>} planCodes - Array of plan codes
 * @returns {Object} Object with plan codes as keys and plan details as values
 */
const getPlansByCode = async (planCodes) => {
  const plans = {};
  const uniqueCodes = [...new Set(planCodes)]; // Remove duplicates

  await Promise.all(
    uniqueCodes.map(async (planCode) => {
      plans[planCode] = await getPlanByCode(planCode);
    })
  );

  return plans;
};

/**
 * Enhance organization with plan details
 * @param {Object} organization - Organization object
 * @returns {Object} Organization with enhanced plan details
 */
const enhanceOrganizationWithPlan = async (organization) => {
  const planCode = organization.subscription?.plan;
  const planDetails = await getPlanByCode(planCode);

  return {
    ...organization,
    subscription: {
      ...organization.subscription,
      plan: planDetails.code,
      planName: planDetails.name,
      memberLimit: planDetails.limits.memberLimit,
      features: planDetails.features,
      price: planDetails.price,
      currency: planDetails.currency,
      billingCycle: planDetails.billingCycle
    }
  };
};

module.exports = {
  getPlanByCode,
  getPlansByCode,
  enhanceOrganizationWithPlan
};
