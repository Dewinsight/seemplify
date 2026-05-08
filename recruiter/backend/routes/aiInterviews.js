const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const aiInterviewController = require('../controllers/aiInterviewController');

router.get('/public/:token', aiInterviewController.bootstrapPublicInterview);
router.post('/public/:token/start', aiInterviewController.startPublicInterview);
router.post('/public/:token/message', aiInterviewController.sendPublicMessage);
router.post('/public/:token/confirm', aiInterviewController.confirmPublicQuestion);
router.post('/public/:token/timeout', aiInterviewController.timeoutPublicQuestion);

router.use(authMiddleware);
router.use(requireOrganization);

router.get('/', aiInterviewController.listAIInterviews);
router.post('/', aiInterviewController.createAIInterview);
router.get('/:id', aiInterviewController.getAIInterview);
router.get('/:id/sessions/:sessionId', aiInterviewController.getAIInterviewSession);
router.post('/:id/cancel', aiInterviewController.cancelAIInterview);
router.post('/:id/resend', aiInterviewController.resendAIInterviewSessions);

module.exports = router;
