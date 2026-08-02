const Interview = require('../models/Interview');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

function requireOrganizationId(organizationId) {
  if (!organizationId) {
    const error = new Error('Organization context is required');
    error.code = 'ORGANIZATION_REQUIRED';
    throw error;
  }
  return organizationId;
}

async function buildInterviewOrganizationScope(
  organizationId,
  { JobModel = Job, CandidateModel = Candidate } = {}
) {
  const scopedOrganizationId = requireOrganizationId(organizationId);
  const [ownedJobIds, ownedCandidateIds] = await Promise.all([
    JobModel.distinct('_id', { organization: scopedOrganizationId }),
    CandidateModel.distinct('_id', { organization: scopedOrganizationId })
  ]);

  return {
    $or: [
      { organizationId: scopedOrganizationId },
      {
        $and: [
          {
            $or: [
              { organizationId: { $exists: false } },
              { organizationId: null }
            ]
          },
          { candidateId: { $in: ownedCandidateIds } },
          {
            $or: [
              { jobId: { $exists: false } },
              { jobId: null },
              { jobId: { $in: ownedJobIds } }
            ]
          }
        ]
      }
    ]
  };
}

async function buildInterviewOrganizationQuery(organizationId, query = {}, dependencies) {
  const scope = await buildInterviewOrganizationScope(organizationId, dependencies);
  return { $and: [scope, query] };
}

async function findInterviewForOrganization(
  interviewId,
  organizationId,
  { InterviewModel = Interview, JobModel = Job, CandidateModel = Candidate } = {}
) {
  const query = await buildInterviewOrganizationQuery(
    organizationId,
    { _id: interviewId },
    { JobModel, CandidateModel }
  );
  return InterviewModel.findOne(query);
}

async function organizationOwnsJob(jobId, organizationId, { JobModel = Job } = {}) {
  requireOrganizationId(organizationId);
  if (!jobId) return false;
  return Boolean(await JobModel.exists({ _id: jobId, organization: organizationId }));
}

async function organizationOwnsCandidate(candidateId, organizationId, { CandidateModel = Candidate } = {}) {
  requireOrganizationId(organizationId);
  if (!candidateId) return false;
  return Boolean(await CandidateModel.exists({ _id: candidateId, organization: organizationId }));
}

module.exports = {
  buildInterviewOrganizationQuery,
  buildInterviewOrganizationScope,
  findInterviewForOrganization,
  organizationOwnsCandidate,
  organizationOwnsJob,
  requireOrganizationId
};
