const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const interviewStageService = require('../services/interviewStageService');
const prisma = require('../db/client');

// Create default stages for a job
router.post('/jobs/:jobId/stages/default', authMiddleware, async (req, res) => {
  try {
    const { template } = req.body;
    const stages = await interviewStageService.createDefaultStages(
      req.params.jobId,
      template,
      req.user._id
    );
    
    res.json({ 
      success: true, 
      message: `Created ${stages.length} default stages`,
      stages 
    });
  } catch (error) {
    console.error('Error creating default stages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Create custom stage
router.post('/jobs/:jobId/stages', authMiddleware, async (req, res) => {
  try {
    const stage = await interviewStageService.createCustomStage(
      req.params.jobId,
      req.body,
      req.user._id
    );
    
    res.json({ 
      success: true, 
      message: 'Custom stage created successfully',
      stage 
    });
  } catch (error) {
    console.error('Error creating custom stage:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get all stages for a job
router.get('/jobs/:jobId/stages', authMiddleware, async (req, res) => {
  try {
    const stages = await interviewStageService.getStagesForJob(req.params.jobId);
    res.json({ 
      success: true, 
      stages 
    });
  } catch (error) {
    console.error('Error getting stages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get single stage
router.get('/stages/:stageId', authMiddleware, async (req, res) => {
  try {
    const stage = await prisma.interviewStage.findUnique({ where: { id: req.params.stageId } });

    if (!stage) {
      return res.status(404).json({
        success: false,
        error: 'Stage not found'
      });
    }

    // Stitch defaultQuestions (question ids) + createdBy (user id) — replaces .populate
    const qIds = Array.isArray(stage.defaultQuestions) ? stage.defaultQuestions.filter(Boolean) : [];
    const [questionDocs, creatorDoc] = await Promise.all([
      qIds.length ? prisma.interviewQuestion.findMany({ where: { id: { in: qIds } } }) : [],
      stage.createdBy ? prisma.user.findUnique({ where: { id: stage.createdBy }, select: { id: true, profile: true } }) : null
    ]);
    const qMap = new Map(questionDocs.map(q => [q.id, q]));
    stage.defaultQuestions = qIds.map(id => qMap.get(id) || id);
    stage.createdBy = creatorDoc || stage.createdBy;

    res.json({
      success: true,
      stage
    });
  } catch (error) {
    console.error('Error getting stage:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update stage
router.put('/stages/:stageId', authMiddleware, async (req, res) => {
  try {
    const stage = await interviewStageService.updateStage(
      req.params.stageId,
      req.body,
      req.user._id
    );
    
    res.json({ 
      success: true, 
      message: 'Stage updated successfully',
      stage 
    });
  } catch (error) {
    console.error('Error updating stage:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Reorder stages
router.put('/jobs/:jobId/stages/reorder', authMiddleware, async (req, res) => {
  try {
    const { stageOrder } = req.body;
    
    if (!Array.isArray(stageOrder)) {
      return res.status(400).json({ 
        success: false, 
        error: 'stageOrder must be an array' 
      });
    }
    
    const stages = await interviewStageService.reorderStages(
      req.params.jobId,
      stageOrder,
      req.user._id
    );
    
    res.json({ 
      success: true, 
      message: 'Stages reordered successfully',
      stages 
    });
  } catch (error) {
    console.error('Error reordering stages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete stage
router.delete('/stages/:stageId', authMiddleware, async (req, res) => {
  try {
    const result = await interviewStageService.deleteStage(
      req.params.stageId,
      req.user._id
    );
    
    res.json({ 
      success: true, 
      message: 'Stage deleted successfully',
      deletedStage: result.deletedStage 
    });
  } catch (error) {
    console.error('Error deleting stage:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get stage analytics
router.get('/stages/:stageId/analytics', authMiddleware, async (req, res) => {
  try {
    const analytics = await interviewStageService.getStageAnalytics(req.params.stageId);
    res.json({ 
      success: true, 
      analytics 
    });
  } catch (error) {
    console.error('Error getting stage analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get available stage templates
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const templates = {
      standard: {
        name: 'Standard Pipeline',
        description: 'General hiring process for most roles',
        stages: interviewStageService.constructor.STAGE_TEMPLATES.standard.length,
        estimatedDays: 21
      },
      technical: {
        name: 'Technical Roles',
        description: 'Engineering and technical positions',
        stages: interviewStageService.constructor.STAGE_TEMPLATES.technical.length,
        estimatedDays: 28
      },
      sales: {
        name: 'Sales Roles',
        description: 'Sales and business development positions',
        stages: interviewStageService.constructor.STAGE_TEMPLATES.sales.length,
        estimatedDays: 18
      },
      executive: {
        name: 'Executive Roles',
        description: 'Senior leadership and C-level positions',
        stages: interviewStageService.constructor.STAGE_TEMPLATES.executive.length,
        estimatedDays: 35
      }
    };
    
    res.json({ 
      success: true, 
      templates 
    });
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get detailed template information
router.get('/templates/:templateName', authMiddleware, async (req, res) => {
  try {
    const templateName = req.params.templateName;
    const template = interviewStageService.constructor.STAGE_TEMPLATES[templateName];
    
    if (!template) {
      return res.status(404).json({ 
        success: false, 
        error: 'Template not found' 
      });
    }
    
    res.json({ 
      success: true, 
      template: {
        name: templateName,
        stages: template
      }
    });
  } catch (error) {
    console.error('Error getting template details:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Clone stages from another job
router.post('/jobs/:jobId/stages/clone', authMiddleware, async (req, res) => {
  try {
    const { sourceJobId } = req.body;
    
    if (!sourceJobId) {
      return res.status(400).json({ 
        success: false, 
        error: 'sourceJobId is required' 
      });
    }
    
    // Get stages from source job
    const sourceStages = await interviewStageService.getStagesForJob(sourceJobId);
    
    if (sourceStages.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No stages found in source job' 
      });
    }
    
    // Create stages in target job
    const clonedStages = [];
    for (const sourceStage of sourceStages) {
      const stageData = {
        name: sourceStage.name,
        type: sourceStage.type,
        description: sourceStage.description,
        defaultDuration: sourceStage.defaultDuration,
        requiredInterviewers: sourceStage.requiredInterviewers,
        interviewerRoles: sourceStage.interviewerRoles,
        evaluationCriteria: sourceStage.evaluationCriteria,
        aiQuestionGeneration: sourceStage.aiQuestionGeneration,
        progressionRules: sourceStage.progressionRules,
        order: sourceStage.order
      };
      
      const clonedStage = await interviewStageService.createCustomStage(
        req.params.jobId,
        stageData,
        req.user._id
      );
      
      clonedStages.push(clonedStage);
    }
    
    res.json({ 
      success: true, 
      message: `Cloned ${clonedStages.length} stages successfully`,
      stages: clonedStages 
    });
  } catch (error) {
    console.error('Error cloning stages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Bulk update stages
router.put('/jobs/:jobId/stages/bulk', authMiddleware, async (req, res) => {
  try {
    const { stages } = req.body;
    
    if (!Array.isArray(stages)) {
      return res.status(400).json({ 
        success: false, 
        error: 'stages must be an array' 
      });
    }
    
    const updatedStages = [];
    
    for (const stageUpdate of stages) {
      const { stageId, ...updateData } = stageUpdate;
      
      if (!stageId) {
        continue;
      }
      
      const updatedStage = await interviewStageService.updateStage(
        stageId,
        updateData,
        req.user._id
      );
      
      updatedStages.push(updatedStage);
    }
    
    res.json({ 
      success: true, 
      message: `Updated ${updatedStages.length} stages successfully`,
      stages: updatedStages 
    });
  } catch (error) {
    console.error('Error bulk updating stages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Toggle stage active status
router.patch('/stages/:stageId/toggle-active', authMiddleware, async (req, res) => {
  try {
    const stage = await prisma.interviewStage.findUnique({ where: { id: req.params.stageId } });

    if (!stage) {
      return res.status(404).json({
        success: false,
        error: 'Stage not found'
      });
    }

    // `updatedBy` is not a column on InterviewStage; only toggle isActive.
    const updatedStage = await prisma.interviewStage.update({
      where: { id: stage.id },
      data: { isActive: !stage.isActive }
    });

    res.json({
      success: true,
      message: `Stage ${updatedStage.isActive ? 'activated' : 'deactivated'} successfully`,
      stage: updatedStage
    });
  } catch (error) {
    console.error('Error toggling stage status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update stage feedback form configuration
router.put('/stages/:stageId/feedback-config', authMiddleware, async (req, res) => {
  try {
    const { stageId } = req.params;
    const { useTemplate, templateId, overrides } = req.body;
    
    const stage = await prisma.interviewStage.findUnique({ where: { id: stageId } });

    if (!stage) {
      return res.status(404).json({
        success: false,
        error: 'Stage not found'
      });
    }

    // Update configuration (feedbackFormConfig is a Json column — read-modify-write)
    const feedbackFormConfig = { ...(stage.feedbackFormConfig || {}) };

    if (useTemplate !== undefined) {
      feedbackFormConfig.useTemplate = useTemplate;
    }

    if (templateId !== undefined) {
      feedbackFormConfig.templateId = templateId || null;
    }

    if (overrides !== undefined) {
      feedbackFormConfig.overrides = overrides;
    }

    const updatedStage = await prisma.interviewStage.update({
      where: { id: stage.id },
      data: { feedbackFormConfig }
    });

    // Populate and return (replaces .populate('feedbackFormConfig.templateId'))
    const responseConfig = { ...(updatedStage.feedbackFormConfig || {}) };
    if (responseConfig.templateId) {
      responseConfig.templateId = (await prisma.feedbackFormTemplate.findUnique({ where: { id: responseConfig.templateId } })) || responseConfig.templateId;
    }

    res.json({
      success: true,
      message: 'Stage feedback configuration updated successfully',
      data: responseConfig
    });
  } catch (error) {
    console.error('Error updating stage feedback config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get stage feedback form configuration
router.get('/stages/:stageId/feedback-config', authMiddleware, async (req, res) => {
  try {
    const { stageId } = req.params;
    
    const stage = await prisma.interviewStage.findUnique({ where: { id: stageId } });

    if (!stage) {
      return res.status(404).json({
        success: false,
        error: 'Stage not found'
      });
    }

    // Populate feedbackFormConfig.templateId (replaces .populate)
    let data = stage.feedbackFormConfig || null;
    if (data && data.templateId) {
      data = { ...data, templateId: (await prisma.feedbackFormTemplate.findUnique({ where: { id: data.templateId } })) || data.templateId };
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error getting stage feedback config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 