const { randomUUID } = require('node:crypto');
const Interview = require('../models/Interview');
const NylasAccount = require('../models/NylasAccount');
const nylasV3Service = require('./nylasV3Service');
const {
  ACTIVE_JOIN_STATUSES: ACTIVE_STATUSES,
  getNotetakerJoinAction,
  mapNylasNotetakerStatus
} = require('./notetakerJoinPolicy');

const TERMINAL_STATUSES = new Set(['cancelled', 'deleted']);

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

    const nylasAccount = await NylasAccount.findById(interviewer.nylasAccountId).select('+apiKey');
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

    const lockToken = randomUUID();
    const lockExpiresAt = new Date(now.getTime() + 2 * 60 * 1000);
    const lockedInterview = await Interview.findOneAndUpdate(
      {
        _id: interview._id,
        $or: [
          { 'notetakerJoinLock.expiresAt': { $exists: false } },
          { 'notetakerJoinLock.expiresAt': { $lte: now } }
        ]
      },
      {
        $set: {
          notetakerJoinLock: {
            token: lockToken,
            expiresAt: lockExpiresAt
          }
        }
      },
      { new: true }
    ).populate('interviewerId', 'nylasAccountId');

    if (!lockedInterview) {
      return;
    }

    interview = lockedInterview;

    try {
    const accountCredentials = await this.getAccountCredentials(interview.interviewerId);

    if (interview.notetakerId) {
      try {
        const existingNotetakerId = interview.notetakerId;
        const statusResponse = await nylasV3Service.getStandaloneNotetakerStatus(
          existingNotetakerId,
          accountCredentials
        );
        const statusData = statusResponse?.data || statusResponse || {};
        const mappedStatus = mapNylasNotetakerStatus(
          statusData.meeting_state || 'unknown',
          statusData.state || statusData.status || 'unknown'
        );

        if (mappedStatus !== interview.notetakerStatus) {
          interview.notetakerStatus = mappedStatus;
          interview.notetakerType = 'standalone';
          await interview.save();
        }

        const joinAction = getNotetakerJoinAction(existingNotetakerId, mappedStatus);

        if (joinAction === 'already-active' || TERMINAL_STATUSES.has(mappedStatus)) {
          return;
        }

        if (joinAction === 'dispatch-existing') {
          let existingBotMissing = false;
          try {
            await nylasV3Service.dispatchStandaloneNotetakerNow(
              existingNotetakerId,
              accountCredentials,
              { name: 'Nyla' }
            );
            interview.notetakerEnabled = true;
            interview.notetakerStatus = 'joining';
            interview.notetakerType = 'standalone';
            interview.notetakerError = null;
            await interview.save();
            this.markAttempt(interview._id);
          } catch (dispatchError) {
            if (dispatchError?.message?.includes('NOTETAKER_NOT_FOUND')) {
              interview.notetakerStatus = 'deleted';
              interview.notetakerId = null;
              await interview.save();
              existingBotMissing = true;
            } else {
              console.warn(
                `[BOT-JOIN] Could not dispatch existing Nyla bot ${existingNotetakerId} for interview ${interview._id}: ${dispatchError.message}`
              );
            }
          }
          if (!existingBotMissing) {
            return;
          }
        }

        if (joinAction !== 'replace-failed' && interview.notetakerId) {
          console.warn(
            `[BOT-JOIN] Interview ${interview._id} has existing notetaker ${existingNotetakerId} in non-replaceable state '${mappedStatus}', skipping to avoid duplicates`
          );
          return;
        }
      } catch (statusError) {
        if (statusError?.message?.includes('NOTETAKER_NOT_FOUND')) {
          interview.notetakerStatus = 'deleted';
          interview.notetakerId = null;
          await interview.save();
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
        name: 'Nyla',
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
    await interview.save();

    console.log(
      `[BOT-JOIN] Triggered join for interview ${interview._id} with notetaker ${notetakerId}`
    );
    } finally {
      try {
        await Interview.updateOne(
          {
            _id: interview._id,
            'notetakerJoinLock.token': lockToken
          },
          { $unset: { notetakerJoinLock: 1 } }
        );
      } catch (lockError) {
        console.warn(
          `[BOT-JOIN] Failed to release join lock for interview ${interview._id}: ${lockError.message}`
        );
      }
    }
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

      const interviews = await Interview.find({
        status: { $in: ['scheduled', 'confirmed', 'in_progress'] },
        notetakerEnabled: true,
        scheduledAt: { $gte: lowerBound, $lte: upperBound }
      }).populate('interviewerId', 'nylasAccountId');

      if (!interviews.length) {
        return;
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
