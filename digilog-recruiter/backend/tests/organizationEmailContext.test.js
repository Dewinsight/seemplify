const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

test('uses the job organization as the authoritative email organization', async () => {
  const resolved = await resolveOrganizationForEmail(
    {
      job: { organization: 'job-org' },
      organization: { _id: 'other-org', name: 'Other Org' }
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

test('does not fall back when the local organization has a placeholder name', async () => {
  await assert.rejects(
    resolveOrganizationForEmail(
      { organizationId: 'org-1' },
      { lookupOrganization: async () => ({ _id: 'org-1', name: 'Mega' }) }
    ),
    /organization could not be resolved/
  );
});
