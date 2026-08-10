import crypto from 'node:crypto';

export type JourneyRawRetentionCursor={retentionExpiresAt:string;receivedAt:string;rawEventId:string};
export type JourneyRawRetentionCandidate={spaceId:string;sourceId:string;environment:string;rawEventId:string;
  receivedAt:string;retentionExpiresAt:string;inboxState:string|null;latestDependentExpiry:string|null;
  stageDecisionCount:number;stageVisitCount:number};
export type JourneyRawRetentionDisposition='purgeable'|'active_processing'|'dependent_retention'|'stage_reconciliation_required';
export type JourneyRawRetentionPlanRow={candidate:JourneyRawRetentionCandidate;disposition:JourneyRawRetentionDisposition};

function validIso(value:string,label:string){const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error(`Invalid ${label}.`);return parsed;}
function boundedLimit(value:number){return Math.max(1,Math.min(500,Math.trunc(value)||1));}
function compare(a:JourneyRawRetentionCandidate,b:JourneyRawRetentionCandidate){return a.retentionExpiresAt.localeCompare(b.retentionExpiresAt)
  ||a.receivedAt.localeCompare(b.receivedAt)||a.rawEventId.localeCompare(b.rawEventId);}

export function planJourneyRawRetention(input:{asOf:string;limit:number;rows:JourneyRawRetentionCandidate[]}){
  const asOf=validIso(input.asOf,'retention timestamp');const rows=[...input.rows].sort(compare).filter(row=>validIso(row.retentionExpiresAt,
    'retention expiry')<=asOf);const page=rows.slice(0,boundedLimit(input.limit));
  const planned:JourneyRawRetentionPlanRow[]=page.map(candidate=>{let disposition:JourneyRawRetentionDisposition='purgeable';
    if(candidate.inboxState&& !['completed','dead_lettered'].includes(candidate.inboxState))disposition='active_processing';
    else if(candidate.latestDependentExpiry&&validIso(candidate.latestDependentExpiry,'dependent expiry')>asOf)disposition='dependent_retention';
    else if(candidate.stageDecisionCount>0||candidate.stageVisitCount>0)disposition='stage_reconciliation_required';
    return {candidate,disposition};});
  const last=page.at(-1);return {planned,nextCursor:rows.length>page.length&&last?{
    retentionExpiresAt:last.retentionExpiresAt,receivedAt:last.receivedAt,rawEventId:last.rawEventId}:null};
}

export type JourneyEventReconciliationObservation={raw:number;terminalInbox:number;successfulReceipts:number;
  decisions:number;visits:number;expiredRaw:number};
export function deriveJourneyEventReconciliation(input:{observation:JourneyEventReconciliationObservation;windowSha256:string}){
  if(!/^[a-f0-9]{64}$/u.test(input.windowSha256))throw new Error('A content-safe source-window hash is required.');
  const o=input.observation;for(const value of Object.values(o))if(!Number.isSafeInteger(value)||value<0)throw new Error('Reconciliation counts must be non-negative integers.');
  const drift=[] as string[];if(o.terminalInbox>o.raw)drift.push('terminal_inbox_without_raw');
  if(o.successfulReceipts>o.raw)drift.push('successful_receipt_without_raw');if(o.visits>o.decisions)drift.push('visit_without_decision');
  if(o.expiredRaw>0)drift.push('retention_backlog');
  return Object.freeze({schema:'seemplify.journey-event-reconciliation/v1' as const,windowSha256:input.windowSha256,
    counts:Object.freeze({...o}),driftCodes:Object.freeze(drift),reconciled:drift.length===0});
}

export function journeyRetentionErrorFingerprint(error:unknown){const message=error instanceof Error?`${error.name}:${error.message}`:String(error);
  return crypto.createHash('sha256').update(message.slice(0,2_000)).digest('hex');}
