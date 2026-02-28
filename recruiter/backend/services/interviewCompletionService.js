const Interview = require('../models/Interview');
const nylasV3Service = require('./nylasV3Service');
const NylasAccount = require('../models/NylasAccount');

async function getAccountCredentials(user) {
  if (!user?.nylasAccountId) return null;

  const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
  if (!nylasAccount) return null;

  return {
    apiKey: nylasAccount.apiKey,
    apiUri: nylasAccount.apiUri,
    region: nylasAccount.region,
    clientId: nylasAccount.clientId
  };
}

// Helper function to update pipeline status when interview is completed
async function updatePipelineStatusOnCompletion(interview) {
  try {
    if (!interview.jobId || !interview.candidateId) {
      console.log('ℹ️ No job/candidate link for pipeline status update');
      return;
    }

    console.log(`🔄 [AUTO-COMPLETE] Updating pipeline status for candidate ${interview.candidateId} in job ${interview.jobId}`);
    
    const Job = require('../models/Job');
    const job = await Job.findById(interview.jobId);
    
    if (job) {
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === interview.candidateId.toString()
      );
      
      if (applicantIndex !== -1) {
        const applicant = job.applicants[applicantIndex];
        const previousStatus = applicant.status;
        
        // Only update if current status is interviewing
        if (previousStatus === 'interviewing') {
          // Check if there are other incomplete interviews for this candidate
          const otherInterviews = await Interview.find({
            candidateId: interview.candidateId,
            jobId: interview.jobId,
            _id: { $ne: interview._id },
            status: { $in: ['scheduled', 'confirmed', 'in_progress'] }
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
              notes: 'Status automatically updated when interview was completed with transcript',
              previousStatus
            });
            
            await job.save();
            console.log(`✅ [AUTO-COMPLETE] Pipeline status updated: ${previousStatus} → offered`);
          } else {
            console.log(`ℹ️ [AUTO-COMPLETE] Candidate has ${otherInterviews.length} other pending interviews, keeping status as interviewing`);
          }
        } else {
          console.log(`ℹ️ [AUTO-COMPLETE] Pipeline status not updated - candidate is at ${previousStatus} stage`);
        }
      } else {
        console.log(`❌ [AUTO-COMPLETE] Candidate not found in job pipeline`);
      }
    } else {
      console.log(`❌ [AUTO-COMPLETE] Job not found: ${interview.jobId}`);
    }
  } catch (error) {
    console.error('⚠️ [AUTO-COMPLETE] Failed to update pipeline status:', error.message);
    // Don't throw - this is a background operation
  }
}

// Check and complete interviews that should be marked as completed
async function checkAndCompleteInterviews() {
  try {
    console.log('🔍 [COMPLETION-CHECK] Starting periodic interview completion check...');
    
    // Find interviews that might need completion
    // Only check interviews from the last 3 days to avoid endless checking of old meetings
    const threeDaysAgo = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000));
    
    const candidateInterviews = await Interview.find({
      status: { $in: ['in_progress', 'scheduled', 'confirmed'] },
      notetakerEnabled: true,
      $or: [
        // Regular interviews with their own notetaker ID
        { notetakerId: { $exists: true, $ne: null } },
        // Multi-candidate interviews (may not have individual notetaker IDs)
        { isMultiCandidate: true, multiCandidateSessionId: { $exists: true, $ne: null } }
      ],
      scheduledAt: { 
        $lt: new Date(), // Past interviews only
        $gte: threeDaysAgo // But not older than 3 days
      }
    }).populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    console.log(`📋 [COMPLETION-CHECK] Found ${candidateInterviews.length} interviews to check`);
    
    let completedCount = 0;
    
    for (const interview of candidateInterviews) {
      try {
        console.log(`🔍 [COMPLETION-CHECK] Checking interview ${interview._id}...`);
        
        // Check if interview should have ended based on time
        const interviewEndTime = new Date(interview.scheduledAt.getTime() + (interview.duration + 15) * 60 * 1000);
        const now = new Date();
        const hoursSinceScheduled = (now - new Date(interview.scheduledAt)) / (1000 * 60 * 60);
        
        if (now < interviewEndTime) {
          console.log(`⏰ [COMPLETION-CHECK] Interview ${interview._id} hasn't ended yet`);
          continue;
        }
        
        // If interview is more than 2 hours old and notetaker is in failed state, complete it without transcript
        if (hoursSinceScheduled > 2 && (interview.notetakerStatus === 'failed' || interview.notetakerStatus === 'failed_entry')) {
          console.log(`🚫 [AUTO-COMPLETE] Interview ${interview._id} has persistent failed notetaker (${interview.notetakerStatus}) - completing without transcript`);
          interview.status = 'completed';
          interview.notetakerError = `Notetaker failed: ${interview.notetakerStatus} - Interview completed without recording`;
          await interview.save();
          await updatePipelineStatusOnCompletion(interview);
          completedCount++;
          continue;
        }
        
        // Check if we already have transcript content
        // For multi-candidate interviews, check the session holder's transcript
        let hasTranscriptContent = false;
        
        if (interview.isMultiCandidate && interview.multiCandidateSessionId) {
          console.log(`🔍 [COMPLETION-CHECK] Checking multi-candidate session ${interview.multiCandidateSessionId} for interview ${interview._id}`);
          
          try {
            // Import here to avoid circular dependency
            const transcriptSegmentationService = require('./transcriptSegmentationService');
            const segmentedTranscript = await transcriptSegmentationService.getInterviewTranscript(interview._id, true);
            
            if (segmentedTranscript.transcript && segmentedTranscript.transcript.content) {
              hasTranscriptContent = true;
              console.log(`✅ [COMPLETION-CHECK] Multi-candidate interview ${interview._id} has segmented transcript`);
            } else {
              console.log(`📝 [COMPLETION-CHECK] Multi-candidate interview ${interview._id} transcript not yet available: ${segmentedTranscript.message || 'Segmentation pending'}`);
            }
          } catch (segmentError) {
            console.log(`⚠️ [COMPLETION-CHECK] Error checking multi-candidate transcript for ${interview._id}: ${segmentError.message}`);
            hasTranscriptContent = false;
          }
        } else {
          // Regular single interview - check directly
          hasTranscriptContent = !!interview.transcript?.content;
        }
        
        if (hasTranscriptContent) {
          console.log(`✅ [COMPLETION-CHECK] Interview ${interview._id} has transcript content, completing...`);
          interview.status = 'completed';
          await interview.save();
          await updatePipelineStatusOnCompletion(interview);
          completedCount++;
          continue;
        }
        
        // Check notetaker status via API
        // For multi-candidate interviews, get the notetaker ID from session holder if needed
        let notetakerIdToCheck = interview.notetakerId;
        
        if (interview.isMultiCandidate && interview.multiCandidateSessionId && !notetakerIdToCheck) {
          console.log(`🔍 [COMPLETION-CHECK] Looking for session holder's notetaker ID for interview ${interview._id}`);
          try {
            const sessionInterviews = await Interview.find({
              multiCandidateSessionId: interview.multiCandidateSessionId
            }).setOptions({ sanitizeFilter: false }).sort({ multiCandidateOrder: 1 });
            
            const sessionHolder = sessionInterviews.find(si => si.notetakerId);
            if (sessionHolder) {
              notetakerIdToCheck = sessionHolder.notetakerId;
              // Standalone notetakers are account-scoped; completion checks only need a notetaker ID.
              console.log(`✅ [COMPLETION-CHECK] Found session holder notetaker: ${notetakerIdToCheck}`);
            }
          } catch (sessionError) {
            console.log(`⚠️ [COMPLETION-CHECK] Error finding session holder: ${sessionError.message}`);
          }
        }
        
        if (notetakerIdToCheck) {
          try {
            const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;
            const statusResponse = await nylasV3Service.getStandaloneNotetakerStatus(notetakerIdToCheck, accountCredentials);

            const notetakerData = statusResponse.data || statusResponse;
            const state = notetakerData.state || notetakerData.status || 'unknown';
            const meetingState = notetakerData.meeting_state || 'unknown';
            
            console.log(`📊 [COMPLETION-CHECK] Interview ${interview._id} notetaker status: state=${state}, meetingState=${meetingState}`);
            
            // Update notetaker status in database
            const mappedStatus = mapNotetakerStatus(meetingState, state);
            if (interview.notetakerStatus !== mappedStatus) {
              interview.notetakerStatus = mappedStatus;
              interview.notetakerType = 'standalone';
              await interview.save();
              console.log(`📊 [STATUS-UPDATE] Interview ${interview._id} notetaker status: ${interview.notetakerStatus} → ${mappedStatus}`);
            }
            
            if (interview.notetakerType !== 'standalone') {
              interview.notetakerType = 'standalone';
              await interview.save();
            }

            // If notetaker is completed, check if interview should be completed
            if (mappedStatus === 'completed' && interview.status !== 'completed') {
              console.log(`🤖 [AUTO-COMPLETE] Notetaker completed for interview ${interview._id}`);
              
              // Check if transcript is available or if enough time has passed
              let transcriptAvailable = false;
              
              if (interview.isMultiCandidate && interview.multiCandidateSessionId) {
                // For multi-candidate interviews, check if transcript can be segmented
                try {
                  const transcriptSegmentationService = require('./transcriptSegmentationService');
                  const segmentedTranscript = await transcriptSegmentationService.getInterviewTranscript(interview._id, true);
                  transcriptAvailable = !!(segmentedTranscript.transcript && segmentedTranscript.transcript.content);
                  console.log(`📝 [AUTO-COMPLETE] Multi-candidate transcript available for ${interview._id}: ${transcriptAvailable}`);
                } catch (segmentError) {
                  console.log(`⚠️ [AUTO-COMPLETE] Error checking multi-candidate transcript: ${segmentError.message}`);
                  transcriptAvailable = false;
                }
              } else {
                // Single interview - check directly
                transcriptAvailable = !!(interview.transcript?.content || interview.transcriptAvailableAt);
              }
              
              const timeBasedCompletion = interview.scheduledAt && 
                new Date() > new Date(interview.scheduledAt.getTime() + (interview.duration + 10) * 60 * 1000);
              
              const shouldComplete = transcriptAvailable || timeBasedCompletion;
              
              if (shouldComplete) {
                console.log(`✅ [AUTO-COMPLETE] Completing interview ${interview._id} - transcript: ${transcriptAvailable}, time: ${timeBasedCompletion}`);
                interview.status = 'completed';
                await interview.save();
                await updatePipelineStatusOnCompletion(interview);
                completedCount++;
              } else {
                console.log(`⏳ [AUTO-COMPLETE] Interview ${interview._id} not ready for completion - waiting for transcript or time`);
              }
            }
            
          } catch (notetakerError) {
            // Handle the case where notetaker is not found
            if (notetakerError.message && notetakerError.message.includes('NOTETAKER_NOT_FOUND')) {
              console.log(`⚠️ [COMPLETION-CHECK] Notetaker ${interview.notetakerId} not found for interview ${interview._id} - updating status to deleted`);
              
              // Update the interview to reflect that the notetaker is no longer available
              interview.notetakerStatus = 'deleted';
              await interview.save();
              
              // Continue with the completion check as usual
            } else {
              console.error(`❌ [COMPLETION-CHECK] Error getting notetaker status for interview ${interview._id}:`, notetakerError.message);
              
              // If it's a persistent failed_entry state, mark interview for manual review
              if (interview.notetakerStatus === 'failed' || interview.notetakerStatus === 'failed_entry') {
                const timeSinceFailed = new Date() - new Date(interview.scheduledAt);
                const hoursToComplete = interview.duration + 2; // Interview duration plus 2 hours buffer
                
                // If enough time has passed since the interview was supposed to end, complete it anyway
                if (timeSinceFailed > hoursToComplete * 60 * 60 * 1000) {
                  console.log(`⚠️ [AUTO-COMPLETE] Interview ${interview._id} has failed notetaker but enough time passed - completing without transcript`);
                  interview.status = 'completed';
                  interview.notetakerError = 'Notetaker failed to join meeting - completed without transcript';
                  await interview.save();
                  await updatePipelineStatusOnCompletion(interview);
                  completedCount++;
                }
              }
              
              // Continue with other interviews even if one fails
            }
          }
        } else {
          console.log(`⚠️ [COMPLETION-CHECK] Interview ${interview._id} missing notetaker ID (checked session holder too)`);
          
          // For multi-candidate interviews without transcript, complete after sufficient time
          if (interview.isMultiCandidate && hoursSinceScheduled > 2) {
            console.log(`⏰ [AUTO-COMPLETE] Multi-candidate interview ${interview._id} - completing after ${Math.round(hoursSinceScheduled * 100) / 100} hours without transcript`);
            interview.status = 'completed';
            interview.notetakerError = 'Multi-candidate interview completed - transcript may be available in session holder';
            await interview.save();
            await updatePipelineStatusOnCompletion(interview);
            completedCount++;
          }
        }
        
      } catch (error) {
        console.error(`❌ [COMPLETION-CHECK] Error processing interview ${interview._id}:`, error.message);
      }
    }
    
    // Clean up very old interviews that are stuck in pending states
    await cleanupOldInterviews();
    
    console.log(`✅ [COMPLETION-CHECK] Completed ${completedCount} interviews`);
    return completedCount;
    
  } catch (error) {
    console.error('❌ [COMPLETION-CHECK] Error in completion check:', error);
    throw error;
  }
}

// Clean up interviews older than 7 days that are still in incomplete states
// NOTE: This ONLY cleans up incomplete interviews, completed interviews are preserved
async function cleanupOldInterviews() {
  try {
    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    
    console.log('🧹 [CLEANUP] Starting cleanup of old INCOMPLETE interviews with calendar verification...');
    
    // Find very old interviews that are still in incomplete states (NOT completed)
    const oldInterviews = await Interview.find({
      status: { $in: ['scheduled', 'confirmed', 'in_progress'] }, // Only incomplete interviews
      scheduledAt: { $lt: sevenDaysAgo }
    }).populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (oldInterviews.length > 0) {
      console.log(`🧹 [CLEANUP] Found ${oldInterviews.length} old incomplete interviews to verify`);
      
      for (const interview of oldInterviews) {
        const daysSinceScheduled = Math.floor((Date.now() - interview.scheduledAt.getTime()) / (1000 * 60 * 60 * 24));
        
        console.log(`🔍 [CLEANUP] Verifying interview ${interview._id} scheduled ${daysSinceScheduled} days ago (status: ${interview.status})`);
        
        // Try to verify if the meeting actually occurred by checking calendar event
        let meetingOccurred = false;
        let verificationNote = 'Could not verify if meeting occurred';
        
        try {
          if (interview.eventId && interview.interviewerId?.nylasGrantId) {
            // Get account credentials if interviewer has a linked Nylas account
            let accountCredentials = null;
            if (interview.interviewerId.nylasAccountId) {
              const NylasAccount = require('../models/NylasAccount');
              const nylasAccount = await NylasAccount.findById(interview.interviewerId.nylasAccountId).select('+apiKey');
              if (nylasAccount) {
                accountCredentials = {
                  apiKey: nylasAccount.apiKey,
                  apiUri: nylasAccount.apiUri,
                  region: nylasAccount.region,
                  clientId: nylasAccount.clientId
                };
              }
            }
            
            const eventDetails = await nylasV3Service.getEvent(interview.interviewerId.nylasGrantId, interview.eventId, accountCredentials);
            
            if (eventDetails) {
              // Check if event has participants who accepted/attended
              const hasParticipants = eventDetails.participants && eventDetails.participants.length > 1;
              const hasAcceptedParticipants = eventDetails.participants?.some(p => 
                p.status === 'accepted' || p.status === 'maybe'
              );
              
              // Check if notetaker was active (better indicator of actual meeting)
              const hasNotetakerActivity = interview.notetakerEnabled && 
                interview.notetakerStatus && 
                !['failed', 'failed_entry', 'scheduled'].includes(interview.notetakerStatus);
              
              meetingOccurred = hasAcceptedParticipants || hasNotetakerActivity;
              
              verificationNote = `Calendar verification: participants=${hasParticipants ? 'yes' : 'no'}, ` +
                               `accepted=${hasAcceptedParticipants ? 'yes' : 'no'}, ` +
                               `notetaker_activity=${hasNotetakerActivity ? interview.notetakerStatus : 'none'}`;
              
              console.log(`📅 [VERIFICATION] Interview ${interview._id}: ${verificationNote}, occurred=${meetingOccurred}`);
            }
          }
        } catch (verificationError) {
          console.warn(`⚠️ [VERIFICATION] Could not verify calendar event for interview ${interview._id}:`, verificationError.message);
          verificationNote = `Calendar verification failed: ${verificationError.message}`;
        }
        
        // Only auto-complete if meeting clearly didn't occur OR we can't verify after 14+ days
        const shouldAutoComplete = !meetingOccurred || daysSinceScheduled >= 14;
        
        if (shouldAutoComplete) {
          console.log(`🧹 [CLEANUP] Auto-completing interview ${interview._id} - Meeting ${meetingOccurred ? 'occurred but old' : 'did not occur'}`);
          
          // Mark interview as completed with detailed notes
          interview.status = 'completed';
          interview.notetakerStatus = interview.notetakerEnabled ? 'failed' : 'disabled';
          interview.completedAt = new Date();
          if (!interview.notes || !Array.isArray(interview.notes)) {
            interview.notes = [];
          }
          interview.notes.push({
            note: `Interview auto-completed by system after ${daysSinceScheduled} days. ${verificationNote}. ${meetingOccurred ? 'Meeting appeared to occur but was auto-completed due to age' : 'No evidence of meeting occurrence'}.`,
            addedBy: 'system',
            addedAt: new Date()
          });
          
          await interview.save();
        
          // Update pipeline status
          try {
            await updatePipelineStatusOnCompletion(interview);
          } catch (pipelineError) {
            console.error(`❌ [CLEANUP] Error updating pipeline for interview ${interview._id}:`, pipelineError.message);
          }
        } else {
          console.log(`✅ [PRESERVATION] Interview ${interview._id} shows evidence of meeting occurrence - preserving as ${interview.status}`);
        }
      }
      
      const completedCount = oldInterviews.filter(interview => interview.status === 'completed').length;
      console.log(`✅ [CLEANUP] Processed ${oldInterviews.length} old interviews: ${completedCount} auto-completed, ${oldInterviews.length - completedCount} preserved (completed interviews remain untouched)`);
    } else {
      console.log('✅ [CLEANUP] No old incomplete interviews found to clean up (completed interviews are preserved)');
    }
    
  } catch (error) {
    console.error('❌ [CLEANUP] Error cleaning up old interviews:', error);
    // Don't throw - this is a background operation
  }
}

// Helper function to map Nylas states to our status (copied from notetakerController)
function mapNotetakerStatus(meetingState, state) {
  console.log(`🔍 Mapping notetaker status - state: '${state}', meetingState: '${meetingState}'`);
  
  // Map based on both meeting_state and state fields
  if (state === 'scheduled') {
    return 'scheduled';
  } else if (state === 'connected' || meetingState === 'in_call') {
    // If bot is connected OR meeting state shows in_call, it's recording
    return 'recording';
  } else if (meetingState === 'dispatched' && state === 'connecting') {
    return 'joining';
  } else if (meetingState === 'ended' || state === 'disconnected') {
    return 'processing';
  } else if (meetingState === 'failed_entry' || state === 'failed_entry') {
    return 'failed';
  } else if (meetingState === 'api_request' && state === 'disconnected') {
    return 'stopped'; // Manually removed via API
  } else if (state === 'enabled') {
    return 'enabled';
  } else if (state === 'completed') {
    return 'completed';
  } else if (state === 'cancelled') {
    return 'cancelled';
  } else if (state === 'joining' || meetingState === 'joining') {
    return 'joining';
  } else if (state === 'recording' || meetingState === 'recording') {
    return 'recording';
  } else if (state === 'processing' || meetingState === 'processing') {
    return 'processing';
  } else if (state === 'media_available') {
    // Media is available for download/processing - meeting has ended
    return 'processing';
  }
  
  // Log unknown states for debugging
  console.warn(`⚠️ Unknown notetaker state mapping: state='${state}', meetingState='${meetingState}'`);
  console.warn('Consider adding this state to the mapping function');
  
  // Default to 'pending' for unknown states
  return 'pending';
}

// Start periodic checking (every 5 minutes)
function startPeriodicCompletionCheck() {
  console.log('🚀 [COMPLETION-SERVICE] Starting periodic interview completion checks...');
  
  // Run immediately
  checkAndCompleteInterviews().catch(error => {
    console.error('❌ [COMPLETION-SERVICE] Initial completion check failed:', error);
  });
  
  // Then run every 5 minutes
  const intervalId = setInterval(() => {
    checkAndCompleteInterviews().catch(error => {
      console.error('❌ [COMPLETION-SERVICE] Periodic completion check failed:', error);
    });
  }, 5 * 60 * 1000); // 5 minutes
  
  return intervalId;
}

module.exports = {
  checkAndCompleteInterviews,
  updatePipelineStatusOnCompletion,
  startPeriodicCompletionCheck,
  cleanupOldInterviews
}; 
