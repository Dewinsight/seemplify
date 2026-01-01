const express = require('express');
const router = express.Router();
const User = require('../models/User');
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const Feedback = require('../models/Feedback');
const { 
  requireAuth,
  getUserRole,
  getDirectReports,
  getManagedTeams,
  getCurrentOrganization
} = require('../middleware/rbac');

/**
 * GET /api/user/context - Get comprehensive user context
 * Returns all necessary info for frontend role-based rendering
 */
router.get('/context', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    const userId = sessionUser.id || sessionUser.sub;
    
    // Get user from database for latest info
    const dbUser = await User.findOne({ email: sessionUser.email });
    
    // Build comprehensive context
    const role = req.userRole;
    const directReports = req.directReports;
    const managedTeams = req.managedTeams;
    const currentOrganization = req.currentOrganization;
    
    // Get teams from session or DB
    const teams = dbUser?.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
    const teamPermissions = dbUser?.idpTeamPermissions || sessionUser.userinfo?.team_permissions || [];
    
    // Find primary team (first team with highest role)
    const primaryTeam = teams.find(t => t.role === 'line_manager') ||
                        teams.find(t => t.role === 'team_lead') ||
                        teams[0];
    
    // Get summary counts for dashboard
    const [okrCount, reviewCount, feedbackCount] = await Promise.all([
      OKR.countDocuments({ ownerId: userId }),
      PerformanceReview.countDocuments({ 
        $or: [{ userId: userId }, { managerId: userId }] 
      }),
      Feedback.countDocuments({ receiverId: userId })
    ]);
    
    // Get pending items for managers
    let pendingReviews = 0;
    let directReportOkrsBehind = 0;
    
    if (role === 'line_manager' || role === 'hr_admin') {
      pendingReviews = await PerformanceReview.countDocuments({
        managerId: userId,
        'selfEvaluation.submittedAt': { $exists: true },
        'managerEvaluation.submittedAt': { $exists: false }
      });
      
      // OKRs from direct reports that are behind
      if (directReports.length > 0) {
        const directReportOkrs = await OKR.find({
          ownerId: { $in: directReports },
          status: 'active'
        });
        directReportOkrsBehind = directReportOkrs.filter(okr => {
          const progress = calculateOkrProgress(okr);
          return progress < 50;
        }).length;
      }
    }
    
    // Get user name from multiple sources
    const userName = sessionUser.name || 
                     sessionUser.userinfo?.name ||
                     dbUser?.profile?.displayName ||
                     dbUser?.profile?.firstName ||
                     sessionUser.email?.split('@')[0] ||
                     'User';
    
    res.json({
      success: true,
      data: {
        // User identity
        user: {
          id: userId,
          email: sessionUser.email,
          name: userName,
          avatar: dbUser?.profile?.avatar,
          title: dbUser?.profile?.title
        },
        
        // Role and permissions
        role: {
          name: role,
          displayName: formatRoleName(role),
          isManager: role === 'line_manager' || role === 'hr_admin',
          isHRAdmin: role === 'hr_admin',
          isTeamLead: role === 'team_lead' || role === 'line_manager' || role === 'hr_admin'
        },
        
        // Organization - extract from multiple sources
        organization: (() => {
          if (currentOrganization) {
            return {
              id: currentOrganization.id || currentOrganization._id,
              name: currentOrganization.name
            };
          }
          // Try to get from teams
          const firstTeam = teams[0];
          if (firstTeam?.organizationId) {
            return {
              id: firstTeam.organizationId,
              name: firstTeam.organizationName || 'Organization'
            };
          }
          // Try from session organizations
          const orgs = dbUser?.idpOrganizations || sessionUser.organizations || sessionUser.userinfo?.organizations || [];
          if (orgs.length > 0) {
            const org = orgs[0];
            return {
              id: org.id || org._id,
              name: org.name
            };
          }
          return null;
        })(),
        
        // Teams
        teams: teams.map(t => ({
          id: t.id,
          name: t.name,
          role: t.role,
          roleDisplay: formatTeamRole(t.role),
          isManager: t.isManager,
          hierarchyPath: t.hierarchyPath,
          parentTeamName: t.parentTeamName
        })),
        primaryTeam: primaryTeam ? {
          id: primaryTeam.id,
          name: primaryTeam.name,
          role: primaryTeam.role,
          roleDisplay: formatTeamRole(primaryTeam.role)
        } : null,
        
        // Manager-specific data
        managerData: (role === 'line_manager' || role === 'hr_admin') ? {
          directReportCount: directReports.length,
          directReportIds: directReports,
          managedTeams: managedTeams.map(t => ({
            id: t.id,
            name: t.name,
            memberCount: t.directReportCount || 0
          })),
          pendingReviews,
          directReportOkrsBehind
        } : null,
        
        // Summary stats
        stats: {
          myOkrs: okrCount,
          myReviews: reviewCount,
          feedbackReceived: feedbackCount
        },
        
        // Feature flags based on role
        features: {
          canCreateTeamOkr: role === 'line_manager' || role === 'hr_admin',
          canCreateOrgOkr: role === 'hr_admin',
          canConductReviews: role === 'line_manager' || role === 'hr_admin',
          canViewTeamAnalytics: role === 'team_lead' || role === 'line_manager' || role === 'hr_admin',
          canViewOrgAnalytics: role === 'hr_admin',
          canManageReviewCycles: role === 'hr_admin',
          canSendManagerFeedback: role === 'line_manager' || role === 'hr_admin'
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user context:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user context' });
  }
});

/**
 * GET /api/user/teams - Get user's teams with hierarchy
 */
router.get('/teams', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    const dbUser = await User.findOne({ email: sessionUser.email });
    
    const teams = dbUser?.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
    
    res.json({
      success: true,
      data: {
        teams: teams.map(t => ({
          id: t.id,
          name: t.name,
          organizationId: t.organizationId,
          organizationName: t.organizationName,
          role: t.role,
          roleDisplay: formatTeamRole(t.role),
          isManager: t.isManager,
          managerId: t.managerId,
          managerName: t.managerName,
          parentTeamId: t.parentTeamId,
          parentTeamName: t.parentTeamName,
          hierarchyPath: t.hierarchyPath,
          subTeams: t.subTeams,
          directReports: t.directReports,
          joinedAt: t.joinedAt
        })),
        currentOrganization: req.currentOrganization
      }
    });
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch teams' });
  }
});

/**
 * GET /api/user/direct-reports - Get direct reports for line manager
 */
router.get('/direct-reports', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const directReportIds = req.directReports || [];
    const managedTeams = req.managedTeams || [];
    
    if (role !== 'line_manager' && role !== 'hr_admin') {
      return res.json({
        success: true,
        data: {
          isManager: false,
          managedTeams: [],
          directReports: [],
          totalDirectReports: 0
        }
      });
    }
    
    // Get direct report user info from database
    let directReports = [];
    if (directReportIds.length > 0) {
      const dbUsers = await User.find({
        $or: [
          { _id: { $in: directReportIds } },
          { 'idpTeams.id': { $in: directReportIds } }
        ]
      }).select('email profile idpTeams');
      
      directReports = dbUsers.map(u => ({
        id: u._id?.toString(),
        email: u.email,
        name: u.profile?.displayName || u.profile?.firstName || u.email?.split('@')[0],
        title: u.profile?.title || 'Team Member',
        avatar: u.profile?.avatar
      }));
    }
    
    res.json({
      success: true,
      data: {
        isManager: true,
        managedTeams: managedTeams.map(t => ({
          id: t.id,
          name: t.name,
          role: t.role,
          directReportCount: t.directReports?.length || 0
        })),
        directReports,
        totalDirectReports: directReportIds.length
      }
    });
  } catch (error) {
    console.error('Error fetching direct reports:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch direct reports' });
  }
});

/**
 * GET /api/user/all-employees - Get all employees in the organization (HR Admin only)
 * Used for launching appraisal cycles
 */
router.get('/all-employees', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const currentOrganization = req.currentOrganization;

    // Only HR Admin can access all employees
    if (role !== 'hr_admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR Admin role required.'
      });
    }

    // Get all users in the organization
    const users = await User.find({
      $or: [
        { currentOrganizationId: currentOrganization?.id },
        { 'idpOrganizations.id': currentOrganization?.id },
        { 'idpTeams.organizationId': currentOrganization?.id }
      ]
    }).select('email profile idpTeams currentOrganizationId');

    // Map users with their manager info from teams
    const employees = users.map(u => {
      // Find user's team info to get manager
      const primaryTeam = u.idpTeams?.find(t => t.organizationId === currentOrganization?.id) || u.idpTeams?.[0];

      return {
        userId: u._id?.toString(),
        name: u.profile?.displayName ||
              `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim() ||
              u.email?.split('@')[0] ||
              'Unknown',
        email: u.email,
        jobTitle: u.profile?.title || primaryTeam?.role || 'Employee',
        department: primaryTeam?.name || u.profile?.department || '',
        managerId: primaryTeam?.managerId,
        managerName: primaryTeam?.managerName,
        managerEmail: primaryTeam?.managerEmail
      };
    });

    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('Error fetching all employees:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch employees' });
  }
});

/**
 * GET /api/user/search - Search users (for feedback recipient, peer review)
 */
router.get('/search', requireAuth, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    
    // Search by email or display name
    const users = await User.find({
      $or: [
        { email: { $regex: q, $options: 'i' } },
        { 'profile.displayName': { $regex: q, $options: 'i' } },
        { 'profile.firstName': { $regex: q, $options: 'i' } },
        { 'profile.lastName': { $regex: q, $options: 'i' } }
      ]
    })
      .select('email profile')
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      data: users.map(u => ({
        id: u._id?.toString(),
        email: u.email,
        name: u.profile?.displayName || `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim() || u.email,
        title: u.profile?.title
      }))
    });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ success: false, error: 'Failed to search users' });
  }
});

/**
 * GET /api/user/organizations - Get all organizations user belongs to
 */
router.get('/organizations', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    const dbUser = await User.findOne({ email: sessionUser.email });
    
    // Get organizations from multiple sources (fallback chain)
    let organizations = [];
    
    // 1. Check database first
    if (dbUser?.idpOrganizations?.length > 0) {
      organizations = dbUser.idpOrganizations;
    }
    // 2. Check session organizations
    else if (sessionUser.organizations?.length > 0) {
      organizations = sessionUser.organizations;
    }
    // 3. Check userinfo from IdP
    else if (sessionUser.userinfo?.organizations?.length > 0) {
      organizations = sessionUser.userinfo.organizations;
    }
    // 4. Extract from teams (fallback)
    else {
      const teams = dbUser?.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
      const orgMap = new Map();
      teams.forEach(t => {
        if (t.organizationId && !orgMap.has(t.organizationId)) {
          orgMap.set(t.organizationId, {
            id: t.organizationId,
            name: t.organizationName || 'Organization',
            slug: t.organizationId
          });
        }
      });
      organizations = Array.from(orgMap.values());
    }
    
    // Get current org ID
    const currentOrgId = dbUser?.currentOrganizationId || 
                         sessionUser.currentOrganizationId ||
                         req.currentOrganization?.id ||
                         (organizations[0]?.id);
    
    res.json({
      success: true,
      data: {
        organizations: organizations.map(org => ({
          id: org.id || org._id || org.organizationId,
          name: org.name || org.organizationName || 'Organization',
          slug: org.slug,
          logo: org.logo,
          isCurrent: (org.id || org._id || org.organizationId) === currentOrgId
        })),
        currentOrganizationId: currentOrgId
      }
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

/**
 * POST /api/user/switch-organization - Switch current organization
 */
router.post('/switch-organization', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    const { organizationId } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Organization ID required' });
    }
    
    // Update user's current organization
    let dbUser = await User.findOne({ email: sessionUser.email });
    
    // Create user if not exists
    if (!dbUser) {
      dbUser = new User({
        email: sessionUser.email,
        profile: {
          displayName: sessionUser.name || sessionUser.email?.split('@')[0]
        }
      });
    }
    
    // Get organizations from multiple sources
    let organizations = dbUser.idpOrganizations || [];
    if (organizations.length === 0) {
      organizations = sessionUser.organizations || sessionUser.userinfo?.organizations || [];
    }
    if (organizations.length === 0) {
      // Extract from teams
      const teams = dbUser?.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
      const orgMap = new Map();
      teams.forEach(t => {
        if (t.organizationId && !orgMap.has(t.organizationId)) {
          orgMap.set(t.organizationId, {
            id: t.organizationId,
            name: t.organizationName || 'Organization'
          });
        }
      });
      organizations = Array.from(orgMap.values());
    }
    
    // Verify user has access to this organization
    const hasAccess = organizations.some(org => 
      (org.id || org._id || org.organizationId) === organizationId
    );
    
    if (!hasAccess && organizations.length > 0) {
      return res.status(403).json({ 
        success: false, 
        error: 'You do not have access to this organization' 
      });
    }
    
    dbUser.currentOrganizationId = organizationId;
    await dbUser.save();
    
    // Update session
    req.session.currentOrganizationId = organizationId;
    
    const selectedOrg = organizations.find(org => 
      (org.id || org._id || org.organizationId) === organizationId
    );
    
    res.json({
      success: true,
      message: 'Organization switched successfully',
      data: {
        organizationId,
        organizationName: selectedOrg?.name || selectedOrg?.organizationName
      }
    });
  } catch (error) {
    console.error('Error switching organization:', error);
    res.status(500).json({ success: false, error: 'Failed to switch organization' });
  }
});

// Helper functions
function formatRoleName(role) {
  const roleNames = {
    'employee': 'Employee',
    'team_lead': 'Team Lead',
    'line_manager': 'Line Manager',
    'hr_admin': 'HR Administrator'
  };
  return roleNames[role] || 'Employee';
}

function formatTeamRole(role) {
  const roleNames = {
    'member': 'Member',
    'team_lead': 'Team Lead',
    'line_manager': 'Line Manager'
  };
  return roleNames[role] || 'Member';
}

function calculateOkrProgress(okr) {
  if (!okr.objectives?.[0]?.keyResults?.length) return 0;
  
  const krs = okr.objectives[0].keyResults;
  let totalProgress = 0;
  
  krs.forEach(kr => {
    const range = kr.targetValue - kr.startValue;
    if (range > 0) {
      const progress = ((kr.currentValue - kr.startValue) / range) * 100;
      totalProgress += Math.min(100, Math.max(0, progress));
    }
  });
  
  return Math.round(totalProgress / krs.length);
}

module.exports = router;






