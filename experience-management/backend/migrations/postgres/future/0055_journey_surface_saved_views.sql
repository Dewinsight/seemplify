-- Runtime schema 55: durable saved views for the hierarchy and service-blueprint
-- surfaces.
--
-- Runtime-26 gave the Journey Map surface saved views. The hierarchy and
-- service-blueprint surfaces have none, so every operator re-derives the same
-- root, direction, taxonomy and review filters by hand, and nothing about that
-- selection survives a reload, an export or a handover.
--
-- Three properties separate this from "another settings table":
--
--   1. A saved view is presentation state, never source-of-truth journey data.
--      No column here is authoritative for a hierarchy link, a blueprint element
--      or a taxonomy term; every durable identity the configuration names is
--      re-authorised against its own table on each read.
--   2. Configuration is IMMUTABLE and VERSIONED. Editing a view appends a new
--      journey_surface_view_versions row under an optimistic definition
--      revision; it never rewrites the row a colleague, an export or a pinned
--      default already read. Both the version table and the audit table are
--      append-only by trigger, not by convention.
--   3. The configuration surface is CLOSED. Every filter is a bounded typed
--      column with an enumerated CHECK, and the JSON document is restricted to a
--      fixed key allowlist at both levels. There is deliberately no free-text
--      column anywhere in this file: a saved view can never carry a SQL
--      fragment, a query string or a filter expression for the service to
--      interpret.
--
-- Delete semantics follow runtime-29: an edge that must not orphan uses ON
-- DELETE NO ACTION rather than RESTRICT, so sibling cascades land first and
-- journey deletion stays deterministic. Configuration targets (a hierarchy root
-- journey, a taxonomy term, a blueprint, a pinned blueprint version) carry NO
-- foreign key at all and are proven same-tenant by
-- journey_surface_view_version_guard at write time instead. A foreign key there
-- would be unresolvable: journey_definitions is hard-deleted, NO ACTION would
-- refuse that delete because of a saved view, and a cascade cannot reach an
-- append-only version row. Runtime-26 made the same trade for the same reason
-- (journey_saved_view_reference_tenant_guard).

DO $journey_surface_view_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>54 THEN
    RAISE EXCEPTION 'runtime-55 journey surface saved views require the checksummed runtime-54 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_surface_view_predecessor$;

CREATE TABLE journey_surface_view_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- The surface discriminator is carried on the version row too and joined
  -- through a three-column foreign key, so a hierarchy view can never acquire a
  -- service-blueprint configuration by way of a two-column parent key.
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  normalized_name TEXT NOT NULL CHECK(
    length(normalized_name) BETWEEN 1 AND 160 AND normalized_name=lower(normalized_name)),
  owner_user_id TEXT NOT NULL,
  -- An owner-private view is invisible and unmanageable to every other
  -- principal, including space owners and admins. Sharing is an explicit false.
  owner_private BOOLEAN NOT NULL DEFAULT TRUE,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
  -- Set by the same transaction that appends the version it names, under the
  -- deferred foreign key declared after the version table. Creation therefore
  -- lands at revision 1 pointing at version 1, rather than at a transient
  -- version-less state that a reader could observe and a revision counter would
  -- then have to burn a step escaping.
  current_version_id TEXT,
  current_version_number INTEGER NOT NULL DEFAULT 0 CHECK(current_version_number>=0),
  -- Optimistic concurrency token. journey_surface_view_definition_guard refuses
  -- any governed update that does not advance it by exactly one, so a lost
  -- update is a refused statement rather than a silently overwritten view.
  definition_revision INTEGER NOT NULL DEFAULT 1 CHECK(definition_revision>0),
  -- Idempotent creation: the same canonical create intent from the same owner
  -- collides here instead of producing a second view.
  create_request_sha256 TEXT NOT NULL CHECK(create_request_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  CONSTRAINT journey_surface_view_definitions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_surface_view_definitions_surface_identity UNIQUE(id,space_id,surface),
  CONSTRAINT journey_surface_view_definitions_name_once
    UNIQUE(space_id,owner_user_id,surface,normalized_name),
  CONSTRAINT journey_surface_view_definitions_create_once
    UNIQUE(space_id,owner_user_id,create_request_sha256),
  -- Runtime-26 binds saved-view ownership to space_memberships the same way: a
  -- saved view is owned by a MEMBER of the tenant, not by a user who once was
  -- one, and the composite key is what proves owner_user_id and space_id agree.
  CONSTRAINT journey_surface_view_definitions_owner_membership_fk FOREIGN KEY(space_id,owner_user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT journey_surface_view_definitions_lifecycle_shape CHECK(
    (lifecycle='active' AND retired_at IS NULL)
    OR (lifecycle='retired' AND retired_at IS NOT NULL AND retired_at>=created_at)),
  CONSTRAINT journey_surface_view_definitions_version_shape CHECK(
    (current_version_id IS NULL AND current_version_number=0)
    OR (current_version_id IS NOT NULL AND current_version_number>0)),
  CONSTRAINT journey_surface_view_definitions_time_order CHECK(updated_at>=created_at)
);
-- Surface listing for one principal: the owner-private predicate and the
-- lifecycle filter are both served without a sort.
CREATE INDEX journey_surface_view_definitions_surface
  ON journey_surface_view_definitions(space_id,surface,lifecycle,owner_private,updated_at DESC,id);
CREATE INDEX journey_surface_view_definitions_owner
  ON journey_surface_view_definitions(space_id,owner_user_id,surface,lifecycle,updated_at DESC,id);

CREATE TABLE journey_surface_view_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  view_id TEXT NOT NULL CHECK(length(view_id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  schema_version TEXT NOT NULL CHECK(schema_version='journey-surface-view/v1'),
  -- The revision the author held when they revised. The guard below compares it
  -- to the parent's live revision under a row lock, so two concurrent revisions
  -- of the same view cannot both append.
  definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
  configuration_json TEXT NOT NULL CHECK(
    octet_length(configuration_json) BETWEEN 2 AND 8192
    AND jsonb_typeof(configuration_json::jsonb)='object'),
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  -- Idempotent revision: replaying one revise intent returns the version it
  -- already appended rather than appending a second identical one.
  request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),

  -- Hierarchy surface configuration. Bounded and typed so a view is reviewable,
  -- and drift-checkable, without interpreting JSON.
  hierarchy_root_definition_id TEXT CHECK(
    hierarchy_root_definition_id IS NULL OR length(hierarchy_root_definition_id) BETWEEN 1 AND 128),
  hierarchy_direction TEXT CHECK(hierarchy_direction IN ('descendants','ancestors','both')),
  hierarchy_link_type TEXT CHECK(hierarchy_link_type IN (
    'parent_child','stage_subjourney','variant','handoff','related')),
  hierarchy_taxonomy_term_id TEXT CHECK(
    hierarchy_taxonomy_term_id IS NULL OR length(hierarchy_taxonomy_term_id) BETWEEN 1 AND 128),
  hierarchy_review_state TEXT CHECK(hierarchy_review_state IN (
    'draft','in_review','approved','changes_requested')),
  hierarchy_lifecycle TEXT CHECK(hierarchy_lifecycle IN ('active','retired','all')),

  -- Service-blueprint surface configuration.
  blueprint_id TEXT CHECK(blueprint_id IS NULL OR length(blueprint_id) BETWEEN 1 AND 128),
  blueprint_version_mode TEXT CHECK(blueprint_version_mode IN ('current','pinned')),
  blueprint_version_id TEXT CHECK(
    blueprint_version_id IS NULL OR length(blueprint_version_id) BETWEEN 1 AND 128),
  blueprint_tab TEXT CHECK(blueprint_tab IN (
    'overview','lanes','relationships','gaps','portfolio','measurements')),
  blueprint_lifecycle TEXT CHECK(blueprint_lifecycle IN (
    'draft','in_review','approved','retired','all')),

  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_surface_view_versions_tenant_identity UNIQUE(id,space_id),
  -- Backs journey_surface_view_definitions_current_version_fk below. A
  -- two-column unique key cannot back a three-column reference; without this the
  -- ALTER aborts the whole migration with SQLSTATE 42830 (runtime-27 and
  -- runtime-29 declare the same key for the same reason).
  CONSTRAINT journey_surface_view_versions_current_identity UNIQUE(id,view_id,space_id),
  CONSTRAINT journey_surface_view_versions_number UNIQUE(view_id,space_id,version_number),
  CONSTRAINT journey_surface_view_versions_request_once UNIQUE(view_id,space_id,request_sha256),
  CONSTRAINT journey_surface_view_versions_parent_fk FOREIGN KEY(view_id,space_id,surface)
    REFERENCES journey_surface_view_definitions(id,space_id,surface) ON DELETE CASCADE,
  -- Exactly one surface's columns are populated, and the other surface's columns
  -- are all NULL. Without the negative half a hierarchy view could carry a
  -- blueprint pin that no reader would ever apply.
  CONSTRAINT journey_surface_view_versions_surface_shape CHECK(
    (surface='hierarchy'
      AND hierarchy_direction IS NOT NULL AND hierarchy_lifecycle IS NOT NULL
      AND blueprint_id IS NULL AND blueprint_version_mode IS NULL AND blueprint_version_id IS NULL
      AND blueprint_tab IS NULL AND blueprint_lifecycle IS NULL)
    OR (surface='service_blueprint'
      AND blueprint_id IS NOT NULL AND blueprint_version_mode IS NOT NULL
      AND blueprint_tab IS NOT NULL AND blueprint_lifecycle IS NOT NULL
      AND hierarchy_root_definition_id IS NULL AND hierarchy_direction IS NULL
      AND hierarchy_link_type IS NULL AND hierarchy_taxonomy_term_id IS NULL
      AND hierarchy_review_state IS NULL AND hierarchy_lifecycle IS NULL)),
  -- A directed walk needs somewhere to start; 'both' is the whole-space view.
  CONSTRAINT journey_surface_view_versions_hierarchy_root_shape CHECK(
    hierarchy_direction IS NULL OR hierarchy_direction='both'
    OR hierarchy_root_definition_id IS NOT NULL),
  CONSTRAINT journey_surface_view_versions_blueprint_pin_shape CHECK(
    (blueprint_version_mode IS NULL AND blueprint_version_id IS NULL)
    OR (blueprint_version_mode='current' AND blueprint_version_id IS NULL)
    OR (blueprint_version_mode='pinned' AND blueprint_version_id IS NOT NULL)),
  -- The closed configuration surface, restated on the document itself. `jsonb -
  -- text[]` deletes the allowed keys; an empty remainder proves no other key was
  -- present. This is what forbids a saved view from ever carrying `sql`,
  -- `query`, `where` or any other interpretable string, at both levels.
  --
  -- CASE, not AND: PostgreSQL does not guarantee the evaluation order of the
  -- arms of an AND, and `jsonb - text[]` RAISES on a scalar instead of returning
  -- false. A typeof test written as a preceding conjunct would therefore not
  -- reliably protect the subtraction. CASE evaluation order IS guaranteed, so a
  -- non-object at any of these keys is rejected rather than erroring.
  CONSTRAINT journey_surface_view_versions_configuration_keys CHECK(
    CASE jsonb_typeof(configuration_json::jsonb) WHEN 'object' THEN
      (configuration_json::jsonb
        - ARRAY['schemaVersion','surface','hierarchy','blueprint','presentation']::text[]) = '{}'::jsonb
      AND CASE jsonb_typeof(configuration_json::jsonb->'hierarchy') WHEN 'object' THEN
        (configuration_json::jsonb->'hierarchy'
          - ARRAY['rootDefinitionId','direction','linkType','taxonomyTermId','reviewState','lifecycle']::text[])
          = '{}'::jsonb
        ELSE COALESCE(jsonb_typeof(configuration_json::jsonb->'hierarchy'),'null')='null' END
      AND CASE jsonb_typeof(configuration_json::jsonb->'blueprint') WHEN 'object' THEN
        (configuration_json::jsonb->'blueprint'
          - ARRAY['blueprintId','versionMode','versionId','tab','lifecycle']::text[]) = '{}'::jsonb
        ELSE COALESCE(jsonb_typeof(configuration_json::jsonb->'blueprint'),'null')='null' END
      AND CASE jsonb_typeof(configuration_json::jsonb->'presentation') WHEN 'object' THEN
        (configuration_json::jsonb->'presentation'
          - ARRAY['density','showRetired','showLegend']::text[]) = '{}'::jsonb
        ELSE COALESCE(jsonb_typeof(configuration_json::jsonb->'presentation'),'null')='null' END
      ELSE FALSE END),
  CONSTRAINT journey_surface_view_versions_configuration_identity CHECK(
    (configuration_json::jsonb->>'schemaVersion')='journey-surface-view/v1'
    AND (configuration_json::jsonb->>'surface')=surface)
);
ALTER TABLE journey_surface_view_definitions ADD CONSTRAINT journey_surface_view_definitions_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_surface_view_versions(id,view_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX journey_surface_view_versions_history
  ON journey_surface_view_versions(space_id,view_id,version_number DESC,id);
-- Reverse lookup: which saved views still point at a journey, a taxonomy term or
-- a blueprint. Nothing else leads with these columns, so a retirement or
-- deletion probe would otherwise scan every version in the tenant.
CREATE INDEX journey_surface_view_versions_hierarchy_target
  ON journey_surface_view_versions(space_id,hierarchy_root_definition_id,view_id)
  WHERE hierarchy_root_definition_id IS NOT NULL;
CREATE INDEX journey_surface_view_versions_blueprint_target
  ON journey_surface_view_versions(space_id,blueprint_id,view_id)
  WHERE blueprint_id IS NOT NULL;

CREATE TABLE journey_surface_view_defaults (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  view_id TEXT NOT NULL,
  -- A default pins the exact configuration version it selected, so a later
  -- revision by the owner cannot silently redefine another principal's default.
  view_version_id TEXT NOT NULL,
  view_definition_revision INTEGER NOT NULL CHECK(view_definition_revision>0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  -- One default per principal per surface. Reset is the deletion of this row.
  PRIMARY KEY(space_id,user_id,surface),
  CONSTRAINT journey_surface_view_defaults_membership_fk FOREIGN KEY(space_id,user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  -- Three columns: the default's surface is proven to be its view's surface.
  CONSTRAINT journey_surface_view_defaults_view_fk FOREIGN KEY(view_id,space_id,surface)
    REFERENCES journey_surface_view_definitions(id,space_id,surface) ON DELETE CASCADE,
  CONSTRAINT journey_surface_view_defaults_version_fk FOREIGN KEY(view_version_id,view_id,space_id)
    REFERENCES journey_surface_view_versions(id,view_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_surface_view_defaults_time_order CHECK(updated_at>=created_at)
);
-- "Which principals pinned this view" — the reverse of the primary key.
CREATE INDEX journey_surface_view_defaults_view
  ON journey_surface_view_defaults(space_id,view_id,user_id);

-- Content-safe by construction: there is no name, no configuration and no
-- free-text column here. A reader learns that a view changed, by whom, at which
-- revision and to which configuration hash, and nothing about what the view
-- says. Runtime-54 established the same shape for evidence observations.
CREATE TABLE journey_surface_view_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN (
    'view.created','view.revised','view.retired','view.reactivated',
    'default.selected','default.reset')),
  surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
  view_sha256 TEXT NOT NULL CHECK(view_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_sha256 TEXT CHECK(configuration_sha256 IS NULL OR configuration_sha256 ~ '^[a-f0-9]{64}$'),
  definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
  version_number INTEGER CHECK(version_number IS NULL OR version_number>0),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_surface_view_audit_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_surface_view_audit_history
  ON journey_surface_view_audit_events(space_id,surface,created_at DESC,id);
CREATE INDEX journey_surface_view_audit_subject
  ON journey_surface_view_audit_events(space_id,view_sha256,created_at DESC,id);

-- Identity, ownership and creation time are immutable; the revision advances by
-- exactly one on every governed update; the configuration version pointer never
-- moves backwards. UPDATE OF names only the governed columns, so the ON DELETE
-- SET NULL that fires when an attributed user is removed does not trip the
-- revision rule and cannot make user deletion fail.
CREATE OR REPLACE FUNCTION journey_surface_view_definition_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_surface_view_definition_guard$
BEGIN
  IF NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.surface<>OLD.surface
    OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Journey surface view identity and ownership are immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.definition_revision<>OLD.definition_revision+1 THEN
    RAISE EXCEPTION 'Journey surface view revision is stale' USING ERRCODE='40001';
  END IF;
  IF NEW.current_version_number<OLD.current_version_number THEN
    RAISE EXCEPTION 'Journey surface view configuration versions never move backwards' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$journey_surface_view_definition_guard$;
REVOKE ALL ON FUNCTION journey_surface_view_definition_guard() FROM PUBLIC;
CREATE TRIGGER journey_surface_view_definition_guard
BEFORE UPDATE OF space_id,surface,audience,name,normalized_name,owner_user_id,owner_private,
  lifecycle,current_version_id,current_version_number,definition_revision,retired_at
ON journey_surface_view_definitions
FOR EACH ROW EXECUTE FUNCTION journey_surface_view_definition_guard();

-- The optimistic-concurrency gate and the tenancy proof for every configuration
-- target. FOR UPDATE on the parent serialises concurrent revisions of one view:
-- the loser reads the winner's advanced revision and is refused with 40001
-- rather than appending a second version at the same number.
CREATE OR REPLACE FUNCTION journey_surface_view_version_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_surface_view_version_guard$
DECLARE parent_lifecycle TEXT; parent_revision INTEGER; appended_version_number INTEGER;
BEGIN
  SELECT lifecycle,definition_revision INTO parent_lifecycle,parent_revision
    FROM journey_surface_view_definitions
    WHERE id=NEW.view_id AND space_id=NEW.space_id AND surface=NEW.surface
    FOR UPDATE;
  IF parent_lifecycle IS NULL THEN
    RAISE EXCEPTION 'A journey surface view version requires a same-space view of the same surface'
      USING ERRCODE='23503';
  END IF;
  IF parent_lifecycle<>'active' THEN
    RAISE EXCEPTION 'A retired journey surface view cannot be revised' USING ERRCODE='55000';
  END IF;
  IF NEW.definition_revision<>parent_revision THEN
    RAISE EXCEPTION 'Journey surface view revision is stale' USING ERRCODE='40001';
  END IF;
  -- Counted from the version table, not from the parent's pointer: creation
  -- inserts the definition already pointing at its first version under the
  -- deferred foreign key, so at this moment the pointer is one AHEAD of what has
  -- been appended. The FOR UPDATE above serialises concurrent revisions of one
  -- view, and journey_surface_view_versions_number is the hard backstop.
  SELECT COALESCE(MAX(version_number),0)+1 INTO appended_version_number
    FROM journey_surface_view_versions WHERE view_id=NEW.view_id AND space_id=NEW.space_id;
  IF NEW.version_number<>appended_version_number THEN
    RAISE EXCEPTION 'Journey surface view configuration versions are gapless and monotone'
      USING ERRCODE='40001';
  END IF;
  IF NEW.hierarchy_root_definition_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_definitions
      WHERE id=NEW.hierarchy_root_definition_id AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Journey surface view hierarchy root is outside the tenant' USING ERRCODE='23503';
  END IF;
  IF NEW.hierarchy_taxonomy_term_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_taxonomy_terms
      WHERE id=NEW.hierarchy_taxonomy_term_id AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Journey surface view taxonomy filter is outside the tenant' USING ERRCODE='23503';
  END IF;
  IF NEW.blueprint_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprints WHERE id=NEW.blueprint_id AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Journey surface view blueprint is outside the tenant' USING ERRCODE='23503';
  END IF;
  -- Three columns, not one: a pinned version is proven to belong to the blueprint
  -- the same view names, so a pin cannot silently resolve against another
  -- blueprint's history.
  IF NEW.blueprint_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_versions
      WHERE id=NEW.blueprint_version_id AND space_id=NEW.space_id
        AND blueprint_id=NEW.blueprint_id) THEN
    RAISE EXCEPTION 'Journey surface view blueprint pin is outside its blueprint' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_surface_view_version_guard$;
REVOKE ALL ON FUNCTION journey_surface_view_version_guard() FROM PUBLIC;
CREATE TRIGGER journey_surface_view_version_guard
BEFORE INSERT ON journey_surface_view_versions
FOR EACH ROW EXECUTE FUNCTION journey_surface_view_version_guard();

-- Tenant deletion may cascade these rows away with their space. Runtime roles
-- will have no UPDATE or DELETE grant on either table; the trigger independently
-- prevents a configuration version or an audit receipt from being rewritten.
CREATE OR REPLACE FUNCTION journey_surface_view_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_surface_view_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey surface view configuration versions and audit are append-only'
    USING ERRCODE='55000';
END
$journey_surface_view_append_only_guard$;
REVOKE ALL ON FUNCTION journey_surface_view_append_only_guard() FROM PUBLIC;
CREATE TRIGGER journey_surface_view_versions_append_only
BEFORE UPDATE OR DELETE ON journey_surface_view_versions
FOR EACH ROW EXECUTE FUNCTION journey_surface_view_append_only_guard();
CREATE TRIGGER journey_surface_view_audit_append_only
BEFORE UPDATE OR DELETE ON journey_surface_view_audit_events
FOR EACH ROW EXECUTE FUNCTION journey_surface_view_append_only_guard();
