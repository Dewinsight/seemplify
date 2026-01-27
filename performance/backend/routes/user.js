const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const Feedback = require('../models/Feedback');
const {
  requireAuth,
  getUserRole,
  getDirectReports,
  getManagedTeams,
  getCurrentOrganization,
  getCurrentTeam
} = require('../middleware/rbac');
const { verifySubscriptionAccess } = require('../services/idpSubscriptionService');

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
    
    // Get teams from IDP session FIRST (freshest data), then fallback to DB cache
    // Priority: session.idpTeams > session.teams > userinfo.teams > DB cache
    const teams = sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || dbUser?.idpTeams || [];
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
          // Try from IDP session organizations (never from local database)
          const orgs = sessionUser.organizations || sessionUser.userinfo?.organizations || [];
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
          organizationId: t.organizationId,
          organizationName: t.organizationName,
          hierarchyPath: t.hierarchyPath,
          parentTeamId: t.parentTeamId,
          parentTeamName: t.parentTeamName
        })),
        primaryTeam: primaryTeam ? {
          id: primaryTeam.id,
          name: primaryTeam.name,
          role: primaryTeam.role,
          roleDisplay: formatTeamRole(primaryTeam.role)
        } : null,
        // Current Team (for team switching within organization)
        currentTeam: req.currentTeam ? {
          id: req.currentTeam.id,
          name: req.currentTeam.name,
          role: req.currentTeam.role,
          roleDisplay: formatTeamRole(req.currentTeam.role),
          isManager: req.currentTeam.isManager || req.currentTeam.role === 'line_manager',
          organizationId: req.currentTeam.organizationId,
          organizationName: req.currentTeam.organizationName,
          parentTeamId: req.currentTeam.parentTeamId,
          parentTeamName: req.currentTeam.parentTeamName,
          hierarchyPath: req.currentTeam.hierarchyPath || []
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

    // Get all users in the organization (using cached idpTeams for org membership)
    const users = await User.find({
      $or: [
        { currentOrganizationId: currentOrganization?.id },
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
 * Organizations are ALWAYS fetched from IDP session, never stored locally
 */
router.get('/organizations', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    
    // Organizations ALWAYS come from IDP session - never from local database
    let organizations = sessionUser.organizations || sessionUser.userinfo?.organizations || [];
    
    // Fallback: Extract from teams if no organizations in session
    if (organizations.length === 0) {
      const teams = sessionUser.teams || sessionUser.userinfo?.teams || [];
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
    
    // Get current org ID - only currentOrganizationId is stored locally as a preference
    const dbUser = await User.findOne({ email: sessionUser.email }).select('currentOrganizationId');
    const currentOrgId = req.session.currentOrganizationId ||
                         sessionUser.currentOrganization?.id ||
                         dbUser?.currentOrganizationId ||
                         (organizations[0]?.id);
    
    res.json({
      success: true,
      data: {
        organizations: organizations.map(org => ({
          id: org.id || org._id || org.organizationId,
          name: org.name || org.organizationName || 'Organization',
          slug: org.slug,
          logo: org.logo,
          role: org.role,
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
 * Organizations come from IDP - only currentOrganizationId is stored locally as preference
 */
router.post('/switch-organization', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.session.user;
    const { organizationId } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Organization ID required' });
    }
    
    // Get organizations from IDP session (NEVER from local database)
    let organizations = sessionUser.organizations || sessionUser.userinfo?.organizations || [];
    
    // Fallback: Extract from teams if no organizations
    if (organizations.length === 0) {
      const teams = sessionUser.teams || sessionUser.userinfo?.teams || [];
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
    
    // Verify user has access to this organization (from IDP data)
    const selectedOrg = organizations.find(org =>
      (org.id || org._id || org.organizationId) === organizationId
    );

    if (!selectedOrg && organizations.length > 0) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this organization'
      });
    }

    // Verify subscription access for the target organization
    console.log('🔒 Verifying subscription access for org:', organizationId);
    const subscriptionCheck = await verifySubscriptionAccess(
      organizationId,
      req.headers['authorization']?.replace('Bearer ', '') || sessionUser.accessToken
    );

    if (!subscriptionCheck.allowed) {
      console.log('❌ Organization switch denied - no subscription:', subscriptionCheck.reason);
      return res.status(403).json({
        success: false,
        error: 'This organization does not have access to Performance Management',
        code: 'SUBSCRIPTION_REQUIRED',
        reason: subscriptionCheck.reason,
        subscribeUrl: subscriptionCheck.subscribeUrl || `${process.env.OIDC_ISSUER || 'http://localhost:4000'}/plans`
      });
    }
    console.log('✅ Subscription access verified for performance-management');

    // Only store currentOrganizationId locally as a preference
    let dbUser = await User.findOne({ email: sessionUser.email });
    if (!dbUser) {
      dbUser = new User({
        email: sessionUser.email,
        profile: {
          displayName: sessionUser.name || sessionUser.email?.split('@')[0]
        }
      });
    }
    dbUser.currentOrganizationId = organizationId;
    await dbUser.save();
    
    // Update session
    req.session.currentOrganizationId = organizationId;
    req.session.user.currentOrganization = selectedOrg;
    
    console.log('✅ Performance organization switched to:', selectedOrg?.name, 'for', sessionUser.email);
    
    res.json({
      success: true,
      message: 'Organization switched successfully',
      organization: selectedOrg, // Return full org object
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

/**
 * GET /api/user/team-hierarchy - Get full team hierarchy for the organization
 * Used by HR Admin to see org structure for appraisal launching
 */
router.get('/team-hierarchy', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const currentOrganization = req.currentOrganization;

    // Only HR Admin and Line Managers can view team hierarchy
    if (role !== 'hr_admin' && role !== 'line_manager') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR Admin or Line Manager role required.'
      });
    }

    // Get all users in the organization with their team info (using cached idpTeams for org membership)
    const users = await User.find({
      $or: [
        { currentOrganizationId: currentOrganization?.id },
        { 'idpTeams.organizationId': currentOrganization?.id }
      ]
    }).select('email profile idpTeams currentOrganizationId');

    // Build team hierarchy map
    const teamsMap = new Map();
    const employeesWithManagers = [];

    users.forEach(user => {
      const userTeams = user.idpTeams || [];
      
      userTeams.forEach(team => {
        // Add team to map if not exists
        if (!teamsMap.has(team.id)) {
          teamsMap.set(team.id, {
            id: team.id,
            name: team.name,
            organizationId: team.organizationId,
            parentTeamId: team.parentTeamId,
            parentTeamName: team.parentTeamName,
            hierarchyPath: team.hierarchyPath || [],
            members: [],
            managers: [],
            subTeams: []
          });
        }

        const teamData = teamsMap.get(team.id);
        
        // Add user to team
        const memberInfo = {
          userId: user._id?.toString(),
          email: user.email,
          name: user.profile?.displayName ||
                `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
                user.email?.split('@')[0],
          jobTitle: user.profile?.title || team.role || 'Employee',
          teamRole: team.role,
          isManager: team.isManager || team.role === 'line_manager',
          directReports: team.directReports || []
        };

        if (memberInfo.isManager) {
          teamData.managers.push(memberInfo);
        } else {
          teamData.members.push(memberInfo);
        }

        // Build employee-manager relationship
        if (team.managerId) {
          employeesWithManagers.push({
            userId: user._id?.toString(),
            name: memberInfo.name,
            email: user.email,
            jobTitle: memberInfo.jobTitle,
            teamId: team.id,
            teamName: team.name,
            teamRole: team.role,
            managerId: team.managerId,
            managerName: team.managerName,
            managerEmail: team.managerEmail,
            isManager: memberInfo.isManager
          });
        }
      });
    });

    // Build parent-child relationships for teams
    const teams = Array.from(teamsMap.values());
    teams.forEach(team => {
      if (team.parentTeamId && teamsMap.has(team.parentTeamId)) {
        const parentTeam = teamsMap.get(team.parentTeamId);
        parentTeam.subTeams.push({
          id: team.id,
          name: team.name,
          memberCount: team.members.length + team.managers.length
        });
      }
    });

    // Find root teams (no parent)
    const rootTeams = teams.filter(t => !t.parentTeamId);

    res.json({
      success: true,
      data: {
        teams: teams,
        rootTeams: rootTeams,
        employeesWithManagers: employeesWithManagers,
        currentTeam: currentTeam ? {
          id: currentTeam.id,
          name: currentTeam.name,
          role: currentTeam.role,
          roleDisplay: formatTeamRole(currentTeam.role),
          isManager: currentTeam.isManager || currentTeam.role === 'line_manager',
          organizationId: currentTeam.organizationId,
          organizationName: currentTeam.organizationName,
          parentTeamId: currentTeam.parentTeamId,
          parentTeamName: currentTeam.parentTeamName,
          hierarchyPath: currentTeam.hierarchyPath || []
        } : null,
        summary: {
          totalTeams: teams.length,
          totalEmployees: employeesWithManagers.length,
          managersCount: employeesWithManagers.filter(e => e.isManager).length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching team hierarchy:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch team hierarchy' });
  }
});

/**
 * GET /api/user/employees-for-appraisal - Get all employees with manager relationships
 * Specifically designed for launching appraisal cycles
 * Returns employees grouped by manager for easy selection
 */
router.get('/employees-for-appraisal', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const currentOrganization = req.currentOrganization;
    const sessionUser = req.session.user;

    // HR Admin sees all, Line Manager sees only their direct reports
    if (role !== 'hr_admin' && role !== 'line_manager') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR Admin or Line Manager role required.'
      });
    }

    // Get all users in the organization (using cached idpTeams for org membership)
    const users = await User.find({
      $or: [
        { currentOrganizationId: currentOrganization?.id },
        { 'idpTeams.organizationId': currentOrganization?.id }
      ]
    }).select('email profile idpTeams');

    const employees = [];
    const managersMap = new Map();

    users.forEach(user => {
      const userTeams = user.idpTeams || [];
      
      userTeams.forEach(team => {
        // Skip if line_manager only sees direct reports
        if (role === 'line_manager') {
          const directReports = req.directReports || [];
          if (!directReports.includes(user._id?.toString())) {
            return;
          }
        }

        const employeeInfo = {
          userId: user._id?.toString(),
          name: user.profile?.displayName ||
                `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
                user.email?.split('@')[0] ||
                'Unknown',
          email: user.email,
          jobTitle: user.profile?.title || team.role || 'Employee',
          department: team.name,
          teamId: team.id,
          teamName: team.name,
          teamRole: team.role,
          isManager: team.isManager || team.role === 'line_manager',
          managerId: team.managerId || null,
          managerName: team.managerName || null,
          managerEmail: team.managerEmail || null
        };

        employees.push(employeeInfo);

        // Track managers
        if (employeeInfo.managerId && !managersMap.has(employeeInfo.managerId)) {
          managersMap.set(employeeInfo.managerId, {
            managerId: employeeInfo.managerId,
            managerName: employeeInfo.managerName,
            managerEmail: employeeInfo.managerEmail,
            directReports: []
          });
        }

        if (employeeInfo.managerId) {
          const manager = managersMap.get(employeeInfo.managerId);
          if (manager) {
            manager.directReports.push({
              userId: employeeInfo.userId,
              name: employeeInfo.name,
              email: employeeInfo.email,
              jobTitle: employeeInfo.jobTitle,
              teamName: employeeInfo.teamName
            });
          }
        }
      });
    });

    // Deduplicate employees (user might be in multiple teams)
    const uniqueEmployees = Array.from(
      new Map(employees.map(e => [e.userId, e])).values()
    );

    // Group by manager for easy UI rendering
    const byManager = Array.from(managersMap.values());

    // Find employees without managers
    const withoutManager = uniqueEmployees.filter(e => !e.managerId);

    res.json({
      success: true,
      data: {
        employees: uniqueEmployees,
        byManager: byManager,
        withoutManager: withoutManager,
        summary: {
          totalEmployees: uniqueEmployees.length,
          withManager: uniqueEmployees.length - withoutManager.length,
          withoutManager: withoutManager.length,
          totalManagers: byManager.length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching employees for appraisal:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch employees' });
  }
});

/**
 * GET /api/user/my-team-members - Get team members for a line manager
 * Used by managers to see their direct reports and team structure
 * 
 * Strategy: Fetch team member details directly from IDP API (like time-attendance does)
 */
router.get('/my-team-members', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const managedTeams = req.managedTeams || [];
    const sessionUser = req.session.user;
    const accessToken = sessionUser.accessToken;
    
    console.log('🔍 my-team-members: role=', role, 'managedTeams=', managedTeams.length);

    if (role !== 'line_manager' && role !== 'hr_admin') {
      return res.json({
        success: true,
        data: {
          isManager: false,
          teams: [],
          directReports: [],
          message: 'You are not a manager'
        }
      });
    }

    // Fetch team member details from IDP
    const idpUrl = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';
    
    let directReports = [];
    const seenMembers = new Set(); // Avoid duplicates
    const currentUserId = sessionUser.id || sessionUser.sub;
    
    // Get all directReport IDs from managed teams
    const allDirectReportIds = new Set();
    managedTeams.forEach(team => {
      if (team.directReports) {
        team.directReports.forEach(id => allDirectReportIds.add(id));
      }
    });
    console.log('🔍 All direct report IDs:', Array.from(allDirectReportIds));
    
    // Get current organization ID
    const currentOrgId = sessionUser.currentOrganization?.id || 
                         sessionUser.organizations?.[0]?.id ||
                         managedTeams[0]?.organizationId;
    
    // Try to fetch all organization members to get names/emails
    let orgMembersMap = new Map();
    if (currentOrgId && accessToken) {
      try {
        console.log(`📡 Fetching org members from IDP for org: ${currentOrgId}`);
        const response = await axios.get(`${idpUrl}/api/organizations/${currentOrgId}/members`, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        
        if (response.data?.members) {
          console.log(`✅ Got ${response.data.members.length} org members from IDP`);
          response.data.members.forEach(member => {
            // Store by both id and string id for matching
            orgMembersMap.set(member.id.toString(), member);
            orgMembersMap.set(member.id, member);
          });
        }
      } catch (orgError) {
        console.warn(`⚠️ Could not fetch org members:`, orgError.message);
      }
    }
    
    // Build direct reports list
    for (const team of managedTeams) {
      if (!team.directReports || team.directReports.length === 0) continue;
      
      team.directReports.forEach((memberId, idx) => {
        // Skip manager and duplicates
        if (memberId === currentUserId || seenMembers.has(memberId)) return;
        seenMembers.add(memberId);
        
        // Try to find member details from org members list
        const memberDetails = orgMembersMap.get(memberId) || orgMembersMap.get(memberId.toString());
        
        if (memberDetails) {
          console.log(`✅ Found member details for ${memberId}: ${memberDetails.name || memberDetails.email}`);
          directReports.push({
            userId: memberId,
            email: memberDetails.email,
            name: memberDetails.name || memberDetails.email?.split('@')[0] || `Team Member ${idx + 1}`,
            jobTitle: memberDetails.role === 'hr_manager' ? 'HR Manager' :
                     memberDetails.role === 'admin' ? 'Administrator' : 'Team Member',
            avatar: null,
            teamId: team.id,
            teamName: team.name,
            teamRole: 'member',
            isAlsoManager: false,
            directReportCount: 0,
            source: 'idp',
            orgRole: memberDetails.role
          });
        } else {
          // Fallback: create placeholder for unknown member
          console.log(`⚠️ No details found for member ${memberId}, using placeholder`);
          directReports.push({
            userId: memberId,
            email: null,
            name: `Team Member ${idx + 1}`,
            jobTitle: 'Team Member',
            avatar: null,
            teamId: team.id,
            teamName: team.name,
            teamRole: 'member',
            isAlsoManager: false,
            directReportCount: 0,
            source: 'session',
            needsLogin: true
          });
        }
      });
    }
    
    console.log(`📊 Total team members found: ${directReports.length}`);

    const responseData = {
      isManager: true,
      managerId: currentUserId,
      managerName: sessionUser.name,
      teams: managedTeams.map(t => ({
        id: t.id,
        name: t.name,
        role: t.role,
        memberCount: t.directReports?.length || 0
      })),
      directReports: directReports,
      totalDirectReports: directReports.length
    };
    
    console.log('📊 /api/user/my-team-members response:', {
      totalDirectReports: directReports.length,
      teams: responseData.teams.length,
      sampleMember: directReports[0]
    });
    
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch team members' });
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

/**
 * POST /api/user/switch-team - Switch current team (within current organization)
 * Different from switching organizations - this allows switching between teams in the same org
 * Available to: managers, admins, and staff employees
 */
router.post('/switch-team', requireAuth, async (req, res) => {
  try {
    const { teamId } = req.body;
    const sessionUser = req.session.user;
    const currentOrganization = req.currentOrganization;

    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: 'Team ID is required'
      });
    }

    // Get user's teams from IDP claims
    const teams = sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];

    // Filter teams by current organization
    const orgTeams = teams.filter(t => {
      const orgId = currentOrganization?.id || currentOrganization?._id?.toString() || currentOrganization;
      return t.organizationId === orgId || 
             t.organizationId === currentOrganization?.id ||
             t.organizationId === currentOrganization;
    });

    // Find the requested team
    const requestedTeam = orgTeams.find(t => t.id === teamId);

    if (!requestedTeam) {
      return res.status(403).json({
        success: false,
        error: 'Team not found or you are not a member of this team',
        code: 'TEAM_NOT_FOUND'
      });
    }

    // Verify user is a member of this team (any role is fine)
    // This allows managers, admins, and staff employees to switch teams
    const isMember = orgTeams.some(t => t.id === teamId);
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of this team',
        code: 'NOT_TEAM_MEMBER'
      });
    }

    // Update session with current team
    req.session.user.currentTeam = requestedTeam;
    
    // Also update in database if user exists
    const User = require('../models/User');
    const dbUser = await User.findOne({ email: sessionUser.email });
    if (dbUser) {
      dbUser.currentTeamId = teamId;
      await dbUser.save();
    }

    console.log(`✅ User ${sessionUser.email} switched to team: ${requestedTeam.name} (${teamId})`);

    res.json({
      success: true,
      data: {
        currentTeam: {
          id: requestedTeam.id,
          name: requestedTeam.name,
          role: requestedTeam.role,
          roleDisplay: formatTeamRole(requestedTeam.role),
          isManager: requestedTeam.isManager || requestedTeam.role === 'line_manager',
          organizationId: requestedTeam.organizationId,
          organizationName: requestedTeam.organizationName,
          parentTeamId: requestedTeam.parentTeamId,
          parentTeamName: requestedTeam.parentTeamName,
          hierarchyPath: requestedTeam.hierarchyPath || []
        },
        availableTeams: orgTeams.map(t => ({
          id: t.id,
          name: t.name,
          role: t.role,
          roleDisplay: formatTeamRole(t.role),
          isManager: t.isManager || t.role === 'line_manager'
        }))
      },
      message: `Switched to team: ${requestedTeam.name}`
    });
  } catch (error) {
    console.error('Error switching team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to switch team'
    });
  }
});

/**
 * GET /api/user/current-team - Get current team information
 */
router.get('/current-team', requireAuth, async (req, res) => {
  try {
    const currentTeam = req.currentTeam || getCurrentTeam(req.session.user);
    const sessionUser = req.session.user;
    const currentOrganization = req.currentOrganization;

    if (!currentTeam) {
      // Return available teams if no current team set
      const teams = sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || [];
      const orgTeams = teams.filter(t => {
        const orgId = currentOrganization?.id || currentOrganization?._id?.toString() || currentOrganization;
        return t.organizationId === orgId;
      });

      return res.json({
        success: true,
        data: {
          currentTeam: null,
          availableTeams: orgTeams.map(t => ({
            id: t.id,
            name: t.name,
            role: t.role,
            roleDisplay: formatTeamRole(t.role),
            isManager: t.isManager || t.role === 'line_manager'
          }))
        },
        message: 'No current team set. Please select a team.'
      });
    }

    res.json({
      success: true,
      data: {
        currentTeam: {
          id: currentTeam.id,
          name: currentTeam.name,
          role: currentTeam.role,
          roleDisplay: formatTeamRole(currentTeam.role),
          isManager: currentTeam.isManager || currentTeam.role === 'line_manager',
          organizationId: currentTeam.organizationId,
          organizationName: currentTeam.organizationName,
          parentTeamId: currentTeam.parentTeamId,
          parentTeamName: currentTeam.parentTeamName,
          hierarchyPath: currentTeam.hierarchyPath || [],
          directReports: currentTeam.directReports || []
        }
      }
    });
  } catch (error) {
    console.error('Error fetching current team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch current team'
    });
  }
});

module.exports = router;






