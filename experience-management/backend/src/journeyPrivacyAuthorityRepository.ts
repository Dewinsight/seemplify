import crypto from 'node:crypto';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { journeyPrivacyPropagationTargets, parseJourneyPrivacyCheckpoint,
  type JourneyPrivacyCheckpoint } from './journeyPrivacyPropagationDomain.js';

const parse=<T>(value:unknown,fallback:T):T=>{try{return (typeof value==='string'?JSON.parse(value):value) as T;}catch{return fallback;}};
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`
  :JSON.stringify(value);
const sha=(value:unknown)=>crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const iso=(value:Date|string=new Date())=>{const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))throw new Error('Timestamp is invalid.');return parsed.toISOString();};
const unique=(values:readonly string[])=>[...new Set(values)];
const placeholders=(values:readonly unknown[])=>values.map(()=>'?').join(',');

export type JourneyPrivacyServiceAuthority={kind:'journey_privacy_worker';principalId:string;keyId:string;workerIdSha256:string;
  allowedSpaceIds:readonly string[];allowedRegions:readonly string[];expiresAt:string};
export type JourneyPrivacyOperatorAuthority={kind:'journey_privacy_operator';userId:string;platformAdmin:true};

export class JourneyPrivacyAuthorityError extends Error{
  constructor(message:string,public readonly code:string){super(message);this.name='JourneyPrivacyAuthorityError';}
}
const fail=(message:string,code:string):never=>{throw new JourneyPrivacyAuthorityError(message,code);};

export function initializeJourneyPrivacyAuthoritySqlite(db:DatabaseRuntime){if(db.provider!=='sqlite')return;
  db.exec(`
  CREATE TABLE IF NOT EXISTS journey_privacy_service_principals(id TEXT PRIMARY KEY,key_id TEXT NOT NULL UNIQUE,key_ref TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,allowed_space_ids_json TEXT NOT NULL,allowed_regions_json TEXT NOT NULL,not_before TEXT NOT NULL,expires_at TEXT NOT NULL,
    revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_privacy_service_key_audit(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,action TEXT NOT NULL,
    previous_key_id_sha256 TEXT,resulting_key_id_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,detail_json TEXT NOT NULL,
    detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_privacy_erasure_authorities(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,privacy_job_id TEXT NOT NULL,
    legal_hold_state TEXT NOT NULL,backup_state TEXT NOT NULL,region_state TEXT NOT NULL,raw_erasure_state TEXT NOT NULL,
    authority_reference_sha256 TEXT,reviewed_by_user_id TEXT,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    completed_at TEXT,UNIQUE(space_id,privacy_job_id));
  CREATE TABLE IF NOT EXISTS journey_privacy_propagation_claims(id TEXT PRIMARY KEY,source_type TEXT NOT NULL,source_id TEXT NOT NULL,
    space_id TEXT NOT NULL,operation TEXT NOT NULL,state TEXT NOT NULL,available_at TEXT NOT NULL,lease_owner_sha256 TEXT,
    lease_token_sha256 TEXT,lease_generation INTEGER NOT NULL,lease_expires_at TEXT,attempt_count INTEGER NOT NULL,
    checkpoint_json TEXT NOT NULL,checkpoint_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    completed_at TEXT,UNIQUE(source_type,source_id),UNIQUE(id,space_id));
  CREATE INDEX IF NOT EXISTS journey_privacy_propagation_claim ON journey_privacy_propagation_claims(state,available_at,lease_expires_at,created_at,id);
  CREATE TABLE IF NOT EXISTS journey_privacy_propagation_events(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL,space_id TEXT NOT NULL,event TEXT NOT NULL,
    lease_generation INTEGER NOT NULL,revision INTEGER NOT NULL,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(claim_id,lease_generation,revision,event));
  CREATE TRIGGER IF NOT EXISTS journey_privacy_key_audit_immutable BEFORE UPDATE ON journey_privacy_service_key_audit
    BEGIN SELECT RAISE(ABORT,'privacy key audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_key_audit_no_delete BEFORE DELETE ON journey_privacy_service_key_audit
    BEGIN SELECT RAISE(ABORT,'privacy key audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_events_immutable BEFORE UPDATE ON journey_privacy_propagation_events
    BEGIN SELECT RAISE(ABORT,'privacy propagation events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_events_no_delete BEFORE DELETE ON journey_privacy_propagation_events
    BEGIN SELECT RAISE(ABORT,'privacy propagation events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_principal_identity BEFORE UPDATE ON journey_privacy_service_principals
    WHEN NEW.id<>OLD.id OR NEW.key_id<>OLD.key_id OR NEW.key_ref<>OLD.key_ref OR NEW.allowed_space_ids_json<>OLD.allowed_space_ids_json
      OR NEW.allowed_regions_json<>OLD.allowed_regions_json OR NEW.not_before<>OLD.not_before OR NEW.expires_at<>OLD.expires_at
      OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
    BEGIN SELECT RAISE(ABORT,'invalid privacy principal lifecycle'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_principal_no_delete BEFORE DELETE ON journey_privacy_service_principals
    BEGIN SELECT RAISE(ABORT,'privacy principal history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_authority_identity BEFORE UPDATE ON journey_privacy_erasure_authorities
    WHEN NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.privacy_job_id<>OLD.privacy_job_id OR NEW.created_at<>OLD.created_at
      OR NEW.revision<>OLD.revision+1 OR OLD.raw_erasure_state='completed'
    BEGIN SELECT RAISE(ABORT,'invalid privacy erasure authority lifecycle'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_authority_no_delete BEFORE DELETE ON journey_privacy_erasure_authorities
    BEGIN SELECT RAISE(ABORT,'privacy erasure authority cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_claim_identity BEFORE UPDATE ON journey_privacy_propagation_claims
    WHEN NEW.id<>OLD.id OR NEW.source_type<>OLD.source_type OR NEW.source_id<>OLD.source_id OR NEW.space_id<>OLD.space_id
      OR NEW.operation<>OLD.operation OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
    BEGIN SELECT RAISE(ABORT,'invalid privacy claim lifecycle'); END;
  CREATE TRIGGER IF NOT EXISTS journey_privacy_claim_no_delete BEFORE DELETE ON journey_privacy_propagation_claims
    BEGIN SELECT RAISE(ABORT,'privacy claim history cannot be deleted'); END;`);
}

export class JourneyPrivacyAuthorityRepository{
  constructor(private readonly db:DatabaseRuntime){initializeJourneyPrivacyAuthoritySqlite(db);}

  provisionPrincipal(input:{id:string;keyId:string;keyRef:string;allowedSpaceIds:string[];allowedRegions:string[];
    notBefore:string;expiresAt:string;at:string}){this.validatePrincipal(input);const spaces=unique(input.allowedSpaceIds),regions=unique(input.allowedRegions);
    const at=iso(input.at);this.db.transaction(()=>{this.db.prepare(`INSERT INTO journey_privacy_service_principals
      (id,key_id,key_ref,state,allowed_space_ids_json,allowed_regions_json,not_before,expires_at,revision,created_at,updated_at)
      VALUES (?,?,?,'active',?,?,?,?,1,?,?)`).run(input.id,input.keyId,input.keyRef,JSON.stringify(spaces),JSON.stringify(regions),
        iso(input.notBefore),iso(input.expiresAt),at,at);this.auditKey(input.id,'provisioned',null,input.keyId,1,{spaceCount:spaces.length,regionCount:regions.length},at);})();
    return this.principal(input.id);}

  rotatePrincipal(input:{currentPrincipalId:string;expectedRevision:number;nextId:string;nextKeyId:string;nextKeyRef:string;
    notBefore:string;expiresAt:string;at:string}){const current=this.principal(input.currentPrincipalId);if(current.state!=='active'||current.revision!==input.expectedRevision)
      fail('Privacy principal changed.','PRIVACY_PRINCIPAL_STALE');const scope={allowedSpaceIds:parse<string[]>(current.allowed_space_ids_json,[]),
        allowedRegions:parse<string[]>(current.allowed_regions_json,[])};this.validatePrincipal({id:input.nextId,keyId:input.nextKeyId,keyRef:input.nextKeyRef,
          ...scope,notBefore:input.notBefore,expiresAt:input.expiresAt,at:input.at});const at=iso(input.at);
    return this.db.transaction(()=>{this.db.prepare(`UPDATE journey_privacy_service_principals SET state='draining',revision=revision+1,updated_at=?
      WHERE id=? AND state='active' AND revision=?`).run(at,current.id,input.expectedRevision);
      this.db.prepare(`INSERT INTO journey_privacy_service_principals
        (id,key_id,key_ref,state,allowed_space_ids_json,allowed_regions_json,not_before,expires_at,revision,created_at,updated_at)
        VALUES (?,?,?,'active',?,?,?,?,1,?,?)`).run(input.nextId,input.nextKeyId,input.nextKeyRef,current.allowed_space_ids_json,
          current.allowed_regions_json,iso(input.notBefore),iso(input.expiresAt),at,at);
      this.auditKey(current.id,'rotation_started',current.key_id,input.nextKeyId,current.revision+1,{replacementPrincipalSha256:sha(input.nextId)},at);
      this.auditKey(input.nextId,'rotation_activated',current.key_id,input.nextKeyId,1,{replacesPrincipalSha256:sha(current.id)},at);
      return {previous:this.principal(current.id),current:this.principal(input.nextId)};})();}

  revokePrincipal(input:{principalId:string;expectedRevision:number;at:string}){const at=iso(input.at);const row=this.principal(input.principalId);
    if(row.state==='revoked'||row.revision!==input.expectedRevision)fail('Privacy principal changed.','PRIVACY_PRINCIPAL_STALE');
    this.db.transaction(()=>{this.db.prepare(`UPDATE journey_privacy_service_principals SET state='revoked',revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(at,input.principalId,input.expectedRevision);
      this.auditKey(row.id,'revoked',row.key_id,row.key_id,row.revision+1,{},at);})();return this.principal(input.principalId);}

  authenticate(input:{principalId:string;keyId:string;workerIdSha256:string;at:string}):JourneyPrivacyServiceAuthority{
    if(!/^[a-f0-9]{64}$/u.test(input.workerIdSha256))fail('Worker identity is invalid.','PRIVACY_WORKER_AUTH_INVALID');
    const row=this.principal(input.principalId),at=iso(input.at),notBefore=iso(row.not_before),expiresAt=iso(row.expires_at);
    if(row.key_id!==input.keyId||row.state!=='active'||at<notBefore||at>=expiresAt)
      fail('Privacy service authority is unavailable.','PRIVACY_WORKER_AUTH_INVALID');
    return Object.freeze({kind:'journey_privacy_worker',principalId:row.id,keyId:row.key_id,workerIdSha256:input.workerIdSha256,
      allowedSpaceIds:Object.freeze(parse<string[]>(row.allowed_space_ids_json,[])),allowedRegions:Object.freeze(parse<string[]>(row.allowed_regions_json,[])),
      expiresAt});}

  recordErasureAuthority(operator:JourneyPrivacyOperatorAuthority,input:{spaceId:string;privacyJobId:string;expectedRevision:number;
    legalHoldState:'unknown'|'clear'|'active';backupState:'unknown'|'not_applicable'|'deletion_scheduled'|'deletion_confirmed';
    regionState:'unknown'|'not_applicable'|'deletion_scheduled'|'deletion_confirmed';rawErasureState:'awaiting_authority'|'authorized'|'completed';
    authorityReferenceSha256?:string|null;at:string}){if(operator.kind!=='journey_privacy_operator'||!operator.platformAdmin)
      fail('Platform privacy authority is required.','PRIVACY_OPERATOR_REQUIRED');const job=this.db.prepare(
        'SELECT id,space_id,operation FROM journey_profile_privacy_jobs WHERE id=? AND space_id=?').get(input.privacyJobId,input.spaceId) as any;
    if(!job||job.operation!=='erasure')fail('Tenant erasure job is unavailable.','PRIVACY_ERASURE_JOB_INVALID');
    const existing=this.db.prepare('SELECT * FROM journey_privacy_erasure_authorities WHERE space_id=? AND privacy_job_id=?')
      .get(input.spaceId,input.privacyJobId) as any;const at=iso(input.at);this.validateAuthority(existing,input);
    if(!existing){if(input.expectedRevision!==0)fail('Erasure authority changed.','PRIVACY_AUTHORITY_STALE');
      this.db.prepare(`INSERT INTO journey_privacy_erasure_authorities
        (id,space_id,privacy_job_id,legal_hold_state,backup_state,region_state,raw_erasure_state,authority_reference_sha256,
         reviewed_by_user_id,revision,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(crypto.randomUUID(),input.spaceId,
          input.privacyJobId,input.legalHoldState,input.backupState,input.regionState,input.rawErasureState,input.authorityReferenceSha256||null,
          operator.userId,at,at,input.rawErasureState==='completed'?at:null);
    }else{if(existing.revision!==input.expectedRevision)fail('Erasure authority changed.','PRIVACY_AUTHORITY_STALE');
      this.db.prepare(`UPDATE journey_privacy_erasure_authorities SET legal_hold_state=?,backup_state=?,region_state=?,raw_erasure_state=?,
        authority_reference_sha256=?,reviewed_by_user_id=?,revision=revision+1,updated_at=?,completed_at=? WHERE id=? AND revision=?`).run(
          input.legalHoldState,input.backupState,input.regionState,input.rawErasureState,input.authorityReferenceSha256||null,operator.userId,at,
          input.rawErasureState==='completed'?at:null,existing.id,input.expectedRevision);}
    return this.db.prepare('SELECT * FROM journey_privacy_erasure_authorities WHERE space_id=? AND privacy_job_id=?')
      .get(input.spaceId,input.privacyJobId);}

  claim(authority:JourneyPrivacyServiceAuthority,input:{leaseToken:string;leaseSeconds:number;at:string}){this.assertAuthority(authority,false,input.at);
    if(input.leaseToken.length<24||input.leaseToken.length>256||input.leaseSeconds<5||input.leaseSeconds>300)
      fail('Privacy lease input is invalid.','PRIVACY_LEASE_INVALID');const at=iso(input.at),tokenSha=sha(input.leaseToken);
    if(this.db.provider==='postgres'){const row=this.db.prepare(
      'SELECT * FROM journey_privacy_claim(?,?,?,?,?)').get(authority.principalId,authority.workerIdSha256,tokenSha,at,input.leaseSeconds) as any;
      return row?{claim:row,leaseToken:input.leaseToken}:null;}
    return this.db.transaction(()=>{this.reapExpired(authority,at);this.seedClaims(authority,at);
      const values=[...authority.allowedSpaceIds];const row=this.db.prepare(`SELECT * FROM journey_privacy_propagation_claims
        WHERE state IN ('pending','waiting') AND available_at<=? AND space_id IN (${placeholders(values)})
        ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END,available_at,created_at,id LIMIT 1`).get(at,...values) as any;
      if(!row)return null;const expiresAt=new Date(Date.parse(at)+input.leaseSeconds*1000).toISOString();
      const changed=this.db.prepare(`UPDATE journey_privacy_propagation_claims SET state='leased',lease_owner_sha256=?,lease_token_sha256=?,
        lease_generation=lease_generation+1,lease_expires_at=?,attempt_count=attempt_count+1,revision=revision+1,updated_at=?
        WHERE id=? AND state IN ('pending','waiting') AND revision=?`).run(authority.workerIdSha256,tokenSha,expiresAt,at,row.id,row.revision).changes;
      if(!changed)return null;const claimed=this.claimRow(row.id);this.event(claimed,'claimed',sha({principalId:authority.principalId}),at);
      return {claim:claimed,leaseToken:input.leaseToken};})();}

  checkpoint(authority:JourneyPrivacyServiceAuthority,input:{claimId:string;leaseToken:string;leaseGeneration:number;expectedRevision:number;
    state:'pending'|'waiting'|'operator_required'|'completed';checkpoint:JourneyPrivacyCheckpoint;checkpointSha256:string;availableAt?:string;at:string}){
    this.assertAuthority(authority,true,input.at);const at=iso(input.at);
    const normalized=parseJourneyPrivacyCheckpoint(input.checkpoint,at);if(stable(normalized)!==stable(input.checkpoint)
      ||input.checkpointSha256!==sha(stable(input.checkpoint)))fail('Privacy checkpoint is corrupt.','PRIVACY_CHECKPOINT_INVALID');
    const expectedState=normalized.status==='running'?'pending':normalized.status;if(expectedState!==input.state)
      fail('Privacy checkpoint state is inconsistent.','PRIVACY_CHECKPOINT_INVALID');
    if(this.db.provider==='postgres')return this.db.prepare('SELECT * FROM journey_privacy_checkpoint(?,?,?,?,?,?,?,?,?,?)').get(
      authority.principalId,input.claimId,input.leaseGeneration,sha(input.leaseToken),input.expectedRevision,input.state,
      stable(input.checkpoint),input.checkpointSha256,input.availableAt?iso(input.availableAt):null,at);
    const row=this.claimRow(input.claimId);
    if(!authority.allowedSpaceIds.includes(row.space_id)||row.state!=='leased'||row.lease_owner_sha256!==authority.workerIdSha256
      ||row.lease_token_sha256!==sha(input.leaseToken)||Number(row.lease_generation)!==input.leaseGeneration
      ||Number(row.revision)!==input.expectedRevision||row.lease_expires_at<=at)fail('Privacy claim fence is invalid.','PRIVACY_CLAIM_FENCE_INVALID');
    if(input.state==='completed'&&row.operation==='erasure'){const authorityRow=this.db.prepare(
      `SELECT * FROM journey_privacy_erasure_authorities WHERE space_id=? AND privacy_job_id=?`).get(row.space_id,row.source_id) as any;
      if(!authorityRow||authorityRow.raw_erasure_state!=='completed'||authorityRow.legal_hold_state!=='clear'
        ||!['not_applicable','deletion_confirmed'].includes(authorityRow.backup_state)
        ||!['not_applicable','deletion_confirmed'].includes(authorityRow.region_state))
        fail('Physical erasure authority is incomplete.','PRIVACY_ERASURE_AUTHORITY_INCOMPLETE');}
    const available=iso(input.availableAt||at);return this.db.transaction(()=>{const completed=input.state==='completed'?at:null;
      const changed=this.db.prepare(`UPDATE journey_privacy_propagation_claims SET state=?,available_at=?,lease_owner_sha256=NULL,
        lease_token_sha256=NULL,lease_expires_at=NULL,checkpoint_json=?,checkpoint_sha256=?,revision=revision+1,updated_at=?,completed_at=?
        WHERE id=? AND state='leased' AND lease_generation=? AND lease_token_sha256=? AND revision=?`).run(input.state,available,
          stable(input.checkpoint),input.checkpointSha256,at,completed,row.id,input.leaseGeneration,sha(input.leaseToken),input.expectedRevision).changes;
      if(!changed)fail('Privacy claim fence is invalid.','PRIVACY_CLAIM_FENCE_INVALID');const settled=this.claimRow(row.id);
      const resultTable=row.source_type==='privacy_job'?'journey_profile_privacy_jobs':'journey_identity_correction_runs';
      const source=this.db.prepare(`SELECT result_json FROM ${resultTable} WHERE id=? AND space_id=?`).get(row.source_id,row.space_id) as any;
      if(!source)fail('Privacy claim source disappeared.','PRIVACY_CLAIM_SOURCE_MISSING');const result=parse<Record<string,unknown>>(source.result_json,{});
      if(row.source_type==='privacy_job')this.db.prepare(`UPDATE journey_profile_privacy_jobs SET result_json=?,state=?,completed_at=?
        WHERE id=? AND space_id=?`).run(JSON.stringify({...result,privacyPropagation:input.checkpoint}),input.state==='completed'?'completed':'queued',
          completed,row.source_id,row.space_id);else this.db.prepare(`UPDATE journey_identity_correction_runs SET result_json=? WHERE id=? AND space_id=?`)
        .run(JSON.stringify({...result,privacyPropagation:input.checkpoint}),row.source_id,row.space_id);
      this.event(settled,input.state==='pending'?'checkpointed':input.state,input.checkpointSha256,at);return settled;})();}

  private seedClaims(authority:JourneyPrivacyServiceAuthority,at:string){const values=[...authority.allowedSpaceIds];
    const jobs=this.db.prepare(`SELECT * FROM journey_profile_privacy_jobs WHERE state='queued' AND space_id IN (${placeholders(values)})
      ORDER BY created_at,id`).all(...values) as any[];for(const row of jobs)this.insertClaim('privacy_job',row.id,row.space_id,row.operation,row.result_json,at);
    const corrections=this.db.prepare(`SELECT * FROM journey_identity_correction_runs WHERE space_id IN (${placeholders(values)})
      ORDER BY created_at,id`).all(...values) as any[];for(const row of corrections){const result=parse<Record<string,any>>(row.result_json,{});
      if(!['completed','operator_required'].includes(result.privacyPropagation?.status))this.insertClaim('correction_run',row.id,row.space_id,'correction',row.result_json,at);}}

  private insertClaim(sourceType:'privacy_job'|'correction_run',sourceId:string,spaceId:string,operation:string,resultJson:unknown,at:string){
    const result=parse<Record<string,unknown>>(resultJson,{}),checkpoint=result.privacyPropagation||{};
    this.db.prepare(`INSERT INTO journey_privacy_propagation_claims
      (id,source_type,source_id,space_id,operation,state,available_at,lease_generation,attempt_count,checkpoint_json,checkpoint_sha256,
       revision,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,0,0,?,?,1,?,?) ON CONFLICT(source_type,source_id) DO NOTHING`)
      .run(`${sourceType}:${sourceId}`,sourceType,sourceId,spaceId,operation,at,JSON.stringify(checkpoint),sha(stable(checkpoint)),at,at);}

  private reapExpired(authority:JourneyPrivacyServiceAuthority,at:string){const values=[...authority.allowedSpaceIds];const rows=this.db.prepare(
    `SELECT * FROM journey_privacy_propagation_claims WHERE state='leased' AND lease_expires_at<=? AND space_id IN (${placeholders(values)})
     ORDER BY lease_expires_at,id`).all(at,...values) as any[];for(const row of rows){const changed=this.db.prepare(`UPDATE journey_privacy_propagation_claims
      SET state='waiting',available_at=?,lease_owner_sha256=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=?
      WHERE id=? AND state='leased' AND lease_generation=? AND revision=?`).run(at,at,row.id,row.lease_generation,row.revision).changes;
      if(changed)this.event(this.claimRow(row.id),'lease_expired',sha({generation:row.lease_generation}),at);}}

  private validatePrincipal(input:{id:string;keyId:string;keyRef:string;allowedSpaceIds:string[];allowedRegions:string[];
    notBefore:string;expiresAt:string;at:string}){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.keyId)
      ||!/^(kms|vault|external-file):\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$/u.test(input.keyRef)
      ||input.allowedSpaceIds.length<1||input.allowedSpaceIds.length>100||unique(input.allowedSpaceIds).length!==input.allowedSpaceIds.length
      ||input.allowedRegions.length<1||input.allowedRegions.length>32||unique(input.allowedRegions).length!==input.allowedRegions.length
      ||input.allowedRegions.some(region=>!/^[A-Z][A-Z0-9-]{1,31}$/u.test(region))||Date.parse(input.expiresAt)<=Date.parse(input.notBefore))
      fail('Privacy principal metadata is invalid.','PRIVACY_PRINCIPAL_INVALID');
    const known=Number((this.db.prepare(`SELECT COUNT(*) count FROM spaces WHERE id IN (${placeholders(input.allowedSpaceIds)})`)
      .get(...input.allowedSpaceIds) as any)?.count||0);if(known!==input.allowedSpaceIds.length)fail('Privacy principal tenant scope is invalid.','PRIVACY_PRINCIPAL_SCOPE_INVALID');}

  private validateAuthority(existing:any,input:any){const ref=input.authorityReferenceSha256;
    if(ref&&!/^[a-f0-9]{64}$/u.test(ref))fail('Erasure authority reference is invalid.','PRIVACY_AUTHORITY_INVALID');
    if(input.rawErasureState==='authorized'&&(input.legalHoldState!=='clear'||input.backupState==='unknown'||input.regionState==='unknown'||!ref))
      fail('Erasure authorization is incomplete.','PRIVACY_AUTHORITY_INCOMPLETE');
    if(input.rawErasureState==='completed'&&(!existing||existing.raw_erasure_state!=='authorized'||input.legalHoldState!=='clear'
      ||!['not_applicable','deletion_confirmed'].includes(input.backupState)||!['not_applicable','deletion_confirmed'].includes(input.regionState)||!ref))
      fail('Physical erasure completion is not authorised.','PRIVACY_AUTHORITY_INCOMPLETE');}

  private assertAuthority(authority:JourneyPrivacyServiceAuthority,allowDraining:boolean,at:string){const row=this.principal(authority.principalId),now=iso(at);
    const notBefore=iso(row.not_before),expiresAt=iso(row.expires_at);
    if(row.key_id!==authority.keyId||expiresAt!==authority.expiresAt||notBefore>now||expiresAt<=now
      ||(allowDraining?!['active','draining'].includes(row.state):row.state!=='active')
      ||stable(parse(row.allowed_space_ids_json,[]))!==stable(authority.allowedSpaceIds)
      ||stable(parse(row.allowed_regions_json,[]))!==stable(authority.allowedRegions))
      fail('Privacy service authority is unavailable.','PRIVACY_WORKER_AUTH_INVALID');}
  private principal(id:string){const row=this.db.prepare('SELECT * FROM journey_privacy_service_principals WHERE id=?').get(id) as any;
    if(!row)fail('Privacy principal is unavailable.','PRIVACY_PRINCIPAL_NOT_FOUND');return row;}
  private claimRow(id:string){const row=this.db.prepare('SELECT * FROM journey_privacy_propagation_claims WHERE id=?').get(id) as any;
    if(!row)fail('Privacy claim is unavailable.','PRIVACY_CLAIM_NOT_FOUND');return row;}
  private auditKey(principalId:string,action:string,previousKeyId:string|null,resultingKeyId:string,revision:number,
    detail:Record<string,unknown>,at:string){this.db.prepare(`INSERT INTO journey_privacy_service_key_audit
      (id,principal_id,action,previous_key_id_sha256,resulting_key_id_sha256,revision,detail_json,detail_sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),principalId,action,previousKeyId?sha(previousKeyId):null,sha(resultingKeyId),revision,
        JSON.stringify(detail),sha(stable(detail)),at);}
  private event(claim:any,event:string,detailSha256:string,at:string){this.db.prepare(`INSERT INTO journey_privacy_propagation_events
    (id,claim_id,space_id,event,lease_generation,revision,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(),claim.id,claim.space_id,event,claim.lease_generation,claim.revision,detailSha256,at);}
}

export const journeyPrivacyCheckpointSha256=(checkpoint:JourneyPrivacyCheckpoint)=>sha(stable(checkpoint));
export const journeyPrivacyRuntime47Tables=['journey_privacy_service_principals','journey_privacy_service_key_audit',
  'journey_privacy_erasure_authorities','journey_privacy_propagation_claims','journey_privacy_propagation_events'] as const;
export const journeyPrivacyCheckpointTargetCount=journeyPrivacyPropagationTargets.length;
