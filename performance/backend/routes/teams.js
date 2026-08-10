const express = require('express');
const { validationResult } = require('express-validator');
const { requirePerformancePermission } = require('../middleware/performanceMiddleware');
const TeamPerformance = require('../models/TeamPerformance');
const User = require('../models/User');
const AIPerformanceService = require('../services/aiPerformanceService');
const { sendPerformanceAIError } = require('../services/aiGatewayService');

const router = express.Router();

function currentOrganizationId(req) {
  return String(req.currentOrganization?.id || req.session?.currentOrganizationId || '').trim();
}

function teamId(team) {
  return String(team?.id || team?._id || '').trim();
}

function teamOrganizationId(team) {
  return String(team?.organizationId || team?.organization || '').trim();
}

async function authorizedTeam(req, id) {
  const organizationId = currentOrganizationId(req);
  if (!organizationId) return null;
  const ownTeam = (req.userTeamHierarchy || []).find((team) => (
    teamId(team) === String(id) && teamOrganizationId(team) === organizationId
  ));
  const permissionForTarget = (req.teamPermissions || []).some((permission) => (
    String(permission?.team_id || permission?.teamId || '') === String(id)
  ));
  const targetTeamRole = String(ownTeam?.role || '').toLowerCase();
  const managesTargetTeam = Boolean(
    ownTeam
      && (ownTeam.isManager || ['line_manager', 'team_lead'].includes(targetTeamRole))
  );
  const headedDepartmentIds = new Set(
    (req.departmentHeadPermissions || []).map((department) => String(department?.id || '')).filter(Boolean)
  );
  const headsTargetDepartment = Boolean(
    ownTeam?.departmentId && headedDepartmentIds.has(String(ownTeam.departmentId))
  );
  if (ownTeam && (req.hasFullAccess || managesTargetTeam || permissionForTarget || headsTargetDepartment)) {
    return ownTeam;
  }
  if (req.userRole !== 'hr_admin' && !req.hasFullAccess && !req.hasDepartmentHeadAccess) return null;

  const member = await User.findOne({
    idpTeams: { $elemMatch: { id: String(id), organizationId } }
  }).select('idpTeams').lean();
  const targetTeam = (member?.idpTeams || []).find((team) => (
    teamId(team) === String(id) && teamOrganizationId(team) === organizationId
  )) || null;
  if (!targetTeam) return null;
  if (req.userRole === 'hr_admin' || req.hasFullAccess) return targetTeam;
  return targetTeam.departmentId && headedDepartmentIds.has(String(targetTeam.departmentId))
    ? targetTeam
    : null;
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeTeamInsights(value) {
  const insight = value && typeof value === 'object' ? value : {};
  const normalized = {
    strengths: stringList(insight.strengths),
    risks: stringList(insight.risks),
    coachingPriorities: stringList(insight.coachingPriorities),
    recommendedActions: stringList(insight.recommendedActions)
  };
  return Object.values(normalized).some((items) => items.length > 0) ? normalized : null;
}

function hasTeamPerformanceEvidence(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;
  return ['okrCompletionRate', 'averageRating', 'reviewCount', 'sentimentScore', 'improvementRate']
    .some((key) => Number.isFinite(Number(metrics[key])) && Number(metrics[key]) !== 0);
}

// GET /api/teams/:id/performance - Team performance metrics
router.get('/:id/performance', requirePerformancePermission('view:team-performance'), async (req, res) => {
  try {
    const { id } = req.params;
    const { period } = req.query;
    
    // Check team access permissions
    const team = await authorizedTeam(req, id);
    if (!team) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to team performance data',
        code: 'TEAM_PERFORMANCE_ACCESS_DENIED'
      });
    }

    const organizationId = currentOrganizationId(req);
    const query = { 
      teamId: id, 
      organizationId
    };
    
    if (period) query.period = period;

    const teamPerformance = await TeamPerformance.findOne(query);
    
    if (!teamPerformance) {
      return res.status(404).json({
        success: false,
        error: 'Team performance evidence is not available yet',
        code: 'TEAM_PERFORMANCE_NOT_AVAILABLE'
      });
    }

    if (!teamPerformance.aiInsights?.generatedAt) {
      if (!hasTeamPerformanceEvidence(teamPerformance.metrics)) {
        return res.status(422).json({
          success: false,
          error: 'There is not enough team performance evidence to generate AI insights',
          code: 'AI_EVIDENCE_INSUFFICIENT'
        });
      }
      const aiInsights = await AIPerformanceService.generateTeamInsights(
        team,
        teamPerformance.metrics
      );
      if (!aiInsights.success) {
        return res.status(502).json({
          success: false,
          error: aiInsights.error || 'The team insight response was invalid.',
          code: 'AI_RESPONSE_INVALID'
        });
      }
      const normalizedInsights = normalizeTeamInsights(aiInsights.data);
      if (!normalizedInsights) {
        return res.status(502).json({
          success: false,
          error: 'The team insight response did not contain usable evidence.',
          code: 'AI_RESPONSE_INVALID'
        });
      }
      
      teamPerformance.aiInsights = { ...normalizedInsights, generatedAt: new Date() };
      teamPerformance.benchmarkComparison = {
        ...(teamPerformance.benchmarkComparison?.toObject?.() || teamPerformance.benchmarkComparison || {}),
        recommendations: normalizedInsights.recommendedActions
      };
      await teamPerformance.save();
    }

    res.json({
      success: true,
      data: teamPerformance,
      message: 'Team performance data retrieved'
    });
  } catch (error) {
    console.error('Error fetching team performance:', error);
    return sendPerformanceAIError(res, error, 'Failed to fetch team performance');
  }
});

// GET /api/teams/:id/comparison - Team comparison analytics
router.get('/:id/comparison', requirePerformancePermission('view:team-analytics'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check team access permissions
    const team = await authorizedTeam(req, id);
    if (!team) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to team comparison data',
        code: 'TEAM_COMPARISON_ACCESS_DENIED'
      });
    }

    // Get team performance data with AI-generated benchmarks
    const teamPerformance = await TeamPerformance.findOne({
      teamId: id,
      organizationId: currentOrganizationId(req)
    });
    
    if (!teamPerformance || (!teamPerformance.benchmarkComparison && !teamPerformance.aiInsights)) {
      return res.status(404).json({
        success: false,
        error: 'Team comparison data not available'
      });
    }

    res.json({
      success: true,
      data: {
        currentTeam: teamPerformance,
        benchmarkComparison: teamPerformance.benchmarkComparison,
        aiInsights: teamPerformance.aiInsights || null
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
module.exports.authorizedTeam = authorizedTeam;
module.exports.normalizeTeamInsights = normalizeTeamInsights;
module.exports.hasTeamPerformanceEvidence = hasTeamPerformanceEvidence;
