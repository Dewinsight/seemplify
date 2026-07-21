const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const {
  getAdminActivityAnalytics,
  getAdminActivityFilters,
  listAdminActivityOrganizations,
  listAdminActivityUsers,
  getAdminActivityEvents,
  getAdminOrganizationActivityDetail,
  getAdminUserActivityDetail
} = require('../services/adminOrganizationActivityService');

const router = express.Router();
const canViewAnalytics = [adminAuth, requirePermission('viewAnalytics')];

function sendActivityError(res, error, message) {
  console.error(message, error);
  if (error instanceof TypeError) return res.status(400).json({ msg: error.message });
  return res.status(500).json({ msg: message });
}

router.get('/analytics', ...canViewAnalytics, async (req, res) => {
  try {
    const analytics = await getAdminActivityAnalytics(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(analytics);
  } catch (error) {
    sendActivityError(res, error, 'Failed to load organization activity analytics');
  }
});

router.get('/filters', ...canViewAnalytics, async (_req, res) => {
  try {
    const filters = await getAdminActivityFilters();
    res.set('Cache-Control', 'no-store');
    res.json(filters);
  } catch (error) {
    sendActivityError(res, error, 'Failed to load organization activity filters');
  }
});

router.get('/organizations', ...canViewAnalytics, async (req, res) => {
  try {
    const result = await listAdminActivityOrganizations(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    sendActivityError(res, error, 'Failed to load organization activity');
  }
});

router.get('/users', ...canViewAnalytics, async (req, res) => {
  try {
    const result = await listAdminActivityUsers(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    sendActivityError(res, error, 'Failed to load user activity');
  }
});

router.get('/events', ...canViewAnalytics, async (req, res) => {
  try {
    const result = await getAdminActivityEvents(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    sendActivityError(res, error, 'Failed to load activity history');
  }
});

router.get('/organizations/:id', ...canViewAnalytics, async (req, res) => {
  try {
    const detail = await getAdminOrganizationActivityDetail(req.params.id, req.query);
    if (!detail) return res.status(404).json({ msg: 'Organization not found' });
    res.set('Cache-Control', 'no-store');
    return res.json(detail);
  } catch (error) {
    return sendActivityError(res, error, 'Failed to load organization activity details');
  }
});

router.get('/users/:id', ...canViewAnalytics, async (req, res) => {
  try {
    const detail = await getAdminUserActivityDetail(req.params.id, req.query);
    if (!detail) return res.status(404).json({ msg: 'User not found' });
    res.set('Cache-Control', 'no-store');
    return res.json(detail);
  } catch (error) {
    return sendActivityError(res, error, 'Failed to load user activity details');
  }
});

module.exports = router;
