'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canonicalAIContextFromRecords,
  hydrateCanonicalAIContext
} = require('../services/aiRuntime/canonicalAIContext');

test('canonical AI context separates stable IdP dimensions from local routing ids', () => {
  const context = canonicalAIContextFromRecords({
    actorId: 'local-user',
    organizationId: 'local-org',
    actor: {
      _id: 'local-user',
      idpSubject: 'idp-subject',
      email: 'Person@Example.com',
      profile: { firstName: 'Ada', lastName: 'Lovelace' }
    },
    organization: {
      _id: 'local-org',
      idpOrganizationId: 'idp-org',
      name: 'Analytical Engines'
    }
  });

  assert.deepEqual(context, {
    actorId: 'idp-subject',
    runtimeActorId: 'local-user',
    actorName: 'Ada Lovelace',
    actorEmail: 'person@example.com',
    organizationId: 'idp-org',
    localOrganizationId: 'local-org',
    organizationName: 'Analytical Engines'
  });
});

test('background hydration loads canonical actor and organization once', async () => {
  const calls = [];
  const model = (kind, record) => ({
    findById(value) {
      calls.push([kind, String(value)]);
      return {
        select() { return this; },
        async lean() { return record; }
      };
    }
  });

  const context = await hydrateCanonicalAIContext({
    actorId: 'local-user',
    organizationId: 'local-org'
  }, {
    UserModel: model('user', { _id: 'local-user', idpSubject: 'stable-user' }),
    OrganizationModel: model('organization', {
      _id: 'local-org', idpOrganizationId: 'stable-org'
    })
  });

  assert.deepEqual(calls, [['user', 'local-user'], ['organization', 'local-org']]);
  assert.equal(context.actorId, 'stable-user');
  assert.equal(context.runtimeActorId, 'local-user');
  assert.equal(context.organizationId, 'stable-org');
  assert.equal(context.localOrganizationId, 'local-org');
});

test('legacy records fall back to local dimensions without losing runtime routing', () => {
  const context = canonicalAIContextFromRecords({
    actorId: 'legacy-user',
    organizationId: 'legacy-org',
    actor: { _id: 'legacy-user' },
    organization: { _id: 'legacy-org' }
  });

  assert.equal(context.actorId, 'legacy-user');
  assert.equal(context.runtimeActorId, 'legacy-user');
  assert.equal(context.organizationId, 'legacy-org');
  assert.equal(context.localOrganizationId, 'legacy-org');
});
