import assert from 'node:assert/strict';
import test from 'node:test';
import {
  journeyTemplateSeedChecksum, journeyTemplateSeeds, validateJourneyTemplateSeed
} from '../src/journeyTemplateCatalog.js';

test('the required Phase 1 template catalogue is structurally valid and remains an unreviewed seed', () => {
  assert.deepEqual(journeyTemplateSeeds.map((template) => template.key), [
    'customer-onboarding', 'purchase', 'service-recovery', 'renewal',
    'employee-onboarding', 'citizen-service', 'patient-access', 'blank-service-blueprint'
  ]);
  for (const template of journeyTemplateSeeds) {
    assert.deepEqual(validateJourneyTemplateSeed(template), [], `${template.key} is invalid`);
    assert.equal(template.approvalState, 'draft', 'code must not claim that a seed received human review');
    assert.match(journeyTemplateSeedChecksum(template), /^[a-f0-9]{64}$/u);
    for (const stage of template.stages) {
      for (const card of stage.cards) assert.notEqual(card.kind, 'metric', 'seed metrics are proposals, not observations');
    }
  }
});

test('the service-blueprint seed adds operational lanes without dropping the customer view', () => {
  const blueprint = journeyTemplateSeeds.find((template) => template.key === 'blank-service-blueprint');
  assert.ok(blueprint);
  const lanes = new Set(blueprint.lanes.map((lane) => lane.laneType));
  for (const lane of ['stage_goal', 'customer_actions', 'touchpoints', 'frontstage', 'backstage', 'supporting_systems', 'policies', 'handoffs']) {
    assert.ok(lanes.has(lane as never), `blueprint is missing ${lane}`);
  }
});

