const grantManagementService = require('../services/grantManagementService');
const prisma = require('../db/client');

/**
 * GET /api/admin/grants
 * List all calendar grants (all organizations or specific organization)
 */
const listOrganizationGrants = async (req, res) => {
  try {
    // Allow filtering by organization ID via query parameter
    const organizationId = req.query.organizationId;
    
    console.log(`📋 Admin listing grants${organizationId ? ` for organization ${organizationId}` : ' (all organizations)'}`);
    
    let grants, stats;
    
    if (organizationId) {
      // Get grants for specific organization
      grants = await grantManagementService.getOrganizationGrants(organizationId);
      stats = await grantManagementService.getGrantUsageStats(organizationId);
    } else {
      // Get all grants across all organizations
      const users = await prisma.user.findMany({
        where: {
          nylasGrantId: { not: null },
          calendarConnected: true
        },
        select: {
          id: true,
          email: true,
          profile: true,
          nylasGrantId: true,
          nylasAccountId: true,
          nylasGrantStatus: true,
          calendarProvider: true,
          grantConnectedAt: true,
          lastGrantRefresh: true,
          currentOrganizationId: true,
          currentOrganization: { select: { name: true } }
        },
        orderBy: { grantConnectedAt: 'asc' }
      });

      // Stitch the soft-ref nylasAccountId column to its NylasAccount record.
      const nylasAccountIds = [...new Set(users.map(u => u.nylasAccountId).filter(Boolean))];
      const nylasAccounts = nylasAccountIds.length
        ? await prisma.nylasAccount.findMany({
            where: { id: { in: nylasAccountIds } },
            select: { id: true, name: true, clientId: true }
          })
        : [];
      const nylasAccountById = new Map(nylasAccounts.map(a => [a.id, a]));
      for (const u of users) {
        u.nylasAccountId = u.nylasAccountId ? (nylasAccountById.get(u.nylasAccountId) || null) : null;
      }

      grants = users.map(user => ({
        userId: user._id,
        userName: user.profile?.displayName || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || 'Unknown User',
        email: user.email,
        provider: user.calendarProvider || 'unknown',
        grantId: user.nylasGrantId,
        nylasAccountId: user.nylasAccountId?._id,
        nylasAccountName: user.nylasAccountId?.name || 'Default Account',
        status: user.nylasGrantStatus || 'unknown',
        connectedAt: user.grantConnectedAt,
        lastRefresh: user.lastGrantRefresh,
        ageInDays: user.grantConnectedAt ? Math.floor((Date.now() - user.grantConnectedAt.getTime()) / (1000 * 60 * 60 * 24)) : null,
        organization: user.currentOrganization?.name || 'Unknown'
      }));
      
      // Calculate aggregate stats using multi-account system capacity
      const multiNylasService = require('../services/multiNylasService');
      const systemCapacity = await multiNylasService.getSystemCapacity();
      
      stats = {
        currentCount: grants.length,
        maxAllowed: systemCapacity.totalMax, // Total across all Nylas accounts
        availableSlots: systemCapacity.availableSlots,
        utilizationPercentage: systemCapacity.utilizationPercentage,
        atLimit: systemCapacity.availableSlots === 0,
        accountCount: systemCapacity.accountCount,
        grants: grants,
        oldestGrant: grants.length > 0 ? grants[0] : null,
        newestGrant: grants.length > 0 ? grants[grants.length - 1] : null
      };
    }

    console.log(`📤 Returning ${grants.length} grants with stats:`, {
      currentCount: stats.currentCount,
      maxAllowed: stats.maxAllowed,
      availableSlots: stats.availableSlots
    });
    
    res.json({
      success: true,
      grants,
      stats,
      message: `Found ${grants.length} calendar connection(s)`
    });
  } catch (error) {
    console.error('Error listing organization grants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list grants',
      details: error.message
    });
  }
};

/**
 * DELETE /api/admin/grants/:userId
 * Revoke a user's calendar grant
 */
const revokeUserGrant = async (req, res) => {
  try {
    const { userId } = req.params;
    const admin = req.admin; // From adminAuth middleware

    console.log(`🔓 Admin ${admin.email} revoking grant for user ${userId}`);

    // Verify the target user exists
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Super admins can revoke any grant
    // Regular admins should have systemSettings permission (already checked by middleware)

    const result = await grantManagementService.revokeGrant(
      userId,
      `Manual revocation by admin ${admin.email}`,
      true // Revoke in Nylas
    );

    res.json({
      success: true,
      result,
      message: `Calendar disconnected for ${targetUser.email}`
    });
  } catch (error) {
    console.error('Error revoking user grant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke grant',
      details: error.message
    });
  }
};

/**
 * GET /api/admin/grants/usage
 * Get grant usage statistics for the organization
 */
const getGrantUsage = async (req, res) => {
  try {
    // Allow filtering by organization ID via query parameter
    const organizationId = req.query.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId query parameter required'
      });
    }

    const stats = await grantManagementService.getGrantUsageStats(organizationId);

    res.json({
      success: true,
      usage: stats
    });
  } catch (error) {
    console.error('Error getting grant usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get grant usage',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/grants/verify-all
 * Verify all grants in the organization are still valid
 */
const verifyAllGrants = async (req, res) => {
  try {
    // Allow filtering by organization ID via query parameter
    const organizationId = req.query.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'organizationId query parameter required for verification'
      });
    }

    console.log(`🔍 Admin ${req.admin.email} verifying all grants for organization ${organizationId}`);
    
    const results = await grantManagementService.verifyOrganizationGrants(organizationId);

    res.json({
      success: true,
      verification: results,
      message: `Verified ${results.total} grant(s): ${results.valid} valid, ${results.invalid} invalid`
    });
  } catch (error) {
    console.error('Error verifying all grants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify grants',
      details: error.message
    });
  }
};

module.exports = {
  listOrganizationGrants,
  revokeUserGrant,
  getGrantUsage,
  verifyAllGrants
};
