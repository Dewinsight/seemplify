import fs from 'node:fs';
import { config } from './config.js';
import { createDatabase } from './databaseAdapter.js';
import { authenticateJourneyWorker, mintJourneyWorkerCredential } from './journeyActionWorkerDomain.js';
import { JourneyActionWorkerSafetyRepository, productionJourneyWorkerPolicyResolver } from './journeyActionWorkerSafetyRepository.js';
import { JourneyActionWorkerScheduler } from './journeyActionWorkerScheduler.js';
import { ConsoleJourneyWorkerTelemetry, JourneyActionWorkerService } from './journeyActionWorkerService.js';
import { JourneyReviewedAdapterWorker, reviewedWorkerAdapters } from './journeyReviewedAdapterWorker.js';
import type { WorkerKeySecretResolver } from './journeyActionWorkerSafetyDomain.js';

export type JourneyActionWorkerRuntime={start():void;stop(timeoutMs?:number):Promise<boolean>};
const reviewedAdapters=new Set(reviewedWorkerAdapters);

export async function createJourneyActionWorkerRuntime(dependencies:Readonly<{createWorkerDatabase?:typeof createDatabase;now?:()=>Date}>={}):Promise<JourneyActionWorkerRuntime|null>{
  if(!config.journeyActionWorkerEnabled)return null;
  if(config.databaseProvider!=='postgres')throw new Error('The durable journey action worker requires PostgreSQL.');
  const spaces=[...config.journeyActionWorkerSpaceIds],adapters=[...config.journeyActionWorkerAdapters];
  if(!spaces.length||spaces.length>100)throw new Error('The journey action worker requires an explicit scope of 1 to 100 spaces.');
  if(!adapters.length||adapters.some((adapter)=>!reviewedAdapters.has(adapter)))throw new Error(
    'The journey action worker requires an explicit scope containing only reviewed adapters.');
  const workerDb=(dependencies.createWorkerDatabase||createDatabase)({databaseProvider:'postgres',databasePath:'',postgres:config.journeyActionWorkerPostgres});
  try{
    const found=(workerDb.prepare(`SELECT id FROM spaces WHERE id IN (${spaces.map(()=>'?').join(',')})`).all(...spaces) as Array<{id:string}>).map((row)=>String(row.id));
    if(found.length!==spaces.length)throw new Error('The journey action worker tenant scope contains an unknown space.');
    const now=(dependencies.now||(()=>new Date()))(),expiresAt=new Date(now.getTime()+365*86_400_000).toISOString();
    const resolver:WorkerKeySecretResolver={resolve:async(request)=>{
      if(request.keyId!==config.journeyActionWorkerKeyId||request.keyRef!==config.journeyActionWorkerKeyRef
        ||request.resolverKind!=='external_file')return null;
      if(!fs.existsSync(config.journeyActionWorkerSecretFile))return null;
      const material=fs.readFileSync(config.journeyActionWorkerSecretFile,'utf8').trim();
      return material.length>=32?{reference:config.journeyActionWorkerKeyRef,secret:material}:null;
    }};
    const repository=new JourneyActionWorkerSafetyRepository(workerDb,productionJourneyWorkerPolicyResolver(workerDb),resolver);
    const current=workerDb.prepare('SELECT * FROM journey_worker_service_principals WHERE key_id=?').get(config.journeyActionWorkerKeyId) as any;
    if(!current)repository.provisionPrincipal({id:'journey-action-worker',keyId:config.journeyActionWorkerKeyId,
      keyRef:config.journeyActionWorkerKeyRef,allowedSpaceIds:spaces,allowedAdapters:adapters,notBefore:now.toISOString(),expiresAt,at:now.toISOString()});
    else{
      const storedSpaces=Array.isArray(current.allowed_space_ids_json)?current.allowed_space_ids_json:JSON.parse(String(current.allowed_space_ids_json));
      const storedAdapters=Array.isArray(current.allowed_adapters_json)?current.allowed_adapters_json:JSON.parse(String(current.allowed_adapters_json));
      if(current.state!=='active'||current.key_ref!==config.journeyActionWorkerKeyRef
        ||storedSpaces.length!==spaces.length||spaces.some((space)=>!storedSpaces.includes(space))
        ||storedAdapters.length!==adapters.length||adapters.some((adapter)=>!storedAdapters.includes(adapter)))
        throw new Error('Journey action worker principal metadata requires an explicit scoped rotation.');
    }
    const secret=await repository.resolveSecretForKeyId({keyId:config.journeyActionWorkerKeyId,at:now.toISOString()});
    const principal=workerDb.prepare('SELECT expires_at FROM journey_worker_service_principals WHERE key_id=?').get(config.journeyActionWorkerKeyId) as any;
    const token=mintJourneyWorkerCredential({workerId:'journey-action-runtime',allowedSpaceIds:spaces,allowedAdapters:adapters,
      issuedAt:now.toISOString(),expiresAt:new Date(principal.expires_at).toISOString(),keyId:config.journeyActionWorkerKeyId,secret});
    const authority=authenticateJourneyWorker({credential:token,secretForKey:(keyId)=>keyId===config.journeyActionWorkerKeyId?secret:null,now:now.toISOString()});
    const telemetry=new ConsoleJourneyWorkerTelemetry();const service=new JourneyActionWorkerService(repository,telemetry,()=>new Date(),{mode:'durable',safety:repository});
    const adapterWorker=new JourneyReviewedAdapterWorker(workerDb,service);
    const scheduler=new JourneyActionWorkerScheduler(service,authority,telemetry,config.journeyActionWorkerPollMs,setTimeout,clearTimeout,
      ()=>{repository.reapExpired(new Date().toISOString());},(workerAuthority,lease)=>adapterWorker.execute(workerAuthority,lease));
    return {start:()=>scheduler.start(),stop:async(timeoutMs=10_000)=>{scheduler.stop();const drained=await scheduler.drain(timeoutMs);
      if(drained)workerDb.close();return drained;}};
  }catch(error){workerDb.close();throw error;}
}
