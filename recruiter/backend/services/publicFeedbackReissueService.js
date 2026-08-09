'use strict';

const mongoose = require('mongoose');
const Interview = require('../models/Interview');
const publicFeedbackCapability = require('./publicFeedbackCapabilityService');

const ACTIONABLE_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'completed'];

function queryForLegacyInvitations({ organizationId, now = new Date() } = {}) {
  const query = {
    status: { $in: ACTIONABLE_STATUSES },
    publicFeedbackRevokedAt: null,
    'notifications.sendQuestionsToInterviewers': true,
    'notifications.questionsSentAt': { $ne: null },
    $or: [
      { publicFeedbackTokenHash: { $exists: false } },
      { publicFeedbackTokenExpiresAt: { $exists: false } },
      { publicFeedbackTokenExpiresAt: { $lte: now } }
    ]
  };
  if (organizationId) {
    if (!mongoose.isValidObjectId(organizationId)) {
      const error = new Error('organizationId must be a valid ObjectId');
      error.code = 'PUBLIC_FEEDBACK_REISSUE_ORGANIZATION_INVALID';
      throw error;
    }
    query.organizationId = new mongoose.Types.ObjectId(String(organizationId));
  }
  return query;
}

async function reissueActionableFeedbackInvitations({
  organizationId,
  limit = 100,
  send = false,
  sender
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const query = queryForLegacyInvitations({ organizationId });
  let interviews = await Interview.find(query)
    .sort({ scheduledAt: 1, _id: 1 })
    .limit(safeLimit)
    .select('_id organizationId status scheduledAt notifications candidateId jobId interviewerId participants');
  if (!send) {
    return {
      dryRun: true,
      eligible: interviews.length,
      interviewIds: interviews.map((interview) => String(interview._id))
    };
  }

  const sendInvitation = sender || (async (interview) => {
    const emailService = require('./interviewQuestionEmailService');
    const populated = await Interview.findById(interview._id)
      .populate('candidateId')
      .populate('jobId')
      .populate('notifications.selectedQuestions');
    return emailService.sendQuestionEmail(populated);
  });
  const results = [];
  for (const interview of interviews) {
    try {
      const sent = await sendInvitation(interview);
      if (sent === false) {
        await publicFeedbackCapability.clear(interview._id);
        results.push({ interviewId: String(interview._id), sent: false });
      } else {
        results.push({ interviewId: String(interview._id), sent: true });
      }
    } catch (error) {
      // sendQuestionEmail issues one shared capability before sequential
      // recipient delivery. If a later recipient fails, invalidate every link
      // from that partial attempt and leave the interview eligible for a full
      // rerun rather than silently skipping unsent recipients.
      await publicFeedbackCapability.clear(interview._id).catch(() => {});
      results.push({
        interviewId: String(interview._id),
        sent: false,
        error: String(error.message || error).slice(0, 300)
      });
    }
  }
  return {
    dryRun: false,
    eligible: interviews.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results
  };
}

module.exports = {
  ACTIONABLE_STATUSES,
  queryForLegacyInvitations,
  reissueActionableFeedbackInvitations
};
