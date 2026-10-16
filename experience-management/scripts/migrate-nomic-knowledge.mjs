import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { signedKnowledgeRequest } from './knowledge-runtime-request.mjs';

const profile = Object.freeze({ provider: 'nomic-node', model: 'nomic-ai/nomic-embed-text-v1.5',
  revision: 'e9b6763023c676ca8431644204f50c2b100d9aab', dtype: 'q8', dimensions: 768,
  vectorIndexVersion: 'nomic-embed-text-v1.5-q8-v1' });
const secret = fs.readFileSync(process.env.KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE, 'utf8').trim();
async function runtime(route, input) {
  return signedKnowledgeRequest(process.env.KNOWLEDGE_RUNTIME_BASE_URL, secret, route, input);
}
const client = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DATABASE, user: process.env.POSTGRES_OWNER_USER,
  password: fs.readFileSync(process.env.POSTGRES_OWNER_PASSWORD_FILE, 'utf8').trim(),
  connectionTimeoutMillis: 10000, application_name: 'seemplify-nomic-cutover' });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('seemplify-nomic-cutover'))");
  if (Number((await client.query("SELECT count(*) FROM knowledge_jobs WHERE state IN ('queued','processing')")).rows[0].count)) {
    throw new Error('Knowledge jobs must drain before the embedding cutover.');
  }
  const bases = (await client.query("SELECT * FROM knowledge_bases WHERE status NOT IN ('deleted','deleting') ORDER BY id FOR UPDATE")).rows;
  const proof = [];
  for (const base of bases) {
    if (base.embedding_provider === profile.provider) continue;
    if (base.embedding_provider !== 'azure-openai') throw new Error('An unsupported legacy corpus requires a separate migration.');
    const documents = (await client.query("SELECT id,sha256,chunk_count,state,index_version FROM knowledge_documents WHERE knowledge_base_id=$1 AND space_id=$2 AND state<>'deleted' ORDER BY id FOR UPDATE", [base.id, base.space_id])).rows;
    if (documents.some((d) => d.state !== 'ready')) throw new Error('All documents must be ready before migration.');
    let prepared = { prepared: true, sourcePreserved: true, chunks: 0, documents: 0 };
    if (documents.length) {
      prepared = await runtime('/v1/migrate-nomic', { source: 'experience-nomic-migration', spaceId: base.space_id,
        knowledgeBaseId: base.id, indexVersion: Number(base.current_version), documents: documents.map((d) => ({
          id: d.id, sha256: d.sha256, chunkCount: Number(d.chunk_count) })) });
      if (!prepared.prepared || !prepared.sourcePreserved || prepared.chunks !== documents.reduce((n, d) => n + Number(d.chunk_count), 0)) {
        throw new Error('Nomic corpus verification did not cover every source chunk.');
      }
      const result = await runtime('/v1/retrieve', { requestId: crypto.randomUUID(), spaceId: base.space_id,
        knowledgeBases: [{ id: base.id, indexVersion: Number(base.current_version), embeddingProfile: profile }],
        embeddingProfile: profile, query: 'What information is included in this document?', topK: 3, graphDepth: 0 });
      if (!result.citations?.length || result.metrics?.embeddingProfile?.provider !== profile.provider
          || result.citations.some((c) => !documents.some((d) => d.id === c.documentId))) throw new Error('Nomic retrieval acceptance failed.');
    }
    await client.query("UPDATE knowledge_base_embedding_profiles SET mode='disabled',updated_at=CURRENT_TIMESTAMP::text WHERE knowledge_base_id=$1 AND mode='primary'", [base.id]);
    await client.query(`INSERT INTO knowledge_base_embedding_profiles
      (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,error,last_indexed_at,created_at,updated_at)
      VALUES ($1,$2,$3,'primary',$4,$5,NULL,$6,CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
      ON CONFLICT(knowledge_base_id,vector_index_version) DO UPDATE SET mode='primary',state=EXCLUDED.state,
        current_version=EXCLUDED.current_version,error=NULL,last_indexed_at=EXCLUDED.last_indexed_at,updated_at=EXCLUDED.updated_at`,
    [base.space_id, base.id, profile.vectorIndexVersion, documents.length ? 'ready' : 'empty', base.current_version, base.last_indexed_at]);
    await client.query(`INSERT INTO knowledge_document_embeddings
      (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,chunk_count,indexed_at,created_at,updated_at)
      SELECT space_id,knowledge_base_id,id,$3,sha256,index_version,'ready',chunk_count,indexed_at,created_at,CURRENT_TIMESTAMP::text
      FROM knowledge_documents WHERE knowledge_base_id=$1 AND space_id=$2 AND state='ready'
      ON CONFLICT(document_id,vector_index_version) DO NOTHING`, [base.id, base.space_id, profile.vectorIndexVersion]);
    await client.query(`UPDATE knowledge_bases SET embedding_provider=$2,embedding_model=$3,embedding_revision=$4,
      embedding_dtype=$5,embedding_dimension=$6,vector_index_version=$7,updated_at=CURRENT_TIMESTAMP::text WHERE id=$1`,
    [base.id, profile.provider, profile.model, profile.revision, profile.dtype, profile.dimensions, profile.vectorIndexVersion]);
    proof.push({ ...prepared, baseId: base.id, priorVersion: Number(base.current_version) });
  }
  await client.query('COMMIT');
  fs.mkdirSync('/app/runtime/knowledge', { recursive: true });
  if (proof.length) fs.writeFileSync('/app/runtime/knowledge/nomic-cutover-proof.json', JSON.stringify({
    verifiedAt: new Date().toISOString(), profile, originalProfilesPreserved: true, bases: proof }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ event: 'nomic_cutover_verified', migratedBases: proof.length, profile, sourceDataPreserved: true }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
