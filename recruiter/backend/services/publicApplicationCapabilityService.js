'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Organization = require('../models/Organization');

const CAPABILITY_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.PUBLIC_APPLICATION_CAPABILITY_TTL_MS || 24 * 60 * 60 * 1000)
);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function issue({ organizationId, jobId, candidateId, requestKey } = {}) {
  if (!organizationId || !jobId || !candidateId || !requestKey) {
    throw new Error('Public application capability context is required');
  }
  const secret = String(
    process.env.PUBLIC_APPLICATION_CAPABILITY_SECRET
    || process.env.JWT_SECRET
    || 'development-only-public-application-capability-secret'
  );
  // A secret-keyed digest is opaque and pseudorandom to the caller while
  // remaining stable for concurrent exact replays of the original request.
  const token = crypto.createHmac('sha256', secret)
    .update(`v1:${organizationId}:${jobId}:${candidateId}:${requestKey}`)
    .digest('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + CAPABILITY_TTL_MS)
  };
}

function safeEqualDigest(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

function capabilityError(code = 'PUBLIC_APPLICATION_CAPABILITY_INVALID') {
  const error = new Error('This public application session is invalid or has expired');
  error.code = code;
  error.statusCode = 403;
  return error;
}

async function verify({ candidateId, jobId, organizationId, token }) {
  if (
    !mongoose.isValidObjectId(candidateId)
    || !mongoose.isValidObjectId(jobId)
    || !mongoose.isValidObjectId(organizationId)
    || !String(token || '').trim()
  ) {
    throw capabilityError();
  }
  const activeOrganization = await Organization.exists({
    _id: organizationId,
    isActive: { $ne: false },
    erasureState: { $ne: 'tombstoned' }
  });
  if (!activeOrganization) throw capabilityError();
  const candidate = await Candidate.findOne({
    _id: candidateId,
    organization: organizationId,
    jobAppliedFor: jobId,
    source: 'public',
    publicApplicationCommitState: 'committed',
    deletionState: { $ne: 'tombstoned' }
  }).select(
    '_id organization jobAppliedFor source processingMetadata '
    + '+publicApplicationCommitState +deletionState '
    + '+publicApplicationCapabilityHash +publicApplicationCapabilityExpiresAt '
    + '+publicApplicationRequestKey'
  );
  if (
    !candidate
    || !candidate.publicApplicationCapabilityHash
    || !candidate.publicApplicationCapabilityExpiresAt
    || candidate.publicApplicationCapabilityExpiresAt.getTime() <= Date.now()
    || !safeEqualDigest(hashToken(token), candidate.publicApplicationCapabilityHash)
  ) {
    throw capabilityError();
  }
  return candidate;
}

module.exports = {
  CAPABILITY_TTL_MS,
  hashToken,
  issue,
  verify
};
