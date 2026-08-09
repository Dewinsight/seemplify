'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const ChatSession = require('../models/ChatSession');
const CVProcessingAudit = require('../models/CVProcessingAudit');
const CVProcessingBatch = require('../models/CVProcessingBatch');
const CVProcessingJob = require('../models/CVProcessingJob');
const Interview = require('../models/Interview');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const OrganizationInvite = require('../models/OrganizationInvite');
const User = require('../models/User');
const organizationCvWriteFence = require('./organizationCvWriteFenceService');

function erasureError(code, message, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function loadOrganization(organizationId) {
  if (!mongoose.isValidObjectId(organizationId)) return null;
  return Organization.findById(organizationId)
    .select('+erasureState +erasureToken +erasureRequestedAt +erasureLastError');
}

async function commitOrganizationTombstone(organizationId) {
  let organization = await loadOrganization(organizationId);
  if (!organization) return null;
  if (organization.erasureState === 'tombstoned' && organization.erasureToken) return organization;

  const erasureToken = crypto.randomUUID();
  const requestedAt = new Date();
  const result = await Organization.updateOne(
    { _id: organizationId, erasureState: { $ne: 'tombstoned' } },
    {
      $set: {
        isActive: false,
        erasureState: 'tombstoned',
        erasureToken,
        erasureRequestedAt: requestedAt,
        name: `[deleted organization ${String(organizationId).slice(-6)}]`
      },
      $unset: {
        erasureLastError: 1,
        description: 1,
        industry: 1,
        size: 1,
        website: 1,
        logo: 1,
        idpOrganizationId: 1,
        settings: 1,
        subscription: 1,
        owner: 1,
        members: 1
      }
    }
  );
  if (!Number(result.matchedCount || result.n || 0)) {
    organization = await loadOrganization(organizationId);
    if (organization?.erasureState === 'tombstoned' && organization.erasureToken) return organization;
    throw erasureError(
      'ORGANIZATION_ERASURE_TOMBSTONE_FAILED',
      'Organization deletion could not be committed safely. Please retry.'
    );
  }
  return loadOrganization(organizationId);
}

async function forEachOrganizationJobPage(organizationId, handler, pageSize = 500) {
  const size = Math.min(Math.max(Number(pageSize) || 500, 1), 500);
  const tail = await Job.findOne({ organization: organizationId })
    .sort({ _id: -1 })
    .select('_id')
    .lean();
  if (!tail) return 0;
  let cursor;
  let examined = 0;
  while (true) {
    const jobs = await Job.find({
      organization: organizationId,
      _id: {
        ...(cursor ? { $gt: cursor } : {}),
        $lte: tail._id
      }
    }).select('_id').sort({ _id: 1 }).limit(size).lean();
    if (!jobs.length) break;
    await handler(jobs.map((job) => job._id));
    examined += jobs.length;
    cursor = jobs.at(-1)._id;
    if (String(cursor) === String(tail._id)) break;
  }
  return examined;
}

async function revokeOrganizationInterviews(organizationId) {
  const revokedAt = new Date();
  const revoke = {
    $set: {
      status: 'cancelled',
      cancelledAt: revokedAt,
      publicFeedbackRevokedAt: revokedAt
    },
    $unset: {
      publicFeedbackTokenHash: 1,
      publicFeedbackTokenIssuedAt: 1,
      publicFeedbackTokenExpiresAt: 1
    }
  };
  await Interview.updateMany({ organizationId }, revoke);
  await forEachOrganizationJobPage(organizationId, async (jobIds) => {
    await Interview.updateMany({ jobId: { $in: jobIds } }, revoke);
  });
}

async function deleteOrganizationInterviews(organizationId) {
  await Interview.deleteMany({ organizationId });
  await forEachOrganizationJobPage(organizationId, async (jobIds) => {
    await Interview.deleteMany({ jobId: { $in: jobIds } });
  });
}

async function eraseCandidateSnapshot(organizationId, cvQueue, pageSize) {
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const tail = await Candidate.findOne({ organization: organizationId })
    .sort({ _id: -1 })
    .select('_id')
    .lean();
  if (!tail) return { examined: 0, failures: 0 };
  let cursor;
  let examined = 0;
  let failures = 0;
  while (true) {
    const candidates = await Candidate.find({
      organization: organizationId,
      _id: {
        ...(cursor ? { $gt: cursor } : {}),
        $lte: tail._id
      }
    }).select('_id').sort({ _id: 1 }).limit(size).lean();
    if (!candidates.length) break;
    examined += candidates.length;
    for (const candidate of candidates) {
      try {
        const result = await cvQueue.eraseCandidateProcessingData(organizationId, [candidate._id]);
        if (!result.candidates[0]?.hardDeleted) failures += 1;
      } catch {
        // Continue through the entire snapshot. The durable organization
        // tombstone and final zero assertion keep failed rows hidden and make
        // them eligible for the next maintenance pass.
        failures += 1;
      }
    }
    cursor = candidates.at(-1)._id;
    if (String(cursor) === String(tail._id)) break;
  }
  return { examined, failures };
}

async function deleteCvOperationalRows(organizationId) {
  await Promise.all([
    CVProcessingAudit.deleteMany({
      $or: [
        { organization: organizationId },
        { organizationKey: String(organizationId) }
      ]
    }),
    CVProcessingBatch.deleteMany({ organization: organizationId }),
    CVProcessingJob.deleteMany({ organization: organizationId })
  ]);
}

async function cvTenantCounts(organizationId) {
  const [candidates, jobs, audits, batches] = await Promise.all([
    Candidate.countDocuments({ organization: organizationId }),
    CVProcessingJob.countDocuments({ organization: organizationId }),
    CVProcessingAudit.countDocuments({
      $or: [
        { organization: organizationId },
        { organizationKey: String(organizationId) }
      ]
    }),
    CVProcessingBatch.countDocuments({ organization: organizationId })
  ]);
  return { candidates, jobs, audits, batches };
}

async function runOrganizationCleanup(organization, { candidatePageSize = 100 } = {}) {
  const organizationId = organization._id;
  const erasureToken = organization.erasureToken;
  const cvQueue = require('./cvAnalysisQueueService');

  // Fail public submissions immediately and revoke every public-feedback
  // capability before any slower provider cleanup begins.
  await Job.updateMany(
    { organization: organizationId },
    { $set: { isPublic: false, isInternalEnabled: false, status: 'paused' } }
  );
  await revokeOrganizationInterviews(organizationId);

  // Do not begin provider erasure while a pre-tombstone writer can still
  // finish a GridFS/Cloudinary/vector/notification/audit side effect. The
  // tombstone has already closed new acquisition, so maintenance can safely
  // resume once these bounded leases release or expire.
  const initialLiveWriters = await organizationCvWriteFence.liveCount(organizationId);
  if (initialLiveWriters) {
    throw erasureError(
      'ORGANIZATION_WRITER_DRAIN_PENDING',
      `Organization deletion is waiting for ${initialLiveWriters} active writer(s)`
    );
  }

  let candidateCount = 0;
  let redactionError;
  // Two bounded snapshots let a transient first-row failure recover without
  // starving later candidates. New writes are fenced by the organization
  // lease and the tombstone blocks any new lease acquisition.
  for (let pass = 0; pass < 2; pass += 1) {
    const candidatePass = await eraseCandidateSnapshot(organizationId, cvQueue, candidatePageSize);
    candidateCount += candidatePass.examined;
    try {
      await cvQueue.redactOrganizationProcessingData(organizationId, {
        pageSize: candidatePageSize
      });
      redactionError = undefined;
    } catch (error) {
      redactionError = error;
    }
  }

  const liveWriters = await organizationCvWriteFence.liveCount(organizationId);
  const remainingCandidates = await Candidate.countDocuments({ organization: organizationId });
  if (liveWriters || remainingCandidates || redactionError) {
    const error = erasureError(
      'ORGANIZATION_CANDIDATE_ERASURE_PENDING',
      `Organization deletion is waiting for ${remainingCandidates} candidate erasure(s) and ${liveWriters} active writer(s)`
    );
    error.cause = redactionError;
    throw error;
  }

  // Cleanup tasks are now durable and CV rows contain no direct identifiers.
  // Removing operational rows avoids dangling tenant history while failed
  // provider tasks keep retrying independently of the organization record.
  await deleteCvOperationalRows(organizationId);
  await Promise.all([
    ChatSession.deleteMany({ organizationId }),
    OrganizationInvite.deleteMany({ organization: organizationId }),
    Notification.deleteMany({
      $or: [
        { 'data.organizationId': organizationId },
        { 'data.organizationId': String(organizationId) }
      ]
    })
  ]);
  // One last quiescent drain handles a writer that acquired its lease just
  // before the tombstone and finished after the first snapshot. Hard deletion
  // remains impossible while such a lease is live.
  const lateCandidates = await eraseCandidateSnapshot(organizationId, cvQueue, candidatePageSize);
  candidateCount += lateCandidates.examined;
  await cvQueue.redactOrganizationProcessingData(organizationId, {
    pageSize: candidatePageSize
  });
  if (await organizationCvWriteFence.liveCount(organizationId)) {
    throw erasureError(
      'ORGANIZATION_WRITER_DRAIN_PENDING',
      'Organization deletion is waiting for active CV or application writes'
    );
  }
  await deleteCvOperationalRows(organizationId);
  const remainingCv = await cvTenantCounts(organizationId);
  if (Object.values(remainingCv).some((count) => count > 0)) {
    const error = erasureError(
      'ORGANIZATION_CV_DRAIN_PENDING',
      'Organization deletion is waiting for a final CV data drain'
    );
    error.remaining = remainingCv;
    throw error;
  }

  await deleteOrganizationInterviews(organizationId);
  await Job.deleteMany({ organization: organizationId });
  await User.updateMany(
    { 'organizationMemberships.organization': organizationId },
    {
      $pull: { organizationMemberships: { organization: organizationId } },
      $unset: { currentOrganization: 1 }
    }
  );

  const removed = await Organization.deleteOne({
    _id: organizationId,
    erasureState: 'tombstoned',
    erasureToken,
    cvWriteLeases: {
      $not: { $elemMatch: { expiresAt: { $gt: new Date() } } }
    }
  });
  return {
    organizationId: String(organizationId),
    tombstoned: true,
    hardDeleted: Number(removed.deletedCount || removed.n || 0) === 1,
    pending: Number(removed.deletedCount || removed.n || 0) !== 1,
    candidateCount
  };
}

async function eraseOrganization(organizationId) {
  const organization = await commitOrganizationTombstone(organizationId);
  if (!organization) {
    return { organizationId: String(organizationId), missing: true, hardDeleted: true, pending: false };
  }
  try {
    return await runOrganizationCleanup(organization);
  } catch (error) {
    await Organization.updateOne(
      { _id: organization._id, erasureState: 'tombstoned' },
      { $set: { erasureLastError: String(error.message || error).slice(0, 1000) } }
    ).catch(() => {});
    return {
      organizationId: String(organization._id),
      tombstoned: true,
      hardDeleted: false,
      pending: true,
      errorCode: error.code || 'ORGANIZATION_ERASURE_PENDING'
    };
  }
}

async function recoverOrganizationErasures({ limit = 20 } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const snapshotTail = await Organization.findOne({ erasureState: 'tombstoned' })
    .sort({ _id: -1 })
    .select('_id')
    .lean();
  if (!snapshotTail) return { examined: 0, recovered: 0 };
  let examined = 0;
  let recovered = 0;
  let cursor = null;
  while (true) {
    const organizations = await Organization.find({
      erasureState: 'tombstoned',
      _id: {
        ...(cursor ? { $gt: cursor } : {}),
        $lte: snapshotTail._id
      }
    })
      .select('+erasureState +erasureToken +erasureRequestedAt')
      .sort({ _id: 1 })
      .limit(pageSize);
    if (!organizations.length) break;
    examined += organizations.length;
    for (const organization of organizations) {
      const result = await eraseOrganization(organization._id);
      if (result.hardDeleted) recovered += 1;
    }
    cursor = organizations.at(-1)._id;
    if (String(cursor) === String(snapshotTail._id)) break;
  }
  return { examined, recovered };
}

module.exports = {
  commitOrganizationTombstone,
  eraseOrganization,
  recoverOrganizationErasures,
  runOrganizationCleanup
};
