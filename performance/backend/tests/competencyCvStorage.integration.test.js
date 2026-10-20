'use strict';
// Local provider contract tests. No external storage/configuration requests.
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createManagedCvStorage,PREFIX,decode}=require('../services/competency/managedCvStorageService');
const bytes=Buffer.from('FICTIONAL CV TEST CONTENT ONLY');
function fixture({policy,uploadedType='authenticated',downloadUrl='https://api.cloudinary.com/v1_1/synthetic/raw/download?signed=synthetic',request}={}) {
  const resolver=jest.fn(async()=>policy===undefined?{configured:true,defaultProvider:'azure-blob',providers:{cloudinary:{configured:true,cloudName:'synthetic',apiKey:'synthetic-key',apiSecret:'synthetic-secret'}}}:policy);
  const upload=jest.fn((options,callback)=>({end:buffer=>callback(null,{public_id:options.public_id,type:uploadedType,resource_type:'raw',bytes:buffer.length})}));
  const destroy=jest.fn(async()=>({result:'ok'}));
  const url=jest.fn(()=>downloadUrl);
  const fetcher=jest.fn(request|| (async()=>new Response(bytes)));
  return {store:createManagedCvStorage({configurationResolver:resolver,cloudinaryClient:{uploader:{upload_stream:upload,destroy},utils:{private_download_url:url}},request:fetcher}),resolver,upload,destroy,url,fetcher};
}
const save=storage=>storage.store(bytes,{fileName:'fictional-cv.txt',mimeType:'text/plain'});
test('CV forces authenticated raw Cloudinary through central configuration even when Azure is the global default',async()=>{
  const f=fixture(),key=await save(f.store),snapshot=decode(key);
  expect(f.upload.mock.calls[0][0]).toMatchObject({type:'authenticated',resource_type:'raw',timeout:15000});
  expect(snapshot).toMatchObject({storageProvider:'cloudinary',storageDeliveryType:'authenticated',storageResourceType:'raw',storageFormat:'txt',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  expect(JSON.stringify(snapshot)).not.toMatch(/synthetic-secret|synthetic-key|https:/);
  expect(await f.store.read(key)).toEqual(bytes);
  expect(f.url.mock.calls[0][2]).toMatchObject({resource_type:'raw',type:'authenticated',attachment:true});
  expect(f.fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual',signal:expect.any(AbortSignal)});
  await f.store.remove(key);expect(f.destroy.mock.calls[0]).toEqual([snapshot.storageKey,expect.objectContaining({type:'authenticated',resource_type:'raw',invalidate:true,timeout:15000})]);
});
test.each([{}, {configured:false,providers:{cloudinary:{configured:true,cloudName:'s',apiKey:'k',apiSecret:'x'}}}, {configured:true,defaultProvider:'azure-blob',providers:{}}, {providers:{cloudinary:{configured:false,cloudName:'s',apiKey:'k',apiSecret:'x'}}}])('unavailable Cloudinary configuration fails closed without a local or Azure upload',async policy=>{
  const f=fixture({policy});await expect(save(f.store)).rejects.toMatchObject({status:503,code:'PRIVATE_STORAGE_UNAVAILABLE'});expect(f.upload).not.toHaveBeenCalled();
});
test('an unexpected public fallback is deleted and never receives a usable key',async()=>{
  const f=fixture({uploadedType:'upload'});await expect(save(f.store)).rejects.toMatchObject({code:'PRIVATE_STORAGE_UNAVAILABLE'});expect(f.destroy.mock.calls[0][1]).toMatchObject({type:'upload',resource_type:'raw'});
});
test.each(['https://evil.example/file','http://api.cloudinary.com/raw','https://api.cloudinary.com.evil.example/raw','https://user:pass@res.cloudinary.com/file','https://res.cloudinary.com:444/file','file:///secret'])('a signed download URL cannot escape the exact HTTPS Cloudinary hosts: %s',async downloadUrl=>{
  const f=fixture({downloadUrl}),key=await save(f.store);await expect(f.store.read(key)).rejects.toMatchObject({code:'PRIVATE_DOWNLOAD_UNAVAILABLE'});expect(f.fetcher).not.toHaveBeenCalled();
});
test('every redirect is checked and the redirect count is bounded',async()=>{
  const f=fixture({request:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/file'}})}),key=await save(f.store);
  await expect(f.store.read(key)).rejects.toMatchObject({code:'PRIVATE_DOWNLOAD_UNAVAILABLE'});expect(f.fetcher).toHaveBeenCalledTimes(1);
  const loop=fixture({request:async()=>new Response(null,{status:302,headers:{location:'https://res.cloudinary.com/synthetic/file'}})}),loopKey=await save(loop.store);
  await expect(loop.store.read(loopKey)).rejects.toMatchObject({code:'PRIVATE_DOWNLOAD_UNAVAILABLE'});expect(loop.fetcher).toHaveBeenCalledTimes(4);
});
test('a bounded Cloudinary redirect can deliver exactly the stored bytes',async()=>{
  let count=0;const f=fixture({request:async()=>++count===1?new Response(null,{status:302,headers:{location:'https://res.cloudinary.com/synthetic/file'}}):new Response(bytes)}),key=await save(f.store);
  expect(await f.store.read(key)).toEqual(bytes);expect(f.fetcher).toHaveBeenCalledTimes(2);
});
test.each([
  ()=>new Response(bytes,{headers:{'content-length':String(10*1024*1024+1)}}),
  ()=>new Response(Buffer.alloc(10*1024*1024+1)),
  ()=>new Response(Buffer.from('altered bytes')),
  ()=>new Response(null,{status:403})
])('oversized, corrupt and denied downloads fail safely',async response=>{
  const f=fixture({request:async()=>response()}),key=await save(f.store);await expect(f.store.read(key)).rejects.toMatchObject({code:'PRIVATE_DOWNLOAD_UNAVAILABLE'});
});
test('malformed storage keys never reach configuration/provider and errors never disclose provider details',async()=>{
  const f=fixture();for(const key of ['cloudinary-cv:v2:abc',PREFIX+'bad!',PREFIX+Buffer.from(JSON.stringify({storageKey:'outside'})).toString('base64url')]){
    await expect(f.store.read(key)).rejects.toMatchObject({status:404});await expect(f.store.remove(key)).rejects.toMatchObject({status:404});
  }expect(f.resolver).not.toHaveBeenCalled();
  f.upload.mockImplementation(()=>{throw new Error('synthetic-secret https://signed-provider.example');});
  await expect(save(f.store)).rejects.toThrow('Private CV storage is unavailable. Retry the upload.');
});
test('historical UUID private files remain readable and deletable',async()=>{
  const files=require('../services/competency/fileSafetyService'),previous=process.env.COMPETENCY_PRIVATE_STORAGE_ROOT;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'competency-cv-legacy-'));process.env.COMPETENCY_PRIVATE_STORAGE_ROOT=root;
  try {const key=await files.storePrivate(bytes);expect(key).toMatch(/^[a-f\d-]{36}$/);expect(await files.readPrivate(key)).toEqual(bytes);await files.deletePrivate(key);await expect(files.readPrivate(key)).rejects.toMatchObject({status:404});}
  finally {if(previous===undefined)delete process.env.COMPETENCY_PRIVATE_STORAGE_ROOT;else process.env.COMPETENCY_PRIVATE_STORAGE_ROOT=previous;if(root.startsWith(path.join(os.tmpdir(),'competency-cv-legacy-')))await fs.rm(root,{recursive:true,force:true});}
});
