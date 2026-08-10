import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, 'src', ...parts), 'utf8');
const client = read('lib', 'journeyWorkspaceSavedViews.ts');
const toolbar = read('components', 'journeys', 'JourneyWorkspaceSavedViewBar.tsx');
const hierarchy = read('pages', 'JourneyHierarchyPage.tsx');
const blueprint = read('pages', 'JourneyServiceBlueprintPage.tsx');

test('workspace saved-view client keeps hierarchy and blueprint configurations discriminated', () => {
  assert.match(client, /z\.discriminatedUnion\('surface'/u);
  assert.match(client, /surface: z\.literal\('hierarchy'\), configuration: hierarchyConfigurationSchema/u);
  assert.match(client, /surface: z\.literal\('service_blueprint'\), configuration: blueprintConfigurationSchema/u);
  assert.match(client, /\/api\/journey-workspace-saved-views/u);
  assert.match(client, /'Idempotency-Key': idempotencyKey/u);
  assert.doesNotMatch(client, /spaceId/u);
});

test('saved-view toolbar exposes ordinary personal view actions and revision truth', () => {
  for (const action of ['Apply', 'Update view', 'Save view', 'Set default', 'Reset default', 'Retire']) {
    assert.ok(toolbar.includes(action), `missing saved-view action ${action}`);
  }
  assert.match(toolbar, /preferenceRevision/u);
  assert.match(toolbar, /Revision \{selected\.revision\} · version \{selected\.versionNumber\}/u);
  assert.doesNotMatch(toolbar, /gradient|backdrop-blur|shadow-2xl|rounded-\[2[0-9]px\]/u);
});

test('hierarchy persists and reapplies the selected root and traversal direction', () => {
  assert.match(hierarchy, /surface="hierarchy"/u);
  assert.match(hierarchy, /rootDefinitionId: selectedId \|\| null, direction/u);
  assert.match(hierarchy, /setSelectedId\(saved\.rootDefinitionId\)/u);
  assert.match(hierarchy, /setDirection\(saved\.direction\)/u);
});

test('service blueprint persists selection, version mode and semantic section', () => {
  assert.match(blueprint, /surface="service_blueprint"/u);
  assert.match(blueprint, /versionMode: comparison \? 'comparison' : \(draft\?\.state \|\| 'current'\)/u);
  assert.match(blueprint, /setSelectedId\(saved\.blueprintId\)/u);
  assert.match(blueprint, /setActiveSection\(saved\.selectedSection === 'design' \? 'blueprint' : saved\.selectedSection\)/u);
  assert.match(blueprint, /<Tabs value=\{activeSection\} onValueChange=\{setActiveSection\}/u);
});
