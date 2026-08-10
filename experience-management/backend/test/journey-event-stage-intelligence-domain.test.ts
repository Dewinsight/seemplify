import assert from 'node:assert/strict';import test from 'node:test';
import {deriveJourneyEventIntelligenceRecord,materializeStatefulValue,planJourneyEventIntelligenceTombstone,
  type JourneyEventIntelligenceMapping,type GovernedVisit} from '../src/journeyEventStageIntelligenceDomain.js';
const mapping:JourneyEventIntelligenceMapping={id:'mapping-v1',spaceId:'space-a',sourceId:'source-a',environment:'production',eventName:'checkout_completed',
  schemaVersionId:'schema-v1',journeyDefinitionId:'journey-a',journeyMapVersionId:'map-v1',stageKey:'purchase',stageRuleVersionId:'rule-v1',
  metricDefinitionId:'metric-a',metricDefinitionVersionId:'metric-v1',metricDefinitionVersionSha256:'a'.repeat(64),metricUnit:'count',
  projectionVersion:'event-stage-v1',valueMode:'count',constantValue:null,numericPropertyPath:null,dimensionKeys:['channel','environment'],
  consentRequirement:'granted',purpose:'analytics',retentionDays:30};
const visit:GovernedVisit={id:'visit-a',spaceId:'space-a',sourceId:'source-a',environment:'production',eventName:'checkout_completed',
  schemaVersionId:'schema-v1',journeyDefinitionId:'journey-a',journeyMapVersionId:'map-v1',stageKey:'purchase',stageRuleVersionId:'rule-v1',
  subjectIdHmac:'b'.repeat(64),channel:'web',consentState:'granted',occurredAt:'2026-08-08T12:00:00.000Z',createdAt:'2026-08-08T12:00:01.000Z',
  rawRetentionExpiresAt:'2026-09-01T00:00:00.000Z',visitRetentionExpiresAt:'2026-09-02T00:00:00.000Z',serverExtractedNumericValue:null,privacyErased:false};
test('derives only exact server-owned lineage and bounded dimensions',()=>{const result=deriveJourneyEventIntelligenceRecord(mapping,visit);
  assert.equal(result.state,'ready');assert.equal(result.value,1);assert.deepEqual(result.dimensions,{channel:'web',environment:'production'});
  assert.throws(()=>deriveJourneyEventIntelligenceRecord(mapping,{...visit,schemaVersionId:'caller-version'}),/lineage/);});
test('fails closed for consent, erasure, retention and invalid numeric values',()=>{
  assert.equal(deriveJourneyEventIntelligenceRecord(mapping,{...visit,consentState:'partial'}).blockReason,'consent_denied');
  assert.equal(deriveJourneyEventIntelligenceRecord(mapping,{...visit,privacyErased:true}).blockReason,'privacy_erased');
  assert.equal(deriveJourneyEventIntelligenceRecord(mapping,{...visit,rawRetentionExpiresAt:visit.createdAt}).blockReason,'retention_expired');
  assert.equal(deriveJourneyEventIntelligenceRecord({...mapping,valueMode:'numeric_property',numericPropertyPath:'properties.score'},
    {...visit,serverExtractedNumericValue:Number.NaN}).blockReason,'numeric_value_invalid');});
test('stateful elapsed materialization and tombstones are deterministic and content-safe',()=>{
  assert.equal(materializeStatefulValue({mode:'elapsed_since_prior',priorOccurredAt:'2026-08-08T11:59:00.000Z',occurredAt:visit.occurredAt}),60);
  assert.equal(materializeStatefulValue({mode:'elapsed_since_prior',priorOccurredAt:null,occurredAt:visit.occurredAt}),null);
  const plan=planJourneyEventIntelligenceTombstone({outboxId:'outbox-a',reason:'reprojection',correctionRef:'private-reference',at:visit.createdAt});
  assert.match(plan.correctionRefSha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(plan),/private-reference/);});
