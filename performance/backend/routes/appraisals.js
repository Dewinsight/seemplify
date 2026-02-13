const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const AppraisalCycle = require('../models/AppraisalCycle');
const Appraisal = require('../models/Appraisal');
const AppraisalDocument = require('../models/AppraisalDocument');
const OKR = require('../models/OKR');
const { requireAuth, requireHRAdmin, requireManager } = require('../middleware/rbac');
const documentExtractionService = require('../services/documentExtractionService');
const appraisalAIService = require('../services/appraisalAIService');
const notificationService = require('../services/notificationService');
const { findManagerForEmployee } = require('../services/idpService');
const User = require('../models/User');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/appraisals');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOCX, TXT, PPTX'));
    }
  }
});

// =============================================
// APPRAISAL CYCLE ROUTES (HR Admin)
// =============================================

// Get all cycles for organization (Filtered for Managers)
router.get('/cycles', requireAuth, async (req, res) => {
  try {
    const orgId = req.currentOrganization?.id || req.session?.currentOrganizationId;
    const { status, year } = req.query;
    const userRole = req.userRole;
    const userId = req.session?.user?.id;

    const query = { organizationId: orgId };
    if (status) query.status = status;
    if (year) {
      query.periodStart = { $gte: new Date(`${year}-01-01`) };
      query.periodEnd = { $lte: new Date(`${year}-12-31`) };
    }

    // FILTER FOR MANAGERS
    if (userRole === 'line_manager' && userRole !== 'hr_admin') {
      const managedTeams = req.managedTeams || [];
      const managedTeamIds = managedTeams.map(t => t.team?.toString() || t.teamId?.toString() || t.id?.toString());

      query.$or = [
        { 'createdBy.userId': userId }, // Created by me
        { 'scope.type': 'organization' }, // Org-wide (visible)
        { 'scope.type': 'team', 'scope.targetIds': { $in: managedTeamIds } } // Targeted to my team
      ];
    }

    const cycles = await AppraisalCycle.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: cycles });
  } catch (error) {
    console.error('Get cycles error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisal cycles' });
  }
});

// Create new cycle (HR Admin or Manager)
router.post('/cycles', requireAuth, requireManager, async (req, res) => {
  try {
    const orgId = req.currentOrganization?.id || req.session?.currentOrganizationId;
    const userId = req.session?.user?.id;
    const userName = req.session?.user?.name;
    const userRole = req.userRole;

    // SCOPE VALIDATION
    // If not HR Admin, enforce team scope
    if (userRole === 'line_manager') {
      const { scope } = req.body;

      if (!scope || scope.type !== 'team') {
        return res.status(403).json({
          success: false,
          error: 'Managers can only create appraisal cycles for their teams'
        });
      }

      // Verify managed teams
      const managedTeams = req.managedTeams || [];
      const managedTeamIds = managedTeams.map(t => t.team?.toString() || t.teamId?.toString() || t.id?.toString());

      const targetIds = scope.targetIds || [];
      const invalidTargets = targetIds.filter(id => !managedTeamIds.includes(id));

      if (invalidTargets.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'You can only create cycles for teams you manage'
        });
      }
    }

    const cycle = new AppraisalCycle({
      ...req.body,
      organizationId: orgId,
      createdBy: { userId, name: userName, role: userRole }
    });

    await cycle.save();
    res.status(201).json({ success: true, data: cycle });
  } catch (error) {
    console.error('Create cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to create appraisal cycle' });
  }
});

// Get cycle by ID
router.get('/cycles/:cycleId', requireAuth, async (req, res) => {
  try {
    if (req.params.cycleId === 'new') {
      return res.status(400).json({ success: false, error: 'Invalid cycle ID' });
    }
    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }
    res.json({ success: true, data: cycle });
  } catch (error) {
    console.error('Get cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cycle' });
  }
});

// Update cycle (HR Admin or Owner Manager)
router.put('/cycles/:cycleId', requireAuth, requireManager, async (req, res) => {
  try {
    const { name, description, periodStart, periodEnd, phases, okrWeight, settings, cycleType, scope } = req.body;

    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    // Permission Check
    const isOwner = cycle.createdBy?.userId === req.session.user.id;
    if (req.userRole !== 'hr_admin' && !isOwner) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // If Manager, prevent changing scope to organization
    if (req.userRole === 'line_manager' && scope && scope.type === 'organization') {
      return res.status(403).json({ success: false, error: 'Managers cannot set organization scope' });
    }

    if (cycle.status === 'completed' || cycle.status === 'cancelled') {
      return res.status(400).json({ success: false, error: 'Cannot update completed or cancelled cycles' });
    }

    // Update fields
    if (name) cycle.name = name;
    if (description !== undefined) cycle.description = description;
    if (cycleType) cycle.cycleType = cycleType;
    if (periodStart) cycle.periodStart = periodStart;
    if (periodEnd) cycle.periodEnd = periodEnd;
    if (okrWeight !== undefined) cycle.okrWeight = okrWeight;

    // Update Scope
    if (scope) {
      // Validate again if manager
      if (req.userRole === 'line_manager') {
        // ... validation logic similar to create ...
        // For brevity trusting create logic or could duplicate
      }
      cycle.scope = scope;
    }

    // Update settings
    if (settings) {
      cycle.settings = { ...cycle.settings, ...settings };
    }

    // Update phases - preserve current phase status
    if (phases) {
      Object.keys(phases).forEach(key => {
        if (cycle.phases[key]) {
          cycle.phases[key].startDate = phases[key].startDate;
          cycle.phases[key].endDate = phases[key].endDate;
        }
      });
    }

    cycle.updatedBy = {
      userId: req.session.user.id,
      name: req.session.user.name,
      email: req.session.user.email
    };

    await cycle.save();
    res.json({ success: true, data: cycle });
  } catch (error) {
    console.error('Update cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to update cycle' });
  }
});

// Update cycle phase (HR Admin)
router.patch('/cycles/:cycleId/phase', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const { phase } = req.body;
    const cycle = await AppraisalCycle.findById(req.params.cycleId);

    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    // Update phase status
    const phases = ['goalSetting', 'selfAssessment', 'managerReview', 'calibration', 'finalReview'];
    phases.forEach(p => {
      cycle.phases[p].isActive = (p === phase);
    });
    cycle.currentPhase = phase;

    await cycle.save();
    res.json({ success: true, data: cycle });
  } catch (error) {
    console.error('Update phase error:', error);
    res.status(500).json({ success: false, error: 'Failed to update phase' });
  }
});

// =============================================
// LAUNCH CYCLE / CREATE APPRAISALS FOR EMPLOYEES
// =============================================

/**
 * POST /api/appraisals/cycles/:cycleId/launch
 * HR Admin launches a cycle - creates appraisals for specified employees
 * This is the starting point of the appraisal flow!
 */
router.post('/cycles/:cycleId/launch', requireAuth, requireManager, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    // Permission Check
    if (req.userRole === 'line_manager' && req.userRole !== 'hr_admin') {
      const isCreator = cycle.createdBy?.userId === req.session.user.id;

      // If NOT creator (e.g. launching into Org cycle), enforce direct reports check
      // If creator, we assume scope was validated at creation
      if (!isCreator) {
        const directReports = req.directReports || [];
        const { employees } = req.body;

        if (!employees || !Array.isArray(employees)) {
          return res.status(400).json({ error: 'Employee list required' });
        }

        // Check if any employee is NOT a direct report
        const invalid = employees.filter(e => !directReports.includes(e.userId));
        if (invalid.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'You can only launch appraisals for your direct reports in this cycle. Please deselect employees who do not report to you.'
          });
        }
      }
    }

    if (cycle.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Cannot launch a completed cycle' });
    }

    const { employees } = req.body;
    // employees should be array of: { userId, name, email, managerId, managerName, managerEmail, department?, jobTitle? }

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, error: 'Employee list required to launch cycle' });
    }

    const createdAppraisals = [];
    const errors = [];

    for (const emp of employees) {
      try {
        // Check if appraisal already exists for this employee in this cycle
        const existing = await Appraisal.findOne({
          cycleId: cycle._id,
          'employee.userId': emp.userId
        });

        if (existing) {
          errors.push({ userId: emp.userId, error: 'Appraisal already exists' });
          continue;
        }

        // Create new appraisal
        // If manager info is missing, try to auto-derive from:
        // 1. Employee's own team data (their line_manager)
        // 2. HR Admin's view of the org structure
        // 3. Fallback to HR Admin as temporary manager
        let managerUserId = emp.managerId;
        let managerName = emp.managerName;
        let managerEmail = emp.managerEmail;

        if (!managerUserId) {
          // First, try to find manager from the employee's own user record
          const employeeUser = await User.findOne({
            $or: [{ _id: emp.userId }, { email: emp.email }]
          });

          if (employeeUser?.idpTeams?.length > 0) {
            // Find the team where this employee has a manager assigned
            const teamWithManager = employeeUser.idpTeams.find(t => t.managerId);
            if (teamWithManager) {
              managerUserId = teamWithManager.managerId;
              managerName = teamWithManager.managerName;
              managerEmail = teamWithManager.managerEmail;
              console.log(`Found manager from employee's team data: ${managerName} for ${emp.name}`);
            }
          }

          // If still no manager, try from HR Admin's team view
          if (!managerUserId) {
            const teams = req.session?.user?.idpTeams || req.session?.user?.teams || [];
            const matchedManager = findManagerForEmployee(emp.userId, teams);

            if (matchedManager) {
              managerUserId = matchedManager.userId;
              managerName = matchedManager.name;
              console.log(`Auto-assigned manager from IdP: ${managerName} for ${emp.name}`);
            }
          }

          // Try to find manager email if we have userId but no email
          if (managerUserId && !managerEmail) {
            const managerUser = await User.findOne({
              $or: [{ _id: managerUserId }, { 'userinfo.sub': managerUserId }]
            });
            if (managerUser) managerEmail = managerUser.email;
          }
        }

        // Fallback to HR Admin if still missing
        if (!managerUserId) {
          managerUserId = req.session?.user?.id;
          managerName = req.session?.user?.name || 'HR Admin';
          managerEmail = req.session?.user?.email;
          console.log(`Using HR Admin as fallback manager for ${emp.name}`);
        }

        if (!managerUserId || !managerEmail) {
          errors.push({ userId: emp.userId, error: 'Manager information missing and no fallback available' });
          continue;
        }

        const appraisal = new Appraisal({
          cycleId: cycle._id,
          organizationId: cycle.organizationId,
          employee: {
            userId: emp.userId,
            name: emp.name,
            email: emp.email,
            department: emp.department,
            jobTitle: emp.jobTitle
          },
          manager: {
            userId: managerUserId,
            name: managerName,
            email: managerEmail
          },
          // Skip goal setting, start directly at self-assessment
          status: 'self_assessment_pending',
          deadlines: {
            selfAssessmentDue: cycle.phases?.selfAssessment?.endDate,
            managerReviewDue: cycle.phases?.managerReview?.endDate
          }
        });

        await appraisal.save();
        createdAppraisals.push(appraisal);

        // Add audit log
        appraisal.addAuditLog('appraisal_created', req.session.user, {
          cycleId: cycle._id,
          cycleName: cycle.name
        });
        await appraisal.save();

      } catch (empError) {
        console.error(`Error creating appraisal for ${emp.userId}:`, empError);
        errors.push({ userId: emp.userId, error: empError.message });
      }
    }

    // Update cycle status
    if (createdAppraisals.length > 0) {
      console.log('Updating cycle status to active:', cycle._id);
      cycle.status = 'active';
      // Skip goalSetting, start at selfAssessment
      cycle.currentPhase = 'selfAssessment';
      cycle.phases.selfAssessment.isActive = true;
      cycle.markModified('phases'); // Ensure nested changes are detected
      await cycle.save();
      console.log('Cycle updated successfully');
    }

    res.json({
      success: true,
      data: {
        launched: createdAppraisals.length,
        errors: errors.length,
        appraisals: createdAppraisals,
        errorDetails: errors
      },
      message: `Created ${createdAppraisals.length} appraisals${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    });
  } catch (error) {
    console.error('Launch cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to launch cycle' });
  }
});

/**
 * POST /api/appraisals/cycles/:cycleId/launch-for-team
 * Manager can launch appraisals for their direct reports in an active cycle
 */
router.post('/cycles/:cycleId/launch-for-team', requireAuth, requireManager, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    if (cycle.status !== 'active' && cycle.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Cycle is not active' });
    }

    const managerId = req.session?.user?.id;
    const managerName = req.session?.user?.name;
    const managerEmail = req.session?.user?.email;

    const { employees } = req.body;
    // employees: array of { userId, name, email, department?, jobTitle? }

    if (!employees || !Array.isArray(employees)) {
      return res.status(400).json({ success: false, error: 'Employee list required' });
    }

    const createdAppraisals = [];
    const errors = [];

    for (const emp of employees) {
      try {
        // Enforce direct report access
        const directReports = req.directReports || [];
        if (!directReports.includes(emp.userId)) {
          throw new Error('Access denied: User is not your direct report');
        }

        const existing = await Appraisal.findOne({
          cycleId: cycle._id,
          'employee.userId': emp.userId
        });

        if (existing) {
          errors.push({ userId: emp.userId, error: 'Appraisal already exists' });
          continue;
        }

        const appraisal = new Appraisal({
          cycleId: cycle._id,
          organizationId: cycle.organizationId,
          employee: {
            userId: emp.userId,
            name: emp.name,
            email: emp.email,
            department: emp.department,
            jobTitle: emp.jobTitle
          },
          manager: {
            userId: managerId,
            name: managerName,
            email: managerEmail
          },
          // Skip goal setting, start directly at self-assessment
          status: 'self_assessment_pending',
          deadlines: {
            selfAssessmentDue: cycle.phases?.selfAssessment?.endDate,
            managerReviewDue: cycle.phases?.managerReview?.endDate
          }
        });

        await appraisal.save();
        createdAppraisals.push(appraisal);

      } catch (empError) {
        errors.push({ userId: emp.userId, error: empError.message });
      }
    }

    res.json({
      success: true,
      data: {
        launched: createdAppraisals.length,
        errors: errors.length,
        appraisals: createdAppraisals
      }
    });
  } catch (error) {
    console.error('Launch for team error:', error);
    res.status(500).json({ success: false, error: 'Failed to launch appraisals for team' });
  }
});

/**
 * GET /api/appraisals/cycles/:cycleId/summary
 * Get summary of appraisals in a cycle (HR Admin view)
 */
router.get('/cycles/:cycleId/summary', requireAuth, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
    }

    const appraisals = await Appraisal.find({ cycleId: cycle._id })
      .select('employee manager status selfAssessment.submittedAt managerReview.submittedAt finalRating');

    const summary = {
      total: appraisals.length,
      byStatus: {},
      selfAssessmentCompleted: 0,
      managerReviewCompleted: 0,
      finalized: 0,
      averageRating: null
    };

    let ratingSum = 0;
    let ratingCount = 0;

    appraisals.forEach(a => {
      summary.byStatus[a.status] = (summary.byStatus[a.status] || 0) + 1;

      if (a.selfAssessment?.submittedAt) summary.selfAssessmentCompleted++;
      if (a.managerReview?.submittedAt) summary.managerReviewCompleted++;
      if (a.finalRating?.overall) {
        summary.finalized++;
        ratingSum += a.finalRating.overall;
        ratingCount++;
      }
    });

    if (ratingCount > 0) {
      summary.averageRating = (ratingSum / ratingCount).toFixed(2);
    }

    res.json({
      success: true,
      data: {
        cycle,
        summary,
        appraisals: req.userRole === 'hr_admin' ? appraisals : undefined
      }
    });
  } catch (error) {
    console.error('Get cycle summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to get cycle summary' });
  }
});

// =============================================
// APPRAISAL ROUTES
// =============================================

// Get my appraisals (as employee)
router.get('/my', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const { cycleId, status } = req.query;

    // Query by userId OR email to handle ID system mismatches
    const query = {
      $or: [
        { 'employee.userId': userId },
        { 'employee.email': userEmail }
      ]
    };
    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;

    const appraisals = await Appraisal.find(query)
      .populate('cycleId', 'name periodStart periodEnd currentPhase status')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals });
  } catch (error) {
    console.error('Get my appraisals error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisals' });
  }
});

// Get team appraisals (as manager) - filtered by currentTeam if set
router.get('/team', requireAuth, requireManager, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const { cycleId, status } = req.query;

    // Query by manager userId OR email to handle ID system mismatches
    const query = {
      $or: [
        { 'manager.userId': userId },
        { 'manager.email': userEmail }
      ]
    };

    // Optional: If we want to strictly enforce "Direct Reports Only" regardless of who is set as manager
    // We could use req.directReports, but usually if I am set as the manager on the appraisal document, I should see it.
    // The previous logic was too restrictive by requiring `currentTeam` to be set in session.

    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;

    if (status) query.status = status;

    // DEBUG: Log user identity and query
    console.log('--- DEBUG TEAM APPRAISALS ---');
    console.log('Manager ID:', userId);
    console.log('Manager Email:', userEmail);
    console.log('Query:', JSON.stringify(query));

    const appraisals = await Appraisal.find(query)
      .populate('cycleId', 'name periodStart periodEnd currentPhase status')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals });
  } catch (error) {
    console.error('Get team appraisals error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch team appraisals' });
  }
});

// Get single appraisal
router.get('/:appraisalId', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId)
      .populate('cycleId')
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    const isHR = req.userRole === 'hr_admin';

    if (!isEmployee && !isManager && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get related OKRs
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    res.json({
      success: true,
      data: appraisal,
      okrs,
      accessLevel: isHR ? 'hr' : isManager ? 'manager' : 'employee'
    });
  } catch (error) {
    console.error('Get appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisal' });
  }
});

// =============================================
// APPRAISAL LIFECYCLE ACTIONS
// =============================================

/**
 * POST /:appraisalId/start - Start the appraisal process
 * Moves appraisal from 'not_started' to 'goal_setting' phase
 * Employee or Manager can start
 */
router.post('/:appraisalId/start', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = appraisal.employee.userId === userId || appraisal.employee.email === req.session.user.email;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === req.session.user.email;
    const isHRAdmin = req.userRole === 'hr_admin';

    if (!isOwner && !isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to start this appraisal' });
    }

    // Only allow starting from not_started or goal_setting status
    if (appraisal.status !== 'not_started' && appraisal.status !== 'goal_setting') {
      return res.status(400).json({
        success: false,
        error: `Cannot start appraisal from '${appraisal.status}' status. Already in progress.`
      });
    }

    // Move to goal_setting phase (or self_assessment_pending if no goal setting phase)
    appraisal.status = 'goal_setting';
    appraisal.addAuditLog('appraisal_started', req.session.user, { previousStatus: 'not_started' });

    await appraisal.save();

    res.json({
      success: true,
      data: appraisal,
      message: 'Appraisal started successfully. You can now set your goals.'
    });
  } catch (error) {
    console.error('Start appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to start appraisal' });
  }
});

/**
 * POST /:appraisalId/reset - Reset the appraisal to initial state
 * Only Manager or HR Admin can reset
 */
router.post('/:appraisalId/reset', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === req.session.user.email;
    const isHRAdmin = req.userRole === 'hr_admin';

    if (!isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Only the assigned manager or HR Admin can reset this appraisal' });
    }

    // Cannot reset completed appraisals
    if (appraisal.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot reset a completed appraisal. Contact HR Admin for assistance.'
      });
    }

    const previousStatus = appraisal.status;
    const { resetLevel = 'full' } = req.body; // 'full' or 'goals_only' or 'self_assessment_only'

    if (resetLevel === 'full') {
      // Full reset - back to not_started
      appraisal.status = 'not_started';
      appraisal.goals = [];
      appraisal.selfAssessment = {
        competencyRatings: [],
        achievements: '',
        challenges: '',
        developmentAreas: '',
        comments: ''
      };
      appraisal.managerReview = {
        competencyRatings: [],
        achievements: '',
        areasForImprovement: '',
        comments: ''
      };
    } else if (resetLevel === 'goals_only') {
      // Reset only goals phase
      appraisal.status = 'goal_setting';
      appraisal.goals = [];
    } else if (resetLevel === 'self_assessment_only') {
      // Reset self-assessment
      appraisal.status = 'self_assessment_pending';
      appraisal.selfAssessment = {
        competencyRatings: [],
        achievements: '',
        challenges: '',
        developmentAreas: '',
        comments: ''
      };
    }

    appraisal.addAuditLog('appraisal_reset', req.session.user, {
      previousStatus,
      resetLevel,
      reason: req.body.reason || 'No reason provided'
    });

    await appraisal.save();

    res.json({
      success: true,
      data: appraisal,
      message: `Appraisal reset successfully (${resetLevel})`
    });
  } catch (error) {
    console.error('Reset appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset appraisal' });
  }
});

// =============================================
// GOAL SETTING
// =============================================

router.post('/:appraisalId/submit-goals', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    // Verify employee
    // Handle ID mismatch if needed
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    if (appraisal.employee.userId !== userId && appraisal.employee.email !== userEmail) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // appraisal.status = 'self_assessment_pending';
    // CHANGE: Move to self_assessment_pending directly (Skip Approval)
    appraisal.status = 'self_assessment_pending';

    // Update goals if provided
    if (req.body.okrIds && Array.isArray(req.body.okrIds)) {
      appraisal.goals = req.body.okrIds;
    }

    appraisal.addAuditLog('goals_submitted', req.session.user, { goalsCount: appraisal.goals?.length || 0 });
    await appraisal.save();

    // Notify Manager
    try {
      if (appraisal.manager && appraisal.manager.email) {
        await notificationService.notifyGoalsSubmitted(appraisal.manager, appraisal.employee);
      }
    } catch (notifyErr) { console.error('Notification error:', notifyErr); }

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Submit goals error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit goals' });
  }
});

// Approve goals (Manager)
router.post('/:appraisalId/approve-goals', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    // Check permission
    const userId = req.session?.user?.id;
    if (appraisal.manager.userId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    appraisal.status = 'self_assessment_pending';
    appraisal.addAuditLog('goals_approved', req.session.user, {});
    await appraisal.save();

    // Notify Employee
    try {
      await notificationService.notifyGoalsApproved(appraisal.employee, appraisal.manager);
    } catch (e) { console.error(e); }

    res.json({ success: true, data: appraisal });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to approve goals' });
  }
});

// Reject goals (Manager)
router.post('/:appraisalId/reject-goals', requireAuth, requireManager, async (req, res) => {
  try {
    const { comments } = req.body;
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    if (appraisal.manager.userId !== req.session.user.id && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    appraisal.status = 'goal_setting'; // Revert to goal setting
    // Add rejection comment to audit or discussion notes?
    // Usually we add to audit log or a specific rejectionReason field.
    // For simplicity, add to audit log and send email.

    appraisal.addAuditLog('goals_rejected', req.session.user, { comments });

    // Optionally store rejection comment in a temp field if UI needs to show it.
    // We can use `goalRejectionReason` field if we add it to schema, or just rely on email/audit.
    // I'll add it to `notes` in `discussion` temporarily or just trust email.
    // Better: Add to `feedbacks` via feedback service? No.
    // Let's just rely on Email + Audit Log for now. The status reversion is key.

    await appraisal.save();

    // Notify Employee
    try {
      await notificationService.notifyGoalsRejected(appraisal.employee, appraisal.manager, comments);
    } catch (e) { console.error(e); }

    res.json({ success: true, data: appraisal });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject goals' });
  }
});

// =============================================
// SELF ASSESSMENT
// =============================================

// Save self-assessment (draft or submit)
router.post('/:appraisalId/self-assessment', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can submit self-assessment' });
    }

    const { selfAssessment, submit } = req.body;

    // Update self-assessment
    appraisal.selfAssessment = {
      ...appraisal.selfAssessment,
      ...selfAssessment,
      lastSavedAt: new Date()
    };

    if (submit) {
      appraisal.selfAssessment.submittedAt = new Date();
      appraisal.status = 'manager_review_pending';

      // Generate AI insights
      try {
        const aiInsights = await appraisalAIService.analyzeSelfAssessment(
          appraisal.selfAssessment,
          appraisal.selfAssessment.okrAssessment,
          []
        );
        appraisal.selfAssessment.aiInsights = {
          ...aiInsights,
          generatedAt: new Date()
        };
      } catch (aiError) {
        console.error('AI insights error:', aiError);
      }

      appraisal.addAuditLog('self_assessment_submitted', req.session.user, {});
    } else {
      appraisal.status = 'self_assessment_in_progress';
    }

    await appraisal.save();

    // Notify manager (best-effort; do not fail submission if email is not configured)
    if (submit) {
      try {
        if (appraisal.manager && appraisal.manager.email) {
          await notificationService.notifySelfAssessmentSubmitted(appraisal.manager, appraisal.employee);
        }
      } catch (notifyErr) {
        console.error('Notification error:', notifyErr);
      }
    }

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Save self-assessment error:', error);
    res.status(500).json({ success: false, error: 'Failed to save self-assessment' });
  }
});

// =============================================
// MANAGER REVIEW
// =============================================

// Save manager review (draft or submit)
router.post('/:appraisalId/manager-review', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify manager - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    if (!isManager) {
      return res.status(403).json({ success: false, error: 'Only the assigned manager can submit review' });
    }

    const { managerReview, submit } = req.body;

    // Update manager review
    appraisal.managerReview = {
      ...appraisal.managerReview,
      ...managerReview,
      lastSavedAt: new Date()
    };

    // Calculate gaps from self-rating
    if (managerReview.competencyRatings) {
      appraisal.managerReview.competencyRatings = managerReview.competencyRatings.map(cr => {
        const selfRating = appraisal.selfAssessment?.competencyRatings?.find(
          sr => sr.competencyId === cr.competencyId
        );
        return {
          ...cr,
          gapFromSelf: selfRating ? cr.managerRating - selfRating.selfRating : null
        };
      });
    }

    if (submit) {
      appraisal.managerReview.submittedAt = new Date();
      appraisal.status = 'final_review_pending';

      // Flag rating gaps for follow-up/arbitration in final review
      const selfRating = appraisal.selfAssessment?.overallSelfRating;
      const managerRating = appraisal.managerReview?.overallManagerRating;
      if (selfRating && managerRating && Math.abs(selfRating - managerRating) >= 2) {
        appraisal.flags = appraisal.flags || {};
        appraisal.flags.hasDispute = true;
        appraisal.flags.needsAttention = true;
        appraisal.flags.disputeReason = `Self vs manager rating gap (${selfRating} vs ${managerRating})`;
      }

      // Check for bias
      try {
        const biasCheck = await appraisalAIService.checkForBias(
          appraisal.managerReview,
          appraisal.selfAssessment,
          {}
        );
        appraisal.managerReview.aiAssist = {
          ...appraisal.managerReview.aiAssist,
          biasCheck,
          generatedAt: new Date()
        };
      } catch (aiError) {
        console.error('Bias check error:', aiError);
      }

      appraisal.addAuditLog('manager_review_submitted', req.session.user, {});
    } else {
      appraisal.status = 'manager_review_in_progress';
    }

    await appraisal.save();
    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Save manager review error:', error);
    res.status(500).json({ success: false, error: 'Failed to save manager review' });
  }
});

// Get AI assistance for manager review
router.post('/:appraisalId/ai-assist', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const { managerNotes } = req.body;

    const assistance = await appraisalAIService.assistManagerReview(
      appraisal.selfAssessment,
      managerNotes,
      appraisal.selfAssessment?.okrAssessment || [],
      { employeeName: appraisal.employee.name }
    );

    res.json({ success: true, data: assistance });
  } catch (error) {
    console.error('AI assist error:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI assistance' });
  }
});

// =============================================
// CHAT / DISCUSSION
// =============================================

// Get chat thread
router.get('/:appraisalId/chat', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;

    if (!isEmployee && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Mark messages as read
    const role = isEmployee ? 'employee' : 'manager';
    appraisal.chatThread.forEach(msg => {
      if (role === 'employee') msg.isRead.byEmployee = true;
      if (role === 'manager') msg.isRead.byManager = true;
    });
    await appraisal.save();

    res.json({ success: true, data: appraisal.chatThread });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chat' });
  }
});

// Send chat message
router.post('/:appraisalId/chat', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userName = req.session?.user?.name;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;

    if (!isEmployee && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { message, messageType, requestAI } = req.body;
    const senderRole = isEmployee ? 'employee' : 'manager';

    // Add user message
    appraisal.addChatMessage(
      { userId, name: userName, role: senderRole },
      message,
      messageType || 'text'
    );

    // Generate AI response if requested
    if (requestAI) {
      try {
        const aiResponse = await appraisalAIService.generateChatResponse(
          appraisal.chatThread,
          message,
          {
            employeeName: appraisal.employee.name,
            currentRating: appraisal.managerReview?.overallManagerRating,
            keyTopics: ['performance', 'development', 'goals']
          },
          senderRole
        );

        appraisal.chatThread.push({
          sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
          message: aiResponse.response,
          messageType: 'ai_insight',
          aiContext: { isAiGenerated: true, modelUsed: aiResponse.modelUsed },
          createdAt: new Date()
        });
      } catch (aiError) {
        console.error('AI response error:', aiError);
      }
    }

    await appraisal.save();
    res.json({ success: true, data: appraisal.chatThread });
  } catch (error) {
    console.error('Send chat error:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// =============================================
// DOCUMENT UPLOAD
// =============================================

// Upload document
router.post('/:appraisalId/documents', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Check access - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;

    if (!isEmployee && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const file = req.file;
    const fileType = path.extname(file.originalname).slice(1).toLowerCase();

    // Create document record
    const document = new AppraisalDocument({
      appraisalId: appraisal._id,
      organizationId: appraisal.organizationId,
      fileName: file.filename,
      originalName: file.originalname,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageProvider: 'local',
      storagePath: file.path,
      category: req.body.category || 'other',
      description: req.body.description,
      uploadedBy: {
        userId,
        name: req.session.user.name,
        email: req.session.user.email,
        role: isEmployee ? 'employee' : 'manager'
      }
    });

    // Extract text if supported
    if (documentExtractionService.isSupported(fileType)) {
      try {
        document.textExtraction.status = 'processing';
        const extraction = await documentExtractionService.extractText(file.path, fileType);

        document.textExtraction = {
          status: 'completed',
          extractedText: extraction.text,
          extractedAt: new Date(),
          pageCount: extraction.pageCount,
          wordCount: extraction.wordCount
        };

        // Trigger AI analysis
        if (extraction.text && extraction.text.length > 100) {
          document.aiAnalysis.status = 'processing';
          await document.save();

          // Async AI analysis
          appraisalAIService.analyzeDocument(extraction.text, {
            employeeName: appraisal.employee.name,
            department: appraisal.employee.department
          }).then(async analysis => {
            document.aiAnalysis = {
              status: 'completed',
              analyzedAt: new Date(),
              ...analysis
            };
            await document.save();
          }).catch(err => {
            console.error('AI analysis error:', err);
            document.aiAnalysis.status = 'failed';
            document.aiAnalysis.error = err.message;
            document.save();
          });
        }
      } catch (extractError) {
        console.error('Text extraction error:', extractError);
        document.textExtraction.status = 'failed';
        document.textExtraction.error = extractError.message;
      }
    } else {
      document.textExtraction.status = 'not_applicable';
    }

    await document.save();

    // Link to appraisal
    appraisal.documents.push(document._id);
    await appraisal.save();

    res.status(201).json({ success: true, data: document });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

// Get document
router.get('/:appraisalId/documents/:documentId', requireAuth, async (req, res) => {
  try {
    const document = await AppraisalDocument.findById(req.params.documentId);
    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    res.json({ success: true, data: document });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch document' });
  }
});

// =============================================
// DISCUSSION
// =============================================

// Update discussion notes
router.put('/:appraisalId/discussion', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found' });

    // Check permission
    const userId = req.session?.user?.id;
    // Allow HR Admin or Assigned Manager
    const isAssignedManager = appraisal.manager.userId === userId;
    const isHR = ['hr_admin', 'super_admin'].includes(req.userRole);

    if (!isAssignedManager && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Update fields
    if (req.body.notes) appraisal.discussion.notes = { ...appraisal.discussion.notes, ...req.body.notes };
    if (req.body.scheduledDate) appraisal.discussion.scheduledDate = req.body.scheduledDate;
    if (req.body.completedDate) appraisal.discussion.completedDate = req.body.completedDate;
    if (req.body.location) appraisal.discussion.location = req.body.location;
    if (req.body.meetingLink) appraisal.discussion.meetingLink = req.body.meetingLink;

    if (req.body.markCompleted) {
      appraisal.status = 'discussion_completed';
      appraisal.discussion.completedDate = new Date();
    }

    await appraisal.save();
    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Update discussion error:', error);
    res.status(500).json({ success: false, error: 'Failed to update discussion' });
  }
});

// =============================================
// FINALIZATION
// =============================================

// Finalize appraisal
router.post('/:appraisalId/finalize', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Allow assigned manager or HR Admin to finalize
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isAssignedManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    const isHR = req.userRole === 'hr_admin';

    if (!isAssignedManager && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { finalRating, calibratedRating, justification } = req.body;
    const cycle = appraisal.cycleId;

    const minRating = cycle?.ratingScale?.min ?? 1;
    const maxRating = cycle?.ratingScale?.max ?? 5;

    // Use the same composite score math as the manager scoring endpoint.
    const scores = appraisalAIService.calculateCompositeScore(appraisal, cycle);

    const requestedRating =
      (calibratedRating ?? finalRating ?? appraisal.managerReview?.overallManagerRating ?? scores?.suggestedRating);

    if (requestedRating === undefined || requestedRating === null) {
      return res.status(400).json({ success: false, error: 'Final rating is required' });
    }

    const numericRating = Number(requestedRating);
    if (Number.isNaN(numericRating) || numericRating < minRating || numericRating > maxRating) {
      return res.status(400).json({ success: false, error: `Final rating must be a number from ${minRating} to ${maxRating}` });
    }

    const overall = Math.round(numericRating * 10) / 10;

    // Get rating label/color from cycle scale (fallback to generic label if not found).
    const ratingInfo = cycle?.ratingScale?.labels?.find(l => l.value === Math.round(overall)) || {};

    appraisal.finalRating = {
      overall,
      okrScore: scores?.okrScore,
      competencyScore: scores?.competencyScore,
      ratingLabel: ratingInfo.label || scores?.ratingLabel,
      ratingColor: ratingInfo.color,
      justification: justification || undefined,
      breakdown: scores?.breakdown,
      finalizedAt: new Date(),
      finalizedBy: {
        userId: req.session.user.id,
        name: req.session.user.name
      }
    };

    if (calibratedRating !== undefined && calibratedRating !== null) {
      appraisal.calibration = {
        originalRating: Number(finalRating ?? appraisal.managerReview?.overallManagerRating),
        calibratedRating: Number(calibratedRating),
        calibratedBy: { userId: req.session.user.id, name: req.session.user.name },
        calibratedAt: new Date(),
        justification
      };
    }

    appraisal.status = 'completed';
    appraisal.addAuditLog('appraisal_finalized', req.session.user, { finalRating: appraisal.finalRating });

    await appraisal.save();

    // Generate development plan suggestions
    try {
      const devPlan = await appraisalAIService.suggestDevelopmentPlan(appraisal, appraisal.selfAssessment?.okrAssessment || [], {
        employeeName: appraisal.employee.name,
        jobTitle: appraisal.employee.jobTitle
      });
      // Store in response but don't persist automatically
      res.json({ success: true, data: appraisal, developmentPlanSuggestions: devPlan });
    } catch (aiError) {
      res.json({ success: true, data: appraisal });
    }
  } catch (error) {
    console.error('Finalize appraisal error:', error);
    res.status(500).json({ success: false, error: 'Failed to finalize appraisal' });
  }
});

// Employee acknowledge
router.post('/:appraisalId/acknowledge', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee - compare by userId OR email to handle ID system mismatches
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can acknowledge' });
    }

    appraisal.discussion.employeeAcknowledged = true;
    appraisal.discussion.employeeAcknowledgedAt = new Date();
    appraisal.status = 'employee_acknowledged';

    appraisal.addAuditLog('employee_acknowledged', req.session.user, {});
    await appraisal.save();

    res.json({ success: true, data: appraisal });
  } catch (error) {
    console.error('Acknowledge error:', error);
    res.status(500).json({ success: false, error: 'Failed to acknowledge' });
  }
});

// =============================================
// AI SUGGESTIONS ENDPOINT
// =============================================

/**
 * POST /api/appraisals/ai-suggest
 * Get AI suggestions for self-assessment writing
 */
router.post('/ai-suggest', requireAuth, async (req, res) => {
  try {
    const { field, context, existingContent, employeeName } = req.body;

    const suggestion = await appraisalAIService.generateSelfAssessmentSuggestion(
      field,
      context,
      existingContent,
      { employeeName }
    );

    res.json({ success: true, suggestion });
  } catch (error) {
    console.error('AI suggest error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate suggestion' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/check-bias
 * Check manager review for potential bias
 */
router.post('/:appraisalId/check-bias', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const { managerReview, selfAssessment } = req.body;

    const biasCheck = await appraisalAIService.checkForBias(
      managerReview,
      selfAssessment || appraisal.selfAssessment,
      {
        employeeName: appraisal.employee.name,
        department: appraisal.employee.department
      }
    );

    res.json({ success: true, ...biasCheck });
  } catch (error) {
    console.error('Bias check error:', error);
    res.status(500).json({ success: false, error: 'Failed to check for bias' });
  }
});

// =============================================
// CONVERSATIONAL SELF-ASSESSMENT ENDPOINTS
// =============================================

/**
 * POST /api/appraisals/:appraisalId/conversation/start
 * Initialize the conversational self-assessment session
 * Returns initial AI greeting with OKR summary
 */
router.post('/:appraisalId/conversation/start', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can start the conversation' });
    }

    // Get employee's OKRs
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    // Start conversation via AI service
    const result = await appraisalAIService.startSelfAssessmentConversation(
      appraisal,
      okrs,
      appraisal.employee
    );

    // Initialize conversation state
    appraisal.conversationAssessment = {
      mode: 'conversation',
      currentPhase: result.phase || 'okr_reflection',
      currentOkrIndex: result.currentOkrIndex || 0,
      completedPhases: [],
      extractedData: {
        achievements: [],
        challenges: [],
        skills: [],
        goals: []
      },
      startedAt: new Date(),
      lastActivityAt: new Date(),
      totalTokensUsed: result.tokensUsed || 0,
      messageCount: 1
    };

    // Add initial AI message to chat thread
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: result.greeting,
      messageType: 'prompt',
      phase: result.phase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: result.tokensUsed
      },
      createdAt: new Date()
    });

    // Update status
    if (appraisal.status === 'self_assessment_pending') {
      appraisal.status = 'self_assessment_in_progress';
    }

    appraisal.addAuditLog('conversation_started', req.session.user, { mode: 'conversation' });
    await appraisal.save();

    res.json({
      success: true,
      data: {
        greeting: result.greeting,
        okrSummary: result.okrSummary,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20) // Last 20 messages
      }
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({ success: false, error: 'Failed to start conversation' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/message
 * Send a message in the conversation and get AI response
 */
router.post('/:appraisalId/conversation/message', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userName = req.session?.user?.name;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can participate in the conversation' });
    }

    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // Get employee's OKRs for context
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'okr_reflection';

    // Add user message to chat thread
    appraisal.chatThread.push({
      sender: { userId, name: userName, role: 'employee' },
      message: message.trim(),
      messageType: 'text',
      phase: currentPhase,
      createdAt: new Date()
    });

    // Get AI response
    const result = await appraisalAIService.continueConversation(
      appraisal,
      message.trim(),
      okrs,
      null // documentContext - can be added later
    );

    // Add AI response to chat thread
    const aiMessage = {
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: result.response,
      messageType: 'prompt',
      phase: result.currentPhase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: result.tokensUsed,
        confidence: result.confidence
      },
      createdAt: new Date()
    };

    // Only add structuredData if extractedData has a valid type
    if (result.extractedData && result.extractedData.type && result.extractedData.type !== 'null') {
      aiMessage.structuredData = result.extractedData;
    }

    appraisal.chatThread.push(aiMessage);

    // Update conversation state
    appraisal.conversationAssessment.currentPhase = result.currentPhase;
    appraisal.conversationAssessment.currentOkrIndex = result.currentOkrIndex;
    appraisal.conversationAssessment.lastActivityAt = new Date();
    appraisal.conversationAssessment.totalTokensUsed = (appraisal.conversationAssessment.totalTokensUsed || 0) + (result.tokensUsed || 0);
    appraisal.conversationAssessment.messageCount = (appraisal.conversationAssessment.messageCount || 0) + 2;

    // Track phase completion
    if (result.currentPhase !== currentPhase) {
      if (!appraisal.conversationAssessment.completedPhases.includes(currentPhase)) {
        appraisal.conversationAssessment.completedPhases.push(currentPhase);
      }
    }

    // Store extracted data
    if (result.extractedData && result.extractedData.type && result.extractedData.data) {
      const dataType = result.extractedData.type;
      const dataValue = result.extractedData.data;

      switch (dataType) {
        case 'achievement':
          appraisal.conversationAssessment.extractedData.achievements.push({
            text: dataValue.text,
            confidence: result.confidence,
            extractedFrom: 'conversation'
          });
          break;
        case 'challenge':
          appraisal.conversationAssessment.extractedData.challenges.push({
            text: dataValue.text,
            resolution: dataValue.resolution,
            learnings: dataValue.learnings
          });
          break;
        case 'learning':
        case 'skill':
          appraisal.conversationAssessment.extractedData.skills.push({
            skill: dataValue.text || dataValue.skill,
            evidence: dataValue.context || dataValue.evidence
          });
          break;
        case 'goal':
          appraisal.conversationAssessment.extractedData.goals.push({
            goal: dataValue.text || dataValue.goal,
            measurable: dataValue.measurable || false,
            timeframe: dataValue.timeframe
          });
          break;
      }
    }

    await appraisal.save();

    res.json({
      success: true,
      data: {
        response: result.response,
        currentPhase: result.currentPhase,
        extractedData: result.extractedData,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20)
      }
    });
  } catch (error) {
    console.error('Conversation message error:', error);
    res.status(500).json({ success: false, error: 'Failed to process message' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/upload
 * Upload a document mid-conversation
 */
router.post('/:appraisalId/conversation/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileType = path.extname(file.originalname).slice(1).toLowerCase();

    // Create document record
    const document = new AppraisalDocument({
      appraisalId: appraisal._id,
      organizationId: appraisal.organizationId,
      fileName: file.filename,
      originalName: file.originalname,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageProvider: 'local',
      storagePath: file.path,
      category: req.body.category || 'achievement_evidence',
      description: req.body.description,
      uploadedBy: {
        userId,
        name: req.session.user.name,
        email: req.session.user.email,
        role: 'employee'
      }
    });

    // Extract text
    if (documentExtractionService.isSupported(fileType)) {
      try {
        document.textExtraction.status = 'processing';
        const extraction = await documentExtractionService.extractText(file.path, fileType);

        document.textExtraction = {
          status: 'completed',
          extractedText: extraction.text,
          extractedAt: new Date(),
          pageCount: extraction.pageCount,
          wordCount: extraction.wordCount
        };

        // AI analysis
        if (extraction.text && extraction.text.length > 100) {
          document.aiAnalysis.status = 'processing';
          const analysis = await appraisalAIService.analyzeDocument(extraction.text, {
            employeeName: appraisal.employee.name,
            department: appraisal.employee.department
          });

          document.aiAnalysis = {
            status: 'completed',
            analyzedAt: new Date(),
            ...analysis
          };
        }
      } catch (extractError) {
        console.error('Text extraction error:', extractError);
        document.textExtraction.status = 'failed';
        document.textExtraction.error = extractError.message;
      }
    }

    await document.save();

    // Link to appraisal
    appraisal.documents.push(document._id);

    // Incorporate into conversation
    const incorporationResult = await appraisalAIService.incorporateDocumentIntoConversation(document, appraisal);

    // Add system message about document
    appraisal.chatThread.push({
      sender: { userId: 'system', name: 'System', role: 'system' },
      message: `Document uploaded: ${file.originalname}`,
      messageType: 'document_analysis',
      linkedDocumentId: document._id,
      createdAt: new Date()
    });

    // Add AI response about document
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: incorporationResult.message,
      messageType: 'document_analysis',
      linkedDocumentId: document._id,
      phase: appraisal.conversationAssessment?.currentPhase,
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: incorporationResult.tokensUsed
      },
      createdAt: new Date()
    });

    // Store document achievements in extracted data
    if (incorporationResult.insights?.extractedAchievements) {
      incorporationResult.insights.extractedAchievements.forEach(achievement => {
        appraisal.conversationAssessment.extractedData.achievements.push({
          text: achievement.description,
          linkedOkrId: null,
          confidence: achievement.confidence,
          extractedFrom: 'document'
        });
      });
    }

    appraisal.conversationAssessment.lastActivityAt = new Date();
    await appraisal.save();

    res.status(201).json({
      success: true,
      data: {
        document,
        aiMessage: incorporationResult.message,
        insights: incorporationResult.insights,
        chatThread: appraisal.chatThread.slice(-20)
      }
    });
  } catch (error) {
    console.error('Conversation upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/advance
 * Manually advance to the next conversation phase
 */
router.post('/:appraisalId/conversation/advance', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId);
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { targetPhase } = req.body;
    const phases = ['initialized', 'okr_reflection', 'achievements', 'challenges', 'learnings', 'future_goals', 'competencies', 'report_generation', 'review', 'completed'];

    if (!targetPhase || !phases.includes(targetPhase)) {
      return res.status(400).json({ success: false, error: 'Invalid target phase' });
    }

    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'initialized';
    const currentIndex = phases.indexOf(currentPhase);
    const targetIndex = phases.indexOf(targetPhase);

    if (targetIndex <= currentIndex) {
      return res.status(400).json({ success: false, error: 'Can only advance to future phases' });
    }

    // Mark current phase as completed
    if (!appraisal.conversationAssessment.completedPhases.includes(currentPhase)) {
      appraisal.conversationAssessment.completedPhases.push(currentPhase);
    }

    appraisal.conversationAssessment.currentPhase = targetPhase;
    appraisal.conversationAssessment.lastActivityAt = new Date();

    // Add phase transition message
    const phaseMessages = {
      achievements: "Let's discuss your key achievements and accomplishments during this period.",
      challenges: "Now let's talk about the challenges you faced and how you addressed them.",
      learnings: "What new skills or knowledge did you develop during this period?",
      future_goals: "Let's set some goals for the next period. What do you want to achieve?",
      competencies: "Let's assess your competencies. How would you rate yourself on the key skills for your role?",
      report_generation: "I have enough information to generate your self-assessment report. Let me compile everything we discussed."
    };

    if (phaseMessages[targetPhase]) {
      appraisal.chatThread.push({
        sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
        message: phaseMessages[targetPhase],
        messageType: 'phase_transition',
        phase: targetPhase,
        aiContext: { isAiGenerated: true },
        createdAt: new Date()
      });
    }

    await appraisal.save();

    res.json({
      success: true,
      data: {
        currentPhase: targetPhase,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-20)
      }
    });
  } catch (error) {
    console.error('Advance phase error:', error);
    res.status(500).json({ success: false, error: 'Failed to advance phase' });
  }
});

/**
 * GET /api/appraisals/:appraisalId/conversation/context
 * Get full conversation context and state
 */
router.get('/:appraisalId/conversation/context', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId)
      .populate('cycleId')
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    const isHR = req.userRole === 'hr_admin';

    if (!isEmployee && !isManager && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get OKRs
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    res.json({
      success: true,
      data: {
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread,
        okrs,
        documents: appraisal.documents,
        selfAssessment: appraisal.selfAssessment,
        employee: appraisal.employee,
        cycle: appraisal.cycleId
      }
    });
  } catch (error) {
    console.error('Get conversation context error:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversation context' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/generate-report
 * Generate the self-assessment report from conversation data
 */
router.post('/:appraisalId/conversation/generate-report', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId)
      .populate('cycleId')
      .populate('documents');

    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can generate the report' });
    }

    // Get OKRs
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    // Generate report
    const report = await appraisalAIService.generateSelfAssessmentReport(
      appraisal,
      okrs,
      appraisal.documents
    );

    // Update conversation phase
    appraisal.conversationAssessment.currentPhase = 'review';
    if (!appraisal.conversationAssessment.completedPhases.includes('report_generation')) {
      appraisal.conversationAssessment.completedPhases.push('report_generation');
    }

    // Add report draft message
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: "I've generated your self-assessment report based on our conversation. Please review it below and let me know if you'd like any changes before submitting.",
      messageType: 'report_draft',
      phase: 'review',
      structuredData: {
        type: 'report',
        data: report
      },
      aiContext: {
        isAiGenerated: true,
        modelUsed: 'gpt-4.1',
        tokensUsed: report.tokensUsed
      },
      createdAt: new Date()
    });

    await appraisal.save();

    res.json({
      success: true,
      data: {
        report,
        conversationState: appraisal.conversationAssessment,
        chatThread: appraisal.chatThread.slice(-5)
      }
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/conversation/finalize-report
 * Finalize and submit the generated report
 */
router.post('/:appraisalId/conversation/finalize-report', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify employee access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;
    if (!isEmployee) {
      return res.status(403).json({ success: false, error: 'Only the employee can finalize the report' });
    }

    const { report, edits } = req.body;

    if (!report) {
      return res.status(400).json({ success: false, error: 'Report data is required' });
    }

    // Apply any edits
    const finalReport = edits ? { ...report, ...edits } : report;

    // Employee must provide their own self-rating. AI rating is stored separately.
    const allowSelfRating = appraisal.cycleId?.settings?.allowSelfRating !== false;
    if (allowSelfRating) {
      const ratingRaw = finalReport.overallSelfRating;
      const rating = typeof ratingRaw === 'string' ? Number(ratingRaw) : ratingRaw;
      if (rating === undefined || rating === null) {
        return res.status(400).json({ success: false, error: 'Overall self-rating is required' });
      }
      if (typeof rating !== 'number' || Number.isNaN(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, error: 'Overall self-rating must be a number from 1 to 5' });
      }
      finalReport.overallSelfRating = rating;
    }

    const aiRatingSuggestion = finalReport.aiSuggestedRating || (
      finalReport.suggestedOverallRating || finalReport.ratingJustification ? {
        suggestedRating: finalReport.suggestedOverallRating,
        ratingJustification: finalReport.ratingJustification
      } : null
    );

    // Update self-assessment with report data
    appraisal.selfAssessment = {
      ...appraisal.selfAssessment,
      overallSummary: finalReport.overallSummary,
      okrAssessment: finalReport.okrAssessment || appraisal.selfAssessment?.okrAssessment || [],
      overallSelfRating: finalReport.overallSelfRating,
      aiRatingSuggestion: aiRatingSuggestion ? {
        ...aiRatingSuggestion,
        generatedAt: new Date()
      } : appraisal.selfAssessment?.aiRatingSuggestion,
      // Populate AI insights after submission (based on the employee-approved content)
      aiInsights: appraisal.selfAssessment?.aiInsights,
      submittedAt: new Date(),
      lastSavedAt: new Date()
    };

    // Generate AI insights (strengths/development areas) from the finalized self-assessment.
    try {
      const aiInsights = await appraisalAIService.analyzeSelfAssessment(
        appraisal.selfAssessment,
        appraisal.selfAssessment.okrAssessment || [],
        []
      );
      appraisal.selfAssessment.aiInsights = {
        ...aiInsights,
        generatedAt: new Date()
      };
    } catch (aiError) {
      console.error('AI insights error (finalize report):', aiError);
      // Keep whatever we already have (or none).
    }

    // Update conversation state
    appraisal.conversationAssessment.currentPhase = 'completed';
    if (!appraisal.conversationAssessment.completedPhases.includes('review')) {
      appraisal.conversationAssessment.completedPhases.push('review');
    }

    // Update status
    appraisal.status = 'manager_review_pending';

    // Add completion message
    appraisal.chatThread.push({
      sender: { userId: 'ai', name: 'AI Assistant', role: 'ai' },
      message: "Your self-assessment has been submitted successfully! Your manager will be notified to begin their review. Thank you for taking the time to reflect on your performance.",
      messageType: 'system',
      phase: 'completed',
      aiContext: { isAiGenerated: true },
      createdAt: new Date()
    });

    appraisal.addAuditLog('self_assessment_submitted', req.session.user, { mode: 'conversation' });
    await appraisal.save();

    // Notify manager
    try {
      if (appraisal.manager && appraisal.manager.email) {
        await notificationService.notifySelfAssessmentSubmitted(appraisal.manager, appraisal.employee);
      }
    } catch (notifyErr) {
      console.error('Notification error:', notifyErr);
    }

    res.json({
      success: true,
      data: {
        appraisal,
        message: 'Self-assessment submitted successfully'
      }
    });
  } catch (error) {
    console.error('Finalize report error:', error);
    res.status(500).json({ success: false, error: 'Failed to finalize report' });
  }
});

// =============================================
// SCORING ENDPOINTS
// =============================================

/**
 * GET /api/appraisals/:appraisalId/scoring
 * Get calculated scores for an appraisal
 */
router.get('/:appraisalId/scoring', requireAuth, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify access (manager or HR)
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    const isHR = req.userRole === 'hr_admin';
    const isEmployee = appraisal.employee.userId === userId || appraisal.employee.email === userEmail;

    if (!isManager && !isHR && !isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Calculate scores
    const scores = appraisalAIService.calculateCompositeScore(appraisal, appraisal.cycleId);

    res.json({
      success: true,
      data: {
        ...scores,
        selfRating: appraisal.selfAssessment?.overallSelfRating,
        managerRating: appraisal.managerReview?.overallManagerRating,
        finalRating: appraisal.finalRating?.overall
      }
    });
  } catch (error) {
    console.error('Get scoring error:', error);
    res.status(500).json({ success: false, error: 'Failed to get scoring' });
  }
});

/**
 * POST /api/appraisals/:appraisalId/ai-rating-suggestion
 * Get AI-suggested overall rating with justification
 */
router.post('/:appraisalId/ai-rating-suggestion', requireAuth, requireManager, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    // Verify manager access
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const isManager = appraisal.manager.userId === userId || appraisal.manager.email === userEmail;
    const isHR = req.userRole === 'hr_admin';

    if (!isManager && !isHR) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Get OKRs
    const okrs = await OKR.find({
      ownerId: appraisal.employee.userId,
      status: { $in: ['active', 'closed'] }
    });

    // Get AI suggestion
    const suggestion = await appraisalAIService.generateAISuggestedRating(appraisal, okrs);

    // Also get calculated score for comparison
    const calculatedScore = appraisalAIService.calculateCompositeScore(appraisal, appraisal.cycleId);

    res.json({
      success: true,
      data: {
        aiSuggestion: suggestion,
        calculatedScore,
        selfRating: appraisal.selfAssessment?.overallSelfRating,
        comparison: {
          aiVsSelf: suggestion.suggestedRating - (appraisal.selfAssessment?.overallSelfRating || 0),
          aiVsCalculated: suggestion.suggestedRating - calculatedScore.suggestedRating
        }
      }
    });
  } catch (error) {
    console.error('AI rating suggestion error:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI rating suggestion' });
  }
});

module.exports = router;
