const express = require('express');
const { validationResult } = require('express-validator');
const { requirePerformancePermission } = require('../middleware/performanceMiddleware');
const TeamPerformance = require('../models/TeamPerformance');
const AIPerformanceService = require('../services/aiPerformanceService');

const router = express.Router();

// GET /api/teams/:id/performance - Team performance metrics
router.get('/:id/performance', requirePerformancePermission('view:team-performance'), async (req, res) => {
  try {
    const { id } = req.params;
    const { period } = req.query;
    
    // Check team access permissions
    if (!req.hasTeamPermission || !req.userTeamHierarchy?.some(team => team.id === id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to team performance data',
        code: 'TEAM_PERFORMANCE_ACCESS_DENIED'
      });
    }

    const query = { 
      teamId: id, 
      organizationId: req.user.currentOrganization 
    };
    
    if (period) query.period = period;

    const teamPerformance = await TeamPerformance.findOne(query);
    
    if (!teamPerformance) {
      // Generate AI insights if no data exists
      const aiInsights = await AIPerformanceService.generateTeamInsights(
        req.userTeamHierarchy.find(team => team.id === id) || {},
        {}
      );
      
      const newTeamPerformance = new TeamPerformance({
        teamId: id,
        organizationId: req.user.currentOrganization,
        period: period || 'current',
        metrics: {
          okrCompletionRate: 0,
          averageRating: 0,
          reviewCount: 0,
          sentimentScore: 0,
          improvementRate: 0
        },
        benchmarkComparison: aiInsights.success ? {
          similarTeams: aiInsights.data.similarTeams || [],
          industryAverage: aiInsights.data.industryAverage || 0,
          recommendations: aiInsights.data.recommendations || []
        } : null,
        createdAt: new Date()
      });

      await newTeamPerformance.save();

      res.json({
        success: true,
        data: newTeamPerformance,
        message: 'Team performance data generated with AI insights'
      });
    }

    res.json({
      success: true,
      data: teamPerformance,
      message: 'Team performance data retrieved'
    });
  } catch (error) {
    console.error('Error fetching team performance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch team performance'
    });
  }
});

// GET /api/teams/:id/comparison - Team comparison analytics
router.get('/:id/comparison', requirePerformancePermission('view:team-analytics'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check team access permissions
    if (!req.hasTeamPermission || !req.userTeamHierarchy?.some(team => team.id === id)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to team comparison data',
        code: 'TEAM_COMPARISON_ACCESS_DENIED'
      });
    }

    // Get team performance data with AI-generated benchmarks
    const teamPerformance = await TeamPerformance.findOne({ teamId: id });
    
    if (!teamPerformance || !teamPerformance.benchmarkComparison) {
      return res.status(404).json({
        success: false,
        error: 'Team comparison data not available'
      });
    }

    res.json({
      success: true,
      data: {
        currentTeam: teamPerformance,
        benchmarkComparison: teamPerformance.benchmarkComparison
      },
      message: 'Team comparison data retrieved'
    });
  } catch (error) {
    console.error('Error fetching team comparison:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch team comparison'
    });
  }
});

module.exports = router;