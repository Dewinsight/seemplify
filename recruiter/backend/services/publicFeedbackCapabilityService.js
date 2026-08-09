const crypto = require('crypto');
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const Job = require('../models/Job');
const Organization = require('../models/Organization');

const DEFAULT_TTL_DAYS = Math.max(1, Number(process.env.PUBLIC_FEEDBACK_CAPABILITY_TTL_DAYS || 30));

function secret() {
  return process.env.PUBLIC_FEEDBACK_CAPABILITY_SECRET
    || process.env.JWT_SECRET
    || process.env.SESSION_SECRET
    || 'development-public-feedback-capability-secret';
}

function tokenFor(interviewId, expiresAt) {
  return crypto
    .createHmac('sha256', secret())
    .update(`public-feedback:${String(interviewId)}:${new Date(expiresAt).getTime()}`)
    .digest('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function hashesMatch(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function issue(interviewId) {
  if (!mongoose.isValidObjectId(interviewId)) return null;
  const now = new Date();
  let interview = await Interview.findById(interviewId)
    .select('+publicFeedbackTokenHash publicFeedbackTokenExpiresAt publicFeedbackRevokedAt status candidateId organizationId jobId');
  if (
    !interview
    || interview.status === 'cancelled'
    || interview.publicFeedbackRevokedAt
    || !(await hasActiveCandidate(interview))
  ) return null;

  if (interview.publicFeedbackTokenExpiresAt > now && interview.publicFeedbackTokenHash) {
    const existingToken = tokenFor(interview._id, interview.publicFeedbackTokenExpiresAt);
    if (hashesMatch(tokenHash(existingToken), interview.publicFeedbackTokenHash)) {
      return { token: existingToken, expiresAt: interview.publicFeedbackTokenExpiresAt, interview };
    }
  }

  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const token = tokenFor(interview._id, expiresAt);
  const updated = await Interview.findOneAndUpdate(
    {
      _id: interview._id,
      status: { $ne: 'cancelled' },
      publicFeedbackRevokedAt: null,
      $or: [
        { publicFeedbackTokenHash: { $exists: false } },
        { publicFeedbackTokenExpiresAt: { $exists: false } },
        { publicFeedbackTokenExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        publicFeedbackTokenHash: tokenHash(token),
        publicFeedbackTokenIssuedAt: now,
        publicFeedbackTokenExpiresAt: expiresAt
      }
    },
    { new: true }
  ).select('+publicFeedbackTokenHash publicFeedbackTokenExpiresAt publicFeedbackRevokedAt status candidateId organizationId jobId');

  if (updated) return { token, expiresAt, interview: updated };

  // Another notification may have established the capability concurrently.
  // Derivation from the winning persisted expiry means every concurrent sender
  // receives the same still-valid bearer value.
  interview = await Interview.findById(interviewId)
    .select('+publicFeedbackTokenHash publicFeedbackTokenExpiresAt publicFeedbackRevokedAt status candidateId organizationId jobId');
  if (
    !interview?.publicFeedbackTokenHash
    || interview.publicFeedbackTokenExpiresAt <= now
    || interview.status === 'cancelled'
    || interview.publicFeedbackRevokedAt
  ) return null;
  const winnerToken = tokenFor(interview._id, interview.publicFeedbackTokenExpiresAt);
  if (!hashesMatch(tokenHash(winnerToken), interview.publicFeedbackTokenHash)) return null;
  return { token: winnerToken, expiresAt: interview.publicFeedbackTokenExpiresAt, interview };
}

async function verify(interviewId, token, { candidateId } = {}) {
  if (!mongoose.isValidObjectId(interviewId) || !token) return null;
  const interview = await Interview.findOne({
    _id: interviewId,
    status: { $ne: 'cancelled' },
    publicFeedbackRevokedAt: null,
    publicFeedbackTokenExpiresAt: { $gt: new Date() }
  }).select('+publicFeedbackTokenHash candidateId organizationId jobId status publicFeedbackRevokedAt publicFeedbackTokenExpiresAt');
  if (!interview || !hashesMatch(tokenHash(token), interview.publicFeedbackTokenHash)) return null;
  if (candidateId && String(interview.candidateId || '') !== String(candidateId)) return null;
  if (!(await hasActiveCandidate(interview))) return null;
  return interview;
}

async function hasActiveCandidate(interview) {
  if (!interview?.candidateId) return false;
  const candidate = await Candidate.findOne({
    _id: interview.candidateId,
    deletionState: { $ne: 'tombstoned' }
  }).select('organization').lean();
  if (!candidate) return false;
  return Boolean(await Organization.exists({
    _id: candidate.organization,
    isActive: { $ne: false },
    erasureState: { $ne: 'tombstoned' }
  }));
}

async function revoke(interviewId, revokedAt = new Date()) {
  if (!mongoose.isValidObjectId(interviewId)) return false;
  const result = await Interview.updateOne(
    { _id: interviewId },
    {
      $set: { publicFeedbackRevokedAt: revokedAt },
      $unset: {
        publicFeedbackTokenHash: 1,
        publicFeedbackTokenIssuedAt: 1,
        publicFeedbackTokenExpiresAt: 1
      }
    }
  );
  return result.matchedCount > 0;
}

async function clear(interviewId) {
  if (!mongoose.isValidObjectId(interviewId)) return false;
  const result = await Interview.updateOne(
    { _id: interviewId, publicFeedbackRevokedAt: null },
    {
      $unset: {
        publicFeedbackTokenHash: 1,
        publicFeedbackTokenIssuedAt: 1,
        publicFeedbackTokenExpiresAt: 1
      }
    }
  );
  return Number(result.matchedCount || result.n || 0) > 0;
}

async function belongsToOrganization(interview, organizationId) {
  if (!interview || !mongoose.isValidObjectId(organizationId)) return false;
  if (interview.organizationId && String(interview.organizationId) === String(organizationId)) return true;
  return Boolean(await Job.exists({ _id: interview.jobId, organization: organizationId }));
}

async function feedbackUrl(interviewId, frontendUrl) {
  const capability = await issue(interviewId);
  if (!capability) return null;
  const base = String(frontendUrl || '').replace(/\/$/, '');
  return `${base}/public/feedback/${encodeURIComponent(String(interviewId))}?accessToken=${encodeURIComponent(capability.token)}`;
}

module.exports = {
  issue,
  verify,
  hasActiveCandidate,
  belongsToOrganization,
  feedbackUrl,
  clear,
  revoke,
  tokenHash
};
