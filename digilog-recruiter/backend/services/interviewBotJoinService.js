const prisma = require('../db/client');
const nylasV3Service = require('./nylasV3Service');

const ACTIVE_STATUSES = new Set(['joining', 'joined', 'recording', 'processing', 'completed']);
const TERMINAL_STATUSES = new Set(['cancelled', 'deleted']);
const REPLACEABLE_STATUSES = new Set(['pending', 'scheduled', 'enabled', 'failed', 'stopped']);

function mapNotetakerStatus(meetingState, state) {
  if (state === 'scheduled' || state === 'created') {
    return 'scheduled';
  }
  if (state === 'connected' || meetingState === 'in_call') {
    return 'recording';
  }
  if (meetingState === 'dispatched' && state === 'connecting') {
    return 'joining';
  }
  if (state === 'joining' || meetingState === 'joining') {
    return 'joining';
  }
  if (state === 'joined') {
    return 'joined';
  }
  if (meetingState === 'ended' || state === 'disconnected') {
    return 'processing';
  }
  if (meetingState === 'failed_entry' || state === 'failed_entry') {
    return 'failed';
  }
  if (state === 'completed') {
    return 'completed';
  }
  if (state === 'cancelled') {
    return 'cancelled';
  }
  if (state === 'processing' || meetingState === 'processing') {
    return 'processing';
  }
  if (state === 'recording' || meetingState === 'recording') {
    return 'recording';
  }
  return 'pending';
}

class InterviewBotJoinService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.isChecking = false;
    this.lastAttemptByInterview = new Map();
    this.intervalMs = 60 * 1000;
    this.retryThrottleMs = 2 * 60 * 1000;
    this.lookbackMs = 6 * 60 * 60 * 1000;
    this.preStartWindowMs = 1 * 60 * 1000;
    this.postEndWindowMs = 15 * 60 * 1000;
  }

  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('[BOT-JOIN] Starting interview bot join service');

    this.runCheck().catch((error) => {
      console.error('[BOT-JOIN] Initial check failed:', error.message);
    });

    this.intervalId = setInterval(() => {
      this.runCheck().catch((error) => {
        console.error('[BOT-JOIN] Periodic check failed:', error.message);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.isChecking = false;
    this.lastAttemptByInterview.clear();
    console.log('[BOT-JOIN] Interview bot join service stopped');
  }

  getMeetingLink(interview) {
    return interview?.conferencing?.details?.url || interview?.meetingLink || null;
  }

  isInJoinWindow(interview, now) {
    if (!interview?.scheduledAt || !interview?.duration) {
      return false;
    }

    const start = new Date(interview.scheduledAt).getTime();
    const end = start + interview.duration * 60 * 1000;
    const nowMs = now.getTime();

    return nowMs >= start - this.preStartWindowMs && nowMs <= end + this.postEndWindowMs;
  }

  wasAttemptedRecently(interviewId) {
    const last = this.lastAttemptByInterview.get(String(interviewId));
    if (!last) {
      return false;
    }

    return Date.now() - last < this.retryThrottleMs;
  }

  markAttempt(interviewId) {
    this.lastAttemptByInterview.set(String(interviewId), Date.now());
  }

  async getAccountCredentials(interviewer) {
    if (!interviewer?.nylasAccountId) {
      return null;
    }

    const nylasAccount = await prisma.nylasAccount.findUnique({ where: { id: interviewer.nylasAccountId } });
    if (!nylasAccount) {
      return null;
    }

    return {
      apiKey: nylasAccount.apiKey,
      region: nylasAccount.region,
      apiUri: nylasAccount.apiUri || 'https://api.us.nylas.com'
    };
  }

  async ensureJoined(interview, now) {
    if (!this.isInJoinWindow(interview, now)) {
      return;
    }

    const meetingLink = this.getMeetingLink(interview);
    if (!meetingLink) {
      return;
    }

    if (TERMINAL_STATUSES.has(interview.notetakerStatus)) {
      return;
    }

    if (ACTIVE_STATUSES.has(interview.notetakerStatus)) {
      return;
    }

    if (this.wasAttemptedRecently(interview._id)) {
      return;
    }

    const accountCredentials = await this.getAccountCredentials(interview.interviewerId);

    if (interview.notetakerId) {
      try {
        const existingNotetakerId = interview.notetakerId;
        const statusResponse = await nylasV3Service.getStandaloneNotetakerStatus(
          existingNotetakerId,
          accountCredentials
        );
        const statusData = statusResponse?.data || statusResponse || {};
        const mappedStatus = mapNotetakerStatus(
          statusData.meeting_state || 'unknown',
          statusData.state || statusData.status || 'unknown'
        );

        if (mappedStatus !== interview.notetakerStatus) {
          interview.notetakerStatus = mappedStatus;
          interview.notetakerType = 'standalone';
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notetakerStatus: mappedStatus, notetakerType: 'standalone' }
          });
        }

        if (ACTIVE_STATUSES.has(mappedStatus) || TERMINAL_STATUSES.has(mappedStatus)) {
          return;
        }

        if (!REPLACEABLE_STATUSES.has(mappedStatus)) {
          console.warn(
            `[BOT-JOIN] Interview ${interview._id} has existing notetaker ${existingNotetakerId} in non-replaceable state '${mappedStatus}', skipping to avoid duplicates`
          );
          return;
        }

        try {
          await nylasV3Service.cancelStandaloneNotetaker(existingNotetakerId, accountCredentials);
          interview.notetakerId = null;
          interview.notetakerStatus = 'cancelled';
          interview.notetakerType = 'standalone';
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notetakerId: null, notetakerStatus: 'cancelled', notetakerType: 'standalone' }
          });
        } catch (cancelError) {
          if (cancelError?.message?.includes('NOTETAKER_NOT_FOUND')) {
            interview.notetakerStatus = 'deleted';
            interview.notetakerId = null;
            await prisma.interview.update({
              where: { id: interview.id },
              data: { notetakerStatus: 'deleted', notetakerId: null }
            });
          } else {
            console.warn(
              `[BOT-JOIN] Could not cancel existing notetaker ${existingNotetakerId} for interview ${interview._id}: ${cancelError.message}`
            );
            return;
          }
        }
      } catch (statusError) {
        if (statusError?.message?.includes('NOTETAKER_NOT_FOUND')) {
          interview.notetakerStatus = 'deleted';
          interview.notetakerId = null;
          await prisma.interview.update({
            where: { id: interview.id },
            data: { notetakerStatus: 'deleted', notetakerId: null }
          });
        } else {
          console.warn(
            `[BOT-JOIN] Could not fetch status for interview ${interview._id}: ${statusError.message}`
          );
          return;
        }
      }
    }

    this.markAttempt(interview._id);

    const result = await nylasV3Service.createStandaloneNotetaker(
      meetingLink,
      {
        name: 'SmartHR Notetaker',
        videoRecording: true,
        audioRecording: true,
        transcription: true,
        summary: true
      },
      null,
      accountCredentials
    );

    const notetakerId = result?.notetakerId || result?.id;
    if (!notetakerId) {
      throw new Error('Nylas did not return a notetaker ID');
    }

    interview.notetakerEnabled = true;
    interview.notetakerId = notetakerId;
    interview.notetakerType = 'standalone';
    interview.notetakerStatus = 'joining';
    interview.notetakerError = null;
    await prisma.interview.update({
      where: { id: interview.id },
      data: {
        notetakerEnabled: true,
        notetakerId: notetakerId,
        notetakerType: 'standalone',
        notetakerStatus: 'joining',
        notetakerError: null
      }
    });

    console.log(
      `[BOT-JOIN] Triggered join for interview ${interview._id} with notetaker ${notetakerId}`
    );
  }

  async runCheck() {
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;
    const now = new Date();

    try {
      const staleAttemptCutoff = Date.now() - this.lookbackMs;
      for (const [interviewId, timestamp] of this.lastAttemptByInterview.entries()) {
        if (timestamp < staleAttemptCutoff) {
          this.lastAttemptByInterview.delete(interviewId);
        }
      }

      const lowerBound = new Date(now.getTime() - this.lookbackMs);
      const upperBound = new Date(now.getTime() + this.preStartWindowMs);

      const interviews = await prisma.interview.findMany({
        where: {
          status: { in: ['scheduled', 'confirmed', 'in_progress'] },
          notetakerEnabled: true,
          scheduledAt: { gte: lowerBound, lte: upperBound }
        }
      });

      if (!interviews.length) {
        return;
      }

      // Stitch interviewer (soft ref) — replaces .populate('interviewerId', 'nylasAccountId').
      const interviewerIds = [...new Set(interviews.map(i => i.interviewerId).filter(Boolean))];
      if (interviewerIds.length) {
        const interviewers = await prisma.user.findMany({
          where: { id: { in: interviewerIds } },
          select: { id: true, nylasAccountId: true }
        });
        const interviewerMap = new Map(interviewers.map(u => [u.id, u]));
        for (const interview of interviews) {
          interview.interviewerId = interview.interviewerId
            ? (interviewerMap.get(interview.interviewerId) || null)
            : null;
        }
      }

      for (const interview of interviews) {
        try {
          await this.ensureJoined(interview, now);
        } catch (error) {
          console.error(`[BOT-JOIN] Failed for interview ${interview._id}: ${error.message}`);
        }
      }
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new InterviewBotJoinService();
