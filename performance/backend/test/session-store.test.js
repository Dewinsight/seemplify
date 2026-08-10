'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionStore = require('../services/sessionStore');

test('session revocation matches the serialized connect-mongo session by stable IdP subject', async () => {
  const subject = 'idp|stable.subject+42';
  const serializedSession = JSON.stringify({
    cookie: { maxAge: 86_400_000 },
    user: { sub: subject, email: 'person@example.com' }
  });
  let receivedFilter;

  sessionStore.initSessionStore({
    collection: {
      async deleteMany(filter) {
        receivedFilter = filter;
        const serializedClause = filter.$or.find((entry) => entry.session?.$regex);
        return {
          deletedCount: serializedClause.session.$regex.test(serializedSession) ? 1 : 0
        };
      }
    }
  });

  const deleted = await sessionStore.invalidateUserSessions(subject);
  assert.equal(deleted, 1);
  assert.ok(receivedFilter.$or.some((entry) => entry.session?.$regex));
  assert.equal(
    receivedFilter.$or.find((entry) => entry.session?.$regex).session.$regex.test(
      JSON.stringify({ user: { sub: 'different-subject' } })
    ),
    false
  );
});

test('session revocation failures propagate so the durable webhook is retried', async () => {
  sessionStore.initSessionStore({
    collection: {
      async deleteMany() {
        throw new Error('temporary session database failure');
      }
    }
  });

  await assert.rejects(
    sessionStore.invalidateUserSessions('idp|stable-subject'),
    /temporary session database failure/
  );
});
