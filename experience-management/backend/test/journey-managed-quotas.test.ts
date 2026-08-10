import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defaultSubscriptionPlanCatalog, subscriptionQuotaKind } from '../src/subscriptionEntitlements.js';

const managedJourneyQuotas = [
  'journeyPortfolioItems', 'journeyPortfolioScoringPolicies', 'journeyHierarchyLinks',
  'journeyBlueprints', 'journeyBlueprintResources', 'journeyConnectorDefinitions'
] as const;

test('authoritative plans expose every durable Journey resource quota as a managed non-metered allowance', () => {
  for (const plan of defaultSubscriptionPlanCatalog) {
    for (const quota of managedJourneyQuotas) {
      assert.equal(Number.isSafeInteger(plan.limits[quota]), true, `${plan.code}.${quota}`);
      assert.equal(plan.limits[quota] >= 0, true, `${plan.code}.${quota}`);
      assert.equal(subscriptionQuotaKind(quota), 'resource');
    }
  }
  assert.deepEqual(
    managedJourneyQuotas.map((quota) => defaultSubscriptionPlanCatalog.find((plan) => plan.code === 'starter')!.limits[quota]),
    [0, 0, 0, 0, 0, 0]
  );
});

test('Journey resource admission reads only typed managed quotas at repository write boundaries', () => {
  const root = path.resolve(import.meta.dirname, '..', 'src');
  const source = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
  assert.match(source('journeyPortfolio.ts'), /assertSubscriptionQuota\(spaceId, quota, current, additional\)/u);
  assert.doesNotMatch(source('journeyPortfolio.ts'), /portfolioPlanAllowances|as unknown as Record<string, unknown>/u);
  assert.match(source('journeyHierarchyRepository.ts'), /assertSubscriptionQuota\(input\.spaceId, 'journeyHierarchyLinks'/u);
  assert.match(source('journeyServiceBlueprintRepository.ts'), /assertSubscriptionQuota\(input\.spaceId, 'journeyBlueprints'/u);
  assert.match(source('journeyServiceBlueprintRepository.ts'), /assertSubscriptionQuota\(input\.spaceId, 'journeyBlueprintResources'/u);
  assert.match(source('journeyConnectorImports.ts'), /assertSubscriptionQuota\(input\.spaceId,'journeyConnectorDefinitions'/u);
  assert.match(source('journeyOrchestrationRepository.ts'), /assertSubscriptionQuota\(input\.spaceId, 'activeJourneyOrchestrations'/u);
  assert.match(source('journeyStageRuleRepository.ts'), /assertSubscriptionQuota\(input\.spaceId, 'activeJourneyRuleSets'/u);
  assert.match(source('journeyMaps.ts'), /journey-map-quota:[^]*assertSubscriptionQuota\(spaceId, 'journeyMaps'/u);
  assert.match(source('journeyMaps.ts'), /journey-persona-quota:[^]*assertSubscriptionQuota\(spaceId, 'journeyPersonas'/u);
  assert.match(source('journeyTemplates.ts'), /journey-template-quota:[^]*assertSubscriptionQuota\(input\.spaceId!, 'journeyTemplates'/u);
});
