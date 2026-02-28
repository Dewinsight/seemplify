const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const notetakerController = require('../controllers/notetakerController');
const transcriptSyncController = require('../controllers/transcriptSyncController');
const Interview = require('../models/Interview'); // Added missing import
const nylasV3Service = require('../services/nylasV3Service'); // Added missing import
const transcriptSegmentationService = require('../services/transcriptSegmentationService');
const aiInterviewAnalysisService = require('../services/aiInterviewAnalysisService');
const { verifyNylasWebhook, logWebhookRequest } = require('../middleware/webhookVerification');

// Webhook endpoints - no auth needed but requires signature verification
router.post('/webhook', 
  logWebhookRequest,
  verifyNylasWebhook,
  notetakerController.handleNotetakerWebhook
);
router.get('/webhook', (req, res) => {
  // Handle Nylas webhook verification
  if (req.query.challenge) {
    console.log('🔐 Nylas webhook verification - responding with challenge:', req.query.challenge);
    res.status(200).send(req.query.challenge);
  } else {
    res.status(200).send('Webhook endpoint ready');
  }
});

// Protected endpoints
router.get('/status/:interviewId', authMiddleware, notetakerController.getNotetakerStatus);
router.post('/enable/:interviewId', authMiddleware, notetakerController.enableNotetaker);
router.post('/cancel/:interviewId', authMiddleware, notetakerController.cancelNotetaker);
router.post('/join-now/:interviewId', authMiddleware, notetakerController.joinMeetingNow);
router.get('/transcript/:interviewId', authMiddleware, notetakerController.getTranscript);
router.get('/realtime/:interviewId', authMiddleware, notetakerController.getRealtimeTranscript);
router.post('/sync/:interviewId', authMiddleware, notetakerController.syncNotetakerStatus);
router.post('/trigger-completion-check', authMiddleware, notetakerController.triggerCompletionCheck);

// Manual transcript sync endpoints
router.post('/manual-sync/:interviewId', authMiddleware, transcriptSyncController.manualTranscriptSync);
router.post('/force-complete/:interviewId', authMiddleware, transcriptSyncController.forceInterviewCompletion);

// Debug endpoint to manually trigger notetaker join (for testing)
router.post('/force-join/:interviewId', async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId).populate('interviewerId');
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker configured for this interview' });
    }
    
    console.log(`🚀 Force joining notetaker ${interview.notetakerId} for interview ${interviewId}`);
    
    // Get current notetaker status
    const status = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId);
    console.log('Current notetaker status:', status);
    
    res.json({
      success: true,
      message: 'Notetaker force join triggered',
      currentStatus: status.data?.state || 'unknown',
      meetingState: status.data?.meeting_state || 'unknown',
      notetakerId: interview.notetakerId,
      note: 'This is a debug endpoint. In real scenarios, notetakers join automatically at scheduled time.'
    });
    
  } catch (error) {
    console.error('Error forcing notetaker join:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to force refresh notetaker status
router.post('/refresh-status/:interviewId', async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId).populate('interviewerId');
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker configured for this interview' });
    }
    
    console.log(`🔄 Refreshing notetaker status for ${interview.notetakerId}`);
    
    // Get current notetaker status from Nylas
    const status = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId);
    console.log('Fresh notetaker status from Nylas:', status);
    
    const notetakerData = status.data || status;
    const currentStatus = notetakerData.state || 'unknown';
    const meetingState = notetakerData.meeting_state || 'unknown';
    
    // Update interview with latest status
    const oldStatus = interview.notetakerStatus;
    interview.notetakerStatus = currentStatus;
    await interview.save();
    
    res.json({
      success: true,
      message: 'Notetaker status refreshed',
      oldStatus: oldStatus,
      newStatus: currentStatus,
      meetingState: meetingState,
      notetakerId: interview.notetakerId,
      fullStatus: notetakerData
    });
    
  } catch (error) {
    console.error('Error refreshing notetaker status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup stale notetakers
router.post('/cleanup', notetakerController.cleanupStaleNotetakers);

// Manual cleanup of failed interviews
router.post('/cleanup-failed', authMiddleware, async (req, res) => {
  try {
    console.log('🧹 Manual cleanup of failed interviews requested');
    const { cleanupOldInterviews } = require('../services/interviewCompletionService');
    await cleanupOldInterviews();
    
    // Also run a completion check to clean up recent failed interviews
    const { checkAndCompleteInterviews } = require('../services/interviewCompletionService');
    const completedCount = await checkAndCompleteInterviews();
    
    res.json({
      success: true,
      message: `Successfully cleaned up failed interviews and completed ${completedCount} pending interviews`,
      completedCount: completedCount
    });
  } catch (error) {
    console.error('❌ Manual cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup interviews'
    });
  }
});

// Debug endpoint to get raw Nylas notetaker data
router.get('/debug/:interviewId', authMiddleware, async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId).populate('interviewerId');
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker configured for this interview' });
    }
    
    console.log(`🐛 Getting raw Nylas data for notetaker ${interview.notetakerId}`);
    
    // Get current notetaker status from Nylas
    const status = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId);
    
    // Also try to get the transcript to see if it's available
    let transcriptAvailable = false;
    let transcriptError = null;
    try {
      const transcript = await nylasV3Service.getStandaloneTranscript(interview.notetakerId);
      if (transcript && transcript.content) {
        transcriptAvailable = true;
      }
    } catch (err) {
      transcriptError = err.message;
    }
    
    res.json({
      success: true,
      interview: {
        id: interview._id,
        notetakerId: interview.notetakerId,
        notetakerEnabled: interview.notetakerEnabled,
        notetakerStatus: interview.notetakerStatus,
        scheduledAt: interview.scheduledAt,
        meetingLink: interview.conferencing?.details?.url || interview.meetingLink
      },
      nylasRawResponse: status,
      parsedData: {
        state: status.data?.state || status.state,
        meetingState: status.data?.meeting_state || status.meeting_state,
        joinTime: status.data?.join_time || status.join_time,
        allFields: Object.keys(status.data || status)
      },
      transcriptStatus: {
        available: transcriptAvailable,
        error: transcriptError
      }
    });
    
  } catch (error) {
    console.error('Error getting debug data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual override endpoint - force status to recording (for testing when Nylas isn't updating properly)
router.post('/force-recording/:interviewId', authMiddleware, async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker configured for this interview' });
    }
    
    console.log(`⚠️ MANUAL OVERRIDE: Forcing notetaker status to 'recording' for interview ${interviewId}`);
    
    const oldStatus = interview.notetakerStatus;
    interview.notetakerStatus = 'recording';
    await interview.save();
    
    res.json({
      success: true,
      message: 'Manually forced notetaker status to recording',
      oldStatus: oldStatus,
      newStatus: 'recording',
      warning: 'This is a manual override. The actual Nylas status may differ.',
      note: 'Transcript will still only be available after the meeting ends and Nylas processes it.'
    });
    
  } catch (error) {
    console.error('Error forcing recording status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Multi-candidate transcript segmentation endpoints
router.get('/transcript/segmented/:interviewId', authMiddleware, async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { includeOverflow = 'true' } = req.query;
    
    console.log(`🔍 Getting segmented transcript for interview: ${interviewId}`);
    
    const segmentedTranscript = await transcriptSegmentationService.getInterviewTranscript(
      interviewId, 
      includeOverflow === 'true'
    );
    
    res.json({
      success: true,
      data: segmentedTranscript
    });
    
  } catch (error) {
    console.error('Error getting segmented transcript:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get full session transcript with all candidate segments
router.get('/transcript/session/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    console.log(`🔍 Getting full session transcript for: ${sessionId}`);
    
    // Find the interview with transcript content
    const interviews = await Interview.find({ 
      multiCandidateSessionId: sessionId 
    }).populate('candidateId', 'firstName lastName email');
    
    if (!interviews || interviews.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No interviews found for this session' 
      });
    }
    
    // Get the transcript from the first interview that has one
    const transcriptHolder = interviews.find(i => i.transcript?.content);
    if (!transcriptHolder || !transcriptHolder.transcript?.content) {
      return res.status(404).json({ 
        success: false, 
        error: 'No transcript available for this session' 
      });
    }
    
    // Segment the transcript
    const segmentedData = await transcriptSegmentationService.segmentTranscriptBySession(
      sessionId,
      transcriptHolder.transcript.content
    );
    
    res.json({
      success: true,
      sessionId,
      interviews: interviews.map(i => ({
        id: i._id,
        candidateId: i.candidateId._id,
        candidateName: `${i.candidateId.firstName} ${i.candidateId.lastName}`,
        candidateEmail: i.candidateId.email,
        order: i.multiCandidateOrder,
        scheduledAt: i.scheduledAt,
        duration: i.duration
      })),
      segments: segmentedData
    });
    
  } catch (error) {
    console.error('Error getting session transcript:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Multi-candidate interview analysis endpoints
router.post('/analysis/multi-candidate/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    console.log(`🤖 Starting multi-candidate analysis for session: ${sessionId}`);
    
    const analysis = await aiInterviewAnalysisService.analyzeMultiCandidateSession(sessionId);
    
    res.json({
      success: true,
      sessionId,
      analysis
    });
    
  } catch (error) {
    console.error('Error analyzing multi-candidate session:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get existing multi-candidate analysis
router.get('/analysis/multi-candidate/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Find interviews in this session
    const interviews = await Interview.find({ 
      multiCandidateSessionId: sessionId 
    }).populate('candidateId', 'firstName lastName email');
    
    if (!interviews || interviews.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No interviews found for this session' 
      });
    }
    
    // Check if any interview has analysis data
    const analysisData = interviews.map(interview => ({
      interviewId: interview._id,
      candidateId: interview.candidateId._id,
      candidateName: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
      candidateEmail: interview.candidateId.email,
      order: interview.multiCandidateOrder,
      hasAnalysis: !!(interview.aiInterviewSummary?.generated),
      analysis: interview.aiInterviewSummary || null
    }));
    
    res.json({
      success: true,
      sessionId,
      interviews: analysisData,
      hasComparativeAnalysis: analysisData.some(a => a.hasAnalysis)
    });
    
  } catch (error) {
    console.error('Error getting multi-candidate analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 
