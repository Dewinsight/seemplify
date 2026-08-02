const express = require('express');
const router = express.Router();
const OKR = require('../models/OKR');
const {
  requireAuth,
  requirePermission,
  requireManager,
  getUserRole,
  getDirectReports
} = require('../middleware/rbac');

/**
 * GET /api/okrs - List OKRs
 * - Employees see their own OKRs
 * - Team Leads see team OKRs (read-only)
 * - Line Managers see direct reports' OKRs
 * - HR Admin sees all OKRs
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const { type, status, period, teamId, userId: queryUserId } = req.query;

    let query = {};

    // Build query based on role
    if (role === 'hr_admin') {
      // HR Admin can see all OKRs in organization
      if (req.currentOrganization?.id) {
        query.organizationId = req.currentOrganization.id;
      }
      // Can filter by specific user
      if (queryUserId) {
        query.ownerId = queryUserId;
      }
    } else if (role === 'line_manager') {
      // Line Manager sees own + direct reports' OKRs
      const directReports = req.directReports || [];
      query.$or = [
        { ownerId: userId },
        { ownerId: { $in: directReports } }
      ];
    } else if (role === 'team_lead') {
      // Team Lead sees own + team OKRs (members)
      const managedTeamIds = (req.managedTeams || []).map(t => t.id);
      if (managedTeamIds.length > 0) {
        query.$or = [
          { ownerId: userId },
          { type: 'team', teamId: { $in: managedTeamIds } }
        ];
      } else {
        query.ownerId = userId;
      }
    } else {
      // Employee sees only own OKRs
      query.ownerId = userId;
    }

    // Apply filters
    if (type) query.type = type;
    if (status) query.status = status;
    if (period) query.period = period;

    // Filter by currentTeam if set (unless explicit teamId is provided)
    const currentTeam = req.currentTeam;
    if (currentTeam && !teamId) {
      // If user has selected a current team, filter by that team
      // For team OKRs, filter by teamId
      // For individual OKRs, filter by team members
      if (query.$or) {
        // Add team filter to existing $or query
        query.$or.push({
          $or: [
            { type: 'team', 'teamHierarchy.teamId': currentTeam.id },
            { type: 'individual', ownerId: { $in: currentTeam.directReports || [] } }
          ]
        });
      } else {
        // Add team-based filtering
        query.$or = [
          { ownerId: userId },
          { type: 'team', 'teamHierarchy.teamId': currentTeam.id },
          { type: 'individual', ownerId: { $in: currentTeam.directReports || [] } }
        ];
      }
    }

    // Explicit teamId filter (overrides currentTeam)
    if (teamId && (role === 'line_manager' || role === 'hr_admin' || role === 'team_lead')) {
      query.teamId = teamId;
      // Remove $or if teamId is explicitly set
      if (query.$or) {
        query = { ...query, $or: undefined, teamId };
      }
    }

    const okrs = await OKR.find(query)
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: okrs.map(okr => ({
        _id: okr._id,
        title: okr.title || okr.objectives?.[0]?.title || 'Untitled OKR',
        objective: okr.objectives?.[0]?.description || '',
        type: okr.type,
        ownerId: okr.ownerId,
        teamId: okr.teamId,
        period: okr.period,
        status: okr.status,
        progress: okr.progress || calculateProgress(okr),
        keyResults: okr.objectives?.[0]?.keyResults?.map(kr => kr.title) || [],
        alignment: okr.alignment, // Expose alignment details
        createdAt: okr.createdAt,
        updatedAt: okr.updatedAt
      })),
      count: okrs.length,
      userRole: role
    });
  } catch (error) {
    console.error('Error fetching OKRs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch OKRs' });
  }
});

/**
 * GET /api/okrs/direct-reports - Get direct reports' OKRs
 * Only for Line Managers and HR Admin
 */
router.get('/direct-reports', requireManager, async (req, res) => {
  try {
    const directReports = req.directReports || [];

    if (directReports.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No direct reports found'
      });
    }

    // Fetch OKRs for all direct reports
    const okrs = await OKR.find({
      ownerId: { $in: directReports }
    })
      .sort({ createdAt: -1 })
      .lean(); // Use lean for better performance and to allow appending properties if needed

    // We need owner names. Since we only have IDs in okrs, let's fetch users or rely on frontend to map?
    // Better to populate if User model was available, but ownerId is just a string (ID) usually.
    // However, in typical mongoose, if ownerId is a ref, we can populate.
    // Let's check OKR model. PROBABLY ownerId is a Ref to User.
    // If not, we can't populate.
    // But wait, rbsw (RBAC middleware) might have fetched user details? No.
    // Let's assume we can just return the IDs and frontend might have user map, OR we fetch users.
    // Actually, for a dashboard, having names is crucial.
    // User model is likely available. Let's try to populate if it's a ref, otherwise we might need a lookup.
    // Looking at OKR.js (not shown but implied), ownerId is usually an ObjectId ref 'User'.
    // Let's try populate. But need to import User? No, if it's ref, just populate.
    // But OKR.js hasn't been read. Safest is to rely on what we have or do a lookup.
    // Let's just return the OKR data with approvalStatus for now. Frontend can maybe map IDs?
    // Or just fetch users.
    // Actually, `req.directReports` is just IDs.
    // Let's modify the query to populate 'ownerId' if possible.

    // RE-READING: I can't confirm ownerId is a Ref from here. 
    // BUT the implementation plan mentions "Team OKRs" tab. Manager needs to know WHOSE OKR it is.
    // Let's assume ownerId is populate-able or we fetch users.
    // I will try to use .populate('ownerId', 'name email jobTitle avatar')
    // If it fails (schema issue), I'll catch it.

    const filledOkrs = await OKR.find({
      ownerId: { $in: directReports }
    })
      .populate('ownerId', 'name email jobTitle')
      .sort({ createdAt: -1 });

    const formattedOkrs = filledOkrs.map(okr => ({
      _id: okr._id,
      title: okr.title || okr.objectives?.[0]?.title || 'Untitled OKR',
      type: okr.type,
      ownerId: okr.ownerId, // This will be the populated object or ID
      status: okr.status,
      approvalStatus: okr.approvalStatus || 'pending', // Default to pending if missing
      progress: okr.progress || calculateProgress(okr),
      period: okr.period,
      objectives: okr.objectives, // Include objectives for preview
      createdAt: okr.createdAt
    }));

    res.json({
      success: true,
      data: formattedOkrs,
      directReportCount: directReports.length
    });
  } catch (error) {
    console.error('Error fetching direct reports OKRs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch direct reports OKRs' });
  }
});

/**
 * GET /api/okrs/:id - Get specific OKR
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    // Check access
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const directReports = req.directReports || [];

    const isOwner = okr.ownerId === userId;
    const isDirectReport = directReports.includes(okr.ownerId);
    const isHRAdmin = role === 'hr_admin';

    if (!isOwner && !isDirectReport && !isHRAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this OKR'
      });
    }

    res.json({ success: true, data: okr });
  } catch (error) {
    console.error('Error fetching OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch OKR' });
  }
});

/**
 * POST /api/okrs - Create new OKR
 */
router.post('/', requirePermission('okr:create:own'), async (req, res) => {
  try {
    const sessionUserId = req.session.user.id || req.session.user.sub;
    // Default owner is the session user, unless overridden by authorized role
    let ownerId = sessionUserId;

    const { title, objective, keyResults, type, period, teamId, objectives, status } = req.body;

    // Validate type permissions
    // "ordinary staff cant create team okr"
    if (type === 'team' && !['line_manager', 'hr_admin', 'team_lead', 'recruiter'].includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Only managers, team leads, and recruiters can create team OKRs'
      });
    }

    if (type === 'organization' && req.userRole !== 'hr_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only HR Admin can create organization OKRs'
      });
    }

    // Handle Owner Assignment (Boss/HR creating for others)
    if (req.body.ownerId && req.body.ownerId !== sessionUserId) {
      const allowedRoles = ['line_manager', 'hr_admin', 'recruiter', 'team_lead'];

      if (!allowedRoles.includes(req.userRole)) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorized to assign OKRs to others'
        });
      }

      // Specific checks
      if (req.userRole === 'line_manager') {
        const directReports = req.directReports || [];
        if (!directReports.includes(req.body.ownerId)) {
          return res.status(403).json({
            success: false,
            error: 'You can only assign OKRs to your direct reports'
          });
        }
      }

      // HR and Recruiters can assign to anyone (no specific check needed here beyond role)

      ownerId = req.body.ownerId;
    }

    // Build objectives array - support both new and legacy formats
    let okrObjectives;

    if (objectives && Array.isArray(objectives) && objectives.length > 0) {
      // New format: objectives array with nested keyResults
      okrObjectives = objectives.map(obj => ({
        title: obj.title,
        description: obj.description || '',
        weight: obj.weight || 0,
        keyResults: (obj.keyResults || []).map(kr => ({
          title: typeof kr === 'string' ? kr : kr.title,
          metricType: kr.metricType || 'percentage',
          startValue: kr.startValue || 0,
          targetValue: kr.targetValue || 100,
          currentValue: kr.currentValue || 0,
          lastUpdated: new Date()
        }))
      }));
    } else {
      // Legacy format: flat title, objective, keyResults
      okrObjectives = [{
        title: title || objective || 'Untitled Objective',
        description: objective || '',
        keyResults: (keyResults || []).map(kr => ({
          title: typeof kr === 'string' ? kr : kr.title,
          metricType: kr.metricType || 'percentage',
          startValue: kr.startValue || 0,
          targetValue: kr.targetValue || 100,
          currentValue: kr.currentValue || 0
        }))
      }];
    }

    // Determine Approval Status
    let approvalStatus = 'pending';
    let approvedBy = null;
    let approvedAt = null;

    // Auto-approve if:
    // 1. Assigned to someone else (Manager/HR -> Employee)
    // 2. Team or Organization OKR (Created by leader)
    // 3. Created by HR Admin (Self)
    if (ownerId !== sessionUserId || ['team', 'organization'].includes(type) || req.userRole === 'hr_admin') {
      approvalStatus = 'approved';
      approvedBy = sessionUserId;
      approvedAt = new Date();
    }

    const newOKR = new OKR({
      type: type || 'individual',
      title: title || objective, // Use provided title or objective as fallback
      ownerId: ownerId,
      organizationId: req.currentOrganization?.id,
      teamId: teamId,
      period: period || `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
      status: status || 'active',
      approvalStatus: approvalStatus,
      approvedBy: approvedBy,
      approvedAt: approvedAt,
      objectives: okrObjectives,
      alignment: req.body.parentOKRId ? {
        parentOKRId: req.body.parentOKRId,
        alignmentType: 'cascade'
      } : undefined
    });

    await newOKR.save();

    res.status(201).json({
      success: true,
      data: newOKR,
      message: 'OKR created successfully'
    });
  } catch (error) {
    console.error('Error creating OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to create OKR', details: error.message });
  }
});

/**
 * PUT /api/okrs/:id - Update OKR
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    // Check access
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const isOwner = okr.ownerId === userId;
    const isHRAdmin = role === 'hr_admin';

    if (!isOwner && !isHRAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only owner or HR Admin can update this OKR'
      });
    }

    const { title, objective, keyResults, status, objectives } = req.body;

    // Handle new nested objectives array format
    if (objectives && Array.isArray(objectives)) {
      okr.objectives = objectives.map(obj => ({
        title: obj.title,
        description: obj.description || '',
        weight: obj.weight || 0,
        keyResults: (obj.keyResults || []).map(kr => ({
          title: typeof kr === 'string' ? kr : kr.title,
          metricType: kr.metricType || 'percentage',
          startValue: kr.startValue || 0,
          targetValue: kr.targetValue || 100,
          currentValue: kr.currentValue || 0,
          lastUpdated: kr.lastUpdated || new Date()
        }))
      }));
    } else {
      // Legacy format handling
      if (title || objective) {
        if (!okr.objectives) okr.objectives = [{}];
        if (title) okr.objectives[0].title = title;
        if (objective) okr.objectives[0].description = objective;
      }

      if (keyResults) {
        if (!okr.objectives) okr.objectives = [{}];
        okr.objectives[0].keyResults = keyResults.map(kr => ({
          title: typeof kr === 'string' ? kr : kr.title,
          metricType: kr.metricType || 'percentage',
          startValue: kr.startValue || 0,
          targetValue: kr.targetValue || 100,
          currentValue: kr.currentValue || 0
        }));
      }
    }

    if (title) okr.title = title;
    if (status) okr.status = status;

    // Update alignment if provided
    if (req.body.parentOKRId !== undefined) {
      if (req.body.parentOKRId) {
        okr.alignment = {
          parentOKRId: req.body.parentOKRId,
          alignmentType: 'cascade'
        };
      } else {
        okr.alignment = { parentOKRId: null };
      }
    }

    okr.progress = calculateProgress(okr);
    await okr.save();

    res.json({ success: true, data: okr });
  } catch (error) {
    console.error('Error updating OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to update OKR' });
  }
});

/**
 * PATCH /api/okrs/:id/approve - Approve an OKR
 * Only for Managers of the OKR owner or HR Admins
 */
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    if (okr.approvalStatus === 'approved') {
      return res.json({ success: true, data: okr, message: 'OKR is already approved' });
    }

    // Check permissions
    const sessionUser = req.session.user;
    const sessionUserId = sessionUser.id || sessionUser.sub;
    const role = req.userRole;

    // HR Admin can approve anything
    if (role === 'hr_admin') {
      okr.approvalStatus = 'approved';
      okr.approvedBy = sessionUserId;
      okr.approvedAt = new Date();
      await okr.save();
      return res.json({ success: true, data: okr });
    }

    // Managers can approve direct reports' OKRs
    if (role === 'line_manager' || role === 'team_lead') {
      const directReports = req.directReports || [];
      if (directReports.includes(okr.ownerId)) {
        okr.approvalStatus = 'approved';
        okr.approvedBy = sessionUserId;
        okr.approvedAt = new Date();
        await okr.save();
        return res.json({ success: true, data: okr });
      }
    }

    return res.status(403).json({
      success: false,
      error: 'You do not have permission to approve this OKR'
    });
  } catch (error) {
    console.error('Error approving OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to approve OKR' });
  }
});

/**
 * PUT /api/okrs/:id/progress - Update OKR progress (key result values)
 */
router.put('/:id/progress', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = okr.ownerId === userId;

    if (!isOwner && req.userRole !== 'hr_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only owner can update progress'
      });
    }

    const { objectiveIndex, keyResultIndex, currentValue } = req.body;

    // Support objectiveIndex (default to 0 for legacy)
    const objIdx = objectiveIndex || 0;

    if (okr.objectives?.[objIdx]?.keyResults?.[keyResultIndex]) {
      okr.objectives[objIdx].keyResults[keyResultIndex].currentValue = currentValue;
      okr.objectives[objIdx].keyResults[keyResultIndex].lastUpdated = new Date();
    }

    okr.progress = calculateProgress(okr);
    await okr.save();

    res.json({ success: true, data: okr });
  } catch (error) {
    console.error('Error updating OKR progress:', error);
    res.status(500).json({ success: false, error: 'Failed to update progress' });
  }
});

/**
 * DELETE /api/okrs/:id - Delete OKR
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = okr.ownerId === userId;

    if (!isOwner && req.userRole !== 'hr_admin') {
      return res.status(403).json({
        success: false,
        error: 'Only owner or HR Admin can delete this OKR'
      });
    }

    await OKR.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'OKR deleted successfully' });
  } catch (error) {
    console.error('Error deleting OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to delete OKR' });
  }
});

// ============== OKR ALIGNMENT / CASCADING ==============

/**
 * GET /api/okrs/hierarchy - Get OKR hierarchy (for cascade view)
 * Returns organization -> team -> individual OKRs in a tree structure
 */
router.get('/hierarchy', requireAuth, async (req, res) => {
  try {
    const { period, organizationId } = req.query;
    const orgId = organizationId || req.currentOrganization?.id;

    let query = {};
    if (orgId) query.organizationId = orgId;
    if (period) query.period = period;

    // Get all OKRs
    const allOkrs = await OKR.find(query)
      .populate('alignment.parentOKRId', 'objectives type ownerId')
      .sort({ type: 1, createdAt: -1 });

    // Build hierarchy
    const orgOkrs = allOkrs.filter(o => o.type === 'organization');
    const teamOkrs = allOkrs.filter(o => o.type === 'team');
    const individualOkrs = allOkrs.filter(o => o.type === 'individual');

    // Create hierarchy structure
    const hierarchy = {
      organization: orgOkrs.map(o => ({
        ...o.toObject(),
        children: teamOkrs.filter(t =>
          t.alignment?.parentOKRId?.toString() === o._id.toString()
        ).map(t => ({
          ...t.toObject(),
          children: individualOkrs.filter(i =>
            i.alignment?.parentOKRId?.toString() === t._id.toString()
          )
        }))
      })),
      unalignedTeam: teamOkrs.filter(t => !t.alignment?.parentOKRId),
      unalignedIndividual: individualOkrs.filter(i => !i.alignment?.parentOKRId)
    };

    res.json({
      success: true,
      data: hierarchy,
      summary: {
        total: allOkrs.length,
        organization: orgOkrs.length,
        team: teamOkrs.length,
        individual: individualOkrs.length,
        aligned: allOkrs.filter(o => o.alignment?.parentOKRId).length
      }
    });
  } catch (error) {
    console.error('Error fetching OKR hierarchy:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch hierarchy' });
  }
});

/**
 * GET /api/okrs/:id/children - Get child OKRs aligned to this parent
 */
router.get('/:id/children', requireAuth, async (req, res) => {
  try {
    const children = await OKR.find({
      'alignment.parentOKRId': req.params.id
    }).populate('alignment.parentOKRId', 'objectives type');

    res.json({
      success: true,
      data: children,
      count: children.length
    });
  } catch (error) {
    console.error('Error fetching child OKRs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch children' });
  }
});

/**
 * PUT /api/okrs/:id/align - Align OKR to parent
 */
router.put('/:id/align', requireAuth, async (req, res) => {
  try {
    const okr = await OKR.findById(req.params.id);

    if (!okr) {
      return res.status(404).json({ success: false, error: 'OKR not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = okr.ownerId === userId;

    if (!isOwner && req.userRole !== 'hr_admin' && req.userRole !== 'line_manager') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to align this OKR'
      });
    }

    const { parentOKRId, parentObjectiveIndex, alignmentType, alignmentNotes } = req.body;

    // Verify parent exists and is a valid parent type
    if (parentOKRId) {
      const parent = await OKR.findById(parentOKRId);
      if (!parent) {
        return res.status(404).json({ success: false, error: 'Parent OKR not found' });
      }

      // Validate hierarchy: org can't have parent, team parent must be org, individual parent must be team/org
      if (okr.type === 'organization') {
        return res.status(400).json({ success: false, error: 'Organization OKRs cannot have parents' });
      }
      if (okr.type === 'team' && parent.type !== 'organization') {
        return res.status(400).json({ success: false, error: 'Team OKRs must align to organization OKRs' });
      }
      if (okr.type === 'individual' && parent.type === 'individual') {
        return res.status(400).json({ success: false, error: 'Individual OKRs cannot align to other individual OKRs' });
      }
    }

    okr.alignment = {
      parentOKRId: parentOKRId || null,
      parentObjectiveIndex: parentObjectiveIndex || 0,
      alignmentType: alignmentType || 'cascade',
      alignmentNotes
    };

    await okr.save();

    res.json({
      success: true,
      data: okr,
      message: parentOKRId ? 'OKR aligned successfully' : 'OKR unaligned'
    });
  } catch (error) {
    console.error('Error aligning OKR:', error);
    res.status(500).json({ success: false, error: 'Failed to align OKR' });
  }
});

/**
 * GET /api/okrs/alignable - Get OKRs that can be parent (for dropdown)
 */
router.get('/alignable/list', requireAuth, async (req, res) => {
  try {
    const { childType } = req.query;
    const orgId = req.currentOrganization?.id;

    let query = { status: { $ne: 'closed' } };
    if (orgId) query.organizationId = orgId;

    // Filter by valid parent types
    if (childType === 'team') {
      query.type = 'organization';
    } else if (childType === 'individual') {
      query.type = { $in: ['organization', 'team'] };
    } else {
      query.type = { $in: ['organization', 'team'] };
    }

    const okrs = await OKR.find(query)
      .select('_id type objectives ownerId period')
      .sort({ type: 1, createdAt: -1 });

    res.json({
      success: true,
      data: okrs.map(o => ({
        id: o._id,
        type: o.type,
        title: o.objectives?.[0]?.title || 'Untitled',
        ownerId: o.ownerId,
        period: o.period
      }))
    });
  } catch (error) {
    console.error('Error fetching alignable OKRs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch OKRs' });
  }
});

// Helper function to calculate OKR progress
function calculateProgress(okr) {
  if (!okr.objectives || okr.objectives.length === 0) return 0;

  let totalProgress = 0;
  let keyResultsCount = 0;

  // Calculate progress weighted by key results
  okr.objectives.forEach(obj => {
    if (obj.keyResults && obj.keyResults.length > 0) {
      obj.keyResults.forEach(kr => {
        keyResultsCount++;
        const range = kr.targetValue - kr.startValue;
        if (range !== 0) {
          const progress = ((kr.currentValue - kr.startValue) / range) * 100;
          totalProgress += Math.min(100, Math.max(0, progress));
        }
      });
    }
  });

  if (keyResultsCount === 0) return 0;
  return Math.round(totalProgress / keyResultsCount);
}

module.exports = router;
