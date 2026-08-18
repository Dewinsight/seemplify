const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');
const {
  clearAdminLockout,
  verifyIdpAdminSsoToken
} = require('../services/idpAdminSsoService');
const { reconcileIdpAdminLocks } = require('../scripts/reconcileIdpAdminLocks');

test('successful IdP authentication clears stale password lockout state', () => {
  const admin = {
    loginAttempts: 5,
    lockUntil: new Date(Date.now() + 60_000)
  };

  assert.equal(clearAdminLockout(admin), admin);
  assert.equal(admin.loginAttempts, 0);
  assert.equal(admin.lockUntil, undefined);
});

test('IdP SSO verification accepts the configured shared-secret fallback', () => {
  const previousPrimary = process.env.RECRUITER_ADMIN_SSO_SECRET;
  const previousFallback = process.env.IDP_RECRUITER_ADMIN_SSO_SECRET;
  delete process.env.RECRUITER_ADMIN_SSO_SECRET;
  process.env.IDP_RECRUITER_ADMIN_SSO_SECRET = 'test-only-shared-secret';

  try {
    const token = jwt.sign(
      {
        sub: 'idp-admin-1',
        email: 'admin@example.test',
        name: 'Admin',
        role: 'super_admin',
        jti: 'test-jti'
      },
      process.env.IDP_RECRUITER_ADMIN_SSO_SECRET,
      { algorithm: 'HS256', issuer: 'aiin-idp-admin', audience: 'recruiter-admin' }
    );

    assert.equal(verifyIdpAdminSsoToken(token).idpAccountId, 'idp-admin-1');
  } finally {
    if (previousPrimary === undefined) delete process.env.RECRUITER_ADMIN_SSO_SECRET;
    else process.env.RECRUITER_ADMIN_SSO_SECRET = previousPrimary;
    if (previousFallback === undefined) delete process.env.IDP_RECRUITER_ADMIN_SSO_SECRET;
    else process.env.IDP_RECRUITER_ADMIN_SSO_SECRET = previousFallback;
  }
});

test('deployment repair only unlocks active admins with SSO identity evidence', async () => {
  const originalUpdateMany = Admin.updateMany;
  let receivedQuery;
  let receivedUpdate;
  Admin.updateMany = async (query, update) => {
    receivedQuery = query;
    receivedUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  };

  try {
    assert.deepEqual(await reconcileIdpAdminLocks(), { matched: 1, unlocked: 1 });
    assert.equal(receivedQuery.isActive, true);
    assert.ok(receivedQuery.lockUntil.$gt instanceof Date);
    assert.deepEqual(receivedUpdate, {
      $set: { loginAttempts: 0 },
      $unset: { lockUntil: 1 }
    });
  } finally {
    Admin.updateMany = originalUpdateMany;
  }
});
