const express = require('express');
const { createLocalRuntimeHistoryAuth } = require('../middleware/localRuntimeHistoryAuth');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

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

module.exports = router;
