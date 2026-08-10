import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db } from './database.js';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { assertJourneyCapability } from './journeyCollaboration.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

export const journeyExportBrandFonts = ['Aptos', 'Arial', 'Helvetica', 'Noto Sans'] as const;
export type JourneyExportBrandFont = typeof journeyExportBrandFonts[number];
export type JourneyExportBrandSnapshot = {
  profileId: string; version: number; organisationName: string; logoAssetId: string | null;
  logo: null | { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg'; altText: string; width: number; height: number; sha256: string };
  primaryHex: string; accentHex: string; backgroundHex: string; textHex: string;
  fontFamily: JourneyExportBrandFont; footerText: string; locale: string; contentSha256: string;
};

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value);
const hash = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const iso = (value: unknown = new Date()) => { const parsed = new Date(String(value)); if (!Number.isFinite(parsed.getTime()))
  throw new JourneyExportBrandError('Timestamp is invalid.', 400, 'JOURNEY_EXPORT_BRAND_INPUT_INVALID'); return parsed.toISOString(); };
const text = (value: unknown, label: string, maximum: number, required = true) => { const result = String(value ?? '').trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) throw new JourneyExportBrandError(
    `${label} is invalid.`, 400, 'JOURNEY_EXPORT_BRAND_INPUT_INVALID'); return result; };
const hex = (value: unknown, label: string) => { const result = String(value ?? '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new JourneyExportBrandError(`${label} must be a six-digit hexadecimal colour.`, 400,
    'JOURNEY_EXPORT_BRAND_COLOUR_INVALID'); return result; };
const number = (value: unknown) => Number(value);

function luminance(colour: string) { const values = [1, 3, 5].map((offset) => parseInt(colour.slice(offset, offset + 2), 16) / 255)
  .map((component) => component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]; }
function contrast(a: string, b: string) { const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05); }

export class JourneyExportBrandError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'JOURNEY_EXPORT_BRAND_INVALID') {
    super(message); this.name = 'JourneyExportBrandError';
  }
}

type Capability = 'journeys.read' | 'journeys.edit' | 'journeys.manage_views' | 'journeys.export';
type Access = (spaceId: string, actorUserId: string, capability: Capability) => void;
const productionAccess: Access = (spaceId, actorUserId, capability) => {
  assertSubscriptionFeature(spaceId, 'journeyExports'); assertJourneyCapability(spaceId, actorUserId, capability);
};

export function initializeJourneyExportBrandingSqlite(runtime: DatabaseRuntime) {
  if (runtime.provider !== 'sqlite') return;
  runtime.exec(`
  CREATE TABLE IF NOT EXISTS journey_export_brand_assets(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_upload_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,content_sha256 TEXT NOT NULL,
    alt_text TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,created_by_user_id TEXT,updated_by_user_id TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,retired_at TEXT,retention_expires_at TEXT,UNIQUE(id,space_id),
    UNIQUE(space_id,source_upload_id),UNIQUE(space_id,content_sha256));
  CREATE TABLE IF NOT EXISTS journey_export_brand_profiles(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,name TEXT NOT NULL,state TEXT NOT NULL,
    current_version INTEGER NOT NULL,revision INTEGER NOT NULL,created_by_user_id TEXT,updated_by_user_id TEXT,created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,retired_at TEXT,retention_expires_at TEXT,UNIQUE(id,space_id),UNIQUE(id,space_id,current_version));
  CREATE UNIQUE INDEX IF NOT EXISTS journey_export_brand_profiles_active_name
    ON journey_export_brand_profiles(space_id,name COLLATE NOCASE) WHERE state='active';
  CREATE TABLE IF NOT EXISTS journey_export_brand_profile_versions(profile_id TEXT NOT NULL,space_id TEXT NOT NULL,version INTEGER NOT NULL,
    organisation_name TEXT NOT NULL,logo_asset_id TEXT,primary_hex TEXT NOT NULL,accent_hex TEXT NOT NULL,background_hex TEXT NOT NULL,
    text_hex TEXT NOT NULL,font_family TEXT NOT NULL,footer_text TEXT NOT NULL,locale TEXT NOT NULL,content_sha256 TEXT NOT NULL,
    created_by_user_id TEXT,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,space_id,version));
  CREATE TABLE IF NOT EXISTS journey_export_brand_settings(space_id TEXT PRIMARY KEY,default_profile_id TEXT,default_profile_version INTEGER,
    revision INTEGER NOT NULL,updated_by_user_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_saved_view_brand_bindings(view_id TEXT NOT NULL,space_id TEXT NOT NULL,brand_policy TEXT NOT NULL,
    profile_id TEXT,profile_version INTEGER,view_revision INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(view_id,space_id));
  CREATE TABLE IF NOT EXISTS journey_export_brand_operations(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,action TEXT NOT NULL,intent_sha256 TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(space_id,actor_user_id,idempotency_key));
  CREATE TABLE IF NOT EXISTS journey_export_brand_audit_events(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,actor_user_id TEXT,
    action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,target_revision INTEGER,detail_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_export_brand_asset_purge_queue(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,asset_id TEXT NOT NULL,
    source_upload_id TEXT NOT NULL,expected_sha256 TEXT NOT NULL,expected_byte_size INTEGER NOT NULL,state TEXT NOT NULL,generation INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL,lease_token_sha256 TEXT,lease_expires_at TEXT,next_attempt_at TEXT NOT NULL,last_error_sha256 TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,UNIQUE(space_id,asset_id));
  CREATE TRIGGER IF NOT EXISTS journey_export_brand_versions_update_guard BEFORE UPDATE ON journey_export_brand_profile_versions
    BEGIN SELECT RAISE(ABORT,'Journey export brand history is append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_export_brand_versions_delete_guard BEFORE DELETE ON journey_export_brand_profile_versions
    BEGIN SELECT RAISE(ABORT,'Journey export brand history is append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_export_brand_operations_update_guard BEFORE UPDATE ON journey_export_brand_operations
    BEGIN SELECT RAISE(ABORT,'Journey export brand history is append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_export_brand_audit_update_guard BEFORE UPDATE ON journey_export_brand_audit_events
    BEGIN SELECT RAISE(ABORT,'Journey export brand history is append-only');END;`);
}

function uploadPath(row: Record<string, unknown>) {
  const root = path.resolve(config.uploadDir); const resolved = path.resolve(root, String(row.stored_filename || ''));
  if (!resolved.toLowerCase().startsWith(`${root}${path.sep}`.toLowerCase())) throw new JourneyExportBrandError(
    'Brand image storage reference is invalid.', 410, 'JOURNEY_EXPORT_BRAND_ASSET_UNAVAILABLE'); return resolved;
}
function readUpload(row: Record<string, unknown>) { let bytes: Buffer; try { bytes = fs.readFileSync(uploadPath(row)); } catch {
  throw new JourneyExportBrandError('Brand image is unavailable.', 410, 'JOURNEY_EXPORT_BRAND_ASSET_UNAVAILABLE'); }
  if (bytes.length !== number(row.size)) throw new JourneyExportBrandError('Brand image byte length changed.', 410,
    'JOURNEY_EXPORT_BRAND_ASSET_INTEGRITY'); return bytes;
}
function publicAsset(row: any) { return { id: row.id, mimeType: row.mime_type, byteSize: number(row.byte_size), width: number(row.width),
  height: number(row.height), sha256: row.content_sha256, altText: row.alt_text, state: row.state, revision: number(row.revision),
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), retiredAt: row.retired_at ? iso(row.retired_at) : null }; }
function publicVersion(row: any) { return { profileId: row.profile_id, version: number(row.version), organisationName: row.organisation_name,
  logoAssetId: row.logo_asset_id || null, primaryHex: row.primary_hex, accentHex: row.accent_hex, backgroundHex: row.background_hex,
  textHex: row.text_hex, fontFamily: row.font_family, footerText: row.footer_text, locale: row.locale,
  contentSha256: row.content_sha256, createdAt: iso(row.created_at) }; }
function publicProfile(row: any) { return { id: row.id, name: row.name, state: row.state, currentVersion: number(row.current_version),
  revision: number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  retiredAt: row.retired_at ? iso(row.retired_at) : null }; }

export class JourneyExportBrandRepository {
  constructor(private readonly runtime: DatabaseRuntime = db, private readonly access: Access = productionAccess) {
    initializeJourneyExportBrandingSqlite(runtime);
  }
  private lock(spaceId: string) { if (this.runtime.provider === 'postgres') this.runtime.prepare(
    "SELECT pg_advisory_xact_lock(hashtextextended('journey-export-brand:' || ?,0))").get(spaceId); }
  private operation<T>(input: { spaceId: string; actorUserId: string; idempotencyKey: string; action: string; intent: unknown }, fn: () => T): T {
    const key = text(input.idempotencyKey, 'Idempotency key', 200); const intentSha = hash(input.intent);
    const replay = this.runtime.prepare(`SELECT intent_sha256,response_json FROM journey_export_brand_operations
      WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`).get(input.spaceId, input.actorUserId, key) as any;
    if (replay) { if (replay.intent_sha256 !== intentSha) throw new JourneyExportBrandError('Idempotency key was used for another operation.',
      409, 'JOURNEY_EXPORT_BRAND_IDEMPOTENCY_CONFLICT'); return JSON.parse(String(replay.response_json)) as T; }
    const result = fn(); this.runtime.prepare(`INSERT INTO journey_export_brand_operations
      (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), input.spaceId, input.actorUserId, key, input.action, intentSha, JSON.stringify(result), iso()); return result;
  }
  private audit(spaceId: string, actorUserId: string, action: string, targetType: string, targetId: string,
    targetRevision: number | null, detail: unknown, at: string) { this.runtime.prepare(`INSERT INTO journey_export_brand_audit_events
      (id,space_id,actor_user_id,action,target_type,target_id,target_revision,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, targetId, targetRevision, hash(detail), at); }

  async createAsset(input: { spaceId: string; actorUserId: string; uploadId: string; altText: unknown; idempotencyKey: string }) {
    this.access(input.spaceId, input.actorUserId, 'journeys.edit'); const altText = text(input.altText, 'Logo alternative text', 300);
    const upload = this.runtime.prepare(`SELECT * FROM uploads WHERE id=? AND space_id=? AND collector_id IS NULL
      AND response_id IS NULL AND expires_at IS NULL`).get(text(input.uploadId, 'Upload ID', 128), input.spaceId) as any;
    if (!upload) throw new JourneyExportBrandError('Choose an authenticated upload in this space.', 404,
      'JOURNEY_EXPORT_BRAND_UPLOAD_NOT_FOUND'); const mimeType = String(upload.mime_type).toLowerCase();
    if (!['image/png', 'image/jpeg'].includes(mimeType)) throw new JourneyExportBrandError('Logo must be PNG or JPEG.', 415,
      'JOURNEY_EXPORT_BRAND_ASSET_MIME_INVALID'); const bytes = readUpload(upload);
    if (bytes.length > 5 * 1024 * 1024) throw new JourneyExportBrandError('Logo exceeds 5 MB.', 413,
      'JOURNEY_EXPORT_BRAND_ASSET_TOO_LARGE');
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>; try {
      metadata = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata();
    } catch {
      throw new JourneyExportBrandError('Logo could not be decoded.', 415, 'JOURNEY_EXPORT_BRAND_ASSET_DECODE_INVALID'); }
    if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new JourneyExportBrandError(
      'Logo dimensions must be between 1 and 4096 pixels.', 413, 'JOURNEY_EXPORT_BRAND_ASSET_DIMENSIONS_INVALID');
    const contentSha256 = hash(bytes); const intent = { uploadId: input.uploadId, altText, contentSha256 };
    return this.runtime.transaction(() => { this.lock(input.spaceId); return this.operation({ ...input, action: 'asset.create', intent }, () => {
      const existing = this.runtime.prepare('SELECT * FROM journey_export_brand_assets WHERE space_id=? AND content_sha256=?')
        .get(input.spaceId, contentSha256) as any; if (existing) return publicAsset(existing);
      const count = number((this.runtime.prepare("SELECT COUNT(*) count FROM journey_export_brand_assets WHERE space_id=? AND state='active'")
        .get(input.spaceId) as any).count); if (count >= 100) throw new JourneyExportBrandError('This space has reached its active brand asset limit.',
          409, 'JOURNEY_EXPORT_BRAND_ASSET_LIMIT'); const at = iso(), id = crypto.randomUUID();
      this.runtime.prepare(`INSERT INTO journey_export_brand_assets(id,space_id,source_upload_id,mime_type,byte_size,width,height,
        content_sha256,alt_text,state,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?)`).run(id, input.spaceId, input.uploadId, mimeType, bytes.length,
          metadata.width, metadata.height, contentSha256, altText, input.actorUserId, input.actorUserId, at, at);
      this.runtime.prepare('UPDATE uploads SET claimed_at=COALESCE(claimed_at,?) WHERE id=? AND space_id=?').run(at,input.uploadId,input.spaceId);
      this.audit(input.spaceId,input.actorUserId,'asset.created','asset',id,1,{contentSha256,byteSize:bytes.length},at);
      return publicAsset(this.runtime.prepare('SELECT * FROM journey_export_brand_assets WHERE id=? AND space_id=?').get(id,input.spaceId)); }); })();
  }

  createProfile(input: { spaceId: string; actorUserId: string; name: unknown; organisationName: unknown; logoAssetId?: string | null;
    primaryHex: unknown; accentHex: unknown; backgroundHex: unknown; textHex: unknown; fontFamily: unknown; footerText?: unknown;
    locale?: unknown; idempotencyKey: string }) { this.access(input.spaceId,input.actorUserId,'journeys.edit');
    const config = this.validateConfiguration(input); const name = text(input.name,'Profile name',120); const intent = {name,...config};
    return this.runtime.transaction(() => { this.lock(input.spaceId); return this.operation({ ...input,action:'profile.create',intent },() => {
      const count=number((this.runtime.prepare("SELECT COUNT(*) count FROM journey_export_brand_profiles WHERE space_id=? AND state='active'")
        .get(input.spaceId) as any).count);if(count>=50)throw new JourneyExportBrandError('This space has reached its active brand profile limit.',409,
          'JOURNEY_EXPORT_BRAND_PROFILE_LIMIT');this.requireLogo(input.spaceId,config.logoAssetId);const at=iso(),id=crypto.randomUUID();
      this.runtime.prepare(`INSERT INTO journey_export_brand_profiles(id,space_id,name,state,current_version,revision,created_by_user_id,
        updated_by_user_id,created_at,updated_at) VALUES (?, ?,?,'active',1,1,?,?,?,?)`).run(id,input.spaceId,name,input.actorUserId,
          input.actorUserId,at,at);this.insertVersion(id,input.spaceId,1,config,input.actorUserId,at);
      this.audit(input.spaceId,input.actorUserId,'profile.created','profile',id,1,{contentSha256:config.contentSha256},at);
      return {profile:publicProfile(this.profile(input.spaceId,id)),version:publicVersion(this.version(input.spaceId,id,1))};});})(); }

  createVersion(input: { spaceId:string;actorUserId:string;profileId:string;expectedRevision:number;organisationName:unknown;
    logoAssetId?:string|null;primaryHex:unknown;accentHex:unknown;backgroundHex:unknown;textHex:unknown;fontFamily:unknown;
    footerText?:unknown;locale?:unknown;idempotencyKey:string }) { this.access(input.spaceId,input.actorUserId,'journeys.edit');
    const configuration=this.validateConfiguration(input),intent={profileId:input.profileId,expectedRevision:input.expectedRevision,...configuration};
    return this.runtime.transaction(()=>{this.lock(input.spaceId);return this.operation({...input,action:'profile.version',intent},()=>{
      const profile=this.profile(input.spaceId,input.profileId,true);if(profile.state!=='active'||number(profile.revision)!==input.expectedRevision)
        throw new JourneyExportBrandError('Brand profile changed. Reload and try again.',409,'JOURNEY_EXPORT_BRAND_STALE');
      this.requireLogo(input.spaceId,configuration.logoAssetId);const version=number(profile.current_version)+1,at=iso();
      this.insertVersion(profile.id,input.spaceId,version,configuration,input.actorUserId,at);const changed=this.runtime.prepare(
        `UPDATE journey_export_brand_profiles SET current_version=?,revision=revision+1,updated_by_user_id=?,updated_at=?
         WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(version,input.actorUserId,at,profile.id,input.spaceId,input.expectedRevision).changes;
      if(changed!==1)throw new JourneyExportBrandError('Brand profile changed. Reload and try again.',409,'JOURNEY_EXPORT_BRAND_STALE');
      this.audit(input.spaceId,input.actorUserId,'profile.versioned','profile',profile.id,input.expectedRevision+1,
        {version,contentSha256:configuration.contentSha256},at);return {profile:publicProfile(this.profile(input.spaceId,profile.id)),
          version:publicVersion(this.version(input.spaceId,profile.id,version))};});})(); }

  setDefault(input:{spaceId:string;actorUserId:string;profileId:string;profileVersion:number;expectedRevision:number;idempotencyKey:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.edit');const intent={profileId:input.profileId,profileVersion:input.profileVersion,
      expectedRevision:input.expectedRevision};return this.runtime.transaction(()=>{this.lock(input.spaceId);return this.operation({...input,
        action:'default.set',intent},()=>{const version=this.version(input.spaceId,input.profileId,input.profileVersion);const profile=this.profile(
          input.spaceId,input.profileId);if(profile.state!=='active')throw new JourneyExportBrandError('Brand profile is retired.',409,
            'JOURNEY_EXPORT_BRAND_PROFILE_RETIRED');const at=iso();const settings=this.settingsRow(input.spaceId);
        if(settings&&number(settings.revision)!==input.expectedRevision)throw new JourneyExportBrandError('Brand settings changed.',409,
          'JOURNEY_EXPORT_BRAND_STALE');if(settings)this.runtime.prepare(`UPDATE journey_export_brand_settings SET default_profile_id=?,
          default_profile_version=?,revision=revision+1,updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`)
          .run(profile.id,number(version.version),input.actorUserId,at,input.spaceId,input.expectedRevision);
        else {if(input.expectedRevision!==0)throw new JourneyExportBrandError('Brand settings changed.',409,'JOURNEY_EXPORT_BRAND_STALE');
          this.runtime.prepare(`INSERT INTO journey_export_brand_settings(space_id,default_profile_id,default_profile_version,revision,
            updated_by_user_id,created_at,updated_at) VALUES (?,?,?,1,?,?,?)`).run(input.spaceId,profile.id,number(version.version),
              input.actorUserId,at,at);}const result=this.getSettings({spaceId:input.spaceId,actorUserId:input.actorUserId});
        this.audit(input.spaceId,input.actorUserId,'default.set','settings',input.spaceId,result.settings.revision,intent,at);return result;});})();}

  bindSavedView(input:{spaceId:string;actorUserId:string;viewId:string;viewRevision:number;brandPolicy:'space_default'|'pinned';
    profileId?:string|null;profileVersion?:number|null;expectedRevision:number;idempotencyKey:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.manage_views');const intent={viewId:input.viewId,viewRevision:input.viewRevision,
      brandPolicy:input.brandPolicy,profileId:input.profileId||null,profileVersion:input.profileVersion||null,expectedRevision:input.expectedRevision};
    return this.runtime.transaction(()=>{this.lock(input.spaceId);return this.operation({...input,action:'view.bind',intent},()=>{
      const view=this.runtime.prepare("SELECT id,revision,state FROM journey_saved_views WHERE id=? AND space_id=? AND state='active'")
        .get(input.viewId,input.spaceId) as any;if(!view)throw new JourneyExportBrandError('Saved view not found.',404,
          'JOURNEY_EXPORT_BRAND_VIEW_NOT_FOUND');if(number(view.revision)!==input.viewRevision)throw new JourneyExportBrandError(
            'Saved view changed.',409,'JOURNEY_EXPORT_BRAND_VIEW_STALE');if(input.brandPolicy==='pinned'){
        if(!input.profileId||!input.profileVersion)throw new JourneyExportBrandError('Pinned branding requires an exact profile version.',400,
          'JOURNEY_EXPORT_BRAND_BINDING_INVALID');this.version(input.spaceId,input.profileId,input.profileVersion);} else if(input.profileId||input.profileVersion)
          throw new JourneyExportBrandError('Space-default branding cannot pin a profile.',400,'JOURNEY_EXPORT_BRAND_BINDING_INVALID');
      const current=this.runtime.prepare('SELECT * FROM journey_saved_view_brand_bindings WHERE view_id=? AND space_id=?')
        .get(input.viewId,input.spaceId) as any;if(current&&number(current.revision)!==input.expectedRevision)throw new JourneyExportBrandError(
          'Saved-view brand binding changed.',409,'JOURNEY_EXPORT_BRAND_STALE');const at=iso();if(current)this.runtime.prepare(
        `UPDATE journey_saved_view_brand_bindings SET brand_policy=?,profile_id=?,profile_version=?,view_revision=?,revision=revision+1,
         updated_at=? WHERE view_id=? AND space_id=? AND revision=?`).run(input.brandPolicy,input.profileId||null,input.profileVersion||null,
          input.viewRevision,at,input.viewId,input.spaceId,input.expectedRevision);else {if(input.expectedRevision!==0)throw new JourneyExportBrandError(
            'Saved-view brand binding changed.',409,'JOURNEY_EXPORT_BRAND_STALE');this.runtime.prepare(`INSERT INTO journey_saved_view_brand_bindings
            (view_id,space_id,brand_policy,profile_id,profile_version,view_revision,revision,updated_at) VALUES (?,?,?,?,?,?,1,?)`)
            .run(input.viewId,input.spaceId,input.brandPolicy,input.profileId||null,input.profileVersion||null,input.viewRevision,at);}
      const result=this.binding(input.spaceId,input.viewId);this.audit(input.spaceId,input.actorUserId,'view.bound','saved_view',input.viewId,
        result.revision,intent,at);return {binding:result};});})();}

  getSavedViewBinding(input:{spaceId:string;actorUserId:string;viewId:string}){this.access(input.spaceId,input.actorUserId,'journeys.read');
    const view=this.runtime.prepare("SELECT id,revision FROM journey_saved_views WHERE id=? AND space_id=? AND state='active'")
      .get(input.viewId,input.spaceId) as any;if(!view)throw new JourneyExportBrandError('Saved view not found.',404,
        'JOURNEY_EXPORT_BRAND_VIEW_NOT_FOUND');const row=this.runtime.prepare(
          'SELECT * FROM journey_saved_view_brand_bindings WHERE view_id=? AND space_id=?').get(input.viewId,input.spaceId) as any;
    return {binding:row?this.binding(input.spaceId,input.viewId):{viewId:input.viewId,brandPolicy:'space_default',profileId:null,
      profileVersion:null,viewRevision:number(view.revision),revision:0,updatedAt:null}};}

  resetDefault(input:{spaceId:string;actorUserId:string;expectedRevision:number;idempotencyKey:string}){this.access(input.spaceId,input.actorUserId,
    'journeys.edit');const intent={expectedRevision:input.expectedRevision};return this.runtime.transaction(()=>{this.lock(input.spaceId);
      return this.operation({...input,action:'default.reset',intent},()=>{const settings=this.settingsRow(input.spaceId);if(!settings)
        return this.getSettings({spaceId:input.spaceId,actorUserId:input.actorUserId});if(number(settings.revision)!==input.expectedRevision)
          throw new JourneyExportBrandError('Brand settings changed.',409,'JOURNEY_EXPORT_BRAND_STALE');const at=iso();this.runtime.prepare(
            `UPDATE journey_export_brand_settings SET default_profile_id=NULL,default_profile_version=NULL,revision=revision+1,
             updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`).run(input.actorUserId,at,input.spaceId,input.expectedRevision);
        const result=this.getSettings({spaceId:input.spaceId,actorUserId:input.actorUserId});this.audit(input.spaceId,input.actorUserId,
          'default.reset','settings',input.spaceId,result.settings.revision,intent,at);return result;});})();}

  retireProfile(input:{spaceId:string;actorUserId:string;profileId:string;expectedRevision:number;idempotencyKey:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.edit');const intent={profileId:input.profileId,expectedRevision:input.expectedRevision};
    return this.runtime.transaction(()=>{this.lock(input.spaceId);return this.operation({...input,action:'profile.retire',intent},()=>{
      const profile=this.profile(input.spaceId,input.profileId,true);if(profile.state==='retired')return {profile:publicProfile(profile)};
      if(number(profile.revision)!==input.expectedRevision)throw new JourneyExportBrandError('Brand profile changed.',409,
        'JOURNEY_EXPORT_BRAND_STALE');const referenced=this.runtime.prepare(`SELECT 1 used FROM journey_export_brand_settings
        WHERE space_id=? AND default_profile_id=? UNION ALL SELECT 1 FROM journey_saved_view_brand_bindings
        WHERE space_id=? AND profile_id=? LIMIT 1`).get(input.spaceId,input.profileId,input.spaceId,input.profileId);
      if(referenced)throw new JourneyExportBrandError('Change the default and saved-view bindings before retiring this profile.',409,
        'JOURNEY_EXPORT_BRAND_PROFILE_IN_USE');const at=iso(),expires=iso(new Date(Date.parse(at)+30*86400000));const changed=this.runtime.prepare(
          `UPDATE journey_export_brand_profiles SET state='retired',revision=revision+1,updated_by_user_id=?,updated_at=?,retired_at=?,
           retention_expires_at=? WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(input.actorUserId,at,at,expires,
            input.profileId,input.spaceId,input.expectedRevision).changes;if(changed!==1)throw new JourneyExportBrandError('Brand profile changed.',409,
              'JOURNEY_EXPORT_BRAND_STALE');this.audit(input.spaceId,input.actorUserId,'profile.retired','profile',input.profileId,
                input.expectedRevision+1,intent,at);return {profile:publicProfile(this.profile(input.spaceId,input.profileId))};});})();}

  retireAsset(input:{spaceId:string;actorUserId:string;assetId:string;expectedRevision:number;idempotencyKey:string}){
    this.access(input.spaceId,input.actorUserId,'journeys.edit');const intent={assetId:input.assetId,expectedRevision:input.expectedRevision};
    return this.runtime.transaction(()=>{this.lock(input.spaceId);return this.operation({...input,action:'asset.retire',intent},()=>{
      const asset=this.runtime.prepare('SELECT * FROM journey_export_brand_assets WHERE id=? AND space_id=?').get(input.assetId,input.spaceId) as any;
      if(!asset)throw new JourneyExportBrandError('Brand asset not found.',404,'JOURNEY_EXPORT_BRAND_ASSET_NOT_FOUND');
      if(asset.state==='retired')return {asset:publicAsset(asset)};if(number(asset.revision)!==input.expectedRevision)
        throw new JourneyExportBrandError('Brand asset changed.',409,'JOURNEY_EXPORT_BRAND_STALE');const referenced=this.runtime.prepare(
          `SELECT 1 used FROM journey_export_brand_profile_versions version JOIN journey_export_brand_profiles profile
           ON profile.id=version.profile_id AND profile.space_id=version.space_id WHERE version.space_id=? AND version.logo_asset_id=?
           AND profile.state='active' LIMIT 1`).get(input.spaceId,input.assetId);if(referenced)throw new JourneyExportBrandError(
             'Retire or version every active profile using this logo first.',409,'JOURNEY_EXPORT_BRAND_ASSET_IN_USE');const at=iso(),
        expires=iso(new Date(Date.parse(at)+30*86400000));const changed=this.runtime.prepare(`UPDATE journey_export_brand_assets SET state='retired',
          revision=revision+1,updated_by_user_id=?,updated_at=?,retired_at=?,retention_expires_at=? WHERE id=? AND space_id=? AND state='active'
          AND revision=?`).run(input.actorUserId,at,at,expires,input.assetId,input.spaceId,input.expectedRevision).changes;
      if(changed!==1)throw new JourneyExportBrandError('Brand asset changed.',409,'JOURNEY_EXPORT_BRAND_STALE');this.runtime.prepare(
        `INSERT INTO journey_export_brand_asset_purge_queue(id,space_id,asset_id,source_upload_id,expected_sha256,expected_byte_size,state,
         generation,attempt_count,lease_token_sha256,lease_expires_at,next_attempt_at,last_error_sha256,created_at,updated_at,completed_at)
         VALUES (?,?,?,?,?,?,'pending',0,0,NULL,NULL,?,NULL,?,?,NULL)`).run(crypto.randomUUID(),input.spaceId,input.assetId,asset.source_upload_id,
          asset.content_sha256,asset.byte_size,expires,at,at);this.audit(input.spaceId,input.actorUserId,'asset.retired','asset',input.assetId,
            input.expectedRevision+1,intent,at);return {asset:publicAsset(this.runtime.prepare(
              'SELECT * FROM journey_export_brand_assets WHERE id=? AND space_id=?').get(input.assetId,input.spaceId))};});})();}

  getSettings(input:{spaceId:string;actorUserId:string}){this.access(input.spaceId,input.actorUserId,'journeys.read');const row=this.settingsRow(input.spaceId);
    return {settings:row?{defaultProfileId:row.default_profile_id||null,defaultProfileVersion:row.default_profile_version===null?null:
      number(row.default_profile_version),revision:number(row.revision),updatedAt:iso(row.updated_at)}:{defaultProfileId:null,
      defaultProfileVersion:null,revision:0,updatedAt:null}};}
  list(input:{spaceId:string;actorUserId:string}){this.access(input.spaceId,input.actorUserId,'journeys.read');const profiles=this.runtime.prepare(
    'SELECT * FROM journey_export_brand_profiles WHERE space_id=? ORDER BY state,name,id').all(input.spaceId) as any[];
    return {profiles:profiles.map((profile)=>({profile:publicProfile(profile),version:publicVersion(this.version(input.spaceId,profile.id,
      number(profile.current_version)))})),assets:(this.runtime.prepare('SELECT * FROM journey_export_brand_assets WHERE space_id=? ORDER BY state,updated_at DESC,id')
      .all(input.spaceId) as any[]).map(publicAsset),...this.getSettings(input)};}
  getAudit(input:{spaceId:string;actorUserId:string;limit?:number}){this.access(input.spaceId,input.actorUserId,'journeys.read');const limit=Math.max(1,
    Math.min(100,Math.floor(input.limit||50)));return {events:this.runtime.prepare(`SELECT action,target_type,target_id,target_revision,
      detail_sha256,created_at FROM journey_export_brand_audit_events WHERE space_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(input.spaceId,limit)};}

  resolve(input:{spaceId:string;actorUserId:string;viewId?:string}):JourneyExportBrandSnapshot|null{this.access(input.spaceId,input.actorUserId,
    'journeys.export');let profileId:string|null=null,profileVersion:number|null=null;if(input.viewId){const binding=this.runtime.prepare(
      'SELECT * FROM journey_saved_view_brand_bindings WHERE view_id=? AND space_id=?').get(input.viewId,input.spaceId) as any;
      if(binding?.brand_policy==='pinned'){profileId=binding.profile_id;profileVersion=number(binding.profile_version);}}
    if(!profileId){const settings=this.settingsRow(input.spaceId);profileId=settings?.default_profile_id||null;
      profileVersion=settings?.default_profile_version===null||settings?.default_profile_version===undefined?null:number(settings.default_profile_version);}
    if(!profileId||!profileVersion)return null;const row=this.version(input.spaceId,profileId,profileVersion),profile=this.profile(input.spaceId,profileId);
    if(profile.state!=='active')throw new JourneyExportBrandError('Resolved brand profile is retired.',409,'JOURNEY_EXPORT_BRAND_PROFILE_RETIRED');
    let logo:JourneyExportBrandSnapshot['logo']=null;if(row.logo_asset_id){const asset=this.runtime.prepare(
      "SELECT asset.*,upload.stored_filename,upload.size FROM journey_export_brand_assets asset JOIN uploads upload ON upload.id=asset.source_upload_id AND upload.space_id=asset.space_id WHERE asset.id=? AND asset.space_id=? AND asset.state='active'")
      .get(row.logo_asset_id,input.spaceId) as any;if(!asset)throw new JourneyExportBrandError('Resolved brand logo is unavailable.',410,
        'JOURNEY_EXPORT_BRAND_ASSET_UNAVAILABLE');const bytes=readUpload(asset);if(hash(bytes)!==asset.content_sha256)throw new JourneyExportBrandError(
          'Resolved brand logo failed its integrity check.',410,'JOURNEY_EXPORT_BRAND_ASSET_INTEGRITY');logo={bytes,mimeType:asset.mime_type,
          altText:asset.alt_text,width:number(asset.width),height:number(asset.height),sha256:asset.content_sha256};}
    return {profileId,version:profileVersion,organisationName:row.organisation_name,logoAssetId:row.logo_asset_id||null,logo,
      primaryHex:row.primary_hex,accentHex:row.accent_hex,backgroundHex:row.background_hex,textHex:row.text_hex,
      fontFamily:row.font_family,footerText:row.footer_text,locale:row.locale,contentSha256:row.content_sha256};}

  private validateConfiguration(input:any){const primaryHex=hex(input.primaryHex,'Primary colour'),accentHex=hex(input.accentHex,'Accent colour'),
    backgroundHex=hex(input.backgroundHex,'Background colour'),textHex=hex(input.textHex,'Text colour');if(contrast(backgroundHex,textHex)<4.5)
      throw new JourneyExportBrandError('Text and background colours must meet a 4.5:1 contrast ratio.',400,
        'JOURNEY_EXPORT_BRAND_CONTRAST_INVALID');const fontFamily=text(input.fontFamily,'Font family',40) as JourneyExportBrandFont;
    if(!journeyExportBrandFonts.includes(fontFamily))throw new JourneyExportBrandError('Choose a bundled font family.',400,
      'JOURNEY_EXPORT_BRAND_FONT_INVALID');const configuration={organisationName:text(input.organisationName,'Organisation name',160),
      logoAssetId:input.logoAssetId?text(input.logoAssetId,'Logo asset ID',128):null,primaryHex,accentHex,backgroundHex,textHex,fontFamily,
      footerText:text(input.footerText,'Footer text',300,false),locale:text(input.locale||'en-GB','Locale',35)};
    return {...configuration,contentSha256:hash(configuration)};}
  private requireLogo(spaceId:string,id:string|null){if(!id)return;const asset=this.runtime.prepare(
    "SELECT id FROM journey_export_brand_assets WHERE id=? AND space_id=? AND state='active'").get(id,spaceId);
    if(!asset)throw new JourneyExportBrandError('Logo asset not found.',404,'JOURNEY_EXPORT_BRAND_ASSET_NOT_FOUND');}
  private insertVersion(profileId:string,spaceId:string,version:number,configuration:any,actorUserId:string,at:string){this.runtime.prepare(
    `INSERT INTO journey_export_brand_profile_versions(profile_id,space_id,version,organisation_name,logo_asset_id,primary_hex,accent_hex,
      background_hex,text_hex,font_family,footer_text,locale,content_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(profileId,spaceId,version,configuration.organisationName,configuration.logoAssetId,configuration.primaryHex,configuration.accentHex,
      configuration.backgroundHex,configuration.textHex,configuration.fontFamily,configuration.footerText,configuration.locale,
      configuration.contentSha256,actorUserId,at);}
  private profile(spaceId:string,id:string,lock=false){const row=this.runtime.prepare(`SELECT * FROM journey_export_brand_profiles
    WHERE id=? AND space_id=?${lock&&this.runtime.provider==='postgres'?' FOR UPDATE':''}`).get(id,spaceId) as any;
    if(!row)throw new JourneyExportBrandError('Brand profile not found.',404,'JOURNEY_EXPORT_BRAND_PROFILE_NOT_FOUND');return row;}
  private version(spaceId:string,profileId:string,version:number){const row=this.runtime.prepare(`SELECT * FROM journey_export_brand_profile_versions
    WHERE profile_id=? AND space_id=? AND version=?`).get(profileId,spaceId,version) as any;if(!row)throw new JourneyExportBrandError(
      'Brand profile version not found.',404,'JOURNEY_EXPORT_BRAND_VERSION_NOT_FOUND');return row;}
  private settingsRow(spaceId:string){return this.runtime.prepare('SELECT * FROM journey_export_brand_settings WHERE space_id=?')
    .get(spaceId) as any;}
  private binding(spaceId:string,viewId:string){const row=this.runtime.prepare(
    'SELECT * FROM journey_saved_view_brand_bindings WHERE view_id=? AND space_id=?').get(viewId,spaceId) as any;
    if(!row)throw new JourneyExportBrandError('Saved-view brand binding not found.',404,'JOURNEY_EXPORT_BRAND_BINDING_NOT_FOUND');return {
      viewId:row.view_id,brandPolicy:row.brand_policy,profileId:row.profile_id||null,profileVersion:row.profile_version===null?null:
        number(row.profile_version),viewRevision:number(row.view_revision),revision:number(row.revision),updatedAt:iso(row.updated_at)};}
}

export const journeyExportBrandRepository = new JourneyExportBrandRepository();
