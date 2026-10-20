'use strict';
const crypto=require('node:crypto');
const {createStorageService}=require('../storageService');
const {resolveStoragePlatformConfiguration}=require('../platformConfigurationClient');
const {DomainError}=require('../../contracts/competency');
const PREFIX='cloudinary-cv:v1:';
const MAX_BYTES=10*1024*1024;
const unavailable=()=>new DomainError(503,'PRIVATE_STORAGE_UNAVAILABLE','Private CV storage is unavailable. Retry the upload.');
function decode(key) {
  try {
    if(typeof key!=='string'||!key.startsWith(PREFIX)||key.length>2048)throw Error();
    const encoded=key.slice(PREFIX.length);if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error();
    const raw=Buffer.from(encoded,'base64url');if(raw.toString('base64url')!==encoded)throw Error();
    const value=JSON.parse(raw.toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='sha256,size,storageDeliveryType,storageFormat,storageKey,storageProvider,storageResourceType')throw Error();
    if(value.storageProvider!=='cloudinary'||value.storageDeliveryType!=='authenticated'||value.storageResourceType!=='raw'||!['pdf','docx','txt'].includes(value.storageFormat))throw Error();
    if(!/^performance\/competency-cv\/[a-f\d-]{36}-[a-zA-Z0-9._-]+$/.test(value.storageKey)||value.storageKey.length>255||!value.storageKey.endsWith(`.${value.storageFormat}`))throw Error();
    if(!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX_BYTES||!/^[a-f\d]{64}$/.test(value.sha256))throw Error();
    return value;
  } catch {throw new DomainError(404,'NOT_FOUND','The private CV source is unavailable.');}
}
function safeUrl(value) {
  try {const url=new URL(value);if(url.protocol!=='https:'||!['api.cloudinary.com','res.cloudinary.com'].includes(url.hostname)||url.username||url.password||(url.port&&url.port!=='443'))throw Error();return url.href;}
  catch {throw unavailable();}
}
function createManagedCvStorage({configurationResolver=resolveStoragePlatformConfiguration,cloudinaryClient,request=(...args)=>fetch(...args)}={}) {
  const resolve=async options=>{const policy=await configurationResolver(options);const configuration=policy?.providers?.cloudinary;if(policy?.configured!==true||!configuration?.cloudName||!configuration?.apiKey||!configuration?.apiSecret||configuration.configured===false)throw unavailable();return {...policy,configured:true,defaultProvider:'cloudinary'};};
  const client=cloudinaryClient||require('cloudinary').v2;
  // Bound uploads and deletions as well as reads. Do not change the shared
  // storage service's behavior for unrelated appraisal documents.
  const boundedClient={uploader:{upload_stream:(options,callback)=>client.uploader.upload_stream({...options,timeout:15000},callback),destroy:(key,options)=>client.uploader.destroy(key,{...options,timeout:15000})},utils:client.utils};
  const storage=createStorageService({configurationResolver:resolve,cloudinaryClient:boundedClient});
  return {
    async store(buffer,{fileName,mimeType}={}) {
      let providerRequestStarted=false;
      try {
        if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_BYTES)throw unavailable();
        // Resolve before any provider write so a configuration outage is a
        // provably safe retry. Once dispatch begins, all failures stay uncertain.
        const policy=await resolve({force:true});
        const uploadStorage=createStorageService({configurationResolver:async()=>policy,cloudinaryClient:boundedClient});
        providerRequestStarted=true;
        const snapshot=await uploadStorage.uploadBuffer(buffer,{fileName,mimeType,folder:'performance/competency-cv'});
        const value={...snapshot,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};
        const key=PREFIX+Buffer.from(JSON.stringify(value)).toString('base64url');
        try {decode(key);if(snapshot.size!==buffer.length)throw Error();}
        catch {await uploadStorage.remove(snapshot);throw unavailable();}
        return key;
      } catch {const error=unavailable();if(!providerRequestStarted)require('./authorizationService').confirmEvidenceNoEffect(error);throw error;}
    },
    async read(key) {
      const snapshot=decode(key);
      try {
        let url=safeUrl(await storage.getDownloadUrl(snapshot));
        const signal=AbortSignal.timeout(15000);
        for(let redirect=0;redirect<=3;redirect++) {
          const response=await request(url,{redirect:'manual',signal});
          if([301,302,303,307,308].includes(response.status)) {
            const location=response.headers.get('location');await response.body?.cancel();
            if(!location||redirect===3)throw unavailable();url=safeUrl(new URL(location,url).href);continue;
          }
          if(!response.ok){await response.body?.cancel();throw unavailable();}
          const length=response.headers.get('content-length');
          if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES)){await response.body?.cancel();throw unavailable();}
          if(!response.body)throw unavailable();
          const reader=response.body.getReader(),chunks=[];let size=0;
          try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw unavailable();}chunks.push(Buffer.from(value));}}
          catch(error) {await reader.cancel().catch(()=>{});throw error;}
          finally {reader.releaseLock();}
          const buffer=Buffer.concat(chunks);if(size!==snapshot.size||crypto.createHash('sha256').update(buffer).digest('hex')!==snapshot.sha256)throw unavailable();
          return buffer;
        }
        throw unavailable();
      } catch {throw new DomainError(503,'PRIVATE_DOWNLOAD_UNAVAILABLE','The private CV could not be downloaded. Please retry.');}
    },
    async remove(key) {const snapshot=decode(key);try {if(!await storage.remove(snapshot))throw Error();}catch {throw new DomainError(503,'PRIVATE_DELETION_UNAVAILABLE','Private CV deletion could not complete. Please retry.');}}
  };
}
const managed=createManagedCvStorage();
module.exports={PREFIX,decode,createManagedCvStorage,store:(...args)=>managed.store(...args),read:(...args)=>managed.read(...args),remove:(...args)=>managed.remove(...args)};
