'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canUseLocalCredentials,
  firstRecruiterAuthorizedMembership,
  organizationClaimAllowsRecruiter,
  passwordResetQuery,
  recruiterAuthorizedClaims,
  recruiterOrganizationAuthorized
} = require('../services/sharedAIUserSecurity');

test('identity-only shadows cannot use local credentials or password reset lookup', () => {
  assert.equal(canUseLocalCredentials({ sharedAIOnly: true }), false);
  assert.equal(canUseLocalCredentials({ sharedAIOnly: false }), true);
  assert.deepEqual(passwordResetQuery('token', 123), {
    resetPasswordToken: 'token',
    resetPasswordExpires: { $gt: 123 },
    sharedAIOnly: { $ne: true }
  });
});

test('selected app claims grant only organizations containing Recruiter', () => {
  const all = { id: 'all', appAccess: { mode: 'all', appIds: [] } };
  const recruiter = { id: 'a', appAccess: { mode: 'selected', appIds: ['smarthr'] } };
  const performance = { id: 'b', appAccess: { mode: 'selected', appIds: ['performance-management'] } };
  assert.equal(organizationClaimAllowsRecruiter(all), true);
  assert.equal(organizationClaimAllowsRecruiter(recruiter), true);
  assert.equal(organizationClaimAllowsRecruiter(performance), false);
  assert.deepEqual(recruiterAuthorizedClaims([all, recruiter, performance]).map((item) => item.id), ['all', 'a']);
});

test('legacy unsynced Recruiter identity is bounded to an active membership until OIDC backfills app access', () => {
  const membership = { organization: 'org-a', isActive: true };
  assert.equal(recruiterOrganizationAuthorized({
    sharedAIOnly: false,
    idpSubject: 'established-recruiter-subject',
    organizationMemberships: [membership],
    recruiterAuthorizedOrganizations: ['org-a']
  }, 'org-a'), true);
  assert.equal(recruiterOrganizationAuthorized({
    sharedAIOnly: false,
    organizationMemberships: [membership]
  }, 'org-a'), false);
  assert.equal(recruiterOrganizationAuthorized({
    sharedAIOnly: true,
    idpSubject: 'identity-shadow',
    organizationMemberships: [membership]
  }, 'org-a'), false);
  assert.equal(recruiterOrganizationAuthorized({
    sharedAIOnly: false,
    idpSubject: 'established-recruiter-subject',
    organizationMemberships: [membership],
    recruiterAuthorizedOrganizations: ['org-a'],
    recruiterAppAccessSyncedAt: new Date()
  }, 'org-a'), true);
});

test('OIDC fallback chooses an authorized org even when a Performance-only membership is first', () => {
  const user = { organizationMemberships: [
    { organization: 'org-performance', isActive: true },
    { organization: 'org-recruiter', isActive: true }
  ] };
  const selected = firstRecruiterAuthorizedMembership(user, new Set(['org-recruiter']));
  assert.equal(selected.organization, 'org-recruiter');
});

test('auth routes apply the identity-only guard before local login/OTP/forgot and reset', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.match(source, /router\.post\('\/login'[\s\S]*?canUseLocalCredentials\(user\)/);
  assert.match(source, /router\.post\('\/verify-otp'[\s\S]*?canUseLocalCredentials\(user\)/);
  assert.match(source, /router\.post\('\/resend-otp'[\s\S]*?canUseLocalCredentials\(user\)/);
  assert.match(source, /router\.post\('\/forgot-password'[\s\S]*?canUseLocalCredentials\(user\)[\s\S]*?return res\.status\(200\)/);
  assert.match(source, /router\.post\('\/reset-password'[\s\S]*?passwordResetQuery\(token\)/);
  const middlewareSource = fs.readFileSync(path.join(__dirname, '../middleware/authMiddleware.js'), 'utf8');
  assert.match(middlewareSource, /user\?\.sharedAIOnly === true[\s\S]*?RECRUITER_APP_ACCESS_REQUIRED/);
});
