const express = require('express');
const router = express.Router();
const User = require('../models/User');
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const Feedback = require('../models/Feedback');
const {
  requireAuth,
  getCurrentTeam
} = require('../middleware/rbac');
const { verifySubscriptionAccess } = require('../services/idpSubscriptionService');
const {
  resolveAppraisalAccessScope,
  isAppraisalManagerRole
} = require('../services/appraisalAccessService');

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

function getPreferredUserId(userDoc) {
  return userDoc?.idpSub || userDoc?._id?.toString();
}

function resolveOrganizationId(req) {
  return (
    req.currentOrganization?.id ||
    req.currentOrganization?._id?.toString?.() ||
    req.session?.currentOrganizationId ||
    req.session?.user?.currentOrganization?.id ||
    req.session?.user?.currentOrganization?._id?.toString?.() ||
    req.session?.user?.userinfo?.current_organization?.id ||
    req.session?.user?.userinfo?.currentOrganization?.id ||
    req.session?.user?.organizations?.[0]?.id ||
    req.session?.user?.userinfo?.organizations?.[0]?.id ||
    null
  );
}

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
    const isManagerRole = isAppraisalManagerRole(role);
    const appraisalScope = isManagerRole ? await resolveAppraisalAccessScope(req) : null;
    const directReports = appraisalScope?.directReports || [];
    const directReportIds = directReports.map(r => r.userId).filter(Boolean);
    const managedTeams = appraisalScope?.managedTeams || req.managedTeams;
    const currentOrganization = req.currentOrganization;

    // Get teams from IDP session FIRST (freshest data), then fallback to DB cache
    // Priority: session.idpTeams > session.teams > userinfo.teams > DB cache
    const teams = sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || dbUser?.idpTeams || [];

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

    if (isManagerRole) {
      pendingReviews = await PerformanceReview.countDocuments({
        managerId: userId,
        'selfEvaluation.submittedAt': { $exists: true },
        'managerEvaluation.submittedAt': { $exists: false }
      });

      // OKRs from direct reports that are behind
      if (directReportIds.length > 0) {
        const directReportOkrs = await OKR.find({
          ownerId: { $in: directReportIds },
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
          isManager: isManagerRole,
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
          isManager: req.currentTeam.isManager || req.currentTeam.role === 'line_manager' || req.currentTeam.role === 'team_lead',
          organizationId: req.currentTeam.organizationId,
          organizationName: req.currentTeam.organizationName,
          parentTeamId: req.currentTeam.parentTeamId,
          parentTeamName: req.currentTeam.parentTeamName,
          hierarchyPath: req.currentTeam.hierarchyPath || []
        } : null,

        // Manager-specific data
        managerData: isManagerRole ? {
          directReportCount: directReports.length,
          directReportIds: directReportIds,
          managedTeams: managedTeams.map(t => ({
            id: t.id,
            name: t.name,
            memberCount: t.directReportCount || 0,
            role: t.role
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
          canConductReviews: isManagerRole,
          canViewTeamAnalytics: role === 'team_lead' || role === 'line_manager' || role === 'hr_admin',
          canViewOrgAnalytics: role === 'hr_admin',
          canManageReviewCycles: role === 'hr_admin',
          canSendManagerFeedback: isManagerRole
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
 * Returns team members from the Performance database based on shared team membership
 */
router.get('/direct-reports', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const sessionUser = req.session.user;
    const userId = sessionUser.id || sessionUser.sub;
    const managerRole = isAppraisalManagerRole(role);

    if (!managerRole) {
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

    const scope = await resolveAppraisalAccessScope(req);
    const directReports = (scope.directReports || []).map((member) => ({
      id: member.userId,
      userId: member.userId,
      email: member.email,
      name: member.name,
      title: member.jobTitle || 'Team Member',
      avatar: null,
      teamId: member.teamId,
      teamName: member.teamName,
      teamRole: member.teamRole
    }));

    res.json({
      success: true,
      data: {
        isManager: true,
        managedTeams: (scope.managedTeams || []).map(t => ({
          id: t.id,
          name: t.name,
          role: t.role,
          directReportCount: directReports.filter(member => member.teamId === t.id).length
        })),
        directReports,
        totalDirectReports: directReports.length
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
    const currentOrgId = resolveOrganizationId(req);

    // Only HR Admin and Recruiters can access all employees
    if (role !== 'hr_admin' && role !== 'recruiter') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR Admin or Recruiter role required.'
      });
    }

    if (!currentOrgId) {
      return res.status(400).json({
        success: false,
        error: 'No active organization selected'
      });
    }

    // Get all users in the organization (using cached idpTeams for org membership)
    const users = await User.find({
      $or: [
        { currentOrganizationId: currentOrgId },
        { 'idpTeams.organizationId': currentOrgId }
      ]
    }).select('idpSub email profile idpTeams currentOrganizationId');

    // Map users with their manager info from teams
    const employees = users.map(u => {
      // Find user's team info to get manager
      const userTeams = Array.isArray(u.idpTeams) ? u.idpTeams : [];
      const primaryTeam = userTeams.find((t) => t?.organizationId === currentOrgId) || userTeams[0];

      return {
        userId: getPreferredUserId(u),
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
    const currentOrgId = currentOrganization?.id;

    // Only HR Admin, line managers, and team leads can view team hierarchy
    if (!isAppraisalManagerRole(role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR/Admin, Line Manager, or Team Lead role required.'
      });
    }

    const scope = await resolveAppraisalAccessScope(req);
    const effectiveOrgId = currentOrgId || scope.organizationId;
    if (!effectiveOrgId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const accessibleTeamIds = new Set((scope.accessibleTeamIds || []).filter(Boolean));

    // Get all users in the organization with their team info (using cached idpTeams for org membership)
    const users = await User.find({
      $or: [
        { currentOrganizationId: effectiveOrgId },
        { 'idpTeams.organizationId': effectiveOrgId }
      ]
    }).select('idpSub email profile idpTeams currentOrganizationId');

    // Build team hierarchy map
    const teamsMap = new Map();
    const employeesWithManagers = [];

    users.forEach(user => {
      const userTeams = (user.idpTeams || []).filter((team) => {
        if (effectiveOrgId && team.organizationId !== effectiveOrgId) return false;
        if (scope.isHrPlus) return true;
        return accessibleTeamIds.has(team.id);
      });

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
          userId: getPreferredUserId(user),
          email: user.email,
          name: user.profile?.displayName ||
            `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
            user.email?.split('@')[0],
          jobTitle: user.profile?.title || team.role || 'Employee',
          teamRole: team.role,
          isManager: team.isManager || team.role === 'line_manager' || team.role === 'team_lead',
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
            userId: getPreferredUserId(user),
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
    const currentTeam = req.currentTeam || getCurrentTeam(req.session.user);

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
          isManager: currentTeam.isManager || currentTeam.role === 'line_manager' || currentTeam.role === 'team_lead',
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
    const sessionUser = req.session.user;
    // HR/Admin sees all org employees; line managers/team leads see hierarchy-scoped reports.
    if (!isAppraisalManagerRole(role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. HR/Admin, Line Manager, or Team Lead role required.'
      });
    }

    const scope = await resolveAppraisalAccessScope(req);
    const sourceEmployees = scope.isHrPlus ? scope.organizationUsers : scope.directReports;
    const employees = (sourceEmployees || []).map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      jobTitle: member.jobTitle,
      department: member.department,
      teamId: member.teamId,
      teamName: member.teamName,
      teamRole: member.teamRole,
      isManager: member.isManager,
      managerId: member.managerId || null,
      managerName: member.managerName || null,
      managerEmail: member.managerEmail || null
    }));

    let uniqueEmployees = Array.from(
      new Map(
        employees
          .map((employee) => {
            const key = employee.userId || employee.email;
            return key ? [key, employee] : null;
          })
          .filter(Boolean)
      ).values()
    );

    // Fallback for managers: if scope mapping is empty, try resolving direct reports from
    // current IDP claims + locally synced users (matched by idpSub).
    if (!scope.isHrPlus && uniqueEmployees.length === 0) {
      const effectiveOrgId = scope.organizationId || req.currentOrganization?.id || req.session?.currentOrganizationId;
      const claimDirectReportIds = new Set((req.directReports || []).filter(Boolean).map(String));
      const teams = sessionUser?.idpTeams || sessionUser?.teams || sessionUser?.userinfo?.teams || [];
      const teamPermissionRows = sessionUser?.idpTeamPermissions || sessionUser?.userinfo?.team_permissions || [];

      teams.forEach((team) => {
        (team?.directReports || []).forEach((id) => claimDirectReportIds.add(String(id)));
        (team?.directReportAccountIds || []).forEach((id) => claimDirectReportIds.add(String(id)));
      });
      teamPermissionRows.forEach((row) => {
        (row?.direct_reports || []).forEach((id) => claimDirectReportIds.add(String(id)));
      });

      const fallbackIds = Array.from(claimDirectReportIds).filter(Boolean);
      if (effectiveOrgId && fallbackIds.length > 0) {
        const fallbackUsers = await User.find({
          idpSub: { $in: fallbackIds },
          $or: [
            { currentOrganizationId: effectiveOrgId },
            { 'idpTeams.organizationId': effectiveOrgId }
          ]
        }).select('idpSub email profile idpTeams').lean();

        const fallbackEmployees = fallbackUsers.map((userDoc) => {
          const teamInOrg = (userDoc.idpTeams || []).find((team) => team.organizationId === effectiveOrgId) || userDoc.idpTeams?.[0];
          const name = userDoc.profile?.displayName ||
            `${userDoc.profile?.firstName || ''} ${userDoc.profile?.lastName || ''}`.trim() ||
            userDoc.email?.split('@')?.[0] ||
            'Unknown';

          return {
            userId: userDoc.idpSub || userDoc._id?.toString(),
            name,
            email: userDoc.email,
            jobTitle: userDoc.profile?.title || teamInOrg?.role || 'Employee',
            department: teamInOrg?.name || userDoc.profile?.department || '',
            teamId: teamInOrg?.id,
            teamName: teamInOrg?.name,
            teamRole: teamInOrg?.role,
            isManager: teamInOrg?.isManager || teamInOrg?.role === 'line_manager' || teamInOrg?.role === 'team_lead',
            managerId: teamInOrg?.managerId || null,
            managerName: teamInOrg?.managerName || null,
            managerEmail: teamInOrg?.managerEmail || null
          };
        });

        uniqueEmployees = Array.from(
          new Map(
            fallbackEmployees
              .map((employee) => {
                const key = employee.userId || normalizeEmail(employee.email);
                return key ? [key, employee] : null;
              })
              .filter(Boolean)
          ).values()
        );
      }
    }

    const managersMap = new Map();
    uniqueEmployees.forEach((employee) => {
      if (!employee.managerId) return;

      if (!managersMap.has(employee.managerId)) {
        managersMap.set(employee.managerId, {
          managerId: employee.managerId,
          managerName: employee.managerName || 'Manager',
          managerEmail: employee.managerEmail || null,
          directReports: []
        });
      }

      const manager = managersMap.get(employee.managerId);
      manager.directReports.push({
        userId: employee.userId,
        name: employee.name,
        email: employee.email,
        jobTitle: employee.jobTitle,
        teamName: employee.teamName
      });
    });

    // Group by manager for easy UI rendering
    const byManager = Array.from(managersMap.values()).sort((a, b) =>
      (a.managerName || '').localeCompare(b.managerName || '')
    );

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
    const sessionUser = req.session.user;
    if (!isAppraisalManagerRole(role)) {
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

    const scope = await resolveAppraisalAccessScope(req);
    let directReports = (scope.directReports || []).map((member) => ({
      userId: member.userId,
      email: member.email,
      name: member.name,
      jobTitle: member.jobTitle || 'Team Member',
      avatar: null,
      teamId: member.teamId,
      teamName: member.teamName,
      teamRole: member.teamRole || 'member',
      isAlsoManager: !!member.isManager,
      directReportCount: 0,
      source: 'organization-cache'
    }));

    if (directReports.length === 0) {
      const effectiveOrgId = scope.organizationId || req.currentOrganization?.id || req.session?.currentOrganizationId;
      const fallbackIds = Array.from(new Set((req.directReports || []).filter(Boolean).map(String)));

      if (effectiveOrgId && fallbackIds.length > 0) {
        const fallbackUsers = await User.find({
          idpSub: { $in: fallbackIds },
          $or: [
            { currentOrganizationId: effectiveOrgId },
            { 'idpTeams.organizationId': effectiveOrgId }
          ]
        }).select('idpSub email profile idpTeams').lean();

        directReports = fallbackUsers.map((userDoc) => {
          const teamInOrg = (userDoc.idpTeams || []).find((team) => team.organizationId === effectiveOrgId) || userDoc.idpTeams?.[0];
          const name = userDoc.profile?.displayName ||
            `${userDoc.profile?.firstName || ''} ${userDoc.profile?.lastName || ''}`.trim() ||
            userDoc.email?.split('@')?.[0] ||
            'Unknown';
          return {
            userId: userDoc.idpSub || userDoc._id?.toString(),
            email: userDoc.email,
            name,
            jobTitle: userDoc.profile?.title || 'Team Member',
            avatar: null,
            teamId: teamInOrg?.id,
            teamName: teamInOrg?.name,
            teamRole: teamInOrg?.role || 'member',
            isAlsoManager: !!(teamInOrg?.isManager || teamInOrg?.role === 'line_manager' || teamInOrg?.role === 'team_lead'),
            directReportCount: 0,
            source: 'idp-claim-fallback'
          };
        });
      }
    }

    const responseData = {
      isManager: true,
      managerId: sessionUser.id || sessionUser.sub,
      managerName: sessionUser.name,
      teams: (scope.managedTeams || []).map(t => ({
        id: t.id,
        name: t.name,
        role: t.role,
        memberCount: directReports.filter((member) => member.teamId === t.id).length
      })),
      directReports: directReports,
      totalDirectReports: directReports.length
    };

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
          isManager: requestedTeam.isManager || requestedTeam.role === 'line_manager' || requestedTeam.role === 'team_lead',
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
          isManager: t.isManager || t.role === 'line_manager' || t.role === 'team_lead'
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
            isManager: t.isManager || t.role === 'line_manager' || t.role === 'team_lead'
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
          isManager: currentTeam.isManager || currentTeam.role === 'line_manager' || currentTeam.role === 'team_lead',
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
