const mongoose = require('mongoose');
const Job = require('../models/Job');
const publicJobCreditService = require('./publicJobCreditService');

function businessError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.permanent = true;
  return error;
}

/**
 * Atomically consumes one public-application slot from a job's prepaid pool.
 * The processing-job key makes redelivery safe, while the $expr predicates
 * serialize concurrent applicants on the Job document.
 */
async function reserve({
  jobId,
  organizationId,
  processingJobId,
  processingJobPublicId
}) {
  if (
    !mongoose.isValidObjectId(jobId)
    || !mongoose.isValidObjectId(organizationId)
    || !mongoose.isValidObjectId(processingJobId)
  ) {
    throw businessError('PUBLIC_APPLICATION_CONTEXT_INVALID', 'Public application context is invalid', 400);
  }

  const normalizedJobId = new mongoose.Types.ObjectId(String(jobId));
  const normalizedOrganizationId = new mongoose.Types.ObjectId(String(organizationId));
  const normalizedProcessingJobId = new mongoose.Types.ObjectId(String(processingJobId));

  const existingJob = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId,
    isPublic: true,
    'publicApplicationReservations.processingJob': normalizedProcessingJobId
  }).lean();
  if (existingJob) {
    const reservation = existingJob.publicApplicationReservations.find(
      (item) => String(item.processingJob) === String(normalizedProcessingJobId)
    );
    return {
      duplicate: true,
      creditCost: Number(reservation.creditCost || 0),
      applicationCount: Number(reservation.applicationCount || existingJob.publicApplicationCount || 0),
      limitReached: reservation.limitReached === true,
      reservedAt: reservation.reservedAt
    };
  }

  const fundedJob = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId,
    isPublic: true
  })
    .select(
      'organization isPublic candidateApplyLimit reservedCredits publicApplicationCount '
      + 'publicApplicationCreditUnitCost publicApplicationReservations'
    );
  if (!fundedJob) {
    const existing = await Job.exists({
      _id: normalizedJobId,
      organization: normalizedOrganizationId
    });
    if (!existing) {
      throw businessError('PUBLIC_JOB_NOT_FOUND', 'The public job was not found', 404);
    }
    throw businessError('PUBLIC_JOB_NOT_PUBLIC', 'This job is not accepting public applications', 403);
  }
  const cost = await publicJobCreditService.resolveUnitCost(
    fundedJob,
    { persistLegacy: true }
  );

  const reservedAt = new Date();
  const updated = await Job.findOneAndUpdate(
    {
      _id: normalizedJobId,
      organization: normalizedOrganizationId,
      isPublic: true,
      publicApplicationCreditUnitCost: cost,
      'publicApplicationReservations.processingJob': { $ne: normalizedProcessingJobId },
      $expr: {
        $and: [
          { $gt: [{ $ifNull: ['$candidateApplyLimit', 0] }, 0] },
          {
            $lt: [
              { $ifNull: ['$publicApplicationCount', 0] },
              { $ifNull: ['$candidateApplyLimit', 0] }
            ]
          },
          {
            $lte: [
              {
                $multiply: [
                  { $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1] },
                  cost
                ]
              },
              { $ifNull: ['$reservedCredits', 0] }
            ]
          }
        ]
      }
    },
    [
      {
        $set: {
          publicApplicationCount: {
            $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1]
          },
          publicApplicationReservations: {
            $concatArrays: [
              { $ifNull: ['$publicApplicationReservations', []] },
              [{
                _id: new mongoose.Types.ObjectId(),
                processingJob: normalizedProcessingJobId,
                processingJobPublicId: String(processingJobPublicId),
                creditCost: cost,
                applicationCount: {
                  $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1]
                },
                limitReached: {
                  $gte: [
                    { $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1] },
                    { $ifNull: ['$candidateApplyLimit', 0] }
                  ]
                },
                reservedAt
              }]
            ]
          }
        }
      }
    ],
    { new: true }
  ).lean();

  if (updated) {
    const reservation = updated.publicApplicationReservations.find(
      (item) => String(item.processingJob) === String(normalizedProcessingJobId)
    );
    return {
      duplicate: false,
      creditCost: cost,
      applicationCount: Number(updated.publicApplicationCount),
      limitReached: reservation?.limitReached === true,
      reservedAt
    };
  }

  // A concurrent redelivery may have won between the first read and update.
  const current = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId
  }).lean();
  if (!current) {
    throw businessError('PUBLIC_JOB_NOT_FOUND', 'The public job was not found', 404);
  }
  if (!current.isPublic) {
    throw businessError('PUBLIC_JOB_NOT_PUBLIC', 'This job is not accepting public applications', 403);
  }

  const duplicate = current.publicApplicationReservations?.find(
    (item) => String(item.processingJob) === String(normalizedProcessingJobId)
  );
  if (duplicate) {
    return {
      duplicate: true,
      creditCost: Number(duplicate.creditCost || cost),
      applicationCount: Number(duplicate.applicationCount || current.publicApplicationCount || 0),
      limitReached: duplicate.limitReached === true,
      reservedAt: duplicate.reservedAt
    };
  }

  const count = Number(current.publicApplicationCount || 0);
  const limit = Number(current.candidateApplyLimit || 0);
  if (limit <= 0 || count >= limit) {
    throw businessError(
      'PUBLIC_APPLICATION_LIMIT_REACHED',
      'This job has reached its maximum number of public applications'
    );
  }
  if ((count + 1) * cost > Number(current.reservedCredits || 0)) {
    throw businessError(
      'PUBLIC_APPLICATION_CREDITS_EXHAUSTED',
      'This job has no reserved public-application credits remaining'
    );
  }
  throw businessError(
    'PUBLIC_APPLICATION_CAPACITY_CONFLICT',
    'Public application capacity changed; please retry'
  );
}

/**
 * Repair counters inflated by the July 2026 queue regression. During that
 * window every completed CV parse consumed a permanent application slot,
 * even when the candidate never submitted the application form. A real
 * submission increments analytics.publicApplications; the queue reservation
 * did not. Only reconcile records that also have enough queue reservations to
 * explain the difference, so unrelated historical counters are left alone.
 */
async function reconcileInflatedCount({ jobId, organizationId } = {}) {
  if (!mongoose.isValidObjectId(jobId)) return null;

  const query = { _id: new mongoose.Types.ObjectId(String(jobId)), isPublic: true };
  if (organizationId) {
    if (!mongoose.isValidObjectId(organizationId)) return null;
    query.organization = new mongoose.Types.ObjectId(String(organizationId));
  }

  const job = await Job.findOne(query)
    .select('publicApplicationCount publicApplicationReservations analytics.publicApplications')
    .lean();
  if (!job) return null;

  const storedCount = Math.max(0, Number(job.publicApplicationCount || 0));
  const submittedCount = Math.max(0, Number(job.analytics?.publicApplications || 0));
  const reservationCount = job.publicApplicationReservations?.length || 0;
  const inflatedByQueueReservations = storedCount > submittedCount
    && reservationCount >= storedCount - submittedCount;

  if (!inflatedByQueueReservations) {
    return { repaired: false, applicationCount: storedCount };
  }

  const repaired = await Job.findOneAndUpdate(
    {
      ...query,
      publicApplicationCount: storedCount,
      'analytics.publicApplications': submittedCount
    },
    {
      $set: {
        publicApplicationCount: submittedCount,
        publicApplicationReservations: []
      }
    },
    { new: true }
  ).lean();

  return {
    repaired: Boolean(repaired),
    applicationCount: Number(repaired?.publicApplicationCount ?? storedCount),
    previousCount: storedCount
  };
}

/**
 * Atomically records a completed public application. CV parsing may create a
 * candidate, but it must not consume the job's application allowance until
 * the candidate presses Submit.
 */
async function commit({
  jobId,
  organizationId,
  candidateId,
  processingJobId,
  processingJobPublicId
}) {
  if (
    !mongoose.isValidObjectId(jobId)
    || !mongoose.isValidObjectId(organizationId)
    || !mongoose.isValidObjectId(candidateId)
    || !mongoose.isValidObjectId(processingJobId)
  ) {
    throw businessError('PUBLIC_APPLICATION_CONTEXT_INVALID', 'Public application context is invalid', 400);
  }

  const normalizedJobId = new mongoose.Types.ObjectId(String(jobId));
  const normalizedOrganizationId = new mongoose.Types.ObjectId(String(organizationId));
  const normalizedCandidateId = new mongoose.Types.ObjectId(String(candidateId));
  const normalizedProcessingJobId = new mongoose.Types.ObjectId(String(processingJobId));

  const duplicateJob = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId,
    'shortlist.candidate': normalizedCandidateId
  }).lean();
  if (duplicateJob) {
    return {
      duplicate: true,
      applicationCount: Number(duplicateJob.publicApplicationCount || 0),
      limitReached: Number(duplicateJob.candidateApplyLimit || 0) > 0
        && Number(duplicateJob.publicApplicationCount || 0) >= Number(duplicateJob.candidateApplyLimit),
      job: duplicateJob
    };
  }

  const fundedJob = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId,
    isPublic: true,
    status: 'active'
  }).select(
    'organization isPublic status candidateApplyLimit reservedCredits publicApplicationCount '
    + 'publicApplicationCreditUnitCost publicApplicationReservations'
  );
  if (!fundedJob) {
    const existing = await Job.findOne({
      _id: normalizedJobId,
      organization: normalizedOrganizationId
    }).select('isPublic status').lean();
    if (!existing) {
      throw businessError('PUBLIC_JOB_NOT_FOUND', 'The public job was not found', 404);
    }
    throw businessError('PUBLIC_JOB_NOT_PUBLIC', 'This job is not accepting public applications', 403);
  }

  const cost = await publicJobCreditService.resolveUnitCost(
    fundedJob,
    { persistLegacy: true }
  );
  const submittedAt = new Date();
  const updated = await Job.findOneAndUpdate(
    {
      _id: normalizedJobId,
      organization: normalizedOrganizationId,
      isPublic: true,
      status: 'active',
      'shortlist.candidate': { $ne: normalizedCandidateId },
      'publicApplicationReservations.processingJob': { $ne: normalizedProcessingJobId },
      $expr: {
        $and: [
          { $gt: [{ $ifNull: ['$candidateApplyLimit', 0] }, 0] },
          {
            $lt: [
              { $ifNull: ['$publicApplicationCount', 0] },
              { $ifNull: ['$candidateApplyLimit', 0] }
            ]
          },
          {
            $lte: [
              {
                $multiply: [
                  { $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1] },
                  cost
                ]
              },
              { $ifNull: ['$reservedCredits', 0] }
            ]
          }
        ]
      }
    },
    [
      {
        $set: {
          publicApplicationCount: {
            $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1]
          },
          'analytics.publicApplications': {
            $add: [{ $ifNull: ['$analytics.publicApplications', 0] }, 1]
          },
          'analytics.applications': {
            $add: [{ $ifNull: ['$analytics.applications', 0] }, 1]
          },
          shortlist: {
            $concatArrays: [
              { $ifNull: ['$shortlist', []] },
              [{
                _id: new mongoose.Types.ObjectId(),
                candidate: normalizedCandidateId,
                addedAt: submittedAt,
                status: 'shortlisted'
              }]
            ]
          },
          publicApplicationReservations: {
            $concatArrays: [
              { $ifNull: ['$publicApplicationReservations', []] },
              [{
                _id: new mongoose.Types.ObjectId(),
                processingJob: normalizedProcessingJobId,
                processingJobPublicId: String(processingJobPublicId),
                creditCost: cost,
                applicationCount: {
                  $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1]
                },
                limitReached: {
                  $gte: [
                    { $add: [{ $ifNull: ['$publicApplicationCount', 0] }, 1] },
                    { $ifNull: ['$candidateApplyLimit', 0] }
                  ]
                },
                reservedAt: submittedAt
              }]
            ]
          }
        }
      }
    ],
    { new: true }
  ).lean();

  if (updated) {
    return {
      duplicate: false,
      creditCost: cost,
      applicationCount: Number(updated.publicApplicationCount || 0),
      limitReached: Number(updated.publicApplicationCount || 0) >= Number(updated.candidateApplyLimit || 0),
      submittedAt,
      job: updated
    };
  }

  const current = await Job.findOne({
    _id: normalizedJobId,
    organization: normalizedOrganizationId
  }).lean();
  if (!current) {
    throw businessError('PUBLIC_JOB_NOT_FOUND', 'The public job was not found', 404);
  }
  if (!current.isPublic || current.status !== 'active') {
    throw businessError('PUBLIC_JOB_NOT_PUBLIC', 'This job is not accepting public applications', 403);
  }
  if (current.shortlist?.some((item) => String(item.candidate) === String(normalizedCandidateId))) {
    return {
      duplicate: true,
      applicationCount: Number(current.publicApplicationCount || 0),
      limitReached: Number(current.publicApplicationCount || 0) >= Number(current.candidateApplyLimit || 0),
      job: current
    };
  }

  const count = Number(current.publicApplicationCount || 0);
  const limit = Number(current.candidateApplyLimit || 0);
  if (limit <= 0 || count >= limit) {
    throw businessError(
      'PUBLIC_APPLICATION_LIMIT_REACHED',
      'This job has reached its maximum number of public applications'
    );
  }
  if ((count + 1) * cost > Number(current.reservedCredits || 0)) {
    throw businessError(
      'PUBLIC_APPLICATION_CREDITS_EXHAUSTED',
      'This job has no reserved public-application credits remaining'
    );
  }
  throw businessError(
    'PUBLIC_APPLICATION_CAPACITY_CONFLICT',
    'Public application capacity changed; please retry'
  );
}

module.exports = {
  commit,
  reconcileInflatedCount,
  reserve,
  uploadCandidateCost: publicJobCreditService.getCurrentUploadCandidateCost
};
