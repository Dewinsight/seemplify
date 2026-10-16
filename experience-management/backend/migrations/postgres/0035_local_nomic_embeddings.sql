-- Add a new immutable embedding space. Existing bases, receipts, documents and
-- Azure/GTE/Qwen vectors are preserved. Completed corpora require a verified
-- parallel backfill before their primary profile may be changed.
ALTER TABLE knowledge_embedding_profiles DROP CONSTRAINT IF EXISTS knowledge_embedding_profiles_provider_check;
ALTER TABLE knowledge_embedding_profiles ADD CONSTRAINT knowledge_embedding_profiles_provider_check
  CHECK(provider IN ('azure-openai','qwen-tei','gte-node','nomic-node'));

INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
VALUES ('nomic-embed-text-v1.5-q8-v1','nomic-node','nomic-ai/nomic-embed-text-v1.5',
  'e9b6763023c676ca8431644204f50c2b100d9aab','q8',768,'configured',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
ON CONFLICT(vector_index_version) DO NOTHING;

ALTER TABLE knowledge_bases ALTER COLUMN embedding_model SET DEFAULT 'nomic-ai/nomic-embed-text-v1.5';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_dimension SET DEFAULT 768;
ALTER TABLE knowledge_bases ALTER COLUMN embedding_provider SET DEFAULT 'nomic-node';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_revision SET DEFAULT 'e9b6763023c676ca8431644204f50c2b100d9aab';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_dtype SET DEFAULT 'q8';
ALTER TABLE knowledge_bases ALTER COLUMN vector_index_version SET DEFAULT 'nomic-embed-text-v1.5-q8-v1';
