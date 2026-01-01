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
   * Find the oldest grant across ALL Nylas accounts (system-wide)
   * Skips users with upcoming interviews
   * @returns {Promise<Object|null>} Oldest removable grant or null if all users have upcoming interviews
   */
  async findOldestGrantAcrossAllAccounts() {
    try {
      const Interview = require('../models/Interview');
      const now = new Date();
      
      console.log(`🔍 Finding oldest removable grant across ALL Nylas accounts (system-wide)...`);
      
      // Get all users with grants across ALL accounts, sorted by oldest first
      const usersWithGrants = await User.find({
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true,
        grantConnectedAt: { $exists: true },
        nylasAccountId: { $exists: true } // Must have an account assigned
      })
      .populate({
        path: 'nylasAccountId',
        select: '+apiKey +clientSecret name clientId region apiUri redirectUri'
      })
      .sort({ grantConnectedAt: 1 }) // Oldest first globally
      .select('email profile.displayName profile.firstName profile.lastName nylasGrantId nylasAccountId grantConnectedAt');

      if (usersWithGrants.length === 0) {
        console.log('⚠️ No grants with timestamps found');
        return null;
      }

      console.log(`📊 Found ${usersWithGrants.length} users with grants. Checking for upcoming interviews...`);

      // Find the oldest user WITHOUT upcoming interviews
      for (const user of usersWithGrants) {
        // Check if this user has any upcoming interviews
        const upcomingInterviews = await Interview.countDocuments({
          interviewerId: user._id,
          status: { $in: ['scheduled', 'confirmed'] },
          scheduledAt: { $gte: now }
        });

        if (upcomingInterviews === 0) {
          // This user has no upcoming interviews - safe to remove
          const userName = user.profile?.displayName || 
            `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || 'Unknown';
          const daysOld = Math.floor((Date.now() - user.grantConnectedAt.getTime()) / (1000 * 60 * 60 * 24));
          const accountName = user.nylasAccountId?.name || 'Unknown Account';
          
          console.log(`✅ Found removable grant: ${userName} (${user.email})`);
          console.log(`   Account: ${accountName}`);
          console.log(`   Age: ${daysOld} days, No upcoming interviews`);
          
          return {
            userId: user._id,
            userName,
            email: user.email,
            grantId: user.nylasGrantId,
            nylasAccount: user.nylasAccountId,
            accountName,
            connectedAt: user.grantConnectedAt,
            ageInDays: daysOld,
            hasUpcomingInterviews: false
          };
        } else {
          console.log(`⏭️  Skipping ${user.email} - has ${upcomingInterviews} upcoming interview(s)`);
        }
      }

      // If we get here, ALL users have upcoming interviews
      console.warn('⚠️ ALL USERS HAVE UPCOMING INTERVIEWS - Cannot remove any grant!');
      
      return {
        allUsersActive: true,
        totalUsers: usersWithGrants.length,
        message: 'All calendar slots are occupied by users with upcoming interviews'
      };
    } catch (error) {
      console.error('Error finding oldest grant:', error);
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
   * Ensure a grant slot is available using multi-account pool
   * Checks ALL Nylas accounts for space, applies rotation with interview protection if all full
   * @param {string} organizationId - MongoDB Organization ID (kept for compatibility, not used for account selection)
   * @param {string} newUserEmail - Email of user requesting new grant (for logging)
   * @returns {Promise<Object>} Result of slot management with selected account
   */
  async ensureGrantSlotAvailable(organizationId, newUserEmail = 'unknown') {
    try {
      console.log(`\n🎰 === MULTI-ACCOUNT GRANT SLOT MANAGEMENT ===`);
      console.log(`New user: ${newUserEmail}`);
      
      // STEP 1: Try to find ANY Nylas account with available space
      const availableAccount = await multiNylasService.findAvailableAccount();
      
      if (availableAccount) {
        console.log(`✅ Found available slot in: ${availableAccount.account.name}`);
        console.log(`   Slots: ${availableAccount.currentGrants}/${availableAccount.account.maxGrants}`);
        console.log(`=== END GRANT SLOT MANAGEMENT ===\n`);
        
        return {
          slotAvailable: true,
          nylasAccount: availableAccount.account,
          currentCount: availableAccount.currentGrants,
          maxAllowed: availableAccount.account.maxGrants,
          message: `Using ${availableAccount.account.name} (${availableAccount.availableSlots} slots available)`
        };
      }

      // STEP 2: All accounts full - get total capacity and try rotation
      const systemCapacity = await multiNylasService.getSystemCapacity();
      console.log(`⚠️ All Nylas accounts at capacity!`);
      console.log(`   System total: ${systemCapacity.totalUsed}/${systemCapacity.totalMax} across ${systemCapacity.accountCount} account(s)`);
      console.log(`   Attempting auto-rotation with interview protection...`);
      
      // Find oldest grant across ALL accounts with interview protection
      const oldestGrant = await this.findOldestGrantAcrossAllAccounts();
      
      if (!oldestGrant) {
        console.error('❌ No grants found to remove despite system being at capacity!');
        throw new Error('Grant count inconsistency detected. Please contact support.');
      }

      // Check if all users have upcoming interviews
      if (oldestGrant.allUsersActive) {
        console.warn(`🚫 CANNOT REMOVE ANY GRANT - All ${oldestGrant.totalUsers} users have upcoming interviews`);
        console.log(`❌ Denying calendar connection for ${newUserEmail}`);
        console.log(`=== END GRANT SLOT MANAGEMENT ===\n`);
        
        // Return error state - caller should handle this
        const error = new Error('GRANT_SLOTS_FULL');
        error.code = 'GRANT_SLOTS_FULL';
        error.details = {
          systemCapacity: systemCapacity.totalMax,
          systemUsed: systemCapacity.totalUsed,
          accountCount: systemCapacity.accountCount,
          allUsersActive: true,
          totalUsers: oldestGrant.totalUsers,
          message: `All ${systemCapacity.totalMax} calendar slots across ${systemCapacity.accountCount} Nylas account(s) are occupied by users with upcoming interviews. Please contact your administrator to add more accounts or wait for a slot to become available.`
        };
        throw error;
      }

      console.log(`🗑️ Removing oldest grant to make room...`);
      console.log(`   User: ${oldestGrant.userName} (${oldestGrant.email})`);
      console.log(`   Account: ${oldestGrant.accountName}`);
      console.log(`   Age: ${oldestGrant.ageInDays} days`);
      console.log(`   Connected: ${oldestGrant.connectedAt.toISOString()}`);

      const revocationResult = await this.revokeGrant(
        oldestGrant.userId,
        `Automatic removal: All ${systemCapacity.accountCount} Nylas accounts full. Making room for ${newUserEmail}`,
        true // Revoke in Nylas
      );

      console.log(`✅ Successfully removed oldest grant`);
      console.log(`🎉 Slot now available in: ${oldestGrant.accountName}`);
      console.log(`=== END GRANT SLOT MANAGEMENT ===\n`);

      return {
        slotAvailable: true,
        nylasAccount: oldestGrant.nylasAccount,
        removedGrant: {
          userId: oldestGrant.userId,
          userName: oldestGrant.userName,
          email: oldestGrant.email,
          accountName: oldestGrant.accountName,
          ageInDays: oldestGrant.ageInDays,
          connectedAt: oldestGrant.connectedAt,
          revocationDetails: revocationResult
        },
        systemCapacity,
        message: `Oldest grant (${oldestGrant.userName}) automatically removed from ${oldestGrant.accountName} to make room for new connection.`,
        autoRemovalPerformed: true
      };
    } catch (error) {
      console.error('❌ Error ensuring grant slot available:', error);
      throw error;
    }
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
