import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const client = read('lib', 'journeyIdentity.ts');
const page = read('pages', 'JourneyIdentityPage.tsx');
const correctionWorkspace = read('components', 'journeys', 'JourneyIdentityCorrectionWorkspace.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const backendRoutes = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyIdentityRoutes.ts'), 'utf8');

test('customer 360 is lazy routed and plan gated', () => {
  assert.match(app, /const JourneyIdentityPage = lazy/u);
  assert.match(app, /<Route path="\/customer-360"><JourneyIdentityPage \/><\/Route>/u);
  assert.match(shell, /to: '\/customer-360', label: 'Customer 360'.*feature: 'journeyProfiles'/u);
  assert.match(page, /useSessionFeature\('journeyProfiles'\)/u);
});

test('the strict identity client covers the shipped profile, 360, privacy, group, segment and session contracts', () => {
  for (const resource of [
    '/profiles', '/timeline', '/sessions', '/customer-360', '/privacy', '/corrections', '/export', '/privacy-jobs',
    '/groups', '/accounts/', '/segments', '/versions', '/commands', '/audit'
  ]) assert.ok(client.includes(resource), `missing identity client resource ${resource}`);
  assert.match(client, /schema\.parse\(await api<unknown>/u);
  assert.ok((client.match(/\.strict\(\)/gu) || []).length > 20, 'response objects must reject undeclared fields');
  assert.doesNotMatch(client, /export function [^(]+\([^)]*spaceId/u,
    'tenant identity must come from the authenticated request boundary');
  for (const route of ["get('/profiles',", "get('/profiles/:profileId',", "get('/profiles/:profileId/customer-360',",
    "put('/profiles/:profileId/privacy',", "post('/profiles/:profileId/privacy-jobs',", "get('/groups',",
    "get('/accounts/:accountId/customer-360',", "get('/segments',", "get('/sessions/:sessionId',"]) {
    assert.ok(backendRoutes.includes(route), `missing mounted backend route ${route}`);
  }
});

test('members receive explicit read-only behavior and governed controls are manager-only', () => {
  assert.match(page, /session\.activeSpace\.role !== 'member'/u);
  assert.match(page, /You have read-only access/u);
  assert.match(page, /customer 360 and privacy controls require an owner or administrator/iu);
  for (const mutation of ['updateJourneyProfilePrivacy', 'createJourneyProfileExport', 'createJourneyProfilePrivacyJob',
    'createJourneyIdentityGroup', 'createJourneyIdentitySegment', 'mergeJourneyIdentityProfiles', 'splitJourneyIdentityMerge']) {
    assert.ok(page.includes(mutation), `missing governed identity mutation ${mutation}`);
  }
  assert.match(page, /\{canManage && <TabsTrigger className="shrink-0" value="privacy">/u);
  assert.match(page, /\{canManage && <form/u);
});

test('merge and split UX requires a reviewed comparison, bounded reason, explicit confirmation, and stable retries', () => {
  for (const phrase of ['Source and target profile comparison before merge', 'Type MERGE to confirm', 'Type SPLIT to confirm',
    '8–400 characters', 'Idempotent command replay', 'The identity records changed. Refresh the comparison and try again.']) {
    assert.ok(`${page}\n${correctionWorkspace}`.includes(phrase), `missing correction safety behavior: ${phrase}`);
  }
  assert.match(correctionWorkspace, /useState\(\(\) => newCommandId\('merge'\)\)/u);
  assert.match(correctionWorkspace, /if \(accepted\).*setMergeCommandId\(newCommandId\('merge'\)\)/su,
    'a retry must retain its command ID until the server accepts it');
  assert.match(page, /reason instanceof ApiError && \(reason\.status === 403 \|\| reason\.status === 404\)/u,
    'foreign and forbidden identities must not be distinguishable in the UI');
});

test('correction completion follows privacy propagation truth', () => {
  for (const state of ['running', 'waiting', 'operator_required', 'completed']) assert.ok(correctionWorkspace.includes(state));
  assert.ok(correctionWorkspace.includes('Privacy propagation status is pending'));
  assert.ok(correctionWorkspace.includes('waiting for an operator-required privacy step'));
  assert.doesNotMatch(correctionWorkspace, /command complete.*privacy propagation.*(pending|waiting)/iu);
  assert.match(client, /privacyPropagationSchema/u);
});

test('the workspace distinguishes exact facts from derived views and explains privacy withholding', () => {
  for (const phrase of [
    'No inferred or probabilistic matches are shown', 'Recorded facts', 'Exact identity bindings',
    'Customer 360 derived view', 'membership is a derived result', 'denied, suppressed, or unavailable',
    'Downstream cleanup remains pending', 'Suppressed profiles intentionally return an empty timeline', 'Correction runs'
  ]) assert.ok(page.includes(phrase), `missing truthful identity language: ${phrase}`);
  assert.doesNotMatch(page, /mock|sample customer|demo profile/iu);
});

test('profile, timeline, session, membership, privacy, group and segment tables have accessible mobile containment', () => {
  assert.ok((page.match(/className="max-w-full gap-4 overflow-x-auto"/gu) || []).length >= 2,
    'workspace and profile tab strips must remain pointer-operable at narrow widths');
  for (const caption of [
    'Identity profiles and deterministic binding summary', 'Exact identity bindings', 'Profile interaction timeline',
    'Profile sessions', 'Account and group memberships', 'Purpose-specific consent and privacy state',
    'Accounts and identity groups', 'Deterministic identity segments and materialized membership'
  ]) assert.ok(page.includes(`<caption className="sr-only">${caption}</caption>`), `missing accessible caption: ${caption}`);
  assert.ok(correctionWorkspace.includes('<caption className="sr-only">Source and target profile comparison before merge</caption>'));
  assert.ok((page.match(/max-w-full overflow-x-auto/gu) || []).length >= 8, 'every wide data surface needs horizontal containment');
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu,
    'the identity workspace stays within the established calm product language');
});

test('loading, empty, error, deleted, denied, queued and completed states are visible', () => {
  for (const phrase of ['Loading customer identities', 'No identity profiles are available', 'role="alert"',
    'Deleted ', "state === 'denied'", "state === 'queued'", 'Completed ']) {
    assert.ok(page.includes(phrase), `missing operational state ${phrase}`);
  }
});
