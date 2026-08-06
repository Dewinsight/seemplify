const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const enrichmentController = require('../controllers/enrichmentController');

router.get('/estimate/:jobId', authMiddleware, requireOrganization, enrichmentController.getEstimate);
router.post('/start/:jobId', authMiddleware, requireOrganization, enrichmentController.startEnrichment);
router.get('/status/:enrichmentId', authMiddleware, requireOrganization, enrichmentController.getStatus);
router.get('/results/:enrichmentId', authMiddleware, requireOrganization, enrichmentController.getResults);

module.exports = router;
