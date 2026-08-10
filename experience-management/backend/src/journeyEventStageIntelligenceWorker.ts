import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { db } from './database.js';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { JourneyEventStageIntelligenceRepository } from './journeyEventStageIntelligenceRepository.js';

type Telemetry=(level:'info'|'error',event:Record<string,unknown>)=>void;
const fingerprint=(error:unknown)=>crypto.createHash('sha256').update(error instanceof Error?`${error.name}:${error.message}`:String(error)).digest('hex');
const telemetry:Telemetry=(level,event)=>{const line=JSON.stringify({component:'journey-event-intelligence-worker',...event});
  if(level==='error')console.error(line);else console.info(line);};

export class JourneyEventStageIntelligenceWorker{
  private timer:NodeJS.Timeout|null=null;private running=false;private stopped=true;
  constructor(private readonly repository:JourneyEventStageIntelligenceRepository,private readonly intervalMs=1_000,
    private readonly batchSize=25,private readonly emit:Telemetry=telemetry,private readonly database:DatabaseRuntime=db){}
  start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>this.runOnce(),this.intervalMs);this.timer.unref();this.runOnce();}
  runOnce(at=new Date().toISOString()){
    if(this.stopped||this.running)return null;this.running=true;let materialized=0,retired=0,blocked=0,failed=0;
    try{
      const expired=this.database.prepare(`SELECT id,state FROM journey_event_intelligence_outbox WHERE retention_expires_at<=?
        AND state IN ('ready','materialized') ORDER BY retention_expires_at,id LIMIT ?`).all(at,this.batchSize) as any[];
      for(const row of expired){try{if(row.state==='ready'){blocked+=this.database.prepare(`UPDATE journey_event_intelligence_outbox
          SET state='blocked',block_reason='retention_expired' WHERE id=? AND state='ready'`).run(row.id).changes;}
        else{this.repository.tombstone({outboxId:String(row.id),reason:'retention_expiry',correctionRef:`retention:${row.id}`,at});retired+=1;}}
        catch(error){failed+=1;this.emit('error',{event:'journey_event_intelligence_retention_failed',at,errorFingerprint:fingerprint(error)});}}
      const ready=this.database.prepare(`SELECT id FROM journey_event_intelligence_outbox WHERE state='ready' AND retention_expires_at>?
        ORDER BY created_at,id LIMIT ?`).all(at,this.batchSize) as any[];
      for(const row of ready){try{const result=this.repository.materialize(String(row.id),at);if(!result.replayed)materialized+=1;}
        catch(error){failed+=1;this.emit('error',{event:'journey_event_intelligence_materialization_failed',at,errorFingerprint:fingerprint(error)});}}
      if(materialized||retired||blocked||failed)this.emit('info',{event:'journey_event_intelligence_pass',at,materialized,retired,blocked,failed});
      return {materialized,retired,blocked,failed};
    }finally{this.running=false;}
  }
  stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
  async drain(timeoutMs=8_000){const deadline=Date.now()+timeoutMs;while(this.running&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));return !this.running;}
}

export function createJourneyEventStageIntelligenceWorker(){
  if(!config.journeyEventIntelligenceWorkerEnabled)return null;
  const key=fs.readFileSync(config.journeyIdentityHashKeyFile);
  if(key.length<32)throw new Error('Journey event intelligence worker requires the configured identity hash key.');
  return new JourneyEventStageIntelligenceWorker(new JourneyEventStageIntelligenceRepository(db,key.toString('base64url')),
    config.journeyEventIntelligenceWorkerPollMs,config.journeyEventIntelligenceWorkerBatchSize);
}
