import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { config } from '../src/config.js';
import type { DatabaseRuntime } from '../src/databaseAdapter.js';
import { JourneyExportBrandRepository } from '../src/journeyExportBranding.js';

async function setup(){const sqlite=new Database(':memory:');Object.defineProperty(sqlite,'provider',{value:'sqlite'});sqlite.exec(`
  CREATE TABLE uploads(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,collector_id TEXT,response_id TEXT,expires_at TEXT,created_by_user_id TEXT,
    stored_filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,claimed_at TEXT);
  CREATE TABLE journey_saved_views(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL);
  INSERT INTO journey_saved_views VALUES ('view-a','space-a','active',3);`);
  const filename=`journey-brand-test-${crypto.randomUUID()}.png`,absolute=path.join(config.uploadDir,filename);fs.mkdirSync(config.uploadDir,{recursive:true});
  const bytes=await sharp({create:{width:32,height:24,channels:4,background:{r:40,g:80,b:60,alpha:1}}}).png().toBuffer();
  fs.writeFileSync(absolute,bytes);sqlite.prepare(`INSERT INTO uploads(id,space_id,collector_id,response_id,expires_at,created_by_user_id,
    stored_filename,mime_type,size,claimed_at) VALUES ('upload-a','space-a',NULL,NULL,NULL,'owner',?,'image/png',?,NULL)`)
    .run(filename,bytes.length);const access:string[]=[];const repository=new JourneyExportBrandRepository(sqlite as unknown as DatabaseRuntime,
      (_space,_user,capability)=>access.push(capability));return {sqlite,repository,access,absolute,filename};}

test('verified logo, versioned profile, pinned default and saved-view binding resolve without exposing storage path',async(t)=>{
  const {sqlite,repository,access,absolute,filename}=await setup();t.after(()=>{sqlite.close();fs.rmSync(absolute,{force:true});});
  const asset=await repository.createAsset({spaceId:'space-a',actorUserId:'owner',uploadId:'upload-a',altText:'Acme logo',
    idempotencyKey:'asset-key'});assert.equal(asset.width,32);assert.equal(asset.height,24);assert.equal(asset.mimeType,'image/png');
  assert.equal('sourceUploadId' in asset,false);const created=repository.createProfile({spaceId:'space-a',actorUserId:'owner',name:'Annual reports',
    organisationName:'Acme Research',logoAssetId:asset.id,primaryHex:'#28503C',accentHex:'#B45309',backgroundHex:'#FFFFFF',textHex:'#111827',
    fontFamily:'Noto Sans',footerText:'Confidential',locale:'en-GB',idempotencyKey:'profile-key'});
  assert.equal(created.version.version,1);assert.match(created.version.contentSha256,/^[a-f0-9]{64}$/);
  const settings=repository.setDefault({spaceId:'space-a',actorUserId:'owner',profileId:created.profile.id,profileVersion:1,
    expectedRevision:0,idempotencyKey:'default-key'});assert.equal(settings.settings.defaultProfileId,created.profile.id);
  const binding=repository.bindSavedView({spaceId:'space-a',actorUserId:'owner',viewId:'view-a',viewRevision:3,brandPolicy:'pinned',
    profileId:created.profile.id,profileVersion:1,expectedRevision:0,idempotencyKey:'binding-key'});assert.equal(binding.binding.brandPolicy,'pinned');
  const resolved=repository.resolve({spaceId:'space-a',actorUserId:'owner',viewId:'view-a'});assert.equal(resolved?.organisationName,'Acme Research');
  assert.equal(resolved?.logo?.bytes.length,(sqlite.prepare("SELECT size FROM uploads WHERE id='upload-a'").get() as any).size);
  assert.equal(resolved?.logo?.altText,'Acme logo');assert.ok(access.includes('journeys.edit'));assert.ok(access.includes('journeys.manage_views'));
  assert.ok(access.includes('journeys.export'));assert.equal(JSON.stringify(repository.list({spaceId:'space-a',actorUserId:'owner'})).includes(filename),false);
});

test('brand mutations are idempotent, contrast-safe, optimistic and append-only',async(t)=>{const {sqlite,repository,absolute}=await setup();
  t.after(()=>{sqlite.close();fs.rmSync(absolute,{force:true});});const asset=await repository.createAsset({spaceId:'space-a',actorUserId:'owner',
    uploadId:'upload-a',altText:'Acme logo',idempotencyKey:'asset-key'});const input={spaceId:'space-a',actorUserId:'owner',name:'Default',
    organisationName:'Acme',logoAssetId:asset.id,primaryHex:'#28503C',accentHex:'#B45309',backgroundHex:'#FFFFFF',textHex:'#111827',
    fontFamily:'Aptos' as const,footerText:'',locale:'en-GB',idempotencyKey:'profile-key'};const first=repository.createProfile(input);
  assert.equal(repository.createProfile(input).profile.id,first.profile.id);assert.throws(()=>repository.createProfile({...input,name:'Other'}),
    /Idempotency key/);assert.throws(()=>repository.createProfile({...input,idempotencyKey:'low-contrast',backgroundHex:'#FFFFFF',
      textHex:'#EEEEEE'}),/4.5:1/);assert.throws(()=>repository.createVersion({...input,profileId:first.profile.id,expectedRevision:2,
      idempotencyKey:'version-stale'}),/changed/);assert.throws(()=>sqlite.prepare('UPDATE journey_export_brand_profile_versions SET footer_text=?').run('x'),
        /append-only/);assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_export_brand_audit_events').get() as any).count,2);
});
