'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeIdentity,
  resolveSharedPrincipal,
  resolveSharedUser
} = require('../services/aiRuntime/sharedIdentityService');

function identity(overrides = {}) {
  return {
    sub: 'idp-user-42',
    email: 'person@example.test',
    organizationId: 'idp-org-7',
    displayName: 'Person Example',
    ...overrides
  };
}

test('an existing Recruiter user is backfilled without changing its gateway subject id', async () => {
  let saves = 0;
  const user = {
    _id: '507f191e810c19729de860ea',
    email: 'person@example.test',
    idpSubject: null,
    profile: {},
    async save() { saves += 1; }
  };
  const resolved = await resolveSharedUser(identity(), {
    findBySubject: async () => null,
    findByEmail: async () => user,
    findOrganization: async () => ({ _id: '507f191e810c19729de860eb', name: 'AIIN' })
  });
  assert.equal(resolved, user);
  assert.equal(resolved._id, '507f191e810c19729de860ea');
  assert.equal(resolved.idpSubject, 'idp-user-42');
  assert.equal(resolved.currentOrganization, '507f191e810c19729de860eb');
  assert.equal(resolved.profile.displayName, 'Person Example');
  assert.equal(saves, 1);
});

test('the stable IdP subject safely follows a verified email rename', async () => {
  let saves = 0;
  const user = {
    _id: '507f191e810c19729de860ec',
    email: 'old@example.test',
    idpSubject: 'idp-user-42',
    profile: { displayName: 'Already Set' },
    currentOrganization: '507f191e810c19729de860ed',
    async save() { saves += 1; }
  };
  const resolved = await resolveSharedUser(identity({ email: 'new@example.test' }), {
    findBySubject: async () => user,
    findByEmail: async () => null,
    findOrganization: async () => null
  });
  assert.equal(resolved.email, 'new@example.test');
  assert.equal(resolved._id, '507f191e810c19729de860ec');
  assert.equal(saves, 1);
});

test('the signed active organization is returned independently of Recruiter current-organization state', async () => {
  const user = {
    _id: '507f191e810c19729de860d0',
    email: 'person@example.test',
    idpSubject: 'idp-user-42',
    profile: { displayName: 'Already Set' },
    currentOrganization: '507f191e810c19729de860d1',
    async save() { throw new Error('no mutation expected'); }
  };
  const principal = await resolveSharedPrincipal(identity({ organizationId: 'active-idp-org' }), {
    findBySubject: async () => user,
    findByEmail: async () => user,
    findOrganization: async () => ({ _id: '507f191e810c19729de860d2', name: 'Active org' })
  });
  assert.equal(principal.organization._id, '507f191e810c19729de860d2');
  assert.equal(principal.identity.organizationId, 'active-idp-org');
  assert.equal(principal.user.currentOrganization, '507f191e810c19729de860d1');
});

test('different subject and email owners are rejected instead of merged', async () => {
  await assert.rejects(
    resolveSharedUser(identity(), {
      findBySubject: async () => ({ _id: '507f191e810c19729de860ee', email: 'other@example.test', idpSubject: 'idp-user-42' }),
      findByEmail: async () => ({ _id: '507f191e810c19729de860ef', email: 'person@example.test', idpSubject: 'someone-else' }),
      findOrganization: async () => null
    }),
    (error) => error.code === 'SHARED_AI_IDENTITY_CONFLICT' && error.statusCode === 409
  );
});

test('a Performance-only identity gets a dormant local subject without storing an SSO credential', async () => {
  let created;
  const resolved = await resolveSharedUser(identity(), {
    findBySubject: async () => null,
    findByEmail: async () => null,
    findOrganization: async () => ({ _id: '507f191e810c19729de860f0' }),
    createUser: async (value) => {
      created = value;
      return { _id: '507f191e810c19729de860f1', ...value };
    }
  });
  assert.equal(resolved.idpSubject, 'idp-user-42');
  assert.equal(resolved.email, 'person@example.test');
  assert.equal(resolved.currentOrganization, '507f191e810c19729de860f0');
  assert.equal(resolved.sharedAIOnly, true);
  assert.equal(created.sharedAIOnly, true);
  assert.match(created.password, /^\$2[aby]\$/);
  assert.notEqual(created.password, identity().sub);
});

test('a concurrent first-create unique race re-reads and returns the canonical winner', async () => {
  const winner = {
    _id: '507f191e810c19729de860f2',
    email: 'person@example.test',
    idpSubject: 'idp-user-42',
    sharedAIOnly: true,
    profile: { displayName: 'Person Example' }
  };
  let subjectReads = 0;
  let emailReads = 0;
  const resolved = await resolveSharedUser(identity(), {
    findBySubject: async () => (++subjectReads > 1 ? winner : null),
    findByEmail: async () => (++emailReads > 1 ? winner : null),
    findOrganization: async () => null,
    createUser: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); }
  });
  assert.equal(resolved, winner);
  assert.equal(subjectReads, 2);
  assert.equal(emailReads, 2);
});

test('signed identity still requires a stable subject and valid email', () => {
  assert.throws(() => normalizeIdentity({ sub: '', email: 'person@example.test' }), /subject/i);
  assert.throws(() => normalizeIdentity({ sub: 'subject', email: 'not-an-email' }), /email/i);
});
