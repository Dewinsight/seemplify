const Interview = require('../models/Interview');
const User = require('../models/User');
const NylasAccount = require('../models/NylasAccount');
const nylasV3Service = require('../services/nylasV3Service');
const emailService = require('../services/emailService');
const { handleInterviewError } = require('../utils/errorHandler');
const { updatePipelineStatusOnCompletion } = require('../services/interviewCompletionService');
const transcriptSegmentationService = require('../services/transcriptSegmentationService');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const { buildInterviewOrganizationQuery } = require('../utils/organizationResourceScope');

async function organizationInterviewQuery(req, query) {
  return buildInterviewOrganizationQuery(req.user?.currentOrganization, query);
}

// Helper function to get account credentials for a user
async function getAccountCredentials(user) {
  if (!user.nylasAccountId) return null;
  
  const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
  if (!nylasAccount) return null;
  
  return {
    apiKey: nylasAccount.apiKey,
    apiUri: nylasAccount.apiUri,
    region: nylasAccount.region,
    clientId: nylasAccount.clientId
  };
}

const ACTIVE_JOIN_STATUSES = new Set(['joining', 'joined', 'recording', 'processing', 'completed']);
const REPLACEABLE_JOIN_STATUSES = new Set(['pending', 'scheduled', 'enabled', 'failed', 'stopped']);

const handleNotetakerWebhook = async (req, res) => {
  try {
    console.log(`📨 Notetaker webhook received - Type: ${req.body?.type || 'unknown'}, Time: ${new Date().toISOString()}`);
    console.log('Webhook payload:', JSON.stringify(req.body, null, 2));
    
    // Nylas v3 webhook structure - updated based on documentation
    const webhook = req.body;
    
    // Check for proper webhook structure
    if (!webhook.data || !webhook.type) {
      console.error('❌ Invalid webhook payload - missing required fields');
      console.error('Received:', JSON.stringify(webhook, null, 2));
      console.log('Expected structure: { "specversion": "1.0", "type": "...", "source": "...", "id": "...", "time": "...", "data": {...} }');
      return res.status(400).json({ 
        error: 'Invalid webhook payload - missing required fields',
        received: webhook
      });
    }
    
    const { type, data } = webhook;
    const notetaker = data; // The data field contains the notetaker object directly
    const notetakerId = notetaker.id;
    
    if (!notetakerId) {
      console.error('Invalid webhook payload - missing notetaker ID');
      return res.status(400).json({ error: 'Invalid webhook payload - missing notetaker ID' });
    }
    
    console.log(`Processing webhook type: ${type} for notetaker: ${notetakerId}`);
    
    switch(type) {
      case 'notetaker.created':
        // Notetaker was successfully created
        console.log('Notetaker created:', notetakerId);
        await Interview.findOneAndUpdate(
          { notetakerId: notetakerId },
          { notetakerStatus: 'scheduled' }
        );
        break;
        
      case 'notetaker.meeting_state':
        // Handle different meeting states
        const meetingState = notetaker.meeting_state;
        const state = notetaker.state;
        
        console.log(`Notetaker ${notetakerId} meeting state: ${meetingState}, state: ${state}`);
        
        // Update interview based on meeting state
        const mappedStatus = mapNotetakerStatus(meetingState, state);
        const interview = await Interview.findOneAndUpdate(
          { notetakerId: notetakerId },
          { 
            notetakerStatus: mappedStatus
          },
          { new: true }
        );
        
        // If notetaker status becomes 'completed', check if we should complete the interview
        if (interview && mappedStatus === 'completed' && interview.status !== 'completed') {
          console.log(`🤖 [AUTO-COMPLETE] Notetaker completed for interview ${interview._id}, checking for completion...`);
          
          // Check if we have transcript content or if enough time has passed since meeting end
          const shouldComplete = interview.transcript?.content || 
                                interview.transcriptAvailableAt ||
                                (interview.scheduledAt && 
                                 new Date() > new Date(interview.scheduledAt.getTime() + (interview.duration + 10) * 60 * 1000));
          
          if (shouldComplete) {
            console.log(`✅ [AUTO-COMPLETE] Completing interview ${interview._id} - notetaker finished and conditions met`);
            interview.status = 'completed';
            await interview.save();
            
            // Update pipeline status
            await updatePipelineStatusOnCompletion(interview);
          } else {
            console.log(`⏳ [AUTO-COMPLETE] Waiting for transcript content for interview ${interview._id}`);
          }
        }
        
        // Special handling for failed entry
        if (meetingState === 'failed_entry') {
          const diagnosticMessage = 'Notetaker failed_entry: bot could not join the meeting. Check Teams lobby policy, join-before-host, and Nylas Teams prerequisites.';
          console.error('Notetaker failed to join meeting - may need approval or meeting settings issue');
          const failedInterview = await Interview.findOneAndUpdate(
            { notetakerId: notetakerId },
            { 
              notetakerStatus: 'failed',
              notetakerError: diagnosticMessage
            },
            { new: true }
          );

          try {
            const interviewWithInterviewer = failedInterview
              ? await Interview.findOne({ _id: failedInterview._id, notetakerId })
                  .populate('interviewerId', 'email name')
                  .populate('jobId', 'organization')
              : null;

            const recipient = interviewWithInterviewer?.interviewerId?.email;
            if (recipient) {
              const organization = await resolveOrganizationForEmail({
                job: interviewWithInterviewer.jobId,
                interview: interviewWithInterviewer,
                userId: interviewWithInterviewer.interviewerId?._id
              });
              const organizationName = decodeHtmlEntities(organization.name);
              const teamsChecklistUrl = 'https://developer.nylas.com/docs/v3/notetaker/support/troubleshooting/';
              await emailService.sendUserNotification(
                recipient,
                'Notetaker failed to join a Teams interview',
                'The notetaker could not join the meeting. Please review Teams setup and Nylas prerequisites.',
                {
                  organizationName,
                  htmlContent: `
                    <p>The notetaker reported <strong>failed_entry</strong> for interview <strong>${interviewWithInterviewer._id}</strong>.</p>
                    <p>Checklist:</p>
                    <ul>
                      <li>Allow participants to join before organizer</li>
                      <li>Disable waiting room or allowlist bot participant</li>
                      <li>Ensure Teams recording/transcription policies are enabled</li>
                    </ul>
                    <p>Reference: <a href="${teamsChecklistUrl}">${teamsChecklistUrl}</a></p>
                  `
                }
              );
            }
          } catch (opsEmailError) {
            console.error('Failed to send failed_entry diagnostic email:', opsEmailError.message);
          }
        }
        break;
        
      case 'notetaker.media':
        // Media (recording/transcript) status update
        const mediaState = notetaker.state;
        console.log(`Notetaker ${notetakerId} media state: ${mediaState}`);
        
        if (mediaState === 'available' && notetaker.media) {
          // Media is ready for download
          const interview = await Interview.findOneAndUpdate(
            { notetakerId: notetakerId },
            {
              status: 'completed',
              notetakerStatus: 'completed',
              transcriptAvailableAt: new Date(),
              recordingUrl: notetaker.media.recording,
              transcript: {
                url: notetaker.media.transcript,
                available: true
              }
            },
            { new: true }
          );
          
          if (interview) {
            console.log(`✅ Interview ${interview._id} automatically completed - media available`);
            console.log(`📹 Recording URL: ${notetaker.media.recording}`);
            console.log(`📝 Transcript URL: ${notetaker.media.transcript}`);
            // Note: Media files are only stored for 3 days by Nylas
            
            // Update pipeline status if candidate is in a job pipeline
            await updatePipelineStatusOnCompletion(interview);
          }
        } else if (mediaState === 'processing') {
          await Interview.findOneAndUpdate(
            { notetakerId: notetakerId },
            { notetakerStatus: 'processing' }
          );
        }
        break;
        
      case 'notetaker.updated':
        // General notetaker update
        console.log('Notetaker updated:', notetakerId);
        // Update any general fields that might have changed
        const updatedFields = {};
        if (notetaker.state) {
          updatedFields.notetakerStatus = mapNotetakerStatus(notetaker.meeting_state, notetaker.state);
        }
        
        if (Object.keys(updatedFields).length > 0) {
          const updatedInterview = await Interview.findOneAndUpdate(
            { notetakerId: notetakerId },
            updatedFields,
            { new: true }
          );
          
          // Check if this update should trigger completion
          if (updatedInterview && updatedFields.notetakerStatus === 'completed' && updatedInterview.status !== 'completed') {
            console.log(`🤖 [AUTO-COMPLETE] Notetaker updated to completed for interview ${updatedInterview._id}`);
            
            // Check if we should complete the interview
            const shouldComplete = updatedInterview.transcript?.content || 
                                  updatedInterview.transcriptAvailableAt ||
                                  (updatedInterview.scheduledAt && 
                                   new Date() > new Date(updatedInterview.scheduledAt.getTime() + (updatedInterview.duration + 10) * 60 * 1000));
            
            if (shouldComplete) {
              console.log(`✅ [AUTO-COMPLETE] Completing interview ${updatedInterview._id} from notetaker.updated`);
              updatedInterview.status = 'completed';
              await updatedInterview.save();
              await updatePipelineStatusOnCompletion(updatedInterview);
            }
          }
        }
        break;
        
      case 'notetaker.deleted':
        // Notetaker was deleted
        console.log('Notetaker deleted:', notetakerId);
        await Interview.findOneAndUpdate(
          { notetakerId: notetakerId },
          { 
            notetakerStatus: 'deleted',
            notetakerEnabled: false
          }
        );
        break;
        
      default:
        console.log('Unknown notetaker webhook type:', type);
        console.log('Supported types: notetaker.created, notetaker.meeting_state, notetaker.media, notetaker.updated, notetaker.deleted');
    }
    
    res.status(200).json({ 
      received: true,
      type: type,
      notetaker_id: notetakerId
    });
    
  } catch (error) {
    console.error('❌ Error handling notetaker webhook:', error);
    console.error('Stack trace:', error.stack);
    console.error('Webhook body that caused error:', JSON.stringify(req.body, null, 2));
    
    // Return 200 OK even on internal errors to prevent Nylas from marking webhook as failed
    // Log the error but acknowledge receipt
    res.status(200).json({ 
      received: true,
      error: 'Internal processing error - webhook acknowledged',
      message: error.message
    });
  }
};

// Helper function to map Nylas states to our status
function mapNotetakerStatus(meetingState, state) {
  console.log(`🔍 Mapping notetaker status - state: '${state}', meetingState: '${meetingState}'`);
  
  // Map based on both meeting_state and state fields
  if (state === 'scheduled' || state === 'created') {
    return 'scheduled';
  } else if (state === 'connected' || meetingState === 'in_call') {
    // If bot is connected OR meeting state shows in_call, it's recording
    return 'recording';
  } else if (meetingState === 'dispatched' && state === 'connecting') {
    return 'joining';
  } else if (meetingState === 'ended' || state === 'disconnected') {
    return 'processing';
  } else if (meetingState === 'failed_entry') {
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

// Enhanced function with time-based detection for stale meetings only
function mapNotetakerStatusWithTimeCheck(meetingState, state, joinTime, notetakerData) {
  console.log(`🔍 Mapping notetaker status - state: '${state}', meetingState: '${meetingState}', joinTime: ${joinTime}`);
  
  // First try normal mapping - trust actual Nylas states
  let mappedStatus = mapNotetakerStatus(meetingState, state);
  
  // Only use time-based checks for detecting stale/completed meetings after significant time has passed
  // DO NOT override 'scheduled' to 'recording' based on time alone - trust actual meeting states
  if (mappedStatus === 'scheduled' && joinTime) {
    const now = Date.now() / 1000; // Current time in seconds
    const scheduledJoinTime = parseInt(joinTime);
    
    console.log(`⏰ Time check - Current: ${now}, Scheduled: ${scheduledJoinTime}, Diff: ${now - scheduledJoinTime}s`);
    
    // Only check if we're WAY past the meeting time (more than 2 hours)
    // This helps detect stale meetings where webhooks might have been missed
    if (now > scheduledJoinTime + 7200) {
      console.log('🔄 Stale meeting detected (2+ hours past join time) - marking as completed');
      return 'completed'; // Assume meeting is done
    } else if (now > scheduledJoinTime + 3600) {
      console.log('🔄 Long-past meeting detected (1+ hour past join time) - marking as processing');
      return 'processing'; // Assume meeting ended, processing
    }
    // If less than 1 hour past join time, trust the actual Nylas state
    // Don't assume it's recording just because time has passed
  }
  
  return mappedStatus;
}

// Get transcript for an interview
const getTranscript = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { includeOverflow = true, viewFullSession = false } = req.query;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId')
      .populate('candidateId', 'firstName lastName email')
      .populate('jobId', 'title company');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    // Handle multi-candidate interview transcripts
    if (interview.isMultiCandidate) {
      try {
        const transcriptData = await transcriptSegmentationService.getInterviewTranscript(
          interviewId,
          includeOverflow === 'true' || includeOverflow === true,
          req.user.currentOrganization
        );
        
        // If user wants to view full session
        if (viewFullSession === 'true' || viewFullSession === true) {
          const sessionData = await transcriptSegmentationService.segmentTranscriptBySession(
            interview.multiCandidateSessionId,
            transcriptData.transcript?.content || '',
            req.user.currentOrganization
          );
          
          return res.json({
            ...transcriptData,
            fullSession: sessionData,
            viewMode: 'full_session'
          });
        }
        
        return res.json({
          ...transcriptData,
          viewMode: 'candidate_segment'
        });
      } catch (segmentError) {
        console.error('Error segmenting multi-candidate transcript:', segmentError);
        // Fall back to regular transcript handling
      }
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker associated with this interview' });
    }

    const notetakerType = 'standalone';
    
    // Get account credentials for multi-account support
    const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;
    
    // Check if we have cached transcript first
    if (interview.transcript && interview.transcript.content) {
      console.log('Using cached transcript for interview:', interviewId);
      
      // Calculate actual duration from transcript if possible (for multi-candidate interviews)
      // Handle case where duration might be 0, null, or undefined
      let actualDuration = interview.duration && interview.duration > 0 ? interview.duration : 60; // Default to 60 minutes if not set or 0
      
      // For multi-candidate interviews, try to get actual recorded duration
      if (interview.isMultiCandidate && interview.multiCandidateSessionId) {
        try {
          const segmentedTranscript = await transcriptSegmentationService.getInterviewTranscript(
            interviewId,
            false,
            req.user.currentOrganization
          );
          if (segmentedTranscript.actualTime && segmentedTranscript.actualTime.duration) {
            actualDuration = Math.round(segmentedTranscript.actualTime.duration / 60); // Convert seconds to minutes
            console.log(`📊 Using actual recorded duration: ${actualDuration} minutes (from transcript timestamps)`);
          }
        } catch (segmentError) {
          console.log('Could not calculate actual duration from transcript, using scheduled duration');
        }
      }
      
      console.log(`⏱️ Duration info:`, {
        interviewId,
        scheduledDuration: interview.duration,
        actualDuration,
        finalDurationSeconds: actualDuration * 60
      });
      
      // Try to get fresh recording URL if not cached
      let recordingUrl = interview.recordingUrl;
      if (!recordingUrl) {
        try {
          const media = await nylasV3Service.getStandaloneNotetakerMedia(interview.notetakerId, accountCredentials);
          if (media.recording && media.recording.url) {
            recordingUrl = media.recording.url;
            interview.recordingUrl = recordingUrl;
            await interview.save();
          }
        } catch (mediaError) {
          console.log('Could not fetch recording URL:', mediaError.message);
        }
      }
      
      return res.json({
        transcript: {
          content: interview.transcript.content,
          summary: interview.transcript.summary || '',
          keyPoints: interview.transcript.keyPoints || [],
          actionItems: interview.transcript.actionItems || [],
          participants: interview.transcript.participants || [],
          duration: actualDuration * 60, // Convert minutes to seconds
          confidence: interview.transcript.confidence || 0.95
        },
        notetakerStatus: interview.notetakerStatus || 'completed',
        transcriptAvailableAt: interview.transcriptAvailableAt || interview.updatedAt,
        recordingUrl: recordingUrl,
        interview: {
          id: interview._id,
          title: interview.title,
          candidate: interview.candidateId,
          job: interview.jobId,
          scheduledAt: interview.scheduledAt
        }
      });
    }
    
    // Get transcript and media from Nylas
    let transcriptData = null;
    let recordingUrl = null;
    
    try {
      // Try to get both transcript and recording
      const [transcript, media] = await Promise.allSettled([
        nylasV3Service.getStandaloneTranscript(interview.notetakerId, accountCredentials),
        nylasV3Service.getStandaloneNotetakerMedia(interview.notetakerId, accountCredentials)
      ]);
      
      if (transcript.status === 'fulfilled') {
        transcriptData = transcript.value;
      } else if (transcript.reason?.message?.includes('NOTETAKER_NOT_FOUND')) {
        // Handle the case where notetaker is not found
        console.log(`Notetaker ${interview.notetakerId} not found in Nylas - updating database`);
        
        // Update the interview to reflect that the notetaker is no longer available
        interview.notetakerStatus = 'deleted';
        await interview.save();
        
        return res.status(404).json({
          error: 'Notetaker was automatically cleaned up (likely due to meeting not starting or timeout)',
          suggestion: 'You can create a new notetaker if you need to record a meeting'
        });
      }
      
      if (media.status === 'fulfilled' && media.value.recording) {
        recordingUrl = media.value.recording.url;
      }
      
    } catch (error) {
      // Handle direct errors from the service calls
      if (error.message && error.message.includes('NOTETAKER_NOT_FOUND')) {
        console.log(`Notetaker ${interview.notetakerId} not found in Nylas - updating database`);
        
        // Update the interview to reflect that the notetaker is no longer available
        interview.notetakerStatus = 'deleted';
        await interview.save();
        
        return res.status(404).json({
          error: 'Notetaker was automatically cleaned up (likely due to meeting not starting or timeout)',
          suggestion: 'You can create a new notetaker if you need to record a meeting'
        });
      }
      
      console.error('Error fetching transcript/media:', error);
      throw error;
    }
    
    if (!transcriptData || !transcriptData.content) {
      return res.status(404).json({ 
        error: 'Transcript not available yet. Please check back after the meeting has ended and processing is complete.' 
      });
    }
    
    // Process and enhance transcript data
    // Handle case where duration might be 0, null, or undefined
    const durationMinutes = interview.duration && interview.duration > 0 ? interview.duration : 60;
    
    const enhancedTranscript = {
      content: transcriptData.content,
      summary: '', // Could be generated with AI later
      keyPoints: [], // Could be extracted with AI later
      actionItems: [], // Could be extracted with AI later
      participants: [], // Could be extracted from transcript
      duration: durationMinutes * 60, // Convert minutes to seconds, default to 60 min if not set
      confidence: 0.95 // Default confidence
    };
    
    console.log(`⏱️ Enhanced transcript duration: ${durationMinutes} minutes (${durationMinutes * 60} seconds)`);
    
    // Update interview with transcript and recording if not already stored
    if (!interview.transcript?.content) {
      interview.transcript = enhancedTranscript;
      interview.transcriptAvailableAt = new Date();
      if (!interview.notetakerType) {
        interview.notetakerType = notetakerType;
      }
      if (recordingUrl) {
        interview.recordingUrl = recordingUrl;
      }
      
      // Automatically mark interview as completed when transcript is available
      if (interview.status !== 'completed') {
        console.log(`✅ [AUTO-COMPLETE] Marking interview ${interview._id} as completed - transcript content available`);
        interview.status = 'completed';
        
        // Update pipeline status as well
        await updatePipelineStatusOnCompletion(interview, req.user.currentOrganization);
      }
      
      await interview.save();
    }
    
    console.log(`📤 Sending transcript response:`, {
      interviewId: interview._id,
      transcriptDuration: enhancedTranscript.duration,
      transcriptDurationMinutes: Math.round(enhancedTranscript.duration / 60),
      confidence: enhancedTranscript.confidence,
      contentLength: enhancedTranscript.content?.length
    });
    
    res.json({
      transcript: enhancedTranscript,
      notetakerStatus: interview.notetakerStatus || 'completed',
      transcriptAvailableAt: interview.transcriptAvailableAt || new Date(),
      recordingUrl: recordingUrl,
      interview: {
        id: interview._id,
        title: interview.title,
        candidate: interview.candidateId,
        job: interview.jobId,
        scheduledAt: interview.scheduledAt
      },
      metadata: {
        size: transcriptData.size,
        availableUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      }
    });
    
  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(error.message.includes('not available') ? 404 : 500).json({ 
      error: error.message || 'Failed to get transcript' 
    });
  }
};

// Manually enable notetaker for an interview
const enableNotetaker = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { meetingLink } = req.body;
    
    if (!meetingLink) {
      return res.status(400).json({ error: 'Meeting link is required' });
    }
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (interview.notetakerEnabled && interview.notetakerId) {
      return res.status(400).json({ error: 'Notetaker already enabled for this interview' });
    }

    // Get account credentials if interviewer has a linked Nylas account
    let accountCredentials = null;
    if (interview.interviewerId?.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(interview.interviewerId.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        accountCredentials = {
          apiKey: nylasAccount.apiKey,
          apiUri: nylasAccount.apiUri,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        console.log(`   Using Nylas account: ${nylasAccount.name}`);
      }
    }

    const result = await nylasV3Service.createStandaloneNotetaker(
      meetingLink,
      {
        name: "SmartHR Notetaker Bot",
        videoRecording: true,
        audioRecording: true,
        transcription: true,
        summary: true
      },
      interview.scheduledAt, // Join at interview time
      accountCredentials
    );

    const notetakerId = result.notetakerId || result.id;
    
    // Update interview with notetaker ID (either newly created or existing)
    interview.notetakerEnabled = true;
    interview.notetakerId = notetakerId;
    interview.notetakerType = 'standalone';
    interview.notetakerStatus = 'enabled';
    await interview.save();
    
    res.json({
      success: true,
      notetakerId: notetakerId,
      message: 'Notetaker linked successfully'
    });
    
  } catch (error) {
    console.error('Enable notetaker error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to enable notetaker' 
    });
  }
};

// Cancel notetaker for an interview
const cancelNotetaker = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    if (!interview.notetakerId) {
      return res.status(400).json({ error: 'No notetaker to cancel' });
    }
    
    try {
      // Get account credentials
      const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;
      
      // First, try to get the current notetaker status from Nylas
      const notetakerStatus = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId, accountCredentials);
      
      console.log('Current notetaker status:', notetakerStatus);
      
      // Based on the actual state, decide what action to take
      const notetakerState = notetakerStatus.data?.state || notetakerStatus.state;
      const meetingState = notetakerStatus.data?.meeting_state || notetakerStatus.meeting_state;
      
      let actionTaken = '';
      
      // If notetaker is in a meeting (connected/recording), remove it
      if (notetakerState === 'connected' || meetingState === 'in_call') {
        await nylasV3Service.leaveStandaloneNotetaker(interview.notetakerId, accountCredentials);
        actionTaken = 'removed from meeting';
      } 
      // If notetaker is scheduled but not yet joined, cancel it
      else if (notetakerState === 'scheduled' || notetakerState === 'connecting') {
        await nylasV3Service.cancelStandaloneNotetaker(interview.notetakerId, accountCredentials);
        actionTaken = 'cancelled';
      }
      // If notetaker is already disconnected or in another state
      else {
        console.log(`Notetaker is in state: ${notetakerState}/${meetingState}, no action needed`);
        actionTaken = 'already inactive';
      }
      
      // Update interview regardless of the action
      interview.notetakerEnabled = false;
      interview.notetakerType = 'standalone';
      interview.notetakerStatus = 'cancelled';
      await interview.save();
      
      res.json({ 
        success: true,
        message: `Notetaker ${actionTaken}`,
        previousState: notetakerState
      });
      
    } catch (nylasError) {
      // If we can't determine the state or the action fails, still update our database
      console.error('Nylas operation failed:', nylasError.message);
      
      // Update interview to reflect cancellation attempt
      interview.notetakerEnabled = false;
      interview.notetakerStatus = 'cancelled';
      await interview.save();
      
      // Return success since we've updated our records
      res.json({ 
        success: true,
        message: 'Notetaker disabled in system',
        warning: 'Could not cancel/remove from Nylas: ' + nylasError.message
      });
    }
    
  } catch (error) {
    console.error('Cancel notetaker error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to cancel notetaker' 
    });
  }
};

// Trigger notetaker to join meeting immediately
const joinMeetingNow = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { meetingLink } = req.body;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    // Get the meeting link - from request body or interview data
    const meetingUrl = meetingLink || 
                      interview.conferencing?.details?.url || 
                      interview.meetingLink;
    
    if (!meetingUrl) {
      return res.status(400).json({ error: 'Meeting link is required' });
    }
    
    // Get account credentials if interviewer has a linked Nylas account
    const accountCredentials = interview.interviewerId
      ? await getAccountCredentials(interview.interviewerId)
      : null;

    console.log('Triggering notetaker to join meeting immediately:', meetingUrl);
    console.log('Using account credentials:', !!accountCredentials);

    if (interview.notetakerId) {
      try {
        const existingNotetakerId = interview.notetakerId;
        const existingStatusResponse = await nylasV3Service.getStandaloneNotetakerStatus(
          existingNotetakerId,
          accountCredentials
        );
        const existingStatusData = existingStatusResponse?.data || existingStatusResponse || {};
        const mappedStatus = mapNotetakerStatusWithTimeCheck(
          existingStatusData.meeting_state || 'unknown',
          existingStatusData.state || existingStatusData.status || 'unknown',
          existingStatusData.join_time,
          existingStatusData
        );

        if (ACTIVE_JOIN_STATUSES.has(mappedStatus)) {
          if (interview.notetakerStatus !== mappedStatus) {
            interview.notetakerStatus = mappedStatus;
            interview.notetakerType = 'standalone';
            await interview.save();
          }

          return res.json({
            success: true,
            notetakerId: interview.notetakerId,
            status: mappedStatus,
            alreadyActive: true,
            message: 'Notetaker is already active for this meeting'
          });
        }

        if (REPLACEABLE_JOIN_STATUSES.has(mappedStatus)) {
          try {
            await nylasV3Service.cancelStandaloneNotetaker(existingNotetakerId, accountCredentials);
            console.log(
              `Cancelled existing notetaker ${existingNotetakerId} for interview ${interview._id} before join-now`
            );

            interview.notetakerId = null;
            interview.notetakerStatus = 'cancelled';
            interview.notetakerType = 'standalone';
            await interview.save();
          } catch (cancelError) {
            if (cancelError?.message?.includes('NOTETAKER_NOT_FOUND')) {
              interview.notetakerStatus = 'deleted';
              interview.notetakerId = null;
              await interview.save();
            } else {
              console.warn(
                `Cannot safely replace existing notetaker ${existingNotetakerId} for interview ${interview._id}:`,
                cancelError.message
              );
              return res.status(409).json({
                error: 'An existing bot could not be replaced safely. Please refresh and try again.',
                status: mappedStatus
              });
            }
          }
        } else {
          return res.status(409).json({
            error: 'An existing bot is already configured for this interview. Refresh status before adding another.',
            status: mappedStatus
          });
        }
      } catch (statusError) {
        if (statusError?.message?.includes('NOTETAKER_NOT_FOUND')) {
          interview.notetakerStatus = 'deleted';
          interview.notetakerId = null;
          await interview.save();
        } else {
          console.warn(
            `Failed to check existing notetaker status for interview ${interview._id}:`,
            statusError.message
          );
          return res.status(502).json({
            error: 'Unable to verify existing bot status safely. Please retry.'
          });
        }
      }
    }
    
    try {
      // Create a standalone notetaker that joins immediately (no join_time).
      const result = await nylasV3Service.createStandaloneNotetaker(
        meetingUrl,
        {
          name: "SmartHR Notetaker",
          videoRecording: true,
          audioRecording: true,
          transcription: true,
          summary: true
        },
        null,
        accountCredentials
      );
      console.log('Notetaker triggered successfully:', result);

      const notetakerId = result.notetakerId || result.id;
      if (!notetakerId) {
        throw new Error('Nylas did not return a notetaker ID');
      }
      
      // Update interview with new notetaker ID
      interview.notetakerEnabled = true;
      interview.notetakerId = notetakerId;
      interview.notetakerType = 'standalone';
      interview.notetakerStatus = 'joining';
      interview.notetakerError = null;
      await interview.save();
      
      res.json({ 
        success: true,
        notetakerId,
        status: 'joining',
        message: 'Notetaker is joining the meeting now'
      });
      
    } catch (nylasError) {
      console.error('Nylas error:', nylasError);
      
      // Check for specific errors
      if (nylasError.message.includes('already in meeting')) {
        return res.status(400).json({ 
          error: 'A notetaker is already in this meeting' 
        });
      }
      
      throw nylasError;
    }
    
  } catch (error) {
    console.error('Join meeting now error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to trigger notetaker to join' 
    });
  }
};

// Get real-time transcript for an interview
const getRealtimeTranscript = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ 
        success: false,
        error: 'Interview not found' 
      });
    }
    
    // Check if notetaker is enabled
    if (!interview.notetakerEnabled) {
      return res.json({
        success: false,
        message: 'No notetaker is enabled for this interview',
        shouldPoll: false,
        interview: interview,
        notetaker: null
      });
    }
    
    // Check if we have a notetaker ID
    if (!interview.notetakerId) {
      return res.json({
        success: false,
        message: 'No notetaker ID found - notetaker may not be properly configured',
        shouldPoll: false,
        interview: interview,
        notetaker: null
      });
    }
    
    const interviewer = interview.interviewerId;
    
    try {
      // Get account credentials
      const accountCredentials = interviewer ? await getAccountCredentials(interviewer) : null;
      
      // First check the notetaker status
      const statusResponse = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId, accountCredentials);
      
      console.log('📊 Notetaker status:', statusResponse);
      
      const notetakerData = statusResponse.data || statusResponse;
      const currentStatus = notetakerData.state || notetakerData.status || 'unknown';
      const meetingState = notetakerData.meeting_state || 'unknown';
      const joinTime = notetakerData.join_time;
      
      // Map the status to our valid enum values with time-based detection
      const mappedStatus = mapNotetakerStatusWithTimeCheck(meetingState, currentStatus, joinTime, notetakerData);
      
      console.log(`📊 Final mapped status: ${mappedStatus} (original: ${currentStatus})`);
      
      // Update interview with latest status
      if (interview.notetakerStatus !== mappedStatus) {
        interview.notetakerStatus = mappedStatus;
        interview.notetakerType = 'standalone';
        await interview.save();
      }
      
      // Check if transcript is available
      let transcriptData = null;
      let isTranscriptReady = false;
      
      // If notetaker is completed or processing, try to get transcript
      if (mappedStatus === 'completed' || mappedStatus === 'processing') {
        try {
          const media = await nylasV3Service.getStandaloneNotetakerMedia(interview.notetakerId, accountCredentials);
          
          if (media.transcript && media.transcript.url) {
            // Download and save transcript if not already saved
            if (!interview.transcript || !interview.transcript.content) {
              console.log('📝 Downloading transcript content...');
              const transcript = await nylasV3Service.getStandaloneTranscript(interview.notetakerId, accountCredentials);
              
              // Save transcript to database
              interview.transcript = {
                content: transcript.content,
                summary: null, // Will be generated later
                keyPoints: [],
                actionItems: [],
                participants: [],
                duration: null,
                language: 'en',
                confidence: null
              };
              interview.transcriptAvailableAt = new Date();
              interview.notetakerType = 'standalone';
              
              if (media.recording && media.recording.url) {
                interview.recordingUrl = media.recording.url;
              }
              
              await interview.save();
              console.log('✅ Transcript saved to database');
            }
            
            transcriptData = {
              content: interview.transcript.content,
              url: media.transcript.url,
              size: media.transcript.size
            };
            isTranscriptReady = true;
          }
        } catch (mediaError) {
          console.log('📝 Media not yet available:', mediaError.message);
          // This is expected if media is still processing
        }
      }
      
      // Determine if we should continue polling
      let shouldPoll = false;
      let estimatedTime = null;
      
      if (mappedStatus === 'scheduled' || mappedStatus === 'enabled') {
        shouldPoll = true;
        estimatedTime = 'Waiting for meeting to start...';
      } else if (mappedStatus === 'joining' || mappedStatus === 'joined') {
        shouldPoll = true;
        estimatedTime = 'Notetaker is joining the meeting...';
      } else if (mappedStatus === 'recording') {
        shouldPoll = true;
        estimatedTime = 'Recording in progress...';
      } else if (mappedStatus === 'processing') {
        shouldPoll = true;
        estimatedTime = 'Processing transcript... This may take a few minutes.';
      } else if (mappedStatus === 'completed') {
        shouldPoll = false;
        estimatedTime = 'Transcript processing complete';
      } else if (mappedStatus === 'failed' || mappedStatus === 'deleted') {
        shouldPoll = false;
        estimatedTime = 'Notetaker failed or was removed';
      }
      
      res.json({
        success: true,
        interview: interview,
        notetaker: {
          id: interview.notetakerId,
          status: mappedStatus,
          originalStatus: currentStatus,
          meetingState: meetingState,
          enabled: interview.notetakerEnabled
        },
        transcript: transcriptData,
        isTranscriptReady: isTranscriptReady,
        shouldPoll: shouldPoll,
        estimatedTranscriptTime: estimatedTime,
        lastChecked: new Date().toISOString()
      });
      
    } catch (nylasError) {
      // Handle the case where notetaker is not found
      if (nylasError.message && nylasError.message.includes('NOTETAKER_NOT_FOUND')) {
        console.log(`Notetaker ${interview.notetakerId} not found in Nylas - updating database`);
        
        // Update the interview to reflect that the notetaker is no longer available
        interview.notetakerStatus = 'deleted';
        await interview.save();
        
        return res.json({
          success: false,
          message: 'Notetaker was automatically cleaned up (likely due to meeting not starting or timeout)',
          interview: interview,
          notetaker: {
            id: interview.notetakerId,
            status: 'deleted',
            originalStatus: 'not_found',
            meetingState: 'unknown',
            enabled: interview.notetakerEnabled
          },
          transcript: null,
          isTranscriptReady: false,
          shouldPoll: false,
          suggestion: 'You can create a new notetaker if you need to record a meeting',
          lastChecked: new Date().toISOString()
        });
      }
      
      // Re-throw other errors
      throw nylasError;
    }
    
  } catch (error) {
    console.error('Get realtime transcript error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to get realtime transcript' 
    });
  }
};

// Get notetaker status for an interview
const getNotetakerStatus = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    if (!interview.notetakerId) {
      return res.status(400).json({ 
        error: 'No notetaker associated with this interview',
        notetakerEnabled: interview.notetakerEnabled || false,
        status: 'not_enabled'
      });
    }

    try {
      const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;

      // Get status from Nylas
      const statusResponse = await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId, accountCredentials);

      const notetakerData = statusResponse.data || statusResponse;
      const currentStatus = notetakerData.state || notetakerData.status || 'unknown';
      const meetingState = notetakerData.meeting_state || 'unknown';
      const joinTime = notetakerData.join_time;

      // Map the status to our valid enum values with time-based detection
      const mappedStatus = mapNotetakerStatusWithTimeCheck(meetingState, currentStatus, joinTime, notetakerData);

      // Update interview with latest status
      if (interview.notetakerStatus !== mappedStatus) {
        interview.notetakerStatus = mappedStatus;
        interview.notetakerType = 'standalone';
        await interview.save();
      }

      res.json({
        notetakerId: interview.notetakerId,
        status: mappedStatus,
        originalStatus: currentStatus,
        meetingState: meetingState,
        enabled: interview.notetakerEnabled,
        lastUpdated: new Date().toISOString(),
        rawResponse: notetakerData
      });

    } catch (nylasError) {
      // Handle the case where notetaker is not found
      if (nylasError.message && nylasError.message.includes('NOTETAKER_NOT_FOUND')) {
        console.log(`Notetaker ${interview.notetakerId} not found in Nylas - updating database`);
        
        // Update the interview to reflect that the notetaker is no longer available
        interview.notetakerStatus = 'deleted';
        await interview.save();
        
        return res.json({
          notetakerId: interview.notetakerId,
          status: 'deleted',
          originalStatus: 'not_found',
          meetingState: 'unknown',
          enabled: interview.notetakerEnabled,
          lastUpdated: new Date().toISOString(),
          message: 'Notetaker was automatically cleaned up (likely due to meeting not starting or timeout)',
          suggestion: 'You can create a new notetaker if you need to record a meeting'
        });
      }
      
      // Re-throw other errors
      throw nylasError;
    }
    
  } catch (error) {
    console.error('Get notetaker status error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to get notetaker status' 
    });
  }
};

// Sync notetaker status - find existing notetakers and link them to the interview
// This function is used when notetakerEnabled=true but notetakerId is missing
// DEBUG: Added extensive logging to identify the correct field name for notetaker ID
async function syncNotetakerStatus(req, res) {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findOne(await organizationInterviewQuery(req, { _id: interviewId }))
      .populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    // Only sync if notetaker is enabled but ID is missing
    if (!interview.notetakerEnabled || interview.notetakerId) {
      return res.status(400).json({ 
        error: 'Interview does not need syncing',
        notetakerEnabled: interview.notetakerEnabled,
        hasNotetakerId: !!interview.notetakerId
      });
    }

    // Standalone notetakers cannot be listed/discovered server-side without an ID, so "sync" means re-create.
    const meetingUrl = interview.conferencing?.details?.url || interview.meetingLink;
    if (!meetingUrl) {
      return res.status(400).json({
        error: 'Meeting link is required to recreate notetaker',
        message: 'This interview is missing conferencing details/meetingLink.'
      });
    }

    const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;

    const result = await nylasV3Service.createStandaloneNotetaker(
      meetingUrl,
      {
        name: "SmartHR Notetaker Bot",
        videoRecording: true,
        audioRecording: true,
        transcription: true,
        summary: true
      },
      interview.scheduledAt,
      accountCredentials
    );

    const notetakerId = result.notetakerId || result.id;

    interview.notetakerEnabled = true;
    interview.notetakerId = notetakerId;
    interview.notetakerType = 'standalone';
    interview.notetakerStatus = 'enabled';
    await interview.save();

    return res.json({
      success: true,
      notetakerId,
      status: 'enabled',
      message: 'Notetaker recreated successfully'
    });
    
  } catch (error) {
    console.error('Sync notetaker error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to sync notetaker' 
    });
  }
};

// Manual trigger for completion check (for testing)
const triggerCompletionCheck = async (req, res) => {
  try {
    console.log('🔧 [MANUAL-TRIGGER] Manual completion check triggered');
    const { checkAndCompleteInterviews } = require('../services/interviewCompletionService');
    const completedCount = await checkAndCompleteInterviews(req.user.currentOrganization);
    
    res.json({
      success: true,
      message: `Completion check completed successfully`,
      completedInterviews: completedCount
    });
  } catch (error) {
    console.error('❌ [MANUAL-TRIGGER] Manual completion check failed:', error);
    res.status(500).json({
      error: 'Failed to run completion check',
      message: error.message
    });
  }
};

// Cleanup stale notetakers - removes notetaker references that no longer exist in Nylas
const cleanupStaleNotetakers = async (req, res) => {
  try {
    console.log('🧹 Starting cleanup of stale notetakers...');
    
    // Find all interviews with notetakers
    const cleanupQuery = await organizationInterviewQuery(req, {
      notetakerEnabled: true,
      notetakerId: { $ne: null },
      notetakerStatus: { $nin: ['deleted', 'cancelled'] }
    });
    const interviews = await Interview.find(cleanupQuery).populate('interviewerId', 'nylasGrantId nylasAccountId');
    
    console.log(`Found ${interviews.length} interviews with notetakers to check`);
    
    let cleanedCount = 0;
    let errors = [];
    
    for (const interview of interviews) {
      try {
        const accountCredentials = interview.interviewerId ? await getAccountCredentials(interview.interviewerId) : null;
        await nylasV3Service.getStandaloneNotetakerStatus(interview.notetakerId, accountCredentials);
        
        console.log(`✅ Notetaker ${interview.notetakerId} exists for interview ${interview._id}`);
        
      } catch (error) {
        if (error.message && error.message.includes('NOTETAKER_NOT_FOUND')) {
          console.log(`🗑️ Cleaning up stale notetaker ${interview.notetakerId} for interview ${interview._id}`);
          
          // Update interview to mark notetaker as deleted
          interview.notetakerStatus = 'deleted';
          await interview.save();
          
          cleanedCount++;
        } else {
          console.error(`Error checking notetaker ${interview.notetakerId}:`, error.message);
          errors.push({
            interviewId: interview._id,
            notetakerId: interview.notetakerId,
            error: error.message
          });
        }
      }
    }
    
    console.log(`🧹 Cleanup complete: ${cleanedCount} stale notetakers cleaned up`);
    
    res.json({
      success: true,
      message: `Cleanup complete: ${cleanedCount} stale notetakers cleaned up`,
      stats: {
        totalChecked: interviews.length,
        staleNotetakers: cleanedCount,
        errors: errors.length
      },
      errors: errors
    });
    
  } catch (error) {
    console.error('Cleanup stale notetakers error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup stale notetakers'
    });
  }
};

module.exports = {
  handleNotetakerWebhook,
  enableNotetaker,
  cancelNotetaker,
  joinMeetingNow,
  getNotetakerStatus,
  getTranscript,
  getRealtimeTranscript,
  syncNotetakerStatus,
  triggerCompletionCheck,
  cleanupStaleNotetakers
}; 
