'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  materializeRecruiterOrganizations,
  deduplicateOrganizationMemberships
} = require('../services/recruiterOrganizationSync');

function fakeOrganizationModel({ legacy = null } = {}) {
  const created = [];
  const linked = [];
  class Organization {
    constructor(input) { Object.assign(this, input, { _id: `created-${created.length + 1}` }); }
    async save() { created.push(this); return this; }
    static findOne() { return { lean: async () => legacy }; }
    static async updateOne(filter, update) { linked.push({ filter, update }); }
  }
  return { Organization, created, linked };
}

const user = { _id: 'user-a' };
const claims = [
  { id: 'idp-org-a', name: 'A', role: 'owner' },
  { id: 'idp-org-b', name: 'B', role: 'admin' }
];

test('two fresh Recruiter organization claims each materialize independently', async () => {
  const fake = fakeOrganizationModel();
  const map = await materializeRecruiterOrganizations({ Organization: fake.Organization, user, claims });
  assert.equal(fake.created.length, 2);
  assert.equal(map.get('idp-org-a').idpOrganizationId, 'idp-org-a');
  assert.equal(map.get('idp-org-b').idpOrganizationId, 'idp-org-b');
});

test('one existing organization plus one new claim creates the missing org', async () => {
  const fake = fakeOrganizationModel();
  const existing = { _id: 'local-a', idpOrganizationId: 'idp-org-a', members: [] };
  const map = await materializeRecruiterOrganizations({
    Organization: fake.Organization, user, claims, existingOrganizations: [existing]
  });
  assert.equal(fake.created.length, 1);
  assert.equal(map.get('idp-org-a'), existing);
  assert.equal(map.get('idp-org-b').idpOrganizationId, 'idp-org-b');
});

test('one legacy organization is linked once and the second claim creates a distinct org', async () => {
  const fake = fakeOrganizationModel({ legacy: { _id: 'legacy-a', name: 'Legacy', members: [] } });
  const map = await materializeRecruiterOrganizations({ Organization: fake.Organization, user, claims });
  assert.equal(fake.linked.length, 1);
  assert.equal(fake.created.length, 1);
  assert.equal(map.get('idp-org-a')._id, 'legacy-a');
  assert.notEqual(map.get('idp-org-b')._id, 'legacy-a');
});

test('authoritative IdP role replaces a stale privileged duplicate', () => {
  const memberships = [
    { organization: 'local-a', role: 'recruiter', isActive: true, joinedAt: new Date('2026-01-02') },
    { organization: 'local-a', role: 'owner', isActive: true, joinedAt: new Date('2026-01-01') }
  ];

  const result = deduplicateOrganizationMemberships(
    memberships,
    new Map([['local-a', 'recruiter']])
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'recruiter');
  assert.equal(result[0].isActive, true);
});
