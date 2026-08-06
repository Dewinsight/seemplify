const InterviewStage = require('../models/InterviewStage');
const Job = require('../models/Job');
const InterviewQuestion = require('../models/InterviewQuestion');
const interviewService = require('./interviewService');

class InterviewStageService {
  /**
   * Stage Templates
   */
  static STAGE_TEMPLATES = {
    standard: [
      {
        name: 'Phone Screen',
        type: 'phone_screen',
        order: 1,
        defaultDuration: 30,
        description: 'Initial screening call with recruiter',
        evaluationCriteria: [
          { name: 'Communication Skills', type: 'communication', weight: 30 },
          { name: 'Basic Qualifications', type: 'technical', weight: 40 },
          { name: 'Interest & Motivation', type: 'behavioral', weight: 30 }
        ],
        aiQuestionGeneration: {
          enabled: true,
          questionTypes: ['behavioral', 'experience_based'],
          questionCount: 5,
          difficulty: 'easy'
        }
      },
      {
        name: 'First Round Interview',
        type: 'behavioral',
        order: 2,
        defaultDuration: 60,
        description: 'Behavioral and cultural fit assessment',
        evaluationCriteria: [
          { name: 'Cultural Fit', type: 'cultural', weight: 35 },
          { name: 'Problem Solving', type: 'behavioral', weight: 35 },
          { name: 'Team Collaboration', type: 'behavioral', weight: 30 }
        ]
      },
      {
        name: 'Technical Interview',
        type: 'technical',
        order: 3,
        defaultDuration: 90,
        description: 'In-depth technical assessment',
        evaluationCriteria: [
          { name: 'Technical Skills', type: 'technical', weight: 50 },
          { name: 'Problem Solving', type: 'technical', weight: 30 },
          { name: 'Code Quality', type: 'technical', weight: 20 }
        ]
      },
      {
        name: 'Final Interview',
        type: 'panel',
        order: 4,
        defaultDuration: 60,
        description: 'Final round with hiring manager and team',
        requiredInterviewers: 3
      }
    ],
    
    technical: [
      {
        name: 'Technical Phone Screen',
        type: 'phone_screen',
        order: 1,
        defaultDuration: 45,
        description: 'Technical screening with senior engineer',
        evaluationCriteria: [
          { name: 'Technical Fundamentals', type: 'technical', weight: 60 },
          { name: 'Problem Solving Approach', type: 'technical', weight: 40 }
        ]
      },
      {
        name: 'Coding Challenge',
        type: 'technical',
        order: 2,
        defaultDuration: 120,
        description: 'Live coding session',
        evaluationCriteria: [
          { name: 'Code Quality', type: 'technical', weight: 30 },
          { name: 'Algorithm Design', type: 'technical', weight: 40 },
          { name: 'Testing & Debugging', type: 'technical', weight: 30 }
        ]
      },
      {
        name: 'System Design',
        type: 'technical',
        order: 3,
        defaultDuration: 90,
        description: 'Architecture and system design discussion',
        evaluationCriteria: [
          { name: 'System Architecture', type: 'technical', weight: 40 },
          { name: 'Scalability', type: 'technical', weight: 30 },
          { name: 'Trade-offs Analysis', type: 'technical', weight: 30 }
        ]
      },
      {
        name: 'Team Fit Interview',
        type: 'behavioral',
        order: 4,
        defaultDuration: 60,
        description: 'Cultural fit with the team'
      },
      {
        name: 'Executive Round',
        type: 'executive',
        order: 5,
        defaultDuration: 45,
        description: 'Final discussion with leadership'
      }
    ],
    
    sales: [
      {
        name: 'Recruiter Screen',
        type: 'phone_screen',
        order: 1,
        defaultDuration: 30
      },
      {
        name: 'Sales Roleplay',
        type: 'behavioral',
        order: 2,
        defaultDuration: 60,
        description: 'Mock sales scenarios and objection handling',
        evaluationCriteria: [
          { name: 'Sales Technique', type: 'behavioral', weight: 40 },
          { name: 'Communication', type: 'communication', weight: 30 },
          { name: 'Product Knowledge', type: 'technical', weight: 30 }
        ]
      },
      {
        name: 'Sales Manager Interview',
        type: 'behavioral',
        order: 3,
        defaultDuration: 60
      },
      {
        name: 'Executive Interview',
        type: 'executive',
        order: 4,
        defaultDuration: 45
      }
    ],
    
    executive: [
      {
        name: 'Executive Recruiter Screen',
        type: 'phone_screen',
        order: 1,
        defaultDuration: 45
      },
      {
        name: 'Leadership Assessment',
        type: 'behavioral',
        order: 2,
        defaultDuration: 90,
        evaluationCriteria: [
          { name: 'Leadership Experience', type: 'leadership', weight: 40 },
          { name: 'Strategic Thinking', type: 'leadership', weight: 30 },
          { name: 'Change Management', type: 'leadership', weight: 30 }
        ]
      },
      {
        name: 'Panel Interview',
        type: 'panel',
        order: 3,
        defaultDuration: 120,
        requiredInterviewers: 4
      },
      {
        name: 'Board Presentation',
        type: 'executive',
        order: 4,
        defaultDuration: 90
      }
    ]
  };

  /**
   * Create default stages for a job
   */
  async createDefaultStages(jobId, template = 'standard', userId) {
    try {
      console.log(`🎯 Creating default stages for job ${jobId} with template: ${template}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const stageTemplates = this.constructor.STAGE_TEMPLATES[template] || this.constructor.STAGE_TEMPLATES.standard;
      const createdStages = [];
      
      for (const stageTemplate of stageTemplates) {
        const stage = new InterviewStage({
          jobId,
          ...stageTemplate,
          createdBy: userId,
          updatedBy: userId,
          progressionRules: this._getDefaultProgressionRules(stageTemplate.type)
        });
        
        await stage.save();
        createdStages.push(stage);
        
        // Generate AI questions for the stage if enabled
        if (stage.aiQuestionGeneration?.enabled) {
          await this._generateStageQuestions(stage, job);
        }
      }
      
      // Update job with stages
      job.interviewStages = createdStages.map(s => s._id);
      job.pipelineConfiguration = {
        useCustomStages: false,
        template,
        totalStages: createdStages.length,
        estimatedTimeToHire: this._calculateEstimatedTimeToHire(createdStages)
      };
      await job.save();
      
      console.log(`✅ Created ${createdStages.length} stages for job ${jobId}`);
      return createdStages;
    } catch (error) {
      console.error('❌ Error creating default stages:', error);
      throw error;
    }
  }

  /**
   * Create custom stage
   */
  async createCustomStage(jobId, stageData, userId) {
    try {
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      // Determine order
      const existingStages = await InterviewStage.find({ jobId }).sort('order');
      const nextOrder = existingStages.length > 0 
        ? Math.max(...existingStages.map(s => s.order)) + 1 
        : 1;
      
      const stage = new InterviewStage({
        ...stageData,
        jobId,
        order: stageData.order || nextOrder,
        createdBy: userId,
        updatedBy: userId
      });
      
      await stage.save();
      
      // Update job
      job.interviewStages.push(stage._id);
      job.pipelineConfiguration.useCustomStages = true;
      job.pipelineConfiguration.totalStages = job.interviewStages.length;
      await job.save();
      
      return stage;
    } catch (error) {
      console.error('❌ Error creating custom stage:', error);
      throw error;
    }
  }

  /**
   * Update stage
   */
  async updateStage(stageId, updateData, userId) {
    try {
      const stage = await InterviewStage.findByIdAndUpdate(
        stageId,
        {
          ...updateData,
          updatedBy: userId,
          updatedAt: new Date()
        },
        { new: true, runValidators: true }
      );
      
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      return stage;
    } catch (error) {
      console.error('❌ Error updating stage:', error);
      throw error;
    }
  }

  /**
   * Reorder stages
   */
  async reorderStages(jobId, stageOrder, userId) {
    try {
      const stages = await InterviewStage.find({ jobId });
      
      for (const { stageId, newOrder } of stageOrder) {
        await InterviewStage.findByIdAndUpdate(stageId, {
          order: newOrder,
          updatedBy: userId,
          updatedAt: new Date()
        });
      }
      
      return await InterviewStage.find({ jobId }).sort('order');
    } catch (error) {
      console.error('❌ Error reordering stages:', error);
      throw error;
    }
  }

  /**
   * Delete stage
   */
  async deleteStage(stageId, userId) {
    try {
      const stage = await InterviewStage.findById(stageId);
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      // Check if there are interviews in this stage
      const Interview = require('../models/Interview');
      const existingInterviews = await Interview.countDocuments({ stageId });
      
      if (existingInterviews > 0) {
        throw new Error(`Cannot delete stage with ${existingInterviews} existing interviews`);
      }
      
      // Remove from job
      const job = await Job.findById(stage.jobId);
      job.interviewStages = job.interviewStages.filter(id => !id.equals(stageId));
      job.pipelineConfiguration.totalStages = job.interviewStages.length;
      await job.save();
      
      // Delete stage
      await InterviewStage.findByIdAndDelete(stageId);
      
      return { success: true, deletedStage: stage };
    } catch (error) {
      console.error('❌ Error deleting stage:', error);
      throw error;
    }
  }

  /**
   * Get stages for job
   */
  async getStagesForJob(jobId) {
    try {
      const stages = await InterviewStage.find({ jobId, isActive: true })
        .sort('order')
        .populate('defaultQuestions')
        .populate('createdBy', 'profile.firstName profile.lastName');
      
      // Add interview count for each stage
      const Interview = require('../models/Interview');
      const stagesWithCounts = await Promise.all(
        stages.map(async (stage) => {
          const interviewCount = await Interview.countDocuments({ 
            jobId, 
            stageId: stage._id 
          });
          
          return {
            ...stage.toObject(),
            interviewCount
          };
        })
      );
      
      return stagesWithCounts;
    } catch (error) {
      console.error('❌ Error getting stages:', error);
      throw error;
    }
  }

  /**
   * Get stage analytics
   */
  async getStageAnalytics(stageId) {
    try {
      const stage = await InterviewStage.findById(stageId);
      if (!stage) {
        throw new Error('Stage not found');
      }

      const Interview = require('../models/Interview');
      
      // Get all interviews for this stage
      const interviews = await Interview.find({ stageId });
      
      // Calculate analytics
      const analytics = {
        totalInterviews: interviews.length,
        completedInterviews: interviews.filter(i => i.status === 'completed').length,
        scheduledInterviews: interviews.filter(i => i.status === 'scheduled').length,
        averageDuration: interviews.reduce((sum, i) => sum + (i.duration || 0), 0) / interviews.length || 0,
        averageScore: interviews
          .filter(i => i.structuredFeedback?.overallScore)
          .reduce((sum, i) => sum + i.structuredFeedback.overallScore, 0) / 
          interviews.filter(i => i.structuredFeedback?.overallScore).length || 0,
        passRate: this._calculatePassRate(interviews),
        commonConcerns: this._getCommonConcerns(interviews),
        topSkills: this._getTopSkills(interviews)
      };
      
      return analytics;
    } catch (error) {
      console.error('❌ Error getting stage analytics:', error);
      throw error;
    }
  }

  /**
   * Generate questions for stage
   */
  async _generateStageQuestions(stage, job) {
    try {
      // Check if interviewService has generateQuestionsWithAI method
      if (!interviewService.generateQuestionsWithAI) {
        console.log('⚠️ AI question generation not available, skipping');
        return;
      }

      const options = {
        stage: stage.type,
        questionCount: stage.aiQuestionGeneration.questionCount,
        difficulty: stage.aiQuestionGeneration.difficulty,
        includeTypes: stage.aiQuestionGeneration.questionTypes,
        focusAreas: stage.aiQuestionGeneration.focusAreas,
        userId: stage.createdBy
      };
      
      const questions = await interviewService.generateQuestionsWithAI(job._id, options);
      
      // Link questions to stage
      stage.defaultQuestions = questions.map(q => q._id);
      await stage.save();
      
      console.log(`✅ Generated ${questions.length} questions for stage ${stage.name}`);
    } catch (error) {
      console.error('⚠️ Error generating questions for stage:', error);
      // Don't throw - stage creation should succeed even if question generation fails
    }
  }

  /**
   * Get default progression rules
   */
  _getDefaultProgressionRules(stageType) {
    const rules = {
      phone_screen: {
        autoProgress: false,
        minimumScore: 60,
        requiredApprovals: 1,
        conditions: [{
          type: 'score_threshold',
          value: 60,
          action: 'advance',
          priority: 1
        }]
      },
      technical: {
        autoProgress: false,
        minimumScore: 70,
        requiredApprovals: 1,
        conditions: [{
          type: 'score_threshold',
          value: 70,
          action: 'advance',
          priority: 1
        }]
      },
      behavioral: {
        autoProgress: false,
        minimumScore: 65,
        requiredApprovals: 1,
        conditions: [{
          type: 'score_threshold',
          value: 65,
          action: 'advance',
          priority: 1
        }]
      },
      panel: {
        autoProgress: false,
        minimumScore: 75,
        requiredApprovals: 2,
        conditions: [{
          type: 'unanimous_approval',
          value: true,
          action: 'advance',
          priority: 1
        }]
      },
      executive: {
        autoProgress: false,
        minimumScore: 80,
        requiredApprovals: 1,
        conditions: [{
          type: 'manager_approval',
          value: true,
          action: 'advance',
          priority: 1
        }]
      }
    };
    
    return rules[stageType] || rules.behavioral;
  }

  /**
   * Calculate estimated time to hire
   */
  _calculateEstimatedTimeToHire(stages) {
    // Assume 3-5 days between stages for scheduling
    const avgDaysBetweenStages = 4;
    const totalStages = stages.length;
    
    return (totalStages - 1) * avgDaysBetweenStages + 7; // +7 for initial application review
  }

  /**
   * Calculate pass rate for interviews
   */
  _calculatePassRate(interviews) {
    const completedWithFeedback = interviews.filter(i => 
      i.status === 'completed' && i.structuredFeedback?.recommendation
    );
    
    if (completedWithFeedback.length === 0) return 0;
    
    const passedInterviews = completedWithFeedback.filter(i => 
      ['strong_yes', 'yes'].includes(i.structuredFeedback.recommendation)
    );
    
    return Math.round((passedInterviews.length / completedWithFeedback.length) * 100);
  }

  /**
   * Get common concerns from interviews
   */
  _getCommonConcerns(interviews) {
    const concerns = {};
    
    interviews.forEach(interview => {
      if (interview.aiAnalysis?.insights?.concerns) {
        interview.aiAnalysis.insights.concerns.forEach(concern => {
          if (!concerns[concern.type]) {
            concerns[concern.type] = 0;
          }
          concerns[concern.type]++;
        });
      }
    });
    
    return Object.entries(concerns)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Get top skills from interviews
   */
  _getTopSkills(interviews) {
    const skills = {};
    
    interviews.forEach(interview => {
      if (interview.aiAnalysis?.insights?.keySkillsMentioned) {
        interview.aiAnalysis.insights.keySkillsMentioned.forEach(skill => {
          if (!skills[skill.skill]) {
            skills[skill.skill] = { count: 0, totalRelevance: 0 };
          }
          skills[skill.skill].count++;
          skills[skill.skill].totalRelevance += skill.relevanceScore || 0;
        });
      }
    });
    
    return Object.entries(skills)
      .map(([skill, data]) => ({
        skill,
        count: data.count,
        averageRelevance: data.totalRelevance / data.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
}

module.exports = new InterviewStageService(); 