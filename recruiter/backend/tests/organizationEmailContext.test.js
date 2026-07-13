const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

function mockOrganizationLookup(resolveValue) {
  const requestedIds = [];
  const lookupOrganization = async (id) => {
    requestedIds.push(String(id));
    return resolveValue(id);
  };

  return { requestedIds, lookupOrganization };
}

test('uses a populated job organization without a database lookup', async () => {
  let lookupCalled = false;
  const lookupOrganization = async () => {
    lookupCalled = true;
    throw new Error('Unexpected lookup');
  };

  const organization = await resolveOrganizationForEmail({
    job: { organization: { _id: 'job-org', name: 'Acme Ltd' } },
    organization: { _id: 'stale-org', name: 'Mega' }
  }, { lookupOrganization });

  assert.equal(organization.name, 'Acme Ltd');
  assert.equal(lookupCalled, false);
});

test('resolves the job organization before a stale user organization', async () => {
  const { requestedIds, lookupOrganization } = mockOrganizationLookup((id) => (
    String(id) === 'job-org'
      ? { _id: 'job-org', name: 'Acme Ltd' }
      : { _id: 'stale-org', name: 'Mega' }
  ));

  const organization = await resolveOrganizationForEmail({
    job: { organization: 'job-org' },
    organization: { _id: 'stale-org', name: 'Mega' }
  }, { lookupOrganization });

  assert.equal(organization.name, 'Acme Ltd');
  assert.deepEqual(requestedIds, ['job-org']);
});

test('uses the explicit organization id for a jobless interview', async () => {
  const { lookupOrganization } = mockOrganizationLookup(() => ({ _id: 'current-org', name: 'Current Org' }));

  const organization = await resolveOrganizationForEmail({
    organizationId: 'current-org'
  }, { lookupOrganization });

  assert.equal(organization.name, 'Current Org');
});

test('does not fall back when the job organization cannot be resolved', async () => {
  const { requestedIds, lookupOrganization } = mockOrganizationLookup(() => null);

  await assert.rejects(
    resolveOrganizationForEmail({
      job: { organization: 'missing-job-org' },
      organization: { _id: 'stale-org', name: 'Mega' }
    }, { lookupOrganization }),
    /organization name could not be resolved/
  );
  assert.deepEqual(requestedIds, ['missing-job-org']);
});

test('rejects the send when no organization name can be resolved', async () => {
  const { lookupOrganization } = mockOrganizationLookup(() => null);

  await assert.rejects(
    resolveOrganizationForEmail(
      { organizationId: 'missing-org' },
      { lookupOrganization }
    ),
    /organization name could not be resolved/
  );
});
