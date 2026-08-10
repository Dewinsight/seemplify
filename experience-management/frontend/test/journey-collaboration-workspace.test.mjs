import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const client = read('lib', 'journeyCollaboration.ts');
const page = read('pages', 'JourneyCollaborationPage.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const routes = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyCollaborationRoutes.ts'), 'utf8');

test('collaboration is lazy routed and its navigation follows the dedicated entitlement', () => {
  assert.match(app, /const JourneyCollaborationPage = lazy/u);
  assert.match(app, /<Route path="\/journey-collaboration"><JourneyCollaborationPage \/><\/Route>/u);
  assert.match(shell, /to: '\/journey-collaboration'.*feature: 'journeyCollaboration'/u);
  assert.match(page, /useSessionFeature\('journeyCollaboration'\)/u);
});

test('the strict client covers the mounted tenant-free API', () => {
  for (const resource of ['context', 'settings', 'comments', 'watchers', 'notifications', 'roles',
    'governance/reviews', 'activity']) assert.ok(client.includes(`/api/journey-collaboration/${resource}`), resource);
  assert.match(client, /from 'zod'/u);
  assert.ok((client.match(/\.strict\(\)/gu) || []).length >= 12, 'wire records must reject unknown fields');
  assert.match(client, /Idempotency-Key/u);
  assert.match(client, /expectedRevision/u);
  assert.doesNotMatch(client, /spaceId/u, 'tenancy must be derived from the authenticated request');
  assert.match(routes, /resolveRequestSpace\(request, user\.id\)/u);
});

test('effective capabilities and read-only state control every collaboration surface', () => {
  assert.match(page, /context && !context\.readOnly && context\.capabilities\.includes/u);
  for (const capability of ['journeys.comment', 'journeys.watch', 'journeys.request_review', 'journeys.review',
    'journeys.publish', 'journeys.manage_roles', 'journeys.manage_shares']) assert.ok(page.includes(capability), capability);
  for (const action of ['createComment', 'editComment', 'deleteComment', 'transitionComment', 'setWatcher',
    'updateNotification', 'assignRole', 'revokeRole', 'requestReview', 'decideReview', 'transitionReview',
    'updateCollaborationSettings']) assert.ok(page.includes(action), action);
  assert.match(page, /Read-only: collaboration writes are disabled/u);
  assert.match(page, /visibleTabs = tabs\.filter/u);
  assert.match(page, /capabilities\.includes\('journeys\.manage_shares'\)/u);
});

test('public sharing uses a redacted versioned envelope and management-only navigation', () => {
  assert.match(client, /const publicShareSchema/u);
  assert.match(client, /schemaVersion: z\.literal\(2\)/u);
  const publicContract = client.slice(client.indexOf('const publicShareSchema'));
  assert.doesNotMatch(publicContract, /tokenPrefix|checksum|targetId/u);
  assert.match(page, /item\.id === 'shares' \|\| item\.id === 'settings'/u);
});

test('the workspace keeps target and governance truth visible', () => {
  for (const phrase of ['Working target', 'Revision {context.target.revision}', 'checksum', 'Exact target',
    'request will pin revision', 'Review record']) assert.ok(page.includes(phrase), phrase);
  assert.match(page, /index\.journeyMaps/u);
  assert.match(page, /index\.personas/u);
  assert.match(page, /listJourneyPortfolioItems/u);
  assert.match(page, /reason instanceof ApiError && reason\.status === 409/u);
});

test('activity is content-safe and the layout follows the restrained product language', () => {
  assert.match(page, /Comment text and governance reasons are excluded/u);
  assert.doesNotMatch(page, /JSON\.stringify\(item\.detail/u);
  assert.doesNotMatch(page, /item\.detail/u);
  assert.match(page, /overflow-x-auto/u);
  assert.match(page, /role="tablist"/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
});

test('loading, empty, conflict, disabled and notification states are explicit', () => {
  for (const phrase of ['Loading journey collaboration', 'No collaboration targets', 'No comments yet',
    'No notifications match this filter', 'No reviews for this target', 'No activity for this target',
    'role="alert"']) assert.ok(page.includes(phrase), phrase);
  assert.match(page, /status === 409/u);
  assert.match(page, /disabled=\{!can\(/u);
});
