const express = require('express');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const { requireAuth, requireManager } = require('../middleware/rbac');
const { requireOrganization, getActorId } = require('../services/tenantPolicy');
const AIPerformanceService = require('../services/aiPerformanceService');

const router = express.Router();
router.use(requireAuth, requireOrganization);

function isHr(req) {
  return req.userRole === 'hr_admin';
}

function isPlanOwner(req, plan) {
  return String(plan.userId) === String(getActorId(req));
}

function isPlanManager(req, plan) {
  return String(plan.managerId) === String(getActorId(req));
}

function canAccessPlan(req, plan) {
  return Boolean(plan && String(plan.organizationId) === req.organizationId &&
    (isHr(req) || isPlanOwner(req, plan) || isPlanManager(req, plan)));
}

async function findPlan(req, id) {
  return DevelopmentPlan.findOne({ _id: id, organizationId: req.organizationId });
}

function forbidden(res) {
  return res.status(403).json({ success: false, error: 'Access denied' });
}

router.get('/', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const query = { organizationId: req.organizationId };
    if (isHr(req)) {
      if (req.query.userId) query.userId = String(req.query.userId);
    } else if (['line_manager', 'team_lead'].includes(req.userRole)) {
      const directReports = (req.directReports || []).map(String);
      query.$or = [
        { userId: actorId },
        { managerId: actorId },
        { userId: { $in: directReports } }
      ];
    } else {
      query.userId = actorId;
    }
    if (req.query.status) query.status = String(req.query.status);

    const plans = await DevelopmentPlan.find(query).sort({ updatedAt: -1 }).limit(100);
    return res.json({ success: true, data: plans, count: plans.length });
  } catch (error) {
    console.error('Error fetching development plans:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch plans' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error fetching development plan:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch plan' });
  }
});

router.post('/', requireManager, async (req, res) => {
  try {
    const managerId = getActorId(req);
    const targetUserId = String(req.body.userId || '').trim();
    const directReports = (req.directReports || []).map(String);
    if (!targetUserId || (!isHr(req) && !directReports.includes(targetUserId))) {
      return res.status(403).json({ success: false, error: 'Development plans can only be created for a direct report' });
    }
    const startDate = new Date(req.body.startDate);
    const targetDate = new Date(req.body.targetDate);
    if (!req.body.title || Number.isNaN(startDate.getTime()) || Number.isNaN(targetDate.getTime()) || targetDate < startDate) {
      return res.status(400).json({ success: false, error: 'Title and a valid development date range are required' });
    }

    const plan = await DevelopmentPlan.create({
      userId: targetUserId,
      managerId,
      organizationId: req.organizationId,
      title: String(req.body.title).trim(),
      description: req.body.description,
      startDate,
      targetDate,
      careerGoals: Array.isArray(req.body.careerGoals) ? req.body.careerGoals : [],
      skillDevelopment: Array.isArray(req.body.skillDevelopment) ? req.body.skillDevelopment : [],
      learningActivities: Array.isArray(req.body.learningActivities) ? req.body.learningActivities : [],
      stretchAssignments: Array.isArray(req.body.stretchAssignments) ? req.body.stretchAssignments : [],
      milestones: Array.isArray(req.body.milestones) ? req.body.milestones : [],
      reviewDates: Array.isArray(req.body.reviewDates) ? req.body.reviewDates : [],
      mentoring: req.body.mentoring || { hasMentor: false },
      source: 'manual',
      status: 'draft'
    });
    return res.status(201).json({ success: true, data: plan, message: 'Development plan created successfully' });
  } catch (error) {
    console.error('Error creating development plan:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({ success: false, error: 'Failed to create plan' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);

    const editableFields = [
      'title', 'description', 'targetDate', 'careerGoals', 'skillDevelopment',
      'learningActivities', 'stretchAssignments', 'mentoring', 'milestones', 'reviewDates'
    ];
    for (const field of editableFields) {
      if (req.body[field] !== undefined) plan[field] = req.body[field];
    }
    if ((isPlanManager(req, plan) || isHr(req)) && req.body.status !== undefined) {
      if (!['draft', 'active', 'on_hold', 'completed', 'cancelled'].includes(req.body.status)) {
        return res.status(400).json({ success: false, error: 'Invalid development plan status' });
      }
      plan.status = req.body.status;
    }
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating development plan:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({ success: false, error: 'Failed to update plan' });
  }
});

router.post('/:id/activate', requireManager, async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!isPlanManager(req, plan) && !isHr(req)) return forbidden(res);
    plan.status = 'active';
    plan.approvedByManager = {
      approved: true,
      approvedAt: new Date(),
      comments: String(req.body.comments || '').trim()
    };
    await plan.save();
    return res.json({ success: true, data: plan, message: 'Development plan activated' });
  } catch (error) {
    console.error('Error activating development plan:', error);
    return res.status(500).json({ success: false, error: 'Failed to activate plan' });
  }
});

router.post('/:id/check-in', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);
    const progressUpdate = req.body.progressUpdate === undefined ? undefined : Number(req.body.progressUpdate);
    if (progressUpdate !== undefined && (!Number.isFinite(progressUpdate) || progressUpdate < 0 || progressUpdate > 100)) {
      return res.status(400).json({ success: false, error: 'Progress must be from 0 to 100' });
    }
    plan.checkIns.push({
      notes: req.body.notes,
      progressUpdate,
      blockers: req.body.blockers,
      addedBy: isPlanManager(req, plan) || isHr(req) ? 'manager' : 'employee'
    });
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error adding development check-in:', error);
    return res.status(500).json({ success: false, error: 'Failed to add check-in' });
  }
});

router.put('/:id/skills/:skillIndex', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);
    const skill = plan.skillDevelopment[Number(req.params.skillIndex)];
    if (!skill) return res.status(404).json({ success: false, error: 'Skill not found' });
    if (req.body.progress !== undefined) skill.progress = Number(req.body.progress);
    if (req.body.currentLevel) skill.currentLevel = req.body.currentLevel;
    if (req.body.notes !== undefined) skill.notes = req.body.notes;
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating development skill:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({ success: false, error: 'Failed to update skill' });
  }
});

router.put('/:id/activities/:activityIndex', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);
    const activity = plan.learningActivities[Number(req.params.activityIndex)];
    if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
    if (req.body.status) {
      activity.status = req.body.status;
      activity.completedAt = req.body.status === 'completed' ? new Date() : undefined;
    }
    if (req.body.evidence !== undefined) activity.evidence = req.body.evidence;
    if (req.body.feedback !== undefined) activity.feedback = req.body.feedback;
    await plan.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error updating development activity:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({ success: false, error: 'Failed to update activity' });
  }
});

router.post('/:id/ai-recommendations', async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!canAccessPlan(req, plan)) return forbidden(res);
    const prompt = `Suggest internal, non-LMS development options for this plan. Career goals: ${JSON.stringify(plan.careerGoals)}. Skills: ${JSON.stringify(plan.skillDevelopment)}. Return JSON with suggestedSkills, suggestedResources, and careerPathSuggestions. Recommendations are advisory only.`;
    const result = await AIPerformanceService.getCachedOrGenerate(`dev_plan_${plan._id}`, async () => {
      const azureService = require('../services/azureOpenAIService');
      const response = await azureService.getChatCompletions([
        { role: 'system', content: 'You advise on mentoring, stretch assignments, internal projects, books, and job shadowing. Never make employment decisions. Output valid JSON.' },
        { role: 'user', content: prompt }
      ]);
      return AIPerformanceService.parseAIResponse(response.choices[0].message.content);
    });
    if (!result.success) {
      return res.status(503).json({ success: false, error: 'AI recommendations are temporarily unavailable; the plan remains fully editable.' });
    }
    plan.aiRecommendations = { ...result.data, generatedAt: new Date() };
    await plan.save();
    return res.json({ success: true, data: plan.aiRecommendations, advisory: true });
  } catch (error) {
    console.error('Error generating development recommendations:', error);
    return res.status(503).json({ success: false, error: 'AI recommendations are temporarily unavailable; the plan remains fully editable.' });
  }
});

router.post('/:id/complete', requireManager, async (req, res) => {
  try {
    const plan = await findPlan(req, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    if (!isPlanManager(req, plan) && !isHr(req)) return forbidden(res);
    plan.status = 'completed';
    await plan.save();
    return res.json({ success: true, data: plan, message: 'Development plan completed' });
  } catch (error) {
    console.error('Error completing development plan:', error);
    return res.status(500).json({ success: false, error: 'Failed to complete plan' });
  }
});

module.exports = router;
