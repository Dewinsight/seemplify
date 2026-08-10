import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const plans = fs.readFileSync(new URL('../src/pages/platform-admin/PlansPage.tsx', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../src/pages/platform-admin/types.ts', import.meta.url), 'utf8');
const quotas = [
  'journeyPortfolioItems', 'journeyPortfolioScoringPolicies', 'journeyHierarchyLinks',
  'journeyBlueprints', 'journeyBlueprintResources', 'journeyConnectorDefinitions'
];

test('platform plan editor exposes every managed Journey resource quota with a strict client type', () => {
  for (const quota of quotas) {
    assert.match(plans, new RegExp(`key: '${quota}'`), `${quota} editor control`);
    assert.match(types, new RegExp(`${quota}: number`), `${quota} client type`);
  }
});
