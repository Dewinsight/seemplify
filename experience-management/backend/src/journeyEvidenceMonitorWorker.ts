import crypto from 'node:crypto';
import { journeyEvidenceMonitorRepository, type JourneyEvidenceMonitorRepository } from './journeyEvidenceMonitorRepository.js';

type MonitorRepository = Pick<JourneyEvidenceMonitorRepository,'seedMissing'|'claim'|'observe'|'complete'|'fail'>;
type MonitorTelemetry = (level:'info'|'error',event:Record<string,unknown>)=>void;

function defaultTelemetry(level:'info'|'error',event:Record<string,unknown>) {
  const line=JSON.stringify({component:'journey-evidence-monitor',...event});
  if(level==='error')console.error(line);else console.info(line);
}

function errorFingerprint(error:unknown) {
  return crypto.createHash('sha256').update(error instanceof Error?`${error.name}:${error.message}`:String(error)).digest('hex');
}

/** Bounded, non-overlapping evidence monitoring coordinator.
 *
 * It never refreshes reviewed evidence content. It records content-free source
 * transitions and invalidates a link only when its original attaching authority
 * can no longer resolve that exact tenant-scoped source. Individual failures are
 * fenced and retried, so one bad source cannot starve the rest of a pass.
 */
export class JourneyEvidenceMonitorWorker {
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  private stopped=true;
  private readonly owner=`journey-evidence-monitor:${crypto.randomUUID()}`;

  constructor(private readonly intervalMs=60_000,private readonly batchSize=25,
    private readonly repository:MonitorRepository=journeyEvidenceMonitorRepository,
    private readonly telemetry:MonitorTelemetry=defaultTelemetry){}

  start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>{this.runOnce();},this.intervalMs);
    this.timer.unref();this.runOnce();}

  runOnce(now:Date|string=new Date()){
    if(this.stopped||this.running)return null;
    this.running=true;
    let seeded=0,completed=0,failed=0,invalidated=0;
    try{
      seeded=this.repository.seedMissing(now,Math.max(25,Math.min(500,this.batchSize*4)));
      for(let index=0;index<Math.max(1,Math.min(100,this.batchSize));index+=1){
        const claim=this.repository.claim({owner:this.owner,now});if(!claim)break;
        try{const result=this.repository.complete(claim,this.repository.observe(claim,now),now);
          completed+=1;if(result.invalidationApplied)invalidated+=1;
        }catch(error){failed+=1;
          try{this.repository.fail(claim,error,now);}catch(failError){this.telemetry('error',{
            event:'journey_evidence_monitor_retry_record_failed',errorFingerprint:errorFingerprint(failError)});}
          this.telemetry('error',{event:'journey_evidence_monitor_item_failed',errorFingerprint:errorFingerprint(error)});}
      }
      if(seeded||completed||failed)this.telemetry('info',{event:'journey_evidence_monitor_pass',seeded,completed,failed,invalidated});
      return{seeded,completed,failed,invalidated};
    }catch(error){this.telemetry('error',{event:'journey_evidence_monitor_pass_failed',errorFingerprint:errorFingerprint(error)});
      return null;
    }finally{this.running=false;}
  }

  stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
  async drain(timeoutMs=8_000){const deadline=Date.now()+timeoutMs;while(this.running&&Date.now()<deadline)
    await new Promise((resolve)=>setTimeout(resolve,10));return!this.running;}
}

export const journeyEvidenceMonitorWorker=new JourneyEvidenceMonitorWorker();
