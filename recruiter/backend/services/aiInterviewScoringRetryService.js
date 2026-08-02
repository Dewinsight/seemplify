const cron = require('node-cron');
const AIInterview = require('../models/AIInterview');
const AIInterviewSession = require('../models/AIInterviewSession');
const aiInterviewerService = require('./aiInterviewerService');
const { runWithAIRequestContext } = require('./aiRuntime/requestContext');

const MAX_PER_TICK = 10;
const STALE_PROCESSING_MINUTES = 15;

function retryDelayMinutes(attempts) {
  return Math.min(60, 2 ** Math.min(Math.max(1, Number(attempts) || 1), 5));
}

function scoringRequestId(sessionId) {
  return `ai-interview-score:${sessionId}`;
}

class AIInterviewScoringRetryService {
  constructor() {
    this.isRunning = false;
    this.task = null;
  }

  async finishScoring(session, interview, attempts) {
    try {
      const score = await aiInterviewerService.scoreInterview({ interview, session });
      session.scoring = {
        status: 'completed',
        attempts,
        overallScore: score.overallScore,
        recommendation: score.recommendation,
        summary: score.summary,
        strengths: score.strengths,
        concerns: score.concerns,
        questionScores: score.questionScores,
        raw: score.raw,
        error: null,
        scoredAt: new Date()
      };
    } catch (error) {
      const now = new Date();
      session.scoring = {
        status: 'queued',
        attempts,
        queuedAt: now,
        nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attempts) * 60 * 1000),
        error: error.message || 'Interview scoring is temporarily unavailable'
      };
    }
    await session.save();
    return session;
  }

  async scoreSession(session, interview) {
    const attempts = Number(session.scoring?.attempts || 0) + 1;
    session.scoring = {
      status: 'processing',
      attempts,
      startedAt: new Date(),
      error: null
    };
    await session.save();
    return this.finishScoring(session, interview, attempts);
  }

  async recoverStaleClaims() {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
    await AIInterviewSession.updateMany({
      status: 'completed',
      'scoring.status': 'processing',
      'scoring.startedAt': { $lte: staleBefore }
    }, {
      $set: {
        'scoring.status': 'queued',
        'scoring.queuedAt': new Date(),
        'scoring.nextAttemptAt': new Date(),
        'scoring.error': 'Recovered an interrupted scoring attempt'
      }
    });
  }

  async processQueuedScoring(limit = MAX_PER_TICK) {
    await this.recoverStaleClaims();
    let processed = 0;
    while (processed < limit) {
      const now = new Date();
      const session = await AIInterviewSession.findOneAndUpdate({
        status: 'completed',
        'scoring.status': 'queued',
        $or: [
          { 'scoring.nextAttemptAt': { $lte: now } },
          { 'scoring.nextAttemptAt': null },
          { 'scoring.nextAttemptAt': { $exists: false } }
        ]
      }, {
        $set: {
          'scoring.status': 'processing',
          'scoring.startedAt': now,
          'scoring.error': null
        },
        $inc: { 'scoring.attempts': 1 }
      }, { new: true, sort: { 'scoring.nextAttemptAt': 1 } });

      if (!session) break;
      const interview = await AIInterview.findById(session.aiInterview)
        .populate('organization', 'name')
        .populate('createdBy', 'email profile');
      if (!interview) {
        session.scoring.status = 'failed';
        session.scoring.error = 'The interview record no longer exists';
        await session.save();
        processed += 1;
        continue;
      }

      const context = {
        sourceApp: 'recruiter-worker',
        organizationId: interview.organization?._id || interview.organization,
        organizationName: interview.organization?.name,
        actorId: interview.createdBy?._id || interview.createdBy,
        actorName: interview.createdBy?.profile?.displayName,
        actorEmail: interview.createdBy?.email,
        interviewId: interview._id,
        sessionId: session._id,
        jobId: interview.job,
        candidateId: session.candidate,
        // The logical scoring operation keeps one identity across durable
        // retries so a recovered local response is replayed, never rerun.
        requestId: scoringRequestId(session._id)
      };
      await runWithAIRequestContext(context, () => (
        this.finishScoring(session, interview, Number(session.scoring.attempts || 1))
      ));
      processed += 1;
    }
    return processed;
  }

  start() {
    if (this.task) return;
    this.task = cron.schedule('* * * * *', async () => {
      if (this.isRunning) return;
      this.isRunning = true;
      try {
        await this.processQueuedScoring();
      } catch (error) {
        console.error('AI Interview scoring retry failed:', error.message);
      } finally {
        this.isRunning = false;
      }
    });
  }

  stop() {
    this.task?.stop();
    this.task = null;
    this.isRunning = false;
  }
}

const service = new AIInterviewScoringRetryService();

module.exports = service;
module.exports.AIInterviewScoringRetryService = AIInterviewScoringRetryService;
module.exports.retryDelayMinutes = retryDelayMinutes;
module.exports.scoringRequestId = scoringRequestId;
