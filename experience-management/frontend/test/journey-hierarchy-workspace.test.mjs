import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const client = read('lib', 'journeyHierarchy.ts');
const page = read('pages', 'JourneyHierarchyPage.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const backendRoutes = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyHierarchyRoutes.ts'), 'utf8');
const backendRepository = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyHierarchyRepository.ts'), 'utf8');

test('the hierarchy workspace is lazy routed and hidden when the plan disables its feature', () => {
  assert.match(app, /const JourneyHierarchyPage = lazy/u);
  assert.match(app, /<Route path="\/journey-hierarchy"><JourneyHierarchyPage \/><\/Route>/u);
  assert.match(shell, /to: '\/journey-hierarchy', label: 'Journey hierarchy'.*feature: 'journeyHierarchy'/u);
  assert.match(page, /useSessionFeature\('journeyHierarchy'\)/u);
  assert.match(page, /if \(!enabled\) return null/u);
});

test('the strict client covers hierarchy, traversal, breadcrumbs, governance and taxonomy without accepting tenant identity', () => {
  for (const resource of ['/links', '/traversal/', '/breadcrumbs/', '/taxonomy', '/journeys/', '/settings', '/health/policies', '/health/snapshots', '/export.']) {
    assert.ok(client.includes(`/api/journey-hierarchy${resource}`), `missing hierarchy client resource ${resource}`);
  }
  assert.match(client, /\.strict\(\)/u);
  assert.match(client, /expectedRevision: link\.revision/u);
  assert.match(client, /spaceScopedApiUrl/u);
  assert.match(client, /X-Content-SHA256/u);
  assert.doesNotMatch(client, /export async function [^(]+\([^)]*spaceId/u,
    'space identity must come from the authenticated request boundary');
  for (const route of ["get('/',", "post('/links',", "patch('/links/:linkId',",
    "get('/traversal/:definitionId',", "get('/breadcrumbs/:definitionId',", "get('/taxonomy',"]) {
    assert.ok(backendRoutes.includes(route), `missing mounted backend route ${route}`);
  }
});

test('hierarchy exports preserve governed context behind the export plan feature', () => {
  assert.match(page, /useSessionFeature\('journeyExports'\)/u);
  assert.match(page, /downloadJourneyHierarchy/u);
  assert.match(page, /downloadExport\('json'\)/u);
  assert.match(page, /downloadExport\('csv'\)/u);
  assert.match(page, /document\.body\.appendChild\(anchor\)/u,
    'browser downloads must use a connected anchor');
  assert.match(page, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/u,
    'the object URL must survive until the browser has accepted the download');
  assert.match(backendRepository, /action: 'hierarchy\.export'/u);
  assert.match(backendRepository, /journeys\.export/u);
  assert.match(backendRepository, /formulaSafeCsvCell/u);
});

test('settings, taxonomy corrections, and transparent health stay revisioned and inspectable', () => {
  for (const mutation of ['updateJourneyHierarchySettings', 'updateJourneyTaxonomyTerm',
    'createJourneyHierarchyHealthPolicy', 'updateJourneyHierarchyHealthPolicy',
    'calculateJourneyHierarchyHealthSnapshots']) assert.ok(client.includes(`function ${mutation}`), `missing ${mutation}`);
  assert.match(client, /expectedRevision: settings\.revision/u);
  assert.match(client, /expectedRevision: term\.revision/u);
  assert.match(client, /expectedRevision: policy\.revision/u);
  for (const phrase of ['Hierarchy settings', 'Correct taxonomy term', 'Health observations', 'Snapshot history',
    'Blank values remain unknown', 'Unknown · no score', 'Missing child rule', 'Snapshot child values and rules']) {
    assert.ok(page.includes(phrase), `missing governed hierarchy language: ${phrase}`);
  }
  assert.match(page, /canManage && <form/u);
  assert.doesNotMatch(page, /score \|\| 0|score \?\? 0/u, 'unknown health must never render as a fabricated zero');
});

test('members get an inspectable read-only tree while managers receive every governed mutation', () => {
  assert.match(page, /session\.activeSpace\.role !== 'member'/u);
  assert.match(page, /You have read-only access/u);
  for (const mutation of ['createJourneyHierarchyLink', 'updateJourneyHierarchyLink', 'createJourneyTaxonomyTerm',
    'assignJourneyTaxonomyTerm', 'unassignJourneyTaxonomyTerm']) {
    assert.ok(page.includes(mutation), `missing hierarchy mutation ${mutation}`);
  }
  assert.match(backendRepository, /function assertManage[\s\S]*?role === 'member'/u);
  assert.match(backendRepository, /assertSubscriptionFeature\(spaceId, 'journeyHierarchy'\)/u);
});

test('tree, graph table, shared-path breadcrumbs, impact and taxonomy have accessible text alternatives', () => {
  for (const testId of ['journey-hierarchy-tree', 'journey-hierarchy-impact', 'journey-hierarchy-relationship-table']) {
    assert.ok(page.includes(`data-testid="${testId}"`), `missing hierarchy surface ${testId}`);
  }
  for (const phrase of ['Shared by', 'Breadcrumb paths', 'Affected journeys', 'Relationship table alternative',
    'Journey taxonomy assignments', 'inaccessible relationship']) {
    assert.ok(page.includes(phrase), `missing hierarchy language ${phrase}`);
  }
  assert.match(page, /<caption className="sr-only">Journey hierarchy relationships and governance state<\/caption>/u);
  assert.match(page, /<caption className="sr-only">Journey taxonomy assignments<\/caption>/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu,
    'the hierarchy workspace stays within the established calm product language');
});

test('the workspace exposes truthful loading, empty, truncation, inaccessible and failure states', () => {
  assert.match(page, /Loading journey hierarchy/u);
  assert.match(page, /No hierarchy relationships have been created/u);
  assert.match(page, /No taxonomy terms have been created/u);
  assert.match(page, /Additional paths were omitted at the safety limit/u);
  assert.match(page, /Results reached the traversal limit/u);
  assert.match(page, /role="alert"/u);
  assert.doesNotMatch(page, /mock|sample data|demo journey/iu);
});
