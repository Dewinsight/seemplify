import crypto from 'node:crypto';

export type JourneyEventIntelligenceMapping=Readonly<{
  id:string;spaceId:string;sourceId:string;environment:'development'|'staging'|'production';eventName:string;
  schemaVersionId:string;journeyDefinitionId:string;journeyMapVersionId:string;stageKey:string;
  stageRuleVersionId:string;metricDefinitionId:string;metricDefinitionVersionId:string;
  metricDefinitionVersionSha256:string;metricUnit:string;projectionVersion:string;
  valueMode:'count'|'constant'|'numeric_property'|'elapsed_since_prior';constantValue:number|null;
  numericPropertyPath:string|null;dimensionKeys:readonly ('channel'|'environment')[];
  consentRequirement:'granted'|'granted_or_not_required';purpose:'service_improvement'|'analytics'|'research';retentionDays:number;
}>;
export type GovernedVisit=Readonly<{id:string;spaceId:string;sourceId:string;environment:string;eventName:string;schemaVersionId:string;
  journeyDefinitionId:string;journeyMapVersionId:string;stageKey:string;stageRuleVersionId:string;subjectIdHmac:string;
  channel:string;consentState:'unknown'|'granted'|'denied'|'partial'|'not_required';occurredAt:string;createdAt:string;
  rawRetentionExpiresAt:string;visitRetentionExpiresAt:string;serverExtractedNumericValue:number|null;privacyErased:boolean}>;
export type DerivedAdapterRecord=Readonly<{state:'ready'|'blocked';blockReason:null|'consent_denied'|'consent_unknown'|'retention_expired'|'privacy_erased'|'numeric_value_invalid';
  value:number|null;dimensions:Readonly<Record<string,string>>;retentionExpiresAt:string;intentSha256:string}>;

const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const finite=(value:number|null)=>value===null||Number.isFinite(value);
export function deriveJourneyEventIntelligenceRecord(mapping:JourneyEventIntelligenceMapping,visit:GovernedVisit):DerivedAdapterRecord{
  const exact=mapping.spaceId===visit.spaceId&&mapping.sourceId===visit.sourceId&&mapping.environment===visit.environment
    &&mapping.eventName===visit.eventName&&mapping.schemaVersionId===visit.schemaVersionId
    &&mapping.journeyDefinitionId===visit.journeyDefinitionId&&mapping.journeyMapVersionId===visit.journeyMapVersionId
    &&mapping.stageKey===visit.stageKey&&mapping.stageRuleVersionId===visit.stageRuleVersionId;
  if(!exact)throw new Error('Server-owned mapping lineage does not match the processed visit.');
  const created=Date.parse(visit.createdAt),retention=Math.min(Date.parse(visit.rawRetentionExpiresAt),Date.parse(visit.visitRetentionExpiresAt),
    created+mapping.retentionDays*86_400_000);if(!Number.isFinite(created)||!Number.isFinite(retention))throw new Error('Adapter time lineage is invalid.');
  let state:'ready'|'blocked'='ready',blockReason:DerivedAdapterRecord['blockReason']=null,value:number|null=null;
  if(visit.privacyErased){state='blocked';blockReason='privacy_erased'}
  else if(retention<=created){state='blocked';blockReason='retention_expired'}
  else if(visit.consentState==='denied'||visit.consentState==='partial'){state='blocked';blockReason='consent_denied'}
  else if(visit.consentState==='unknown'||(mapping.consentRequirement==='granted'&&visit.consentState!=='granted')){
    state='blocked';blockReason='consent_unknown'}
  else if(mapping.valueMode==='count')value=1;
  else if(mapping.valueMode==='constant')value=mapping.constantValue;
  else if(mapping.valueMode==='numeric_property'){value=visit.serverExtractedNumericValue;if(!finite(value)||value===null){state='blocked';blockReason='numeric_value_invalid';value=null}}
  const dimensions=Object.freeze(Object.fromEntries(mapping.dimensionKeys.map((key)=>[key,key==='channel'?visit.channel:visit.environment])));
  const retentionExpiresAt=new Date(retention).toISOString();const intentSha256=sha(JSON.stringify({mappingVersionId:mapping.id,visitId:visit.id,
    subjectIdHmac:visit.subjectIdHmac,value,dimensions,retentionExpiresAt,state,blockReason}));
  return Object.freeze({state,blockReason,value,dimensions,retentionExpiresAt,intentSha256});
}

export function materializeStatefulValue(input:{mode:JourneyEventIntelligenceMapping['valueMode'];occurredAt:string;
  priorOccurredAt:string|null}):number|null{
  if(input.mode!=='elapsed_since_prior')return null;if(!input.priorOccurredAt)return null;
  const delta=(Date.parse(input.occurredAt)-Date.parse(input.priorOccurredAt))/1000;
  return Number.isFinite(delta)&&delta>=0?delta:null;
}

export function planJourneyEventIntelligenceTombstone(input:{outboxId:string;reason:'correction'|'reprojection'|'privacy_erasure'|'retention_expiry';
  correctionRef:string;at:string}){if(!input.outboxId||!input.correctionRef||!Number.isFinite(Date.parse(input.at)))throw new Error('Tombstone input is invalid.');
  return Object.freeze({sourceOutboxId:input.outboxId,reason:input.reason,correctionRefSha256:sha(input.correctionRef),createdAt:new Date(input.at).toISOString()});}
