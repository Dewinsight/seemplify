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

module.exports = {
  reserve,
  uploadCandidateCost: publicJobCreditService.getCurrentUploadCandidateCost
};
