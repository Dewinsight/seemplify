const cron = require('node-cron');
const mongoose = require('mongoose');
const InterviewSlotRetryTask = require('../models/InterviewSlotRetryTask');
const Interview = require('../models/Interview');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const User = require('../models/User');
const NylasAccount = require('../models/NylasAccount');
const nylasV3Service = require('./nylasV3Service');
const emailService = require('./emailService');
const pdfService = require('./pdfService');
const interviewFeedbackEmailService = require('./interviewQuestionEmailService');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const { requireOrganizationBrand } = require('../utils/organizationBrand');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

const RETRY_BACKOFF_MINUTES = [2, 10];
const MAX_TASKS_PER_TICK = 20;
const STALE_PROCESSING_TIMEOUT_MINUTES = 15;

class MultiCandidateRetryService {
  constructor() {
    this.isRunning = false;
  }

  start() {
    console.log('🔄 Starting multi-candidate retry scheduler...');
    cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        return;
      }

      this.isRunning = true;
      try {
        await this.processQueuedRetries();
      } catch (error) {
        console.error('❌ Multi-candidate retry scheduler failed:', error);
      } finally {
        this.isRunning = false;
      }
    });
    console.log('✅ Multi-candidate retry scheduler started');
  }

  stop() {
    this.isRunning = false;
  }

  async enqueueRetryTask(taskPayload) {
    const task = await InterviewSlotRetryTask.create({
      ...taskPayload,
      nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MINUTES[0] * 60 * 1000),
      status: 'queued',
      attemptsMade: 0,
      maxAttempts: 2
    });

    return task;
  }

  async backfillSharedMeetingLinkForSession(sessionId, sharedMeetingLink) {
    if (!sessionId || !sharedMeetingLink) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const result = await InterviewSlotRetryTask.updateMany(
      {
        sessionId,
        status: 'queued',
        $or: [{ sharedMeetingLink: null }, { sharedMeetingLink: '' }]
      },
      { $set: { sharedMeetingLink } }
    );

    return {
      matchedCount: result?.matchedCount || result?.n || 0,
      modifiedCount: result?.modifiedCount || result?.nModified || 0
    };
  }

  async sendInitialRetryQueuedEmail({ recipientEmail, sessionId, queuedCount, failedSlots, organizationName }) {
    if (!recipientEmail || queuedCount <= 0) {
      return;
    }

    organizationName = requireOrganizationBrand(organizationName);

    const listHtml = failedSlots
      .map(slot => `<li>${slot.candidateName || 'Unknown candidate'} (${slot.startTime}) - ${slot.reason || 'Calendar creation failed'}</li>`)
      .join('');

    await emailService.sendUserNotification(
      recipientEmail,
      `${organizationName} - Interview scheduling retry queued (${queuedCount} slot${queuedCount > 1 ? 's' : ''})`,
      `We queued retries for ${queuedCount} slot(s) in session ${sessionId}.`,
      {
        senderName: organizationName,
        htmlContent: `
          <p>Multi-candidate scheduling completed with partial success.</p>
          <p><strong>Session:</strong> ${sessionId}</p>
          <p><strong>Queued retries:</strong> ${queuedCount}</p>
          <p>Failed slots queued for retry:</p>
          <ul>${listHtml}</ul>
          <p>Retries are scheduled automatically.</p>
        `
      }
    );
  }

  async recoverStaleProcessingTasks() {
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_TIMEOUT_MINUTES * 60 * 1000);
    const staleTasks = await InterviewSlotRetryTask.find({
      status: 'processing',
      lastAttemptAt: { $lte: staleCutoff }
    }).limit(MAX_TASKS_PER_TICK);

    if (!staleTasks.length) {
      return;
    }

    const touchedSessions = new Set();
    for (const task of staleTasks) {
      const nextAttemptNumber = (task.attemptsMade || 0) + 1;
      task.attemptsMade = nextAttemptNumber;
      task.lastError = `Recovered from stale processing state after ${STALE_PROCESSING_TIMEOUT_MINUTES} minutes`;

      if (nextAttemptNumber < (task.maxAttempts || 2)) {
        const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(nextAttemptNumber, RETRY_BACKOFF_MINUTES.length - 1)];
        task.status = 'queued';
        task.nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
      }

      await task.save();
      touchedSessions.add(task.sessionId);
    }

    for (const sessionId of touchedSessions) {
      const failedTask = staleTasks.find(task => task.sessionId === sessionId && task.status === 'failed');
      if (failedTask) {
        await this.sendFinalSummaryIfSessionResolved(sessionId, failedTask.reportEmail);
      }
    }
  }

  async claimNextQueuedTask(now) {
    return InterviewSlotRetryTask.findOneAndUpdate(
      {
        status: 'queued',
        nextAttemptAt: { $lte: now }
      },
      {
        $set: {
          status: 'processing',
          lastAttemptAt: new Date()
        }
      },
      {
        sort: { nextAttemptAt: 1 },
        new: true
      }
    );
  }

  async processQueuedRetries() {
    await this.recoverStaleProcessingTasks();

    const now = new Date();
    for (let i = 0; i < MAX_TASKS_PER_TICK; i += 1) {
      const task = await this.claimNextQueuedTask(now);
      if (!task) {
        break;
      }
      await this.processTask(task, { alreadyClaimed: true });
    }
  }

  async processTask(task, options = {}) {
    if (!options.alreadyClaimed) {
      task.status = 'processing';
      task.lastAttemptAt = new Date();
      await task.save();
    }

    try {
      const interviewer = await User.findById(task.interviewerId);
      if (!interviewer || !interviewer.calendarConnected || !interviewer.nylasGrantId) {
        throw new Error('Interviewer calendar is not connected');
      }

      const candidate = await Candidate.findById(task.slot.candidateId);
      if (!candidate) {
        throw new Error('Candidate not found for retry task');
      }

      const organization = await resolveOrganizationForEmail({
        organization: task.sessionContext?.organizationName
          ? { _id: task.organizationId, name: task.sessionContext.organizationName }
          : task.organizationId,
        organizationId: task.organizationId
      });
      const organizationName = decodeHtmlEntities(organization.name);
      task.sessionContext = task.sessionContext || {};
      task.sessionContext.organizationName = organizationName;

      const slotStartAt = new Date(task.slot.startTime);
      if (slotStartAt <= new Date()) {
        throw new Error('Retry skipped because slot start time is already in the past');
      }

      const accountCredentials = await this.getAccountCredentials(interviewer);
      const normalizedProvider = String(task.provider || '').toLowerCase();
      const conferencingProvider =
        normalizedProvider.includes('microsoft') ||
        normalizedProvider.includes('outlook') ||
        normalizedProvider.includes('azure') ||
        normalizedProvider.includes('teams')
          ? 'teams'
          : 'google_meet';
      let meetingLink = task.sharedMeetingLink || '';
      let calendarEvent = null;

      const candidateName = decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`);
      const eventTitle = decodeHtmlEntities(`Interview with ${candidateName} - ${task.slot.jobTitle || 'Interview'}`);
      const eventDescription = decodeHtmlEntities(
        task.slot.notes ||
          `Interview with ${candidateName} for ${task.slot.jobTitle || 'position'} (retried scheduling)`
      );

      const eventParticipants = this.buildEventParticipants({
        candidate,
        interviewer,
        additionalInterviewers: task.sessionContext?.additionalInterviewers || [],
        bccParticipants: task.sessionContext?.bccParticipants || [],
        ccParticipants: task.sessionContext?.ccParticipants || []
      });

      const conferencing = task.sessionContext?.interviewType === 'video'
        ? (meetingLink
            ? { provider: conferencingProvider, details: { url: meetingLink } }
            : { provider: conferencingProvider })
        : undefined;

      const calendarEventData = {
        title: eventTitle,
        description: eventDescription,
        startTime: new Date(task.slot.startTime).toISOString(),
        endTime: new Date(task.slot.endTime).toISOString(),
        organizationName,
        notifyParticipants: true,
        participants: eventParticipants,
        location: task.sessionContext?.location || meetingLink || 'Video Call',
        conferencing,
        addNotetaker: !!task.sessionContext?.addNotetaker,
        skipServiceNotetaker: true
      };

      calendarEvent = await nylasV3Service.createEvent(
        interviewer.nylasGrantId,
        calendarEventData,
        accountCredentials
      );

      if (!meetingLink) {
        meetingLink =
          calendarEvent.conferencing?.details?.url ||
          calendarEvent.conferencing?.details?.meeting_url ||
          calendarEvent.conferencing?.join_url ||
          '';
      }

      if (meetingLink && !task.sharedMeetingLink) {
        await InterviewSlotRetryTask.updateMany(
          {
            sessionId: task.sessionId,
            status: 'queued',
            _id: { $ne: task._id },
            $or: [{ sharedMeetingLink: null }, { sharedMeetingLink: '' }]
          },
          { $set: { sharedMeetingLink: meetingLink } }
        );
      }

      const bccParticipants = (task.sessionContext?.bccParticipants || [])
        .filter(p => p?.email)
        .map(p => ({ email: p.email, name: p.name || p.email, visibility: 'bcc', status: 'noreply' }));
      if (bccParticipants.length > 0) {
        const bccEventData = {
          ...calendarEventData,
          conferencing: meetingLink
            ? { provider: conferencingProvider, details: { url: meetingLink } }
            : calendarEventData.conferencing
        };
        await nylasV3Service.sendBccCalendarInvites(
          interviewer.nylasGrantId,
          bccEventData,
          bccParticipants,
          accountCredentials
        );
      }

      const participants = this.buildInterviewParticipants({
        candidate,
        interviewer,
        additionalInterviewers: task.sessionContext?.additionalInterviewers || [],
        bccParticipants: task.sessionContext?.bccParticipants || [],
        ccParticipants: task.sessionContext?.ccParticipants || []
      });

      const selectedQuestions = Array.isArray(task.sessionContext?.selectedQuestionIds)
        ? task.sessionContext.selectedQuestionIds
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id))
        : [];

      let notetakerDetails = {
        enabled: false,
        id: null,
        type: null,
        status: 'disabled',
        error: null
      };

      if (task.sessionContext?.addNotetaker) {
        try {
          notetakerDetails = await this.ensureSessionNotetaker({
            sessionId: task.sessionId,
            meetingLink,
            scheduledAt: task.sessionContext?.baseStartTime || task.slot.startTime,
            interviewer,
            accountCredentials
          });
        } catch (notetakerError) {
          console.error(`Failed to ensure notetaker for retry task ${task._id}:`, notetakerError.message);
          notetakerDetails = {
            enabled: false,
            id: null,
            type: 'standalone',
            status: 'failed',
            error: notetakerError.message
          };
        }
      }

      const interview = new Interview({
        candidateId: candidate._id,
        interviewerId: interviewer._id,
        jobId: task.slot.jobId || null,
        stageId: task.slot.stageId || null,
        organizationId: task.organizationId,
        scheduledAt: new Date(task.slot.startTime),
        duration: task.slot.duration,
        type: task.sessionContext?.interviewType || 'video',
        location: task.sessionContext?.location || meetingLink || 'Video Call',
        subject: decodeHtmlEntities(
          task.sessionContext?.subject ||
            `Interview Invitation - ${task.slot.jobTitle || 'Multi-Candidate Interview'}`
        ),
        description: eventDescription,
        status: 'scheduled',
        timezone: task.sessionContext?.timezone || 'UTC',
        nylasEventId: calendarEvent.id,
        isMultiCandidate: true,
        multiCandidateSessionId: task.sessionId,
        multiCandidateOrder: task.slot.order,
        participants,
        notifications: {
          candidateReminder: true,
          interviewerReminder: true,
          reminderTime: 24,
          sendQuestionsToInterviewers: !!task.sessionContext?.sendQuestionsToInterviewers,
          questionsSendTime: task.sessionContext?.questionsSendTime || 60,
          selectedQuestions
        },
        conferencing: meetingLink
          ? {
              provider: conferencingProvider,
              details: { url: meetingLink }
            }
          : undefined,
        notetakerEnabled: notetakerDetails.enabled,
        notetakerId: notetakerDetails.id,
        notetakerType: notetakerDetails.type,
        notetakerStatus: notetakerDetails.status,
        notetakerError: notetakerDetails.error
      });

      try {
        await interview.save();
      } catch (saveError) {
        if (calendarEvent?.id) {
          try {
            await nylasV3Service.deleteEvent(interviewer.nylasGrantId, calendarEvent.id, accountCredentials);
            console.log(`🧹 Deleted retry-created calendar event ${calendarEvent.id} after interview save failure`);
          } catch (deleteError) {
            console.error(`Failed to delete retry-created calendar event ${calendarEvent.id}:`, deleteError.message);
          }
        }
        throw saveError;
      }

      await this.syncPipelineForRecoveredInterview({
        interview,
        candidate,
        slot: task.slot
      });

      try {
        await this.sendRetryNotifications({
          interview,
          candidate,
          interviewer,
          meetingLink,
          slot: task.slot,
          sessionContext: task.sessionContext || {},
          organizationName
        });
      } catch (retryNotificationError) {
        console.error(`Retry notifications failed for task ${task._id}:`, retryNotificationError.message);
      }

      try {
        await this.sendImmediateFeedbackIfNeeded(interview._id);
      } catch (feedbackSendError) {
        console.error(`Immediate feedback send failed for retry interview ${interview._id}:`, feedbackSendError.message);
      }

      task.status = 'completed';
      task.completedAt = new Date();
      task.attemptsMade += 1;
      task.createdInterviewId = interview._id;
      task.createdEventId = calendarEvent.id;
      task.lastError = null;
      task.sharedMeetingLink = meetingLink || task.sharedMeetingLink || null;
      await task.save();

      await this.sendFinalSummaryIfSessionResolved(task.sessionId, task.reportEmail || interviewer.email);
    } catch (error) {
      const nextAttemptNumber = task.attemptsMade + 1;
      task.attemptsMade = nextAttemptNumber;
      task.lastError = error.message;

      if (nextAttemptNumber < task.maxAttempts) {
        const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(nextAttemptNumber, RETRY_BACKOFF_MINUTES.length - 1)];
        task.status = 'queued';
        task.nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
      }

      await task.save();

      if (task.status === 'failed') {
        await this.sendFinalSummaryIfSessionResolved(task.sessionId, task.reportEmail);
      }
    }
  }

  async sendImmediateFeedbackIfNeeded(interviewId) {
    const interview = await Interview.findById(interviewId)
      .populate('candidateId')
      .populate('jobId')
      .populate('notifications.selectedQuestions');

    if (!interview) {
      return;
    }

    if (!interview.notifications?.sendQuestionsToInterviewers || interview.notifications?.questionsSentAt) {
      return;
    }

    const now = new Date();
    const sendTime = new Date(interview.scheduledAt);
    sendTime.setMinutes(sendTime.getMinutes() - (interview.notifications.questionsSendTime || 60));

    if (now >= sendTime) {
      const sent = await interviewFeedbackEmailService.sendQuestionEmail(interview);
      if (sent) {
        interview.notifications.questionsSentAt = now;
        await interview.save();
      }
    }
  }

  async sendRetryNotifications({ interview, candidate, interviewer, meetingLink, slot, sessionContext, organizationName }) {
    const timezone = sessionContext?.timezone || 'UTC';
    organizationName = requireOrganizationBrand(organizationName);
    const interviewDate = new Date(slot.startTime).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone
    });
    const interviewTime = new Date(slot.startTime).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
      timeZoneName: 'short'
    });

    if (sessionContext.sendCustomEmail && candidate?.email) {
      const templateData = {
        candidateName: decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`),
        jobTitle: slot.jobTitle || 'Interview',
        interviewDate,
        interviewTime,
        duration: slot.duration,
        interviewType: (sessionContext.interviewType || 'video') === 'video' ? 'Video Call' : 'In-Person Meeting',
        meetingLink: meetingLink || null,
        notes: slot.notes || null,
        interviewerName: interviewer?.name || interviewer?.email || 'Interviewer',
        interviewerEmail: interviewer?.email || 'no-reply@smarthr.app',
        organizationName
      };
      let candidateInviteOptions = {};

      if (slot?.jobId) {
        try {
          const attachmentJob = await Job.findById(slot.jobId).select(
            'title description requirements responsibilities skills location type level experience education benefits'
          );
          const jobDescriptionAttachment = await pdfService.generateJobDescriptionPdfAttachment(attachmentJob, organizationName);
          if (jobDescriptionAttachment) {
            candidateInviteOptions = { attachments: [jobDescriptionAttachment] };
          }
        } catch (attachmentError) {
          console.error(`Failed to generate retry job description attachment for ${candidate.email}:`, attachmentError.message);
        }
      }

      try {
        await emailService.sendInterviewInviteEmail(
          candidate.email,
          templateData,
          sessionContext.emailTemplate || null,
          [],
          [],
          candidateInviteOptions
        );
      } catch (candidateEmailError) {
        console.error(`Failed to send retry invitation email to ${candidate.email}:`, candidateEmailError.message);
      }
    }

    const participants = (interview.participants || [])
      .filter(participant => participant.role !== 'candidate' && participant.email)
      .map(participant => ({
        email: participant.email,
        name: participant.name || participant.email.split('@')[0]
      }));

    const dedupedParticipants = [];
    const seen = new Set();
    for (const participant of participants) {
      const key = participant.email.toLowerCase().trim();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      dedupedParticipants.push(participant);
    }

    for (const participant of dedupedParticipants) {
      try {
        await emailService.sendUserNotification(
          participant.email,
          `${organizationName} - Interview notification: ${decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`)}`,
          'A previously failed interview slot has been successfully rescheduled.',
          {
            senderName: organizationName,
            htmlContent: `
              <p>Hello ${participant.name},</p>
              <p>A retry has successfully scheduled an interview slot.</p>
              <p><strong>Candidate:</strong> ${decodeHtmlEntities(`${candidate.firstName} ${candidate.lastName}`)}</p>
              <p><strong>Date:</strong> ${interviewDate}</p>
              <p><strong>Time:</strong> ${interviewTime}</p>
              <p><strong>Duration:</strong> ${slot.duration} minutes</p>
              ${meetingLink ? `<p><strong>Meeting Link:</strong> ${meetingLink}</p>` : ''}
              <p><strong>Feedback Link:</strong> ${(process.env.FRONTEND_URL || 'https://smarthr.aiinnigeria.com')}/public/feedback/${interview._id}</p>
            `
          }
        );
      } catch (participantNotificationError) {
        console.error(`Failed to send retry notification to ${participant.email}:`, participantNotificationError.message);
      }
    }
  }

  async syncPipelineForRecoveredInterview({ interview, candidate, slot }) {
    if (!slot?.jobId) {
      return;
    }

    try {
      const job = await Job.findById(slot.jobId);
      if (!job) {
        return;
      }

      const applicant = job.applicants?.find(
        app => app.candidate?.toString() === candidate._id.toString()
      );
      if (!applicant) {
        console.warn(`Pipeline applicant missing for recovered interview ${interview._id} (candidate ${candidate._id})`);
        return;
      }

      if (!Array.isArray(applicant.interviews)) {
        applicant.interviews = [];
      }

      const exists = applicant.interviews.some(
        interviewRef => interviewRef.interviewId?.toString() === interview._id.toString()
      );

      if (!exists) {
        applicant.interviews.push({
          interviewId: interview._id,
          stageId: slot.stageId || applicant.currentStage?.stageId || null,
          scheduledAt: interview.scheduledAt,
          status: 'scheduled'
        });
      }

      if (applicant.status !== 'interviewing') {
        applicant.status = 'interviewing';
      }

      await job.save();
    } catch (pipelineError) {
      console.error(`Failed to sync pipeline for recovered interview ${interview._id}:`, pipelineError.message);
    }
  }

  async ensureSessionNotetaker({ sessionId, meetingLink, scheduledAt, interviewer, accountCredentials }) {
    if (!meetingLink) {
      return {
        enabled: false,
        id: null,
        type: 'standalone',
        status: 'failed',
        error: 'Missing shared meeting link for notetaker setup'
      };
    }

    const existingSessionInterview = await Interview.findOne({
      multiCandidateSessionId: sessionId,
      notetakerId: { $ne: null },
      notetakerStatus: { $nin: ['failed', 'deleted', 'cancelled'] }
    }).sort({ createdAt: 1 });

    if (existingSessionInterview?.notetakerId) {
      return {
        enabled: true,
        id: existingSessionInterview.notetakerId,
        type: existingSessionInterview.notetakerType || 'standalone',
        status: existingSessionInterview.notetakerStatus || 'enabled',
        error: existingSessionInterview.notetakerError || null
      };
    }

    const joinAt = new Date(scheduledAt || Date.now());
    const joinTime = joinAt > new Date() ? joinAt : null;

    const notetakerResponse = await nylasV3Service.createStandaloneNotetaker(
      meetingLink,
      {
        name: 'SmartHR Notetaker Bot',
        videoRecording: true,
        audioRecording: true,
        transcription: true,
        summary: true
      },
      joinTime,
      accountCredentials
    );

    const notetakerId = notetakerResponse?.notetakerId || notetakerResponse?.id;
    if (!notetakerId) {
      throw new Error('Notetaker created without an ID');
    }

    await Interview.updateMany(
      {
        multiCandidateSessionId: sessionId,
        $or: [{ notetakerId: null }, { notetakerId: '' }]
      },
      {
        $set: {
          notetakerEnabled: true,
          notetakerId,
          notetakerType: 'standalone',
          notetakerStatus: 'enabled',
          notetakerError: null
        }
      }
    );

    return {
      enabled: true,
      id: notetakerId,
      type: 'standalone',
      status: 'enabled',
      error: null
    };
  }

  async sendFinalSummaryIfSessionResolved(sessionId, recipientEmail) {
    if (!recipientEmail) {
      return;
    }

    const pendingCount = await InterviewSlotRetryTask.countDocuments({
      sessionId,
      status: { $in: ['queued', 'processing'] }
    });

    if (pendingCount > 0) {
      return;
    }

    const pendingEmailCount = await InterviewSlotRetryTask.countDocuments({
      sessionId,
      finalStatusEmailSent: false
    });

    if (pendingEmailCount === 0) {
      return;
    }

    const tasks = await InterviewSlotRetryTask.find({ sessionId });
    const firstTask = tasks[0];
    const organization = await resolveOrganizationForEmail({
      organization: firstTask?.sessionContext?.organizationName
        ? { _id: firstTask.organizationId, name: firstTask.sessionContext.organizationName }
        : firstTask?.organizationId,
      organizationId: firstTask?.organizationId
    });
    const organizationName = decodeHtmlEntities(organization.name);
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');

    const completedHtml = completed.length
      ? `<ul>${completed.map(t => `<li>${t.slot.candidateName} (${new Date(t.slot.startTime).toLocaleString()})</li>`).join('')}</ul>`
      : '<p>None</p>';
    const failedHtml = failed.length
      ? `<ul>${failed.map(t => `<li>${t.slot.candidateName}: ${t.lastError || 'Unknown error'}</li>`).join('')}</ul>`
      : '<p>None</p>';

    await emailService.sendUserNotification(
      recipientEmail,
      `${organizationName} - Interview retry resolution for session ${sessionId}`,
      `Retries completed for session ${sessionId}.`,
      {
        senderName: organizationName,
        htmlContent: `
          <p>Retry processing completed for multi-candidate session <strong>${sessionId}</strong>.</p>
          <p><strong>Recovered slots:</strong> ${completed.length}</p>
          ${completedHtml}
          <p><strong>Permanent failures:</strong> ${failed.length}</p>
          ${failedHtml}
        `
      }
    );

    await InterviewSlotRetryTask.updateMany(
      { sessionId, finalStatusEmailSent: false },
      { $set: { finalStatusEmailSent: true } }
    );
  }

  buildEventParticipants({ candidate, interviewer, additionalInterviewers, bccParticipants, ccParticipants }) {
    const participants = [
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
      ...(additionalInterviewers || []).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        status: 'noreply'
      })),
      ...(bccParticipants || []).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        status: 'noreply',
        visibility: 'bcc'
      })),
      ...(ccParticipants || []).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        status: 'noreply',
        visibility: 'cc'
      }))
    ];

    return participants.filter(participant => participant.email);
  }

  buildInterviewParticipants({ candidate, interviewer, additionalInterviewers, bccParticipants, ccParticipants }) {
    const roleForParticipant = participant => (
      participant?.role === 'interviewer' ? 'interviewer' : 'observer'
    );
    const candidateEmail = String(candidate?.email || '').toLowerCase().trim();
    const isValidNonCandidateParticipant = participant =>
      participant?.email &&
      String(participant.email).toLowerCase().trim() !== candidateEmail &&
      participant.role !== 'candidate';

    const participants = [
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
      ...(additionalInterviewers || []).filter(isValidNonCandidateParticipant).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        role: roleForParticipant(participant),
        status: 'pending'
      })),
      ...(bccParticipants || []).filter(isValidNonCandidateParticipant).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        role: roleForParticipant(participant),
        status: 'pending'
      })),
      ...(ccParticipants || []).filter(isValidNonCandidateParticipant).map(participant => ({
        email: participant.email,
        name: decodeHtmlEntities(participant.name || participant.email),
        role: roleForParticipant(participant),
        status: 'pending'
      }))
    ];

    const deduped = [];
    const seen = new Set();
    for (const participant of participants) {
      if (!participant.email) {
        continue;
      }
      const key = participant.email.toLowerCase().trim();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(participant);
    }

    return deduped;
  }

  async getAccountCredentials(interviewer) {
    if (!interviewer?.nylasAccountId) {
      return null;
    }

    const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
    if (!nylasAccount) {
      return null;
    }

    return {
      apiKey: nylasAccount.apiKey,
      apiUri: nylasAccount.apiUri,
      region: nylasAccount.region,
      clientId: nylasAccount.clientId
    };
  }
}

module.exports = new MultiCandidateRetryService();
