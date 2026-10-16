if (!process.argv.includes('--live')) throw new Error('Pass --live to test a reserved synthetic knowledge tenant.');
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const {CONFIG}=require('./config.cjs');
const {createKnowledgeRuntime,embeddingProfiles}=require('./runtime.cjs');
const spaceId='knowledge-live-benchmark-'+crypto.randomBytes(16).toString('hex');
const directory='/tmp/nomic-runtime-live';fs.mkdirSync(directory,{recursive:true});
const source=directory+'/source.md';const content='Annual Leave Policy\nEmployees receive twenty days of paid annual leave each year. Approval is required from their manager before booking a holiday.';
fs.writeFileSync(source,content);const profile=embeddingProfiles(CONFIG)['nomic-node'];
const runtime=createKnowledgeRuntime({config:{...CONFIG,paths:{...CONFIG.paths,staging:directory}},
 extractGraph:async()=>({entities:[],claims:[],relations:[],windows:0})});
(async()=>{try{
 await runtime.start();
 const indexed=await runtime.index({jobId:'nomic-new-index',spaceId,aiIdentity:{sub:'synthetic-test',email:'test@example.test',displayName:'Nomic synthetic test'},
  knowledgeBase:{id:'synthetic-base',indexVersion:1,embeddingModel:profile.model,embeddingDimension:768,embeddingProfile:profile,chunkerVersion:'nomic-runtime-live-v1',targetEmbeddingProfiles:[profile]},
  document:{id:'synthetic-document',sourcePath:source,originalName:'source.md',mimeType:'text/markdown',sizeBytes:fs.statSync(source).size,sha256:crypto.createHash('sha256').update(content).digest('hex'),metadata:{synthetic:true}}});
 assert.ok(indexed.document.chunkCount>0);
 const answers=await Promise.all(Array.from({length:8},(_,i)=>runtime.retrieve({requestId:'nomic-retrieve-'+i,spaceId,
  knowledgeBases:[{id:'synthetic-base',indexVersion:1,embeddingProfile:profile}],embeddingProfile:profile,
  query:'How much annual holiday does an employee receive?',topK:3,graphDepth:0})));
 for(const a of answers){assert.equal(a.metrics.embeddingProfile.provider,'nomic-node');assert.ok(a.citations.some(c=>c.documentId==='synthetic-document'&&c.excerpt.includes('twenty days')));}
 const scan=await runtime.scan({requestId:'nomic-scan',spaceId,knowledgeBaseId:'synthetic-base',documentId:'synthetic-document',indexVersion:1,offset:0,limit:50});assert.ok(scan.items.length>0);
 await runtime.remove({jobId:'nomic-delete',spaceId,knowledgeBaseId:'synthetic-base',documentId:'synthetic-document',indexVersion:2});
 const after=await runtime.retrieve({requestId:'nomic-after-delete',spaceId,knowledgeBases:[{id:'synthetic-base',indexVersion:2,embeddingProfile:profile}],embeddingProfile:profile,query:'annual leave',topK:3,graphDepth:0});assert.equal(after.citations.length,0);
 console.log(JSON.stringify({new_document_indexed:true,concurrent_retrievals:answers.length,citations_verified:true,scan_passed:true,physical_delete_verified:true,profile}));
}finally{
 try{await runtime.cleanupTestTenant({spaceId,source:'knowledge-live-benchmark',confirmation:'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK'});const c=await runtime.cleanupTestTenant({spaceId,source:'knowledge-live-benchmark',confirmation:'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK'});assert.equal(c.dropped,false);console.log(JSON.stringify({synthetic_database_removed:true}));}finally{await runtime.close();fs.unlinkSync(source);}
}})().catch(e=>{console.error(e.message);process.exitCode=1});
