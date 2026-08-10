import fs from 'node:fs';
import { config } from './config.js';
import { createDatabase, type DatabaseRuntime } from './databaseAdapter.js';
import { mintConnectorWorkerCredential, type JourneyConnectorWorkerAdapter } from './journeyConnectorWorkerDomain.js';
import { JourneyConnectorWorkerRepository } from './journeyConnectorWorkerRepository.js';
import { JourneyConnectorWorkerScheduler, JourneyConnectorWorkerService } from './journeyConnectorWorkerService.js';

export type JourneyConnectorWorkerRuntime={start():void;stop(timeoutMs?:number):Promise<boolean>};
type RuntimeConfiguration={enabled:boolean;databaseProvider:string;pollMs:number;principalId:string;keyId:string;keyRef:string;
  secretFile:string;spaceIds:readonly string[];connectorIds:readonly string[];postgres:typeof config.journeyConnectorWorkerPostgres};

export function validateJourneyConnectorWorkerConfiguration(input:RuntimeConfiguration){
  if(!input.enabled)return;
  if(input.databaseProvider!=='postgres')throw new Error('The durable journey connector worker requires PostgreSQL.');
  if(!input.principalId||!input.keyId||!/^file:\/\/[A-Za-z0-9][A-Za-z0-9._/:@-]{0,500}$/u.test(input.keyRef))
    throw new Error('The journey connector worker requires an explicit principal, key, and file secret reference.');
  if(!input.spaceIds.length||input.spaceIds.length>100||!input.connectorIds.length||input.connectorIds.length>200)
    throw new Error('The journey connector worker requires an explicit bounded tenant and connector scope.');
}

const defaults=():RuntimeConfiguration=>({enabled:config.journeyConnectorWorkerEnabled,databaseProvider:config.databaseProvider,
  pollMs:config.journeyConnectorWorkerPollMs,principalId:config.journeyConnectorWorkerPrincipalId,keyId:config.journeyConnectorWorkerKeyId,
  keyRef:config.journeyConnectorWorkerKeyRef,secretFile:config.journeyConnectorWorkerSecretFile,
  spaceIds:config.journeyConnectorWorkerSpaceIds,connectorIds:config.journeyConnectorWorkerConnectorIds,
  postgres:config.journeyConnectorWorkerPostgres});

export async function createJourneyConnectorWorkerRuntime(dependencies:Readonly<{configuration?:RuntimeConfiguration;
  createWorkerDatabase?:typeof createDatabase;now?:()=>Date}>={}):Promise<JourneyConnectorWorkerRuntime|null>{
  const settings=dependencies.configuration||defaults();validateJourneyConnectorWorkerConfiguration(settings);if(!settings.enabled)return null;
  const db=(dependencies.createWorkerDatabase||createDatabase)({databaseProvider:'postgres',databasePath:'',postgres:settings.postgres});
  try{
    const principal=db.prepare('SELECT * FROM journey_connector_worker_principals WHERE id=? AND key_id=?').get(settings.principalId,settings.keyId) as any;
    if(!principal||principal.state!=='active'||String(principal.secret_ref)!==settings.keyRef)
      throw new Error('Journey connector worker principal is unavailable or requires an operator-managed rotation.');
    const parseList=(value:unknown)=>Array.isArray(value)?value.map(String):JSON.parse(String(value)) as string[];
    const storedSpaces=parseList(principal.allowed_space_ids_json),storedConnectors=parseList(principal.allowed_connector_ids_json);
    const storedAdapters=parseList(principal.allowed_adapters_json);
    if(storedSpaces.length!==settings.spaceIds.length||settings.spaceIds.some((id)=>!storedSpaces.includes(id))
      ||storedConnectors.length!==settings.connectorIds.length||settings.connectorIds.some((id)=>!storedConnectors.includes(id))
      ||!storedAdapters.includes('service_recovery_tickets_v1'))throw new Error('Journey connector worker scope differs from the operator-approved principal.');
    const sources=db.prepare(`SELECT id,space_id,connector_id,adapter FROM journey_connector_worker_sources WHERE state='active'
      AND space_id IN (${settings.spaceIds.map(()=>'?').join(',')}) AND connector_id IN (${settings.connectorIds.map(()=>'?').join(',')})`)
      .all(...settings.spaceIds,...settings.connectorIds) as any[];
    if(sources.length!==settings.connectorIds.length||settings.connectorIds.some((id)=>!sources.some((row)=>String(row.connector_id)===id)))
      throw new Error('Journey connector worker source configuration is incomplete.');
    const secret=fs.existsSync(settings.secretFile)?fs.readFileSync(settings.secretFile,'utf8').trim():'';
    if(secret.length<32)throw new Error('Journey connector worker external secret material is unavailable.');
    const resolver=(reference:string)=>reference===settings.keyRef?secret:'';
    const repository=new JourneyConnectorWorkerRepository(db,resolver);const now=(dependencies.now||(()=>new Date()))();
    const credential=mintConnectorWorkerCredential({principalId:settings.principalId,keyId:settings.keyId,
      allowedSpaceIds:[...settings.spaceIds],allowedConnectorIds:[...settings.connectorIds],
      allowedAdapters:['service_recovery_tickets_v1'] as JourneyConnectorWorkerAdapter[],issuedAt:now.toISOString(),
      expiresAt:new Date(principal.expires_at).toISOString(),secret});
    const authority=repository.authenticate({credential,at:now.toISOString()});
    const scheduler=new JourneyConnectorWorkerScheduler(new JourneyConnectorWorkerService(repository,authority),settings.pollMs);
    return{start:()=>scheduler.start(),stop:async()=>{scheduler.stop();db.close();return true;}};
  }catch(error){db.close();throw error;}
}
