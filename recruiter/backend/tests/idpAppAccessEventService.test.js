'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyMemberAppAccessChanged, applyMemberRemoved } = require('../services/idpAppAccessEventService');

const LOCAL_ORG = '507f191e810c19729de86201';
const USER_ID = '507f191e810c19729de86202';

function user() {
  return {
    _id: USER_ID,
    currentOrganization: LOCAL_ORG,
    hasCompletedOrganizationSetup: true,
    organizationMemberships: [{ organization: LOCAL_ORG, isActive: true }],
    recruiterAuthorizedOrganizations: [LOCAL_ORG],
    async save() { this.saved = true; return this; }
  };
}

test('a signed IdP app-access revocation removes the exact org and revokes active sessions', async () => {
  const actor = user();
  const revoked = [];
  const result = await applyMemberAppAccessChanged({
    organizationId: 'idp-org-b',
    subject: 'idp-subject-b',
    email: 'member@example.test',
    appAccess: { mode: 'selected', appIds: ['performance-management'] }
  }, {
    findOrganization: async () => ({ _id: LOCAL_ORG }),
    findUser: async ({ subject }) => { assert.equal(subject, 'idp-subject-b'); return actor; },
    revokeSessions: async (...args) => revoked.push(args)
  });
  assert.equal(result.applied, true);
  assert.equal(result.revoked, true);
  assert.deepEqual(actor.recruiterAuthorizedOrganizations, []);
  assert.equal(actor.currentOrganization, null);
  assert.equal(actor.hasCompletedOrganizationSetup, false);
  assert.equal(actor.saved, true);
  assert.deepEqual(revoked, [[USER_ID, 'idp_app_access_changed']]);
});

test('a replayed Recruiter grant is invalidation-only and cannot restore authorization', async () => {
  const actor = user();
  const revoked = [];
  const result = await applyMemberAppAccessChanged({
    organizationId: 'idp-org-a',
    subject: 'idp-subject-a',
    appAccess: { mode: 'selected', appIds: ['smarthr'] }
  }, {
    findOrganization: async () => ({ _id: LOCAL_ORG }),
    findUser: async () => actor,
    revokeSessions: async (...args) => revoked.push(args)
  });
  assert.equal(result.allowed, false);
  assert.equal(result.revoked, true);
  assert.deepEqual(actor.recruiterAuthorizedOrganizations, []);
  assert.deepEqual(revoked, [[USER_ID, 'idp_app_access_changed']]);
});

test('organization removal deactivates the exact membership and revokes sessions', async () => {
  const actor = user();
  const revoked = [];
  const result = await applyMemberRemoved({
    organizationId: 'idp-org-a',
    userId: 'idp-subject-a'
  }, {
    findOrganization: async () => ({ _id: LOCAL_ORG }),
    findUser: async ({ subject }) => { assert.equal(subject, 'idp-subject-a'); return actor; },
    revokeSessions: async (...args) => revoked.push(args)
  });
  assert.equal(result.revoked, true);
  assert.equal(actor.organizationMemberships[0].isActive, false);
  assert.deepEqual(actor.recruiterAuthorizedOrganizations, []);
  assert.equal(actor.currentOrganization, null);
  assert.deepEqual(revoked, [[USER_ID, 'idp_organization_membership_removed']]);
});

test('malformed app-access events fail closed', async () => {
  await assert.rejects(
    applyMemberAppAccessChanged({ organizationId: 'idp-org' }),
    (error) => error.code === 'IDP_APP_ACCESS_EVENT_INVALID'
  );
});
