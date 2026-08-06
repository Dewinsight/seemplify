import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..', 'src');
const client = fs.readFileSync(path.join(frontend, 'lib', 'journeyStageRules.ts'), 'utf8');
const workspace = fs.readFileSync(path.join(frontend, 'components', 'journeys', 'JourneyStageRulesWorkspace.tsx'), 'utf8');
const page = fs.readFileSync(path.join(frontend, 'pages', 'JourneyMapsPage.tsx'), 'utf8');

test('the stage-rule client mirrors every locked API route and revision write', () => {
  for (const suffix of [
    "'/rules'", "'/simulate'", "'/aggregates'", "`/instances?limit=${limit}`",
    "`/instances/${encodeURIComponent(instanceId)}`", "`/decisions/${encodeURIComponent(decisionId)}`"
  ]) assert.ok(client.includes(suffix), `missing stage-rule API suffix ${suffix}`);
  assert.match(client, /json\('PUT', \{ expectedRevision, draft \}\)/u);
  assert.match(client, /json\('POST', \{ expectedRevision \}\)/u);
  assert.match(client, /nonApplicationReason: 'out_of_order' \| 'terminal_absorbing' \| null/u);
  assert.doesNotMatch(client, /mock|fixture|alias/iu);
});

test('JourneyMapsPage only wires the isolated workspace behind the connected entitlement', () => {
  assert.match(page, /useSessionFeature\('journeyConnected'\)/u);
  assert.match(page, /connectedEnabled && <TabsTrigger value="event-rules"/u);
  assert.match(page, /<JourneyStageRulesWorkspace key=\{map\.definition\.id\} map=\{map\}/u);
  assert.doesNotMatch(page, /function (?:saveRule|runSimulation|inspectInstance)\(/u,
    'the map monolith must not absorb the stage-rule editor implementation');
});

test('source, schema, map version, and stage choices are loaded from canonical APIs', () => {
  assert.match(workspace, /listJourneyEventSources\(\)/u);
  assert.match(workspace, /listJourneyEventSchemas\(sourceId\)/u);
  assert.match(workspace, /readJourneyMap\(map\.definition\.id, draft\.journeyMapVersionId\)/u);
  assert.match(workspace, /map\.versions\.map/u);
  assert.match(workspace, /targetStages\.map/u);
  assert.match(workspace, /data-testid="selected-schema-bindings"/u);
  assert.match(workspace, /schema \$\{version\.version\} \/ \$\{version\.id\}/u);
  assert.doesNotMatch(workspace, /demo source|sample schema|fallback stage/iu);
});

test('predicate authoring is fail-closed to compatible operational schema properties', () => {
  assert.match(client, /compatibleOperationalProperties/u);
  assert.match(client, /candidate\.dataClass !== 'operational'/u);
  assert.match(client, /properties\.every/u);
  assert.match(workspace, /data-testid="predicate-builder"/u);
  assert.match(workspace, /properties\.map\(\(candidate\)/u);
  assert.doesNotMatch(workspace, /placeholder="Property path"|path.*onChange.*event\.target\.value/iu,
    'operators may choose a canonical property, but cannot type an arbitrary property path');
  assert.match(workspace, /Personal, sensitive, content, object, and array properties are intentionally unavailable/u);
});

test('draft, publish, retire, and conflict states remain explicit and non-automatic', () => {
  assert.match(workspace, /type RuleSaveState = 'clean' \| 'dirty' \| 'saving' \| 'saved' \| 'conflict' \| 'error'/u);
  assert.match(workspace, /data-testid="stage-rule-save-state"/u);
  assert.match(workspace, /data-testid="stage-rule-conflict"/u);
  assert.match(workspace, /local draft remains in the editor and will not be retried automatically/u);
  assert.match(workspace, /window\.confirm\('Publish this rule to live event processing/u);
  assert.match(workspace, /window\.confirm\('Retire the published rule/u);
  assert.match(workspace, /draft\.journeyMapVersionId !== map\.definition\.publishedVersionId/u);
});

test('the simulator carries the exact source environment, schema, history, and evaluator trace', () => {
  assert.match(workspace, /sourceId: simSource\.id, environment: simSource\.environment/u);
  assert.match(workspace, /Schema \{simSchemaVersion\.version\} \/ \{simSchemaVersion\.id\}/u);
  assert.match(workspace, /data-testid="add-sim-history"/u);
  assert.match(workspace, /simulateJourneyStageRules\(map\.definition\.id, useDrafts/u);
  assert.match(workspace, /data-testid="simulation-trace"/u);
  assert.match(workspace, /trace\.reasons\.map/u);
});

test('observed aggregate, anonymous instance, and decision inspection stay separate from simulation', () => {
  assert.match(workspace, /readJourneyStageAggregates/u);
  assert.match(workspace, /listJourneyAnonymousInstances/u);
  assert.match(workspace, /readJourneyAnonymousInstance/u);
  assert.match(workspace, /readJourneyStageDecision/u);
  assert.match(workspace, /Aggregates and instances come from durable published-rule decisions, never the simulator/u);
  assert.match(workspace, /visit\.nonApplicationReason === 'out_of_order'/u);
  assert.match(workspace, /visit\.nonApplicationReason === 'terminal_absorbing'/u);
  assert.match(workspace, /data-testid="decision-explanation"/u);
});

test('native controls, contained tables, and read-only permissions provide accessible desktop and mobile paths', () => {
  assert.match(workspace, /const canManage = Boolean\(session\?\.activeSpace/u);
  assert.match(workspace, /data-testid="stage-rule-read-only"/u);
  assert.match(workspace, /<fieldset disabled=\{!canManage/u);
  assert.match(workspace, /overflow-x-auto border/u);
  assert.match(workspace, /aria-live="polite"/u);
  assert.match(workspace, /role="alert"/u);
  assert.match(workspace, /aria-label=\{`Remove predicate/u);
});

test('the new stage-rule source files contain no mojibake sequences', () => {
  for (const [name, source] of [['journeyStageRules.ts', client], ['JourneyStageRulesWorkspace.tsx', workspace]]) {
    assert.doesNotMatch(source, /[\u00c2\u00c3]|\u00e2/u, `${name} contains a mis-decoded UTF-8 sequence`);
  }
});
