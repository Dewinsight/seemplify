const express = require('express');
const { createLocalRuntimeHistoryAuth } = require('../middleware/localRuntimeHistoryAuth');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const { getLocalRuntimeProviderTelemetry } = require('../services/localRuntimeProviderTelemetryService');
const {
  getActivityAnalytics,
  getRequestDetail,
  listRequests
} = require('../services/adminAIRuntimeService');

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

router.post('/jobs/:jobId/retry', historyAuth, async (req, res) => {
  try {
    const result = await cvAnalysisQueue.retryJobNow(req.params.jobId, {
      stage: req.body?.stage,
      requestedBy: { type: 'system', name: 'Local Control Center' }
    });
    return res.json({
      ok: true,
      jobId: result.job?.publicId || req.params.jobId,
      state: result.job?.state || 'queued',
      queueAvailable: result.queueAvailable !== false
    });
  } catch (error) {
    return res.status(error.statusCode || 409).json({
      code: error.code || 'CV_RETRY_UNAVAILABLE',
      message: error.message || 'This CV job could not be retried'
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

router.get('/activity-analytics', historyAuth, async (req, res) => {
  try {
    return res.json(await getActivityAnalytics(req.query));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      code: error.code || 'AI_ACTIVITY_ANALYTICS_UNAVAILABLE',
      message: error.message || 'AI activity analytics are unavailable'
    });
  }
});

router.get('/activity-history', historyAuth, async (req, res) => {
  try {
    return res.json(await listRequests(req.query));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      code: error.code || 'AI_ACTIVITY_HISTORY_UNAVAILABLE',
      message: error.message || 'AI activity history is unavailable'
    });
  }
});

router.get('/activity-history/:id', historyAuth, async (req, res) => {
  try {
    return res.json(await getRequestDetail(req.params.id));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      code: error.code || 'AI_ACTIVITY_DETAIL_UNAVAILABLE',
      message: error.message || 'AI activity detail is unavailable'
    });
  }
});

module.exports = router;
