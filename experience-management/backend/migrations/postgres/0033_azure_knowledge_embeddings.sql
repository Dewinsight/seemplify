ALTER TABLE knowledge_embedding_profiles
  DROP CONSTRAINT IF EXISTS knowledge_embedding_profiles_provider_check;

-- SQLite-to-PostgreSQL cutovers assign deterministic hashed names to imported
-- checks. Remove only provider checks regardless of their historical name so
-- both fresh and migrated databases converge on the same Azure-capable rule.
DO $$
DECLARE provider_constraint TEXT;
BEGIN
  FOR provider_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid='knowledge_embedding_profiles'::regclass
      AND constraint_record.contype='c'
      AND pg_get_constraintdef(constraint_record.oid) ILIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_embedding_profiles DROP CONSTRAINT %I', provider_constraint);
  END LOOP;
END $$;

ALTER TABLE knowledge_embedding_profiles
  ADD CONSTRAINT knowledge_embedding_profiles_provider_check
  CHECK(provider IN ('azure-openai','qwen-tei','gte-node'));

INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
VALUES
  ('azure-text-embedding-3-large-v1','azure-openai','text-embedding-3-large',
   'f0706db2d8dd64a5f9385fd9ab1713b9083eb881','float32',3072,'configured',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
ON CONFLICT(vector_index_version) DO NOTHING;

UPDATE knowledge_embedding_profiles
SET state=CASE WHEN vector_index_version='azure-text-embedding-3-large-v1' THEN 'configured' ELSE state END,
    updated_at=CURRENT_TIMESTAMP::text
WHERE vector_index_version='azure-text-embedding-3-large-v1';

ALTER TABLE knowledge_bases ALTER COLUMN embedding_model SET DEFAULT 'text-embedding-3-large';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_dimension SET DEFAULT 3072;
ALTER TABLE knowledge_bases ALTER COLUMN embedding_provider SET DEFAULT 'azure-openai';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_revision SET DEFAULT 'f0706db2d8dd64a5f9385fd9ab1713b9083eb881';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_dtype SET DEFAULT 'float32';
ALTER TABLE knowledge_bases ALTER COLUMN vector_index_version SET DEFAULT 'azure-text-embedding-3-large-v1';

-- The production Arango service is new, so no legacy vector corpus exists to
-- preserve there. Bases without a completed index can safely adopt the Azure
-- profile immediately; any completed legacy corpus remains pinned until an
-- explicit reindex is requested.
UPDATE knowledge_bases
SET embedding_model='text-embedding-3-large',
    embedding_dimension=3072,
    embedding_provider='azure-openai',
    embedding_revision='f0706db2d8dd64a5f9385fd9ab1713b9083eb881',
    embedding_dtype='float32',
    vector_index_version='azure-text-embedding-3-large-v1',
    updated_at=CURRENT_TIMESTAMP::text
WHERE current_version=0;

-- Empty bases have no committed vector corpus, so move their rollout metadata
-- to the same Azure profile atomically. Completed bases retain their original
-- embedding space and remain readable until a deliberate reindex.
DELETE FROM knowledge_document_embeddings document_profile
WHERE EXISTS (
  SELECT 1 FROM knowledge_bases base
  WHERE base.id=document_profile.knowledge_base_id AND base.current_version=0
);

DELETE FROM knowledge_base_embedding_profiles base_profile
WHERE EXISTS (
  SELECT 1 FROM knowledge_bases base
  WHERE base.id=base_profile.knowledge_base_id AND base.current_version=0
);

INSERT INTO knowledge_base_embedding_profiles
  (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,error,last_indexed_at,created_at,updated_at)
SELECT space_id,id,'azure-text-embedding-3-large-v1','primary','empty',0,NULL,NULL,created_at,updated_at
FROM knowledge_bases WHERE current_version=0
ON CONFLICT(knowledge_base_id,vector_index_version) DO UPDATE
SET mode='primary',state='empty',current_version=0,error=NULL,last_indexed_at=NULL,
    updated_at=EXCLUDED.updated_at;

INSERT INTO knowledge_document_embeddings
  (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,
   chunk_count,last_job_id,error,indexed_at,created_at,updated_at)
SELECT document.space_id,document.knowledge_base_id,document.id,'azure-text-embedding-3-large-v1',
  document.sha256,document.index_version,
  CASE WHEN document.state='failed' THEN 'failed' WHEN document.state='deleted' THEN 'deleted'
    WHEN document.state='deleting' THEN 'deleting' ELSE 'queued' END,
  0,NULL,document.error,NULL,document.created_at,document.updated_at
FROM knowledge_documents document
JOIN knowledge_bases base ON base.id=document.knowledge_base_id AND base.space_id=document.space_id
WHERE base.current_version=0
ON CONFLICT(document_id,vector_index_version) DO NOTHING;

UPDATE knowledge_jobs job
SET embedding_profile_id='azure-text-embedding-3-large-v1',updated_at=CURRENT_TIMESTAMP::text
WHERE job.state IN ('queued','processing','failed') AND EXISTS (
  SELECT 1 FROM knowledge_bases base
  WHERE base.id=job.knowledge_base_id AND base.space_id=job.space_id AND base.current_version=0
);
