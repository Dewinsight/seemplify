import {journeyRetentionErrorFingerprint,planJourneyRawRetention,type JourneyRawRetentionCandidate,
  type JourneyRawRetentionCursor} from './journeyEventRetention.js';

export type JourneyEventRetentionPage={rows:JourneyRawRetentionCandidate[]};
export type JourneyEventRetentionWorkerPort={scan(input:{asOf:string;limit:number;cursor:JourneyRawRetentionCursor|null}):JourneyEventRetentionPage;
  purge(input:{candidate:JourneyRawRetentionCandidate;asOf:string}):{purgedCount:number;outcomeCode:string};
  checkpoint(input:{cursor:JourneyRawRetentionCursor|null;scanned:number;purged:number;blocked:number;failed:number;complete:boolean}):void};
type Telemetry=(level:'info'|'error',event:Record<string,unknown>)=>void;

export class JourneyEventRetentionWorker{
  constructor(private readonly port:JourneyEventRetentionWorkerPort,private readonly telemetry:Telemetry=()=>{}){}
  runPage(input:{asOf:string;limit:number;cursor:JourneyRawRetentionCursor|null}){const bounded=Math.max(1,Math.min(500,Math.trunc(input.limit)||1));
    const page=this.port.scan({asOf:input.asOf,limit:bounded+1,cursor:input.cursor});
    const planned=planJourneyRawRetention({asOf:input.asOf,limit:bounded,rows:page.rows});let purged=0,blocked=0,failed=0;
    for(const row of planned.planned){if(row.disposition!=='purgeable'){blocked+=1;continue;}try{const outcome=this.port.purge({candidate:row.candidate,
        asOf:input.asOf});if(outcome.outcomeCode==='purged')purged+=outcome.purgedCount;else blocked+=1;}catch(error){failed+=1;
        this.telemetry('error',{event:'journey_event_retention_candidate_failed',at:input.asOf,errorFingerprint:journeyRetentionErrorFingerprint(error)});}}
    const complete=planned.nextCursor===null;this.port.checkpoint({cursor:planned.nextCursor,scanned:planned.planned.length,purged,blocked,failed,complete});
    const result={scanned:planned.planned.length,purged,blocked,failed,nextCursor:planned.nextCursor,complete};
    this.telemetry('info',{event:'journey_event_retention_page',at:input.asOf,scanned:result.scanned,purged,blocked,failed,complete});return result;}
}
