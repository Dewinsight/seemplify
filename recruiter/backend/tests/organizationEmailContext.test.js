const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

test('uses a populated job organization without a lookup', async () => {
  const organization = { _id: 'org-1', name: 'Acme Ltd' };
  const resolved = await resolveOrganizationForEmail(
    { job: { organization } },
    { lookupOrganization: async () => assert.fail('lookup should not run') }
  );

  assert.equal(resolved, organization);
});

test('job organization wins over stale request context', async () => {
  const resolved = await resolveOrganizationForEmail(
    {
      job: { organization: 'job-org' },
      organization: { _id: 'stale-org', name: 'Mega' }
    },
    {
      lookupOrganization: async (id) => {
        assert.equal(id, 'job-org');
        return { _id: id, name: 'Acme Ltd' };
      }
    }
  );

  assert.equal(resolved.name, 'Acme Ltd');
});

test('uses interview organization for a jobless interview', async () => {
  const resolved = await resolveOrganizationForEmail(
    { interview: { organizationId: 'interview-org' } },
    {
      lookupOrganization: async (id) => ({ _id: id, name: 'Interview Org' })
    }
  );

  assert.equal(resolved.name, 'Interview Org');
});

test('does not fall back when the job organization fails', async () => {
  await assert.rejects(
    resolveOrganizationForEmail(
      {
        job: { organization: 'missing-job-org' },
        organization: { _id: 'other-org', name: 'Other Org' }
      },
      { lookupOrganization: async () => null }
    ),
    /organization could not be resolved/
  );
});

test('rejects email without organization context', async () => {
  await assert.rejects(
    resolveOrganizationForEmail(),
    /organization could not be resolved/
  );
});
