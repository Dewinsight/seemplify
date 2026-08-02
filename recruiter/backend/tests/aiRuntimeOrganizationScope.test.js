const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildInterviewOrganizationQuery,
  buildInterviewOrganizationScope,
  findInterviewForOrganization,
  organizationOwnsCandidate,
  organizationOwnsJob
} = require('../utils/organizationResourceScope');

function dependencyModels() {
  return {
    JobModel: {
      distinct: async () => ['job-owned'],
      exists: async (query) => query._id === 'job-owned' && query.organization === 'org-a'
    },
    CandidateModel: {
      distinct: async () => ['candidate-owned'],
      exists: async (query) => query._id === 'candidate-owned' && query.organization === 'org-a'
    }
  };
}

test('interview organization scope supports authoritative organization ids and bounded legacy records', async () => {
  const scope = await buildInterviewOrganizationScope('org-a', dependencyModels());
  assert.deepEqual(scope.$or[0], { organizationId: 'org-a' });
  const legacy = scope.$or[1].$and;
  assert.deepEqual(legacy[1], { candidateId: { $in: ['candidate-owned'] } });
  assert.deepEqual(legacy[2].$or.at(-1), { jobId: { $in: ['job-owned'] } });

  const query = await buildInterviewOrganizationQuery(
    'org-a',
    { _id: 'interview-a' },
    dependencyModels()
  );
  assert.deepEqual(query.$and[1], { _id: 'interview-a' });
});

test('organization scope rejects missing tenant context', async () => {
  await assert.rejects(
    () => buildInterviewOrganizationScope(null, dependencyModels()),
    (error) => error.code === 'ORGANIZATION_REQUIRED'
  );
});

test('organization ownership checks bind jobs and candidates to the active organization', async () => {
  const dependencies = dependencyModels();
  assert.equal(await organizationOwnsJob('job-owned', 'org-a', dependencies), true);
  assert.equal(await organizationOwnsJob('job-other', 'org-a', dependencies), false);
  assert.equal(await organizationOwnsCandidate('candidate-owned', 'org-a', dependencies), true);
  assert.equal(await organizationOwnsCandidate('candidate-other', 'org-a', dependencies), false);
});

test('organization-scoped interview lookup never drops the tenant predicate', async () => {
  let capturedQuery;
  const dependencies = dependencyModels();
  const InterviewModel = {
    findOne(query) {
      capturedQuery = query;
      return { query };
    }
  };

  await findInterviewForOrganization('interview-a', 'org-a', { ...dependencies, InterviewModel });
  assert.deepEqual(capturedQuery.$and[1], { _id: 'interview-a' });
  assert.deepEqual(capturedQuery.$and[0].$or[0], { organizationId: 'org-a' });
});
