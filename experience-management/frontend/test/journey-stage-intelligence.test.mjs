import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const component = fs.readFileSync(path.join(root, 'src/components/journeys/JourneyStageComparisonTable.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/lib/journeyStageIntelligence.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/JourneyStageIntelligencePage.tsx'), 'utf8');
const trend = fs.readFileSync(path.join(root, 'src/components/journeys/JourneyStageTrendTable.tsx'), 'utf8');

test('stage comparison table exposes all governed dimensions and a table alternative', () => {
  for (const dimension of ['persona', 'segment', 'cohort', 'channel']) assert.match(component, new RegExp(`'${dimension}'`, 'u'));
  assert.match(component, /<table/u);
  assert.match(component, /<caption className="sr-only"/u);
  assert.match(component, /max-w-full overflow-x-auto/u);
});

test('strict client rejects extra fields and suppressed response disclosure', () => {
  assert.match(client, /contains unexpected field/u);
  assert.match(client, /suppressed row discloses protected detail/u);
  assert.match(client, /sourceIdSha256/u);
  assert.match(client, /activeSpaceId/u);
  const queryBuilder = /function queryString[\s\S]*?return params\.toString\(\); \}/u.exec(client)?.[0] || '';
  assert.doesNotMatch(queryBuilder, /minimumSampleSize/u,
    'a reader must not be able to lower the server-owned sample threshold through the comparison query');
});

test('standalone page keeps manager policy controls separate from member-readable comparisons and exports', () => {
  assert.match(page, /canManage && policy/u);
  assert.match(page, /Save privacy policy/u);
  assert.match(page, /readJourneyStageComparisons/u);
  assert.match(page, /Export CSV/u); assert.match(page, /Export JSON/u);
  assert.match(page, /md:grid-cols-2 xl:grid-cols-5/u);
  assert.match(page, /flex flex-wrap/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2[0-9]px\]|shadow-2xl|translate-/u);
});

test('suppressed cells never render samples, values, sentiment, or emotion shares', () => {
  assert.match(component, /displayed\(row\.value, row\.suppression\.suppressed/u);
  assert.match(component, /displayed\(row\.sampleSize, row\.suppression\.suppressed/u);
  assert.match(component, /row\.suppression\.suppressed \? 'Suppressed'/u);
  assert.match(component, /if \(row\.suppression\.suppressed\) return 'Suppressed'/u);
  assert.match(component, /Primary and complementary suppression hide values, samples, sentiment, and emotions/u);
});

test('metric version hash, calculation version, and empty states remain visible without decorative UI patterns', () => {
  assert.match(component, /metricDefinitionVersionSha256/u);
  assert.match(component, /calculationVersion/u);
  assert.match(component, /No authorised/u);
  assert.doesNotMatch(component, /gradient|backdrop-blur|rounded-\[2[0-9]px\]|shadow-2xl|translate-/u);
});

test('stage trends use a semantic table and disclose no protected period values', () => {
  assert.match(page, /readJourneyStageTrends/u);
  assert.match(page, /Trend interval/u);
  assert.match(page, /JourneyStageTrendTable/u);
  assert.match(trend, /<table/u); assert.match(trend, /<caption className="sr-only"/u);
  assert.match(trend, /Each period is evaluated and suppressed independently/u);
  assert.match(trend, /Suppressed periods disclose no samples, values, sentiment, emotions, or source lineage/u);
  assert.doesNotMatch(trend, /gradient|backdrop-blur|rounded-\[2[0-9]px\]|shadow-2xl|translate-/u);
});
