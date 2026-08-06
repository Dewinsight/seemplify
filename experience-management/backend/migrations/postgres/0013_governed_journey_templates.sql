-- Runtime schema 13: governed, versioned Journey Map templates.
--
-- System templates are seeded by the application from the single TypeScript
-- catalogue after this schema is verified. The migration intentionally does
-- not publish or claim review of any seed.

CREATE TABLE IF NOT EXISTS journey_templates (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('system','space')),
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  current_version_id TEXT,
  published_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='system' AND space_id IS NULL) OR (scope='space' AND space_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_templates_system_key
  ON journey_templates(template_key) WHERE scope='system';
CREATE UNIQUE INDEX IF NOT EXISTS journey_templates_space_key
  ON journey_templates(space_id,template_key) WHERE scope='space';
CREATE INDEX IF NOT EXISTS journey_templates_space_status
  ON journey_templates(space_id,status,updated_at DESC,id);

CREATE TABLE IF NOT EXISTS journey_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES journey_templates(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('system','space')),
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','in_review','published','retired')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  use_case TEXT NOT NULL DEFAULT '',
  experience_type TEXT NOT NULL DEFAULT 'customer'
    CHECK(experience_type IN ('customer','employee','citizen','patient','partner','custom')),
  map_type TEXT NOT NULL DEFAULT 'current_state'
    CHECK(map_type IN ('current_state','future_state','ideal_state','service_blueprint')),
  lanes_json TEXT NOT NULL DEFAULT '[]',
  stages_json TEXT NOT NULL DEFAULT '[]',
  content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  retired_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='system' AND space_id IS NULL) OR (scope='space' AND space_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_template_versions_number
  ON journey_template_versions(template_id,version_number);
CREATE UNIQUE INDEX IF NOT EXISTS journey_template_versions_one_published
  ON journey_template_versions(template_id) WHERE state='published';
CREATE INDEX IF NOT EXISTS journey_template_versions_state
  ON journey_template_versions(template_id,state,version_number DESC);

DO $journey_template_pointer_foreign_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    JOIN unnest(constraint_record.conkey) key(attnum) ON TRUE
    JOIN pg_attribute attribute ON attribute.attrelid=constraint_record.conrelid AND attribute.attnum=key.attnum
    WHERE constraint_record.conrelid='journey_templates'::regclass
      AND constraint_record.contype='f' AND attribute.attname='current_version_id'
  ) THEN
    ALTER TABLE journey_templates ADD CONSTRAINT journey_templates_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES journey_template_versions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    JOIN unnest(constraint_record.conkey) key(attnum) ON TRUE
    JOIN pg_attribute attribute ON attribute.attrelid=constraint_record.conrelid AND attribute.attnum=key.attnum
    WHERE constraint_record.conrelid='journey_templates'::regclass
      AND constraint_record.contype='f' AND attribute.attname='published_version_id'
  ) THEN
    ALTER TABLE journey_templates ADD CONSTRAINT journey_templates_published_version_fk
      FOREIGN KEY (published_version_id) REFERENCES journey_template_versions(id) ON DELETE SET NULL;
  END IF;
END
$journey_template_pointer_foreign_keys$;

CREATE TABLE IF NOT EXISTS journey_template_instantiations (
  definition_id TEXT PRIMARY KEY REFERENCES journey_definitions(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES journey_map_versions(id) ON DELETE CASCADE,
  template_version_id TEXT NOT NULL REFERENCES journey_template_versions(id) ON DELETE RESTRICT,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS journey_template_instantiations_version
  ON journey_template_instantiations(version_id);
CREATE INDEX IF NOT EXISTS journey_template_instantiations_template
  ON journey_template_instantiations(template_version_id,created_at DESC,definition_id);

CREATE TABLE IF NOT EXISTS journey_template_audit_events (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES journey_templates(id) ON DELETE CASCADE,
  template_version_id TEXT REFERENCES journey_template_versions(id) ON DELETE SET NULL,
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('seeded','created','draft_updated','version_created','submitted_for_review','review_rejected','published','retired','map_created')),
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journey_template_audit_history
  ON journey_template_audit_events(template_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS journey_template_audit_space
  ON journey_template_audit_events(space_id,created_at DESC,id);

-- Grant the new explicit permissions to built-in roles once. Customer-created
-- roles remain unchanged and can receive these through the normal RBAC API.
INSERT INTO platform_rbac_role_permissions (role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_templates.read',NULL,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM platform_rbac_roles WHERE id IN ('admin','editor','viewer')
ON CONFLICT DO NOTHING;
INSERT INTO platform_rbac_role_permissions (role_id,permission,granted_by_user_id,granted_at)
SELECT id,'journey_templates.manage',NULL,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM platform_rbac_roles WHERE id IN ('admin','editor')
ON CONFLICT DO NOTHING;
