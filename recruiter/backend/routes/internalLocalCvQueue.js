const express = require('express');
const { createLocalRuntimeHistoryAuth } = require('../middleware/localRuntimeHistoryAuth');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const { getLocalRuntimeProviderTelemetry } = require('../services/localRuntimeProviderTelemetryService');

const router = express.Router();
const historyAuth = createLocalRuntimeHistoryAuth();

router.get('/history', historyAuth, async (req, res) => {
  try {
    return res.json(await cvAnalysisQueue.listHistory(req.query));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      code: error.code || 'CV_HISTORY_UNAVAILABLE',
      message: error.message || 'CV processing history is unavailable'
    });
  }
});

router.get('/provider-telemetry', historyAuth, async (_req, res) => {
  try {
    return res.json(await getLocalRuntimeProviderTelemetry());
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      code: error.code || 'PROVIDER_TELEMETRY_UNAVAILABLE',
      message: error.message || 'AI provider telemetry is unavailable'
    });
  }
});

module.exports = router;
