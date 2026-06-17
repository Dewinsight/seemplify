const prisma = require('../db/client');
const nylasV3Service = require('../services/nylasV3Service');
const transcriptSegmentationService = require('../services/transcriptSegmentationService');

// Helper function to update pipeline status - copied from interviewCompletionService
async function updatePipelineStatusOnCompletion(interview) {
  try {
    if (!interview.jobId || !interview.candidateId) {
      console.log('ℹ️ No job/candidate link for pipeline status update');
      return;
    }

    console.log(`🔄 [MANUAL-SYNC] Updating pipeline status for candidate ${interview.candidateId} in job ${interview.jobId}`);
    
    const job = await prisma.job.findUnique({ where: { id: String(interview.jobId) } });

    if (job) {
      const applicants = Array.isArray(job.applicants) ? job.applicants : [];
      const applicantIndex = applicants.findIndex(
        applicant => applicant.candidate.toString() === interview.candidateId.toString()
      );

      if (applicantIndex !== -1) {
        const applicant = applicants[applicantIndex];
        const previousStatus = applicant.status;

        // Only update if current status is interviewing
        if (previousStatus === 'interviewing') {
          // Check if there are other incomplete interviews for this candidate
          const otherInterviews = await prisma.interview.findMany({
            where: {
              candidateId: interview.candidateId,
              jobId: interview.jobId,
              id: { not: interview.id },
              status: { in: ['scheduled', 'confirmed', 'in_progress'] }
            }
          });

          if (otherInterviews.length === 0) {
            // No other pending interviews, move to next stage
            applicant.status = 'offered'; // Or could be 'reviewing' depending on business logic
            
            // Add to status history
            if (!applicant.statusHistory) {
              applicant.statusHistory = [];
            }
            
            applicant.statusHistory.push({
              status: 'offered',
              changedBy: interview.interviewerId,
              changedAt: new Date(),
              notes: 'Status automatically updated when interview was manually completed',
              previousStatus
            });

            await prisma.job.update({ where: { id: job.id }, data: { applicants } });
            console.log(`✅ [MANUAL-SYNC] Pipeline status updated: ${previousStatus} → offered`);
          } else {
            console.log(`ℹ️ [MANUAL-SYNC] Candidate has ${otherInterviews.length} other pending interviews, keeping status as interviewing`);
          }
        } else {
          console.log(`ℹ️ [MANUAL-SYNC] Pipeline status not updated - candidate is at ${previousStatus} stage`);
        }
      } else {
        console.log(`❌ [MANUAL-SYNC] Candidate not found in job pipeline`);
      }
    } else {
      console.log(`❌ [MANUAL-SYNC] Job not found: ${interview.jobId}`);
    }
  } catch (error) {
    console.error('❌ [MANUAL-SYNC] Error updating pipeline status:', error.message);
    // Don't throw - this is a background operation
  }
}

/**
 * Manually sync and download transcript for an interview
 * Handles both single interviews and multi-candidate sessions
 */
const manualTranscriptSync = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (interview && interview.interviewerId) {
      interview.interviewerId = await prisma.user.findUnique({
        where: { id: interview.interviewerId },
        select: { id: true, nylasGrantId: true, nylasAccountId: true }
      });
    }

    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    console.log(`🔄 [MANUAL-SYNC] Starting manual transcript sync for interview: ${interviewId}`);
    console.log(`Interview details:`, {
      isMultiCandidate: interview.isMultiCandidate,
      multiCandidateSessionId: interview.multiCandidateSessionId,
      notetakerId: interview.notetakerId,
      notetakerStatus: interview.notetakerStatus,
      hasTranscript: !!interview.transcript?.content
    });

    // Handle multi-candidate interviews
    if (interview.isMultiCandidate && interview.multiCandidateSessionId) {
      console.log(`👥 [MANUAL-SYNC] Processing multi-candidate interview`);
      
      // Find the session holder (interview with notetaker ID)
      const sessionInterviews = await prisma.interview.findMany({
        where: { multiCandidateSessionId: interview.multiCandidateSessionId },
        orderBy: { multiCandidateOrder: 'asc' }
      });
      // Stitch interviewerId (soft ref -> User)
      const interviewerIds = Array.from(new Set(sessionInterviews.map((si) => si.interviewerId).filter(Boolean)));
      if (interviewerIds.length) {
        const interviewers = await prisma.user.findMany({
          where: { id: { in: interviewerIds } },
          select: { id: true, nylasGrantId: true, nylasAccountId: true }
        });
        const interviewerById = new Map(interviewers.map((u) => [String(u.id), u]));
        for (const si of sessionInterviews) {
          if (si.interviewerId) si.interviewerId = interviewerById.get(String(si.interviewerId)) || null;
        }
      }

      const sessionHolder = sessionInterviews.find(si => si.notetakerId) || sessionInterviews[0];
      
      if (!sessionHolder) {
        return res.status(400).json({ error: 'No session holder found for this multi-candidate interview' });
      }
      
      console.log(`📝 [MANUAL-SYNC] Found session holder: ${sessionHolder._id}`);
      
      // Try to download transcript from session holder's notetaker
      if (sessionHolder.notetakerId) {
        try {
          // First check if we already have the transcript in the session holder
          if (!sessionHolder.transcript?.content) {
            console.log(`⬇️ [MANUAL-SYNC] Downloading transcript from Nylas...`);
            
            // Get account credentials if interviewer has a linked Nylas account
            let accountCredentials = null;
            if (sessionHolder.interviewerId?.nylasAccountId) {
              const nylasAccount = await prisma.nylasAccount.findUnique({ where: { id: String(sessionHolder.interviewerId.nylasAccountId) } });
              if (nylasAccount) {
                accountCredentials = {
                  apiKey: nylasAccount.apiKey,
                  apiUri: nylasAccount.apiUri,
                  region: nylasAccount.region,
                  clientId: nylasAccount.clientId
                };
              }
            }
            
            // Get media from Nylas
            const media = await nylasV3Service.getStandaloneNotetakerMedia(sessionHolder.notetakerId, accountCredentials);
            
            if (!media.transcript?.url) {
              return res.status(404).json({ 
                error: 'Transcript not yet available from Nylas',
                notetakerStatus: interview.notetakerStatus,
                message: 'The transcript may still be processing. Please try again in a few minutes.'
              });
            }
            
            // Download the transcript content
            const transcript = await nylasV3Service.getStandaloneTranscript(sessionHolder.notetakerId, accountCredentials);
            
            if (!transcript.content) {
              return res.status(404).json({ 
                error: 'Transcript content is empty',
                message: 'The transcript downloaded but has no content. The recording may have failed.'
              });
            }
            
            // Save transcript to session holder
            sessionHolder.transcript = {
              content: transcript.content,
              summary: null,
              keyPoints: [],
              actionItems: [],
              participants: [],
              duration: sessionHolder.duration * 60,
              language: 'en',
              confidence: null
            };
            sessionHolder.transcriptAvailableAt = new Date();
            sessionHolder.notetakerType = 'standalone';

            if (media.recording?.url) {
              sessionHolder.recordingUrl = media.recording.url;
            }

            await prisma.interview.update({
              where: { id: sessionHolder.id },
              data: {
                transcript: sessionHolder.transcript,
                transcriptAvailableAt: sessionHolder.transcriptAvailableAt,
                notetakerType: sessionHolder.notetakerType,
                recordingUrl: sessionHolder.recordingUrl
              }
            });
            console.log(`✅ [MANUAL-SYNC] Transcript saved to session holder`);
          }
          
          // Now try to get the segmented transcript for this specific interview
          try {
            const segmentedTranscript = await transcriptSegmentationService.getInterviewTranscript(
              interviewId, 
              true // include overflow
            );
            
            if (!segmentedTranscript.transcript || !segmentedTranscript.transcript.content) {
              return res.status(404).json({
                error: 'Could not segment transcript for this candidate',
                message: segmentedTranscript.message || 'Transcript segmentation failed',
                sessionHasTranscript: !!sessionHolder.transcript?.content
              });
            }
            
            // Update interview status if not already completed
            if (interview.status !== 'completed') {
              interview.status = 'completed';
              await prisma.interview.update({ where: { id: interview.id }, data: { status: 'completed' } });
              console.log(`✅ [MANUAL-SYNC] Interview marked as completed`);
            }
            
            return res.json({
              success: true,
              message: 'Multi-candidate transcript synced successfully',
              transcript: {
                content: JSON.parse(segmentedTranscript.transcript.content),
                candidateName: segmentedTranscript.candidateName,
                hasOverflow: segmentedTranscript.transcript.hasOverflow,
                speakerStats: segmentedTranscript.transcript.speakerStats
              },
              scheduledTime: segmentedTranscript.scheduledTime,
              actualTime: segmentedTranscript.actualTime,
              overflow: segmentedTranscript.overflow,
              isMultiCandidate: true,
              sessionId: interview.multiCandidateSessionId
            });
            
          } catch (segmentError) {
            console.error(`❌ [MANUAL-SYNC] Segmentation error:`, segmentError);
            return res.status(500).json({
              error: 'Failed to segment transcript',
              message: segmentError.message,
              sessionHasTranscript: !!sessionHolder.transcript?.content
            });
          }
          
        } catch (nylasError) {
          console.error(`❌ [MANUAL-SYNC] Nylas API error:`, nylasError);
          return res.status(500).json({
            error: 'Failed to download transcript from Nylas',
            message: nylasError.message
          });
        }
      } else {
        return res.status(400).json({
          error: 'Session holder missing notetaker ID',
          message: 'Cannot download transcript without a notetaker ID'
        });
      }
    }
    
    // Handle single (regular) interviews
    else {
      console.log(`👤 [MANUAL-SYNC] Processing single interview`);
      
      if (!interview.notetakerId) {
        return res.status(400).json({
          error: 'No notetaker associated with this interview',
          message: 'Cannot sync transcript without a notetaker'
        });
      }
      
      try {
        // Get account credentials if interviewer has a linked Nylas account
        let accountCredentials = null;
        if (interview.interviewerId?.nylasAccountId) {
          const nylasAccount = await prisma.nylasAccount.findUnique({ where: { id: String(interview.interviewerId.nylasAccountId) } });
          if (nylasAccount) {
            accountCredentials = {
              apiKey: nylasAccount.apiKey,
              apiUri: nylasAccount.apiUri,
              region: nylasAccount.region,
              clientId: nylasAccount.clientId
            };
          }
        }
        
        // Get media from Nylas
        const media = await nylasV3Service.getStandaloneNotetakerMedia(interview.notetakerId, accountCredentials);
        
        if (!media.transcript?.url) {
          return res.status(404).json({
            error: 'Transcript not yet available from Nylas',
            notetakerStatus: interview.notetakerStatus,
            message: 'The transcript may still be processing. Please try again in a few minutes.'
          });
        }
        
        // Download the transcript content
        const transcript = await nylasV3Service.getStandaloneTranscript(interview.notetakerId, accountCredentials);
        
        if (!transcript.content) {
          return res.status(404).json({
            error: 'Transcript content is empty',
            message: 'The transcript downloaded but has no content. The recording may have failed.'
          });
        }
        
        // Save transcript to interview
        interview.transcript = {
          content: transcript.content,
          summary: null,
          keyPoints: [],
          actionItems: [],
          participants: [],
          duration: interview.duration * 60,
          language: 'en',
          confidence: null
        };
        interview.transcriptAvailableAt = new Date();
        interview.notetakerType = 'standalone';

        if (media.recording?.url) {
          interview.recordingUrl = media.recording.url;
        }

        // Mark as completed if not already
        if (interview.status !== 'completed') {
          interview.status = 'completed';
          console.log(`✅ [MANUAL-SYNC] Interview marked as completed`);
        }

        await prisma.interview.update({
          where: { id: interview.id },
          data: {
            transcript: interview.transcript,
            transcriptAvailableAt: interview.transcriptAvailableAt,
            notetakerType: interview.notetakerType,
            recordingUrl: interview.recordingUrl,
            status: interview.status
          }
        });
        
        return res.json({
          success: true,
          message: 'Transcript synced successfully',
          transcript: {
            content: interview.transcript.content,
            summary: interview.transcript.summary || '',
            keyPoints: interview.transcript.keyPoints || [],
            actionItems: interview.transcript.actionItems || [],
            participants: interview.transcript.participants || [],
            duration: interview.transcript.duration,
            confidence: interview.transcript.confidence || 0.95
          },
          recordingUrl: interview.recordingUrl,
          transcriptAvailableAt: interview.transcriptAvailableAt,
          isMultiCandidate: false
        });
        
      } catch (nylasError) {
        console.error(`❌ [MANUAL-SYNC] Nylas API error:`, nylasError);
        return res.status(500).json({
          error: 'Failed to download transcript from Nylas',
          message: nylasError.message
        });
      }
    }
    
  } catch (error) {
    console.error(`❌ [MANUAL-SYNC] Error:`, error);
    res.status(500).json({
      error: error.message || 'Failed to sync transcript',
      message: 'An unexpected error occurred during transcript sync'
    });
  }
};

/**
 * Force completion of an interview (manual override)
 */
const forceInterviewCompletion = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    if (interview.status === 'completed') {
      return res.json({
        success: true,
        message: 'Interview already completed',
        status: 'completed'
      });
    }
    
    console.log(`🔨 [FORCE-COMPLETE] Force completing interview: ${interviewId}`);
    
    // Mark interview as completed
    interview.status = 'completed';

    // Add a note about manual completion
    if (!interview.transcript?.content) {
      interview.notetakerError = 'Interview manually completed - transcript may not be available';
    }

    await prisma.interview.update({
      where: { id: interview.id },
      data: { status: interview.status, notetakerError: interview.notetakerError }
    });
    
    // Update pipeline status
    try {
      await updatePipelineStatusOnCompletion(interview);
    } catch (pipelineError) {
      console.error('Error updating pipeline status:', pipelineError);
    }
    
    res.json({
      success: true,
      message: 'Interview force completed successfully',
      status: 'completed',
      transcriptAvailable: !!interview.transcript?.content
    });
    
  } catch (error) {
    console.error(`❌ [FORCE-COMPLETE] Error:`, error);
    res.status(500).json({
      error: error.message || 'Failed to force complete interview'
    });
  }
};

module.exports = {
  manualTranscriptSync,
  forceInterviewCompletion
};
