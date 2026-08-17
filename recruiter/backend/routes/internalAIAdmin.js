const express = require('express');
const { createInternalAIAdminAuth } = require('../middleware/internalAIAdminAuth');
const { getSharedAIAdminDashboard } = require('../services/aiRuntime/adminAnalyticsDashboardService');

const router = express.Router();
const authenticate = createInternalAIAdminAuth();

router.post('/v1/dashboard', authenticate, async (req, res) => {
  try {
    const dashboard = await getSharedAIAdminDashboard(req.body || {});
    return res.json(dashboard);
  } catch (error) {
    console.error('Shared AI admin dashboard failed:', error);
    return res.status(500).json({
      code: 'AI_GATEWAY_ADMIN_DASHBOARD_FAILED',
      message: 'Shared AI analytics could not be loaded'
    });
  }
});

module.exports = router;
