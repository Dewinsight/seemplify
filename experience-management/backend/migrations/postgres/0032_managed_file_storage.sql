-- Runtime schema 32: provider-neutral managed file storage metadata.

DO $managed_storage_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>31 THEN
    RAISE EXCEPTION 'runtime-32 managed file storage requires the checksummed runtime-31 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$managed_storage_predecessor$;

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_container TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_resource_type TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_url TEXT;

ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS storage_container TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS storage_resource_type TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS storage_url TEXT;

ALTER TABLE knowledge_file_cleanup ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE knowledge_file_cleanup ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE knowledge_file_cleanup ADD COLUMN IF NOT EXISTS storage_container TEXT;
ALTER TABLE knowledge_file_cleanup ADD COLUMN IF NOT EXISTS storage_resource_type TEXT;
ALTER TABLE knowledge_file_cleanup ADD COLUMN IF NOT EXISTS storage_url TEXT;

ALTER TABLE journey_asset_blob_purge_outbox ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE journey_asset_blob_purge_outbox ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE journey_asset_blob_purge_outbox ADD COLUMN IF NOT EXISTS storage_container TEXT;
ALTER TABLE journey_asset_blob_purge_outbox ADD COLUMN IF NOT EXISTS storage_resource_type TEXT;
ALTER TABLE journey_asset_blob_purge_outbox ADD COLUMN IF NOT EXISTS storage_url TEXT;

ALTER TABLE uploads ADD CONSTRAINT uploads_storage_provider_check
  CHECK(storage_provider IN ('local','cloudinary','azure-blob')) NOT VALID;
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_storage_provider_check
  CHECK(storage_provider IN ('local','cloudinary','azure-blob')) NOT VALID;
ALTER TABLE knowledge_file_cleanup ADD CONSTRAINT knowledge_file_cleanup_storage_provider_check
  CHECK(storage_provider IN ('local','cloudinary','azure-blob')) NOT VALID;
ALTER TABLE journey_asset_blob_purge_outbox ADD CONSTRAINT journey_asset_blob_purge_storage_provider_check
  CHECK(storage_provider IN ('local','cloudinary','azure-blob')) NOT VALID;

COMMENT ON COLUMN uploads.storage_provider IS 'Immutable provider snapshot used for reads and deletion after the solution default changes.';
COMMENT ON COLUMN knowledge_documents.storage_provider IS 'Immutable provider snapshot used for reads and deletion after the solution default changes.';
