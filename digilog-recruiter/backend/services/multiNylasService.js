const prisma = require('../db/client');
const nylasV3Service = require('./nylasV3Service');

/**
 * Multi-Nylas Service
 * Manages multiple Nylas accounts and handles smart allocation
 * Accounts are system-wide (not per-organization)
 */
class MultiNylasService {
  
  /**
   * Find Nylas account with available grant slots
   * Accounts are prioritized by: priority (desc), then creation date (asc)
   * @returns {Promise<Object|null>} Available account with credentials or null
   */
  async findAvailableAccount() {
    try {
      console.log('🔍 Searching for Nylas account with available slots...');
      
      // Get all active, verified accounts sorted by priority
      const accounts = await prisma.nylasAccount.findMany({
        where: { active: true, verified: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] // High priority first, then oldest
      });

      if (accounts.length === 0) {
        console.warn('⚠️ No active Nylas accounts found!');
        return null;
      }
      
      console.log(`📊 Found ${accounts.length} active account(s)`);
      
      // Check each account for available slots
      for (const account of accounts) {
        // Get real-time grant count for this account
        const grantCount = await prisma.user.count({
          where: {
            nylasAccountId: account.id,
            calendarConnected: true,
            nylasGrantId: { not: null }
          }
        });

        const availableSlots = account.maxGrants - grantCount;

        if (availableSlots > 0) {
          console.log(`✅ Found available account: ${account.name}`);
          console.log(`   Current: ${grantCount}/${account.maxGrants} grants`);
          console.log(`   Available: ${availableSlots} slot(s)`);

          // Update the current count
          account.currentGrantCount = grantCount;
          account.lastUsed = new Date();
          await prisma.nylasAccount.update({ where: { id: account.id }, data: { currentGrantCount: grantCount, lastUsed: account.lastUsed } });

          return {
            account,
            currentGrants: grantCount,
            availableSlots,
            credentials: {
              apiKey: account.apiKey,
              clientId: account.clientId,
              clientSecret: account.clientSecret,
              region: account.region,
              apiUri: account.apiUri
              // redirectUri removed - always use configLoader for dynamic environment-based URL
            }
          };
        } else {
          console.log(`⏭️ Account full: ${account.name} (${grantCount}/${account.maxGrants})`);
        }
      }
      
      console.warn('⚠️ All Nylas accounts are at capacity!');
      return null;
    } catch (error) {
      console.error('Error finding available account:', error);
      throw error;
    }
  }
  
  /**
   * Get total system capacity across all accounts
   * @returns {Promise<Object>} System capacity statistics
   */
  async getSystemCapacity() {
    try {
      // Inlined from the former NylasAccount.getSystemCapacity() static method.
      const accounts = await prisma.nylasAccount.findMany({ where: { active: true } });

      const totalMax = accounts.reduce((sum, acc) => sum + (acc.maxGrants || 0), 0);
      const totalUsed = accounts.reduce((sum, acc) => sum + (acc.currentGrantCount || 0), 0);

      const capacity = {
        totalMax,
        totalUsed,
        availableSlots: totalMax - totalUsed,
        accountCount: accounts.length,
        utilizationPercentage: totalMax > 0 ? Math.round((totalUsed / totalMax) * 100) : 0
      };

      console.log(`📊 System Capacity: ${capacity.totalUsed}/${capacity.totalMax} grants (${capacity.utilizationPercentage}%)`);

      return capacity;
    } catch (error) {
      console.error('Error getting system capacity:', error);
      throw error;
    }
  }
  
  /**
   * Get all active accounts with their usage
   * @returns {Promise<Array>} List of accounts with usage stats
   */
  async getAllAccountsWithUsage() {
    try {
      const accounts = await prisma.nylasAccount.findMany({
        where: { active: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
      });

      // Track if we found a preferred account yet
      let preferredAccountFound = false;
      
      const accountsWithUsage = await Promise.all(
        accounts.map(async (account) => {
          const grantCount = await prisma.user.count({
            where: {
              nylasAccountId: account.id,
              calendarConnected: true,
              nylasGrantId: { not: null }
            }
          });

          const availableSlots = account.maxGrants - grantCount;
          
          // An account is preferred if:
          // 1. It's active and verified
          // 2. It has available slots
          // 3. No higher priority account has been marked as preferred yet
          const isPreferred = !preferredAccountFound && 
                              account.verified && 
                              availableSlots > 0;
                              
          // Update tracker if this is preferred
          if (isPreferred) {
            preferredAccountFound = true;
          }
          
          return {
            _id: account._id,
            name: account.name,
            clientId: account.clientId,
            region: account.region,
            maxGrants: account.maxGrants,
            currentGrantCount: grantCount,
            availableSlots: availableSlots,
            utilizationPercentage: Math.round((grantCount / account.maxGrants) * 100),
            active: account.active,
            verified: account.verified,
            accountType: account.accountType,
            priority: account.priority,
            lastUsed: account.lastUsed,
            lastVerified: account.lastVerified,
            notes: account.notes,
            createdAt: account.createdAt,
            isPreferred: isPreferred // New field indicating if this is the preferred account
          };
        })
      );
      
      return accountsWithUsage;
    } catch (error) {
      console.error('Error getting accounts with usage:', error);
      throw error;
    }
  }
  
  /**
   * Test Nylas account credentials
   * @param {Object} credentials - Account credentials to test
   * @returns {Promise<Object>} Test result
   */
  async testCredentials(credentials) {
    try {
      console.log(`🧪 Testing Nylas credentials for Client ID: ${credentials.clientId.substring(0, 20)}...`);
      
      const https = require('https');
      
      return await new Promise((resolve, reject) => {
        const options = {
          hostname: `api.${credentials.region || 'us'}.nylas.com`,
          path: '/v3/grants',
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Accept': 'application/json'
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => { data += chunk; });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('✅ Credentials valid');
              resolve({
                success: true,
                message: 'Credentials are valid',
                statusCode: res.statusCode
              });
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              console.error('❌ Invalid credentials');
              resolve({
                success: false,
                message: 'Invalid credentials',
                error: 'Authentication failed',
                statusCode: res.statusCode
              });
            } else {
              console.error(`⚠️ Unexpected response: ${res.statusCode}`);
              resolve({
                success: false,
                message: 'Unexpected response from Nylas',
                statusCode: res.statusCode
              });
            }
          });
        });
        
        req.on('error', (error) => {
          console.error('❌ Network error:', error.message);
          reject(error);
        });
        
        req.end();
      });
    } catch (error) {
      console.error('Error testing credentials:', error);
      return {
        success: false,
        message: 'Test failed',
        error: error.message
      };
    }
  }
  
  /**
   * Update grant count for an account
   * Call this after adding or removing a grant
   * @param {string} accountId - Account ID to update
   */
  async updateGrantCount(accountId) {
    try {
      const count = await prisma.user.count({
        where: {
          nylasAccountId: accountId,
          calendarConnected: true,
          nylasGrantId: { not: null }
        }
      });

      await prisma.nylasAccount.update({
        where: { id: accountId },
        data: {
          currentGrantCount: count,
          lastUsed: new Date()
        }
      });
      
      console.log(`📊 Updated grant count for account ${accountId}: ${count}`);
    } catch (error) {
      console.error('Error updating grant count:', error);
      // Don't throw - this is a non-critical update
    }
  }
}

module.exports = new MultiNylasService();
