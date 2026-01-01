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

// Get all cycles for organization
router.get('/cycles', requireAuth, async (req, res) => {
  try {
    const orgId = req.currentOrganization?.id || req.session?.currentOrganizationId;
    const { status, year } = req.query;

    const query = { organizationId: orgId };
    if (status) query.status = status;
    if (year) {
      query.periodStart = { $gte: new Date(`${year}-01-01`) };
      query.periodEnd = { $lte: new Date(`${year}-12-31`) };
    }

    const cycles = await AppraisalCycle.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: cycles });
  } catch (error) {
    console.error('Get cycles error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appraisal cycles' });
  }
});

// Create new cycle (HR Admin)
router.post('/cycles', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const orgId = req.currentOrganization?.id || req.session?.currentOrganizationId;
    const userId = req.session?.user?.id;
    const userName = req.session?.user?.name;

    const cycle = new AppraisalCycle({
      ...req.body,
      organizationId: orgId,
      createdBy: { userId, name: userName }
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
router.post('/cycles/:cycleId/launch', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const cycle = await AppraisalCycle.findById(req.params.cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Cycle not found' });
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
        // If manager info is missing, use the HR Admin launching the cycle as temporary manager
        const managerUserId = emp.managerId || req.session?.user?.id;
        const managerName = emp.managerName || req.session?.user?.name || 'HR Admin';
        const managerEmail = emp.managerEmail || req.session?.user?.email;

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

// Get team appraisals (as manager)
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
    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;

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
      appraisal.status = 'self_assessment_submitted';

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
      appraisal.status = 'manager_review_submitted';

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
// FINALIZATION
// =============================================

// Finalize appraisal
router.post('/:appraisalId/finalize', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.appraisalId).populate('cycleId');
    if (!appraisal) {
      return res.status(404).json({ success: false, error: 'Appraisal not found' });
    }

    const { finalRating, calibratedRating, justification } = req.body;
    const cycle = appraisal.cycleId;

    // Calculate weighted final rating
    const okrWeight = cycle.okrWeight / 100;
    const competencyWeight = 1 - okrWeight;

    const okrScore = appraisal.selfAssessment?.okrAssessment?.reduce((acc, okr) => acc + (okr.completionPercentage || 0), 0) /
      (appraisal.selfAssessment?.okrAssessment?.length || 1);
    const competencyScore = appraisal.managerReview?.competencyRatings?.reduce((acc, c) => acc + (c.managerRating || 0), 0) /
      (appraisal.managerReview?.competencyRatings?.length || 1);

    const calculatedRating = calibratedRating || finalRating ||
      (okrScore * okrWeight / 20 + competencyScore * competencyWeight);

    // Get rating label
    const ratingInfo = cycle.ratingScale.labels.find(l => l.value === Math.round(calculatedRating)) || {};

    appraisal.finalRating = {
      overall: Math.round(calculatedRating * 10) / 10,
      okrScore: Math.round(okrScore * 10) / 10,
      competencyScore: Math.round(competencyScore * 10) / 10,
      ratingLabel: ratingInfo.label,
      ratingColor: ratingInfo.color,
      breakdown: {
        okrWeight: cycle.okrWeight,
        okrContribution: okrScore * okrWeight / 100,
        competencyWeight: 100 - cycle.okrWeight,
        competencyContribution: competencyScore * competencyWeight
      },
      finalizedAt: new Date(),
      finalizedBy: {
        userId: req.session.user.id,
        name: req.session.user.name
      }
    };

    if (calibratedRating) {
      appraisal.calibration = {
        originalRating: finalRating || appraisal.managerReview?.overallManagerRating,
        calibratedRating,
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

module.exports = router;
