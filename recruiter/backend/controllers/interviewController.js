const Interview = require('../models/Interview');
const InterviewComment = require('../models/InterviewComment');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const User = require('../models/User');
const InterviewStage = require('../models/InterviewStage');
const Notification = require('../models/Notification');
const nylasV3Service = require('../services/nylasV3Service');
const nylasEmailService = require('../services/nylasEmailService');
const grantManagementService = require('../services/grantManagementService'); // NEW: Grant management
const multiNylasService = require('../services/multiNylasService'); // Multi-account support
const AzureOpenAIService = require('../services/azureOpenAIService');
const emailService = require('../services/emailService');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const { handleNylasError, handleInterviewError } = require('../utils/errorHandler');
const timezoneUtils = require('../utils/timezoneUtils');
const mongoose = require('mongoose');
const { evaluateFormula } = require('../utils/formulaEvaluator');
const FeedbackFormTemplate = require('../models/FeedbackFormTemplate');
const CustomField = require('../models/CustomField');
const CustomFieldResponse = require('../models/CustomFieldResponse');

// ==================== HELPER FUNCTIONS ====================

/**
 * Get calculated fields from job's feedback template
 * @param {Object} job - Job object with feedbackFormConfig
 * @returns {Promise<Array>} - Array of calculated field definitions
 */
async function getCalculatedFieldsFromTemplate(job) {
  try {
    if (!job) {
      return [];
    }

    // Get template from job's config or use default
    let template;
    if (job.feedbackFormConfig && job.feedbackFormConfig.templateId) {
      template = await FeedbackFormTemplate.findById(job.feedbackFormConfig.templateId);
    } else {
      // Get default template for organization
      template = await FeedbackFormTemplate.findOne({
        organization: job.organization,
        isDefault: true
      });
    }

    if (!template) {
      return [];
    }

    // Populate custom field references
    await template.populate('customFields.customFieldRef');

    // Filter for calculated fields that are visible
    const calculatedFields = template.customFields
      .filter(fieldConfig => 
        fieldConfig.isVisible !== false && 
        fieldConfig.customFieldRef && 
        fieldConfig.customFieldRef.type === 'calculated'
      )
      .map(fieldConfig => fieldConfig.customFieldRef);

    return calculatedFields;

  } catch (error) {
    console.error('Error getting calculated fields from template:', error);
    return [];
  }
}

/**
 * Gather field values from feedback submission
 * @param {Object} generalFeedback - General feedback with system ratings
 * @param {Object} customFieldResponses - Custom field responses
 * @returns {Object} - Unified field values object
 */
function gatherFieldValues(generalFeedback, customFieldResponses) {
  const fieldValues = {};

  // Add system ratings if present
  if (generalFeedback) {
    if (generalFeedback.rating !== undefined && generalFeedback.rating !== null) {
      fieldValues.overall = generalFeedback.rating;
      fieldValues.overallRating = generalFeedback.rating;
    }
    if (generalFeedback.technicalRating !== undefined && generalFeedback.technicalRating !== null) {
      fieldValues.technical = generalFeedback.technicalRating;
      fieldValues.technicalRating = generalFeedback.technicalRating;
    }
    if (generalFeedback.communicationRating !== undefined && generalFeedback.communicationRating !== null) {
      fieldValues.communication = generalFeedback.communicationRating;
      fieldValues.communicationRating = generalFeedback.communicationRating;
    }
    if (generalFeedback.culturalRating !== undefined && generalFeedback.culturalRating !== null) {
      fieldValues.cultural = generalFeedback.culturalRating;
      fieldValues.culturalRating = generalFeedback.culturalRating;
    }
  }

  // Add custom field values
  if (customFieldResponses && typeof customFieldResponses === 'object') {
    Object.entries(customFieldResponses).forEach(([fieldId, value]) => {
      if (value !== undefined && value !== null && typeof value === 'number') {
        fieldValues[fieldId] = value;
      }
    });
  }

  return fieldValues;
}

/**
 * Calculate average rating for a system field across all comments
 * @param {string} fieldId - Field ID (e.g., 'overall', 'technical', 'communication', 'cultural')
 * @param {Array} comments - Array of InterviewComment objects
 * @returns {number} - Average rating or 0 if no ratings
 */
function calculateAverageForField(fieldId, comments) {
  const ratings = comments
    .map(comment => comment.rating && comment.rating[fieldId])
    .filter(r => r !== undefined && r !== null && typeof r === 'number');
  
  if (ratings.length === 0) {
    return 0;
  }
  
  const sum = ratings.reduce((acc, val) => acc + val, 0);
  const average = sum / ratings.length;
  
  return Math.round(average * 100) / 100;
}

/**
 * Calculate average rating for a custom field across all responses
 * @param {string} customFieldId - Custom field ID
 * @param {Array} customResponses - Array of CustomFieldResponse objects
 * @returns {number} - Average rating or 0 if no ratings
 */
function calculateAverageForCustomField(customFieldId, customResponses) {
  const responses = customResponses.filter(response =>
    response.customFieldId.toString() === customFieldId.toString() &&
    response.fieldType === 'rating' &&
    typeof response.responseValue === 'number'
  );
  
  if (responses.length === 0) {
    return 0;
  }
  
  // Group by respondent to avoid double-counting if someone submitted multiple times
  const respondentScores = {};
  responses.forEach(response => {
    const respondentKey = response.respondentEmail || response.respondentId?.toString();
    if (respondentKey) {
      // Use the latest response from each respondent
      if (!respondentScores[respondentKey] || response.createdAt > respondentScores[respondentKey].createdAt) {
        respondentScores[respondentKey] = response;
      }
    }
  });
  
  const uniqueRatings = Object.values(respondentScores).map(r => r.responseValue);
  
  if (uniqueRatings.length === 0) {
    return 0;
  }
  
  const sum = uniqueRatings.reduce((acc, val) => acc + val, 0);
  const average = sum / uniqueRatings.length;
  
  return Math.round(average * 100) / 100;
}

/**
 * Calculate consensus score (how much assessors agree)
 * @param {Array} values - Array of numeric values
 * @returns {number} - Consensus score between 0-1 (1 = perfect agreement)
 */
function calculateConsensus(values) {
  if (!values || values.length === 0) {
    return 0;
  }
  
  if (values.length === 1) {
    return 1; // Perfect consensus with only one assessor
  }
  
  // Calculate mean
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  
  // Calculate standard deviation
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  // Convert to consensus score (0-1)
  // Lower standard deviation = higher consensus
  // Assuming max meaningful std dev is 2 for a 0-5 scale
  const maxStdDev = 2;
  const consensus = Math.max(0, 1 - (stdDev / maxStdDev));
  
  return Math.round(consensus * 100) / 100;
}

// ==================== END HELPER FUNCTIONS ====================

// CRITICAL FIX: Schedule interview with proper availability checking
const scheduleInterview = async (req, res) => {
  try {
    const { 
      candidateId, 
      interviewerId, 
      jobId,
      stageId, // Add stageId parameter
      startTime, 
      endTime, 
      duration, 
      type, 
      location, 
      description,
      subject, // Custom interview subject line
      addNotetaker = false,
      provider = 'google_meet', // Add provider parameter with default
      additionalParticipants = [], // Array of additional participants {email, name}
      bccParticipants = [], // Array of BCC participants {email, name}
      ccParticipants = [], // Array of CC participants {email, name}
      sendCustomEmail = false,
      emailTemplate = null,
      // New parameters for interviewer questions
      sendQuestionsToInterviewers = false,
      questionsSendTime = 60, // minutes before interview
      selectedQuestionIds = [] // Array of question IDs to send to interviewers
    } = req.body;
    
    // Debug logging for interview questions
    console.log('📋 Interview Questions Configuration:', {
      sendQuestionsToInterviewers,
      questionsSendTime,
      selectedQuestionIds,
      selectedQuestionIdsLength: selectedQuestionIds?.length || 0
    });
    
    // Validate required fields
    if (!candidateId || !interviewerId || !startTime || !endTime) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'candidateId, interviewerId, startTime, and endTime are required'
      });
    }
    
    // Get candidate, interviewer, and job details
    const candidate = await Candidate.findById(candidateId).populate('jobAppliedFor');
    const interviewer = await User.findById(interviewerId);
    
    if (!candidate) {
      return res.status(404).json({ error: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found' });
    }
    
    if (!interviewer) {
      return res.status(404).json({ error: 'INTERVIEWER_NOT_FOUND', message: 'Interviewer not found' });
    }
    
    if (!interviewer.nylasGrantId) {
      return res.status(403).json({
        error: 'CALENDAR_NOT_CONNECTED',
        message: 'Interviewer must connect their calendar first',
        requiresCalendarSetup: true
      });
    }

    // DYNAMIC CHECK: Verify the grant is still valid in Nylas
    console.log(`🔍 Verifying Nylas grant for ${interviewer.email}...`);
    
    // Get account credentials if user has a linked Nylas account
    let accountCredentials = null;
    if (interviewer.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        accountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        console.log(`   Using Nylas account: ${nylasAccount.name}`);
      }
    }
    
    const grantVerification = await nylasV3Service.verifyGrantStatus(interviewer.nylasGrantId, accountCredentials);
    
    if (!grantVerification.valid) {
      console.error(`❌ Grant verification failed for ${interviewer.email}:`, grantVerification);
      
      // Update user's grant status in database
      interviewer.nylasGrantStatus = 'invalid';
      interviewer.calendarConnected = false;
      await interviewer.save();
      
      return res.status(403).json({
        error: 'CALENDAR_CONNECTION_INVALID',
        message: grantVerification.message || 'Your calendar connection is no longer valid. Please reconnect your calendar.',
        requiresCalendarSetup: true,
        grantStatus: grantVerification.status,
        requiresReconnection: grantVerification.requiresReconnection
      });
    }
    
    console.log(`✅ Grant verified for ${interviewer.email} - ${grantVerification.grantInfo?.provider}`);
    
    // Update grant status in database if it was previously invalid
    if (interviewer.nylasGrantStatus !== 'active') {
      interviewer.nylasGrantStatus = 'active';
      await interviewer.save();
    }
    
    // Get job information - prioritize jobId from request, then candidate's linked job
    let job = null;
    let jobTitle = 'Position';
    let jobCompany = 'Company';
    
    if (jobId) {
      // If jobId is provided in request, use it
      job = await Job.findById(jobId);
      if (job) {
        jobTitle = decodeHtmlEntities(job.title) || 'Position';
        jobCompany = decodeHtmlEntities(job.company) || 'Company';
      }
    } else if (candidate.jobAppliedFor) {
      // Fallback to candidate's linked job
      job = candidate.jobAppliedFor;
      jobTitle = decodeHtmlEntities(job.title) || decodeHtmlEntities(candidate.position) || 'Position';
      jobCompany = decodeHtmlEntities(job.company) || 'Company';
    } else {
      // Final fallback for pipeline candidates without direct job link
      jobTitle = decodeHtmlEntities(candidate.position) || 'Position';
      jobCompany = 'Company';
    }
    
    console.log('Job info:', { 
      jobId: job?._id, 
      title: jobTitle, 
      company: jobCompany,
      source: jobId ? 'request' : (candidate.jobAppliedFor ? 'candidate' : 'fallback')
    });
    
    // CRITICAL: Check availability BEFORE creating event
    console.log('Checking availability for interviewer...');
    console.log('Candidate info:', { 
      email: candidate.email, 
      name: `${candidate.firstName} ${candidate.lastName}`,
      id: candidate._id 
    });
    console.log('Interviewer info:', { 
      email: interviewer.email, 
      name: interviewer.name,
      id: interviewer._id 
    });
    
    // Validate participant emails
    if (!candidate.email || !interviewer.email) {
      return res.status(400).json({
        error: 'MISSING_PARTICIPANT_EMAIL',
        message: 'Both candidate and interviewer must have valid email addresses',
        debug: {
          candidateEmail: candidate.email,
          interviewerEmail: interviewer.email
        }
      });
    }
    
    // FIXED: Handle timezone conversion for main scheduleInterview function
    const userTimezone = req.body.timezone || interviewer?.profile?.timezone || 'UTC';
    const useDirectISO = req.body.useDirectISO === true;
    console.log('User timezone:', userTimezone);
    console.log('Use direct ISO (frontend converted):', useDirectISO);
    
    let timeData;
    try {
      if (useDirectISO) {
        // Frontend already converted datetime-local to ISO (like multi-candidate)
        console.log('🔧 TIMEZONE FIX: Using direct ISO from frontend (no backend conversion)');
        
        // Validate the ISO times
        let startDate = new Date(startTime);
        let endDate = new Date(endTime);
        
        if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error('Invalid ISO datetime format');
        }
        
        if (endDate <= startDate) {
          throw new Error('End time must be after start time');
        }
        
        timeData = {
          startTimeISO: startTime,
          endTimeISO: endTime,
          startDate,
          endDate,
          durationMinutes: Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)),
          userTimezone
        };
        
        console.log('✅ Direct ISO validation successful:', {
          startTimeISO: timeData.startTimeISO,
          endTimeISO: timeData.endTimeISO,
          calculatedDuration: timeData.durationMinutes
        });
        
      } else {
        // Use legacy timezone conversion for backward compatibility
        timeData = timezoneUtils.processInterviewTimes(
          startTime,
          duration,
          userTimezone,
          endTime
        );
        
        console.log('✅ Legacy timezone conversion successful:', {
          originalStartTime: startTime,
          originalEndTime: endTime,
          userTimezone,
          processedStartTime: timeData.startTimeISO,
          processedEndTime: timeData.endTimeISO,
          calculatedDuration: timeData.durationMinutes
        });
      }
      
    } catch (timezoneError) {
      console.error('❌ Timezone/validation error in scheduleInterview:', timezoneError);
      return res.status(400).json({
        error: 'INVALID_TIME_FORMAT',
        message: 'Failed to process interview times: ' + timezoneError.message,
        debug: { startTime, endTime, userTimezone, useDirectISO }
      });
    }
    
    // Only check interviewer's availability - candidate is external participant
    const interviewerEmails = [interviewer.email];
    console.log('Checking availability only for interviewer:', interviewerEmails);
    
    // Check if we should skip availability check (for testing or force scheduling)
    const skipAvailabilityCheck = req.body.skipAvailabilityCheck || false;
    const forceSchedule = req.body.forceSchedule || false;
    
    console.log('🔧 DEBUG - Availability check parameters:', {
      skipAvailabilityCheck,
      forceSchedule,
      requestBody: req.body
    });
    
    if (!skipAvailabilityCheck) {
      console.log('🔍 AVAILABILITY DEBUG: Checking availability with these parameters:', {
        originalStartTime: req.body.startTime,
        originalEndTime: req.body.endTime,
        processedStartTime: timeData.startTimeISO,
        processedEndTime: timeData.endTimeISO,
        userTimezone: userTimezone,
        grantId: interviewer.nylasGrantId,
        interviewerEmails: interviewerEmails
      });
      
      const availability = await nylasV3Service.getAvailability(
        interviewer.nylasGrantId,
        timeData.startTimeISO, // FIXED: Use processed ISO time
        timeData.endTimeISO,   // FIXED: Use processed ISO time
        interviewerEmails,
        accountCredentials // Pass account credentials for availability check
      );
      
      // Validate availability - MUST be checked
      console.log('Availability response structure:', JSON.stringify(availability, null, 2));
      
      // Nylas v3 returns { order: [...], timeSlots: [...] } format
      // Empty timeSlots means no conflicts (time is available)
      // Non-empty timeSlots means there are conflicts
      const hasConflicts = availability.timeSlots && availability.timeSlots.length > 0;
      
      console.log('Availability check:', {
        hasTimeSlots: !!availability.timeSlots,
        timeSlotsCount: availability.timeSlots ? availability.timeSlots.length : 0,
        hasConflicts
      });
      
      if (hasConflicts) {
        console.log('=== SCHEDULING CONFLICTS DETECTED ===');
        console.log('Requested time slot:');
        console.log('  Start:', timeData.startTimeISO, '(', new Date(timeData.startTimeISO).toLocaleString(), ')');
        console.log('  End:', timeData.endTimeISO, '(', new Date(timeData.endTimeISO).toLocaleString(), ')');
        console.log('Busy time slots returned by Nylas:');
        availability.timeSlots.forEach((slot, index) => {
          console.log(`  Conflict ${index + 1}:`, slot);
          if (slot.startTime) {
            console.log(`    Start: ${new Date(slot.startTime * 1000).toLocaleString()}`);
          }
          if (slot.endTime) {
            console.log(`    End: ${new Date(slot.endTime * 1000).toLocaleString()}`);
          }
        });
        console.log('=====================================');
        
        // Check if we should force schedule despite conflicts
        if (!forceSchedule) {
          return res.status(409).json({
            error: 'SCHEDULING_CONFLICT',
            message: 'The interviewer is not available at the requested time',
            conflicts: {
              email: interviewer.email,
              busySlots: availability.timeSlots,
              requestedTime: {
                start: startTime,
                end: endTime,
                startReadable: new Date(startTime).toLocaleString(),
                endReadable: new Date(endTime).toLocaleString()
              }
            }
          });
        } else {
          console.log('⚠️ Force scheduling despite conflicts!');
        }
      }
    } else {
      console.log('⚠️ Skipping availability check as requested');
    }
    
    console.log('No conflicts found or bypassed, proceeding with event creation...');
    
    // Only proceed if no conflicts - create calendar event
    const eventData = {
      title: decodeHtmlEntities(subject || `Interview: ${candidate.firstName} ${candidate.lastName} - ${jobTitle}`),
      description: decodeHtmlEntities(description || `Interview with ${candidate.firstName} ${candidate.lastName} for ${jobTitle} position`),
      startTime: timeData.startTimeISO,  // FIXED: Use processed ISO time
      endTime: timeData.endTimeISO,      // FIXED: Use processed ISO time  
      location: 'Video Call',
      participants: [
        {
          email: candidate.email,
          name: decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`),
          status: 'noreply'
        },
        {
          email: interviewer.email, 
          name: decodeHtmlEntities(interviewer.name || interviewer.email),
          status: 'yes'
        },
        // Add additional participants from request
        ...additionalParticipants.map(participant => ({
          email: participant.email,
          name: decodeHtmlEntities(participant.name || participant.email),
          status: 'noreply'
        })),
        // Add BCC participants (they receive calendar invite but are not visible to others)
        ...bccParticipants.map(participant => ({
          email: participant.email,
          name: decodeHtmlEntities(participant.name || participant.email),
          status: 'noreply',
          visibility: 'bcc'
        })),
        // Add CC participants (they receive calendar invite and are visible to others)
        ...ccParticipants.map(participant => ({
          email: participant.email,
          name: decodeHtmlEntities(participant.name || participant.email),
          status: 'noreply',
          visibility: 'cc'
        }))
      ],
      conferencing: {
        provider: provider || 'google_meet'
      }
    };

    console.log('📅 Creating calendar event with data:', eventData);
    
    // Create the event WITHOUT notetaker (Nylas doesn't support it during creation)
    const event = await nylasV3Service.createEvent(
      interviewer.nylasGrantId, 
      eventData,
      accountCredentials // Pass account credentials for event creation
    );
    
    console.log(`✅ Calendar event created with ID: ${event.id}`);
    console.log('📹 Meeting link:', event.conferencing?.details?.url);
    
    // Send separate calendar invites to BCC participants (they don't appear in main event)
    const bccParticipantsFromEventData = eventData.participants?.filter(p => p.visibility === 'bcc') || [];
    if (bccParticipantsFromEventData.length > 0) {
      console.log(`📅 Sending BCC calendar invites to ${bccParticipantsFromEventData.length} recipients`);
      try {
        const bccResults = await nylasV3Service.sendBccCalendarInvites(
          interviewer.nylasGrantId,
          eventData,
          bccParticipantsFromEventData
        );
        console.log(`✅ BCC calendar invites: ${bccResults.message}`);
      } catch (bccError) {
        console.error('❌ Failed to send BCC calendar invites:', bccError.message);
        // Don't fail the whole process if BCC calendar invites fail
      }
    }
    
    // Now add notetaker AFTER event creation if requested
    let notetakerResult = null;
    if (addNotetaker && event.conferencing?.details?.url) {
      console.log('🤖 Adding notetaker to the meeting...');
      try {
        // Wait a moment for the meeting to be fully created
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        notetakerResult = await nylasV3Service.enableNotetakerForEvent(
          interviewer.nylasGrantId,
          event.id,
          event.conferencing.details.url,
          new Date(startTime), // Join at meeting start time
          accountCredentials // Pass account credentials for correct API key
        );
        
        console.log('✅ Notetaker added successfully:', notetakerResult);
        console.log('Notetaker ID extracted:', notetakerResult?.notetakerId);
      } catch (notetakerError) {
        console.error('⚠️ Failed to add notetaker:', notetakerError);
        // Don't fail the interview creation if notetaker fails
      }
    }
    
    // Create interview record in database with notetaker info
    const interviewData = {
      jobId: job?._id,
      candidateId: candidate._id,
      interviewerId: interviewerId,
      nylasEventId: event.id,
      title: event.title,
      subject: decodeHtmlEntities(subject || `Interview Invitation - ${job?.title || 'Position'}`),
      description: eventData.description,
      scheduledAt: new Date(timeData.startTimeISO), // FIXED: Use processed ISO time instead of raw startTime
      duration: timeData.durationMinutes || duration || 60, // FIXED: Use calculated duration
      location: eventData.location,
      timezone: userTimezone,
      type: type || 'video',
      status: 'scheduled',
      schedulingSource: 'pipeline',
      notetakerEnabled: addNotetaker && !!notetakerResult,
      notetakerId: notetakerResult?.notetakerId || null,
      notetakerStatus: notetakerResult ? 'enabled' : (addNotetaker ? 'failed' : null),
      // Add interviewer questions notification settings
      notifications: {
        candidateReminder: true,
        interviewerReminder: true,
        reminderTime: 24, // Default 24 hours before
        sendQuestionsToInterviewers: sendQuestionsToInterviewers,
        questionsSendTime: questionsSendTime || 60, // Default 60 minutes before
        selectedQuestions: selectedQuestionIds && selectedQuestionIds.length > 0 
          ? selectedQuestionIds.map(id => {
              console.log(`Converting question ID to ObjectId: ${id}`);
              return new mongoose.Types.ObjectId(id);
            }) 
          : []
      },
      participants: [
        {
          email: candidate.email,
          name: decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`),
          role: 'candidate',
          status: 'pending'
        },
        {
          email: interviewer.email,
          name: decodeHtmlEntities(interviewer.name || interviewer.email),
          role: 'interviewer',
          status: 'accepted'
        },
        // Add additional participants
        ...additionalParticipants.map(participant => ({
          email: participant.email,
          name: decodeHtmlEntities(participant.name || participant.email),
          role: participant.role || 'observer',
          status: 'pending'
        }))
      ],
      conferencing: event.conferencing ? {
        provider: 'google_meet',
        details: {
          url: event.conferencing.details?.url,
          meetingCode: event.conferencing.details?.meeting_code
        }
      } : undefined
    };
    
    // Only add jobId if job exists
    if (job && job._id) {
      interviewData.jobId = job._id;
    }

    // Add stageId if provided
    if (stageId) {
      interviewData.stageId = stageId;
      
      // Also try to get the stage name for better context
      try {
        const InterviewStage = require('../models/InterviewStage');
        const stage = await InterviewStage.findById(stageId);
        if (stage) {
          interviewData.stageName = stage.name;
        }
      } catch (stageError) {
        console.log('⚠️ Could not fetch stage name:', stageError.message);
        // Don't fail the interview creation if stage lookup fails
      }
    }
    
    console.log('📝 Interview data before saving:', {
      notetakerEnabled: interviewData.notetakerEnabled,
      notetakerId: interviewData.notetakerId,
      notetakerStatus: interviewData.notetakerStatus,
      addNotetakerRequested: addNotetaker,
      notetakerResultExists: !!notetakerResult
    });
    
    const interview = new Interview(interviewData);
    
    try {
    await interview.save();
    
    console.log('💾 Interview saved to database:', {
      id: interview._id,
      notetakerEnabled: interview.notetakerEnabled,
      notetakerId: interview.notetakerId,
      notetakerStatus: interview.notetakerStatus,
      // Questions configuration
      sendQuestionsToInterviewers: interview.notifications?.sendQuestionsToInterviewers,
      questionsSendTime: interview.notifications?.questionsSendTime,
      selectedQuestionsCount: interview.notifications?.selectedQuestions?.length || 0,
      selectedQuestions: interview.notifications?.selectedQuestions
    });
    } catch (saveError) {
      console.error('❌ Failed to save interview to database:', saveError);
      
      // FIXED: Clean up calendar event if interview saving fails to prevent orphaned calendar invites
      try {
        console.log('🧹 Cleaning up calendar event due to interview save failure...');
        await nylasV3Service.deleteEvent(interviewer.nylasGrantId, event.id, accountCredentials);
        console.log('✅ Calendar event cleaned up successfully');
      } catch (cleanupError) {
        console.error('⚠️ Failed to clean up calendar event:', cleanupError);
        // Log but don't throw - original save error is more important
      }
      
      // Re-throw the original save error
      throw saveError;
    }

    // Create activity notification for all organization members
    try {
      // Create a proper display name, handling N/A cases
      const getDisplayName = (candidate) => {
        const firstName = candidate.firstName && candidate.firstName !== 'N/A' ? candidate.firstName : '';
        const lastName = candidate.lastName && candidate.lastName !== 'N/A' ? candidate.lastName : '';
        
        if (firstName && lastName) {
          return `${firstName} ${lastName}`;
        } else if (firstName) {
          return firstName;
        } else if (lastName) {
          return lastName;
        } else if (candidate.email && !candidate.email.includes('@temp.com')) {
          return candidate.email.split('@')[0]; // Use email username as fallback
        } else {
          return 'Candidate';
        }
      };

      const notificationData = {
        _id: interview._id,
        candidateId: interview.candidateId,
        candidateName: getDisplayName(candidate),
        jobTitle: job ? job.title : 'General Interview',
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        type: interview.type
      };
      
      await Notification.createInterviewCreatedNotification(req.user.id, notificationData);
      console.log(`📢 Interview creation notifications sent to organization for: ${notificationData.candidateName}`);
    } catch (notificationError) {
      console.error(`⚠️ Failed to create notifications for interview ${interview._id}:`, notificationError.message);
      // Don't fail interview creation if notification fails
    }
    
    // ✅ MOVE ALL EMAIL TEMPLATE VARIABLES OUTSIDE sendCustomEmail BLOCK 
    // So they're available for both candidate invitations AND interviewer notifications
    
    // Decode timezone string (may be HTML-encoded from frontend)
    const rawTimezone = userTimezone || interviewer?.profile?.timezone || 'UTC';
    const emailTimezone = decodeHtmlEntities(rawTimezone);
    
    console.log('🕐 Timezone for email formatting:', {
      rawTimezone,
      decodedTimezone: emailTimezone
    });
    
    const interviewStartDate = new Date(timeData?.startTimeISO || startTime);
    
    // Format date and time for email using interviewer timezone for consistency
    const interviewDate = interviewStartDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: emailTimezone
    });
    
    const interviewTime = interviewStartDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: emailTimezone,
      timeZoneName: 'short'
    });
    
    // Get organization name from interviewer's organization (interviewer already fetched above)
    const organizationName = interviewer?.organization?.name || 'SmartHR';
    
    // Format interview type
    const formattedType = type === 'video' ? 'Video Call' : 
                         type === 'phone' ? 'Phone Call' : 
                         'In-Person Meeting';
    
    // Get meeting link if available
    const meetingLink = event.conferencing?.details?.url || '';
    
    // Prepare template data
    const templateData = {
      candidateName: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
      jobTitle: jobTitle || 'Position',
      interviewDate,
      interviewTime,
      duration: duration || 60,
      interviewType: formattedType,
      meetingLink: meetingLink || null,  // ✅ FIX: Use null instead of empty string for conditionals
      notes: description || null,         // ✅ FIX: Use null instead of empty string for conditionals
      interviewerName: interviewer?.name || interviewer?.email || 'Hiring Manager',
      interviewerEmail: interviewer?.email || 'no-reply@smarthr.app',
      organizationName
    };
    
    // Send custom email notification if requested
    if (sendCustomEmail && candidate.email) {
      try {
        console.log('Sending custom email notification to candidate');
        console.log('📧 [Controller] emailTemplate param:', emailTemplate ? `${emailTemplate.substring(0, 200)}...` : 'NULL/undefined');
        console.log('📧 [Controller] emailTemplate type:', typeof emailTemplate);
        console.log('📧 [Controller] emailTemplate length:', emailTemplate ? emailTemplate.length : 0);
        
        // Send the email - Use Nylas if interviewer has connected email, fallback to Brevo
        const useNylasEmail = interviewer.nylasGrantId && process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS === 'true';
        
        if (useNylasEmail) {
          console.log('📧 Attempting Nylas connected email for interview notification');
          
          // Get account credentials if interviewer has a linked Nylas account
          let emailAccountCredentials = null;
          if (interviewer.nylasAccountId) {
            const NylasAccount = require('../models/NylasAccount');
            const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
            if (nylasAccount) {
              emailAccountCredentials = {
                apiKey: nylasAccount.apiKey,
                region: nylasAccount.region,
                clientId: nylasAccount.clientId
              };
              console.log(`   Using Nylas account for email: ${nylasAccount.name}`);
            }
          }
          
          // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
          const nylasResult = await nylasEmailService.sendInterviewInviteEmail(
            interviewer.nylasGrantId,
            candidate.email,
            templateData,
            emailTemplate,
            interview.subject, // Use custom subject if provided
            [], // No BCC - interviewers get separate notification
            [],  // No CC - interviewers get separate notification
            emailAccountCredentials // Pass account credentials
          );
          
          // If Nylas fails due to permissions or other issues, fall back to Brevo
          if (!nylasResult.success && nylasResult.fallbackToBrevo) {
            console.log('📧 Nylas failed (scope/permission issue), falling back to Brevo email service');
            console.warn('ℹ️ SOLUTION: User needs to disconnect and reconnect calendar to grant email permissions');
            console.warn('ℹ️ Current behavior: Using Brevo email service as fallback (interview still works)');
            
            // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
            await emailService.sendInterviewInviteEmail(
              candidate.email,
              templateData,
              emailTemplate,
              [], // No BCC - interviewers get separate notification
              []  // No CC - interviewers get separate notification
            );
          } else if (!nylasResult.success) {
            console.error(`❌ Nylas email failed: ${nylasResult.error}`);
            console.log('📧 Falling back to Brevo email service...');
            // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
            await emailService.sendInterviewInviteEmail(
              candidate.email,
              templateData,
              emailTemplate,
              [], // No BCC - interviewers get separate notification
              []  // No CC - interviewers get separate notification
            );
          }
        } else {
          console.log('📧 Using Brevo email service (Nylas not available)');
          // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
          await emailService.sendInterviewInviteEmail(
            candidate.email,
            templateData,
            emailTemplate,
            [], // No BCC - interviewers get separate notification
            []  // No CC - interviewers get separate notification
          );
        }
        
        console.log('Custom email notification sent successfully');
        
      } catch (emailError) {
        console.error('Failed to send custom email notification:', emailError);
        // Don't fail the interview creation if email fails
      }
    }
    
    // ✅ ALWAYS SEND NOTIFICATION EMAILS TO INTERVIEWERS/OBSERVERS (regardless of custom email setting)
    // Define participants outside try block to avoid scope issues
    const allInterviewParticipants = [
      // Main interviewer
      { email: interviewer.email, name: interviewer.name || interviewer.email },
      // Additional participants (excluding candidates)
      ...additionalParticipants.filter(p => p.role !== 'candidate'),
      // BCC participants (they should get notification, not invitation)
      ...bccParticipants,
      // CC participants (they should get notification, not invitation)  
      ...ccParticipants
    ];
    
    try {
      console.log('🚨 📧 NOTIFICATION BLOCK REACHED - Sending interview notifications to all participants...');
      console.log('🔍 Current context:', {
        interviewId: interview._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        interviewerEmail: interviewer.email,
        additionalParticipantsCount: additionalParticipants.length,
        bccParticipantsCount: bccParticipants.length,
        ccParticipantsCount: ccParticipants.length
      });
      
      console.log(`🔍 DEBUG: Interview notification details:`, {
        sendCustomEmail,
        participantCount: allInterviewParticipants.length,
        participants: allInterviewParticipants.map(p => ({
          email: p.email,
          name: p.name || 'no name',
          role: p.role || 'unknown'
        })),
        useNylasForEmails: interviewer.nylasGrantId && process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS === 'true',
        interviewerHasNylasGrant: !!interviewer.nylasGrantId,
        nylasEmailsEnabled: process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS
      });
      
      // Get account credentials if interviewer has a linked Nylas account (for both candidate and notification emails)
      let emailAccountCredentials = null;
      if (interviewer.nylasAccountId) {
        const NylasAccount = require('../models/NylasAccount');
        const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
        if (nylasAccount) {
          emailAccountCredentials = {
            apiKey: nylasAccount.apiKey,
            region: nylasAccount.region,
            clientId: nylasAccount.clientId
          };
          console.log(`   Using Nylas account for notifications: ${nylasAccount.name}`);
        }
      }
      
      // Remove duplicates and send notification to each unique participant
      const emailsSeen = new Set();
      for (const participant of allInterviewParticipants) {
        if (participant.email && !emailsSeen.has(participant.email.toLowerCase())) {
          emailsSeen.add(participant.email.toLowerCase());
          
          const notificationTemplateData = {
            candidateName: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
            jobTitle: jobTitle || 'Position',
            interviewDate,
            interviewTime,
            duration: duration || 60,
            interviewType: formattedType,
            meetingLink,
            notes: description || '',
            interviewerName: participant.name || participant.email.split('@')[0],
            interviewerEmail: interviewer?.email || 'no-reply@smarthr.app',
            organizationName,
            // ✅ ADD CANDIDATE INFORMATION FOR ENHANCED NOTIFICATION
            interviewId: interview._id,
            candidateResumeUrl: candidate.cvUrl,
            candidateCurrentRole: candidate.currentRole,
            candidateExperience: candidate.yearsOfExperience,
            feedbackUrl: `${process.env.FRONTEND_URL || 'https://smarthr.aiinnigeria.com'}/public/feedback/${interview._id}`
          };
          
          console.log(`🔍 Sending notification to ${participant.email} with template data:`, {
            candidateName: notificationTemplateData.candidateName,
            jobTitle: notificationTemplateData.jobTitle,
            interviewId: notificationTemplateData.interviewId,
            feedbackUrl: notificationTemplateData.feedbackUrl
          });
          
          // ✅ USE SAME PROVEN EMAIL METHOD AS CANDIDATE INVITATIONS (just different template and recipient)
          const useNylasForNotification = interviewer.nylasGrantId && process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS === 'true';
          
          // Create notification template (different from candidate invitation)
          const notificationTemplate = `Dear {{interviewerName}},

You have an upcoming interview to conduct for the {{jobTitle}} position.

CANDIDATE INFORMATION:
• Name: {{candidateName}}
• Position: {{jobTitle}}
{{#if candidateCurrentRole}}• Current Role: {{candidateCurrentRole}}{{/if}}
{{#if candidateExperience}}• Experience: {{candidateExperience}} years{{/if}}

INTERVIEW DETAILS:
• Date: {{interviewDate}}
• Time: {{interviewTime}}
• Duration: {{duration}} minutes
• Format: {{interviewType}}
{{#if meetingLink}}• Meeting Link: {{meetingLink}}{{/if}}
{{#if notes}}
• Additional Notes: {{notes}}
{{/if}}

FEEDBACK ACCESS:
You can access interview questions and submit feedback at:
{{feedbackUrl}}

Please review the candidate information before the interview and submit your assessment after completion.

Best regards,
{{organizationName}}`;
          
          if (useNylasForNotification) {
            console.log(`📧 🚨 ATTEMPTING Nylas notification to ${participant.email} with data:`, {
              grantId: interviewer.nylasGrantId,
              recipient: participant.email,
              candidateName: notificationTemplateData.candidateName,
              feedbackUrl: notificationTemplateData.feedbackUrl
            });
            const nylasNotificationResult = await nylasEmailService.sendInterviewInviteEmail(
              interviewer.nylasGrantId,
              participant.email,
              notificationTemplateData,
              notificationTemplate, // Custom template for notifications
              `Interview Notification: ${notificationTemplateData.candidateName} - ${notificationTemplateData.jobTitle}`, // Custom subject
              [], // No BCC for notifications
              [],  // No CC for notifications
              emailAccountCredentials // Pass same account credentials
            );
            
            console.log(`📧 ✅ Nylas notification result for ${participant.email}:`, nylasNotificationResult);
            
            if (!nylasNotificationResult.success) {
              console.log(`📧 ⚠️ Nylas notification failed for ${participant.email}, falling back to Brevo. Error:`, nylasNotificationResult.error);
              // Fallback to Brevo using same method
              await emailService.sendInterviewInviteEmail(
                participant.email,
                notificationTemplateData,
                notificationTemplate,
                [], // No BCC for notifications  
                []  // No CC for notifications
              );
              console.log(`📧 ✅ Brevo fallback notification sent to ${participant.email}`);
            }
          } else {
            console.log(`📧 🚨 ATTEMPTING Brevo notification to ${participant.email} (Nylas not available)`);
            await emailService.sendInterviewInviteEmail(
              participant.email,
              notificationTemplateData,
              notificationTemplate,
              [], // No BCC for notifications
              []  // No CC for notifications  
            );
            console.log(`📧 ✅ Brevo notification sent to ${participant.email}`);
          }
          
          console.log(`✅ Interview notification sent to ${participant.email}`);
        }
      }
    } catch (notificationError) {
      console.error('❌ 🚨 CRITICAL: Failed to send interview notifications to participants:', notificationError);
      console.error('🔍 Notification error details:', {
        errorMessage: notificationError.message,
        errorStack: notificationError.stack,
        interviewId: interview._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        participantCount: allInterviewParticipants.length,
        participantEmails: allInterviewParticipants.map(p => p.email)
      });
      // Don't fail the whole process if notifications fail
    }
    
    // Update candidate status if needed
    const validPreInterviewStatuses = ['applied', 'reviewing', 'shortlisted'];
    const originalStatus = candidate.status;
    if (validPreInterviewStatuses.includes(originalStatus)) {
      candidate.status = 'interviewing';
      await candidate.save();
      console.log(`✅ Individual candidate status updated: ${originalStatus} → interviewing`);
    } else {
      console.log(`ℹ️ Individual candidate status not updated - already at ${originalStatus} stage`);
    }

    // ALSO update pipeline status if candidate is in a job pipeline
    if (job && job._id) {
      try {
        console.log(`🔄 Updating pipeline status for candidate ${candidateId} in job ${job._id}`);
        console.log(`DEBUG: job._id before findById: ${job._id}`);
        
        // Find and update the job pipeline status
        const Job = require('../models/Job');
        const jobWithApplicants = await Job.findById(job._id);
        
        if (jobWithApplicants) {
          console.log(`DEBUG: jobWithApplicants found: ${jobWithApplicants._id}`);
          console.log(`📋 Found job with ${jobWithApplicants.applicants.length} applicants`);
          console.log(`DEBUG: jobWithApplicants.applicants is array: ${Array.isArray(jobWithApplicants.applicants)}`);
          
          const applicantIndex = jobWithApplicants.applicants.findIndex(
            app => app.candidate.toString() === candidateId
          );
          
          console.log(`🔍 Searching for candidate ${candidateId} in applicants...`);
          jobWithApplicants.applicants.forEach((app, index) => {
            console.log(`  Applicant ${index}: ${app.candidate.toString()} (status: ${app.status})`);
          });
          
          if (applicantIndex !== -1) {
            // Candidate exists in pipeline - update their status and stage (matching multi-candidate logic)
            const applicant = jobWithApplicants.applicants[applicantIndex];
            const previousStatus = applicant.status || 'unknown';
            const previousStage = applicant.currentStage;
            
            console.log(`👤 Found candidate at index ${applicantIndex} with status: ${previousStatus}`);
            
            // ALWAYS set the stage - whether they had one before or not (matching multi-candidate)
            let targetStageId = stageId;
            let targetStageName = 'Interview Stage';
            
            // If no stageId provided, find an appropriate interview stage
            if (!targetStageId && jobWithApplicants.stages && jobWithApplicants.stages.length > 0) {
              const interviewStage = jobWithApplicants.stages.find(stage => 
                stage.name.toLowerCase().includes('interview') || 
                stage.type === 'interview'
              );
              targetStageId = interviewStage ? interviewStage._id : jobWithApplicants.stages[0]._id;
              targetStageName = interviewStage ? interviewStage.name : jobWithApplicants.stages[0].name;
            } else if (targetStageId) {
              // If stageId is provided, try to get the stage name
              const InterviewStage = require('../models/InterviewStage');
              try {
                const stage = await InterviewStage.findById(targetStageId);
                if (stage) {
                  targetStageName = stage.name;
                }
              } catch (error) {
                console.warn('Could not find stage name for existing candidate stageId:', targetStageId);
              }
            }
            
            // Set the current stage (whether they had one or not) - MATCHING MULTI-CANDIDATE
            if (targetStageId) {
              // Set currentStage as an object with all required fields
              applicant.currentStage = {
                stageId: new mongoose.Types.ObjectId(targetStageId),
                stageName: targetStageName,
                enteredAt: new Date()
              };
              
              // Add to stage history
              if (!applicant.stageHistory) {
                applicant.stageHistory = [];
              }
              
              // Check if we need to exit the previous stage
              if (previousStage && previousStage.stageId) {
                // Find and update the previous stage in history
                const prevStageInHistory = applicant.stageHistory.find(
                  sh => sh.stageId?.toString() === previousStage.stageId.toString() && !sh.exitedAt
                );
                if (prevStageInHistory) {
                  prevStageInHistory.exitedAt = new Date();
                }
                console.log(`📍 Moving candidate from stage ${previousStage.stageName} to ${targetStageName}`);
              } else {
                console.log(`📍 Setting candidate to stage ${targetStageName} (was not in any stage)`);
              }
              
              // Add the new stage to history
              applicant.stageHistory.push({
                stageId: new mongoose.Types.ObjectId(targetStageId),
                stageName: targetStageName,
                enteredAt: new Date()
              });
            } else {
              console.log(`⚠️ No stage ID available for candidate`);
            }
            
            // Update status to interviewing if not already there - MATCHING MULTI-CANDIDATE
            const validPreInterviewStatuses = ['applied', 'reviewing', 'shortlisted', 'unknown', undefined];
            if (validPreInterviewStatuses.includes(previousStatus)) {
              applicant.status = 'interviewing';
              
              // Add to status history
              if (!applicant.statusHistory) {
                applicant.statusHistory = [];
              }
              
              applicant.statusHistory.push({
                status: 'interviewing',
                changedBy: interviewerId,
                changedAt: new Date(),
                notes: 'Status automatically updated when interview was scheduled',
                previousStatus
              });
            }
            
            // Add interview reference to applicant - MATCHING MULTI-CANDIDATE
            if (!applicant.interviews) {
              applicant.interviews = [];
            }
            
            applicant.interviews.push({
              interviewId: interview._id,
              stageId: targetStageId,
              scheduledAt: interview.scheduledAt,
              status: 'scheduled'
            });
            
            await jobWithApplicants.save();
            
            if (validPreInterviewStatuses.includes(previousStatus)) {
              console.log(`✅ Pipeline status updated: ${previousStatus} → interviewing`);
            } else {
              console.log(`ℹ️ Pipeline status maintained at ${previousStatus}`);
            }
            console.log(`✅ Candidate stage updated and interview linked`);
          } else {
            // Candidate not in pipeline - ADD them (matching multi-candidate behavior)
            console.log(`➕ Candidate ${candidateId} not in pipeline - adding them now`);
            
            try {
              // Find the target stage - use stageId or find an interview stage
              let targetStageId = stageId;
              let targetStageName = 'Interview';
              
              // If no stageId provided, find an appropriate interview stage (matching multi-candidate)
              if (!targetStageId && jobWithApplicants.stages && jobWithApplicants.stages.length > 0) {
                const interviewStage = jobWithApplicants.stages.find(stage => 
                  stage.name.toLowerCase().includes('interview') || 
                  stage.type === 'interview'
                );
                targetStageId = interviewStage ? interviewStage._id : jobWithApplicants.stages[0]._id;
                targetStageName = interviewStage ? interviewStage.name : jobWithApplicants.stages[0].name;
              } else if (targetStageId) {
                // If stageId is provided, try to get the stage name
                const InterviewStage = require('../models/InterviewStage');
                try {
                  const stage = await InterviewStage.findById(targetStageId);
                  if (stage) {
                    targetStageName = stage.name;
                  }
                } catch (error) {
                  console.warn('Could not find stage name for stageId:', targetStageId);
                }
              }
              
              // Validate that a pipeline stage exists
              if (!targetStageId) {
                throw new Error('Cannot add candidate to pipeline: No active pipeline stages exist for this job. Please create pipeline stages first.');
              }
              
              console.log(`📍 Adding candidate to stage: ${targetStageName} (${targetStageId})`);
              
              // Add candidate to job applicants array (matching multi-candidate structure)
              jobWithApplicants.applicants.push({
                candidate: candidateId,
                status: 'interviewing',
                appliedAt: new Date(),
                currentStage: {
                  stageId: targetStageId,
                  stageName: targetStageName,
                  enteredAt: new Date()
                },
                stageHistory: [{
                  stageId: targetStageId,
                  stageName: targetStageName,
                  enteredAt: new Date()
                }],
                statusHistory: [{
                  status: 'interviewing',
                  changedBy: interviewerId,
                  changedAt: new Date(),
                  notes: 'Added to pipeline when interview was scheduled'
                }],
                interviews: [{
                  interviewId: interview._id,
                  stageId: targetStageId,
                  scheduledAt: interview.scheduledAt,
                  status: 'scheduled'
                }]
              });
              
              await jobWithApplicants.save();
              console.log(`✅ Candidate added to pipeline with interview scheduled`);
              
            } catch (addError) {
              console.error('❌ Error adding candidate to pipeline:', addError);
              // Don't fail the whole interview creation if pipeline addition fails
              console.log('⚠️ Interview created successfully, but candidate was not added to pipeline');
            }
          }
        } else {
          console.log(`❌ Job ${job._id} not found when trying to update pipeline`);
        }
      } catch (pipelineError) {
        console.error('⚠️ Failed to update pipeline status:', pipelineError.message);
        console.error('Full error:', pipelineError);
        // Don't fail the interview creation if pipeline update fails
      }
    } else {
      console.log(`ℹ️ No job provided for pipeline update (job: ${job ? job._id : 'null'})`);
    }
    
    res.json({ 
      success: true, 
      interview: await interview.populate('jobId candidateId interviewerId'),
      event: {
        id: event.id,
        title: event.title,
        when: event.when,
        conferencing: event.conferencing
      }
    });
    
  } catch (error) {
    console.error('Schedule interview error:', error);
    const errorResponse = handleInterviewError(error, 'scheduleInterview');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Schedule from pipeline with candidate context
const scheduleFromPipeline = async (req, res) => {
  try {
    const { 
      candidateId, 
      jobId, 
      stageId, 
      startTime, 
      endTime, 
      duration, 
      notes, 
      addNotetaker = false, 
      provider = 'google_meet', 
      additionalParticipants = [],
      sendCustomEmail = false,
      emailTemplate = null
    } = req.body;
    const interviewerId = req.user.id; // Current user is the interviewer
    
    console.log('=== Schedule from pipeline DEBUG ===');
    console.log('Raw startTime:', startTime, typeof startTime);
    console.log('Raw endTime:', endTime, typeof endTime);
    console.log('Duration:', duration);
    console.log('JobId from request:', jobId);
    console.log('CandidateId from request:', candidateId);
    
    // FIXED: Handle timezone conversion - skip if frontend already converted to ISO
    const userTimezone = req.body.timezone || interviewer?.profile?.timezone || 'UTC';
    const useDirectISO = req.body.useDirectISO === true;
    console.log('User timezone:', userTimezone);
    console.log('Use direct ISO (frontend converted):', useDirectISO);
    
    let timeData;
    try {
      if (useDirectISO) {
        // Frontend already converted datetime-local to ISO (like multi-candidate)
        // Skip backend timezone conversion to avoid double conversion
        console.log('🔧 TIMEZONE FIX: Using direct ISO from frontend (no backend conversion)');
        console.log('📅 Received times:', { startTime, endTime, userTimezone });
        
        // Validate the ISO times
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          console.error('❌ Invalid date format:', {
            startTime,
            endTime,
            startDateValid: !isNaN(startDate.getTime()),
            endDateValid: !isNaN(endDate.getTime())
          });
          throw new Error('Invalid ISO datetime format');
        }
        
        if (endDate <= startDate) {
          // Safe fallback: if duration is provided, recompute endDate
          if (typeof duration === 'number' && duration > 0) {
            console.warn('⚠️ End before start. Recomputing end using duration minutes:', duration);
            endDate = new Date(startDate.getTime() + duration * 60000);
          } else {
            console.error('❌ Time validation failed:', {
              startTime,
              endTime,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
              startTimestamp: startDate.getTime(),
              endTimestamp: endDate.getTime(),
              difference: endDate.getTime() - startDate.getTime()
            });
            throw new Error('End time must be after start time');
          }
        }
        
        timeData = {
          startTimeISO: startDate.toISOString(),
          endTimeISO: endDate.toISOString(),
          startDate,
          endDate,
          durationMinutes: Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)),
          userTimezone
        };
        
        console.log('✅ Direct ISO validation successful:', {
          startTimeISO: timeData.startTimeISO,
          endTimeISO: timeData.endTimeISO,
          calculatedDuration: timeData.durationMinutes
        });
        
      } else {
        // Use legacy timezone conversion for backward compatibility
        timeData = timezoneUtils.processInterviewTimes(
          startTime,
          duration,
          userTimezone,
          endTime
        );
        
        console.log('✅ Legacy timezone conversion successful:', {
          originalStartTime: startTime,
          originalEndTime: endTime,
          userTimezone,
          processedStartTime: timeData.startTimeISO,
          processedEndTime: timeData.endTimeISO,
          calculatedDuration: timeData.durationMinutes
        });
      }
      
      // Common validation
      console.log('Start Date object:', timeData.startDate);
      console.log('End Date object:', timeData.endDate);
      console.log('Start < End?', timeData.startDate < timeData.endDate);
      console.log('Duration check:', timeData.durationMinutes, 'minutes');
      
    } catch (timezoneError) {
      console.error('❌ Timezone/validation error:', timezoneError);
      return res.status(400).json({
        error: 'INVALID_TIME_FORMAT',
        message: 'Failed to process interview times: ' + timezoneError.message,
        debug: { startTime, endTime, userTimezone, useDirectISO }
      });
    }
    
    // FIRST: Update the pipeline status BEFORE creating the interview
    if (jobId && candidateId) {
      try {
        console.log(`🔄 [PIPELINE] Updating status for candidate ${candidateId} in job ${jobId}`);
        
        const Job = require('../models/Job');
        const job = await Job.findById(jobId);
        
        if (job) {
          console.log(`📋 [PIPELINE] Found job: ${job.title} with ${job.applicants.length} applicants`);
          
          const applicantIndex = job.applicants.findIndex(
            app => app.candidate.toString() === candidateId
          );
          
          console.log(`🔍 [PIPELINE] Searching for candidate ${candidateId}...`);
          job.applicants.forEach((app, index) => {
            console.log(`  Applicant ${index}: ${app.candidate.toString()} (status: ${app.status})`);
          });
          
          if (applicantIndex !== -1) {
            const applicant = job.applicants[applicantIndex];
            const previousStatus = applicant.status;
            
            console.log(`👤 [PIPELINE] Found candidate at index ${applicantIndex} with status: ${previousStatus}`);
            
            // Update status to interviewing if not already there
            const validPreInterviewStatuses = ['applied', 'reviewing', 'shortlisted'];
            if (validPreInterviewStatuses.includes(previousStatus)) {
              applicant.status = 'interviewing';
              
              // Add to status history
              if (!applicant.statusHistory) {
                applicant.statusHistory = [];
              }
              
              applicant.statusHistory.push({
                status: 'interviewing',
                changedBy: interviewerId,
                changedAt: new Date(),
                notes: 'Status automatically updated when interview was scheduled from pipeline',
                previousStatus
              });
              
              await job.save();
              console.log(`✅ [PIPELINE] Status updated: ${previousStatus} → interviewing`);
            } else {
              console.log(`ℹ️ [PIPELINE] Status not updated - candidate already at ${previousStatus} stage`);
            }
          } else {
            console.log(`❌ [PIPELINE] Candidate ${candidateId} not found in job applicants`);
          }
        } else {
          console.log(`❌ [PIPELINE] Job ${jobId} not found`);
        }
      } catch (pipelineError) {
        console.error('⚠️ [PIPELINE] Failed to update pipeline status:', pipelineError);
        // Don't fail the interview creation if pipeline update fails
      }
    }
    
    // THEN: Create the interview using the main scheduling function
    const scheduleData = {
      candidateId,
      interviewerId,
      startTime: timeData.startTimeISO, // Pass properly converted ISO format
      endTime: timeData.endTimeISO, // Pass properly converted ISO format
      duration: timeData.durationMinutes,
      type: 'video',
      description: notes || 'Interview scheduled from candidate pipeline',
      subject: req.body.subject ? decodeHtmlEntities(req.body.subject) : undefined, // Pass custom subject if provided
      addNotetaker,
      skipAvailabilityCheck: req.body.skipAvailabilityCheck || false,
      forceSchedule: req.body.forceSchedule || false,
      provider: provider, // Pass the dynamic provider selection
      additionalParticipants: additionalParticipants, // Pass additional participants
      bccParticipants: req.body.bccParticipants || [], // Pass BCC participants
      ccParticipants: req.body.ccParticipants || [], // Pass CC participants
      timezone: userTimezone // Pass the user's timezone
    };
    
    // Add stageId if provided
    if (stageId) {
      scheduleData.stageId = stageId;
    }
    
    // Add jobId if provided
    if (jobId) {
      scheduleData.jobId = jobId;
    }
    
    // Pass along custom email settings
    if (sendCustomEmail) {
      scheduleData.sendCustomEmail = true;
      scheduleData.emailTemplate = emailTemplate;
    }
    
    // Pass along interviewer questions settings
    if (req.body.sendQuestionsToInterviewers) {
      scheduleData.sendQuestionsToInterviewers = true;
      scheduleData.questionsSendTime = req.body.questionsSendTime || 60;
      scheduleData.selectedQuestionIds = req.body.selectedQuestionIds || [];
    }
    
    // Always use the main scheduling function with full Nylas integration
    // This ensures proper calendar events, meeting links, notetaker, etc.
    req.body = scheduleData;
    return scheduleInterview(req, res);
    
  } catch (error) {
    console.error('Schedule from pipeline error:', error);
    const errorResponse = handleInterviewError(error, 'scheduleFromPipeline');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Get availability for a user
const getAvailability = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, duration = 60 } = req.query;
    
    const user = await User.findById(userId);
    if (!user || !user.nylasGrantId) {
      return res.status(404).json({
        error: 'USER_CALENDAR_NOT_FOUND',
        message: 'User not found or calendar not connected'
      });
    }
    
    // Get account credentials if user has a linked Nylas account
    let availabilityAccountCredentials = null;
    if (user.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        availabilityAccountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
      }
    }
    
    const availability = await nylasV3Service.getAvailability(
      user.nylasGrantId,
      startDate,
      endDate,
      [user.email],
      availabilityAccountCredentials
    );
    
    res.json({ availability });
    
  } catch (error) {
    console.error('Get availability error:', error);
    const errorResponse = handleInterviewError(error, 'getAvailability');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Connect calendar (OAuth flow)
const connectCalendar = async (req, res) => {
  try {
    const { provider = 'google', forceAccountSelection = false } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;
    
    // Get the JWT token from the Authorization header to pass in state
    const authHeader = req.header('Authorization');
    const jwtToken = authHeader ? authHeader.replace('Bearer ', '') : null;
    
    // MULTI-ACCOUNT: Select Nylas account BEFORE creating OAuth URL
    console.log('🎯 Selecting Nylas account for OAuth flow...');
    let availableAccount = await multiNylasService.findAvailableAccount();
    
    if (!availableAccount) {
      // All accounts full - attempt auto-rotation with interview protection
      console.log('⚠️ All accounts full - attempting grant rotation...');
      
      try {
        const slotResult = await grantManagementService.ensureGrantSlotAvailable(
          req.user.currentOrganization, // Organization ID (for logging)
          req.user.email // New user's email
        );
        
        if (slotResult.slotAvailable) {
          // Successfully freed up a slot - use that account
          availableAccount = {
            account: slotResult.nylasAccount,
            currentGrants: slotResult.currentCount,
            availableSlots: 1,
            credentials: {
              apiKey: slotResult.nylasAccount.apiKey,
              clientId: slotResult.nylasAccount.clientId,
              clientSecret: slotResult.nylasAccount.clientSecret,
              region: slotResult.nylasAccount.region,
              apiUri: slotResult.nylasAccount.apiUri,
              redirectUri: slotResult.nylasAccount.redirectUri
            }
          };
          
          console.log(`✅ Auto-rotation successful: ${slotResult.message}`);
          if (slotResult.autoRemovalPerformed) {
            console.log(`   Removed: ${slotResult.removedGrant.email}`);
          }
        }
      } catch (rotationError) {
        // Check if error is due to all users having interviews
        if (rotationError.code === 'GRANT_SLOTS_FULL') {
          const systemCapacity = await multiNylasService.getSystemCapacity();
          return res.status(400).json({
            error: 'NO_CALENDAR_SLOTS_AVAILABLE',
            message: rotationError.details.message,
            details: {
              totalCapacity: systemCapacity.totalMax,
              totalUsed: systemCapacity.totalUsed,
              accountCount: systemCapacity.accountCount,
              allUsersHaveInterviews: true
            }
          });
        }
        
        // Other rotation errors
        throw rotationError;
      }
    }
    
    console.log(`✅ Selected account: ${availableAccount.account.name} (${availableAccount.currentGrants}/${availableAccount.account.maxGrants} used)`);
    
    // Pass user ID, email, JWT token, and selected account ID in state
    const stateData = JSON.stringify({ 
      userId, 
      email: userEmail,
      jwt: jwtToken,  // Include JWT to maintain auth context
      forceAccountSelection: forceAccountSelection,
      nylasAccountId: availableAccount.account._id.toString(), // Store selected account ID
      nylasAccountName: availableAccount.account.name // For logging
    });
    
    // Create auth URL using the selected account's credentials
    const authUrl = await nylasV3Service.createAuthUrl(
      stateData, 
      provider, 
      forceAccountSelection,
      availableAccount.credentials // Pass the selected account's credentials
    );
    
    res.json({ authUrl });
    
  } catch (error) {
    console.error('Connect calendar error:', error);
    const errorResponse = handleInterviewError(error, 'connectCalendar');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Handle OAuth callback
const handleOAuthCallback = async (req, res) => {
  try {
    console.log('=== OAuth Callback Handler ===');
    console.log('Query params:', req.query);
    console.log('Session middleware skipped:', req.skipSessionCreation);
    
    const { code, state } = req.query;
    
    if (!code) {
      console.error('Missing authorization code in OAuth callback');
      return res.status(400).json({
        error: 'MISSING_AUTH_CODE',
        message: 'Authorization code is required'
      });
    }

    // Parse the state parameter first to get user information and Nylas account
    let user = null;
    let jwtToken = null;
    let selectedNylasAccount = null;
    let stateData = null;
    
    console.log('Parsing state parameter:', state);
    
    if (state) {
      try {
        // Try to parse state as JSON (new format with userId, email, JWT, and nylasAccountId)
        stateData = JSON.parse(state);
        console.log('Parsed state data:', { 
          userId: stateData.userId, 
          email: stateData.email, 
          hasJWT: !!stateData.jwt,
          nylasAccountId: stateData.nylasAccountId,
          nylasAccountName: stateData.nylasAccountName
        });
        jwtToken = stateData.jwt; // Extract JWT for authentication
        
        // MULTI-ACCOUNT: Get the selected Nylas account from state
        if (stateData.nylasAccountId) {
          const NylasAccount = require('../models/NylasAccount');
          selectedNylasAccount = await NylasAccount.findById(stateData.nylasAccountId)
            .select('+apiKey +clientSecret');
          
          if (selectedNylasAccount) {
            console.log(`✅ Using Nylas account from state: ${selectedNylasAccount.name}`);
          } else {
            console.warn(`⚠️ Nylas account ${stateData.nylasAccountId} not found, using default`);
          }
        }
      } catch (parseError) {
        console.log('State parsing failed:', parseError.message);
      }
    }
    
    console.log('Exchanging code for grant...');
    // Exchange code for grant using the correct account credentials
    const accountCredentials = selectedNylasAccount ? {
      clientId: selectedNylasAccount.clientId,
      clientSecret: selectedNylasAccount.clientSecret,
      apiKey: selectedNylasAccount.apiKey,
      region: selectedNylasAccount.region
      // redirectUri removed - always use configLoader for dynamic environment-based URL
    } : null;
    
    const grant = await nylasV3Service.exchangeCodeForGrant(code, accountCredentials);
    console.log('Grant received:', JSON.stringify(grant, null, 2));
    
    // Continue parsing state for user info
    if (stateData) {
      try {
        
        if (stateData.userId) {
          console.log('Looking up user by ID:', stateData.userId);
          user = await User.findById(stateData.userId);
          console.log('User found by ID:', user ? `${user.email} (${user._id})` : 'null');
        }
        if (!user && stateData.email) {
          console.log('Looking up user by email:', stateData.email);
          user = await User.findOne({ email: stateData.email });
          console.log('User found by email:', user ? `${user.email} (${user._id})` : 'null');
        }
      } catch (parseError) {
        console.log('State parsing failed, treating as email:', parseError.message);
        // If parsing fails, treat state as email (old format)
        user = await User.findOne({ email: state });
        console.log('User found by fallback email:', user ? `${user.email} (${user._id})` : 'null');
      }
    }
    
    // Fallback: try to find user by grant email if available
    if (!user && grant.email) {
      console.log('Final fallback - looking up user by grant email:', grant.email);
      user = await User.findOne({ email: grant.email });
      console.log('User found by grant email:', user ? `${user.email} (${user._id})` : 'null');
    }
    
    // NEW: MULTI-ACCOUNT GRANT SLOT MANAGEMENT
    // The Nylas account was already selected in connectCalendar and passed through state
    let rotationInfo = null;
    
    // Only check for grant rotation if we didn't get an account from state (backward compatibility)
    if (!selectedNylasAccount && user && user.currentOrganization) {
      try {
        console.log('\n🎰 Checking grant slot availability (backward compatibility mode)...');
        const slotResult = await grantManagementService.ensureGrantSlotAvailable(
          user.currentOrganization,
          user.email
        );
        
        // Store the selected Nylas account for later use
        selectedNylasAccount = slotResult.nylasAccount;
        console.log(`✅ Selected Nylas account: ${selectedNylasAccount.name}`);
        
        if (slotResult.autoRemovalPerformed) {
          console.log(`⚠️ Auto-removed oldest grant: ${slotResult.removedGrant.email}`);
          rotationInfo = slotResult; // Store for later use in success response
        }
      } catch (slotError) {
        console.error('❌ Error managing grant slots:', slotError);
        
        // Handle the specific case where all slots are full with active users
        if (slotError.code === 'GRANT_SLOTS_FULL') {
          console.log('🚫 Cannot remove any grant - all users have upcoming interviews');
          
          // Return a user-friendly error page
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Calendar Slots Full</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  text-align: center; 
                  padding: 50px; 
                  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                  color: white;
                  margin: 0;
                  min-height: 100vh;
                  display: flex;
                  flex-direction: column;
                  justify-content: center;
                  align-items: center;
                }
                .container { 
                  background: rgba(255, 255, 255, 0.1); 
                  padding: 40px; 
                  border-radius: 15px;
                  backdrop-filter: blur(10px);
                  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                  max-width: 600px;
                }
                .icon {
                  width: 80px;
                  height: 80px;
                  border-radius: 50%;
                  background: rgba(255, 255, 255, 0.2);
                  margin: 0 auto 20px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 40px;
                }
                h1 { margin: 20px 0; font-size: 28px; }
                p { font-size: 16px; line-height: 1.6; margin: 15px 0; }
                .details {
                  background: rgba(0, 0, 0, 0.2);
                  padding: 20px;
                  border-radius: 10px;
                  margin: 20px 0;
                  text-align: left;
                }
                .details strong { display: block; margin-bottom: 10px; }
                .action-btn {
                  background: white;
                  color: #f5576c;
                  border: none;
                  padding: 15px 30px;
                  border-radius: 8px;
                  font-size: 16px;
                  font-weight: bold;
                  cursor: pointer;
                  margin-top: 20px;
                }
                .action-btn:hover {
                  background: #f0f0f0;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="icon">🚫</div>
                <h1>Calendar Slots Full</h1>
                <p>
                  Your organization has reached its maximum capacity of <strong>${slotError.details.maxAllowed}</strong> calendar connections, 
                  and all slots are currently occupied by users with upcoming scheduled interviews.
                </p>
                
                <div class="details">
                  <strong>What this means:</strong>
                  <p>• All ${slotError.details.totalUsers} active calendar slots are being used by team members with scheduled interviews</p>
                  <p>• We cannot auto-rotate anyone out because it would disrupt their upcoming interviews</p>
                  <p>• You'll need administrator assistance to connect your calendar</p>
                </div>
                
                <p><strong>What to do next:</strong></p>
                <p>Contact your organization administrator to:</p>
                <p>• Request an increase in calendar slot limit</p>
                <p>• Manually remove an inactive user's calendar connection</p>
                <p>• Wait for an upcoming interview to complete and try again</p>
                
                <button class="action-btn" onclick="window.close()">Close Window</button>
              </div>
              
              <script>
                // Send error message to parent window
                if (window.opener && window.opener !== window) {
                  try {
                    window.opener.postMessage({
                      type: 'oauth_error',
                      error: 'GRANT_SLOTS_FULL',
                      message: '${slotError.details.message}',
                      details: ${JSON.stringify(slotError.details)}
                    }, '*');
                  } catch (e) {
                    console.error('Error sending message to parent:', e);
                  }
                }
                
                // Auto-close after 30 seconds
                setTimeout(() => {
                  try {
                    window.close();
                  } catch (e) {
                    console.log('Could not auto-close window');
                  }
                }, 30000);
              </script>
            </body>
            </html>
          `);
        }
        
        // For other errors, continue with grant creation
        // This ensures users can still connect calendar if there's a different error
        console.warn('⚠️ Non-critical grant management error, continuing with connection...');
      }
    }
    
    if (!user) {
      console.error('=== OAuth callback - NO USER FOUND ===');
      console.error('State:', state);
      console.error('Grant:', JSON.stringify(grant, null, 2));
      
      // Return a page that sends postMessage with error
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h2 class="error">Authentication Failed</h2>
          <p>User not found during calendar connection.</p>
          <script>
            // Send error message to parent window
            if (window.opener) {
              window.opener.postMessage({
                type: 'oauth_error',
                error: 'User authentication failed during calendar connection'
              }, '*');
              window.close();
            } else if (window.parent !== window) {
              window.parent.postMessage({
                type: 'oauth_error',
                error: 'User authentication failed during calendar connection'
              }, '*');
            } else {
              // Fallback redirect if not in popup/iframe
              window.location.href = 'http://localhost:5000/calendar?error=user_not_found&message=User authentication failed during calendar connection';
            }
          </script>
        </body>
        </html>
      `);
    }
    
    // Update user with calendar connection info
    // Nylas v3 returns grant_id (not grantId) and may not include provider/email directly
    const grantId = grant.grant_id || grant.grantId || grant.id;
    const provider = grant.provider || 'google'; // Default to google if not provided
    
    console.log('Updating user calendar info:');
    console.log('- Grant ID:', grantId);
    console.log('- Provider:', provider);
    console.log('- Nylas Account:', selectedNylasAccount ? selectedNylasAccount.name : 'Not selected (using default)');
    
    user.nylasGrantId = grantId;
    user.nylasGrantStatus = 'active';
    user.calendarConnected = true;
    user.calendarProvider = provider;
    user.grantConnectedAt = new Date(); // Record timestamp when grant was connected
    user.nylasAccountId = selectedNylasAccount ? selectedNylasAccount._id : null; // Link to Nylas account
    await user.save();
    
    // Update the Nylas account's grant count
    if (selectedNylasAccount) {
      const multiNylasService = require('../services/multiNylasService');
      await multiNylasService.updateGrantCount(selectedNylasAccount._id);
    }
    
    console.log('User calendar fields after save:', {
      nylasGrantId: user.nylasGrantId,
      nylasAccountId: user.nylasAccountId,
      calendarConnected: user.calendarConnected,
      calendarProvider: user.calendarProvider,
      nylasGrantStatus: user.nylasGrantStatus,
      grantConnectedAt: user.grantConnectedAt
    });
    
    console.log(`✅ Calendar connected successfully for user ${user.email} (ID: ${user._id})`);
    
    // Return a page that sends postMessage to parent window (for popup) or redirects (for direct navigation)
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Calendar Connected</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
          .success { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 30px; 
            border-radius: 10px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          }
          .checkmark {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #28a745;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            animation: checkmark 0.6s ease-in-out;
          }
          @keyframes checkmark {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
          .spinner {
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h2>Calendar Connected Successfully!</h2>
          <p>Your Google Calendar has been connected to SmartHR.</p>
          <div class="spinner"></div>
          <p>Closing window...</p>
        </div>
        
        <script>
          console.log('OAuth success page loaded');
          
          // Function to send success message
          function sendSuccessMessage() {
            const message = {
              type: 'oauth_success',
              provider: '${provider}',
              grantId: '${grantId}',
              userId: '${user._id}',
              timestamp: new Date().toISOString(),
              shouldClose: true,
              callerId: '${Date.now()}'
            };
            
            console.log('Sending success message:', message);
            
            // Include rotation info if auto-removal was performed
            ${rotationInfo ? `
            // Send separate message for grant rotation notification
            try {
              window.opener.postMessage({
                type: 'grant_rotation',
                rotationInfo: ${JSON.stringify(rotationInfo)}
              }, '*');
              console.log('Grant rotation notification sent');
            } catch (e) {
              console.error('Error sending rotation notification:', e);
            }
            ` : ''}
            
            return message;
          }
          
          // Check if we're in a popup window
          if (window.opener && window.opener !== window) {
            console.log('Detected popup window, sending postMessage to opener');
            
            // CRITICAL FIX: Use a more aggressive approach to closing the window
            // First, set the window name and cookie BEFORE any postMessage or close attempts
            try {
              // Mark the window as connected (used by frontend detection)
              window.name = 'calendar_connected_' + Date.now();
              document.cookie = "calendarConnected=true; path=/; max-age=300";
              console.log('Window marked as connected via name and cookie');
            } catch(e) {
              console.error('Error setting identification markers:', e);
            }
            
            // Now send the postMessage
            try {
              window.opener.postMessage(sendSuccessMessage(), '*');
              console.log('PostMessage sent to opener');
            } catch (error) {
              console.error('Error sending postMessage to opener:', error);
            }
            
            // Try closing with different techniques - staggered for best chance of success
            console.log('Starting aggressive window closing sequence');
            
            // First attempt - immediate close
            setTimeout(() => {
              try { 
                console.log('Close attempt 1'); 
                window.close(); 
              } catch(e) {}
            }, 200);
            
            // Second attempt - close via script injection
            setTimeout(() => {
              try {
                console.log('Close attempt 2 - script injection');
                const closeScript = document.createElement('script');
                closeScript.textContent = '(function() { console.log("Executing self-close script"); window.close(); setTimeout(window.close, 100); })();';
                document.body.appendChild(closeScript);
              } catch(e) {}
            }, 500);
            
            // Third attempt - blank page redirect then close
            setTimeout(() => {
              try {
                console.log('Close attempt 3 - redirect then close');
                window.location = 'about:blank';
                setTimeout(() => window.close(), 200);
              } catch(e) {}
            }, 1000);
            
            // Fourth attempt - immediately try to close
            setTimeout(() => {
              try {
                console.log('Close attempt 4 - immediate close');
                window.open('', '_self').close();
              } catch(e) {}
            }, 1500);
          } 
          // Check if we're in an iframe
          else if (window.parent && window.parent !== window) {
            console.log('Detected iframe, sending postMessage to parent');
            try {
              window.parent.postMessage(sendSuccessMessage(), '*');
              console.log('PostMessage sent to parent');
            } catch (error) {
              console.error('Error sending postMessage to parent:', error);
            }
          } 
          // Direct navigation - redirect to calendar page
          else {
            console.log('Direct navigation detected, showing message to close tab');
            // Don't redirect, just show a message with a close button
            document.body.innerHTML = \`
              <div class="success">
                <div class="checkmark">✓</div>
                <h2>Setup Complete!</h2>
                <p>Calendar has been connected successfully.</p>
                <p style="margin-top: 20px; font-size: 14px;">You can now close this window.</p>
                <button onclick="window.close(); window.open('','_self').close();" style="
                  margin-top: 20px;
                  padding: 12px 24px;
                  background: white;
                  color: #667eea;
                  border: none;
                  border-radius: 8px;
                  cursor: pointer;
                  font-size: 16px;
                  font-weight: 500;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                ">Close This Window</button>
              </div>
            \`;
            // Try to close anyway
            setTimeout(() => window.close(), 500);
            setTimeout(() => window.open('','_self').close(), 1000);
          }
          
          // Additional fallback: try to detect if window was closed
          let closeCheckInterval;
          if (window.opener) {
            closeCheckInterval = setInterval(() => {
              try {
                if (window.opener.closed) {
                  clearInterval(closeCheckInterval);
                  window.close();
                }
              } catch (e) {
                // Ignore cross-origin errors
              }
            }, 1000);
          }
          
          // We already set window.name and cookie earlier, no need to do it again
          
          // Cleanup after 10 seconds (reduced from 30)
          setTimeout(() => {
            if (closeCheckInterval) clearInterval(closeCheckInterval);
            if (window.opener && !window.opener.closed) {
              window.close();
              // Last attempt: redirect to blank and close
              window.location = 'about:blank';
              setTimeout(() => window.close(), 500);
            }
          }, 10000);
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    
    // Return error page that sends postMessage
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
            color: white;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
          .error { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 30px; 
            border-radius: 10px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          }
          .error-icon {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #dc3545;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
          }
        </style>
      </head>
      <body>
        <div class="error">
          <div class="error-icon">✗</div>
          <h2>Connection Failed</h2>
          <p>There was an error connecting your calendar.</p>
          <p>Please try again.</p>
        </div>
        
        <script>
          console.log('OAuth error page loaded');
          
          const errorMessage = {
            type: 'oauth_error',
            error: 'Calendar connection failed: ${error.message}',
            timestamp: new Date().toISOString()
          };
          
          // Send error message to parent window
          if (window.opener && window.opener !== window) {
            console.log('Sending error message to opener');
            window.opener.postMessage(errorMessage, '*');
            setTimeout(() => window.close(), 3000);
          } else if (window.parent && window.parent !== window) {
            console.log('Sending error message to parent');
            window.parent.postMessage(errorMessage, '*');
          } else {
            // Fallback redirect
            // Just show error message on the page without redirecting
            document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h2>Error</h2><p>Calendar connection failed: ${error.message}</p><p>Please try again.</p></div>';
          }
        </script>
      </body>
      </html>
    `);
  }
};

// Get calendar connection status
const getCalendarStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('=== GET CALENDAR STATUS ===');
    console.log('Requested userId:', userId);
    
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found for ID:', userId);
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }
    
    console.log('✅ User found:', user.email);
    console.log('📋 Calendar fields:', {
      nylasGrantId: user.nylasGrantId ? 'Set' : 'Not set',
      calendarConnected: user.calendarConnected,
      calendarProvider: user.calendarProvider,
      nylasGrantStatus: user.nylasGrantStatus
    });
    
    const status = {
      connected: !!user.nylasGrantId,
      provider: user.calendarProvider,
      status: user.nylasGrantStatus,
      lastConnected: user.updatedAt
    };
    
    // If connected, verify the grant is still valid
    if (user.nylasGrantId) {
      console.log('🔍 Verifying grant with Nylas API...');
      
      // Get account credentials if user has a linked Nylas account
      let accountCredentials = null;
      if (user.nylasAccountId) {
        const NylasAccount = require('../models/NylasAccount');
        const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
        if (nylasAccount) {
          accountCredentials = {
            apiKey: nylasAccount.apiKey,
            region: nylasAccount.region,
            clientId: nylasAccount.clientId
          };
          console.log(`   Using Nylas account: ${nylasAccount.name}`);
        }
      }
      
      try {
        await nylasV3Service.getCalendars(user.nylasGrantId, accountCredentials);
        console.log('✅ Grant verification successful');
        status.verified = true;
      } catch (error) {
        console.log('❌ Grant verification failed:', error.message);
        status.verified = false;
        status.error = 'Grant may be expired or invalid';
      }
    } else {
      console.log('⚠️ No nylasGrantId found - calendar not connected');
    }
    
    console.log('📤 Returning status:', status);
    res.json(status);
    
  } catch (error) {
    console.error('Get calendar status error:', error);
    const errorResponse = handleInterviewError(error, 'getCalendarStatus');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Get interviews for a job
const getJobInterviews = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // First verify the job belongs to the user's organization
    const Job = require('../models/Job');
    const job = await Job.findOne({ 
      _id: jobId, 
      organization: req.user.currentOrganization 
    });
    
    if (!job) {
      return res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: 'Job not found in your organization'
      });
    }
    
    const interviews = await Interview.find({ jobId })
      .populate('candidateId', 'firstName lastName email')
      .populate('interviewerId', 'name email')
      .sort({ scheduledAt: 1 });
    
    res.json({ interviews });
    
  } catch (error) {
    console.error('Get job interviews error:', error);
    const errorResponse = handleInterviewError(error, 'getJobInterviews');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Get interviews for a candidate
const getCandidateInterviews = async (req, res) => {
  try {
    const { candidateId } = req.params;
    
    // First verify the candidate belongs to the user's organization
    const Candidate = require('../models/Candidate');
    const candidate = await Candidate.findOne({ 
      _id: candidateId, 
      organization: req.user.currentOrganization 
    });
    
    if (!candidate) {
      return res.status(404).json({
        error: 'CANDIDATE_NOT_FOUND',
        message: 'Candidate not found in your organization'
      });
    }
    
    const interviews = await Interview.find({ candidateId })
      .populate('jobId', 'title company')
      .populate('interviewerId', 'name email')
      .sort({ scheduledAt: -1 });
    
    res.json({ interviews });
    
  } catch (error) {
    console.error('Get candidate interviews error:', error);
    const errorResponse = handleInterviewError(error, 'getCandidateInterviews');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Get interviews with optional filters
const getInterviews = async (req, res) => {
  try {
    const { status, type, startDate, endDate, interviewerId, candidateId } = req.query;
    
    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (interviewerId) filter.interviewerId = interviewerId;
    if (candidateId) filter.candidateId = candidateId;
    
    // Handle date range filtering
    if (startDate || endDate) {
      filter.scheduledAt = {};
      if (startDate) filter.scheduledAt.$gte = new Date(startDate);
      if (endDate) filter.scheduledAt.$lte = new Date(endDate);
    }
    
    console.log('Getting interviews with filter:', filter);
    console.log('User organization:', req.user.currentOrganization);
    
    // Debug: Count total interviews before filtering
    const totalInterviewsCount = await Interview.countDocuments(filter);
    console.log(`📊 Total interviews matching filter before org filtering: ${totalInterviewsCount}`);
    
    // Use aggregation pipeline to filter by organization through jobs OR organizationId
    const interviews = await Interview.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'jobs',
          localField: 'jobId',
          foreignField: '_id',
          as: 'job'
        }
      },
      {
        // Filter by organization - either through job relationship or direct organizationId
        $match: {
          $or: [
            { 'job.organization': new mongoose.Types.ObjectId(req.user.currentOrganization) },
            { organizationId: new mongoose.Types.ObjectId(req.user.currentOrganization) }
          ]
        }
      },
      {
        $lookup: {
          from: 'candidates',
          localField: 'candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'interviewerId',
          foreignField: '_id',
          as: 'interviewer'
        }
      },
      {
        $addFields: {
          jobId: { $arrayElemAt: ['$job', 0] },
          candidateId: { $arrayElemAt: ['$candidate', 0] },
          interviewerId: { $arrayElemAt: ['$interviewer', 0] }
        }
      },
      {
        $project: {
          job: 0,
          candidate: 0,
          interviewer: 0
        }
      },
      { $sort: { scheduledAt: -1 } }
    ]);
    
    console.log(`📊 Total interviews returned after org filtering: ${interviews.length}`);
    console.log(`📊 Multi-candidate interviews found: ${interviews.filter(i => i.isMultiCandidate).length}`);
    
    res.json({ interviews });
    
  } catch (error) {
    console.error('Get interviews error:', error);
    const errorResponse = handleInterviewError(error, 'getInterviews');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Update interview status
const updateInterviewStatus = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { status, notes, feedback } = req.body;
    
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({
        error: 'INTERVIEW_NOT_FOUND',
        message: 'Interview not found'
      });
    }
    
    // Validate status transition
    const availableTransitions = interview.getAvailableStatusTransitions();
    if (!availableTransitions.includes(status)) {
      return res.status(400).json({
        error: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition from ${interview.status} to ${status}`,
        availableTransitions
      });
    }
    
    interview.status = status;
    if (notes) interview.notes = notes;
    if (feedback) interview.feedback = { ...interview.feedback, ...feedback };
    
    await interview.save();
    
    res.json({ 
      success: true, 
      interview: await interview.populate('jobId candidateId interviewerId')
    });
    
  } catch (error) {
    console.error('Update interview status error:', error);
    const errorResponse = handleInterviewError(error, 'updateInterviewStatus');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Cancel interview
const cancelInterview = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { reason, notifyParticipants = true } = req.body;
    const cancelledBy = req.user.id;
    
    console.log('=== CANCEL INTERVIEW REQUEST ===');
    console.log('Interview ID:', interviewId);
    console.log('Reason:', reason);
    console.log('Cancelled by:', cancelledBy);
    
    const interview = await Interview.findById(interviewId)
      .populate('candidateId', 'firstName lastName email')
      .populate('interviewerId', 'name email');
    
    if (!interview) {
      return res.status(404).json({
        error: 'INTERVIEW_NOT_FOUND',
        message: 'Interview not found'
      });
    }
    
    console.log('Interview found:', {
      id: interview._id,
      status: interview.status,
      nylasEventId: interview.nylasEventId,
      interviewerId: interview.interviewerId
    });
    
    // Check if interview can be cancelled
    if (interview.status === 'cancelled') {
      return res.status(400).json({
        error: 'ALREADY_CANCELLED',
        message: 'Interview is already cancelled'
      });
    }
    
    if (interview.status === 'completed') {
      return res.status(400).json({
        error: 'CANNOT_CANCEL_COMPLETED',
        message: 'Cannot cancel a completed interview'
      });
    }
    
    // Cancel the calendar event if it exists
    if (interview.nylasEventId) {
      try {
        // Get the interviewer's grant ID - need to fetch full user since populate only got name/email
        const interviewerUser = await User.findById(interview.interviewerId._id || interview.interviewerId);
        console.log('Cancelling calendar event - Interviewer lookup:', {
          interviewerId: interview.interviewerId._id || interview.interviewerId,
          interviewerFound: !!interviewerUser,
          hasGrantId: !!(interviewerUser && interviewerUser.nylasGrantId)
        });
        
        if (interviewerUser && interviewerUser.nylasGrantId) {
          // Get account credentials if interviewer has a linked Nylas account
          let cancelAccountCredentials = null;
          if (interviewerUser.nylasAccountId) {
            const NylasAccount = require('../models/NylasAccount');
            const nylasAccount = await NylasAccount.findById(interviewerUser.nylasAccountId).select('+apiKey');
            if (nylasAccount) {
              cancelAccountCredentials = {
                apiKey: nylasAccount.apiKey,
                region: nylasAccount.region,
                clientId: nylasAccount.clientId
              };
            }
          }
          
          await nylasV3Service.deleteEvent(interviewerUser.nylasGrantId, interview.nylasEventId, cancelAccountCredentials);
          console.log('✅ Calendar event cancelled successfully:', interview.nylasEventId);
        } else {
          console.error('❌ Could not find interviewer grant ID to cancel calendar event');
          console.error('Interviewer data:', {
            id: interview.interviewerId._id || interview.interviewerId,
            userFound: !!interviewerUser,
            grantId: interviewerUser?.nylasGrantId
          });
        }
      } catch (calendarError) {
        console.error('❌ Failed to cancel calendar event:', calendarError.message || calendarError);
        console.error('Full error:', calendarError);
        // Continue with interview cancellation even if calendar fails
      }
    } else {
      console.log('ℹ️ No calendar event to cancel (no nylasEventId)');
    }
    
    // Update interview record
    interview.status = 'cancelled';
    interview.cancellationReason = reason;
    interview.cancelledBy = cancelledBy;
    interview.cancelledAt = new Date();
    
    await interview.save();
    
    // Update candidate status back to previous stage if they were in interviewing
    if (interview.candidateId) {
      const candidate = await require('../models/Candidate').findById(interview.candidateId);
      if (candidate && candidate.status === 'interviewing') {
        candidate.status = 'shortlisted'; // Move back to shortlisted
        await candidate.save();
      }

      // ALSO update pipeline status if candidate is in a job pipeline
      if (interview.jobId) {
        try {
          console.log(`🔄 Reverting pipeline status for candidate ${interview.candidateId} in job ${interview.jobId}`);
          
          // Find and update the job pipeline status
          const Job = require('../models/Job');
          const jobWithApplicants = await Job.findById(interview.jobId);
          
          if (jobWithApplicants) {
            const applicantIndex = jobWithApplicants.applicants.findIndex(
              app => app.candidate.toString() === interview.candidateId.toString()
            );
            
            if (applicantIndex !== -1) {
              const applicant = jobWithApplicants.applicants[applicantIndex];
              const previousStatus = applicant.status;
              
                             // Only update if current status is interviewing
               if (previousStatus === 'interviewing') {
                 // Find the previous status from status history to revert to
                 const statusHistory = applicant.statusHistory || [];
                 const lastNonInterviewingStatus = statusHistory
                   .filter(h => h.status !== 'interviewing')
                   .pop();
                 
                 const revertToStatus = lastNonInterviewingStatus?.status || 'shortlisted';
                 applicant.status = revertToStatus;
                 
                 // Add to status history
                 applicant.statusHistory.push({
                   status: revertToStatus,
                   changedBy: cancelledBy,
                   changedAt: new Date(),
                   notes: `Status automatically reverted when interview was cancelled. Reason: ${reason}`,
                   previousStatus
                 });
                 
                 await jobWithApplicants.save();
                 console.log(`✅ Pipeline status reverted: ${previousStatus} → ${revertToStatus}`);
               } else {
                 console.log(`ℹ️ Pipeline status not reverted - candidate is at ${previousStatus} stage`);
               }
            }
          }
        } catch (pipelineError) {
          console.error('⚠️ Failed to revert pipeline status:', pipelineError.message);
          // Don't fail the interview cancellation if pipeline update fails
        }
      }
    }
    
    // Send cancellation email to candidate if requested
    try {
      // First, make sure we have fully populated data
      const populatedInterview = await interview.populate(['candidateId', 'interviewerId', 'jobId']);
      
      // Now check if we can send the email
      if (notifyParticipants && 
          populatedInterview.candidateId && 
          populatedInterview.candidateId.email) {
          
        console.log('Sending cancellation email to candidate:', populatedInterview.candidateId.email);
        
        // Get job information for email (decode HTML entities)
        const { decodeHtmlEntities } = require('../utils/htmlDecode');
        let jobTitle = 'Position';
        if (populatedInterview.jobId) {
          jobTitle = populatedInterview.jobId.title ? decodeHtmlEntities(populatedInterview.jobId.title) : 'Position';
        }
        
        // Format date and time for email using stored timezone (fallback to interviewer profile)
        const rawCancellationTimezone = populatedInterview.timezone || populatedInterview.interviewerId?.profile?.timezone || 'UTC';
        const cancellationTimezone = decodeHtmlEntities(rawCancellationTimezone);
        const scheduledDate = new Date(populatedInterview.scheduledAt);
        
        console.log('🕐 Cancellation timezone:', {
          raw: rawCancellationTimezone,
          decoded: cancellationTimezone
        });
        
        const interviewDate = scheduledDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: cancellationTimezone
        });
        
        const interviewTime = scheduledDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: cancellationTimezone,
          timeZoneName: 'short'
        });
        
        // Prepare interviewer info
        const interviewer = populatedInterview.interviewerId;
        const organizationName = interviewer?.organization?.name || 'SmartHR';
        
        console.log('Cancellation email data preparation:', {
          candidateEmail: populatedInterview.candidateId.email,
          candidateName: `${populatedInterview.candidateId.firstName || ''} ${populatedInterview.candidateId.lastName || ''}`,
          interviewDate,
          interviewTime,
          timezone: populatedInterview.timezone
        });
        
        // Prepare template data
        const templateData = {
          candidateName: `${populatedInterview.candidateId.firstName || ''} ${populatedInterview.candidateId.lastName || ''}`.trim() || 'Candidate',
          jobTitle,
          interviewDate,
          interviewTime,
          duration: populatedInterview.duration || 60,
          cancellationReason: reason,
          interviewerName: interviewer?.name || interviewer?.email || 'Hiring Manager',
          interviewerEmail: interviewer?.email || 'no-reply@smarthr.app',
          organizationName
        };
        
        // Send the cancellation email
        const emailService = require('../services/emailService');
        const emailServiceInstance = new emailService();
        await emailServiceInstance.sendInterviewCancellationEmail(
          populatedInterview.candidateId.email,
          templateData
        );
        
        console.log('✅ Cancellation email sent successfully');
      } else {
        console.log('⚠️ Skipping email - missing candidate email or notifyParticipants is false');
      }
    } catch (emailError) {
      console.error('⚠️ Failed to send cancellation email:', emailError.message);
      console.error('Error details:', emailError);
      // Don't fail the interview cancellation if email fails
    }
    
    // Create app notifications for organization members
    try {
      console.log('Creating cancellation notifications for organization members');
      
      // Get the fully populated interview data for notifications
      // Note: We may already have it from the email step, but let's make sure
      const populatedInterview = await Interview.findById(interview._id)
        .populate(['candidateId', 'interviewerId', 'jobId'])
        .exec();
      
      if (!populatedInterview) {
        throw new Error(`Interview ${interview._id} not found for notifications`);
      }
      
      console.log('Populated interview for notifications:', {
        id: populatedInterview._id,
        hasCandidate: !!populatedInterview.candidateId,
        hasInterviewer: !!populatedInterview.interviewerId,
        hasJob: !!populatedInterview.jobId
      });
      
      const candidateName = populatedInterview.candidateId 
        ? `${populatedInterview.candidateId.firstName || ''} ${populatedInterview.candidateId.lastName || ''}`.trim()
        : 'Candidate';
      
      // Get job title for notifications (decode HTML entities)
      const { decodeHtmlEntities } = require('../utils/htmlDecode');
      let jobTitle = 'Position';
      if (populatedInterview.jobId && populatedInterview.jobId.title) {
        jobTitle = decodeHtmlEntities(populatedInterview.jobId.title);
      }
      
      const notificationData = {
        _id: populatedInterview._id,
        candidateId: populatedInterview.candidateId,
        candidateName: candidateName,
        jobTitle: jobTitle,
        scheduledAt: populatedInterview.scheduledAt,
        duration: populatedInterview.duration,
        type: populatedInterview.type || 'video'
      };
      
      // Create notifications using the Notification model static method
      const Notification = require('../models/Notification');
      const result = await Notification.createInterviewCancelledNotification(
        cancelledBy,
        notificationData,
        reason
      );
      
      console.log('✅ Cancellation notifications created successfully:', {
        count: result?.length || 0
      });
      
    } catch (notificationError) {
      console.error('⚠️ Failed to create cancellation notifications:', notificationError.message);
      console.error('Error details:', notificationError);
      // Don't fail the interview cancellation if notifications fail
    }
    
    res.json({ 
      success: true, 
      message: 'Interview cancelled successfully',
      interview: await interview.populate('jobId candidateId interviewerId')
    });
    
  } catch (error) {
    console.error('Cancel interview error:', error);
    const errorResponse = handleInterviewError(error, 'cancelInterview');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Get interview details
const getInterviewDetails = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    // Use aggregation to filter by organization
    const interviews = await Interview.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(interviewId) } },
      {
        $lookup: {
          from: 'jobs',
          localField: 'jobId',
          foreignField: '_id',
          as: 'job'
        }
      },
      {
        $match: {
          'job.organization': new mongoose.Types.ObjectId(req.user.currentOrganization)
        }
      },
      {
        $lookup: {
          from: 'candidates',
          localField: 'candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'interviewerId',
          foreignField: '_id',
          as: 'interviewer'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'cancelledBy',
          foreignField: '_id',
          as: 'cancelledByUser'
        }
      },
      {
        $addFields: {
          jobId: { 
            $mergeObjects: [
              { $arrayElemAt: ['$job', 0] },
              { $arrayElemAt: [{ $map: { input: '$job', as: 'j', in: { title: '$$j.title', company: '$$j.company', description: '$$j.description' } } }, 0] }
            ]
          },
          candidateId: { 
            $mergeObjects: [
              { $arrayElemAt: ['$candidate', 0] },
              { $arrayElemAt: [{ $map: { input: '$candidate', as: 'c', in: { firstName: '$$c.firstName', lastName: '$$c.lastName', email: '$$c.email', phone: '$$c.phone', position: '$$c.position', location: '$$c.location', skills: '$$c.skills' } } }, 0] }
            ]
          },
          interviewerId: { 
            $mergeObjects: [
              { $arrayElemAt: ['$interviewer', 0] },
              { $arrayElemAt: [{ $map: { input: '$interviewer', as: 'i', in: { name: '$$i.name', email: '$$i.email' } } }, 0] }
            ]
          },
          cancelledBy: { 
            $mergeObjects: [
              { $arrayElemAt: ['$cancelledByUser', 0] },
              { $arrayElemAt: [{ $map: { input: '$cancelledByUser', as: 'cb', in: { name: '$$cb.name', email: '$$cb.email' } } }, 0] }
            ]
          }
        }
      },
      {
        $project: {
          job: 0,
          candidate: 0,
          interviewer: 0,
          cancelledByUser: 0
        }
      }
    ]);
    
    if (!interviews || interviews.length === 0) {
      return res.status(404).json({
        error: 'INTERVIEW_NOT_FOUND',
        message: 'Interview not found in your organization'
      });
    }
    
    res.json({ interview: interviews[0] });
    
  } catch (error) {
    console.error('Get interview details error:', error);
    const errorResponse = handleInterviewError(error, 'getInterviewDetails');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Debug endpoint to check notetaker data
const debugInterviewNotetaker = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId);
    
    if (!interview) {
      return res.status(404).json({
        error: 'Interview not found'
      });
    }
    
    console.log('🔍 Debug - Interview notetaker data:', {
      id: interview._id,
      notetakerEnabled: interview.notetakerEnabled,
      notetakerId: interview.notetakerId,
      notetakerStatus: interview.notetakerStatus,
      nylasEventId: interview.nylasEventId,
      meetingLink: interview.conferencing?.details?.url
    });
    
    res.json({
      interviewId: interview._id,
      notetakerEnabled: interview.notetakerEnabled,
      notetakerId: interview.notetakerId,
      notetakerStatus: interview.notetakerStatus,
      nylasEventId: interview.nylasEventId,
      meetingLink: interview.conferencing?.details?.url,
      debugTimestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Debug interview notetaker error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Generate AI Interview Summary
const generateAISummary = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    
    const interview = await Interview.findOne({ 
      _id: interviewId,
      // Note: Interview doesn't have organization field in current schema
    })
    .populate('candidateId', 'firstName lastName position experience email')
    .populate('jobId', 'title department level skills')
    .populate('interviewerId', 'profile.firstName profile.lastName email');
    
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Check if transcript exists
    if (!interview.transcript?.content) {
      return res.status(400).json({
        success: false,
        error: 'No transcript available for analysis'
      });
    }
    
    // Prepare interview data for AI analysis (decode HTML entities)
    const { decodeHtmlEntities } = require('../utils/htmlDecode');
    const interviewData = {
      transcript: interview.transcript.content,
      jobContext: interview.jobId ? {
        title: decodeHtmlEntities(interview.jobId.title),
        department: interview.jobId.department,
        level: interview.jobId.level ? decodeHtmlEntities(interview.jobId.level) : null,
        skills: interview.jobId.skills ? decodeHtmlEntities(interview.jobId.skills) : null
      } : null,
      candidateInfo: {
        name: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
        position: interview.candidateId.position,
        experience: interview.candidateId.experience,
        email: interview.candidateId.email
      },
      interviewType: interview.type,
      duration: interview.duration
    };
    
    console.log('🎯 Generating AI summary for interview:', interviewId);
    
    // Generate AI summary using Azure OpenAI
    const azureService = new AzureOpenAIService();
    const summaryResult = await azureService.generateInterviewSummary(interviewData);
    
    if (!summaryResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate AI summary',
        details: summaryResult.error
      });
    }
    
    // Update interview with AI summary
    interview.aiInterviewSummary = {
      generated: true,
      generatedAt: new Date(),
      content: summaryResult.summary.summary,
      keyInsights: summaryResult.summary.keyInsights,
      candidateStrengths: summaryResult.summary.candidateStrengths,
      candidateConcerns: summaryResult.summary.candidateConcerns,
      recommendation: summaryResult.summary.recommendation,
      confidence: summaryResult.summary.confidence,
      methodology: summaryResult.summary.methodology
    };
    
    await interview.save();
    
    console.log('✅ AI summary generated successfully for interview:', interviewId);
    
    res.json({
      success: true,
      message: 'AI summary generated successfully',
      summary: interview.aiInterviewSummary
    });
    
  } catch (error) {
    console.error('Generate AI summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error generating AI summary',
      details: error.message
    });
  }
};

// Get Interview Comments
const getInterviewComments = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    const { includeReplies = true, visibility = 'team' } = req.query;
    
    // Verify interview exists
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Get comments for the interview
    const comments = await InterviewComment.getForInterview(interviewId, {
      includeReplies: includeReplies === 'true',
      visibility: Array.isArray(visibility) ? visibility : visibility.split(','),
      limit: 100
    });
    
    // Get comment analytics
    const analytics = await InterviewComment.getAnalytics(interviewId);
    
    res.json({
      success: true,
      comments,
      analytics: analytics[0] || {
        totalComments: 0,
        avgRating: null,
        commentTypeDistribution: {},
        sentimentDistribution: {}
      }
    });
    
  } catch (error) {
    console.error('Get interview comments error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching comments',
      details: error.message
    });
  }
};

// Add Interview Comment
const addInterviewComment = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;
    
    const {
      content,
      commentType = 'general',
      rating,
      categories = [],
      visibility = 'team',
      parentCommentId
    } = req.body;
    
    // Validate required fields
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Comment content is required'
      });
    }
    
    // Verify interview exists
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const authorName = user.profile ? 
      `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim() || user.email :
      user.email;
    
    // Create new comment
    const comment = new InterviewComment({
      interviewId,
      authorId: userId,
      authorName,
      authorRole: user.role || 'team_member',
      content: content.trim(),
      commentType,
      rating,
      categories,
      visibility,
      parentCommentId,
      organization: organizationId
    });
    
    await comment.save();
    
    // Update interview's team comments array
    if (!interview.teamComments) {
      interview.teamComments = [];
    }
    interview.teamComments.push(comment._id);
    await interview.save();
    
    // Populate comment data for response
    await comment.populate('authorId', 'profile.firstName profile.lastName email');
    
    console.log('✅ Comment added to interview:', interviewId, 'by user:', userId);
    
    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment
    });
    
  } catch (error) {
    console.error('Add interview comment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error adding comment',
      details: error.message
    });
  }
};

// Update Interview Comment
const updateInterviewComment = async (req, res) => {
  try {
    const { interviewId, commentId } = req.params;
    const userId = req.user.id;
    const { content, commentType, rating, categories, visibility } = req.body;
    
    // Find the comment
    const comment = await InterviewComment.findOne({
      _id: commentId,
      interviewId: interviewId
    });
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found'
      });
    }
    
    // Check if user can edit this comment
    if (!comment.canEdit(userId)) {
      return res.status(403).json({
        success: false,
        error: 'You can only edit your own comments'
      });
    }
    
    // Store previous content for edit history
    const previousContent = comment.content;
    
    // Update comment fields
    if (content !== undefined) comment.content = content.trim();
    if (commentType !== undefined) comment.commentType = commentType;
    if (rating !== undefined) comment.rating = rating;
    if (categories !== undefined) comment.categories = categories;
    if (visibility !== undefined) comment.visibility = visibility;
    
    // Add to edit history
    comment.isEdited = true;
    comment.editHistory.push({
      editedAt: new Date(),
      previousContent,
      editReason: 'Updated by user'
    });
    
    await comment.save();
    
    // Populate comment data for response
    await comment.populate('authorId', 'profile.firstName profile.lastName email');
    
    console.log('✅ Comment updated:', commentId, 'by user:', userId);
    
    res.json({
      success: true,
      message: 'Comment updated successfully',
      comment
    });
    
  } catch (error) {
    console.error('Update interview comment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating comment',
      details: error.message
    });
  }
};

// Delete Interview Comment
const deleteInterviewComment = async (req, res) => {
  try {
    const { interviewId, commentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Find the comment
    const comment = await InterviewComment.findOne({
      _id: commentId,
      interviewId: interviewId
    });
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found'
      });
    }
    
    // Check if user can delete this comment
    if (!comment.canDelete(userId, userRole)) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own comments or you must be an admin'
      });
    }
    
    // Soft delete - mark as deleted instead of removing
    comment.status = 'deleted';
    await comment.save();
    
    // Remove from interview's team comments array
    const interview = await Interview.findById(interviewId);
    if (interview && interview.teamComments) {
      interview.teamComments = interview.teamComments.filter(
        id => id.toString() !== commentId
      );
      await interview.save();
    }
    
    console.log('✅ Comment deleted:', commentId, 'by user:', userId);
    
    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete interview comment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting comment',
      details: error.message
    });
  }
};

// Get Questions for Interview Feedback
const getInterviewQuestions = async (req, res) => {
  try {
    const { interviewId } = req.params;
    console.log('🔍 [FEEDBACK-QUESTIONS] Fetching questions for interview:', interviewId);
    
    // Get interview with candidate, job, and stage information
    const interview = await Interview.findById(interviewId)
      .populate('candidateId', 'firstName lastName email resumeUrl')
      .populate('jobId', 'title description organization')
      .populate('stageId', 'name description')
      .populate('notifications.selectedQuestions');
    
    console.log('📋 [FEEDBACK-QUESTIONS] Interview found:', !!interview);

    if (!interview) {
      console.log('❌ [FEEDBACK-QUESTIONS] Interview not found:', interviewId);
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }

    console.log('📋 [FEEDBACK-QUESTIONS] Interview jobId:', interview.jobId?._id);
    console.log('👤 [FEEDBACK-QUESTIONS] Candidate:', interview.candidateId?.firstName, interview.candidateId?.lastName);
    console.log('🔧 [FEEDBACK-QUESTIONS] Interview notifications:', {
      sendQuestionsToInterviewers: interview.notifications?.sendQuestionsToInterviewers,
      selectedQuestionsCount: interview.notifications?.selectedQuestions?.length || 0,
      hasSelectedQuestions: !!(interview.notifications?.selectedQuestions && interview.notifications.selectedQuestions.length > 0)
    });

    // Get questions for the job - only show if explicitly selected by interviewer
    const InterviewQuestion = require('../models/InterviewQuestion');
    let questions = [];
    
    // Check if interview has selected questions AND feature is enabled
    const selectedQuestions = interview.notifications?.selectedQuestions;
    const shouldShowQuestions = interview.notifications?.sendQuestionsToInterviewers && 
                               selectedQuestions && 
                               selectedQuestions.length > 0;
    
    if (shouldShowQuestions) {
      // Get only the selected questions
      console.log('📋 [FEEDBACK-QUESTIONS] Using selected questions:', selectedQuestions.length);
      questions = await InterviewQuestion.find({
        _id: { $in: selectedQuestions },
        isActive: true
      }).sort({ order: 1, createdAt: 1 });
    } else {
      // Return empty array - questions only show if explicitly selected
      console.log('📋 [FEEDBACK-QUESTIONS] No questions selected or feature not enabled, returning empty array');
      questions = [];
    }
    
    console.log('❓ [FEEDBACK-QUESTIONS] Questions found:', questions?.length || 0);
    
    // Prepare candidate info
    const candidateInfo = interview.candidateId ? {
      id: interview.candidateId._id,
      name: `${interview.candidateId.firstName || ''} ${interview.candidateId.lastName || ''}`.trim(),
      email: interview.candidateId.email,
      resumeUrl: interview.candidateId.resumeUrl
    } : null;

    // Decode HTML entities helper
    const { decodeHtmlEntities } = require('../utils/htmlDecode');
    
    // Prepare job info (with HTML entities decoded)
    const jobInfo = interview.jobId ? {
      id: interview.jobId._id,
      title: decodeHtmlEntities(interview.jobId.title),
      description: decodeHtmlEntities(interview.jobId.description)
    } : null;

    // Prepare stage info
    const stageInfo = interview.stageId ? {
      id: interview.stageId._id,
      name: interview.stageId.name,
      description: interview.stageId.description
    } : null;

    // Prepare interview info with stage details
    const interviewInfo = {
      id: interview._id,
      title: interview.title,
      scheduledAt: interview.scheduledAt,
      duration: interview.duration,
      type: interview.type,
      status: interview.status,
      jobTitle: interview.jobId?.title ? decodeHtmlEntities(interview.jobId.title) : null,
      // Include stage information
      stageId: interview.stageId,
      stageName: interview.stageName,
      stageOrder: interview.stageOrder
    };

    // Get feedback form configuration (stage → job → org hierarchy)
    let feedbackFormConfig = null;
    try {
      const Job = require('../models/Job');
      const InterviewStage = require('../models/InterviewStage');
      const FeedbackFormTemplate = require('../models/FeedbackFormTemplate');
      const CustomField = require('../models/CustomField');
      
      console.log('🔍 [FEEDBACK-CONFIG] Loading config for interview:', interviewId);
      console.log('🔍 [FEEDBACK-CONFIG] Stage ID:', interview.stageId);
      console.log('🔍 [FEEDBACK-CONFIG] Job ID:', interview.jobId?._id);
      
      let template = null;
      let finalConfig = null;
      let configSource = null;
      
      // PRIORITY 1: Check if interview has a stage with its own template
      if (interview.stageId) {
        const stage = await InterviewStage.findById(interview.stageId);
        
        if (stage?.feedbackFormConfig?.templateId) {
          console.log('✅ [FEEDBACK-CONFIG] Using STAGE template for stage:', stage.name);
          template = await FeedbackFormTemplate.findById(stage.feedbackFormConfig.templateId)
            .populate('customFields.customFieldRef');
          
          if (template) {
            configSource = 'stage';
            finalConfig = {
              systemFields: template.systemFields || [],
              customFields: template.customFields || []
            };
            
            // Apply stage-specific overrides if exist
            if (stage.feedbackFormConfig?.overrides) {
              console.log('📝 [FEEDBACK-CONFIG] Applying stage-specific overrides');
              if (stage.feedbackFormConfig.overrides.systemFields?.length > 0) {
                finalConfig.systemFields = stage.feedbackFormConfig.overrides.systemFields;
              }
              if (stage.feedbackFormConfig.overrides.customFields?.length > 0) {
                finalConfig.customFields = stage.feedbackFormConfig.overrides.customFields;
              }
            }
          }
        }
      }
      
      // PRIORITY 2: Fallback to job-level template if no stage template
      if (!finalConfig) {
        console.log('⚠️ [FEEDBACK-CONFIG] No stage template, checking JOB template');
        const job = await Job.findById(interview.jobId?._id);
        
        console.log('🔍 [FEEDBACK-CONFIG] Job found:', !!job);
        console.log('🔍 [FEEDBACK-CONFIG] Job has feedbackFormConfig:', !!job?.feedbackFormConfig);
        console.log('🔍 [FEEDBACK-CONFIG] useTemplate:', job?.feedbackFormConfig?.useTemplate);
        console.log('🔍 [FEEDBACK-CONFIG] templateId:', job?.feedbackFormConfig?.templateId);
        console.log('🔍 [FEEDBACK-CONFIG] Has overrides:', !!job?.feedbackFormConfig?.overrides);
        if (job?.feedbackFormConfig?.overrides) {
          console.log('🔍 [FEEDBACK-CONFIG] Overrides systemFields count:', job.feedbackFormConfig.overrides.systemFields?.length || 0);
          console.log('🔍 [FEEDBACK-CONFIG] Overrides customFields count:', job.feedbackFormConfig.overrides.customFields?.length || 0);
        }
        
        if (job) {
          // Check if job has custom configuration
          if (job.feedbackFormConfig?.useTemplate === false && job.feedbackFormConfig?.overrides) {
            // Job uses completely custom overrides (no template)
            configSource = 'job_override';
            finalConfig = {
              systemFields: job.feedbackFormConfig.overrides.systemFields || [],
              customFields: job.feedbackFormConfig.overrides.customFields || []
            };
          } else if (job.feedbackFormConfig?.templateId) {
            // Job uses a specific template (possibly with overrides)
            configSource = 'job';
            const template = await FeedbackFormTemplate.findById(job.feedbackFormConfig.templateId)
              .populate('customFields.customFieldRef');
            if (template) {
              finalConfig = {
                systemFields: template.systemFields || [],
                customFields: template.customFields || []
              };
              
              // Apply overrides if they exist (merge with template)
              if (job.feedbackFormConfig?.overrides) {
                console.log('📝 [FEEDBACK-CONFIG] Applying job-specific overrides to template');
                
                // Override system fields
                if (job.feedbackFormConfig.overrides.systemFields && 
                    job.feedbackFormConfig.overrides.systemFields.length > 0) {
                  console.log('   - Overriding system fields with', job.feedbackFormConfig.overrides.systemFields.length, 'custom configs');
                  finalConfig.systemFields = job.feedbackFormConfig.overrides.systemFields;
                  console.log('   - System fields after override:', JSON.stringify(finalConfig.systemFields, null, 2));
                }
                
                // Override custom fields
                if (job.feedbackFormConfig.overrides.customFields && 
                    job.feedbackFormConfig.overrides.customFields.length > 0) {
                  console.log('   - Overriding custom fields with', job.feedbackFormConfig.overrides.customFields.length, 'custom configs');
                  finalConfig.customFields = job.feedbackFormConfig.overrides.customFields;
                }
              }
            }
          } else {
            // Use organization default template
            configSource = 'organization';
            const Organization = require('../models/Organization');
            const org = await Organization.findById(job.organization);
            
            let defaultTemplate = null;
            if (org?.settings?.defaultFeedbackTemplate) {
              defaultTemplate = await FeedbackFormTemplate.findById(org.settings.defaultFeedbackTemplate)
                .populate('customFields.customFieldRef');
            }
            
            // If no default template exists, create one automatically
            if (!defaultTemplate && org) {
              console.log(`📋 No default template for org ${org._id}, creating one...`);
              const SYSTEM_FIELDS = [
                { fieldId: 'name', fieldType: 'system', isVisible: true, isRequired: true, order: 1, label: 'Interviewer Name' },
                { fieldId: 'email', fieldType: 'system', isVisible: true, isRequired: true, order: 2, label: 'Interviewer Email' },
                { fieldId: 'overallRating', fieldType: 'system', isVisible: true, isRequired: true, order: 3, label: 'Overall Rating' },
                { fieldId: 'technicalRating', fieldType: 'system', isVisible: true, isRequired: false, order: 4, label: 'Technical Skills' },
                { fieldId: 'communicationRating', fieldType: 'system', isVisible: true, isRequired: false, order: 5, label: 'Communication Skills' },
                { fieldId: 'culturalRating', fieldType: 'system', isVisible: true, isRequired: false, order: 6, label: 'Cultural Fit' },
                { fieldId: 'generalFeedback', fieldType: 'system', isVisible: true, isRequired: false, order: 7, label: 'General Comments' },
              ];
              
              defaultTemplate = new FeedbackFormTemplate({
                organization: org._id,
                name: 'Default Interview Feedback',
                description: 'Standard feedback form for all interviews.',
                isDefault: true,
                systemFields: SYSTEM_FIELDS,
                customFields: [],
                createdBy: org.owner // Use org owner as creator
              });
              
              await defaultTemplate.save();
              
              // Set as organization default
              org.settings = org.settings || {};
              org.settings.defaultFeedbackTemplate = defaultTemplate._id;
              await org.save();
              
              console.log(`✅ Created default template ${defaultTemplate._id} for org ${org._id}`);
            }
            
            if (defaultTemplate) {
              finalConfig = {
                systemFields: defaultTemplate.systemFields || [],
                customFields: defaultTemplate.customFields || []
              };
            }
          }
        }
      }
      
      console.log('📊 [FEEDBACK-CONFIG] Config source:', configSource);

      // If we have config, populate custom field details
      if (finalConfig) {
        const populatedCustomFields = [];
        for (const fieldConfig of finalConfig.customFields) {
          // Populate ALL custom fields, frontend will filter by isVisible
          // Check both customFieldRef (from template) and customFieldId (from job overrides)
          const fieldId = fieldConfig.customFieldRef || fieldConfig.customFieldId;
          
          // Determine if we need to fetch from database
          // If fieldId is already a full object with 'type' property, use it
          // Otherwise, fetch from database
          let customField = null;
          if (fieldId) {
            if (typeof fieldId === 'object' && fieldId.type) {
              // Already a populated object with full data
              customField = fieldId;
            } else {
              // It's an ID (string or ObjectId), fetch from database
              customField = await CustomField.findById(fieldId);
            }
          }
          
          if (customField) {
            // Convert Mongoose document to plain object
            const customFieldObj = customField.toObject ? customField.toObject() : customField;
            const fieldConfigObj = fieldConfig.toObject ? fieldConfig.toObject() : fieldConfig;
            
            populatedCustomFields.push({
              fieldId: fieldConfigObj.customFieldId || fieldConfigObj.fieldId,
              fieldType: 'custom',
              isVisible: fieldConfigObj.isVisible !== undefined ? fieldConfigObj.isVisible : true,
              isRequired: fieldConfigObj.isRequired || false,
              order: fieldConfigObj.order || 0,
              label: fieldConfigObj.label || customFieldObj.label,
              customField: {
                _id: customFieldObj._id,
                name: customFieldObj.name,
                label: customFieldObj.label,
                description: customFieldObj.description,
                type: customFieldObj.type,
                options: customFieldObj.options,
                validation: customFieldObj.validation,
                ratingConfig: customFieldObj.ratingConfig
              }
            });
          }
        }
        
        // Serialize system fields to plain objects
        const serializedSystemFields = finalConfig.systemFields.map(f => {
          const fieldObj = f.toObject ? f.toObject() : f;
          return {
            fieldId: fieldObj.fieldId,
            fieldType: fieldObj.fieldType || 'system',
            isVisible: fieldObj.isVisible !== undefined ? fieldObj.isVisible : true,
            isRequired: fieldObj.isRequired || false,
            order: fieldObj.order || 0,
            label: fieldObj.label
          };
        });
        
        feedbackFormConfig = {
          systemFields: serializedSystemFields, // Send ALL fields, frontend will filter by isVisible
          customFields: populatedCustomFields // Send ALL fields, frontend will filter by isVisible
        };
        
        console.log('✅ [FEEDBACK-CONFIG] Final config created:');
        console.log('   - Total system fields:', feedbackFormConfig.systemFields.length);
        console.log('   - Total custom fields:', feedbackFormConfig.customFields.length);
        
        const visibleSystemFields = feedbackFormConfig.systemFields.filter(f => f.isVisible !== false).length;
        const visibleCustomFields = feedbackFormConfig.customFields.filter(f => f.isVisible !== false).length;
        console.log(`   - Visible system fields: ${visibleSystemFields}/${feedbackFormConfig.systemFields.length}`);
        console.log(`   - Visible custom fields: ${visibleCustomFields}/${feedbackFormConfig.customFields.length}`);
        
        console.log('   System fields:');
        feedbackFormConfig.systemFields.forEach(f => {
          console.log(`     - ${f.fieldId}: visible=${f.isVisible}, required=${f.isRequired}`);
        });
        if (feedbackFormConfig.customFields.length > 0) {
          console.log('   Custom fields:');
          feedbackFormConfig.customFields.forEach(f => {
            console.log(`     - ${f.customField?.name}: visible=${f.isVisible}, required=${f.isRequired}`);
          });
        }
      }
    } catch (configError) {
      console.error('⚠️ [FEEDBACK-QUESTIONS] Error loading feedback form config:', configError);
      // Don't fail the entire request if config loading fails
    }
    
    console.log('📤 [FEEDBACK-RESPONSE] Sending response with feedbackFormConfig:', !!feedbackFormConfig);
    if (feedbackFormConfig) {
      console.log('📤 [FEEDBACK-RESPONSE] Config has system fields:', feedbackFormConfig.systemFields?.length || 0);
      console.log('📤 [FEEDBACK-RESPONSE] Config has custom fields:', feedbackFormConfig.customFields?.length || 0);
    } else {
      console.log('⚠️ [FEEDBACK-RESPONSE] WARNING: feedbackFormConfig is null/undefined!');
    }
    
    res.json({
      success: true,
      questions: questions || [],
      candidateInfo,
      jobInfo,
      stageInfo,
      interviewInfo,
      feedbackFormConfig
    });
    
  } catch (error) {
    console.error('❌ [FEEDBACK-QUESTIONS] Get interview questions error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching questions'
    });
  }
};

// Get aggregated feedback summary (per-assessor and totals)
const getFeedbackSummary = async (req, res) => {
  try {
    const { interviewId } = req.params;

    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ success: false, error: 'Interview not found' });
    }

    // Fetch all feedback comments for this interview
    const comments = await InterviewComment.find({
      interviewId,
      commentType: 'feedback'
    }).lean();


    // Build question map for labels
    const questionIds = [...new Set(comments.filter(c => c.questionId).map(c => c.questionId.toString()))];
    let questionMap = {};
    if (questionIds.length > 0) {
      const InterviewQuestion = require('../models/InterviewQuestion');
      const qs = await InterviewQuestion.find({ _id: { $in: questionIds } }).select('_id question').lean();
      questionMap = Object.fromEntries(qs.map(q => [q._id.toString(), q.question]));
    }

    const totals = {
      totalAssessors: 0,
      totalFeedbackCount: comments.length,
      averageRatingOverall: 0,
      perQuestion: {},
      generalCount: comments.filter(c => !c.questionId).length,
    };

    const ratings = [];
    const perAssessor = {};

    for (const c of comments) {
      const authorKey = c.authorId ? c.authorId.toString() : `public:${c.publicFeedback?.email || c.authorName}`;
      if (!perAssessor[authorKey]) {
        perAssessor[authorKey] = {
          authorId: c.authorId || null,
          name: c.authorName,
          role: c.authorRole,
          email: c.publicFeedback?.email || undefined,
          total: 0,
          averageRating: 0,
          ratings: [],
          perQuestion: {},
          generalCount: 0,
        };
      }
      const entry = perAssessor[authorKey];
      entry.total += 1;
      if (c.rating?.overall) {
        entry.ratings.push(c.rating.overall);
        ratings.push(c.rating.overall);
      }
      if (c.questionId) {
        const qid = c.questionId.toString();
        if (!entry.perQuestion[qid]) entry.perQuestion[qid] = { count: 0, ratings: [] };
        entry.perQuestion[qid].count += 1;
        if (c.rating?.overall) entry.perQuestion[qid].ratings.push(c.rating.overall);

        if (!totals.perQuestion[qid]) totals.perQuestion[qid] = { count: 0, ratings: [] };
        totals.perQuestion[qid].count += 1;
        if (c.rating?.overall) totals.perQuestion[qid].ratings.push(c.rating.overall);
      } else {
        entry.generalCount += 1;
      }
    }

    // finalize averages
    Object.values(perAssessor).forEach((assessor) => {
      assessor.averageRating = assessor.ratings.length > 0
        ? Math.round((assessor.ratings.reduce((a, b) => a + b, 0) / assessor.ratings.length) * 100) / 100
        : 0;
      Object.keys(assessor.perQuestion).forEach((qid) => {
        const obj = assessor.perQuestion[qid];
        obj.averageRating = obj.ratings.length > 0
          ? Math.round((obj.ratings.reduce((a, b) => a + b, 0) / obj.ratings.length) * 100) / 100
          : 0;
        obj.question = questionMap[qid] || qid;
        delete obj.ratings;
      });
      delete assessor.ratings;
    });

    totals.totalAssessors = Object.keys(perAssessor).length;
    totals.averageRatingOverall = ratings.length > 0
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
      : 0;
    Object.keys(totals.perQuestion).forEach((qid) => {
      const obj = totals.perQuestion[qid];
      obj.averageRating = obj.ratings.length > 0
        ? Math.round((obj.ratings.reduce((a, b) => a + b, 0) / obj.ratings.length) * 100) / 100
        : 0;
      obj.question = questionMap[qid] || qid;
      delete obj.ratings;
    });

    return res.json({ success: true, totals, perAssessor });
  } catch (error) {
    console.error('Get feedback summary error:', error);
    return res.status(500).json({ success: false, error: 'Server error fetching feedback summary' });
  }
};

// Add Question-Based Feedback (Internal)
const addQuestionFeedback = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;
    
    const {
      questionId,
      content,
      rating,
      technicalRating,
      communicationRating,
      culturalRating,
      isGeneral = false
    } = req.body;
    
    // Validate required fields
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Feedback content is required'
      });
    }

    // If not general feedback, validate questionId
    if (!isGeneral && !questionId) {
      return res.status(400).json({
        success: false,
        error: 'Question ID is required for question-specific feedback'
      });
    }
    
    // Verify interview exists
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const authorName = user.profile ? 
      `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim() || user.email :
      user.email;
    
    // Create new question-based comment with stage information
    const comment = new InterviewComment({
      interviewId,
      questionId: isGeneral ? null : questionId,
      authorId: userId,
      authorName,
      authorRole: user.role || 'team_member',
      content: content.trim(),
      commentType: 'feedback',
      rating: {
        overall: rating || undefined,
        technical: technicalRating || undefined,
        communication: communicationRating || undefined,
        cultural: culturalRating || undefined
      },
      categories: ['question_feedback'],
      visibility: 'team',
      organization: organizationId,
      // Add stage information from the interview
      stageId: interview.stageId || undefined,
      stageName: interview.stageName || undefined,
      stageOrder: interview.stageOrder || undefined
    });
    
    await comment.save();
    
    // Update interview's team comments array
    if (!interview.teamComments) {
      interview.teamComments = [];
    }
    interview.teamComments.push(comment._id);
    await interview.save();
    
    // NEW: Evaluate and save calculated fields for internal feedback
    let calculatedFieldsCreated = 0;
    try {
      const job = await Job.findById(interview.jobId);
      if (job) {
        const calculatedFields = await getCalculatedFieldsFromTemplate(job);
        
        if (calculatedFields.length > 0) {
          console.log(`📊 Evaluating ${calculatedFields.length} calculated fields for internal user...`);
          
          // Gather field values from this comment
          const generalFeedback = {
            rating: rating,
            technicalRating: technicalRating,
            communicationRating: communicationRating,
            culturalRating: culturalRating
          };
          
          // Get any existing custom field responses from this user for this interview
          const existingCustomResponses = await CustomFieldResponse.find({
            interviewId: interviewId,
            respondentId: userId
          });
          
          // Build custom field values object
          const customFieldValues = {};
          existingCustomResponses.forEach(response => {
            if (response.fieldType === 'rating' && typeof response.responseValue === 'number') {
              customFieldValues[response.customFieldId.toString()] = response.responseValue;
            }
          });
          
          const fieldValues = gatherFieldValues(generalFeedback, customFieldValues);
          
          for (const calcField of calculatedFields) {
            try {
              const result = evaluateFormula(calcField.calculationFormula, fieldValues);
              
              if (result !== null) {
                await CustomFieldResponse.create({
                  organization: organizationId,
                  interviewId: interviewId,
                  interviewCommentId: comment._id,
                  customFieldId: calcField._id,
                  fieldName: calcField.name,
                  fieldLabel: calcField.label,
                  fieldType: 'calculated',
                  responseValue: result,
                  calculationFormula: calcField.calculationFormula,
                  sourceFieldValues: fieldValues,
                  respondentType: 'internal',
                  respondentId: userId,
                  respondentName: authorName,
                  respondentEmail: user.email
                });
                calculatedFieldsCreated++;
                console.log(`  ✅ Calculated field "${calcField.label}": ${result}`);
              }
            } catch (error) {
              console.error(`  ❌ Error evaluating calculated field "${calcField.label}":`, error.message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing calculated fields for internal feedback:', error);
      // Don't fail the entire request if calculated fields fail
    }
    
    // Populate comment data for response
    await comment.populate([
      { path: 'authorId', select: 'profile.firstName profile.lastName email' },
      { path: 'questionId', select: 'question type category' }
    ]);
    
    console.log('✅ Question feedback added to interview:', interviewId, 'by user:', userId, 'calculated fields:', calculatedFieldsCreated);
    
    res.status(201).json({
      success: true,
      message: 'Question feedback added successfully',
      comment
    });
    
  } catch (error) {
    console.error('Add question feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error adding feedback',
      details: error.message
    });
  }
};

// Add Bulk Public Feedback (New - handles all feedback in one request)
const addBulkPublicFeedback = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const {
      name,
      email,
      generalFeedback,
      questionFeedback,
      customFieldResponses  // NEW: Custom field responses
    } = req.body;
    
    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Check if there's any feedback to submit
    const hasGeneralFeedback = generalFeedback?.content?.trim().length > 0;
    const hasQuestionFeedback = questionFeedback && Object.values(questionFeedback).some(q => q.content?.trim().length > 0);
    
    if (!hasGeneralFeedback && !hasQuestionFeedback) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least some feedback'
      });
    }
    
    // Verify interview exists and get organization info
    const interview = await Interview.findById(interviewId).populate('jobId');
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }

    // Get organization from the job
    const organizationId = interview.jobId?.organization;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Unable to determine organization for this interview'
      });
    }
    
    const savedComments = [];
    
    // Submit general feedback if provided
    if (hasGeneralFeedback) {
      const generalComment = new InterviewComment({
        interviewId,
        questionId: null,
        authorId: null,
        authorName: name.trim(),
        authorRole: 'public',
        content: generalFeedback.content.trim(),
        commentType: 'feedback',
        rating: {
          overall: generalFeedback.rating || undefined,
          technical: generalFeedback.technicalRating || undefined,
          communication: generalFeedback.communicationRating || undefined,
          cultural: generalFeedback.culturalRating || undefined
        },
        categories: ['public_feedback'],
        visibility: 'team',
        publicFeedback: {
          email: email.toLowerCase().trim(),
          name: name.trim(),
          isVerified: false
        },
        organization: organizationId
      });
      
      await generalComment.save();
      savedComments.push(generalComment._id);
    }
    
    // Submit question-specific feedback if provided
    if (hasQuestionFeedback) {
      for (const [questionId, feedback] of Object.entries(questionFeedback)) {
        if (feedback.content?.trim().length > 0) {
          const questionComment = new InterviewComment({
            interviewId,
            questionId: questionId,
            authorId: null,
            authorName: name.trim(),
            authorRole: 'public',
            content: feedback.content.trim(),
            commentType: 'feedback',
            rating: {
              overall: feedback.rating || undefined
            },
            categories: ['public_feedback'],
            visibility: 'team',
            publicFeedback: {
              email: email.toLowerCase().trim(),
              name: name.trim(),
              isVerified: false
            },
            organization: organizationId
          });
          
          await questionComment.save();
          savedComments.push(questionComment._id);
        }
      }
    }
    
    // Update interview's team comments array
    if (!interview.teamComments) {
      interview.teamComments = [];
    }
    interview.teamComments.push(...savedComments);
    await interview.save();
    
    // NEW: Save custom field responses if provided
    let customFieldResponsesCreated = 0;
    if (customFieldResponses && typeof customFieldResponses === 'object') {
      const CustomFieldResponse = require('../models/CustomFieldResponse');
      const CustomField = require('../models/CustomField');
      
      const responsesToSave = [];
      
      for (const [customFieldId, responseValue] of Object.entries(customFieldResponses)) {
        // Skip empty responses
        if (responseValue === null || responseValue === undefined || responseValue === '') {
          continue;
        }
        
        // Get custom field details
        const customField = await CustomField.findById(customFieldId);
        if (!customField) {
          console.warn(`Custom field ${customFieldId} not found, skipping response`);
          continue;
        }
        
        // Use the general feedback comment ID as the reference
        const commentId = savedComments[0]; // Link to general feedback comment
        
        responsesToSave.push({
          organization: organizationId,
          interviewId: interviewId,
          interviewCommentId: commentId,
          customFieldId: customFieldId,
          fieldName: customField.name,
          fieldLabel: customField.label,
          fieldType: customField.type,
          responseValue: responseValue,
          respondentType: 'public',
          respondentId: null,
          respondentName: name.trim(),
          respondentEmail: email.toLowerCase().trim()
        });
      }
      
      // Bulk create custom field responses
      if (responsesToSave.length > 0) {
        await CustomFieldResponse.bulkCreateResponses(responsesToSave);
        customFieldResponsesCreated = responsesToSave.length;
        console.log(`✅ Created ${customFieldResponsesCreated} custom field responses`);
      }
    }
    
    // NEW: Evaluate and save calculated fields
    let calculatedFieldsCreated = 0;
    try {
      const calculatedFields = await getCalculatedFieldsFromTemplate(interview.jobId);
      
      if (calculatedFields.length > 0) {
        console.log(`📊 Evaluating ${calculatedFields.length} calculated fields...`);
        const fieldValues = gatherFieldValues(generalFeedback, customFieldResponses);
        
        for (const calcField of calculatedFields) {
          try {
            const result = evaluateFormula(calcField.calculationFormula, fieldValues);
            
            if (result !== null) {
              await CustomFieldResponse.create({
                organization: organizationId,
                interviewId: interviewId,
                interviewCommentId: savedComments[0], // Link to general feedback comment
                customFieldId: calcField._id,
                fieldName: calcField.name,
                fieldLabel: calcField.label,
                fieldType: 'calculated',
                responseValue: result,
                calculationFormula: calcField.calculationFormula,
                sourceFieldValues: fieldValues,
                respondentType: 'public',
                respondentId: null,
                respondentName: name.trim(),
                respondentEmail: email.toLowerCase().trim()
              });
              calculatedFieldsCreated++;
              console.log(`  ✅ Calculated field "${calcField.label}": ${result}`);
            } else {
              console.warn(`  ⚠️ Calculated field "${calcField.label}" evaluation returned null`);
            }
          } catch (error) {
            console.error(`  ❌ Error evaluating calculated field "${calcField.label}":`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('Error processing calculated fields:', error);
      // Don't fail the entire request if calculated fields fail
    }
    
    console.log('✅ Bulk public feedback added to interview:', interviewId, 'by:', email, 'comments:', savedComments.length, 'custom responses:', customFieldResponsesCreated, 'calculated:', calculatedFieldsCreated);
    
    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      commentsCreated: savedComments.length,
      customFieldResponsesCreated: customFieldResponsesCreated
    });
    
  } catch (error) {
    console.error('Add bulk public feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error adding feedback',
      details: error.message
    });
  }
};

// Add Public Feedback (Legacy - single feedback item)
const addPublicFeedback = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const {
      name,
      email,
      questionId,
      content,
      rating,
      technicalRating,
      communicationRating,
      culturalRating,
      isGeneral = false
    } = req.body;
    
    // Validate required fields for public feedback
    if (!name || !email || !content) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and content are required for public feedback'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }
    
    // Verify interview exists and get organization info
    const interview = await Interview.findById(interviewId).populate('jobId');
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }

    // Get organization from the job
    const organizationId = interview.jobId?.organization;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Unable to determine organization for this interview'
      });
    }
    
    // Create new public feedback comment with stage information
    const comment = new InterviewComment({
      interviewId,
      questionId: isGeneral ? null : questionId,
      authorId: null, // No user ID for public feedback
      authorName: name.trim(),
      authorRole: 'public',
      content: content.trim(),
      commentType: 'feedback',
      rating: {
        overall: rating || undefined,
        technical: technicalRating || undefined,
        communication: communicationRating || undefined,
        cultural: culturalRating || undefined
      },
      categories: ['public_feedback'], // Use the new valid enum value
      visibility: 'team',
      publicFeedback: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        isVerified: false // Can add email verification later
      },
      organization: organizationId,
      // Add stage information from the interview
      stageId: interview.stageId || undefined,
      stageName: interview.stageName || undefined,
      stageOrder: interview.stageOrder || undefined
    });
    
    await comment.save();
    
    // Update interview's team comments array
    if (!interview.teamComments) {
      interview.teamComments = [];
    }
    interview.teamComments.push(comment._id);
    await interview.save();
    
    // Populate comment data for response
    await comment.populate([
      { path: 'questionId', select: 'question type category' }
    ]);
    
    console.log('✅ Public feedback added to interview:', interviewId, 'by:', email);
    
    res.status(201).json({
      success: true,
      message: 'Public feedback submitted successfully',
      comment
    });
    
  } catch (error) {
    console.error('Add public feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error adding public feedback',
      details: error.message
    });
  }
};

// Analyze Team Comments with AI
const analyzeTeamComments = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    
    // Get interview with populated data
    const interview = await Interview.findById(interviewId)
      .populate('candidateId', 'firstName lastName position experience email')
      .populate('jobId', 'title department level')
      .populate('teamComments');
    
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Get all active comments for this interview
    const comments = await InterviewComment.find({
      interviewId: interviewId,
      status: 'active'
    }).populate('authorId', 'profile.firstName profile.lastName email role');
    
    if (!comments || comments.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No comments available for analysis'
      });
    }
    
    // Prepare data for AI analysis
    const commentsData = {
      comments: comments.map(comment => ({
        content: comment.content,
        authorName: comment.authorName,
        authorRole: comment.authorRole,
        commentType: comment.commentType,
        rating: comment.rating,
        categories: comment.categories,
        createdAt: comment.createdAt,
        aiFlags: comment.aiFlags,
        authorId: comment.authorId._id
      })),
      interviewContext: {
        jobTitle: interview.jobId?.title || 'Position',
        department: interview.jobId?.department || 'Department',
        interviewType: interview.type,
        interviewDate: interview.scheduledAt
      },
      candidateInfo: {
        name: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
        position: interview.candidateId.position,
        experience: interview.candidateId.experience
      }
    };
    
    console.log('🤝 Analyzing team comments for interview:', interviewId);
    
    // Analyze comments using Azure OpenAI
    const azureService = new AzureOpenAIService();
    const analysisResult = await azureService.analyzeTeamComments(commentsData);
    
    if (!analysisResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to analyze team comments',
        details: analysisResult.error,
        rawResponse: analysisResult.rawResponse
      });
    }
    
    // Update interview with team feedback analysis
    interview.teamFeedbackAnalysis = {
      analyzed: true,
      analyzedAt: new Date(),
      totalComments: analysisResult.metadata.totalComments,
      participantCount: analysisResult.metadata.participantCount,
      overallSentiment: analysisResult.analysis.overallSentiment,
      sentimentScore: analysisResult.analysis.sentimentScore,
      consensus: analysisResult.analysis.consensus,
      commonThemes: analysisResult.analysis.commonThemes,
      identifiedStrengths: analysisResult.analysis.identifiedStrengths,
      identifiedConcerns: analysisResult.analysis.identifiedConcerns,
      finalRecommendation: analysisResult.analysis.finalRecommendation
    };
    
    await interview.save();
    
    console.log('✅ Team comments analyzed successfully for interview:', interviewId);
    
    res.json({
      success: true,
      message: 'Team comments analyzed successfully',
      analysis: interview.teamFeedbackAnalysis,
      metadata: analysisResult.metadata
    });
    
  } catch (error) {
    console.error('Analyze team comments error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error analyzing team comments',
      details: error.message
    });
  }
};

// Schedule Multi-Candidate Interview Session
const scheduleMultiCandidateInterview = async (req, res) => {
  const requestStartTime = Date.now();
  console.log(`🚀 PRODUCTION DEBUG - Multi-candidate interview request started at ${new Date(requestStartTime).toISOString()}`);
  
  try {
    const {
      sessionType,
      baseStartTime,
      sessionEndTime,
      totalDuration,
      interviewType,
      location,
      subject, // Custom subject for email notifications
      provider = 'google',
      addNotetaker = false,
      additionalInterviewers = [],
      candidateSlots = [],
      skipAvailabilityCheck = false,
      sendCustomEmail = false,
      emailTemplate = null,
      bccParticipants = [], // Array of BCC participants
      ccParticipants = [], // Array of CC participants
      // New parameters for interviewer questions
      sendQuestionsToInterviewers = false,
      questionsSendTime = 60, // minutes before interview
      selectedQuestionIds = [], // Array of question IDs to send to interviewers
      jobId = null, // Session-level jobId for context
      stageId = null // Session-level stageId for context
    } = req.body;
    
    // Debug logging for multi-candidate interview questions
    console.log('📋 Multi-Candidate Interview Questions Configuration:', {
      sendQuestionsToInterviewers,
      questionsSendTime,
      selectedQuestionIds,
      selectedQuestionIdsLength: selectedQuestionIds?.length || 0
    });

    // Validate required fields
    if (!baseStartTime || !candidateSlots || candidateSlots.length < 2) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Start time and at least 2 candidate slots are required'
      });
    }

    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    
    // Get interviewer details
    const interviewer = await User.findById(userId);
    if (!interviewer) {
      return res.status(404).json({ 
        error: 'INTERVIEWER_NOT_FOUND', 
        message: 'Interviewer not found' 
      });
    }
    
    // Decode timezone string (may be HTML-encoded from frontend)
    const rawSessionTimezone = req.body.timezone || interviewer?.profile?.timezone || 'UTC';
    const sessionTimezone = decodeHtmlEntities(rawSessionTimezone);
    
    console.log('🕐 Multi-candidate session timezone:', {
      raw: rawSessionTimezone,
      decoded: sessionTimezone
    });

    // Check calendar connection
    if (!interviewer.calendarConnected || !interviewer.nylasGrantId) {
      return res.status(400).json({
        error: 'CALENDAR_NOT_CONNECTED',
        message: 'Please connect your calendar first',
        requiresCalendarSetup: true
      });
    }
    
    // DYNAMIC CHECK: Verify the grant is still valid in Nylas
    console.log(`🔍 Verifying Nylas grant for ${interviewer.email} (multi-candidate)...`);
    
    // Get account credentials if user has a linked Nylas account
    let bulkVerifyAccountCredentials = null;
    if (interviewer.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        bulkVerifyAccountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        console.log(`   Using Nylas account: ${nylasAccount.name}`);
      }
    }
    
    // Also assign to bulkAccountCredentials for use throughout the function (same as single interview pattern)
    const bulkAccountCredentials = bulkVerifyAccountCredentials;
    
    const grantVerification = await nylasV3Service.verifyGrantStatus(interviewer.nylasGrantId, bulkVerifyAccountCredentials);
    
    if (!grantVerification.valid) {
      console.error(`❌ Grant verification failed for ${interviewer.email}:`, grantVerification);
      
      // Update user's grant status in database
      interviewer.nylasGrantStatus = 'invalid';
      interviewer.calendarConnected = false;
      await interviewer.save();
      
      return res.status(403).json({
        error: 'CALENDAR_CONNECTION_INVALID',
        message: grantVerification.message || 'Your calendar connection is no longer valid. Please reconnect your calendar.',
        requiresCalendarSetup: true,
        grantStatus: grantVerification.status,
        requiresReconnection: grantVerification.requiresReconnection
      });
    }
    
    console.log(`✅ Grant verified for ${interviewer.email} - ${grantVerification.grantInfo?.provider}`);
    
    // Update grant status in database if it was previously invalid
    if (interviewer.nylasGrantStatus !== 'active') {
      interviewer.nylasGrantStatus = 'active';
      await interviewer.save();
    }

    // Create a single meeting for the entire session
    let meetingLink = '';
    let meetingDetails = null;
    
    if (interviewType === 'video') {
      // Generate a single meeting link for all candidates
      const sessionTitle = subject || `Multi-Candidate Interview Session - ${candidateSlots.length} Candidates`;
      
      // Debug production issue with 15-minute interviews
      const startDate = new Date(baseStartTime);
      const endDate = new Date(sessionEndTime);
      const sessionDurationMinutes = Math.round((endDate - startDate) / 60000);
      
      console.log('🔍 PRODUCTION DEBUG - Session Creation:', {
        candidateCount: candidateSlots.length,
        individualSlotDurations: candidateSlots.map(s => s.duration),
        totalDurationFromClient: totalDuration,
        calculatedSessionDuration: sessionDurationMinutes,
        baseStartTime,
        sessionEndTime,
        startTimestamp: startDate.getTime(),
        endTimestamp: endDate.getTime(),
        isValidTimeRange: endDate > startDate,
        environment: process.env.NODE_ENV,
        provider
      });
      
      // Validate time range
      if (endDate <= startDate) {
        console.error('❌ Invalid time range: end time is before or equal to start time');
        return res.status(400).json({
          error: 'INVALID_TIME_RANGE',
          message: 'End time must be after start time',
          details: {
            startTime: baseStartTime,
            endTime: sessionEndTime,
            calculatedDuration: sessionDurationMinutes
          }
        });
      }

      // Create event with Google Meet
      const eventData = {
        title: decodeHtmlEntities(sessionTitle),
        description: decodeHtmlEntities(`Multi-candidate interview session with ${candidateSlots.length} candidates.`),
        startTime: baseStartTime,
        endTime: sessionEndTime,
        participants: [{
          email: interviewer.email,
          name: decodeHtmlEntities(interviewer.profile?.firstName && interviewer.profile?.lastName
            ? `${interviewer.profile.firstName} ${interviewer.profile.lastName}`
            : interviewer.email)
        }],
        conferencing: {
          provider: provider === 'microsoft' ? 'teams' : 'google_meet'
        },
        addNotetaker: false // We'll add notetaker separately for the full session
      };
      
      // Add timeout tracking for production debugging
      const eventCreationStart = Date.now();
      console.log('📅 Starting Nylas event creation at:', new Date(eventCreationStart).toISOString());
      
      try {
        meetingDetails = await nylasV3Service.createEvent(interviewer.nylasGrantId, eventData, bulkAccountCredentials);
        
        const eventCreationTime = Date.now() - eventCreationStart;
        console.log(`✅ Nylas event created in ${eventCreationTime}ms`);
        
        meetingLink = meetingDetails.conferencing?.details?.url || 
                     meetingDetails.conferencing?.details?.meeting_url || 
                     meetingDetails.conferencing?.join_url || '';
                     
        if (!meetingLink) {
          console.warn('⚠️ No meeting link returned from Nylas');
        }
      } catch (nylasError) {
        const eventCreationTime = Date.now() - eventCreationStart;
        console.error(`❌ Nylas event creation failed after ${eventCreationTime}ms:`, {
          error: nylasError.message,
          statusCode: nylasError.statusCode,
          details: nylasError.response?.data
        });
        throw nylasError;
      }
    }

    // Create individual interviews for each candidate
    const createdInterviews = [];
    const errors = [];
    
    // Generate a single session ID for all interviews in this multi-candidate session
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    for (const slot of candidateSlots) {
      const slotProcessingStart = Date.now();
      console.log(`🔄 Processing slot ${slot.order + 1}/${candidateSlots.length} - Duration: ${slot.duration} min`);
      
      try {
        // Get the candidate - candidateId should always be provided for multi-candidate interviews
        if (!slot.candidateId) {
          console.error(`No candidateId provided for slot:`, slot);
          throw new Error(`Candidate ID is required for multi-candidate interviews`);
        }
        
        const candidate = await Candidate.findById(slot.candidateId);
        if (!candidate) {
          console.error(`Candidate not found with ID: ${slot.candidateId}`);
          throw new Error(`Candidate not found with ID: ${slot.candidateId}`);
        }
        
        const candidateName = decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`);
        console.log(`Processing candidate: ${candidateName} (${candidate.email})`);
        
        const slotStartDate = new Date(slot.startTime);
        const formattedSlotDate = slotStartDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          timeZone: sessionTimezone
        });
        
        const formattedSlotTime = slotStartDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: sessionTimezone,
          timeZoneName: 'short'
        });
        
        // Update candidate's job application if needed
        if (slot.jobId && (!candidate.jobAppliedFor || candidate.jobAppliedFor.toString() !== slot.jobId)) {
          candidate.jobAppliedFor = slot.jobId;
          candidate.status = 'Interviewing';
          await candidate.save();
        }

        // Create interview record (initially without nylasEventId - will be set after calendar event creation)
        const interview = new Interview({
          candidateId: candidate._id,
          interviewerId: userId,
          jobId: slot.jobId,
          stageId: slot.stageId, // Add stageId if provided
          organizationId,
          scheduledAt: new Date(slot.startTime), // Use scheduledAt instead of startTime
          duration: slot.duration,
          type: interviewType,
          location: location || meetingLink,
          subject: decodeHtmlEntities(subject || `Interview Invitation - ${slot.jobTitle || 'Multi-Candidate Interview'}`),
          description: decodeHtmlEntities(slot.notes || `Interview with ${candidateName} for ${slot.jobTitle}`),
          status: 'scheduled',
          timezone: sessionTimezone,
          // nylasEventId will be set after calendar event creation
          nylasEventId: null,
          isMultiCandidate: true,
          multiCandidateSessionId: sessionId, // Use the same session ID for all interviews
          multiCandidateOrder: slot.order,
          // Add conferencing details
          conferencing: meetingLink ? {
            provider: provider === 'microsoft' ? 'teams' : 'google_meet',
            details: {
              url: meetingLink
            }
          } : undefined,
          // Notetaker fields - will be updated if notetaker is enabled
          notetakerEnabled: addNotetaker,
          notetakerId: null, // Will be set after notetaker creation
          notetakerStatus: addNotetaker ? 'pending' : 'disabled',
          // Add interviewer questions notification settings with proper ObjectIds
          notifications: {
            candidateReminder: true,
            interviewerReminder: true,
            reminderTime: 24, // Default 24 hours before
            sendQuestionsToInterviewers: sendQuestionsToInterviewers,
            questionsSendTime: questionsSendTime || 60, // Default 60 minutes before
            selectedQuestions: selectedQuestionIds && selectedQuestionIds.length > 0 
              ? selectedQuestionIds.map(id => new mongoose.Types.ObjectId(id)) 
              : []
          }
        });

        await interview.save();

        console.log(`✅ Interview created for ${candidateName} with organizationId: ${organizationId}, jobId: ${slot.jobId}, interviewId: ${interview._id}`);

        // Create activity notification for all organization members
        try {
          // Create a proper display name, handling N/A cases
          const getDisplayName = (candidate) => {
            const firstName = candidate.firstName && candidate.firstName !== 'N/A' ? candidate.firstName : '';
            const lastName = candidate.lastName && candidate.lastName !== 'N/A' ? candidate.lastName : '';
            
            if (firstName && lastName) {
              return `${firstName} ${lastName}`;
            } else if (firstName) {
              return firstName;
            } else if (lastName) {
              return lastName;
            } else if (candidate.email && !candidate.email.includes('@temp.com')) {
              return candidate.email.split('@')[0]; // Use email username as fallback
            } else {
              return 'Candidate';
            }
          };

          const displayName = getDisplayName(candidate);

          const notificationData = {
            _id: interview._id,
            candidateId: interview.candidateId,
            candidateName: displayName,
            jobTitle: slot.jobTitle || 'Multi-Candidate Interview',
            scheduledAt: interview.scheduledAt,
            duration: interview.duration,
            type: interview.type
          };
          
          await Notification.createInterviewCreatedNotification(userId, notificationData);
          console.log(`📢 Multi-candidate interview notifications sent to organization for: ${displayName}`);
        } catch (notificationError) {
          console.error(`⚠️ Failed to create notifications for interview ${interview._id}:`, notificationError.message);
          // Don't fail interview creation if notification fails
        }
        
        // Update pipeline status for this candidate
        // Use the slot's jobId, or if not available, try to use the organization's context
        const targetJobId = slot.jobId || jobId;  // jobId might be passed at the session level
        
        if (targetJobId) {
          try {
            console.log(`📊 Updating pipeline status for candidate ${candidate._id} in job ${targetJobId}`);
            
            const job = await Job.findById(targetJobId);
            if (job) {
              let applicantIndex = job.applicants.findIndex(
                app => app.candidate.toString() === candidate._id.toString()
              );
              
              // If candidate is not in the job pipeline, add them
              if (applicantIndex === -1) {
                console.log(`➕ Adding candidate ${candidateName} to job pipeline`);
                
                // Find the target stage - use slot's stageId, session stageId, or find an interview stage
                let targetStageId = slot.stageId || stageId;  // Use session-level stageId as fallback
                let targetStageName = 'Interview';
                
                if (!targetStageId && job.stages && job.stages.length > 0) {
                  const interviewStage = job.stages.find(stage => 
                    stage.name.toLowerCase().includes('interview') || 
                    stage.type === 'interview'
                  );
                  targetStageId = interviewStage ? interviewStage._id : job.stages[0]._id;
                  targetStageName = interviewStage ? interviewStage.name : job.stages[0].name;
                } else if (targetStageId) {
                  // If stageId is provided, try to get the stage name
                  const InterviewStage = require('../models/InterviewStage');
                  try {
                    const stage = await InterviewStage.findById(targetStageId);
                    if (stage) {
                      targetStageName = stage.name;
                    }
                  } catch (error) {
                    console.warn('Could not find stage name for stageId:', targetStageId);
                  }
                }
                
                // Validate that a pipeline stage exists
                if (!targetStageId) {
                  throw new Error('Cannot add candidate to pipeline: No active pipeline stages exist for this job. Please create pipeline stages first.');
                }
                
                // Add candidate to job applicants
                job.applicants.push({
                  candidate: candidate._id,
                  status: 'interviewing',
                  appliedAt: new Date(),
                  currentStage: {
                    stageId: targetStageId,
                    stageName: targetStageName,
                    enteredAt: new Date()
                  },
                  stageHistory: [{
                    stageId: targetStageId,
                    stageName: targetStageName,
                    enteredAt: new Date()
                  }],
                  statusHistory: [{
                    status: 'interviewing',
                    changedBy: userId,
                    changedAt: new Date(),
                    notes: 'Added to pipeline when multi-candidate interview was scheduled'
                  }],
                  interviews: [{
                    interviewId: interview._id,
                    stageId: targetStageId,
                    scheduledAt: interview.scheduledAt, // Fixed: use scheduledAt instead of startTime
                    status: 'scheduled'
                  }]
                });
                
                await job.save();
                console.log(`✅ Candidate ${candidateName} added to job pipeline with interview scheduled`);
              } else {
                // Candidate exists in pipeline, update their status and stage
                const applicant = job.applicants[applicantIndex];
                const previousStatus = applicant.status || 'unknown';
                const previousStage = applicant.currentStage;
                
                // ALWAYS set the stage - whether they had one before or not
                let targetStageId = slot.stageId || stageId;  // Use session-level stageId as fallback
                let targetStageName = 'Interview Stage';
                
                // If no stageId provided, find an appropriate interview stage
                if (!targetStageId && job.stages && job.stages.length > 0) {
                  const interviewStage = job.stages.find(stage => 
                    stage.name.toLowerCase().includes('interview') || 
                    stage.type === 'interview'
                  );
                  targetStageId = interviewStage ? interviewStage._id : job.stages[0]._id;
                  targetStageName = interviewStage ? interviewStage.name : job.stages[0].name;
                } else if (targetStageId) {
                  // If stageId is provided, try to get the stage name
                  const InterviewStage = require('../models/InterviewStage');
                  try {
                    const stage = await InterviewStage.findById(targetStageId);
                    if (stage) {
                      targetStageName = stage.name;
                    }
                  } catch (error) {
                    console.warn('Could not find stage name for existing candidate stageId:', targetStageId);
                  }
                }
                
                // Set the current stage (whether they had one or not)
                if (targetStageId) {
                  // Set currentStage as an object with all required fields
                  applicant.currentStage = {
                    stageId: new mongoose.Types.ObjectId(targetStageId),
                    stageName: targetStageName,
                    enteredAt: new Date()
                  };
                  
                  // Add to stage history
                  if (!applicant.stageHistory) {
                    applicant.stageHistory = [];
                  }
                  
                  // Check if we need to exit the previous stage
                  if (previousStage && previousStage.stageId) {
                    // Find and update the previous stage in history
                    const prevStageInHistory = applicant.stageHistory.find(
                      sh => sh.stageId?.toString() === previousStage.stageId.toString() && !sh.exitedAt
                    );
                    if (prevStageInHistory) {
                      prevStageInHistory.exitedAt = new Date();
                    }
                    console.log(`📍 Moving candidate ${candidateName} from stage ${previousStage.stageName} to ${targetStageName}`);
                  } else {
                    console.log(`📍 Setting candidate ${candidateName} to stage ${targetStageName} (was not in any stage)`);
                  }
                  
                  // Add the new stage to history
                  applicant.stageHistory.push({
                    stageId: new mongoose.Types.ObjectId(targetStageId),
                    stageName: targetStageName,
                    enteredAt: new Date()
                  });
                } else {
                  console.log(`⚠️ No stage ID available for candidate ${candidateName}`);
                }
                
                // Update status to interviewing if not already there
                const validPreInterviewStatuses = ['applied', 'reviewing', 'shortlisted', 'unknown', undefined];
                if (validPreInterviewStatuses.includes(previousStatus)) {
                  applicant.status = 'interviewing';
                  
                  // Add to status history
                  if (!applicant.statusHistory) {
                    applicant.statusHistory = [];
                  }
                  
                  const stageNote = previousStage 
                    ? `Moved from stage ${previousStage} to ${targetStageId}` 
                    : `Assigned to stage ${targetStageId}`;
                  
                  applicant.statusHistory.push({
                    status: 'interviewing',
                    changedBy: userId,
                    changedAt: new Date(),
                    notes: `Status updated when multi-candidate interview was scheduled. ${stageNote}`,
                    previousStatus: previousStatus || 'unknown'
                  });
                }
                
                // Add interview reference
                if (!applicant.interviews) {
                  applicant.interviews = [];
                }
                
                applicant.interviews.push({
                  interviewId: interview._id,
                  stageId: targetStageId || applicant.currentStage?.stageId,
                  scheduledAt: interview.scheduledAt, // Fixed: use scheduledAt instead of startTime
                  status: 'scheduled'
                });
                
                await job.save();
                const stageChange = previousStage && previousStage.stageName
                  ? `${previousStage.stageName} → ${applicant.currentStage.stageName}` 
                  : `none → ${applicant.currentStage.stageName}`;
                console.log(`✅ Pipeline updated for ${candidateName}: status ${previousStatus} → ${applicant.status}, stage ${stageChange}`);
              }
            }
          } catch (pipelineError) {
            console.error(`Failed to update pipeline for ${candidate.name}:`, pipelineError);
            // Don't fail the whole process if pipeline update fails
          }
        }

        // Create individual calendar event for this candidate's time slot
        if (interviewer.calendarConnected) {
          try {
            const eventTitle = `Interview with ${candidateName} - ${slot.jobTitle}`;
            const eventDescription = `
              Interview for: ${slot.jobTitle}
              Candidate: ${candidateName}
              Email: ${candidate.email}
              Time Slot: ${new Date(slot.startTime).toLocaleTimeString()} - ${new Date(slot.endTime).toLocaleTimeString()}
              ${meetingLink ? `Meeting Link: ${meetingLink}` : ''}
              ${slot.notes ? `Notes: ${slot.notes}` : ''}
              
              This is part of a multi-candidate interview session.
            `;

            // Create calendar event for this specific time slot
            const calendarEventData = {
              title: eventTitle,
              description: eventDescription,
              startTime: slot.startTime,
              endTime: slot.endTime,
              participants: [
                { email: candidate.email, name: candidateName },
                ...additionalInterviewers,
                // Add BCC participants (they will be filtered out but processed separately)
                ...bccParticipants.map(participant => ({
                  email: participant.email,
                  name: participant.name || participant.email,
                  status: 'noreply',
                  visibility: 'bcc'
                })),
                // Add CC participants (visible to all)
                ...ccParticipants.map(participant => ({
                  email: participant.email,
                  name: participant.name || participant.email,
                  status: 'noreply',
                  visibility: 'cc'
                }))
              ],
              location: location || meetingLink,
              conferencing: meetingLink ? {
                provider: provider === 'microsoft' ? 'teams' : 'google_meet',
                details: {
                  url: meetingLink
                }
              } : null
            };
            
            const calendarEvent = await nylasV3Service.createEvent(
              interviewer.nylasGrantId,
              calendarEventData,
              bulkAccountCredentials
            );

            // Update interview record with calendar event ID
            if (calendarEvent && calendarEvent.id) {
              interview.nylasEventId = calendarEvent.id;
              await interview.save();
              console.log(`✅ Updated interview ${interview._id} with calendar event ID: ${calendarEvent.id}`);
            }

            // Send separate calendar invites to BCC participants for this candidate's slot
            const bccParticipantsFromEventData = calendarEventData.participants?.filter(p => p.visibility === 'bcc') || [];
            if (bccParticipantsFromEventData.length > 0) {
              console.log(`📅 Sending BCC calendar invites for ${candidateName} to ${bccParticipantsFromEventData.length} recipients`);
              try {
                const bccResults = await nylasV3Service.sendBccCalendarInvites(
                  interviewer.nylasGrantId,
                  calendarEventData,
                  bccParticipantsFromEventData
                );
                console.log(`✅ BCC calendar invites for ${candidateName}: ${bccResults.message}`);
              } catch (bccError) {
                console.error(`❌ Failed to send BCC calendar invites for ${candidateName}:`, bccError.message);
                // Don't fail the whole process if BCC calendar invites fail
              }
            }

            // Update interview with calendar event ID
            interview.calendarEventId = calendarEvent.id;
            interview.calendarProvider = calendarEvent.grant_id;
            await interview.save();

            // Send custom email invitation to candidate if requested
            if (sendCustomEmail && candidate.email) {
              try {
                console.log(`Sending custom email to ${candidateName} (${candidate.email})`);
                
                // Format interview type
                const formattedType = interviewType === 'video' ? 'Video Call' : 
                                     interviewType === 'phone' ? 'Phone Call' : 
                                     'In-Person Meeting';
                
                // Prepare template data
                const templateData = {
                  candidateName: candidateName,
                  jobTitle: slot.jobTitle,
                  interviewDate: formattedSlotDate,
                  interviewTime: formattedSlotTime,
                  duration: slot.duration,
                  interviewType: formattedType,
                  meetingLink: meetingLink || null,  // ✅ FIX: Use null instead of empty string for conditionals
                  notes: slot.notes || null,         // ✅ FIX: Use null instead of empty string for conditionals
                  interviewerName: interviewer.profile?.firstName && interviewer.profile?.lastName
                    ? `${interviewer.profile.firstName} ${interviewer.profile.lastName}`
                    : interviewer.email,
                  interviewerEmail: interviewer.email,
                  organizationName: interviewer.organization?.name || 'SmartHR'
                };
                
                // Send the email - Use Nylas if available, fallback to Brevo
                const useNylasEmail = interviewer.nylasGrantId && process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS === 'true';
                
                if (useNylasEmail) {
                  console.log(`📧 Attempting Nylas connected email for ${candidateName}`);
                  
                  // Reuse account credentials from verify step
                  const bulkEmailAccountCredentials = bulkVerifyAccountCredentials;
                  
                  // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
                  const nylasResult = await nylasEmailService.sendInterviewInviteEmail(
                    interviewer.nylasGrantId,
                    candidate.email,
                    templateData,
                    emailTemplate,
                    subject || `Interview Invitation - ${slot.jobTitle}`,
                    [], // No BCC - interviewers get separate notification
                    [],  // No CC - interviewers get separate notification
                    bulkEmailAccountCredentials // Pass account credentials
                  );
                  
                  // If Nylas fails, fall back to Brevo
                  if (!nylasResult.success) {
                    console.log(`📧 Nylas failed for ${candidateName}, falling back to Brevo`);
                    console.warn(`ℹ️ ${candidateName}: User needs to disconnect and reconnect calendar for email permissions`);
                    console.log(`📧 Using Brevo fallback for ${candidateName} (interview still works)`);
                    
                    // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
                    await emailService.sendInterviewInviteEmail(
                      candidate.email,
                      templateData,
                      emailTemplate,
                      [], // No BCC - interviewers get separate notification
                      []  // No CC - interviewers get separate notification
                    );
                  }
                } else {
                  console.log(`📧 Using Brevo email service for ${candidateName}`);
                  // ✅ SEND INTERVIEW INVITATION ONLY TO CANDIDATE (no BCC/CC to interviewers)
                  await emailService.sendInterviewInviteEmail(
                    candidate.email,
                    templateData,
                    emailTemplate,
                    [], // No BCC - interviewers get separate notification
                    []  // No CC - interviewers get separate notification
                  );
                }
                
                console.log(`✅ Email sent to ${candidateName}`);
                
                // This notification code will be moved outside the sendCustomEmail block
                
              } catch (emailError) {
                console.error(`Failed to send email to ${candidateName}:`, emailError);
                // Don't fail the whole process if email fails
              }
            }
          } catch (calendarError) {
            console.error(`Failed to create calendar event for ${slot.candidateName}:`, calendarError);
            errors.push({
              candidate: slot.candidateName,
              error: 'Failed to create calendar event'
            });
          }
        }

        // ✅ ALWAYS SEND INTERVIEW NOTIFICATION EMAILS TO INTERVIEWERS/OBSERVERS (outside sendCustomEmail block)
        // Define participants outside try block to avoid scope issues
        const allInterviewParticipants = [
          // Main interviewer
          { email: interviewer.email, name: interviewer.name || interviewer.email },
          // Additional interviewers
          ...additionalInterviewers,
          // BCC participants (they should get notification, not invitation)
          ...bccParticipants,
          // CC participants (they should get notification, not invitation)  
          ...ccParticipants
        ];
        
        try {
          console.log(`📧 Sending interview notifications to all participants for ${candidateName}...`);
          
          console.log(`🔍 [MULTI] Found ${allInterviewParticipants.length} total participants for notifications for ${candidateName}:`, 
            allInterviewParticipants.map(p => `${p.email} (${p.name || 'no name'})`));
          
          // Remove duplicates and send notification to each unique participant
          const emailsSeen = new Set();
          for (const participant of allInterviewParticipants) {
            if (participant.email && !emailsSeen.has(participant.email.toLowerCase())) {
              emailsSeen.add(participant.email.toLowerCase());
              
              const notificationTemplateData = {
                candidateName: candidateName,
                jobTitle: slot.jobTitle || 'Multi-Candidate Interview',
                interviewDate: formattedSlotDate,
                interviewTime: formattedSlotTime,
                duration: slot.duration,
                interviewType: interviewType === 'video' ? 'Video Call' : 'In-Person Meeting',
                meetingLink: meetingLink,
                notes: slot.notes || '',
                interviewerName: participant.name || participant.email.split('@')[0],
                interviewerEmail: interviewer?.email || 'no-reply@smarthr.app',
                organizationName: 'SmartHR',
                // ✅ ADD CANDIDATE INFORMATION FOR ENHANCED NOTIFICATION
                interviewId: interview._id,
                candidateResumeUrl: candidate.cvUrl,
                candidateCurrentRole: candidate.currentRole,
                candidateExperience: candidate.yearsOfExperience,
                feedbackUrl: `${process.env.FRONTEND_URL || 'https://smarthr.aiinnigeria.com'}/public/feedback/${interview._id}`
              };
              
              console.log(`🔍 [MULTI] Sending notification to ${participant.email} for ${candidateName} with template data:`, {
                candidateName: notificationTemplateData.candidateName,
                jobTitle: notificationTemplateData.jobTitle,
                interviewId: notificationTemplateData.interviewId,
                feedbackUrl: notificationTemplateData.feedbackUrl
              });
              
              // ✅ USE SAME PROVEN EMAIL METHOD AS CANDIDATE INVITATIONS (just different template and recipient)
              const useNylasForNotification = interviewer.nylasGrantId && process.env.USE_NYLAS_FOR_INTERVIEW_EMAILS === 'true';
              
              // Create notification template (different from candidate invitation)
              const notificationTemplate = `Dear {{interviewerName}},

You have an upcoming interview to conduct for the {{jobTitle}} position.

CANDIDATE INFORMATION:
• Name: {{candidateName}}
• Position: {{jobTitle}}
{{#if candidateCurrentRole}}• Current Role: {{candidateCurrentRole}}{{/if}}
{{#if candidateExperience}}• Experience: {{candidateExperience}} years{{/if}}

INTERVIEW DETAILS:
• Date: {{interviewDate}}
• Time: {{interviewTime}}
• Duration: {{duration}} minutes
• Format: {{interviewType}}
{{#if meetingLink}}• Meeting Link: {{meetingLink}}{{/if}}
{{#if notes}}
• Additional Notes: {{notes}}
{{/if}}

FEEDBACK ACCESS:
You can access interview questions and submit feedback at:
{{feedbackUrl}}

Please review the candidate information before the interview and submit your assessment after completion.

Best regards,
SmartHR`;
              
              if (useNylasForNotification) {
                console.log(`📧 🚨 [MULTI] ATTEMPTING Nylas notification to ${participant.email} for ${candidateName} with data:`, {
                  grantId: interviewer.nylasGrantId,
                  recipient: participant.email,
                  candidateName: notificationTemplateData.candidateName,
                  feedbackUrl: notificationTemplateData.feedbackUrl
                });
                const nylasNotificationResult = await nylasEmailService.sendInterviewInviteEmail(
                  interviewer.nylasGrantId,
                  participant.email,
                  notificationTemplateData,
                  notificationTemplate, // Custom template for notifications
                  `Interview Notification: ${notificationTemplateData.candidateName} - ${notificationTemplateData.jobTitle}`, // Custom subject
                  [], // No BCC for notifications
                  [],  // No CC for notifications
                  bulkVerifyAccountCredentials // Pass same account credentials (same as bulkAccountCredentials)
                );
                
                if (!nylasNotificationResult.success) {
                  console.log(`📧 ⚠️ [MULTI] Nylas notification failed for ${participant.email}, falling back to Brevo. Error:`, nylasNotificationResult.error);
                  // Fallback to Brevo using same method
                  await emailService.sendInterviewInviteEmail(
                    participant.email,
                    notificationTemplateData,
                    notificationTemplate,
                    [], // No BCC for notifications  
                    []  // No CC for notifications
                  );
                  console.log(`📧 ✅ [MULTI] Brevo fallback notification sent to ${participant.email}`);
                }
              } else {
                console.log(`📧 🚨 [MULTI] ATTEMPTING Brevo notification to ${participant.email} for ${candidateName} (Nylas not available)`);
                await emailService.sendInterviewInviteEmail(
                  participant.email,
                  notificationTemplateData,
                  notificationTemplate,
                  [], // No BCC for notifications
                  []  // No CC for notifications  
                );
                console.log(`📧 ✅ [MULTI] Brevo notification sent to ${participant.email}`);
              }
              
              console.log(`✅ Interview notification sent to ${participant.email} for ${candidateName}`);
            }
          }
        } catch (notificationError) {
          console.error(`❌ 🚨 CRITICAL: Failed to send interview notifications for ${candidateName}:`, notificationError);
          console.error('🔍 Notification error details:', {
            errorMessage: notificationError.message,
            errorStack: notificationError.stack,
            candidateName: candidateName,
            participantCount: allInterviewParticipants.length,
            participantEmails: allInterviewParticipants.map(p => p.email)
          });
          // Don't fail the whole process if notifications fail
        }

        createdInterviews.push({
          interviewId: interview._id,
          candidateName: slot.candidateName,
          candidateEmail: slot.candidateEmail,
          startTime: slot.startTime,
          endTime: slot.endTime,
          duration: slot.duration
        });
        
        const slotProcessingTime = Date.now() - slotProcessingStart;
        console.log(`✅ Slot ${slot.order + 1} processed successfully in ${slotProcessingTime}ms for ${slot.candidateName}`);

      } catch (slotError) {
        console.error(`Failed to schedule interview for ${slot.candidateName}:`, slotError);
        errors.push({
          candidate: slot.candidateName,
          error: slotError.message
        });
      }
    }
    
    console.log(`📊 PRODUCTION DEBUG - All ${candidateSlots.length} slots processed:`, {
      totalSlots: candidateSlots.length,
      successfullyCreated: createdInterviews.length,
      errors: errors.length,
      errorDetails: errors
    });

    // Add notetaker for the entire session if requested
    console.log('🔍 Notetaker check:', {
      addNotetaker: addNotetaker,
      meetingLink: meetingLink ? 'Present' : 'Missing',
      meetingDetailsId: meetingDetails?.id || 'Missing',
      createdInterviewsCount: createdInterviews.length
    });
    
    if (addNotetaker && meetingLink && createdInterviews.length > 0) {
      try {
        console.log('🤖 Adding notetaker to multi-candidate session...');
        console.log('Meeting details:', {
          eventId: meetingDetails?.id,
          meetingLink: meetingLink,
          grantId: interviewer.nylasGrantId
        });
        
        // Wait for the meeting to be fully created (same as single interview)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Use the actual session start time (same approach as single interviews)
        const joinTime = new Date(baseStartTime);
        
        console.log('🤖 Notetaker join time:', {
          scheduledTime: baseStartTime,
          joinTime: joinTime.toISOString(),
          timeDifference: Math.round((joinTime.getTime() - Date.now()) / 60000) + ' minutes'
        });
        
        // Try to create notetaker with main event ID, fallback to direct meeting link
        let notetakerResponse;
        if (meetingDetails?.id) {
          console.log('Creating notetaker with main event ID:', meetingDetails.id);
          notetakerResponse = await nylasV3Service.enableNotetakerForEvent(
            interviewer.nylasGrantId,
            meetingDetails.id,
            meetingLink,
            joinTime, // Pass the actual session start time
            bulkVerifyAccountCredentials // Pass account credentials for correct API key
          );
        } else {
          console.log('No main event ID available, creating notetaker with meeting link only');
          // Create notetaker without specific event ID (using just the meeting link)
          notetakerResponse = await nylasV3Service.enableNotetakerForEvent(
            interviewer.nylasGrantId,
            null, // No specific event ID
            meetingLink,
            joinTime, // Pass the actual session start time
            bulkVerifyAccountCredentials // Pass account credentials for correct API key
          );
        }

        console.log('✅ Notetaker created successfully:', {
          id: notetakerResponse.id,
          notetakerId: notetakerResponse.notetakerId,
          state: notetakerResponse.state
        });

        // Use the correct field from the response (it's 'id', not 'notetakerId')
        const actualNotetakerId = notetakerResponse.id;

        // Update all interviews with notetaker info
        for (const interview of createdInterviews) {
          await Interview.findByIdAndUpdate(interview.interviewId, {
            notetakerId: actualNotetakerId,
            notetakerStatus: 'enabled',
            notetakerEnabled: true
          });
          console.log(`✅ Updated interview ${interview.interviewId} with notetaker ID: ${actualNotetakerId}`);
        }
        
        console.log('✅ All interviews updated with notetaker information');
      } catch (notetakerError) {
        console.error('❌ Failed to add notetaker to multi-candidate session:', notetakerError);
        console.error('Notetaker error details:', {
          message: notetakerError.message,
          stack: notetakerError.stack
        });
        
        // Update interviews to reflect notetaker failure
        for (const interview of createdInterviews) {
          await Interview.findByIdAndUpdate(interview.interviewId, {
            notetakerStatus: 'failed',
            notetakerEnabled: false
          });
        }
        // Continue even if notetaker fails - don't fail the entire interview creation
      }
    }

    console.log(`✅ PRODUCTION DEBUG - About to send response. Total request processing time: ${Date.now() - requestStartTime}ms`);
    
    res.status(201).json({
      success: true,
      message: `Successfully scheduled ${createdInterviews.length} interviews`,
      sessionDetails: {
        sessionType: 'multi-candidate',
        totalDuration,
        meetingLink,
        startTime: baseStartTime,
        endTime: sessionEndTime,
        candidateCount: candidateSlots.length
      },
      interviews: createdInterviews,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Multi-candidate interview scheduling error:', error);
    handleInterviewError(error, res);
  }
};

// Generate OTP for public feedback
const generateFeedbackOTP = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { email, name } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email and name are required'
      });
    }
    
    // Get interview with populated fields
    const interview = await Interview.findById(interviewId)
      .populate('candidateId', 'profile.firstName profile.lastName email')
      .populate('jobId', 'title');
    
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Import FeedbackOTP model and email service
    const FeedbackOTP = require('../models/FeedbackOTP');
    const emailService = require('../services/emailService');
    
    // Generate OTP
    const otp = await FeedbackOTP.createOTP(email.toLowerCase().trim(), name.trim(), interviewId);
    
    // Send OTP email
    const candidateName = interview.candidateId ? 
      `${interview.candidateId.profile?.firstName || ''} ${interview.candidateId.profile?.lastName || ''}`.trim() || 
      interview.candidateId.email : 
      'the candidate';
    
    const jobTitle = interview.jobId?.title || 'the position';
    
    await emailService.sendFeedbackOTP(email, otp, candidateName, jobTitle);
    
    res.json({
      success: true,
      message: 'OTP sent successfully to your email'
    });
    
  } catch (error) {
    console.error('Error generating feedback OTP:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate OTP'
    });
  }
};

// Verify OTP for public feedback
const verifyFeedbackOTP = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Email and OTP are required'
      });
    }
    
    const FeedbackOTP = require('../models/FeedbackOTP');
    
    // Find the OTP entry
    const otpEntry = await FeedbackOTP.findOne({
      email: email.toLowerCase().trim(),
      interviewId,
      verified: false
    });
    
    if (!otpEntry) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired OTP'
      });
    }
    
    // Verify OTP - ensure both are strings for comparison
    console.log('🔐 [OTP-VERIFY] OTP Verification Debug:', {
      storedOTP: otpEntry.otp,
      providedOTP: otp,
      storedType: typeof otpEntry.otp,
      providedType: typeof otp,
      attempts: otpEntry.attempts,
      expired: otpEntry.expiresAt < new Date(),
      verified: otpEntry.verified
    });
    
    const verification = otpEntry.verifyOTP(otp.toString());
    await otpEntry.save();
    
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        error: verification.reason
      });
    }
    
    res.json({
      success: true,
      message: 'Email verified successfully',
      verifiedEmail: otpEntry.email,
      verifiedName: otpEntry.name
    });
    
  } catch (error) {
    console.error('Error verifying feedback OTP:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify OTP'
    });
  }
};

// Delete Feedback
const deleteFeedback = async (req, res) => {
  try {
    const { interviewId, commentId } = req.params;
    const userId = req.user?.id;
    
    console.log('🗑️ Delete feedback request:', { interviewId, commentId, userId });
    
    // Find the feedback comment
    const comment = await InterviewComment.findOne({
      _id: commentId,
      interviewId: interviewId,
      commentType: 'feedback'
    });
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Feedback not found'
      });
    }
    
    // Check permissions - only author or admin can delete
    const canDelete = !comment.authorId || // Public feedback can be deleted by anyone with access
                     (userId && comment.authorId && comment.authorId.toString() === userId) || // Author can delete
                     (userId && req.user?.role === 'admin'); // Admin can delete
    
    if (!canDelete) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own feedback'
      });
    }
    
    // Delete the comment
    await InterviewComment.findByIdAndDelete(commentId);
    
    // Remove from interview's team comments array
    const interview = await Interview.findById(interviewId);
    if (interview && interview.teamComments) {
      interview.teamComments = interview.teamComments.filter(
        id => id.toString() !== commentId
      );
      await interview.save();
    }
    
    console.log('✅ Feedback deleted successfully:', commentId);
    
    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error deleting feedback',
      details: error.message
    });
  }
};

// Save Analytics Score
const saveAnalyticsScore = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user?.currentOrganization;
    
    const {
      averageScore,
      scoreBreakdown,
      recommendation,
      totalAssessors,
      assessorConsensus,
      calculatedAt
    } = req.body;
    
    // Verify interview exists
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    // Update interview with analytics score
    const analyticsData = {
      calculatedScore: {
        overall: averageScore,
        breakdown: scoreBreakdown,
        recommendation: recommendation,
        metadata: {
          totalAssessors,
          assessorConsensus,
          calculatedAt: new Date(calculatedAt),
          lastUpdated: new Date()
        }
      }
    };
    
    await Interview.findByIdAndUpdate(interviewId, {
      $set: { 'analytics': analyticsData }
    });
    
    console.log('✅ Analytics score saved for interview:', interviewId, 'Score:', averageScore);
    
    res.json({
      success: true,
      message: 'Analytics score saved successfully',
      score: averageScore,
      recommendation: recommendation
    });
    
  } catch (error) {
    console.error('Save analytics score error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error saving analytics score',
      details: error.message
    });
  }
};

// Get Analytics Score
const getAnalyticsScore = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    
    // Get interview with analytics
    const interview = await Interview.findById(interviewId).select('analytics');
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found'
      });
    }
    
    res.json({
      success: true,
      analytics: interview.analytics || null
    });
    
  } catch (error) {
    console.error('Get analytics score error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching analytics score',
      details: error.message
    });
  }
};

// Get Comprehensive Analytics (Dynamic Scoring)
const getComprehensiveAnalytics = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const organizationId = req.user.currentOrganization;
    
    const analytics = await getComprehensiveAnalyticsForInterview(interviewId, organizationId);
    
    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Interview not found or analytics could not be calculated'
      });
    }
    
    res.json(analytics);
    
  } catch (error) {
    console.error('Get comprehensive analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching comprehensive analytics',
      details: error.message
    });
  }
};

// Helper function for comprehensive analytics (reusable)
async function getComprehensiveAnalyticsForInterview(interviewId, organizationId = null) {
  try {
    // Fetch interview with job populated
    const interview = await Interview.findById(interviewId).populate('jobId');
    
    if (!interview) {
      return null;
    }
    
    const job = interview.jobId;
    if (!job) {
      console.warn('Interview has no associated job');
      return null;
    }
    
    // Step 1: Discover Rating Sources from template
    let template;
    if (job.feedbackFormConfig && job.feedbackFormConfig.templateId) {
      template = await FeedbackFormTemplate.findById(job.feedbackFormConfig.templateId);
    } else {
      template = await FeedbackFormTemplate.findOne({
        organization: job.organization,
        isDefault: true
      });
    }
    
    if (!template) {
      console.warn('No feedback template found for job');
      return null;
    }
    
    // Populate custom field references
    await template.populate('customFields.customFieldRef');
    
    // Extract visible system rating fields
    const systemRatingFields = (template.systemFields || []).filter(f =>
      f.isVisible !== false &&
      ['overallRating', 'technicalRating', 'communicationRating', 'culturalRating'].includes(f.fieldId)
    );
    
    // Extract visible custom rating fields
    const customRatingFields = (template.customFields || []).filter(f =>
      f.isVisible !== false &&
      f.customFieldRef &&
      f.customFieldRef.type === 'rating'
    );
    
    // Extract calculated fields (for display, not scoring)
    const calculatedFields = (template.customFields || []).filter(f =>
      f.isVisible !== false &&
      f.customFieldRef &&
      f.customFieldRef.type === 'calculated'
    );
    
    // Get questions (if any were sent to interviewers)
    const questionIds = interview.notifications?.selectedQuestions || [];
    
    // Step 2: Aggregate All Feedback
    const comments = await InterviewComment.find({ interviewId });
    const customResponses = await CustomFieldResponse.find({ interviewId });
    
    // Count unique respondents
    const respondents = new Set();
    comments.forEach(c => {
      const key = c.publicFeedback?.email || c.authorId?.toString();
      if (key) respondents.add(key);
    });
    customResponses.forEach(r => {
      const key = r.respondentEmail || r.respondentId?.toString();
      if (key) respondents.add(key);
    });
    
    // Step 3: Calculate Weights
    const totalRatingSources = systemRatingFields.length + customRatingFields.length + questionIds.length;
    
    if (totalRatingSources === 0) {
      // No rating sources configured
      return {
        totalScore: 0,
        normalizedScore: 0,
        totalAssessors: respondents.size,
        totalRatingSources: 0,
        breakdown: {
          systemFields: {},
          customFields: {},
          questions: {},
          calculatedFields: {}
        },
        weights: {},
        recommendation: 'pending',
        assessorConsensus: 0
      };
    }
    
    const weightPerSource = 1 / totalRatingSources;
    
    // Step 4: Calculate Scores
    let totalScore = 0;
    const breakdown = {
      systemFields: {},
      customFields: {},
      questions: {},
      calculatedFields: {}
    };
    const allScores = []; // For consensus calculation
    
    // Calculate system field scores
    systemRatingFields.forEach(field => {
      const fieldName = field.fieldId.replace('Rating', ''); // 'overallRating' -> 'overall'
      const average = calculateAverageForField(fieldName, comments);
      const contribution = average * weightPerSource;
      totalScore += contribution;
      
      breakdown.systemFields[field.label || fieldName] = {
        average,
        weight: weightPerSource,
        contribution
      };
      
      if (average > 0) allScores.push(average);
    });
    
    // Calculate custom field scores
    // ALWAYS include custom fields from template, even if no responses yet
    customRatingFields.forEach(field => {
      const average = calculateAverageForCustomField(field.customFieldRef._id, customResponses);
      const contribution = average * weightPerSource;
      totalScore += contribution;

      // Always add to breakdown, even if average is 0
      breakdown.customFields[field.customFieldRef.label] = {
        average,
        weight: weightPerSource,
        contribution,
        hasResponses: average > 0  // Flag to indicate if there are actual responses
      };

      if (average > 0) allScores.push(average);
    });
    
    // Calculate question-specific scores
    questionIds.forEach(questionId => {
      const questionComments = comments.filter(c => 
        c.questionId && c.questionId.toString() === questionId.toString()
      );
      const ratings = questionComments
        .map(c => c.rating?.overall)
        .filter(r => r !== undefined && r !== null && typeof r === 'number');
      
      if (ratings.length > 0) {
        const average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        const contribution = average * weightPerSource;
        totalScore += contribution;
        
        breakdown.questions[questionId.toString()] = {
          average: Math.round(average * 100) / 100,
          weight: weightPerSource,
          contribution: Math.round(contribution * 100) / 100
        };
        
        allScores.push(average);
      }
    });
    
    // Get calculated field values (don't include in score, just display)
    calculatedFields.forEach(field => {
      const fieldResponses = customResponses.filter(r =>
        r.customFieldId.toString() === field.customFieldRef._id.toString() &&
        r.fieldType === 'calculated'
      );
      
      if (fieldResponses.length > 0) {
        // Use the most recent calculated value
        const latestResponse = fieldResponses.sort((a, b) => 
          new Date(b.createdAt) - new Date(a.createdAt)
        )[0];
        
        breakdown.calculatedFields[field.customFieldRef.label] = {
          value: latestResponse.responseValue,
          formula: latestResponse.calculationFormula || field.customFieldRef.calculationFormula
        };
      }
    });
    
    // Step 5: Calculate final metrics
    const normalizedScore = Math.round(totalScore * 100) / 100;
    const assessorConsensus = calculateConsensus(allScores);
    
    // Determine recommendation based on score
    let recommendation = 'pending';
    if (normalizedScore >= 4.5) {
      recommendation = 'strong_hire';
    } else if (normalizedScore >= 3.5) {
      recommendation = 'hire';
    } else if (normalizedScore >= 2.5) {
      recommendation = 'maybe';
    } else if (normalizedScore >= 1.5) {
      recommendation = 'no_hire';
    } else if (normalizedScore > 0) {
      recommendation = 'strong_no_hire';
    }
    
    return {
      totalScore: normalizedScore,
      normalizedScore,
      totalAssessors: respondents.size,
      totalRatingSources,
      breakdown,
      weights: { perSource: weightPerSource },
      recommendation,
      assessorConsensus
    };
    
  } catch (error) {
    console.error('Error calculating comprehensive analytics:', error);
    throw error;
  }
}

module.exports = {
  scheduleInterview,
  scheduleFromPipeline,
  scheduleMultiCandidateInterview,
  getAvailability,
  connectCalendar,
  handleOAuthCallback,
  getCalendarStatus,
  getJobInterviews,
  getCandidateInterviews,
  getInterviews,
  updateInterviewStatus,
  cancelInterview,
  getInterviewDetails,
  debugInterviewNotetaker,
  // New AI and Comments functionality
  generateAISummary,
  getInterviewComments,
  addInterviewComment,
  updateInterviewComment,
  deleteInterviewComment,
  // New Question-Based Feedback functionality
  getInterviewQuestions,
  addQuestionFeedback,
  addPublicFeedback,
  addBulkPublicFeedback,
  analyzeTeamComments,
  getFeedbackSummary,
  // OTP functionality
  generateFeedbackOTP,
  verifyFeedbackOTP,
  // Delete feedback functionality
  deleteFeedback,
  // Analytics functionality
  saveAnalyticsScore,
  getAnalyticsScore,
  getComprehensiveAnalytics,
  getComprehensiveAnalyticsForInterview
}; 