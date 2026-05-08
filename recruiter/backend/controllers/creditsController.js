const creditsService = require('../services/creditsService');
const User = require('../models/User');

const DEFAULT_CREDIT_COSTS = {
  createJob: 0,
  uploadCandidate: 0,
  scheduleInterview: 0,
  aiMatching: 0,
  generateQuestions: 0,
  aiAnalysis: 0,
  aiInterviewCandidate: 5,
  bulkUpload: 0,
  reEmbed: 0
};

const buildDefaultCreditStatus = () => {
  const cycleStart = new Date();
  const cycleEnd = new Date(cycleStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    totalCredits: 0,
    usedCredits: 0,
    remainingCredits: 0,
    percentageUsed: 0,
    cycleStart,
    cycleEnd,
    daysUntilReset: 30,
    rolloverCredits: 0,
    purchasedCredits: 0,
    creditCosts: { ...DEFAULT_CREDIT_COSTS },
    usageBreakdown: {},
    projectedRunout: null,
    warnings: {
      lowCredit: false,
      nearCycleEnd: false,
      projectedOverage: false
    },
    canPurchaseMore: true,
    cycleResetAutomatic: true
  };
};

const buildDefaultCreditAnalytics = () => {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    usageBreakdown: {},
    dailyUsage: [],
    avgDailyBurn: 0,
    topActions: [],
    efficiencyScore: 0,
    totalTransactions: 0,
    periodStart,
    periodEnd
  };
};

const resolveCurrentOrganization = async (req) => {
  let organizationId = req.user?.currentOrganization;

  if (organizationId) {
    return organizationId;
  }

  if (!req.user?.id) {
    return null;
  }

  const user = await User.findById(req.user.id).select('currentOrganization organizationMemberships hasCompletedOrganizationSetup');
  if (!user) {
    return null;
  }

  if (user.currentOrganization) {
    req.user.currentOrganization = user.currentOrganization;
    return user.currentOrganization;
  }

  const activeMembership = user.organizationMemberships?.find((membership) => membership.isActive);
  if (activeMembership?.organization) {
    user.currentOrganization = activeMembership.organization;
    user.hasCompletedOrganizationSetup = true;
    await user.save();
    req.user.currentOrganization = user.currentOrganization;
    return user.currentOrganization;
  }

  return null;
};

/**
 * Get current credit status for organization
 */
exports.getCreditStatus = async (req, res) => {
  try {
    const organizationId = await resolveCurrentOrganization(req);
    
    if (!organizationId) {
      return res.json({
        success: true,
        credits: buildDefaultCreditStatus(),
        message: 'No organization selected',
        requiresOrganizationSetup: true
      });
    }

    const creditStatus = await creditsService.getOrganizationCredits(organizationId);
    
    res.json({
      success: true,
      credits: creditStatus
    });
  } catch (error) {
    console.error('Error getting credit status:', error);
    if (error.message === 'Organization not found') {
      return res.json({
        success: true,
        credits: buildDefaultCreditStatus(),
        message: 'Organization not found',
        requiresOrganizationSetup: true
      });
    }

    res.status(500).json({
      error: 'Failed to get credit status',
      message: error.message
    });
  }
};

/**
 * Get credit transaction history
 */
exports.getCreditTransactions = async (req, res) => {
  try {
    const organizationId = await resolveCurrentOrganization(req);
    const { action, startDate, endDate, limit = 50 } = req.query;
    
    if (!organizationId) {
      return res.json({
        success: true,
        transactions: [],
        count: 0,
        message: 'No organization selected',
        requiresOrganizationSetup: true
      });
    }

    const transactions = await creditsService.getCreditTransactions(organizationId, {
      action,
      startDate,
      endDate,
      limit: parseInt(limit)
    });
    
    res.json({
      success: true,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Error getting credit transactions:', error);
    if (error.message === 'Organization not found') {
      return res.json({
        success: true,
        transactions: [],
        count: 0,
        message: 'Organization not found',
        requiresOrganizationSetup: true
      });
    }

    res.status(500).json({
      error: 'Failed to get credit transactions',
      message: error.message
    });
  }
};

/**
 * Get credit usage analytics
 */
exports.getCreditAnalytics = async (req, res) => {
  try {
    const organizationId = await resolveCurrentOrganization(req);
    
    if (!organizationId) {
      return res.json({
        success: true,
        analytics: buildDefaultCreditAnalytics(),
        message: 'No organization selected',
        requiresOrganizationSetup: true
      });
    }

    const analytics = await creditsService.getCreditUsageAnalytics(organizationId);
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error getting credit analytics:', error);
    if (error.message === 'Organization not found') {
      return res.json({
        success: true,
        analytics: buildDefaultCreditAnalytics(),
        message: 'Organization not found',
        requiresOrganizationSetup: true
      });
    }

    res.status(500).json({
      error: 'Failed to get credit analytics',
      message: error.message
    });
  }
};

/**
 * Purchase additional credit pack
 */
exports.purchaseCredits = async (req, res) => {
  try {
    const organizationId = await resolveCurrentOrganization(req);
    const { packId, credits, price, currency = 'USD' } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({
        error: 'Organization context required'
      });
    }

    if (!credits || credits <= 0) {
      return res.status(400).json({
        error: 'Invalid credit amount'
      });
    }

    // TODO: Integrate with payment processor here
    // For now, just add the credits
    
    const result = await creditsService.addCredits(
      organizationId,
      credits,
      'Credit pack purchase',
      req.user.id,
      {
        packId,
        price,
        currency,
        expiresAt: null // Purchased credits don't expire
      }
    );
    
    res.json({
      success: true,
      message: `Successfully purchased ${credits} credits`,
      ...result
    });
  } catch (error) {
    console.error('Error purchasing credits:', error);
    res.status(500).json({
      error: 'Failed to purchase credits',
      message: error.message
    });
  }
};

/**
 * Get available credit packs for purchase
 */
exports.getCreditPacks = async (req, res) => {
  try {
    const creditPacks = [
      {
        id: 'small',
        name: 'Small Boost',
        credits: 50,
        price: 25,
        currency: 'USD',
        pricePerCredit: 0.50,
        savings: 0,
        bestFor: 'Occasional overage'
      },
      {
        id: 'medium',
        name: 'Medium Pack',
        credits: 150,
        price: 60,
        currency: 'USD',
        pricePerCredit: 0.40,
        savings: 15,
        bestFor: 'Regular top-ups',
        popular: true
      },
      {
        id: 'large',
        name: 'Large Pack',
        credits: 500,
        price: 175,
        currency: 'USD',
        pricePerCredit: 0.35,
        savings: 75,
        bestFor: 'Heavy users'
      },
      {
        id: 'mega',
        name: 'Mega Pack',
        credits: 1000,
        price: 300,
        currency: 'USD',
        pricePerCredit: 0.30,
        savings: 200,
        bestFor: 'Enterprise needs'
      }
    ];
    
    res.json({
      success: true,
      packs: creditPacks
    });
  } catch (error) {
    console.error('Error getting credit packs:', error);
    res.status(500).json({
      error: 'Failed to get credit packs',
      message: error.message
    });
  }
};

/**
 * Admin: Manually adjust organization credits
 */
exports.adjustCredits = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { credits, reason } = req.body;
    
    if (!credits || credits === 0) {
      return res.status(400).json({
        error: 'Invalid credit amount'
      });
    }

    if (!reason) {
      return res.status(400).json({
        error: 'Reason is required for manual credit adjustment'
      });
    }

    const result = await creditsService.addCredits(
      organizationId,
      credits,
      `Admin adjustment: ${reason}`,
      req.admin.id,
      null
    );
    
    res.json({
      success: true,
      message: `Credits adjusted by ${credits}`,
      ...result
    });
  } catch (error) {
    console.error('Error adjusting credits:', error);
    res.status(500).json({
      error: 'Failed to adjust credits',
      message: error.message
    });
  }
};

/**
 * Admin: Reset cycle credits for organization
 */
exports.resetCycleCredits = async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const result = await creditsService.resetCycleCredits(organizationId);
    
    res.json({
      success: true,
      message: 'Credits reset successfully',
      ...result
    });
  } catch (error) {
    console.error('Error resetting credits:', error);
    res.status(500).json({
      error: 'Failed to reset credits',
      message: error.message
    });
  }
};

module.exports = exports;

