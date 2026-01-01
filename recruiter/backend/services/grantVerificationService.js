const User = require('../models/User');
const Interview = require('../models/Interview');
const nylasV3Service = require('./nylasV3Service');

class GrantVerificationService {
  constructor() {
    this.nylasService = nylasV3Service;
  }

  /**
   * Verify if a user's grant is still valid
   * @param {string} userId - User ID to check
   * @returns {Object} Verification result with status and details
   */
  async verifyUserGrant(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return {
          valid: false,
          error: 'User not found',
          requiresReauth: false
        };
      }

      if (!user.nylasGrantId) {
        return {
          valid: false,
          error: 'No grant ID found',
          requiresReauth: true,
          user: user
        };
      }

      // Check grant status in our database first
      if (user.nylasGrantStatus && ['expired', 'revoked', 'invalid'].includes(user.nylasGrantStatus)) {
        return {
          valid: false,
          error: `Grant status is ${user.nylasGrantStatus}`,
          requiresReauth: true,
          user: user
        };
      }

      // Verify with Nylas API
      try {
        const grantInfo = await this.nylasService.getGrantInfo(user.nylasGrantId);
        
        if (grantInfo && grantInfo.status === 'valid') {
          // Update user status to valid if it was previously invalid
          if (user.nylasGrantStatus !== 'valid') {
            user.nylasGrantStatus = 'valid';
            user.calendarConnected = true;
            await user.save();
          }
          
          return {
            valid: true,
            grantInfo: grantInfo,
            user: user
          };
        } else {
          // Grant exists but is not valid
          user.nylasGrantStatus = grantInfo?.status || 'invalid';
          user.calendarConnected = false;
          await user.save();
          
          return {
            valid: false,
            error: `Grant status: ${grantInfo?.status || 'invalid'}`,
            requiresReauth: true,
            user: user
          };
        }
      } catch (apiError) {
        console.error('Nylas API error during grant verification:', apiError);
        
        // Check if it's a 404 (grant not found) or 401 (invalid grant)
        if (apiError.status === 404 || apiError.status === 401) {
          user.nylasGrantStatus = 'invalid';
          user.calendarConnected = false;
          await user.save();
          
          return {
            valid: false,
            error: 'Grant not found or invalid in Nylas',
            requiresReauth: true,
            user: user
          };
        }
        
        // For other API errors, assume temporary issue
        return {
          valid: false,
          error: `API verification failed: ${apiError.message}`,
          requiresReauth: false,
          user: user,
          temporaryError: true
        };
      }
    } catch (error) {
      console.error('Error verifying user grant:', error);
      return {
        valid: false,
        error: `Verification error: ${error.message}`,
        requiresReauth: false
      };
    }
  }

  /**
   * Generate a new authentication URL for re-authentication
   * @param {string} userId - User ID
   * @param {string} provider - OAuth provider (default: 'google')
   * @param {boolean} forceAccountSelection - Force account selection (for switching accounts)
   * @returns {Object} Auth URL and state data
   */
  async generateReauthUrl(userId, provider = 'google', forceAccountSelection = false) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Create state data for the OAuth flow
      const stateData = JSON.stringify({
        userId: userId,
        email: user.email,
        isReauth: true,
        forceAccountSelection: forceAccountSelection,
        timestamp: Date.now()
      });

      const authUrl = await this.nylasService.createAuthUrl(stateData, provider, forceAccountSelection);
      
      // Update user status to indicate reauth in progress
      user.nylasGrantStatus = 'reauth_pending';
      await user.save();

      return {
        authUrl: authUrl,
        state: stateData,
        user: user
      };
    } catch (error) {
      console.error('Error generating reauth URL:', error);
      throw error;
    }
  }

  /**
   * Handle the OAuth callback for re-authentication
   * @param {string} code - OAuth authorization code
   * @param {string} state - State data from OAuth flow
   * @returns {Object} Result of the reauth process
   */
  async handleReauthCallback(code, state) {
    try {
      // Parse state data
      const stateData = JSON.parse(state);
      const user = await User.findById(stateData.userId);
      
      if (!user) {
        throw new Error('User not found for reauth callback');
      }

      // Exchange code for new grant
      const grant = await this.nylasService.exchangeCodeForGrant(code);
      
      if (!grant || !grant.grant_id) {
        throw new Error('Failed to obtain new grant');
      }

      // Update user with new grant information
      user.nylasGrantId = grant.grant_id;
      user.nylasGrantStatus = 'valid';
      user.calendarConnected = true;
      user.lastGrantRefresh = new Date();
      await user.save();

      console.log(`✅ Successfully re-authenticated user ${user.email} with new grant ${grant.grant_id}`);

      return {
        success: true,
        user: user,
        grant: grant
      };
    } catch (error) {
      console.error('Error handling reauth callback:', error);
      throw error;
    }
  }

  /**
   * Check and handle expired grants for all users
   * @returns {Object} Summary of verification results
   */
  async verifyAllUserGrants() {
    try {
      const users = await User.find({ 
        nylasGrantId: { $exists: true, $ne: null },
        calendarConnected: true
      });

      const results = {
        total: users.length,
        valid: 0,
        invalid: 0,
        errors: 0,
        invalidUsers: []
      };

      for (const user of users) {
        try {
          const verification = await this.verifyUserGrant(user._id);
          
          if (verification.valid) {
            results.valid++;
          } else {
            results.invalid++;
            if (verification.requiresReauth) {
              results.invalidUsers.push({
                userId: user._id,
                email: user.email,
                error: verification.error
              });
            }
          }
        } catch (error) {
          console.error(`Error verifying grant for user ${user.email}:`, error);
          results.errors++;
        }
      }

      console.log(`Grant verification complete: ${results.valid} valid, ${results.invalid} invalid, ${results.errors} errors`);
      return results;
    } catch (error) {
      console.error('Error verifying all user grants:', error);
      throw error;
    }
  }

  /**
   * Cancel future interviews for users with invalid grants
   * @param {string} userId - User ID
   * @param {string} reason - Cancellation reason
   * @returns {Object} Cancellation results
   */
  async cancelInterviewsForInvalidGrant(userId, reason = 'Calendar access expired - please reconnect') {
    try {
      const cancelledInterviews = await Interview.updateMany(
        { 
          interviewerId: userId,
          status: 'scheduled',
          scheduledAt: { $gte: new Date() }
        },
        { 
          status: 'cancelled',
          cancellationReason: reason,
          cancelledAt: new Date(),
          cancelledBy: userId
        }
      );

      console.log(`Cancelled ${cancelledInterviews.modifiedCount} interviews for user ${userId}`);
      
      return {
        cancelledCount: cancelledInterviews.modifiedCount,
        reason: reason
      };
    } catch (error) {
      console.error('Error cancelling interviews:', error);
      throw error;
    }
  }

  /**
   * Get grant status for a user
   * @param {string} userId - User ID
   * @returns {Object} Grant status information
   */
  async getGrantStatus(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return { status: 'user_not_found' };
      }

      return {
        status: user.nylasGrantStatus || 'no_grant',
        hasGrantId: !!user.nylasGrantId,
        calendarConnected: user.calendarConnected || false,
        lastGrantRefresh: user.lastGrantRefresh,
        lastGrantExpiry: user.lastGrantExpiry,
        lastGrantRevocation: user.lastGrantRevocation
      };
    } catch (error) {
      console.error('Error getting grant status:', error);
      throw error;
    }
  }
}

module.exports = new GrantVerificationService(); 