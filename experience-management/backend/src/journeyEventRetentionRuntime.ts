import crypto from 'node:crypto';
import { config } from './config.js';
import { createDatabase } from './databaseAdapter.js';
import { JourneyEventRetentionRepository } from './journeyEventRetentionRepository.js';
import { JourneyEventRetentionWorker } from './journeyEventRetentionWorker.js';

type Settings={enabled:boolean;databaseProvider:string;pollMs:number;batchSize:number;leaseMs:number;
  postgres:typeof config.journeyEventRetentionPostgres};
const defaults=():Settings=>({enabled:config.journeyEventRetentionWorkerEnabled,databaseProvider:config.databaseProvider,
  pollMs:config.journeyEventRetentionWorkerPollMs,batchSize:config.journeyEventRetentionWorkerBatchSize,
  leaseMs:config.journeyEventRetentionWorkerLeaseMs,postgres:config.journeyEventRetentionPostgres});
export function validateJourneyEventRetentionConfiguration(settings:Settings){if(!settings.enabled)return;
  if(settings.databaseProvider!=='postgres')throw new Error('Journey raw-event retention requires PostgreSQL.');}
export function createJourneyEventRetentionRuntime(dependencies:{settings?:Settings;createWorkerDatabase?:typeof createDatabase}={}){
  const settings=dependencies.settings||defaults();validateJourneyEventRetentionConfiguration(settings);if(!settings.enabled)return null;
  const database=(dependencies.createWorkerDatabase||createDatabase)({databaseProvider:'postgres',databasePath:'',postgres:settings.postgres});
  const repository=new JourneyEventRetentionRepository(database);let timer:NodeJS.Timeout|null=null,running=false,stopped=false;
  const owner=`journey-event-retention-${crypto.randomBytes(8).toString('hex')}`;
  const tick=async()=>{if(running||stopped)return;running=true;try{const now=new Date(),at=now.toISOString();const day=at.slice(0,10);
    repository.request({id:`retention-${day}`,kind:'retention',asOf:at,batchSize:settings.batchSize,at});
    const claim=repository.claim({owner,at,leaseExpiresAt:new Date(now.getTime()+settings.leaseMs).toISOString()});if(!claim)return;
    const cursor=repository.retentionCursor(claim);const worker=new JourneyEventRetentionWorker({
      scan:({limit,cursor:pageCursor})=>({rows:repository.scanRetentionPage({claim,limit,cursor:pageCursor})}),
      purge:({candidate})=>repository.purgeRetentionCandidate({claim,candidate}),
      checkpoint:(result)=>{repository.checkpointRetentionPage({claim,...result,at:new Date().toISOString()});}});
    worker.runPage({asOf:claim.as_of,limit:claim.batch_size,cursor});
  }catch(error){console.error('Journey event retention pass failed.',{errorFingerprint:crypto.createHash('sha256').update(String(error)).digest('hex')});
  }finally{running=false;}};
  return{start(){if(timer||stopped)return;void tick();timer=setInterval(()=>void tick(),settings.pollMs);timer.unref();},
    async stop(timeoutMs=8_000){stopped=true;if(timer)clearInterval(timer);timer=null;const deadline=Date.now()+timeoutMs;
      while(running&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));database.close();return !running;}};
}
