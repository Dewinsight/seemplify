'use strict';
// Exercise the production Mongo selectors against an isolated real MongoDB.
// Driver cursors are awaited here; production mongosh cursors are synchronous.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const backendRequire=createRequire(path.resolve(__dirname,'../../../performance/backend/package.json'));
const {MongoMemoryServer}=backendRequire('mongodb-memory-server');
const {MongoClient}=backendRequire('mongodb');
const source=fs.readFileSync(path.resolve(__dirname,'../restore-smoke-hostinger.sh'),'utf8');
const section=source.split('# COMPETENCY_REFERENCE_CHECK_START')[1].split('# COMPETENCY_REFERENCE_CHECK_END')[0];
const code=section.split("--authenticationDatabase admin --eval '")[1].split("\n  '")[0]
  .replaceAll('...database.','...await database.');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
let server,client,database;
const key='12345678-1234-4234-8234-123456789abc',sha256='a'.repeat(64);
before(async()=>{server=await MongoMemoryServer.create();client=new MongoClient(server.getUri());await client.connect();database=client.db('performance_db');});
after(async()=>{await client?.close();await server?.stop();});
beforeEach(async()=>{await database.dropDatabase();});
async function check(files){
  const logs=[];
  await new AsyncFunction('db','require','print',code)(
    {getSiblingDB:name=>{assert.equal(name,'performance_db');return new Proxy({}, {
      get:(_,collection)=>({find:(filter,projection)=>database.collection(collection).find(filter,{projection})})
    });}},
    name=>{assert.equal(name,'fs');return{existsSync:()=>files!==null,readFileSync:()=>JSON.stringify({files})};},
    line=>logs.push(line));
  return logs;
}
const entry={key,sha256,size:10,mode:0o600};
test('all active import, evidence and export references match private manifest',async()=>{
  await database.collection('competencyimports').insertOne({storageKey:key,sha256});
  await database.collection('competencyevidences').insertOne({storageKey:key,sha256,status:'ready',retention:{expiresAt:null}});
  await database.collection('competencyexports').insertOne({storageKey:key,sha256,status:'ready',expiresAt:new Date(Date.now()+60000)});
  assert.deepEqual(await check([entry]),['competency restored reference integrity ok references=3']);
});
test('metadata without private archive fails for each usable source collection',async()=>{
  for(const collection of ['competencyimports','competencyevidences','competencyexports']){
    const values={storageKey:key,sha256,status:'ready',expiresAt:new Date(Date.now()+60000)};
    await database.collection(collection).insertOne(values);
    await assert.rejects(()=>check(null),/reference\/hash mismatch/);
    await database.collection(collection).deleteMany({});
  }
});
test('wrong content hash fails despite matching key',async()=>{
  await database.collection('competencyimports').insertOne({storageKey:key,sha256:'b'.repeat(64)});
  await assert.rejects(()=>check([entry]),/reference\/hash mismatch/);
});
test('expired or deletion-pending sources do not falsely require removed private bytes',async()=>{
  await database.collection('competencyevidences').insertMany([
    {storageKey:key,sha256,status:'ready',retention:{expiresAt:new Date(0)}},
    {storageKey:key,sha256,status:'deletion_pending'}]);
  await database.collection('competencyexports').insertOne({storageKey:key,sha256,status:'ready',expiresAt:new Date(0)});
  assert.deepEqual(await check([]),['competency restored reference integrity ok references=0']);
});
test('unused archived files are retained without inventing live references',async()=>{
  assert.deepEqual(await check([entry]),['competency restored reference integrity ok references=0']);
});
