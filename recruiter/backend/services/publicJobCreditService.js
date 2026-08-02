const mongoose = require('mongoose');
const Job = require('../models/Job');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');

const CREDIT_PRECISION = 6;

function publicCreditError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.permanent = true;
  return error;
}

function roundCredits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw publicCreditError(
      'PUBLIC_JOB_CREDIT_VALUE_INVALID',
      'Public job credit values are invalid'
    );
  }
  return Number(numeric.toFixed(CREDIT_PRECISION));
}

function validUnitCost(value) {
  if (value === undefined || value === null || value === '') return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function normalizeApplyLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw publicCreditError(
      'INVALID_APPLY_LIMIT',
      'Candidate apply limit must be a positive integer'
    );
  }
  return limit;
}

async function getCurrentUploadCandidateCost(organizationId, { session } = {}) {
  const organizationQuery = Organization.findById(organizationId)
    .select('subscription.plan')
    .lean();
  if (session) organizationQuery.session(session);
  const organization = await organizationQuery;
  if (!organization) {
    throw publicCreditError(
      'PUBLIC_JOB_ORGANIZATION_NOT_FOUND',
      'The organization for this public job no longer exists',
      404
    );
  }

  const planQuery = Plan.findOne({ code: organization.subscription?.plan })
    .select('credits.creditCosts.uploadCandidate')
    .lean();
  if (session) planQuery.session(session);
  const plan = await planQuery;
  const configured = Number(plan?.credits?.creditCosts?.uploadCandidate);
  if (!Number.isFinite(configured) || configured < 0) {
    throw publicCreditError(
      'PUBLIC_JOB_CREDIT_COST_UNAVAILABLE',
      'The public application credit cost is not configured'
    );
  }
  return Math.ceil(configured);
}

/**
 * Legacy jobs predate the locked unit-cost field. Their prepaid total and
 * limit are the strongest historical evidence: deriving total / limit keeps
 * the existing pool financially unchanged even if the plan has since changed.
 */
async function deriveLegacyUnitCost(job, { session } = {}) {
  const reservedCredits = Number(job.reservedCredits || 0);
  const limit = Number(job.candidateApplyLimit || 0);
  if (reservedCredits > 0 && Number.isFinite(reservedCredits) && limit > 0) {
    const derived = roundCredits(reservedCredits / limit);
    // Public application costs have historically been normalized to whole
    // credits. A fractional ratio indicates a partially funded/inconsistent
    // legacy pool, not reliable evidence of its unit price.
    if (Number.isSafeInteger(derived)) return derived;
  }

  const reservationCosts = (job.publicApplicationReservations || [])
    .map((reservation) => Number(reservation.creditCost))
    .filter(validUnitCost);
  if (
    reservationCosts.length > 0
    && reservationCosts.every((cost) => cost === reservationCosts[0])
  ) {
    return roundCredits(reservationCosts[0]);
  }

  // With no funded historical pool, the current plan is only a fallback
  // anchor. A positive cost still cannot admit an application while
  // reservedCredits is zero; an explicit settings update funds the pool.
  return getCurrentUploadCandidateCost(job.organization, { session });
}

async function resolveUnitCost(job, { session, persistLegacy = false } = {}) {
  if (validUnitCost(job.publicApplicationCreditUnitCost)) {
    return roundCredits(job.publicApplicationCreditUnitCost);
  }

  const derived = await deriveLegacyUnitCost(job, { session });
  if (persistLegacy) {
    const update = {
      $set: { publicApplicationCreditUnitCost: derived }
    };
    const options = {};
    if (session) options.session = session;
    const persisted = await Job.findOneAndUpdate(
      {
        _id: job._id,
        organization: job.organization,
        isPublic: true,
        $or: [
          { publicApplicationCreditUnitCost: { $exists: false } },
          { publicApplicationCreditUnitCost: null }
        ]
      },
      update,
      { ...options, new: true }
    ).lean();
    if (persisted && validUnitCost(persisted.publicApplicationCreditUnitCost)) {
      job.publicApplicationCreditUnitCost = persisted.publicApplicationCreditUnitCost;
      return roundCredits(persisted.publicApplicationCreditUnitCost);
    }

    const currentQuery = Job.findById(job._id)
      .select('publicApplicationCreditUnitCost')
      .lean();
    if (session) currentQuery.session(session);
    const current = await currentQuery;
    if (validUnitCost(current?.publicApplicationCreditUnitCost)) {
      job.publicApplicationCreditUnitCost = current.publicApplicationCreditUnitCost;
      return roundCredits(current.publicApplicationCreditUnitCost);
    }
  }
  return derived;
}

function unusedReservedCredits(job, unitCost) {
  const reserved = Math.max(0, Number(job.reservedCredits || 0));
  const used = Math.max(
    0,
    roundCredits(Number(job.publicApplicationCount || 0) * unitCost)
  );
  return roundCredits(Math.max(0, reserved - used));
}

function ensureCreditUsage(organization) {
  if (!organization.subscription) organization.subscription = {};
  if (!organization.subscription.creditUsage) {
    organization.subscription.creditUsage = {
      totalCredits: 0,
      usedCredits: 0,
      remainingCredits: 0,
      transactions: []
    };
  }
  const usage = organization.subscription.creditUsage;
  if (!Array.isArray(usage.transactions)) usage.transactions = [];
  return usage;
}

function transactionMetadata({
  type,
  reason,
  unitCost,
  targetLimit,
  operation
}) {
  return {
    type,
    reason,
    publicApplicationCreditUnitCost: unitCost,
    targetApplyLimit: targetLimit,
    operation
  };
}

async function adjustOrganizationCredits({
  organizationId,
  jobId,
  delta,
  session,
  actorId,
  reason,
  unitCost,
  targetLimit,
  operation
}) {
  const amount = roundCredits(Math.abs(delta));
  if (amount === 0) return null;

  const organization = await Organization.findById(organizationId).session(session);
  if (!organization) {
    throw publicCreditError(
      'PUBLIC_JOB_ORGANIZATION_NOT_FOUND',
      'The organization for this public job no longer exists',
      404
    );
  }

  const usage = ensureCreditUsage(organization);
  const remaining = Number(usage.remainingCredits || 0);
  const used = Number(usage.usedCredits || 0);
  const isReservation = delta > 0;
  if (isReservation && remaining < amount) {
    throw publicCreditError(
      'INSUFFICIENT_CREDITS',
      `Insufficient credits. Need ${amount} credits, but only ${remaining} available.`
    );
  }

  usage.remainingCredits = roundCredits(
    isReservation ? remaining - amount : remaining + amount
  );
  usage.usedCredits = roundCredits(
    isReservation ? used + amount : Math.max(0, used - amount)
  );
  usage.transactions.push({
    action: isReservation ? 'creditPurchase' : 'creditRefund',
    credits: amount,
    entityId: jobId,
    entityType: 'job',
    ...(mongoose.isValidObjectId(actorId) ? { performedBy: actorId } : {}),
    timestamp: new Date(),
    balanceAfter: usage.remainingCredits,
    metadata: transactionMetadata({
      type: isReservation ? 'public_job_reservation' : 'public_job_refund',
      reason,
      unitCost,
      targetLimit,
      operation
    })
  });
  organization.markModified('subscription.creditUsage');
  await organization.save({ session });
  return amount;
}

async function applyPublicSettings({
  job,
  targetIsPublic,
  candidateApplyLimit,
  session,
  actorId,
  operation = 'settings_update'
}) {
  const wasPublic = job.isPublic === true;
  if (targetIsPublic !== undefined && typeof targetIsPublic !== 'boolean') {
    throw publicCreditError(
      'PUBLIC_JOB_VISIBILITY_INVALID',
      'Public job visibility must be a boolean'
    );
  }
  const willBePublic = targetIsPublic === undefined
    ? wasPublic
    : targetIsPublic === true;

  if (willBePublic) {
    const targetLimit = normalizeApplyLimit(
      candidateApplyLimit === undefined
        ? job.candidateApplyLimit
        : candidateApplyLimit
    );
    const applicationCount = Number(job.publicApplicationCount || 0);
    if (wasPublic && targetLimit < applicationCount) {
      throw publicCreditError(
        'PUBLIC_APPLY_LIMIT_BELOW_USAGE',
        `Candidate apply limit cannot be lower than the ${applicationCount} applications already received`
      );
    }

    const unitCost = wasPublic
      ? await resolveUnitCost(job, { session })
      : await getCurrentUploadCandidateCost(job.organization, { session });
    const requiredCredits = roundCredits(targetLimit * unitCost);
    const currentReserved = wasPublic ? Number(job.reservedCredits || 0) : 0;
    const delta = roundCredits(requiredCredits - currentReserved);
    if (delta !== 0) {
      await adjustOrganizationCredits({
        organizationId: job.organization,
        jobId: job._id,
        delta,
        session,
        actorId,
        reason: delta > 0 ? 'Public application pool funded' : 'Apply limit reduced',
        unitCost,
        targetLimit,
        operation
      });
    }

    job.isPublic = true;
    job.candidateApplyLimit = targetLimit;
    job.reservedCredits = requiredCredits;
    job.publicApplicationCreditUnitCost = unitCost;
    if (!wasPublic) {
      job.publicApplicationCount = 0;
      job.publicApplicationReservations = [];
    }
    return {
      unitCost,
      reservedCredits: requiredCredits,
      creditDelta: delta
    };
  }

  if (wasPublic) {
    const unitCost = await resolveUnitCost(job, { session });
    const refundable = unusedReservedCredits(job, unitCost);
    if (refundable > 0) {
      await adjustOrganizationCredits({
        organizationId: job.organization,
        jobId: job._id,
        delta: -refundable,
        session,
        actorId,
        reason: operation === 'delete' ? 'Job deleted' : 'Job set to private',
        unitCost,
        targetLimit: 0,
        operation
      });
    }
  }

  job.isPublic = false;
  job.reservedCredits = 0;
  job.candidateApplyLimit = 0;
  job.publicApplicationReservations = [];
  job.publicApplicationCreditUnitCost = undefined;
  return {
    unitCost: null,
    reservedCredits: 0,
    creditDelta: 0
  };
}

async function runTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      }
    );
    return result;
  } finally {
    await session.endSession();
  }
}

async function updatePublicSettings({
  jobId,
  organizationId,
  isPublic,
  candidateApplyLimit,
  actorId,
  mutateJob
}) {
  const snapshot = await runTransaction(async (session) => {
    const job = await Job.findOne({
      _id: jobId,
      organization: organizationId
    }).session(session);
    if (!job) {
      throw publicCreditError('PUBLIC_JOB_NOT_FOUND', 'Job not found', 404);
    }

    await applyPublicSettings({
      job,
      targetIsPublic: isPublic,
      candidateApplyLimit,
      session,
      actorId,
      operation: 'settings_update'
    });
    if (mutateJob) await mutateJob(job);
    await job.save({ session });
    return job.toObject();
  });
  return Job.hydrate(snapshot);
}

async function createJob({
  jobData,
  actorId
}) {
  const snapshot = await runTransaction(async (session) => {
    const requestedPublic = jobData.isPublic === true;
    const requestedLimit = jobData.candidateApplyLimit;
    const job = new Job({
      ...jobData,
      isPublic: false,
      candidateApplyLimit: 0,
      reservedCredits: 0,
      publicApplicationCount: 0,
      publicApplicationReservations: []
    });
    if (requestedPublic) {
      await applyPublicSettings({
        job,
        targetIsPublic: true,
        candidateApplyLimit: requestedLimit,
        session,
        actorId,
        operation: 'create'
      });
    }
    await job.save({ session });
    return job.toObject();
  });
  return Job.hydrate(snapshot);
}

async function deleteJob({
  jobId,
  organizationId,
  actorId
}) {
  return runTransaction(async (session) => {
    const job = await Job.findOne({
      _id: jobId,
      organization: organizationId
    }).session(session);
    if (!job) {
      throw publicCreditError('PUBLIC_JOB_NOT_FOUND', 'Job not found', 404);
    }
    const snapshot = job.toObject();
    if (job.isPublic) {
      await applyPublicSettings({
        job,
        targetIsPublic: false,
        session,
        actorId,
        operation: 'delete'
      });
    }
    await Job.deleteOne({ _id: job._id }, { session });
    return snapshot;
  });
}

module.exports = {
  applyPublicSettings,
  createJob,
  deleteJob,
  deriveLegacyUnitCost,
  getCurrentUploadCandidateCost,
  normalizeApplyLimit,
  publicCreditError,
  resolveUnitCost,
  roundCredits,
  runTransaction,
  unusedReservedCredits,
  updatePublicSettings
};
