const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORGANIZATION_PLAN_MANAGER_ROLES,
  organizationPlanManagerFilter
} = require('./subscriptionAuthorizationService');

test('organization plan management accepts the organization owner', () => {
  const filter = organizationPlanManagerFilter('organization-1', 'user-1');

  assert.deepEqual(filter.$or[0], { owner: 'user-1' });
});

test('organization plan management uses the stored member field for active admins', () => {
  const filter = organizationPlanManagerFilter('organization-1', 'user-1');

  assert.deepEqual(filter.$or[1], {
    members: {
      $elemMatch: {
        user: 'user-1',
        role: { $in: ['owner', 'admin'] },
        status: 'active'
      }
    }
  });
  assert.equal('userId' in filter.$or[1].members.$elemMatch, false);
});

test('organization plan management excludes non-manager roles', () => {
  assert.deepEqual(ORGANIZATION_PLAN_MANAGER_ROLES, ['owner', 'admin']);
  assert.equal(ORGANIZATION_PLAN_MANAGER_ROLES.includes('recruiter'), false);
  assert.equal(ORGANIZATION_PLAN_MANAGER_ROLES.includes('employee'), false);
});
