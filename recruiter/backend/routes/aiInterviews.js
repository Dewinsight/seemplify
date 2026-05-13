const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const aiInterviewController = require('../controllers/aiInterviewController');

router.get('/public/:token', aiInterviewController.bootstrapPublicInterview);
router.get('/public/:token/voice', aiInterviewController.getPublicVoiceStatus);
router.post('/public/:token/speech-token', aiInterviewController.getPublicSpeechToken);
router.post('/public/:token/speech-transcribe', express.raw({
  type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'],
  limit: '15mb'
}), aiInterviewController.transcribePublicSpeech);
router.post('/public/:token/start', aiInterviewController.startPublicInterview);
router.post('/public/:token/message', aiInterviewController.sendPublicMessage);
router.post('/public/:token/proctoring-event', aiInterviewController.recordPublicProctoringEvent);
router.post('/public/:token/voice-transcript', aiInterviewController.recordPublicVoiceTranscript);
router.post('/public/:token/speech', aiInterviewController.synthesizePublicSpeech);
router.post('/public/:token/confirm', aiInterviewController.confirmPublicQuestion);
router.post('/public/:token/timeout', aiInterviewController.timeoutPublicQuestion);
router.post('/public/:token/reset', aiInterviewController.resetPublicSession);

router.use(authMiddleware);
router.use(requireOrganization);

router.get('/options', aiInterviewController.getAIInterviewOptions);
router.post('/estimate', aiInterviewController.estimateAIInterviewCost);
router.post('/voice-preview', aiInterviewController.previewAIInterviewVoice);
router.get('/', aiInterviewController.listAIInterviews);
router.post('/', aiInterviewController.createAIInterview);
router.get('/:id', aiInterviewController.getAIInterview);
router.get('/:id/sessions/:sessionId', aiInterviewController.getAIInterviewSession);
router.post('/:id/cancel', aiInterviewController.cancelAIInterview);
router.post('/:id/resend', aiInterviewController.resendAIInterviewSessions);

module.exports = router;
