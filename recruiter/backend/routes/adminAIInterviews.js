const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const {
  getAdminAIInterviewAnalytics,
  getAdminAIInterviewFilters,
  listAdminAIInterviews,
  getAdminAIInterviewDetail
} = require('../services/adminAIInterviewAnalyticsService');

const router = express.Router();
const canViewAnalytics = [adminAuth, requirePermission('viewAnalytics')];

function sendAnalyticsError(res, error, message) {
  console.error(message, error);
  if (error instanceof TypeError) {
    return res.status(400).json({ msg: error.message });
  }
  return res.status(500).json({ msg: message });
}

router.get('/analytics', ...canViewAnalytics, async (req, res) => {
  try {
    const analytics = await getAdminAIInterviewAnalytics(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(analytics);
  } catch (error) {
    sendAnalyticsError(res, error, 'Failed to load AI interview analytics');
  }
});

router.get('/filters', ...canViewAnalytics, async (_req, res) => {
  try {
    const filters = await getAdminAIInterviewFilters();
    res.set('Cache-Control', 'no-store');
    res.json(filters);
  } catch (error) {
    sendAnalyticsError(res, error, 'Failed to load AI interview filters');
  }
});

router.get('/', ...canViewAnalytics, async (req, res) => {
  try {
    const result = await listAdminAIInterviews(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    sendAnalyticsError(res, error, 'Failed to load AI interviews');
  }
});

router.get('/:id', ...canViewAnalytics, async (req, res) => {
  try {
    const detail = await getAdminAIInterviewDetail(req.params.id);
    if (!detail) return res.status(404).json({ msg: 'AI interview not found' });
    res.set('Cache-Control', 'no-store');
    return res.json(detail);
  } catch (error) {
    return sendAnalyticsError(res, error, 'Failed to load AI interview details');
  }
});

module.exports = router;
