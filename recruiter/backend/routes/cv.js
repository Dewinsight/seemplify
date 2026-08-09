const express = require('express');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

const router = express.Router();
// Retired: AI Interview owns its durable intake boundary. Keeping a 410
// tombstone prevents older clients from silently falling back to a route that
// bypassed its actor, permission, billing, and idempotency contracts.
router.post('/parse', (_req, res) => {
  return res.status(410).json({
    code: 'CV_PARSE_ENDPOINT_RETIRED',
    msg: 'This CV parsing endpoint has been retired. Use the product-specific durable CV upload flow.'
  });
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const token = req.get('X-CV-Status-Token') || req.query.token;
    const status = await cvAnalysisQueue.getStatus(req.params.jobId, token);
    if (!status) return res.status(404).json({ code: 'CV_JOB_NOT_FOUND', msg: 'CV processing job was not found' });
    return res.json(status);
  } catch (error) {
    return res.status(503).json({ code: 'CV_QUEUE_UNAVAILABLE', msg: error.message });
  }
});

module.exports = router;
