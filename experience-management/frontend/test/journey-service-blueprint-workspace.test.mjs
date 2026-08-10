import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const client = read('lib', 'journeyServiceBlueprint.ts');
const page = read('pages', 'JourneyServiceBlueprintPage.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');

test('service blueprints are lazy routed and plan gated with their dedicated feature', () => {
  assert.match(app, /const JourneyServiceBlueprintPage = lazy/u);
  assert.match(app, /<Route path="\/journey-blueprints"><JourneyServiceBlueprintPage \/><\/Route>/u);
  assert.match(shell, /to: '\/journey-blueprints', label: 'Service blueprints'.*feature: 'journeyBlueprints'/u);
  assert.match(page, /useSessionFeature\('journeyBlueprints'\)/u);
  assert.match(page, /if \(!enabled\) return null/u);
});

test('the strict client covers every mounted blueprint resource and optimistic governance contract', () => {
  for (const resource of ['/versions', '/review', '/analysis', '/export.', '/comparisons', '/resources/catalogue', '/gaps/']) {
    assert.ok(client.includes(resource), `missing blueprint client resource ${resource}`);
  }
  assert.match(client, /\.strict\(\)/u);
  assert.match(client, /expectedRevision: blueprint\.revision/u);
  assert.match(client, /expectedReviewState: version\.reviewState/u);
  assert.match(client, /spaceScopedApiUrl/u);
  assert.match(client, /X-Content-SHA256/u);
  assert.doesNotMatch(client, /export async function [^(]+\([^)]*spaceId/u);
});

test('governed JSON and formula-safe CSV exports are available only for a persisted version', () => {
  assert.match(page, /useSessionFeature\('journeyExports'\)/u);
  assert.match(page, /downloadJourneyServiceBlueprintVersion/u);
  assert.match(page, /downloadExport\('json'\)/u);
  assert.match(page, /downloadExport\('csv'\)/u);
  assert.match(page, /exportsEnabled && version\?\.versionId/u);
});

test('workspace represents blueprint semantics, immutable authoring and analysis without invented fields', () => {
  for (const phrase of ['Line of interaction', 'Line of visibility', 'Line of internal interaction', 'Customer actions',
    'Supporting systems', 'Policies and controls', 'Persisted gap review', 'Compare versions', 'SLA minutes', 'Risk probability',
    'Portfolio causality', 'Pinned revision', 'Exact portfolio item']) {
    assert.ok(page.toLowerCase().includes(phrase.toLowerCase()), `missing service-blueprint language: ${phrase}`);
  }
  for (const mutation of ['createJourneyServiceBlueprint', 'createJourneyServiceBlueprintVersion',
    'reviewJourneyServiceBlueprintVersion', 'createJourneyBlueprintResource', 'updateJourneyBlueprintResource',
    'reviewJourneyBlueprintGap', 'compareJourneyServiceBlueprintVersions']) assert.ok(page.includes(mutation), `missing mutation ${mutation}`);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
  assert.match(page, /listJourneyPortfolioItems\(\{ limit: 100, sort: 'updated' \}\)/u);
  assert.match(page, /portfolioItemRevision: item\.revision/u);
  assert.match(page, /portfolioLinks: \[\.\.\.draft\.portfolioLinks, link\]/u);
});

test('semantic tables, keyboard alternative, responsive overflow and truthful states are explicit', () => {
  assert.match(page, /<caption className="sr-only">Service blueprint stages by/u);
  assert.match(page, /Keyboard-accessible service blueprint element list/u);
  assert.match(page, /max-w-full overflow-x-auto/u);
  assert.match(page, /You have read-only access/u);
  assert.match(page, /Loading service blueprints/u);
  assert.match(page, /No service blueprints have been created/u);
  assert.match(page, /No version history is available/u);
  assert.match(page, /role="alert"/u);
});
