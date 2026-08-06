-- Runtime schema 24: governed rich journey cards, catalogue snapshots, media,
-- and exact emotional-curve points.
--
-- Existing journey_map_cards remain the compatibility and plain-text read
-- model. Every table below is additive. Rich detail, catalogue links and media
-- are attached by exact card/version/space keys so published versions remain
-- immutable and legacy card content is never rewritten or inferred.

DO $journey_rich_card_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>23 THEN
    RAISE EXCEPTION 'runtime-24 rich journey cards require the checksummed runtime-23 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_rich_card_predecessor$;

CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_versions_tenant_identity
  ON journey_map_versions(id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_cards_tenant_identity
  ON journey_map_cards(id,version_id,space_id);
CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_uploads_tenant_identity
  ON uploads(id,space_id);

CREATE TABLE journey_channels (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  current_version_number INTEGER NOT NULL CHECK(current_version_number>=1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_channels_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_channels_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_channels_space_status
  ON journey_channels(space_id,status,updated_at DESC,id);

CREATE TABLE journey_channel_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  channel_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>=1),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(octet_length(description)<=4000),
  category TEXT NOT NULL CHECK(category IN (
    'web','mobile_app','email','social','phone','in_person','chat','messaging','self_service','partner','other')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_channel_versions_number_once UNIQUE(channel_id,version_number),
  CONSTRAINT journey_channel_versions_tenant_identity UNIQUE(id,channel_id,space_id),
  CONSTRAINT journey_channel_versions_channel_tenant_fk FOREIGN KEY(channel_id,space_id)
    REFERENCES journey_channels(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_channel_versions_history
  ON journey_channel_versions(space_id,channel_id,version_number DESC,id);

CREATE TABLE journey_touchpoints (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  current_version_number INTEGER NOT NULL CHECK(current_version_number>=1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_touchpoints_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_touchpoints_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_touchpoints_space_status
  ON journey_touchpoints(space_id,status,updated_at DESC,id);

CREATE TABLE journey_touchpoint_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  touchpoint_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number>=1),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(octet_length(description)<=4000),
  channel_id TEXT NOT NULL,
  channel_version_id TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_touchpoint_versions_number_once UNIQUE(touchpoint_id,version_number),
  CONSTRAINT journey_touchpoint_versions_tenant_identity UNIQUE(id,touchpoint_id,space_id),
  CONSTRAINT journey_touchpoint_versions_touchpoint_tenant_fk FOREIGN KEY(touchpoint_id,space_id)
    REFERENCES journey_touchpoints(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_touchpoint_versions_channel_tenant_fk FOREIGN KEY(channel_version_id,channel_id,space_id)
    REFERENCES journey_channel_versions(id,channel_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_touchpoint_versions_history
  ON journey_touchpoint_versions(space_id,touchpoint_id,version_number DESC,id);
CREATE INDEX journey_touchpoint_versions_channel
  ON journey_touchpoint_versions(space_id,channel_id,channel_version_id,id);

CREATE TABLE journey_card_details (
  card_id TEXT PRIMARY KEY CHECK(length(card_id) BETWEEN 1 AND 128),
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
  rich_text_json JSONB NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '' CHECK(length(plain_text)<=8000),
  emotion_valence INTEGER CHECK(emotion_valence IS NULL OR emotion_valence BETWEEN -5 AND 5),
  emotion_intensity INTEGER CHECK(emotion_intensity IS NULL OR emotion_intensity BETWEEN 0 AND 5),
  emotion_label TEXT NOT NULL DEFAULT '' CHECK(length(emotion_label)<=120),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_card_details_tenant_identity UNIQUE(card_id,version_id,space_id),
  CONSTRAINT journey_card_details_card_tenant_fk FOREIGN KEY(card_id,version_id,space_id)
    REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_card_details_rich_json CHECK(
    jsonb_typeof(rich_text_json)='object'
    AND rich_text_json->>'version'='1'
    AND jsonb_typeof(rich_text_json->'blocks')='array'
    AND octet_length(rich_text_json::text)<=65536),
  CONSTRAINT journey_card_details_emotion_shape CHECK(
    (emotion_valence IS NULL AND emotion_intensity IS NULL AND emotion_label='')
    OR (emotion_valence IS NOT NULL AND emotion_intensity IS NOT NULL)),
  CONSTRAINT journey_card_details_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_card_details_version
  ON journey_card_details(space_id,version_id,card_id);

CREATE TABLE journey_card_touchpoints (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  card_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  touchpoint_id TEXT NOT NULL,
  touchpoint_version_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_card_touchpoints_item_once UNIQUE(card_id,touchpoint_id),
  CONSTRAINT journey_card_touchpoints_ordinal_once UNIQUE(card_id,ordinal),
  CONSTRAINT journey_card_touchpoints_tenant_identity UNIQUE(id,card_id,space_id),
  CONSTRAINT journey_card_touchpoints_card_tenant_fk FOREIGN KEY(card_id,version_id,space_id)
    REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_card_touchpoints_catalog_tenant_fk FOREIGN KEY(touchpoint_version_id,touchpoint_id,space_id)
    REFERENCES journey_touchpoint_versions(id,touchpoint_id,space_id) ON DELETE RESTRICT
);
CREATE INDEX journey_card_touchpoints_version
  ON journey_card_touchpoints(space_id,version_id,card_id,ordinal,id);

CREATE TABLE journey_card_assets (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  card_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','attachment')),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('upload','external_url')),
  source_upload_id TEXT,
  source_external_url TEXT CHECK(source_external_url IS NULL OR length(source_external_url)<=2048),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 160),
  byte_size BIGINT NOT NULL DEFAULT 0 CHECK(byte_size BETWEEN 0 AND 26214400),
  sha256 TEXT CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text)<=500),
  caption TEXT NOT NULL DEFAULT '' CHECK(length(caption)<=1000),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  CONSTRAINT journey_card_assets_tenant_identity UNIQUE(id,card_id,space_id),
  CONSTRAINT journey_card_assets_card_tenant_fk FOREIGN KEY(card_id,version_id,space_id)
    REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_card_assets_upload_tenant_fk FOREIGN KEY(source_upload_id,space_id)
    REFERENCES uploads(id,space_id) ON DELETE RESTRICT,
  CONSTRAINT journey_card_assets_source_shape CHECK(
    (source_kind='upload' AND source_upload_id IS NOT NULL AND source_external_url IS NULL AND sha256 IS NOT NULL)
    OR (source_kind='external_url' AND source_upload_id IS NULL AND source_external_url IS NOT NULL AND sha256 IS NULL)),
  CONSTRAINT journey_card_assets_image_shape CHECK(
    (kind='image' AND source_kind='upload' AND alt_text<>'') OR kind='attachment'),
  CONSTRAINT journey_card_assets_state_shape CHECK(
    (state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL)),
  CONSTRAINT journey_card_assets_retention_order CHECK(
    retention_expires_at IS NULL OR retention_expires_at>deleted_at)
);
CREATE INDEX journey_card_assets_version
  ON journey_card_assets(space_id,version_id,card_id,ordinal,id);
CREATE UNIQUE INDEX journey_card_assets_active_ordinal_once
  ON journey_card_assets(card_id,ordinal) WHERE state='active';
CREATE INDEX journey_card_assets_retention
  ON journey_card_assets(retention_expires_at,id) WHERE state='deleted';

-- File removal cannot be atomic with a database transaction. This durable
-- outbox survives a process crash or filesystem error after the governed
-- upload row is removed. Workers claim with a lease, verify the exact pinned
-- byte length/hash before unlinking, and retain completed receipts.
-- It deliberately has no space FK: required physical-erasure work must
-- survive a logical tenant cascade and remain retryable.
CREATE TABLE journey_asset_blob_purge_outbox (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL,
  source_upload_id TEXT NOT NULL CHECK(length(source_upload_id) BETWEEN 1 AND 128),
  stored_filename TEXT NOT NULL CHECK(length(stored_filename) BETWEEN 1 AND 255),
  expected_sha256 TEXT NOT NULL CHECK(expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size BIGINT NOT NULL CHECK(expected_byte_size>=0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','failed','completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  last_error_fingerprint TEXT CHECK(last_error_fingerprint IS NULL OR last_error_fingerprint ~ '^[a-f0-9]{64}$'),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_asset_blob_purge_upload_once UNIQUE(source_upload_id,space_id),
  CONSTRAINT journey_asset_blob_purge_state_shape CHECK(
    (state='completed' AND completed_at IS NOT NULL AND lease_expires_at IS NULL)
    OR (state='processing' AND completed_at IS NULL AND lease_expires_at IS NOT NULL)
    OR (state IN ('pending','failed') AND completed_at IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT journey_asset_blob_purge_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_asset_blob_purge_outbox_due
  ON journey_asset_blob_purge_outbox(state,next_attempt_at,lease_expires_at,id);

CREATE TABLE journey_rich_card_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'channel.created','channel.version_created','channel.retired',
    'touchpoint.created','touchpoint.version_created','touchpoint.retired',
    'card.detail_updated','card.touchpoint_linked','card.touchpoint_unlinked',
    'card.asset_attached','card.asset_deleted','card.asset_restored','card.asset_purged')),
  target_type TEXT NOT NULL CHECK(target_type IN ('channel','touchpoint','card','asset')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  definition_id TEXT,
  version_id TEXT,
  before_fingerprint TEXT CHECK(before_fingerprint IS NULL OR before_fingerprint ~ '^[a-f0-9]{64}$'),
  after_fingerprint TEXT CHECK(after_fingerprint IS NULL OR after_fingerprint ~ '^[a-f0-9]{64}$'),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_rich_card_audit_detail_json CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=8192)
);
CREATE INDEX journey_rich_card_audit_history
  ON journey_rich_card_audit_events(space_id,created_at DESC,id);

CREATE OR REPLACE FUNCTION journey_rich_snapshot_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_rich_snapshot_immutable_guard$
BEGIN
  RAISE EXCEPTION 'Journey catalogue versions are immutable' USING ERRCODE='55000';
END
$journey_rich_snapshot_immutable_guard$;

CREATE OR REPLACE FUNCTION journey_rich_audit_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_rich_audit_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey rich-card audit is append-only' USING ERRCODE='55000';
END
$journey_rich_audit_append_only_guard$;

CREATE TRIGGER journey_channel_versions_immutable
BEFORE UPDATE OR DELETE ON journey_channel_versions
FOR EACH ROW EXECUTE FUNCTION journey_rich_snapshot_immutable_guard();
CREATE TRIGGER journey_touchpoint_versions_immutable
BEFORE UPDATE OR DELETE ON journey_touchpoint_versions
FOR EACH ROW EXECUTE FUNCTION journey_rich_snapshot_immutable_guard();
CREATE TRIGGER journey_rich_card_audit_append_only
BEFORE UPDATE OR DELETE ON journey_rich_card_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_rich_audit_append_only_guard();

-- Stored administrator customisations survive the catalogue release. Only
-- missing keys inherit defaults; explicitly configured plan values win.
UPDATE platform_subscription_plans SET
  features_json=(features_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeyRichCards":false}'::jsonb
      ELSE '{"journeyRichCards":true}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(features_json::jsonb))
  ))::text,
  limits_json=(limits_json::jsonb || (
    (CASE code
      WHEN 'starter' THEN '{"journeyChannels":0,"journeyTouchpoints":0,"journeyCardAssets":0,"journeyCardAssetBytes":0}'::jsonb
      WHEN 'team' THEN '{"journeyChannels":100,"journeyTouchpoints":500,"journeyCardAssets":2000,"journeyCardAssetBytes":2147483648}'::jsonb
      ELSE '{"journeyChannels":2000,"journeyTouchpoints":20000,"journeyCardAssets":100000,"journeyCardAssetBytes":214748364800}'::jsonb
    END) - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');
