import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { createDatabase, type DatabaseRuntime } from './databaseAdapter.js';
import { JourneyPrivacyAuthorityRepository, journeyPrivacyCheckpointSha256,
  type JourneyPrivacyServiceAuthority } from './journeyPrivacyAuthorityRepository.js';
import { JourneyPrivacyPropagationRepository } from './journeyPrivacyPropagationWorker.js';

type RuntimeOptions={enabled:boolean;databaseProvider:string;pollMs:number;batchSize:number;leaseSeconds:number;principalId:string;
  keyId:string;keyRef:string;secretFile:string;identityKeyFile:string;postgres:any};
type Telemetry=(level:'info'|'error',event:Record<string,unknown>)=>void;
const emit:Telemetry=(level,event)=>{const line=JSON.stringify({component:'journey-privacy-propagation-worker',...event});
  if(level==='error')console.error(line);else console.info(line);};
const fingerprint=(error:unknown)=>crypto.createHash('sha256').update(error instanceof Error?`${error.name}:${error.message}`:String(error)).digest('hex');

export class JourneyPrivacyPropagationRuntime{
  private timer:NodeJS.Timeout|null=null;private running=false;private stopped=true;
  constructor(private readonly database:DatabaseRuntime,private readonly authorityRepository:JourneyPrivacyAuthorityRepository,
    private readonly propagationRepository:JourneyPrivacyPropagationRepository,private authority:JourneyPrivacyServiceAuthority,
    private readonly pollMs:number,private readonly batchSize:number,private readonly leaseSeconds:number,private readonly telemetry:Telemetry=emit){}
  start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>this.runOnce(),this.pollMs);this.timer.unref();this.runOnce();}
  runOnce(at=new Date().toISOString()){if(this.stopped||this.running)return null;this.running=true;let processed=0,failed=0;
    try{for(let index=0;index<this.batchSize;index+=1){const leaseToken=crypto.randomBytes(32).toString('base64url');
      let reserved;try{reserved=this.authorityRepository.claim(this.authority,{leaseToken,leaseSeconds:this.leaseSeconds,at});}
      catch(error){failed+=1;this.telemetry('error',{event:'journey_privacy_claim_failed',at,errorFingerprint:fingerprint(error)});break;}
      if(!reserved)break;try{const result=reserved.claim.source_type==='privacy_job'
        ?this.propagationRepository.processNext(String(reserved.claim.source_id),at)
        :this.propagationRepository.processNextCorrection(String(reserved.claim.source_id),at);
        if(!result)throw new Error('Claimed privacy source is unavailable.');const checkpoint=result.checkpoint;
        const state=checkpoint.status==='running'?'pending':checkpoint.status;
        this.authorityRepository.checkpoint(this.authority,{claimId:String(reserved.claim.id),leaseToken,
          leaseGeneration:Number(reserved.claim.lease_generation),expectedRevision:Number(reserved.claim.revision),state,
          checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at});
        processed+=1;
      }catch(error){failed+=1;this.telemetry('error',{event:'journey_privacy_projection_failed',at,
        claimIdSha256:crypto.createHash('sha256').update(String(reserved.claim.id)).digest('hex'),errorFingerprint:fingerprint(error)});}}
      if(processed||failed)this.telemetry('info',{event:'journey_privacy_pass',at,processed,failed});return {processed,failed};
    }finally{this.running=false;}}
  stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
  async drain(timeoutMs=8_000){this.stop();const deadline=Date.now()+timeoutMs;while(this.running&&Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,10));if(!this.running)this.database.close();return !this.running;}
}

export function createJourneyPrivacyPropagationRuntime(options:RuntimeOptions={enabled:config.journeyPrivacyWorkerEnabled,
  databaseProvider:config.databaseProvider,pollMs:config.journeyPrivacyWorkerPollMs,batchSize:config.journeyPrivacyWorkerBatchSize,
  leaseSeconds:config.journeyPrivacyWorkerLeaseSeconds,principalId:config.journeyPrivacyWorkerPrincipalId,
  keyId:config.journeyPrivacyWorkerKeyId,keyRef:config.journeyPrivacyWorkerKeyRef,secretFile:config.journeyPrivacyWorkerSecretFile,
  identityKeyFile:config.journeyIdentityHashKeyFile,postgres:config.journeyPrivacyWorkerPostgres},telemetry:Telemetry=emit){
  if(!options.enabled)return null;if(options.databaseProvider!=='postgres')throw new Error('Journey privacy worker requires PostgreSQL.');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.principalId)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.keyId)
    ||!/^(kms|vault|external-file):\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$/u.test(options.keyRef))
    throw new Error('Journey privacy worker principal metadata is incomplete.');
  if(!options.keyRef.startsWith('external-file://'))throw new Error('Journey privacy worker has no configured resolver for this key reference.');
  const secret=fs.readFileSync(options.secretFile);const identityKey=fs.readFileSync(options.identityKeyFile);
  if(secret.length<32||identityKey.length<32)throw new Error('Journey privacy worker governed key material is unavailable.');
  const database=createDatabase({databaseProvider:'postgres',databasePath:'',postgres:options.postgres});
  try{const authorityRepository=new JourneyPrivacyAuthorityRepository(database);const row=database.prepare(
      'SELECT key_ref FROM journey_privacy_service_principals WHERE id=? AND key_id=?').get(options.principalId,options.keyId) as any;
    if(!row||row.key_ref!==options.keyRef)throw new Error('Journey privacy worker key reference does not match the active principal.');
    const workerIdSha256=crypto.createHmac('sha256',secret).update(`${options.principalId}:${options.keyId}`).digest('hex');
    const authority=authorityRepository.authenticate({principalId:options.principalId,keyId:options.keyId,workerIdSha256,at:new Date().toISOString()});
    const propagationRepository=new JourneyPrivacyPropagationRepository(database,identityKey,
      (_spaceId,jobId)=>Boolean((database.prepare('SELECT journey_privacy_erasure_ready(?,?) ready')
        .get(options.principalId,jobId) as {ready?:unknown}|undefined)?.ready),input=>{
          const row=database.prepare('SELECT * FROM journey_actual_path_privacy_invalidate(?,?,?,?,?,?)')
            .get(options.principalId,input.operation==='correction'?'correction_run':'privacy_job',input.sourceId,
              input.spaceId,input.journeyDefinitionId,input.at) as any;
          if(!row)throw new Error('Actual-path privacy invalidation returned no fenced outcome.');
          return Number(row.removed_snapshots||0)+Number(row.removed_rollups||0);
        });
    return new JourneyPrivacyPropagationRuntime(database,authorityRepository,propagationRepository,authority,
      options.pollMs,options.batchSize,options.leaseSeconds,telemetry);
  }catch(error){database.close();throw error;}
}
