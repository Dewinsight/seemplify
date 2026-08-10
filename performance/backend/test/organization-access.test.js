'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  filterPerformanceOrganizations,
  organizationAllowsPerformance,
  sanitizePerformancePrincipal,
  selectPerformanceOrganization,
  toOrganizationId
} = require('../services/performanceOrganizationAccess');

const performanceOrganization = {
  id: 'org-performance',
  name: 'Performance Org',
  appAccess: { mode: 'all', appIds: [] }
};
const recruiterOnlyOrganization = {
  id: 'org-recruiter',
  name: 'Recruiter Org',
  appAccess: { mode: 'selected', appIds: ['recruiter'] }
};

test('Performance organization scope excludes a Recruiter-only membership', () => {
  assert.equal(organizationAllowsPerformance(performanceOrganization), true);
  assert.equal(organizationAllowsPerformance(recruiterOnlyOrganization), false);
  assert.deepEqual(
    filterPerformanceOrganizations([performanceOrganization, recruiterOnlyOrganization]).map(toOrganizationId),
    ['org-performance']
  );
  assert.equal(
    toOrganizationId(selectPerformanceOrganization(
      [performanceOrganization, recruiterOnlyOrganization],
      'org-recruiter'
    )),
    'org-performance'
  );
});

test('Performance principal falls back from org B to org A and removes org B teams and nested claims', () => {
  const principal = sanitizePerformancePrincipal({
    sub: 'employee-1',
    email: 'employee@example.com',
    organizations: [performanceOrganization, recruiterOnlyOrganization],
    currentOrganization: recruiterOnlyOrganization,
    teams: [
      { id: 'team-a', organizationId: 'org-performance' },
      { id: 'team-b', organizationId: 'org-recruiter' }
    ],
    idpTeamPermissions: [
      { team_id: 'team-a', organization_id: 'org-performance' },
      { team_id: 'team-b', organization_id: 'org-recruiter' }
    ],
    userinfo: {
      organizations: [performanceOrganization, recruiterOnlyOrganization],
      currentOrganization: recruiterOnlyOrganization,
      teams: [
        { id: 'team-a', organizationId: 'org-performance' },
        { id: 'team-b', organizationId: 'org-recruiter' }
      ],
      team_permissions: [
        { team_id: 'team-a', organization_id: 'org-performance' },
        { team_id: 'team-b', organization_id: 'org-recruiter' }
      ]
    }
  }, 'org-recruiter');

  assert.equal(toOrganizationId(principal.currentOrganization), 'org-performance');
  assert.deepEqual(principal.organizations.map(toOrganizationId), ['org-performance']);
  assert.deepEqual(principal.teams.map((team) => team.id), ['team-a']);
  assert.deepEqual(principal.idpTeamPermissions.map((permission) => permission.team_id), ['team-a']);
  assert.deepEqual(principal.userinfo.organizations.map(toOrganizationId), ['org-performance']);
  assert.deepEqual(principal.userinfo.teams.map((team) => team.id), ['team-a']);
  assert.deepEqual(principal.userinfo.team_permissions.map((permission) => permission.team_id), ['team-a']);
});

test('selected app access permits Performance only when explicitly assigned', () => {
  assert.equal(organizationAllowsPerformance({
    id: 'org-selected',
    appAccess: { mode: 'selected', appIds: ['performance-management'] }
  }), true);
  assert.equal(organizationAllowsPerformance({
    id: 'org-empty',
    appAccess: { mode: 'selected', appIds: [] }
  }), false);
  assert.equal(
    organizationAllowsPerformance({ id: 'org-legacy-without-app-access' }),
    false,
    'Legacy sessions without a signed appAccess claim must refresh instead of inheriting access'
  );
});

test('team-only legacy claims cannot synthesize an organization or re-enter the switch list', () => {
  const principal = sanitizePerformancePrincipal({
    sub: 'employee-legacy',
    organizations: [],
    teams: [{ id: 'recruiter-team', organizationId: 'org-recruiter' }],
    userinfo: { organizations: [], teams: [{ id: 'recruiter-team', organizationId: 'org-recruiter' }] }
  });
  assert.equal(principal.currentOrganization, null);
  assert.deepEqual(principal.organizations, []);
  assert.deepEqual(principal.teams, []);
});

test('both organization switch endpoints enforce the Performance app boundary', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const userRouteSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'user.js'), 'utf8');

  assert.match(appSource, /filterPerformanceOrganizations\(req\.session\.user\.organizations/);
  assert.match(appSource, /PERFORMANCE_APP_ACCESS_DENIED/);
  assert.match(userRouteSource, /filterPerformanceOrganizations/);
  assert.match(userRouteSource, /PERFORMANCE_APP_ACCESS_DENIED/);
});

test('an app-access change webhook immediately invalidates existing Performance sessions', () => {
  const webhookSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webhooks.js'), 'utf8');
  const securitySource = fs.readFileSync(path.join(__dirname, '..', 'services', 'idpWebhookSecurity.js'), 'utf8');
  assert.match(webhookSource, /organization\.member\.app_access_changed/);
  assert.match(webhookSource, /data\.subject \|\| data\.userId/);
  assert.match(webhookSource, /const userId = stableSubject\(payloadData\)/);
  assert.match(webhookSource, /invalidateUserSessions\(userId\)/);
  assert.match(webhookSource, /case 'organization\.member\.removed':[\s\S]*?invalidateUserSessions\(userId\)/);
  assert.match(webhookSource, /case 'team\.member\.role_changed':[\s\S]*?invalidateUserSessions\(userId\)/);
  assert.doesNotMatch(webhookSource, /case 'team\.member\.role_changed':[\s\S]*?refreshUserClaims\(userId\)/);
  assert.match(webhookSource, /x-idp-signature-v2/);
  assert.match(securitySource, /timingSafeEqual/);
  assert.match(securitySource, /Buffer\.byteLength\(value, 'utf8'\) >= 32/);
  assert.doesNotMatch(securitySource, /IDP_WEBHOOK_SECRET \|\| 'your-webhook-secret-key'/);
});
