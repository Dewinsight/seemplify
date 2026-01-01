const express = require('express');
const router = express.Router();
const DevelopmentPlan = require('../models/DevelopmentPlan');
const { requireAuth, requireManager, requireHRAdmin } = require('../middleware/rbac');
const AIPerformanceService = require('../services/aiPerformanceService');
const notificationService = require('../services/notificationService');

/**
 * GET /api/development-plans - List development plans
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const role = req.userRole;
    const { status, userId: queryUserId } = req.query;
    
    let query = {};
    
    if (role === 'hr_admin') {
      if (req.currentOrganization?.id) {
        query.organizationId = req.currentOrganization.id;
      }
      if (queryUserId) query.userId = queryUserId;
    } else if (role === 'line_manager') {
      const directReports = req.directReports || [];
      query.$or = [
        { userId: userId },
        { managerId: userId },
        { userId: { $in: directReports } }
      ];
    } else {
      query.userId = userId;
    }
    
    if (status) query.status = status;
    
    const plans = await DevelopmentPlan.find(query)
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json({
      success: true,
      data: plans,
      count: plans.length
    });
  } catch (error) {
    console.error('Error fetching development plans:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch plans' });
  }
});

/**
 * GET /api/development-plans/:id - Get specific plan
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = plan.userId === userId;
    const isManager = plan.managerId === userId;
    const isHRAdmin = req.userRole === 'hr_admin';
    
    if (!isOwner && !isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error fetching plan:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch plan' });
  }
});

/**
 * POST /api/development-plans - Create development plan
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const managerId = req.session.user.id || req.session.user.sub;
    const {
      userId, title, description, startDate, targetDate,
      careerGoals, skillDevelopment, learningActivities, stretchAssignments, mentoring
    } = req.body;
    
    if (!userId || !title || !startDate || !targetDate) {
      return res.status(400).json({
        success: false,
        error: 'User, title, start date, and target date are required'
      });
    }
    
    const plan = new DevelopmentPlan({
      userId,
      managerId,
      organizationId: req.currentOrganization?.id,
      title,
      description,
      startDate,
      targetDate,
      careerGoals: careerGoals || [],
      skillDevelopment: skillDevelopment || [],
      learningActivities: learningActivities || [],
      stretchAssignments: stretchAssignments || [],
      mentoring: mentoring || { hasMentor: false },
      status: 'draft'
    });
    
    await plan.save();
    
    res.status(201).json({
      success: true,
      data: plan,
      message: 'Development plan created successfully'
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({ success: false, error: 'Failed to create plan' });
  }
});

/**
 * PUT /api/development-plans/:id - Update plan
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = plan.userId === userId;
    const isManager = plan.managerId === userId;
    const isHRAdmin = req.userRole === 'hr_admin';
    
    if (!isOwner && !isManager && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const updates = req.body;
    
    // Only manager can approve
    if (!isManager && !isHRAdmin) {
      delete updates.approvedByManager;
      delete updates.status;
    }
    
    Object.keys(updates).forEach(key => {
      if (key !== '_id' && key !== 'userId' && key !== 'managerId') {
        plan[key] = updates[key];
      }
    });
    
    await plan.save();
    
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating plan:', error);
    res.status(500).json({ success: false, error: 'Failed to update plan' });
  }
});

/**
 * POST /api/development-plans/:id/activate - Activate plan
 */
router.post('/:id/activate', requireManager, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    if (plan.managerId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Only manager can activate' });
    }
    
    plan.status = 'active';
    plan.approvedByManager = {
      approved: true,
      approvedAt: new Date(),
      comments: req.body.comments || ''
    };
    
    await plan.save();
    
    res.json({ success: true, data: plan, message: 'Plan activated' });
  } catch (error) {
    console.error('Error activating plan:', error);
    res.status(500).json({ success: false, error: 'Failed to activate plan' });
  }
});

/**
 * POST /api/development-plans/:id/check-in - Add progress check-in
 */
router.post('/:id/check-in', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    const isOwner = plan.userId === userId;
    const isManager = plan.managerId === userId;
    
    if (!isOwner && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const { notes, progressUpdate, blockers } = req.body;
    
    plan.checkIns.push({
      notes,
      progressUpdate,
      blockers,
      addedBy: isManager ? 'manager' : 'employee'
    });
    
    await plan.save();
    
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error adding check-in:', error);
    res.status(500).json({ success: false, error: 'Failed to add check-in' });
  }
});

/**
 * PUT /api/development-plans/:id/skills/:skillIndex - Update skill progress
 */
router.put('/:id/skills/:skillIndex', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const userId = req.session.user.id || req.session.user.sub;
    if (plan.userId !== userId && plan.managerId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const skillIndex = parseInt(req.params.skillIndex);
    if (plan.skillDevelopment[skillIndex]) {
      const { progress, currentLevel, notes } = req.body;
      if (progress !== undefined) plan.skillDevelopment[skillIndex].progress = progress;
      if (currentLevel) plan.skillDevelopment[skillIndex].currentLevel = currentLevel;
      if (notes) plan.skillDevelopment[skillIndex].notes = notes;
      await plan.save();
    }
    
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating skill:', error);
    res.status(500).json({ success: false, error: 'Failed to update skill' });
  }
});

/**
 * PUT /api/development-plans/:id/activities/:activityIndex - Update learning activity
 */
router.put('/:id/activities/:activityIndex', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    const activityIndex = parseInt(req.params.activityIndex);
    if (plan.learningActivities[activityIndex]) {
      const { status, evidence, feedback } = req.body;
      if (status) {
        plan.learningActivities[activityIndex].status = status;
        if (status === 'completed') {
          plan.learningActivities[activityIndex].completedAt = new Date();
        }
      }
      if (evidence) plan.learningActivities[activityIndex].evidence = evidence;
      if (feedback) plan.learningActivities[activityIndex].feedback = feedback;
      await plan.save();
    }
    
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating activity:', error);
    res.status(500).json({ success: false, error: 'Failed to update activity' });
  }
});

/**
 * POST /api/development-plans/:id/ai-recommendations - Generate AI recommendations
 */
router.post('/:id/ai-recommendations', requireAuth, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    // Generate AI recommendations based on plan data
    const prompt = `
Based on this development plan:
- Career Goals: ${JSON.stringify(plan.careerGoals)}
- Current Skills: ${JSON.stringify(plan.skillDevelopment)}

Suggest:
1. Additional skills to develop
2. Learning resources (courses, books, certifications)
3. Career path suggestions

Output JSON with keys: suggestedSkills, suggestedResources, careerPathSuggestions
`;

    const result = await AIPerformanceService.getCachedOrGenerate(
      `dev_plan_${plan._id}`,
      async () => {
        const azureService = require('../services/azureOpenAIService');
        const response = await azureService.getChatCompletions([
          { role: 'system', content: 'You are a career development expert. Output valid JSON.' },
          { role: 'user', content: prompt }
        ]);
        return AIPerformanceService.parseAIResponse(response.choices[0].message.content);
      }
    );
    
    if (result.success) {
      plan.aiRecommendations = {
        ...result.data,
        generatedAt: new Date()
      };
      await plan.save();
    }
    
    res.json({ success: true, data: plan.aiRecommendations });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ success: false, error: 'Failed to generate recommendations' });
  }
});

/**
 * POST /api/development-plans/:id/complete - Mark plan as completed
 */
router.post('/:id/complete', requireManager, async (req, res) => {
  try {
    const plan = await DevelopmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    
    plan.status = 'completed';
    await plan.save();
    
    res.json({ success: true, data: plan, message: 'Plan completed' });
  } catch (error) {
    console.error('Error completing plan:', error);
    res.status(500).json({ success: false, error: 'Failed to complete plan' });
  }
});

module.exports = router;






