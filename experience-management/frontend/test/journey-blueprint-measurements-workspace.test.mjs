import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const client=fs.readFileSync(path.join(root,'src/lib/journeyBlueprintMeasurements.ts'),'utf8');
const panel=fs.readFileSync(path.join(root,'src/components/journeys/JourneyBlueprintMeasurementPanel.tsx'),'utf8');
const page=fs.readFileSync(path.join(root,'src/pages/JourneyServiceBlueprintPage.tsx'),'utf8');

test('measurement client uses governed server-derived lineage routes without caller tenant or metricRefs',()=>{
  assert.match(client,/\/api\/journey-blueprint-measurements\/plans/u);
  assert.match(client,/baselineObservationId/u);
  assert.match(client,/afterObservationId,expectedRevision:plan\.revision/u);
  assert.doesNotMatch(client,/spaceId|metricRefs/u);
  assert.match(client,/comparability_code:z\.literal\('same_metric_version_unit_nonoverlapping_periods'\)/u);
  assert.match(client,/interpretation:z\.literal\('descriptive_non_causal'\)/u);
});

test('measurement workspace separates member reads from manager mutations and labels outcomes non-causal',()=>{
  assert.match(panel,/canManage&&<form[\s\S]*Pin baseline/u);
  assert.match(panel,/canManage&&selected\.state==='active'&&<form[\s\S]*Record outcome/u);
  assert.match(panel,/canManage&&selected\.state==='active'&&<Button[\s\S]*Close/u);
  assert.match(panel,/!canManage&&<p[\s\S]*read-only access to measurement lineage and outcomes/u);
  assert.match(panel,/Descriptive comparison only; no causal claim\./u);
  assert.match(panel,/aria-label="Governed blueprint measurement plans"/u);
});

test('service blueprint exposes measurements only when both governed blueprint and metric surfaces are available',()=>{
  assert.match(page,/const metricsEnabled = useSessionFeature\('journeyMetrics'\)/u);
  assert.match(page,/metricsEnabled&&version\?\.versionId&&<TabsTrigger value="measurements">Measurements/u);
  assert.match(page,/JourneyBlueprintMeasurementPanel version=\{version\} canManage=\{canManage\}/u);
});
