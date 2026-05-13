const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const mongoose = require('mongoose');

const DEFAULT_ACTION_CREDIT_COSTS = {
  aiInterviewCandidate: 8
};

function normalizeCreditCostOverride(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.ceil(parsed);
}

class CreditsService {
  /**
   * Get organization's current credit status
   * @param {String} organizationId - Organization ID
   * @returns {Object} Credit status with totals, usage, and breakdown
   */
  async getOrganizationCredits(organizationId) {
    try {
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      const creditUsage = organization.subscription?.creditUsage || {};
      const configuredTotalCredits = Math.max(creditUsage.totalCredits || 100, 0);
      const remainingCredits = Math.max(
        0,
        creditUsage.remainingCredits != null ? creditUsage.remainingCredits : configuredTotalCredits
      );
      // Normalize for display/math so usage never becomes contradictory when remaining exceeds plan credits.
      const totalCredits = Math.max(configuredTotalCredits, remainingCredits);
      const usedCredits = Math.max(0, totalCredits - remainingCredits);
      const rolloverCredits = creditUsage.rolloverCredits || 0;

      // Calculate cycle info
      const cycleStart = creditUsage.currentCycleStart || new Date();
      const cycleEnd = creditUsage.currentCycleEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const now = new Date();
      const daysUntilReset = Math.max(
        0,
        Math.ceil((cycleEnd - now) / (1000 * 60 * 60 * 24))
      );

      // Calculate usage breakdown
      const transactions = creditUsage.transactions || [];
      const usageBreakdown = this._calculateUsageBreakdown(transactions);

      // Get credit costs from plan (use plan values, no hardcoded fallbacks)
      const plan = await Plan.findOne({ code: organization.subscription.plan });
      const creditCosts = plan?.credits?.creditCosts || {};

      // Calculate projected runout
      const projectedRunout = this._calculateProjectedRunout(
        remainingCredits,
        transactions,
        cycleEnd
      );

      // Check warnings
      const safeTotalCredits = Math.max(totalCredits, 1);
      const percentageUsed = (usedCredits / safeTotalCredits) * 100;
      const percentageRemaining = (remainingCredits / safeTotalCredits) * 100;
      const warningThreshold = creditUsage.lowCreditWarning?.threshold || 20;
      const lowCreditWarningEnabled = creditUsage.lowCreditWarning?.enabled !== false;
      const warnings = {
        lowCredit: lowCreditWarningEnabled && percentageRemaining <= warningThreshold,
        nearCycleEnd: daysUntilReset <= 5,
        projectedOverage: projectedRunout && projectedRunout < cycleEnd
      };

      return {
        totalCredits,
        configuredTotalCredits,
        usedCredits,
        remainingCredits,
        percentageUsed: Math.round(percentageUsed * 10) / 10,
        percentageRemaining: Math.round(percentageRemaining * 10) / 10,
        cycleStart,
        cycleEnd,
        daysUntilReset,
        rolloverCredits,
        purchasedCredits: this._calculatePurchasedCredits(creditUsage.creditPurchases || []),
        creditCosts,
        usageBreakdown,
        projectedRunout,
        warnings,
        canPurchaseMore: true,
        cycleResetAutomatic: true
      };
    } catch (error) {
      console.error('Error getting organization credits:', error);
      throw error;
    }
  }

  /**
   * Check if organization has sufficient credits for an action
   * @param {String} organizationId - Organization ID
   * @param {String} action - Action name (e.g., 'createJob')
   * @returns {Object} { allowed: Boolean, cost: Number, remaining: Number, message: String }
   */
  async checkSufficientCredits(organizationId, action, options = {}) {
    const timestamp = new Date().toISOString();
    console.log(`🔍 [${timestamp}] Checking credits for action: ${action}, Org: ${organizationId}`);
    
    try {
      // Validate inputs
      if (!organizationId) {
        console.error(`❌ [${timestamp}] Invalid organizationId: ${organizationId}`);
        return { allowed: false, cost: 0, remaining: 0, message: 'Invalid organization ID' };
      }
      
      if (!action || typeof action !== 'string') {
        console.error(`❌ [${timestamp}] Invalid action: ${action}`);
        return { allowed: false, cost: 0, remaining: 0, message: 'Invalid action specified' };
      }
      
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        console.error(`❌ [${timestamp}] Organization not found: ${organizationId}`);
        return { allowed: false, cost: 0, remaining: 0, message: 'Organization not found' };
      }

      // Get credit cost for this action from plan
      const plan = await Plan.findOne({ code: organization.subscription.plan });
      
      if (!plan) {
        console.warn(`⚠️ No plan found for organization ${organizationId}, plan code: ${organization.subscription?.plan}`);
        return { allowed: false, cost: 0, remaining: 0, message: 'No plan configured for organization' };
      }
      
      const creditCosts = plan.credits?.creditCosts || {};
      const configuredCost = creditCosts[action] ?? DEFAULT_ACTION_CREDIT_COSTS[action] ?? 0;
      const cost = normalizeCreditCostOverride(options.creditCostOverride ?? options.costOverride ?? options.cost) ?? configuredCost;

      // If cost is 0 or plan has unlimited credits, allow action
      if (cost === 0 || plan?.credits?.totalCredits === 'unlimited') {
        return { allowed: true, cost: 0, remaining: Infinity, message: 'No credits required' };
      }

      // Initialize credits if not set up yet
      if (!organization.subscription?.creditUsage || organization.subscription.creditUsage.totalCredits === undefined) {
        console.log(`🔧 Auto-initializing credits for organization ${organizationId} from plan ${plan.code}`);
        
        if (!organization.subscription) {
          organization.subscription = {};
        }
        
        organization.subscription.creditUsage = {
          totalCredits: plan.credits.totalCredits,
          usedCredits: 0,
          remainingCredits: plan.credits.totalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [{
            action: 'cycleReset',
            credits: plan.credits.totalCredits,
            timestamp: new Date(),
            balanceAfter: plan.credits.totalCredits,
            metadata: { reason: 'Auto-initialization from plan' }
          }],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
        
        await organization.save();
        console.log(`✅ Credits initialized: ${plan.credits.totalCredits} credits`);
      }

      const creditUsage = organization.subscription.creditUsage;
      const remainingCredits = creditUsage.remainingCredits || 0;
      
      // Validate credit values
      if (remainingCredits < 0) {
        console.error(`❌ [${timestamp}] Negative credits detected: ${remainingCredits} for org ${organizationId}`);
        return { 
          allowed: false, 
          cost, 
          remaining: 0, 
          message: 'Credit balance error: negative credits detected' 
        };
      }
      
      if (cost < 0) {
        console.error(`❌ [${timestamp}] Negative cost detected: ${cost} for action ${action}`);
        return { 
          allowed: false, 
          cost: 0, 
          remaining: remainingCredits, 
          message: 'Invalid action cost configuration' 
        };
      }

      if (remainingCredits >= cost) {
        return {
          allowed: true,
          cost,
          remaining: remainingCredits,
          message: 'Sufficient credits available'
        };
      } else {
        return {
          allowed: false,
          cost,
          remaining: remainingCredits,
          message: `Insufficient credits. Required: ${cost}, Available: ${remainingCredits}`
        };
      }
    } catch (error) {
      console.error('Error checking credits:', error);
      return { allowed: false, cost: 0, remaining: 0, message: error.message };
    }
  }

  /**
   * Consume credits for an action
   * @param {String} organizationId - Organization ID
   * @param {String} action - Action name
   * @param {String} entityId - ID of created entity
   * @param {String} entityType - Type of entity (job, candidate, etc.)
   * @param {String} userId - User who performed the action
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Transaction result
   */
  async consumeCredits(organizationId, action, entityId, entityType, userId, metadata = {}) {
    const timestamp = new Date().toISOString();
    console.log(`💳 [${timestamp}] Consuming credits for action: ${action}, Org: ${organizationId}`);
    
    // Validate inputs before starting transaction
    if (!organizationId || !action || !entityId || !userId) {
      const missingParams = [];
      if (!organizationId) missingParams.push('organizationId');
      if (!action) missingParams.push('action');
      if (!entityId) missingParams.push('entityId');
      if (!userId) missingParams.push('userId');
      
      const errorMsg = `Missing required parameters: ${missingParams.join(', ')}`;
      console.error(`❌ [${timestamp}] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const organization = await Organization.findById(organizationId).session(session);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      // Get credit cost with validation
      const plan = await Plan.findOne({ code: organization.subscription.plan }).session(session);
      
      if (!plan) {
        console.error(`❌ [${timestamp}] No plan found for organization`);
        throw new Error('No plan configured for organization');
      }
      
      const validActions = Object.keys(plan.credits?.creditCosts || {});
      if (!validActions.includes(action)) {
        console.warn(`⚠️ [${timestamp}] Unknown action '${action}'. Valid actions: ${validActions.join(', ')}`);
      }
      
      const configuredCost = plan?.credits?.creditCosts?.[action] ?? DEFAULT_ACTION_CREDIT_COSTS[action] ?? 0;
      const cost = normalizeCreditCostOverride(
        metadata.creditCostOverride ?? metadata.costOverride ?? metadata.overrideCost
      ) ?? configuredCost;

      // Skip if no cost
      if (cost === 0) {
        await session.commitTransaction();
        return { success: true, credits: 0, message: 'No credits required' };
      }

      // Initialize creditUsage if not exists
      if (!organization.subscription.creditUsage) {
        organization.subscription.creditUsage = {
          totalCredits: plan?.credits?.totalCredits || 100,
          usedCredits: 0,
          remainingCredits: plan?.credits?.totalCredits || 100,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
      }

      const creditUsage = organization.subscription.creditUsage;

      // Validate credit values before deduction
      if (creditUsage.remainingCredits < 0) {
        console.error(`❌ [${timestamp}] Negative remaining credits: ${creditUsage.remainingCredits}`);
        await session.abortTransaction();
        return {
          success: false,
          error: 'CREDIT_BALANCE_ERROR',
          message: 'Credit balance error: negative credits detected'
        };
      }
      
      if (cost < 0) {
        console.error(`❌ [${timestamp}] Negative cost: ${cost} for action ${action}`);
        await session.abortTransaction();
        return {
          success: false,
          error: 'INVALID_COST',
          message: 'Invalid cost configuration'
        };
      }
      
      // Check if sufficient credits
      if (creditUsage.remainingCredits < cost) {
        console.log(`⚠️ [${timestamp}] Insufficient credits: Required ${cost}, Available ${creditUsage.remainingCredits}`);
        await session.abortTransaction();
        return {
          success: false,
          error: 'INSUFFICIENT_CREDITS',
          message: `Insufficient credits. Required: ${cost}, Available: ${creditUsage.remainingCredits}`
        };
      }

      // Deduct credits with validation
      creditUsage.usedCredits = (creditUsage.usedCredits || 0) + cost;
      creditUsage.remainingCredits = Math.max(0, creditUsage.remainingCredits - cost);
      
      // Double-check we didn't go negative
      if (creditUsage.remainingCredits < 0) {
        console.error(`❌ [${timestamp}] Credits went negative after deduction!`);
        creditUsage.remainingCredits = 0;
      }

      // Add transaction
      const transaction = {
        action,
        credits: -cost,
        entityId,
        entityType,
        performedBy: userId,
        timestamp: new Date(),
        balanceAfter: creditUsage.remainingCredits,
        metadata
      };

      creditUsage.transactions.push(transaction);

      // Check for low credit warning
      const safeTotalCredits = Math.max(
        creditUsage.totalCredits || 0,
        creditUsage.remainingCredits || 0,
        1
      );
      const percentageRemaining = (creditUsage.remainingCredits / safeTotalCredits) * 100;
      if (percentageRemaining <= (creditUsage.lowCreditWarning?.threshold || 20)) {
        if (creditUsage.lowCreditWarning.enabled) {
          // Mark that warning should be sent
          creditUsage.lowCreditWarning.lastWarningAt = new Date();
          // TODO: Send email notification
        }
      }

      await organization.save({ session });
      await session.commitTransaction();

      // Enhanced logging for credit consumption
      console.log(`💰 Credits Consumed:`, {
        action,
        cost,
        entityType,
        entityId,
        organization: organization.name,
        previousBalance: creditUsage.remainingCredits + cost,
        newBalance: creditUsage.remainingCredits,
        percentageRemaining: (
          (creditUsage.remainingCredits / Math.max(
            creditUsage.totalCredits || 0,
            creditUsage.remainingCredits || 0,
            1
          )) * 100
        ).toFixed(1) + '%'
      });

      return {
        success: true,
        credits: cost,
        balanceAfter: creditUsage.remainingCredits,
        transaction,
        message: `${cost} credits consumed successfully`
      };
    } catch (error) {
      await session.abortTransaction();
      console.error('Error consuming credits:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Add credits to organization (purchase or admin grant)
   * @param {String} organizationId - Organization ID
   * @param {Number} credits - Number of credits to add
   * @param {String} reason - Reason for adding credits
   * @param {String} userId - User who initiated the addition
   * @param {Object} purchaseDetails - Purchase details if applicable
   * @returns {Object} Result
   */
  async addCredits(organizationId, credits, reason, userId, purchaseDetails = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const organization = await Organization.findById(organizationId).session(session);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      if (!organization.subscription.creditUsage) {
        organization.subscription.creditUsage = {
          totalCredits: 100,
          usedCredits: 0,
          remainingCredits: 100,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
      }

      const creditUsage = organization.subscription.creditUsage;

      // Add credits to balance
      creditUsage.remainingCredits += credits;

      // Add transaction
      const transaction = {
        action: purchaseDetails ? 'creditPurchase' : 'creditRefund',
        credits: credits,
        performedBy: userId,
        timestamp: new Date(),
        balanceAfter: creditUsage.remainingCredits,
        metadata: { reason, purchaseDetails }
      };

      creditUsage.transactions.push(transaction);

      // If this is a purchase, add to purchase history
      if (purchaseDetails) {
        creditUsage.creditPurchases.push({
          credits,
          price: purchaseDetails.price,
          currency: purchaseDetails.currency || 'USD',
          purchasedAt: new Date(),
          expiresAt: purchaseDetails.expiresAt || null
        });
      }

      await organization.save({ session });
      await session.commitTransaction();

      console.log(`✅ Credits added: ${credits}, New Balance: ${creditUsage.remainingCredits}`);

      return {
        success: true,
        credits,
        balanceAfter: creditUsage.remainingCredits,
        transaction,
        message: `${credits} credits added successfully`
      };
    } catch (error) {
      await session.abortTransaction();
      console.error('Error adding credits:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reset credits for billing cycle
   * @param {String} organizationId - Organization ID
   * @returns {Object} Reset result
   */
  async resetCycleCredits(organizationId) {
    try {
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      const plan = await Plan.findOne({ code: organization.subscription.plan });
      const totalCredits = plan?.credits?.totalCredits || 100;
      const rolloverEnabled = plan?.credits?.rolloverEnabled || false;
      const rolloverPercentage = plan?.credits?.rolloverPercentage || 0;

      const creditUsage = organization.subscription.creditUsage || {};
      
      // Calculate rollover
      let rolloverCredits = 0;
      if (rolloverEnabled && rolloverPercentage > 0) {
        const unusedCredits = creditUsage.remainingCredits || 0;
        rolloverCredits = Math.floor(unusedCredits * (rolloverPercentage / 100));
      }

      // Reset credits
      organization.subscription.creditUsage = {
        ...creditUsage,
        totalCredits: totalCredits + rolloverCredits,
        usedCredits: 0,
        remainingCredits: totalCredits + rolloverCredits,
        currentCycleStart: new Date(),
        currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        rolloverCredits,
        // Keep transaction history
        transactions: [
          ...(creditUsage.transactions || []),
          {
            action: 'cycleReset',
            credits: totalCredits + rolloverCredits,
            timestamp: new Date(),
            balanceAfter: totalCredits + rolloverCredits,
            metadata: {
              previousCycleUsed: creditUsage.usedCredits || 0,
              rolloverAmount: rolloverCredits
            }
          }
        ]
      };

      await organization.save();

      console.log(`✅ Credits reset for org ${organizationId}: ${totalCredits + rolloverCredits} total`);

      return {
        success: true,
        totalCredits: totalCredits + rolloverCredits,
        rolloverCredits,
        message: 'Credits reset successfully'
      };
    } catch (error) {
      console.error('Error resetting cycle credits:', error);
      throw error;
    }
  }

  /**
   * Get credit transactions with filters
   * @param {String} organizationId - Organization ID
   * @param {Object} filters - Filter options (startDate, endDate, action, limit)
   * @returns {Array} Filtered transactions
   */
  async getCreditTransactions(organizationId, filters = {}) {
    try {
      const organization = await Organization.findById(organizationId)
        .populate('subscription.creditUsage.transactions.performedBy', 'profile.firstName profile.lastName email');
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      let transactions = organization.subscription.creditUsage?.transactions || [];

      // Apply filters
      if (filters.action) {
        transactions = transactions.filter(t => t.action === filters.action);
      }

      if (filters.startDate) {
        const startDate = new Date(filters.startDate);
        transactions = transactions.filter(t => new Date(t.timestamp) >= startDate);
      }

      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        transactions = transactions.filter(t => new Date(t.timestamp) <= endDate);
      }

      // Sort by timestamp (newest first)
      transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Limit results
      if (filters.limit) {
        transactions = transactions.slice(0, filters.limit);
      }

      return transactions;
    } catch (error) {
      console.error('Error getting credit transactions:', error);
      throw error;
    }
  }

  /**
   * Get credit usage analytics
   * @param {String} organizationId - Organization ID
   * @returns {Object} Analytics data
   */
  async getCreditUsageAnalytics(organizationId) {
    try {
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      const creditUsage = organization.subscription.creditUsage || {};
      const transactions = creditUsage.transactions || [];

      // Calculate usage breakdown
      const usageBreakdown = this._calculateUsageBreakdown(transactions);

      // Calculate daily usage trend
      const dailyUsage = this._calculateDailyUsage(transactions);

      // Calculate average daily burn rate
      const avgDailyBurn = this._calculateAverageDailyBurn(transactions);

      // Most expensive actions
      const topActions = Object.entries(usageBreakdown)
        .sort((a, b) => b[1].credits - a[1].credits)
        .slice(0, 5)
        .map(([action, data]) => ({ action, ...data }));

      // Calculate efficiency score (credits per value generated)
      const efficiencyScore = this._calculateEfficiencyScore(usageBreakdown);

      return {
        usageBreakdown,
        dailyUsage,
        avgDailyBurn,
        topActions,
        efficiencyScore,
        totalTransactions: transactions.length,
        periodStart: creditUsage.currentCycleStart,
        periodEnd: creditUsage.currentCycleEnd
      };
    } catch (error) {
      console.error('Error getting credit analytics:', error);
      throw error;
    }
  }

  /**
   * Sync credits from plan to organization
   * @param {String} organizationId - Organization ID
   * @returns {Object} Sync result
   */
  async syncCreditsFromPlan(organizationId) {
    try {
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      const plan = await Plan.findOne({ code: organization.subscription.plan });
      
      if (!plan || !plan.credits) {
        console.log('Plan has no credits configuration, skipping sync');
        return { success: false, message: 'Plan has no credits configuration' };
      }

      // Initialize if doesn't exist
      if (!organization.subscription.creditUsage) {
        organization.subscription.creditUsage = {
          totalCredits: plan.credits.totalCredits,
          usedCredits: 0,
          remainingCredits: plan.credits.totalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };

        await organization.save();
        
        console.log(`✅ Credits initialized from plan for org ${organizationId}`);
        return { success: true, message: 'Credits initialized from plan' };
      }

      return { success: true, message: 'Credits already initialized' };
    } catch (error) {
      console.error('Error syncing credits from plan:', error);
      throw error;
    }
  }

  // Helper methods

  _calculateUsageBreakdown(transactions) {
    const breakdown = {};

    transactions.forEach(transaction => {
      if (transaction.credits < 0) { // Only count usage, not additions
        const action = transaction.action;
        if (!breakdown[action]) {
          breakdown[action] = { count: 0, credits: 0 };
        }
        breakdown[action].count++;
        breakdown[action].credits += Math.abs(transaction.credits);
      }
    });

    return breakdown;
  }

  _calculateDailyUsage(transactions) {
    const dailyUsage = {};

    transactions.forEach(transaction => {
      if (transaction.credits < 0) {
        const date = new Date(transaction.timestamp).toISOString().split('T')[0];
        dailyUsage[date] = (dailyUsage[date] || 0) + Math.abs(transaction.credits);
      }
    });

    return dailyUsage;
  }

  _calculateAverageDailyBurn(transactions) {
    const usageTransactions = transactions.filter(t => t.credits < 0);
    
    if (usageTransactions.length === 0) return 0;

    const totalCreditsUsed = usageTransactions.reduce((sum, t) => sum + Math.abs(t.credits), 0);
    const firstTransaction = usageTransactions[usageTransactions.length - 1];
    const lastTransaction = usageTransactions[0];
    
    const daysDiff = Math.max(
      1,
      Math.ceil((new Date(lastTransaction.timestamp) - new Date(firstTransaction.timestamp)) / (1000 * 60 * 60 * 24))
    );

    return Math.round((totalCreditsUsed / daysDiff) * 10) / 10;
  }

  _calculateProjectedRunout(remainingCredits, transactions, cycleEnd) {
    const avgDailyBurn = this._calculateAverageDailyBurn(transactions);
    
    if (avgDailyBurn === 0) return null;

    const daysUntilRunout = Math.floor(remainingCredits / avgDailyBurn);
    const projectedRunout = new Date(Date.now() + daysUntilRunout * 24 * 60 * 60 * 1000);

    // Only return if runout is before cycle end
    if (projectedRunout < cycleEnd) {
      return projectedRunout;
    }

    return null;
  }

  _calculatePurchasedCredits(purchases) {
    const now = new Date();
    return purchases
      .filter(p => !p.expiresAt || new Date(p.expiresAt) > now)
      .reduce((sum, p) => sum + (p.credits || 0), 0);
  }

  _calculateEfficiencyScore(usageBreakdown) {
    // Simple efficiency score based on action variety
    // More diverse usage = better efficiency
    const actionCount = Object.keys(usageBreakdown).length;
    const maxActions = 8; // Total possible action types
    
    return Math.round((actionCount / maxActions) * 100);
  }
}

module.exports = new CreditsService();

