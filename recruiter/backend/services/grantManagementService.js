const User = require('../models/User');
const nylasV3Service = require('./nylasV3Service');
const multiNylasService = require('./multiNylasService');
const NylasAccount = require('../models/NylasAccount');

/**
 * Grant Management Service
 * Handles Nylas grant lifecycle management with automatic multi-account rotation
 * Now supports multiple Nylas accounts with smart allocation
 */
class GrantManagementService {
  constructor() {
    // Note: MAX_GRANTS is now managed per NylasAccount, not globally
    // This is kept for backward compatibility during migration
    this.MAX_GRANTS_PER_ORG = 2; // Legacy - will be deprecated
  }

  /**
   * Get all users with active grants in an organization
   * @param {string} organizationId - MongoDB Organization ID
   * @returns {Promise<Array>} List of users with grants
   */
  async getOrganizationGrants(organizationId) {
    try {
      const users = await User.find({
        currentOrganization: organizationId,
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true
      })
      .select('email profile.firstName profile.lastName profile.displayName nylasGrantId nylasGrantStatus calendarProvider grantConnectedAt lastGrantRefresh')
      .sort({ grantConnectedAt: 1 }); // Oldest first

      console.log(`📊 Found ${users.length} grants in organization ${organizationId}`);

      return users.map(user => ({
        userId: user._id,
        userName: user.profile?.displayName || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || 'Unknown User',
        email: user.email,
        provider: user.calendarProvider || 'unknown',
        grantId: user.nylasGrantId,
        status: user.nylasGrantStatus || 'unknown',
        connectedAt: user.grantConnectedAt,
        lastRefresh: user.lastGrantRefresh,
        ageInDays: user.grantConnectedAt ? Math.floor((Date.now() - user.grantConnectedAt.getTime()) / (1000 * 60 * 60 * 24)) : null
      }));
    } catch (error) {
      console.error('Error getting organization grants:', error);
      throw error;
    }
  }

  /**
   * Count active grants in an organization
   * @param {string} organizationId - MongoDB Organization ID
   * @returns {Promise<number>} Count of active grants
   */
  async countOrganizationGrants(organizationId) {
    try {
      const count = await User.countDocuments({
        currentOrganization: organizationId,
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true
      });

      console.log(`🔢 Organization ${organizationId} has ${count}/${this.MAX_GRANTS_PER_ORG} grants`);
      return count;
    } catch (error) {
      console.error('Error counting organization grants:', error);
      throw error;
    }
  }

  /**
   * Find the best grant to rotate out across ALL Nylas accounts (system-wide).
   *
   * Selection priority:
   * 1. Users with no upcoming interviews
   * 2. Least recently used grant (lastGrantRefresh, fallback to grantConnectedAt)
   * 3. Oldest connection timestamp as final tiebreaker
   *
   * If every user has upcoming interviews, this still returns the least recently used
   * user so the caller can force-rotate and keep onboarding unblocked.
   *
   * @returns {Promise<Object|null>} Rotation candidate or null when no grants exist
   */
  async findOldestGrantAcrossAllAccounts() {
    try {
      const Interview = require('../models/Interview');
      const now = new Date();
      
      console.log('Searching for least recently used grant across all Nylas accounts...');
      
      const usersWithGrants = await User.find({
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true,
        nylasAccountId: { $exists: true } // Must have an account assigned
      })
      .populate({
        path: 'nylasAccountId',
        select: '+apiKey +clientSecret name clientId region apiUri redirectUri'
      })
      .select('email profile.displayName profile.firstName profile.lastName nylasGrantId nylasAccountId grantConnectedAt lastGrantRefresh updatedAt createdAt');

      if (usersWithGrants.length === 0) {
        console.log('No grants found to rotate');
        return null;
      }

      const candidates = [];

      for (const user of usersWithGrants) {
        const upcomingInterviews = await Interview.countDocuments({
          interviewerId: user._id,
          status: { $in: ['scheduled', 'confirmed'] },
          scheduledAt: { $gte: now }
        });

        const userName = user.profile?.displayName ||
          `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
          'Unknown';
        const accountName = user.nylasAccountId?.name || 'Unknown Account';
        const connectedAt = user.grantConnectedAt || user.updatedAt || user.createdAt || now;
        const lastUsedAt = user.lastGrantRefresh || connectedAt;
        const ageInDays = connectedAt
          ? Math.floor((Date.now() - connectedAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        candidates.push({
          userId: user._id,
          userName,
          email: user.email,
          grantId: user.nylasGrantId,
          nylasAccount: user.nylasAccountId,
          accountName,
          connectedAt,
          lastUsedAt,
          ageInDays,
          upcomingInterviews,
          hasUpcomingInterviews: upcomingInterviews > 0
        });
      }

      const sortByLeastRecentlyUsed = (a, b) => {
        const aLastUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const bLastUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        if (aLastUsed !== bLastUsed) {
          return aLastUsed - bLastUsed;
        }

        const aConnected = a.connectedAt ? new Date(a.connectedAt).getTime() : 0;
        const bConnected = b.connectedAt ? new Date(b.connectedAt).getTime() : 0;
        return aConnected - bConnected;
      };

      const noUpcomingCandidates = candidates
        .filter((candidate) => !candidate.hasUpcomingInterviews)
        .sort(sortByLeastRecentlyUsed);

      if (noUpcomingCandidates.length > 0) {
        const winner = noUpcomingCandidates[0];
        console.log(`Selected inactive grant for rotation: ${winner.email} (account: ${winner.accountName})`);
        return {
          ...winner,
          forcedRemoval: false
        };
      }

      // Fallback: everyone is active, force-rotate least recently used grant to keep onboarding unblocked.
      const forcedWinner = candidates.sort(sortByLeastRecentlyUsed)[0];
      console.warn(`All grants have upcoming interviews. Force-rotating least recently used grant: ${forcedWinner.email}`);

      return {
        ...forcedWinner,
        forcedRemoval: true
      };
    } catch (error) {
      console.error('Error finding rotation candidate:', error);
      throw error;
    }
  }

  /**
   * DEPRECATED: Find oldest grant in an organization
   * Kept for backward compatibility - redirects to multi-account version
   * @param {string} organizationId - MongoDB Organization ID
   * @returns {Promise<Object|null>} Oldest removable grant
   */
  async findOldestGrant(organizationId) {
    console.warn('⚠️ findOldestGrant() is deprecated. Use findOldestGrantAcrossAllAccounts()');
    return await this.findOldestGrantAcrossAllAccounts();
  }

  /**
   * Revoke a grant from Nylas and clear user's calendar connection
   * @param {string} userId - MongoDB User ID
   * @param {string} reason - Reason for revocation
   * @param {boolean} revokeInNylas - Whether to revoke in Nylas (default: true)
   * @returns {Promise<Object>} Revocation result
   */
  async revokeGrant(userId, reason = 'Manual revocation', revokeInNylas = true) {
    try {
      console.log(`🔓 Revoking grant for user ${userId}. Reason: ${reason}`);
      
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      if (!user.nylasGrantId) {
        console.log(`⚠️ User ${user.email} has no grant to revoke`);
        return {
          success: true,
          message: 'User has no active grant',
          alreadyRevoked: true
        };
      }

      const grantId = user.nylasGrantId;
      let nylasRevoked = false;

      // Revoke in Nylas if requested
      if (revokeInNylas) {
        try {
          console.log(`🗑️ Deleting grant ${grantId} from Nylas...`);
          
          // Get account credentials if user has a linked Nylas account
          let accountCredentials = null;
          if (user.nylasAccountId) {
            const NylasAccount = require('../models/NylasAccount');
            const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
            if (nylasAccount) {
              accountCredentials = {
                apiKey: nylasAccount.apiKey,
                region: nylasAccount.region,
                clientId: nylasAccount.clientId
              };
              console.log(`   Using Nylas account: ${nylasAccount.name}`);
            }
          }
          
          await nylasV3Service.deleteGrant(grantId, accountCredentials);
          nylasRevoked = true;
          console.log(`✅ Grant ${grantId} deleted from Nylas`);
        } catch (nylasError) {
          console.error(`❌ Failed to delete grant from Nylas:`, nylasError.message);
          // Continue with database cleanup even if Nylas deletion fails
          // The grant might already be deleted or invalid
          if (nylasError.message.includes('404') || nylasError.message.includes('not found')) {
            console.log('🔍 Grant not found in Nylas (already deleted)');
            nylasRevoked = true; // Consider it revoked if not found
          }
        }
      }

      // Store account ID before clearing
      const nylasAccountId = user.nylasAccountId;
      
      // Clear user's calendar connection data
      user.nylasGrantId = null;
      user.nylasGrantStatus = 'revoked';
      user.calendarConnected = false;
      user.calendarProvider = null;
      user.lastGrantRevocation = new Date();
      // Note: We keep grantConnectedAt and nylasAccountId for historical reference
      
      await user.save();

      // Update the Nylas account's grant count
      if (nylasAccountId) {
        await multiNylasService.updateGrantCount(nylasAccountId);
      }

      console.log(`✅ User ${user.email} calendar connection cleared`);

      return {
        success: true,
        message: `Grant revoked successfully for ${user.email}`,
        userId: user._id,
        email: user.email,
        grantId: grantId,
        revokedInNylas: nylasRevoked,
        reason: reason,
        revokedAt: new Date()
      };
    } catch (error) {
      console.error('Error revoking grant:', error);
      throw error;
    }
  }

  /**
   * Ensure a grant slot is available using multi-account pool.
   * Checks ALL Nylas accounts for space, and if full, rotates out the least
   * recently used grant so a new connection can always proceed.
   * @param {string} organizationId - MongoDB Organization ID (kept for compatibility, not used for account selection)
   * @param {string} newUserEmail - Email of user requesting new grant (for logging)
   * @returns {Promise<Object>} Result of slot management with selected account
   */
  async ensureGrantSlotAvailable(organizationId, newUserEmail = 'unknown') {
    try {
      console.log('\n=== MULTI-ACCOUNT GRANT SLOT MANAGEMENT ===');
      console.log(`New user: ${newUserEmail}`);
      
      // STEP 1: Try to find ANY Nylas account with available space
      const availableAccount = await multiNylasService.findAvailableAccount();
      
      if (availableAccount) {
        console.log(`Found available slot in: ${availableAccount.account.name}`);
        console.log(`   Slots: ${availableAccount.currentGrants}/${availableAccount.account.maxGrants}`);
        console.log('=== END GRANT SLOT MANAGEMENT ===\n');
        
        return {
          slotAvailable: true,
          nylasAccount: availableAccount.account,
          currentCount: availableAccount.currentGrants,
          maxAllowed: availableAccount.account.maxGrants,
          message: `Using ${availableAccount.account.name} (${availableAccount.availableSlots} slots available)`
        };
      }

      // findAvailableAccount() also returns null when the provider pool is not
      // configured. Distinguish that operational state from a genuinely full
      // pool before attempting to rotate an existing grant.
      const activeAccounts = await NylasAccount.find({
        active: true,
        verified: true
      }).select('name maxGrants');
      const totalCapacity = activeAccounts.reduce(
        (sum, account) => sum + Math.max(0, Number(account.maxGrants) || 0),
        0
      );

      if (activeAccounts.length === 0) {
        const configurationError = new Error(
          'Calendar connections are temporarily unavailable because no active, verified calendar provider account is configured.'
        );
        configurationError.code = 'NO_NYLAS_ACCOUNT';
        configurationError.statusCode = 503;
        throw configurationError;
      }

      if (totalCapacity === 0) {
        const capacityError = new Error(
          'Calendar connections are temporarily unavailable because calendar provider capacity is not configured.'
        );
        capacityError.code = 'NO_CALENDAR_CAPACITY';
        capacityError.statusCode = 503;
        throw capacityError;
      }

      // STEP 2: All accounts full - rotate out least recently used grant
      const systemCapacity = await multiNylasService.getSystemCapacity();
      console.log('All Nylas accounts are at capacity. Running LRU rotation...');
      console.log(`   System total: ${systemCapacity.totalUsed}/${systemCapacity.totalMax} across ${systemCapacity.accountCount} account(s)`);

      const rotationCandidate = await this.findOldestGrantAcrossAllAccounts();
      
      if (!rotationCandidate) {
        console.error(`Calendar pool reports ${totalCapacity} slots across ${activeAccounts.length} active account(s), but no active grant is eligible for rotation.`);
        const consistencyError = new Error(
          'Calendar capacity could not be reconciled with active connections. Please contact support.'
        );
        consistencyError.code = 'GRANT_COUNT_OUT_OF_SYNC';
        consistencyError.statusCode = 409;
        throw consistencyError;
      }

      const connectedAtText = rotationCandidate.connectedAt
        ? new Date(rotationCandidate.connectedAt).toISOString()
        : 'unknown';
      const lastUsedAtText = rotationCandidate.lastUsedAt
        ? new Date(rotationCandidate.lastUsedAt).toISOString()
        : 'unknown';

      console.log('Removing grant to make room...');
      console.log(`   User: ${rotationCandidate.userName} (${rotationCandidate.email})`);
      console.log(`   Account: ${rotationCandidate.accountName}`);
      console.log(`   Last used: ${lastUsedAtText}`);
      console.log(`   Connected: ${connectedAtText}`);
      console.log(`   Upcoming interviews: ${rotationCandidate.upcomingInterviews}`);
      console.log(`   Forced rotation: ${rotationCandidate.forcedRemoval ? 'yes' : 'no'}`);

      const revocationReason = rotationCandidate.forcedRemoval
        ? `Automatic forced LRU removal: Capacity full, rotating out ${rotationCandidate.email} (has upcoming interviews) for ${newUserEmail}`
        : `Automatic LRU removal: Capacity full, rotating out inactive grant ${rotationCandidate.email} for ${newUserEmail}`;

      const revocationResult = await this.revokeGrant(
        rotationCandidate.userId,
        revocationReason,
        true // Revoke in Nylas
      );

      console.log(`Successfully removed grant from ${rotationCandidate.accountName}`);
      console.log(`Slot now available in: ${rotationCandidate.accountName}`);
      console.log('=== END GRANT SLOT MANAGEMENT ===\n');

      return {
        slotAvailable: true,
        nylasAccount: rotationCandidate.nylasAccount,
        removedGrant: {
          userId: rotationCandidate.userId,
          userName: rotationCandidate.userName,
          email: rotationCandidate.email,
          accountName: rotationCandidate.accountName,
          ageInDays: rotationCandidate.ageInDays,
          connectedAt: rotationCandidate.connectedAt,
          lastUsedAt: rotationCandidate.lastUsedAt,
          upcomingInterviews: rotationCandidate.upcomingInterviews,
          forcedRemoval: Boolean(rotationCandidate.forcedRemoval),
          revocationDetails: revocationResult
        },
        systemCapacity,
        message: rotationCandidate.forcedRemoval
          ? `Capacity full. Force-rotated least recently used grant (${rotationCandidate.userName}) from ${rotationCandidate.accountName} to allow new connection.`
          : `Least recently used inactive grant (${rotationCandidate.userName}) was removed from ${rotationCandidate.accountName} to make room for new connection.`,
        autoRemovalPerformed: true,
        forcedRotation: Boolean(rotationCandidate.forcedRemoval),
        removalType: rotationCandidate.forcedRemoval ? 'forced' : 'safe'
      };
    } catch (error) {
      console.error('Error ensuring grant slot available:', error);
      throw error;
    }
  }

  /**
   * Get live system-wide capacity using the same rules as account allocation.
   * This is safe for authenticated users and intentionally omits other users'
   * grant details because the Nylas pool spans organizations.
   */
  async getSystemGrantUsageStats() {
    const accounts = await NylasAccount.find({
      active: true,
      verified: true
    }).select('_id maxGrants');

    const usage = await Promise.all(accounts.map(async (account) => {
      const currentCount = await User.countDocuments({
        nylasAccountId: account._id,
        calendarConnected: true,
        nylasGrantId: { $exists: true, $ne: null }
      });
      const maxAllowed = Math.max(0, Number(account.maxGrants) || 0);
      return { currentCount, maxAllowed };
    }));

    const currentCount = usage.reduce((sum, account) => sum + account.currentCount, 0);
    const maxAllowed = usage.reduce((sum, account) => sum + account.maxAllowed, 0);
    const availableSlots = Math.max(0, maxAllowed - currentCount);

    return {
      currentCount,
      maxAllowed,
      availableSlots,
      utilizationPercentage: maxAllowed > 0
        ? Math.round((currentCount / maxAllowed) * 100)
        : 0,
      atLimit: accounts.length > 0 && maxAllowed > 0 && availableSlots === 0,
      configured: accounts.length > 0 && maxAllowed > 0,
      accountCount: accounts.length
    };
  }

  /**
   * Get grant usage statistics for an organization
   * @param {string} organizationId - MongoDB Organization ID
   * @returns {Promise<Object>} Usage statistics
   */
  async getGrantUsageStats(organizationId) {
    try {
      const currentCount = await this.countOrganizationGrants(organizationId);
      const grants = await this.getOrganizationGrants(organizationId);
      
      return {
        currentCount,
        maxAllowed: this.MAX_GRANTS_PER_ORG,
        availableSlots: Math.max(0, this.MAX_GRANTS_PER_ORG - currentCount),
        utilizationPercentage: Math.round((currentCount / this.MAX_GRANTS_PER_ORG) * 100),
        atLimit: currentCount >= this.MAX_GRANTS_PER_ORG,
        grants: grants,
        oldestGrant: grants.length > 0 ? grants[0] : null, // Already sorted by age
        newestGrant: grants.length > 0 ? grants[grants.length - 1] : null
      };
    } catch (error) {
      console.error('Error getting grant usage stats:', error);
      throw error;
    }
  }

  /**
   * Verify all grants in an organization are still valid in Nylas
   * @param {string} organizationId - MongoDB Organization ID
   * @returns {Promise<Object>} Verification results
   */
  async verifyOrganizationGrants(organizationId) {
    try {
      console.log(`🔍 Verifying all grants for organization ${organizationId}...`);
      
      const users = await User.find({
        currentOrganization: organizationId,
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true
      });

      const results = {
        total: users.length,
        valid: 0,
        invalid: 0,
        errors: 0,
        details: []
      };

      for (const user of users) {
        try {
          // Get account credentials if user has a linked Nylas account
          let accountCredentials = null;
          if (user.nylasAccountId) {
            const NylasAccount = require('../models/NylasAccount');
            const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
            if (nylasAccount) {
              accountCredentials = {
                apiKey: nylasAccount.apiKey,
                region: nylasAccount.region,
                clientId: nylasAccount.clientId
              };
            }
          }
          
          const verification = await nylasV3Service.verifyGrantStatus(user.nylasGrantId, accountCredentials);
          
          if (verification.valid) {
            results.valid++;
            
            // Update status if needed
            if (user.nylasGrantStatus !== 'active') {
              user.nylasGrantStatus = 'active';
              await user.save();
            }
          } else {
            results.invalid++;
            
            // Update status
            user.nylasGrantStatus = 'invalid';
            user.calendarConnected = false;
            await user.save();
          }

          results.details.push({
            userId: user._id,
            email: user.email,
            grantId: user.nylasGrantId,
            valid: verification.valid,
            status: verification.status
          });
        } catch (error) {
          results.errors++;
          results.details.push({
            userId: user._id,
            email: user.email,
            error: error.message
          });
        }
      }

      console.log(`✅ Verification complete: ${results.valid} valid, ${results.invalid} invalid, ${results.errors} errors`);
      return results;
    } catch (error) {
      console.error('Error verifying organization grants:', error);
      throw error;
    }
  }
}

module.exports = new GrantManagementService();
