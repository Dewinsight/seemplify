import { api } from './api';

export type JourneyEventMapping={id:string;sourceId:string;environment:string;eventName:string;state:'draft'|'active'|'retired';revision:number;
  versionNumber:number|null;schemaVersionId:string|null;journeyDefinitionId:string|null;journeyMapVersionId:string|null;stageKey:string|null;
  stageRuleVersionId:string|null;metricDefinitionId:string|null;metricDefinitionVersionId:string|null;metricDefinitionVersionSha256:string|null;
  metricUnit:string|null;valueMode:string|null;constantValue:number|null;numericPropertyPath:string|null;dimensionKeys:string[];
  consentRequirement:string|null;purpose:string|null;retentionDays:number|null;projectionVersion:string|null;contentSha256:string|null};
export type JourneyEventMappingInput={sourceId:string;environment:'development'|'staging'|'production';eventName:string;schemaVersionId:string;
  journeyDefinitionId:string;journeyMapVersionId:string;stageKey:string;stageRuleVersionId:string;metricDefinitionId:string;
  metricDefinitionVersionId:string;metricUnit:'score'|'percent'|'count'|'seconds'|'minutes'|'hours'|'rate'|'index'|'currency'|'unknown';
  valueMode:'count'|'constant'|'numeric_property'|'elapsed_since_prior';constantValue:number|null;numericPropertyPath:string|null;
  dimensionKeys:('channel'|'environment')[];consentRequirement:'granted'|'granted_or_not_required';purpose:'service_improvement'|'analytics'|'research';retentionDays:number};
const text=(value:unknown)=>typeof value==='string'?value:null;const number=(value:unknown)=>typeof value==='number'?value:Number(value);
function parseRow(value:any):JourneyEventMapping{if(!value||typeof value!=='object'||!text(value.id))throw new Error('Invalid event mapping response.');
  let dimensions:string[]=[];try{dimensions=Array.isArray(value.dimension_keys_json)?value.dimension_keys_json:JSON.parse(value.dimension_keys_json||'[]');}catch{}
  return{id:value.id,sourceId:String(value.source_id),environment:String(value.environment),eventName:String(value.event_name),state:value.state,
    revision:number(value.revision),versionNumber:value.version_number==null?null:number(value.version_number),schemaVersionId:text(value.schema_version_id),
    journeyDefinitionId:text(value.journey_definition_id),journeyMapVersionId:text(value.journey_map_version_id),stageKey:text(value.stage_key),
    stageRuleVersionId:text(value.stage_rule_version_id),metricDefinitionId:text(value.metric_definition_id),metricDefinitionVersionId:text(value.metric_definition_version_id),
    metricDefinitionVersionSha256:text(value.metric_definition_version_sha256),metricUnit:text(value.metric_unit),valueMode:text(value.value_mode),
    constantValue:value.constant_value==null?null:number(value.constant_value),numericPropertyPath:text(value.numeric_property_path),dimensionKeys:dimensions,
    consentRequirement:text(value.consent_requirement),purpose:text(value.purpose),retentionDays:value.retention_days==null?null:number(value.retention_days),
    projectionVersion:text(value.projection_version),contentSha256:text(value.content_sha256)};}
export async function listJourneyEventMappings(){const response=await api<any>('/api/journey-event-intelligence/mappings');
  if(!Array.isArray(response?.mappings))throw new Error('Invalid event mapping list.');return response.mappings.map(parseRow);}
export async function createJourneyEventMapping(input:JourneyEventMappingInput){return api('/api/journey-event-intelligence/mappings',{method:'POST',body:JSON.stringify(input)});}
export async function appendJourneyEventMappingVersion(mappingId:string,expectedRevision:number,input:JourneyEventMappingInput){return api(`/api/journey-event-intelligence/mappings/${encodeURIComponent(mappingId)}/versions`,{method:'POST',body:JSON.stringify({expectedRevision,version:input})});}
export async function retireJourneyEventMapping(mappingId:string,expectedRevision:number){return api(`/api/journey-event-intelligence/mappings/${encodeURIComponent(mappingId)}/retire`,{method:'POST',body:JSON.stringify({expectedRevision})});}
