import { api, json, multipart } from '@/lib/api';

export const journeyExportBrandFonts = ['Aptos', 'Arial', 'Helvetica', 'Noto Sans'] as const;
export type JourneyExportBrandFont = typeof journeyExportBrandFonts[number];
export type JourneyExportBrandAccess = { canRead:boolean;canEdit:boolean;canManageViews:boolean;canExport:boolean };
export type JourneyExportBrandAsset = {id:string;mimeType:'image/png'|'image/jpeg';byteSize:number;width:number;height:number;sha256:string;
  altText:string;state:'active'|'retired';revision:number;createdAt:string;updatedAt:string;retiredAt:string|null};
export type JourneyExportBrandProfile = {id:string;name:string;state:'active'|'retired';currentVersion:number;revision:number;
  createdAt:string;updatedAt:string;retiredAt:string|null};
export type JourneyExportBrandVersion = {profileId:string;version:number;organisationName:string;logoAssetId:string|null;primaryHex:string;
  accentHex:string;backgroundHex:string;textHex:string;fontFamily:JourneyExportBrandFont;footerText:string;locale:string;contentSha256:string;createdAt:string};
export type JourneyExportBrandCatalog = {profiles:Array<{profile:JourneyExportBrandProfile;version:JourneyExportBrandVersion}>;
  assets:JourneyExportBrandAsset[];settings:{defaultProfileId:string|null;defaultProfileVersion:number|null;revision:number;updatedAt:string|null}};
export type JourneyExportBrandConfiguration = Omit<JourneyExportBrandVersion,'profileId'|'version'|'contentSha256'|'createdAt'>;
export type JourneyExportBrandBinding = {viewId:string;brandPolicy:'space_default'|'pinned';profileId:string|null;profileVersion:number|null;
  viewRevision:number;revision:number;updatedAt:string|null};

const record=(value:unknown,label:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid ${label} response shape.`);return value as Record<string,unknown>;};
function exact(value:unknown,label:string,keys:readonly string[]){const item=record(value,label),actual=Object.keys(item).sort(),expected=[...keys].sort();
  if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw new Error(`Invalid ${label} response shape.`);return item;}
const text=(value:unknown,label:string,maximum=500)=>{if(typeof value!=='string'||!value||value.length>maximum)throw new Error(`Invalid ${label} response.`);return value;};
const nullableText=(value:unknown,label:string)=>value===null?null:text(value,label);
const integer=(value:unknown,label:string,minimum=0)=>{if(!Number.isInteger(value)||Number(value)<minimum)throw new Error(`Invalid ${label} response.`);return Number(value);};
const bool=(value:unknown,label:string)=>{if(typeof value!=='boolean')throw new Error(`Invalid ${label} response.`);return value;};
const hex=(value:unknown,label:string)=>{const result=text(value,label,7);if(!/^#[0-9A-F]{6}$/u.test(result))throw new Error(`Invalid ${label} response.`);return result;};
function asset(value:unknown):JourneyExportBrandAsset{const item=exact(value,'brand asset',['id','mimeType','byteSize','width','height','sha256','altText','state','revision','createdAt','updatedAt','retiredAt']);
  if(item.mimeType!=='image/png'&&item.mimeType!=='image/jpeg')throw new Error('Invalid brand asset MIME response.');if(item.state!=='active'&&item.state!=='retired')throw new Error('Invalid brand asset state response.');
  return{id:text(item.id,'brand asset ID',128),mimeType:item.mimeType,byteSize:integer(item.byteSize,'brand asset byte size',1),width:integer(item.width,'brand asset width',1),
    height:integer(item.height,'brand asset height',1),sha256:text(item.sha256,'brand asset checksum',64),altText:text(item.altText,'brand asset alternative text',300),
    state:item.state,revision:integer(item.revision,'brand asset revision',1),createdAt:text(item.createdAt,'brand asset creation time',50),updatedAt:text(item.updatedAt,'brand asset update time',50),retiredAt:nullableText(item.retiredAt,'brand asset retirement time')};}
function profile(value:unknown):JourneyExportBrandProfile{const item=exact(value,'brand profile',['id','name','state','currentVersion','revision','createdAt','updatedAt','retiredAt']);
  if(item.state!=='active'&&item.state!=='retired')throw new Error('Invalid brand profile state response.');return{id:text(item.id,'brand profile ID',128),name:text(item.name,'brand profile name',120),state:item.state,
    currentVersion:integer(item.currentVersion,'brand profile current version',1),revision:integer(item.revision,'brand profile revision',1),createdAt:text(item.createdAt,'brand profile creation time',50),
    updatedAt:text(item.updatedAt,'brand profile update time',50),retiredAt:nullableText(item.retiredAt,'brand profile retirement time')};}
function version(value:unknown):JourneyExportBrandVersion{const item=exact(value,'brand profile version',['profileId','version','organisationName','logoAssetId','primaryHex','accentHex','backgroundHex','textHex','fontFamily','footerText','locale','contentSha256','createdAt']);
  if(!journeyExportBrandFonts.includes(item.fontFamily as JourneyExportBrandFont))throw new Error('Invalid brand profile font response.');return{profileId:text(item.profileId,'brand profile ID',128),version:integer(item.version,'brand profile version',1),
    organisationName:text(item.organisationName,'organisation name',160),logoAssetId:nullableText(item.logoAssetId,'brand logo ID'),primaryHex:hex(item.primaryHex,'primary colour'),accentHex:hex(item.accentHex,'accent colour'),
    backgroundHex:hex(item.backgroundHex,'background colour'),textHex:hex(item.textHex,'text colour'),fontFamily:item.fontFamily as JourneyExportBrandFont,
    footerText:typeof item.footerText==='string'?item.footerText:(()=>{throw new Error('Invalid brand footer response.');})(),locale:text(item.locale,'brand locale',35),contentSha256:text(item.contentSha256,'brand version checksum',64),createdAt:text(item.createdAt,'brand version creation time',50)};}
function settings(value:unknown){const item=exact(value,'brand settings',['defaultProfileId','defaultProfileVersion','revision','updatedAt']);const profileId=nullableText(item.defaultProfileId,'default profile ID');
  const profileVersion=item.defaultProfileVersion===null?null:integer(item.defaultProfileVersion,'default profile version',1);if(Boolean(profileId)!==Boolean(profileVersion))throw new Error('Invalid brand default response shape.');
  return{defaultProfileId:profileId,defaultProfileVersion:profileVersion,revision:integer(item.revision,'brand settings revision'),updatedAt:nullableText(item.updatedAt,'brand settings update time')};}
export function parseJourneyExportBrandCatalog(value:unknown):JourneyExportBrandCatalog{const item=exact(value,'brand catalog',['profiles','assets','settings']);if(!Array.isArray(item.profiles)||!Array.isArray(item.assets))throw new Error('Invalid brand catalog response shape.');
  return{profiles:item.profiles.map((entry)=>{const pair=exact(entry,'brand profile entry',['profile','version']);const parsedProfile=profile(pair.profile),parsedVersion=version(pair.version);if(parsedProfile.id!==parsedVersion.profileId||parsedProfile.currentVersion!==parsedVersion.version)throw new Error('Brand profile current-version response drifted.');return{profile:parsedProfile,version:parsedVersion};}),assets:item.assets.map(asset),settings:settings(item.settings)};}
export async function readJourneyExportBrandAccess(){const item=exact(await api<unknown>('/api/journey-export-brand/access'),'brand access',['canRead','canEdit','canManageViews','canExport']);
  return{canRead:bool(item.canRead,'brand read access'),canEdit:bool(item.canEdit,'brand edit access'),canManageViews:bool(item.canManageViews,'brand saved-view access'),canExport:bool(item.canExport,'brand export access')};}
export async function listJourneyExportBrands(){return parseJourneyExportBrandCatalog(await api<unknown>('/api/journey-export-brand/profiles'));}
export async function uploadJourneyExportLogo(file:File){const body=new FormData();body.append('file',file);const item=exact(await api<unknown>('/api/uploads',multipart('POST',body)),'upload',['id','name','mimeType','size','url','transcriptionState']);
  return{id:text(item.id,'upload ID',128),name:text(item.name,'upload name',500),mimeType:text(item.mimeType,'upload MIME',100),size:integer(item.size,'upload size',1)};}
const mutationId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
export async function createJourneyExportBrandAsset(uploadId:string,altText:string){const item=exact(await api<unknown>('/api/journey-export-brand/assets',json('POST',{uploadId,altText,idempotencyKey:mutationId()})),'brand asset mutation',['asset']);return asset(item.asset);}
function mutation(value:unknown){const item=exact(value,'brand profile mutation',['profile','version']);return{profile:profile(item.profile),version:version(item.version)};}
export async function createJourneyExportBrandProfile(input:{name:string}&JourneyExportBrandConfiguration){return mutation(await api<unknown>('/api/journey-export-brand/profiles',json('POST',{...input,idempotencyKey:mutationId()})));}
export async function createJourneyExportBrandVersion(current:JourneyExportBrandProfile,input:JourneyExportBrandConfiguration){return mutation(await api<unknown>(`/api/journey-export-brand/profiles/${encodeURIComponent(current.id)}/versions`,json('POST',{...input,expectedRevision:current.revision,idempotencyKey:mutationId()})));}
export async function setJourneyExportBrandDefault(catalog:JourneyExportBrandCatalog,profileId:string,profileVersion:number){const item=exact(await api<unknown>('/api/journey-export-brand/default',json('PUT',{profileId,profileVersion,expectedRevision:catalog.settings.revision,idempotencyKey:mutationId()})),'brand settings mutation',['settings']);return settings(item.settings);}
export async function bindJourneySavedViewBrand(input:{viewId:string;viewRevision:number;brandPolicy:'space_default'|'pinned';profileId?:string|null;profileVersion?:number|null;expectedRevision:number}){const{viewId,...body}=input;const item=exact(await api<unknown>(`/api/journey-export-brand/saved-views/${encodeURIComponent(viewId)}`,json('PUT',{...body,idempotencyKey:mutationId()})),'saved-view brand mutation',['binding']);
  return parseBinding(item.binding);}
function parseBinding(value:unknown){const binding=exact(value,'saved-view brand binding',['viewId','brandPolicy','profileId','profileVersion','viewRevision','revision','updatedAt']);if(binding.brandPolicy!=='space_default'&&binding.brandPolicy!=='pinned')throw new Error('Invalid saved-view brand policy response.');
  return{viewId:text(binding.viewId,'saved-view ID',128),brandPolicy:binding.brandPolicy,profileId:nullableText(binding.profileId,'bound profile ID'),profileVersion:binding.profileVersion===null?null:integer(binding.profileVersion,'bound profile version',1),viewRevision:integer(binding.viewRevision,'bound saved-view revision',1),revision:integer(binding.revision,'binding revision',0),updatedAt:nullableText(binding.updatedAt,'binding update time')} as JourneyExportBrandBinding;}
export async function readJourneySavedViewBrand(viewId:string){const item=exact(await api<unknown>(`/api/journey-export-brand/saved-views/${encodeURIComponent(viewId)}`),'saved-view brand response',['binding']);
  return parseBinding(item.binding);}
