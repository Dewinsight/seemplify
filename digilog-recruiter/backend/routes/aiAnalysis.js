const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');
const aiInterviewAnalysisService = require('../services/aiInterviewAnalysisService');
const prisma = require('../db/client');

// Analyze interview transcript - with credits
router.post('/interviews/:interviewId/analyze', authMiddleware, requireOrganization, requireCredits('aiAnalysis', 'analysis'), deductCredits, async (req, res) => {
  try {
    const analysis = await aiInterviewAnalysisService.analyzeInterviewTranscript(
      req.params.interviewId
    );
    
    res.json({ 
      success: true, 
      message: 'Interview analysis completed successfully',
      analysis,
      _id: req.params.interviewId // For credits deduction
    });
  } catch (error) {
    console.error('Error analyzing interview:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get AI insights for a candidate across all interviews
router.get('/candidates/:candidateId/ai-insights', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.query;
    
    if (!jobId) {
      return res.status(400).json({ 
        success: false, 
        error: 'jobId is required' 
      });
    }
    
    const insights = await aiInterviewAnalysisService.getCandidateInsights(
      req.params.candidateId,
      jobId
    );
    
    res.json({ 
      success: true, 
      insights 
    });
  } catch (error) {
    console.error('Error getting candidate insights:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get comparative analysis for a job
router.get('/jobs/:jobId/comparative-analysis', authMiddleware, async (req, res) => {
  try {
    const { stageId } = req.query;
    const analysis = await aiInterviewAnalysisService.getComparativeAnalysis(
      req.params.jobId,
      stageId
    );
    
    res.json({ 
      success: true, 
      analysis 
    });
  } catch (error) {
    console.error('Error getting comparative analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get AI recommendations for next steps
router.get('/interviews/:interviewId/recommendations', authMiddleware, async (req, res) => {
  try {
    const recommendations = await aiInterviewAnalysisService.getNextStepRecommendations(
      req.params.interviewId
    );
    
    res.json({ 
      success: true, 
      recommendations 
    });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Bulk analyze interviews - with custom credit handling for bulk operations
router.post('/jobs/:jobId/analyze-all', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { stageId } = req.body;
    const creditsService = require('../services/creditsService');

    // First check how many interviews need analysis.
    // transcript/aiAnalysis are Json columns -> fetch then filter in JS.
    const where = { jobId: req.params.jobId };
    if (stageId) where.stageId = stageId;
    const candidateInterviews = await prisma.interview.findMany({
      where,
      select: { id: true, transcript: true, aiAnalysis: true }
    });
    const needsAnalysis = candidateInterviews.filter(
      (i) => i.transcript?.content != null && i.aiAnalysis?.analyzed !== true
    );
    const interviewsToAnalyze = needsAnalysis.length;
    
    if (interviewsToAnalyze === 0) {
      return res.json({ 
        success: true, 
        message: 'No interviews to analyze',
        results: { totalInterviews: 0, analyzedInterviews: 0, results: [] }
      });
    }
    
    // Check if organization has enough credits for all interviews
    const organizationId = req.user.currentOrganization;
    const totalCreditsNeeded = interviewsToAnalyze * 8; // 8 credits per analysis
    
    const creditCheck = await creditsService.checkSufficientCredits(organizationId, 'aiAnalysis');
    const remainingCredits = creditCheck.remaining;
    
    if (remainingCredits < totalCreditsNeeded) {
      console.log(`❌ Insufficient credits for bulk analysis: Required ${totalCreditsNeeded}, Available ${remainingCredits}`);
      return res.status(402).json({
        error: 'INSUFFICIENT_CREDITS',
        message: `Insufficient credits for bulk analysis. Required: ${totalCreditsNeeded}, Available: ${remainingCredits}`,
        details: {
          action: 'bulkAnalysis',
          interviewsToAnalyze,
          creditPerInterview: 8,
          required: totalCreditsNeeded,
          available: remainingCredits,
          deficit: totalCreditsNeeded - remainingCredits
        },
        suggestions: [
          'Purchase additional credits',
          'Analyze interviews individually',
          'Wait for cycle reset'
        ]
      });
    }
    
    // Proceed with analysis
    const results = await aiInterviewAnalysisService.bulkAnalyzeInterviews(
      req.params.jobId,
      stageId
    );
    
    // Deduct credits for successfully analyzed interviews
    if (results.analyzedInterviews > 0) {
      for (let i = 0; i < results.analyzedInterviews; i++) {
        const interview = results.results[i];
        await creditsService.consumeCredits(
          organizationId,
          'aiAnalysis',
          interview.interviewId,
          'analysis',
          req.user.id,
          {
            bulkOperation: true,
            totalAnalyzed: results.analyzedInterviews,
            jobId: req.params.jobId
          }
        );
      }
    }
    
    res.json({ 
      success: true, 
      message: `Analyzed ${results.analyzedInterviews} out of ${results.totalInterviews} interviews`,
      results,
      creditsUsed: results.analyzedInterviews * 8
    });
  } catch (error) {
    console.error('Error in bulk analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get analysis status for an interview
router.get('/interviews/:interviewId/analysis-status', authMiddleware, async (req, res) => {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.interviewId },
      select: { id: true, aiAnalysis: true, transcript: true, stageId: true }
    });
    if (interview && interview.stageId) {
      interview.stageId = await prisma.interviewStage.findUnique({
        where: { id: interview.stageId },
        select: { id: true, name: true, type: true }
      });
    }

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }

    const status = {
      hasTranscript: !!interview.transcript?.content,
      analyzed: interview.aiAnalysis?.analyzed || false,
      analyzedAt: interview.aiAnalysis?.analyzedAt || null,
      stage: interview.stageId ? {
        name: interview.stageId.name,
        type: interview.stageId.type
      } : null,
      canAnalyze: !!interview.transcript?.content && !interview.aiAnalysis?.analyzed
    };
    
    res.json({ 
      success: true, 
      status 
    });
  } catch (error) {
    console.error('Error getting analysis status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get analysis results for an interview
router.get('/interviews/:interviewId/analysis', authMiddleware, async (req, res) => {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.interviewId },
      select: { id: true, aiAnalysis: true, stageId: true, candidateId: true }
    });
    if (interview && interview.stageId) {
      interview.stageId = await prisma.interviewStage.findUnique({
        where: { id: interview.stageId },
        select: { id: true, name: true, type: true }
      });
    }
    if (interview && interview.candidateId) {
      interview.candidateId = await prisma.candidate.findUnique({
        where: { id: interview.candidateId },
        select: { id: true, firstName: true, lastName: true }
      });
    }

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    if (!interview.aiAnalysis?.analyzed) {
      return res.status(404).json({ 
        success: false, 
        error: 'Interview not analyzed yet' 
      });
    }
    
    res.json({ 
      success: true, 
      analysis: interview.aiAnalysis,
      stage: {
        name: interview.stageId?.name,
        type: interview.stageId?.type
      },
      candidate: {
        name: `${interview.candidateId?.firstName} ${interview.candidateId?.lastName}`
      }
    });
  } catch (error) {
    console.error('Error getting analysis results:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Re-analyze an interview (force analysis) - with credits
router.post('/interviews/:interviewId/re-analyze', authMiddleware, requireOrganization, requireCredits('aiAnalysis', 'analysis'), deductCredits, async (req, res) => {
  try {
    // Force re-analysis by clearing existing analysis
    await prisma.interview.update({
      where: { id: req.params.interviewId },
      data: { aiAnalysis: null }
    });
    
    const analysis = await aiInterviewAnalysisService.analyzeInterviewTranscript(
      req.params.interviewId
    );
    
    res.json({ 
      success: true, 
      message: 'Interview re-analysis completed successfully',
      analysis,
      _id: req.params.interviewId // For credits deduction
    });
  } catch (error) {
    console.error('Error re-analyzing interview:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get analysis summary for a job
router.get('/jobs/:jobId/analysis-summary', authMiddleware, async (req, res) => {
  try {
    // Get all interviews for the job
    const allInterviews = await prisma.interview.findMany({ where: { jobId: req.params.jobId } });
    // aiAnalysis is a Json column -> filter analyzed in JS.
    const analyzedInterviews = allInterviews.filter((i) => i.aiAnalysis?.analyzed === true);
    
    // Calculate summary statistics
    const summary = {
      totalInterviews: allInterviews.length,
      analyzedInterviews: analyzedInterviews.length,
      analysisPercentage: allInterviews.length > 0 
        ? Math.round((analyzedInterviews.length / allInterviews.length) * 100) 
        : 0,
      withTranscripts: allInterviews.filter(i => i.transcript?.content).length,
      pendingAnalysis: allInterviews.filter(i => 
        i.transcript?.content && !i.aiAnalysis?.analyzed
      ).length
    };
    
    // Get stage breakdown
    const stageBreakdown = {};
    for (const interview of analyzedInterviews) {
      const stageName = interview.stageName || 'Unknown';
      if (!stageBreakdown[stageName]) {
        stageBreakdown[stageName] = {
          total: 0,
          recommendations: {
            advance: 0,
            reject: 0,
            additional_assessment: 0,
            different_role: 0
          }
        };
      }
      stageBreakdown[stageName].total++;
      
      const recommendation = interview.aiAnalysis?.insights?.recommendedNextSteps?.recommendation;
      if (recommendation && stageBreakdown[stageName].recommendations[recommendation] !== undefined) {
        stageBreakdown[stageName].recommendations[recommendation]++;
      }
    }
    
    res.json({ 
      success: true, 
      summary: {
        ...summary,
        stageBreakdown
      }
    });
  } catch (error) {
    console.error('Error getting analysis summary:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get top insights across all interviews for a job
router.get('/jobs/:jobId/top-insights', authMiddleware, async (req, res) => {
  try {
    // aiAnalysis is a Json column -> fetch by jobId then filter analyzed in JS.
    const jobInterviews = await prisma.interview.findMany({
      where: { jobId: req.params.jobId },
      select: { id: true, aiAnalysis: true }
    });
    const analyzedInterviews = jobInterviews.filter((i) => i.aiAnalysis?.analyzed === true);

    if (analyzedInterviews.length === 0) {
      return res.json({
        success: true,
        insights: {
          topSkills: [],
          commonConcerns: [],
          frequentStrengths: [],
          averageConfidence: 0
        }
      });
    }
    
    // Aggregate insights
    const allSkills = [];
    const allConcerns = [];
    const allStrengths = [];
    const confidenceScores = [];
    
    analyzedInterviews.forEach(interview => {
      const insights = interview.aiAnalysis.insights;
      
      if (insights.keySkillsMentioned) {
        allSkills.push(...insights.keySkillsMentioned);
      }
      
      if (insights.concerns) {
        allConcerns.push(...insights.concerns);
      }
      
      if (insights.strengths) {
        allStrengths.push(...insights.strengths);
      }
      
      if (insights.recommendedNextSteps?.confidence) {
        confidenceScores.push(insights.recommendedNextSteps.confidence);
      }
    });
    
    // Process and rank skills
    const skillCounts = {};
    allSkills.forEach(skill => {
      if (!skillCounts[skill.skill]) {
        skillCounts[skill.skill] = { count: 0, totalRelevance: 0 };
      }
      skillCounts[skill.skill].count++;
      skillCounts[skill.skill].totalRelevance += skill.relevanceScore || 0;
    });
    
    const topSkills = Object.entries(skillCounts)
      .map(([skill, data]) => ({
        skill,
        mentions: data.count,
        averageRelevance: Math.round(data.totalRelevance / data.count)
      }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 10);
    
    // Process concerns
    const concernCounts = {};
    allConcerns.forEach(concern => {
      if (!concernCounts[concern.type]) {
        concernCounts[concern.type] = 0;
      }
      concernCounts[concern.type]++;
    });
    
    const commonConcerns = Object.entries(concernCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // Process strengths
    const strengthCounts = {};
    allStrengths.forEach(strength => {
      if (!strengthCounts[strength.area]) {
        strengthCounts[strength.area] = 0;
      }
      strengthCounts[strength.area]++;
    });
    
    const frequentStrengths = Object.entries(strengthCounts)
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // Calculate average confidence
    const averageConfidence = confidenceScores.length > 0
      ? Math.round(confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length)
      : 0;
    
    res.json({
      success: true,
      insights: {
        topSkills,
        commonConcerns,
        frequentStrengths,
        averageConfidence,
        totalAnalyzed: analyzedInterviews.length
      }
    });
  } catch (error) {
    console.error('Error getting top insights:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 