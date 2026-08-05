-- Runtime schema 29: durable journey hierarchy and governed service blueprints.
--
-- Hierarchy links reuse canonical journey definitions; service-blueprint
-- versions pin an exact journey-map version and keep operational causes,
-- ownership and improvement links inspectable without cloning journeys or
-- portfolio items.
--
-- Delete semantics: every "you may not orphan this" edge uses ON DELETE NO
-- ACTION rather than ON DELETE RESTRICT. Both refuse the same orphan, but
-- RESTRICT is checked inside the deleting statement while NO ACTION defers to
-- end-of-statement. journey_definitions is hard-deleted (journeyMaps.ts:1052,
-- journeyMaps.ts:2161) and cascades to journey_map_versions, which several
-- tables here reference; under RESTRICT the delete would succeed or fail
-- depending on referential-action firing order. NO ACTION lets the sibling
-- cascades land first and keeps journey deletion deterministic and replayable.

DO $journey_hierarchy_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>28 THEN
    RAISE EXCEPTION 'runtime-29 journey hierarchy/blueprints require runtime-28 collaboration'
      USING ERRCODE='55000';
  END IF;
END
$journey_hierarchy_predecessor$;

CREATE TABLE journey_hierarchy_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  hierarchy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  blueprints_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  maximum_depth INTEGER NOT NULL DEFAULT 12 CHECK(maximum_depth BETWEEN 1 AND 32),
  maximum_links INTEGER NOT NULL DEFAULT 2000 CHECK(maximum_links BETWEEN 1 AND 100000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_settings_time_order CHECK(updated_at>=created_at)
);

CREATE TABLE journey_taxonomy_terms (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('product','geography','channel','segment','tag','business_unit')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 160),
  parent_term_id TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_taxonomy_terms_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_taxonomy_terms_name_once UNIQUE(space_id,kind,normalized_name),
  CONSTRAINT journey_taxonomy_terms_parent_tenant_fk FOREIGN KEY(parent_term_id,space_id)
    REFERENCES journey_taxonomy_terms(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_taxonomy_terms_no_self CHECK(parent_term_id IS NULL OR parent_term_id<>id),
  CONSTRAINT journey_taxonomy_terms_time_order CHECK(updated_at>=created_at)
);
-- Backs the retire-with-active-children check in journey_taxonomy_parent_guard.
CREATE INDEX journey_taxonomy_terms_children
  ON journey_taxonomy_terms(space_id,parent_term_id,lifecycle,id);

CREATE TABLE journey_definition_taxonomy (
  space_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,definition_id,term_id),
  CONSTRAINT journey_definition_taxonomy_definition_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_definition_taxonomy_term_fk FOREIGN KEY(term_id,space_id)
    REFERENCES journey_taxonomy_terms(id,space_id) ON DELETE CASCADE
);
-- Term -> journeys is the reverse of the primary key and would otherwise scan.
CREATE INDEX journey_definition_taxonomy_reverse
  ON journey_definition_taxonomy(space_id,term_id,definition_id);

CREATE TABLE journey_hierarchy_links (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK(link_type IN ('parent_child','stage_subjourney','variant','handoff','related')),
  from_definition_id TEXT NOT NULL CHECK(length(from_definition_id) BETWEEN 1 AND 128),
  to_definition_id TEXT NOT NULL CHECK(length(to_definition_id) BETWEEN 1 AND 128),
  from_version_id TEXT CHECK(from_version_id IS NULL OR length(from_version_id) BETWEEN 1 AND 128),
  to_version_id TEXT CHECK(to_version_id IS NULL OR length(to_version_id) BETWEEN 1 AND 128),
  from_stage_key TEXT CHECK(from_stage_key IS NULL OR length(from_stage_key) BETWEEN 1 AND 80),
  to_stage_key TEXT CHECK(to_stage_key IS NULL OR length(to_stage_key) BETWEEN 1 AND 80),
  variant_dimension TEXT CHECK(variant_dimension IS NULL OR variant_dimension IN (
    'persona','segment','product','geography','channel')),
  variant_value_id TEXT CHECK(variant_value_id IS NULL OR length(variant_value_id) BETWEEN 1 AND 128),
  handoff_owner_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION
    CHECK(handoff_owner_user_id IS NULL OR length(handoff_owner_user_id) BETWEEN 1 AND 128),
  handoff_owner_team_id TEXT CHECK(handoff_owner_team_id IS NULL OR length(handoff_owner_team_id) BETWEEN 1 AND 128),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK(review_state IN ('draft','in_review','approved','changes_requested')),
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION,
  reviewed_at TIMESTAMPTZ,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_links_tenant_identity UNIQUE(id,space_id),
  -- Deliberately lifecycle-independent, matching the tested in-memory contract:
  -- journeyHierarchy.ts adds the logical key to `seenLinks` (line 489) BEFORE the
  -- `lifecycle !== 'active'` skip (line 491), so a retired + active duplicate pair
  -- is a JOURNEY_HIERARCHY_DUPLICATE_LINK there too. Narrowing this to a partial
  -- `WHERE lifecycle='active'` index would let PostgreSQL accept rows the domain
  -- rejects. A retired logical link is reused by reactivation (lifecycle ->
  -- 'active'), which journey_hierarchy_link_guard re-checks on UPDATE.
  -- NULLS NOT DISTINCT (PostgreSQL 15+; this repo targets 16) is required: under
  -- default NULLS-DISTINCT semantics two parent_child links between the same pair
  -- would not collide, because every optional key column is NULL for that shape.
  CONSTRAINT journey_hierarchy_links_logical_once UNIQUE NULLS NOT DISTINCT (
    space_id,link_type,from_definition_id,to_definition_id,from_stage_key,to_stage_key,
    variant_dimension,variant_value_id),
  CONSTRAINT journey_hierarchy_links_no_self CHECK(from_definition_id<>to_definition_id),
  -- Makes the logical-uniqueness btree width statically provable. The bounded
  -- columns sum to <=1024 bytes; adding link_type (<=16) and variant_dimension
  -- (<=10) keeps the key an order of magnitude below the 2704-byte btree limit,
  -- without relying on ids inheriting an unbounded TEXT primary key upstream.
  CONSTRAINT journey_hierarchy_links_index_width CHECK(
    octet_length(space_id)+octet_length(from_definition_id)+octet_length(to_definition_id)
    +COALESCE(octet_length(from_stage_key),0)+COALESCE(octet_length(to_stage_key),0)
    +COALESCE(octet_length(variant_value_id),0)<=1024),
  CONSTRAINT journey_hierarchy_links_from_definition_fk FOREIGN KEY(from_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_hierarchy_links_to_definition_fk FOREIGN KEY(to_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_hierarchy_links_from_version_fk FOREIGN KEY(from_version_id,from_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_hierarchy_links_to_version_fk FOREIGN KEY(to_version_id,to_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION,
  -- Handoff ownership and review attribution are durable facts about a moment in
  -- time; membership is current state. Binding them with a composite foreign key
  -- to space_memberships made spaces.ts removeSpaceMember fail with 23503 once a
  -- single link existed, and review_shape forbids nulling the reviewer, so no
  -- referential action could resolve it. Both columns now carry immutable
  -- users(id) ON DELETE NO ACTION attribution, and tenancy is asserted at write
  -- time by journey_hierarchy_membership_guard, which takes FOR SHARE on the
  -- membership row so a concurrent offboarding cannot race the check.
  CONSTRAINT journey_hierarchy_links_shape CHECK(
    (link_type='stage_subjourney' AND from_stage_key IS NOT NULL AND to_stage_key IS NULL
      AND variant_dimension IS NULL AND variant_value_id IS NULL)
    OR (link_type='handoff' AND from_stage_key IS NOT NULL AND to_stage_key IS NOT NULL
      AND variant_dimension IS NULL AND variant_value_id IS NULL)
    OR (link_type='variant' AND from_stage_key IS NULL AND to_stage_key IS NULL
      AND variant_dimension IS NOT NULL AND variant_value_id IS NOT NULL)
    OR (link_type IN ('parent_child','related') AND from_stage_key IS NULL AND to_stage_key IS NULL
      AND variant_dimension IS NULL AND variant_value_id IS NULL)),
  -- A reviewed link names who reviewed it and when; a draft link names neither.
  CONSTRAINT journey_hierarchy_links_review_shape CHECK(
    (review_state='draft' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (review_state<>'draft' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT journey_hierarchy_links_review_time CHECK(reviewed_at IS NULL OR reviewed_at>=created_at),
  CONSTRAINT journey_hierarchy_links_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_hierarchy_links_from
  ON journey_hierarchy_links(space_id,from_definition_id,lifecycle,link_type,to_definition_id);
CREATE INDEX journey_hierarchy_links_to
  ON journey_hierarchy_links(space_id,to_definition_id,lifecycle,link_type,from_definition_id);
-- Backs the per-space active-link budget counted on every write by the guard;
-- neither index above leads with (space_id,lifecycle).
CREATE INDEX journey_hierarchy_links_lifecycle
  ON journey_hierarchy_links(space_id,lifecycle,id);

CREATE OR REPLACE FUNCTION journey_taxonomy_parent_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_taxonomy_parent_guard$
BEGIN
  -- Runs before the parent short-circuit: retiring or re-kinding a ROOT term is
  -- exactly the case that orphans children under an invalid parent, and an early
  -- `parent_term_id IS NULL` return would skip it entirely.
  IF TG_OP='UPDATE' AND (NEW.lifecycle<>OLD.lifecycle OR NEW.kind<>OLD.kind) AND EXISTS (
      SELECT 1 FROM journey_taxonomy_terms child
        WHERE child.parent_term_id=NEW.id AND child.space_id=NEW.space_id
          AND child.lifecycle='active' AND child.id<>NEW.id) THEN
    IF NEW.lifecycle='retired' AND OLD.lifecycle='active' THEN
      RAISE EXCEPTION 'Retire the child terms before retiring their taxonomy parent' USING ERRCODE='23514';
    END IF;
    IF NEW.kind<>OLD.kind THEN
      RAISE EXCEPTION 'A taxonomy term with active children cannot change kind' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.parent_term_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM journey_taxonomy_terms
      WHERE id=NEW.parent_term_id AND space_id=NEW.space_id AND kind=NEW.kind AND lifecycle='active') THEN
    RAISE EXCEPTION 'Taxonomy parents must be active same-space terms of the same kind' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT parent_term_id FROM journey_taxonomy_terms
        WHERE id=NEW.parent_term_id AND space_id=NEW.space_id
      UNION
      SELECT term.parent_term_id FROM journey_taxonomy_terms term
        JOIN ancestors ON ancestors.id=term.id
        WHERE term.space_id=NEW.space_id AND term.parent_term_id IS NOT NULL)
    SELECT 1 FROM ancestors WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'Taxonomy parent would create a cycle' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_taxonomy_parent_guard$;
CREATE TRIGGER journey_taxonomy_parent_guard
BEFORE INSERT OR UPDATE OF space_id,kind,parent_term_id,lifecycle ON journey_taxonomy_terms
FOR EACH ROW EXECUTE FUNCTION journey_taxonomy_parent_guard();

-- Without this, a retired term stays freely assignable to journeys: the composite
-- foreign key proves tenancy but says nothing about lifecycle.
CREATE OR REPLACE FUNCTION journey_definition_taxonomy_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_definition_taxonomy_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journey_taxonomy_terms
      WHERE id=NEW.term_id AND space_id=NEW.space_id AND lifecycle='active') THEN
    RAISE EXCEPTION 'Journey taxonomy assignments require an active same-space term' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_definition_taxonomy_guard$;
CREATE TRIGGER journey_definition_taxonomy_guard
BEFORE INSERT OR UPDATE OF space_id,term_id ON journey_definition_taxonomy
FOR EACH ROW EXECUTE FUNCTION journey_definition_taxonomy_guard();

CREATE OR REPLACE FUNCTION journey_hierarchy_link_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_hierarchy_link_guard$
DECLARE maximum_depth INTEGER; maximum_links INTEGER; hierarchy_is_enabled BOOLEAN;
        link_count BIGINT; discovered_depth INTEGER;
BEGIN
  SELECT COALESCE(settings.maximum_depth,12),COALESCE(settings.maximum_links,2000),
         COALESCE(settings.hierarchy_enabled,TRUE)
    INTO maximum_depth,maximum_links,hierarchy_is_enabled
    FROM (SELECT NEW.space_id AS space_id) input
    LEFT JOIN journey_hierarchy_settings settings ON settings.space_id=input.space_id;
  -- Gated on the new row being active so a space can always be wound down:
  -- retiring links stays possible after the kill switch is thrown.
  IF NEW.lifecycle='active' AND NOT hierarchy_is_enabled THEN
    RAISE EXCEPTION 'Journey hierarchy linking is disabled for this space' USING ERRCODE='55000';
  END IF;
  SELECT COUNT(*) INTO link_count FROM journey_hierarchy_links
    WHERE space_id=NEW.space_id AND lifecycle='active' AND id<>NEW.id;
  IF NEW.lifecycle='active' AND link_count>=maximum_links THEN
    RAISE EXCEPTION 'Journey hierarchy exceeds its configured link limit' USING ERRCODE='23514';
  END IF;
  -- variant_value_id is otherwise free text: the shape CHECK proves it is present
  -- for a variant link but nothing proves it names a row in THIS tenant. persona
  -- resolves to journey_personas; the other four dimensions are taxonomy kinds.
  IF NEW.variant_value_id IS NOT NULL THEN
    IF NEW.variant_dimension='persona' THEN
      IF NOT EXISTS (SELECT 1 FROM journey_personas persona
          WHERE persona.id=NEW.variant_value_id AND persona.space_id=NEW.space_id
            AND (NEW.lifecycle<>'active' OR persona.lifecycle_state<>'retired')) THEN
        RAISE EXCEPTION 'Journey variant persona must be a live same-space persona' USING ERRCODE='23503';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM journey_taxonomy_terms term
        WHERE term.id=NEW.variant_value_id AND term.space_id=NEW.space_id
          AND term.kind=NEW.variant_dimension
          AND (NEW.lifecycle<>'active' OR term.lifecycle='active')) THEN
      RAISE EXCEPTION 'Journey variant value must be a same-space taxonomy term of its dimension' USING ERRCODE='23503';
    END IF;
  END IF;
  IF NEW.from_stage_key IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_definitions definition
      JOIN journey_map_stages stage
        ON stage.version_id=COALESCE(NEW.from_version_id,definition.current_version_id)
       AND stage.space_id=definition.space_id
      WHERE definition.id=NEW.from_definition_id AND definition.space_id=NEW.space_id
        AND stage.stage_key=NEW.from_stage_key) THEN
    RAISE EXCEPTION 'Hierarchy source stage is not part of the same-space source journey' USING ERRCODE='23503';
  END IF;
  IF NEW.to_stage_key IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_definitions definition
      JOIN journey_map_stages stage
        ON stage.version_id=COALESCE(NEW.to_version_id,definition.current_version_id)
       AND stage.space_id=definition.space_id
      WHERE definition.id=NEW.to_definition_id AND definition.space_id=NEW.space_id
        AND stage.stage_key=NEW.to_stage_key) THEN
    RAISE EXCEPTION 'Hierarchy destination stage is not part of the same-space destination journey' USING ERRCODE='23503';
  END IF;
  IF NEW.lifecycle='active' AND NEW.link_type IN ('parent_child','stage_subjourney') THEN
    IF EXISTS (
      WITH RECURSIVE descendants(id) AS (
        SELECT to_definition_id FROM journey_hierarchy_links
          WHERE space_id=NEW.space_id AND lifecycle='active'
            AND link_type IN ('parent_child','stage_subjourney')
            AND from_definition_id=NEW.to_definition_id AND id<>NEW.id
        UNION
        SELECT link.to_definition_id FROM journey_hierarchy_links link
          JOIN descendants ON descendants.id=link.from_definition_id
          WHERE link.space_id=NEW.space_id AND link.lifecycle='active'
            AND link.link_type IN ('parent_child','stage_subjourney') AND link.id<>NEW.id)
      SELECT 1 FROM descendants WHERE id=NEW.from_definition_id) THEN
      RAISE EXCEPTION 'Journey containment link would create a cycle' USING ERRCODE='23514';
    END IF;
    -- UNION, not UNION ALL: UNION ALL enumerates PATHS, so a diamond-shaped
    -- containment DAG at the depth ceiling costs exponential work on every write.
    -- Deduplicating (id,depth) bounds the walk at nodes x depth and still finds
    -- the longest chain. The two maxima are read as scalar subqueries; the former
    -- `FROM ancestors CROSS JOIN descendants` materialised |A|x|D| rows to read
    -- two numbers.
    WITH RECURSIVE ancestors(id,depth) AS (
      SELECT NEW.from_definition_id,0
      UNION
      SELECT link.from_definition_id,ancestors.depth+1 FROM journey_hierarchy_links link
        JOIN ancestors ON ancestors.id=link.to_definition_id
        WHERE link.space_id=NEW.space_id AND link.lifecycle='active'
          AND link.link_type IN ('parent_child','stage_subjourney') AND link.id<>NEW.id
          AND ancestors.depth<maximum_depth+1),
    descendants(id,depth) AS (
      SELECT NEW.to_definition_id,0
      UNION
      SELECT link.to_definition_id,descendants.depth+1 FROM journey_hierarchy_links link
        JOIN descendants ON descendants.id=link.from_definition_id
        WHERE link.space_id=NEW.space_id AND link.lifecycle='active'
          AND link.link_type IN ('parent_child','stage_subjourney') AND link.id<>NEW.id
          AND descendants.depth<maximum_depth+1)
    SELECT (SELECT COALESCE(MAX(depth),0) FROM ancestors)
         + 1
         + (SELECT COALESCE(MAX(depth),0) FROM descendants)
      INTO discovered_depth;
    IF discovered_depth>maximum_depth THEN
      RAISE EXCEPTION 'Journey containment link exceeds configured hierarchy depth' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$journey_hierarchy_link_guard$;
-- UPDATE OF the columns the guard actually reads: bumping updated_by_user_id or
-- revision must not re-run the recursive cycle and depth walks.
CREATE TRIGGER journey_hierarchy_link_guard
BEFORE INSERT OR UPDATE OF space_id,link_type,from_definition_id,to_definition_id,
  from_version_id,to_version_id,from_stage_key,to_stage_key,
  variant_dimension,variant_value_id,lifecycle ON journey_hierarchy_links
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_link_guard();

CREATE TABLE journey_hierarchy_health_policies (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','active','retired')),
  configuration_json TEXT NOT NULL CHECK(
    octet_length(configuration_json) BETWEEN 2 AND 32768 AND jsonb_typeof(configuration_json::jsonb)='object'),
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_health_policies_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_hierarchy_health_policies_time_order CHECK(updated_at>=created_at)
);

CREATE TABLE journey_hierarchy_health_snapshots (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL CHECK(length(definition_id) BETWEEN 1 AND 128),
  policy_id TEXT NOT NULL,
  -- Health policies are edited in place (journey_hierarchy_health_policies.revision
  -- advances on the same row), so a snapshot that stored only policy_id would
  -- silently re-point at re-tuned thresholds and could not reproduce its own
  -- status. Pinning the revision AND the configuration hash makes a historical
  -- roll-up self-verifying: replay can detect a policy edit instead of inheriting it.
  policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 128),
  policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
  policy_configuration_sha256 TEXT NOT NULL CHECK(policy_configuration_sha256 ~ '^[a-f0-9]{64}$'),
  definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
  -- A NULL score is the SOLE representation of 'unknown'. journeyHierarchy.ts
  -- healthStatus() returns 'unknown' if and only if score is null (line 552), and
  -- rollUpJourneyHierarchyHealth deliberately never coerces a missing value to
  -- zero (line 670). The previous `NUMERIC NOT NULL` made every unknown roll-up
  -- unpersistable; nullability alone would have allowed the mirror-image lie
  -- (status='healthy' with no score), so the shape CHECK below is bidirectional.
  score NUMERIC CHECK(score IS NULL OR score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK(status IN ('healthy','watch','at_risk','unknown')),
  -- The domain returns an explanation naming the branch that produced the score;
  -- without a column the transparent-rules acceptance scenario cannot be met.
  explanation TEXT NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),
  components_json TEXT NOT NULL CHECK(
    octet_length(components_json)<=65536 AND jsonb_typeof(components_json::jsonb)='array'),
  child_lineage_json TEXT NOT NULL CHECK(
    octet_length(child_lineage_json)<=131072 AND jsonb_typeof(child_lineage_json::jsonb)='array'),
  calculated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_health_snapshots_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_hierarchy_health_snapshots_status_shape CHECK(
    (status='unknown' AND score IS NULL) OR (status<>'unknown' AND score IS NOT NULL)),
  CONSTRAINT journey_hierarchy_health_snapshots_definition_fk FOREIGN KEY(definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_hierarchy_health_snapshots_policy_fk FOREIGN KEY(policy_id,space_id)
    REFERENCES journey_hierarchy_health_policies(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_hierarchy_health_history
  ON journey_hierarchy_health_snapshots(space_id,definition_id,calculated_at DESC,id);
-- Retention sweeps read oldest-first across every space; the history index above
-- leads with space_id and cannot serve them.
CREATE INDEX journey_hierarchy_health_retention
  ON journey_hierarchy_health_snapshots(calculated_at,id);

CREATE TABLE journey_blueprint_resources (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('team','actor','system','vendor','policy','control')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=5000),
  owner_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_blueprint_resources_tenant_identity UNIQUE(id,space_id),
  -- Owner attribution is durable; membership is current (see the note on
  -- journey_hierarchy_links). Tenancy is asserted by
  -- journey_hierarchy_membership_guard at write time.
  CONSTRAINT journey_blueprint_resources_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_blueprint_resources_query
  ON journey_blueprint_resources(space_id,kind,lifecycle,name,id);

CREATE TABLE journey_blueprints (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL CHECK(length(journey_definition_id) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','in_review','approved','retired')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION,
  owner_team_id TEXT CHECK(owner_team_id IS NULL OR length(owner_team_id) BETWEEN 1 AND 128),
  current_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_blueprints_tenant_identity UNIQUE(id,space_id),
  -- Backs the three-column parent foreign key below, so a version can never pin a
  -- journey its own blueprint does not own.
  CONSTRAINT journey_blueprints_journey_identity UNIQUE(id,space_id,journey_definition_id),
  CONSTRAINT journey_blueprints_definition_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  -- Owner attribution is durable; membership is current (see the note on
  -- journey_hierarchy_links). Tenancy is asserted by
  -- journey_hierarchy_membership_guard at write time.
  CONSTRAINT journey_blueprints_time_order CHECK(updated_at>=created_at)
);
CREATE INDEX journey_blueprints_definition
  ON journey_blueprints(space_id,journey_definition_id,lifecycle,updated_at DESC,id);

CREATE TABLE journey_blueprint_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  blueprint_id TEXT NOT NULL CHECK(length(blueprint_id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL,
  journey_definition_id TEXT NOT NULL CHECK(length(journey_definition_id) BETWEEN 1 AND 128),
  journey_version_id TEXT NOT NULL CHECK(length(journey_version_id) BETWEEN 1 AND 128),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  blueprint_state TEXT NOT NULL CHECK(blueprint_state IN ('current','future')),
  review_state TEXT NOT NULL CHECK(review_state IN ('draft','in_review','approved','changes_requested')),
  schema_version TEXT NOT NULL CHECK(schema_version='journey-service-blueprint/v1'),
  snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  change_reason TEXT CHECK(change_reason IS NULL OR length(change_reason)<=1000),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  CONSTRAINT journey_blueprint_versions_tenant_identity UNIQUE(id,space_id),
  -- Backs journey_blueprints_current_version_fk below. Without it that ALTER
  -- aborts the entire migration with SQLSTATE 42830 ("no unique constraint
  -- matching given keys"), because a two-column unique key cannot back a
  -- three-column reference. 0027 declares the same key for the same reason
  -- (journey_portfolio_scoring_policy_versions_current_identity).
  CONSTRAINT journey_blueprint_versions_current_identity UNIQUE(id,blueprint_id,space_id),
  -- Backs the comparison endpoints, which must share one journey definition.
  CONSTRAINT journey_blueprint_versions_journey_identity UNIQUE(id,space_id,journey_definition_id),
  CONSTRAINT journey_blueprint_versions_number UNIQUE(blueprint_id,space_id,version_number),
  -- Three columns, not two: the version's journey is proven to be its blueprint's
  -- journey. Under the previous (blueprint_id,space_id) parent key plus an
  -- independent definition key, version v of blueprint B could claim journey X
  -- while B claimed journey Y, silently invalidating compareServiceBlueprints.
  CONSTRAINT journey_blueprint_versions_parent_fk
    FOREIGN KEY(blueprint_id,space_id,journey_definition_id)
    REFERENCES journey_blueprints(id,space_id,journey_definition_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_versions_definition_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_versions_map_version_fk
    FOREIGN KEY(journey_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_versions_approval_shape CHECK(
    (review_state='approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    OR (review_state<>'approved' AND approved_by_user_id IS NULL AND approved_at IS NULL)),
  CONSTRAINT journey_blueprint_versions_approval_time CHECK(approved_at IS NULL OR approved_at>=created_at)
);
ALTER TABLE journey_blueprints ADD CONSTRAINT journey_blueprints_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_blueprint_versions(id,blueprint_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX journey_blueprint_versions_history
  ON journey_blueprint_versions(space_id,blueprint_id,version_number DESC,id);
CREATE INDEX journey_blueprint_versions_state
  ON journey_blueprint_versions(space_id,journey_definition_id,blueprint_state,review_state,version_number DESC,id);

-- BEFORE INSERT only: every UPDATE is already refused by the append-only guard,
-- so the two triggers never contend and the enforcement order is unambiguous.
CREATE OR REPLACE FUNCTION journey_blueprint_versions_settings_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_blueprint_versions_settings_guard$
DECLARE blueprints_allowed BOOLEAN;
BEGIN
  SELECT COALESCE(settings.blueprints_enabled,TRUE) INTO blueprints_allowed
    FROM (SELECT NEW.space_id AS space_id) input
    LEFT JOIN journey_hierarchy_settings settings ON settings.space_id=input.space_id;
  IF NOT blueprints_allowed THEN
    RAISE EXCEPTION 'Service blueprints are disabled for this space' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$journey_blueprint_versions_settings_guard$;
CREATE TRIGGER journey_blueprint_versions_settings_guard
BEFORE INSERT ON journey_blueprint_versions
FOR EACH ROW EXECUTE FUNCTION journey_blueprint_versions_settings_guard();

CREATE TABLE journey_blueprint_stages (
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  stage_key TEXT NOT NULL CHECK(length(stage_key) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  PRIMARY KEY(version_id,stage_key),
  CONSTRAINT journey_blueprint_stages_ordinal_once UNIQUE(version_id,ordinal),
  CONSTRAINT journey_blueprint_stages_version_fk FOREIGN KEY(version_id,space_id)
    REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE
);

CREATE TABLE journey_blueprint_elements (
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  lane TEXT NOT NULL CHECK(lane IN ('customer','frontstage','backstage','supporting_system','policy_control')),
  kind TEXT NOT NULL CHECK(kind IN ('action','touchpoint','process','system','policy','control','handoff','failure_point')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=10000),
  owner_team_resource_id TEXT,
  actor_resource_id TEXT,
  system_resource_id TEXT,
  vendor_resource_id TEXT,
  control_resource_id TEXT,
  sla_minutes NUMERIC CHECK(sla_minutes IS NULL OR sla_minutes>0),
  unit_cost NUMERIC CHECK(unit_cost IS NULL OR unit_cost>=0),
  risk_probability NUMERIC CHECK(risk_probability IS NULL OR risk_probability BETWEEN 0 AND 1),
  risk_impact NUMERIC CHECK(risk_impact IS NULL OR risk_impact BETWEEN 0 AND 1),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(evidence_refs_json)<=65536 AND jsonb_typeof(evidence_refs_json::jsonb)='array'),
  metric_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(metric_refs_json)<=65536 AND jsonb_typeof(metric_refs_json::jsonb)='array'),
  PRIMARY KEY(version_id,id),
  CONSTRAINT journey_blueprint_elements_tenant_identity UNIQUE(id,version_id,space_id),
  CONSTRAINT journey_blueprint_elements_position_once UNIQUE(version_id,stage_key,lane,ordinal),
  CONSTRAINT journey_blueprint_elements_stage_fk FOREIGN KEY(version_id,stage_key)
    REFERENCES journey_blueprint_stages(version_id,stage_key) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_elements_version_fk FOREIGN KEY(version_id,space_id)
    REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_elements_owner_team_fk FOREIGN KEY(owner_team_resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_elements_actor_fk FOREIGN KEY(actor_resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_elements_system_fk FOREIGN KEY(system_resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_elements_vendor_fk FOREIGN KEY(vendor_resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_elements_control_fk FOREIGN KEY(control_resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_blueprint_elements_risk_shape CHECK(
    (risk_probability IS NULL AND risk_impact IS NULL)
    OR (risk_probability IS NOT NULL AND risk_impact IS NOT NULL))
);

CREATE OR REPLACE FUNCTION journey_blueprint_element_resource_kind_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_blueprint_element_resource_kind_guard$
BEGIN
  IF NEW.owner_team_resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_resources WHERE id=NEW.owner_team_resource_id
        AND space_id=NEW.space_id AND kind='team' AND lifecycle='active') THEN
    RAISE EXCEPTION 'Blueprint owner team must reference an active team resource' USING ERRCODE='23514';
  END IF;
  IF NEW.actor_resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_resources WHERE id=NEW.actor_resource_id
        AND space_id=NEW.space_id AND kind='actor' AND lifecycle='active') THEN
    RAISE EXCEPTION 'Blueprint actor must reference an active actor resource' USING ERRCODE='23514';
  END IF;
  IF NEW.system_resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_resources WHERE id=NEW.system_resource_id
        AND space_id=NEW.space_id AND kind='system' AND lifecycle='active') THEN
    RAISE EXCEPTION 'Blueprint system must reference an active system resource' USING ERRCODE='23514';
  END IF;
  IF NEW.vendor_resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_resources WHERE id=NEW.vendor_resource_id
        AND space_id=NEW.space_id AND kind='vendor' AND lifecycle='active') THEN
    RAISE EXCEPTION 'Blueprint vendor must reference an active vendor resource' USING ERRCODE='23514';
  END IF;
  IF NEW.control_resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journey_blueprint_resources WHERE id=NEW.control_resource_id
        AND space_id=NEW.space_id AND kind='control' AND lifecycle='active') THEN
    RAISE EXCEPTION 'Blueprint control must reference an active control resource' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_blueprint_element_resource_kind_guard$;
CREATE TRIGGER journey_blueprint_element_resource_kind_guard
BEFORE INSERT OR UPDATE OF space_id,owner_team_resource_id,actor_resource_id,
  system_resource_id,vendor_resource_id,control_resource_id ON journey_blueprint_elements
FOR EACH ROW EXECUTE FUNCTION journey_blueprint_element_resource_kind_guard();

CREATE TABLE journey_blueprint_element_resources (
  version_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner_team','actor','system','vendor','policy','control')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(version_id,element_id,resource_id,role),
  CONSTRAINT journey_blueprint_element_resources_element_fk FOREIGN KEY(element_id,version_id,space_id)
    REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_element_resources_resource_fk FOREIGN KEY(resource_id,space_id)
    REFERENCES journey_blueprint_resources(id,space_id) ON DELETE NO ACTION
);
-- Resource -> elements is the reverse of the primary key; every resource retire
-- or delete check would otherwise scan the whole table.
CREATE INDEX journey_blueprint_element_resources_reverse
  ON journey_blueprint_element_resources(space_id,resource_id,role,version_id,element_id);

CREATE OR REPLACE FUNCTION journey_blueprint_element_resource_role_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_blueprint_element_resource_role_guard$
DECLARE actual_kind TEXT;
BEGIN
  SELECT kind INTO actual_kind FROM journey_blueprint_resources
    WHERE id=NEW.resource_id AND space_id=NEW.space_id AND lifecycle='active';
  IF actual_kind IS NULL OR actual_kind<>(CASE NEW.role
      WHEN 'owner_team' THEN 'team' ELSE NEW.role END) THEN
    RAISE EXCEPTION 'Blueprint element-resource role does not match the active resource kind' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_blueprint_element_resource_role_guard$;
CREATE TRIGGER journey_blueprint_element_resource_role_guard
BEFORE INSERT OR UPDATE OF space_id,resource_id,role ON journey_blueprint_element_resources
FOR EACH ROW EXECUTE FUNCTION journey_blueprint_element_resource_role_guard();

CREATE TABLE journey_blueprint_relationships (
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  version_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('supports','depends_on','handoff_to','causes','mitigates','governed_by')),
  from_element_id TEXT NOT NULL,
  to_element_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK(length(label)<=500),
  PRIMARY KEY(version_id,id),
  CONSTRAINT journey_blueprint_relationships_tenant_identity UNIQUE(id,version_id,space_id),
  CONSTRAINT journey_blueprint_relationships_edge_once UNIQUE(version_id,kind,from_element_id,to_element_id),
  CONSTRAINT journey_blueprint_relationships_no_self CHECK(from_element_id<>to_element_id),
  CONSTRAINT journey_blueprint_relationships_from_fk FOREIGN KEY(from_element_id,version_id,space_id)
    REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_relationships_to_fk FOREIGN KEY(to_element_id,version_id,space_id)
    REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE
);
-- Reverse traversal (which elements feed this one) has no leading-column index.
CREATE INDEX journey_blueprint_relationships_incoming
  ON journey_blueprint_relationships(version_id,to_element_id,kind,from_element_id);

CREATE TABLE journey_blueprint_portfolio_links (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  blueprint_version_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  portfolio_item_id TEXT NOT NULL,
  portfolio_item_revision INTEGER NOT NULL CHECK(portfolio_item_revision>0),
  relationship TEXT NOT NULL CHECK(relationship IN ('causes','affected_by','mitigated_by','improved_by')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  -- The only id-keyed tenant table in runtime-29 that previously lacked this.
  CONSTRAINT journey_blueprint_portfolio_links_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_blueprint_portfolio_links_once UNIQUE(
    space_id,blueprint_version_id,element_id,portfolio_item_id,relationship),
  CONSTRAINT journey_blueprint_portfolio_links_element_fk
    FOREIGN KEY(element_id,blueprint_version_id,space_id)
    REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_portfolio_links_item_version_fk
    FOREIGN KEY(portfolio_item_id,space_id,portfolio_item_revision)
    REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE NO ACTION
);
CREATE INDEX journey_blueprint_portfolio_links_reverse
  ON journey_blueprint_portfolio_links(space_id,portfolio_item_id,relationship,blueprint_version_id,element_id);

-- Typed causality: the enum CHECK on `relationship` proves the value is one of
-- the four, but nothing proved it accepts the linked item's KIND. The domain's
-- portfolioRelationshipTargets map (journeyServiceBlueprint.ts:369-374) and the
-- customer-lane cause ban (journeyServiceBlueprint.ts:993) are restated here so
-- `mitigated_by a pain_point` cannot persist behind the analyser's back.
CREATE OR REPLACE FUNCTION journey_blueprint_portfolio_link_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_blueprint_portfolio_link_guard$
DECLARE item_kind TEXT; element_lane TEXT;
BEGIN
  SELECT kind INTO item_kind FROM journey_portfolio_items
    WHERE id=NEW.portfolio_item_id AND space_id=NEW.space_id AND state='active';
  IF item_kind IS NULL THEN
    RAISE EXCEPTION 'Blueprint portfolio links require a live same-space portfolio item' USING ERRCODE='23503';
  END IF;
  IF NOT ((NEW.relationship='causes' AND item_kind='pain_point')
      OR (NEW.relationship='affected_by' AND item_kind IN ('pain_point','opportunity'))
      OR (NEW.relationship IN ('mitigated_by','improved_by') AND item_kind IN ('solution','initiative'))) THEN
    RAISE EXCEPTION 'Blueprint portfolio relationship does not accept this portfolio item kind' USING ERRCODE='23514';
  END IF;
  SELECT lane INTO element_lane FROM journey_blueprint_elements
    WHERE id=NEW.element_id AND version_id=NEW.blueprint_version_id AND space_id=NEW.space_id;
  IF NEW.relationship='causes' AND element_lane='customer' THEN
    RAISE EXCEPTION 'A customer-lane element cannot be the declared cause of a pain point' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_blueprint_portfolio_link_guard$;
CREATE TRIGGER journey_blueprint_portfolio_link_guard
BEFORE INSERT OR UPDATE OF space_id,blueprint_version_id,element_id,portfolio_item_id,relationship
  ON journey_blueprint_portfolio_links
FOR EACH ROW EXECUTE FUNCTION journey_blueprint_portfolio_link_guard();

CREATE TABLE journey_blueprint_gap_assessments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  blueprint_version_id TEXT NOT NULL,
  gap_type TEXT NOT NULL CHECK(gap_type IN (
    'owner_missing','handoff_missing','support_missing','control_missing','sla_missing','failure_unmitigated')),
  target_element_id TEXT,
  -- The domain's handoff_missing gap is relationship-anchored, not element-
  -- anchored (journeyServiceBlueprint.ts:846 emits it with relationshipId), so an
  -- element-only target column made that gap type unrecordable.
  target_relationship_id TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  state TEXT NOT NULL CHECK(state IN ('open','accepted','resolved','dismissed')),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
  detail_json TEXT NOT NULL CHECK(octet_length(detail_json)<=16384 AND jsonb_typeof(detail_json::jsonb)='object'),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_blueprint_gap_assessments_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_blueprint_gap_assessments_target_shape CHECK(
    target_element_id IS NULL OR target_relationship_id IS NULL),
  CONSTRAINT journey_blueprint_gap_assessments_version_fk FOREIGN KEY(blueprint_version_id,space_id)
    REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_gap_assessments_element_fk
    FOREIGN KEY(target_element_id,blueprint_version_id,space_id)
    REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_gap_assessments_relationship_fk
    FOREIGN KEY(target_relationship_id,blueprint_version_id,space_id)
    REFERENCES journey_blueprint_relationships(id,version_id,space_id) ON DELETE CASCADE,
  -- Reviewer attribution is durable and review_shape forbids nulling it (see the
  -- note on journey_hierarchy_links). Tenancy is asserted by
  -- journey_hierarchy_membership_guard at write time.
  CONSTRAINT journey_blueprint_gap_assessments_review_shape CHECK(
    (state='open' AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
    OR (state<>'open' AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX journey_blueprint_gap_assessments_open
  ON journey_blueprint_gap_assessments(space_id,blueprint_version_id,state,severity,gap_type,id);
-- Re-running an analysis must refresh, not duplicate, an open gap. NULLS NOT
-- DISTINCT is required because exactly one of the two target columns is NULL.
CREATE UNIQUE INDEX journey_blueprint_gap_assessments_open_once
  ON journey_blueprint_gap_assessments(blueprint_version_id,gap_type,target_element_id,target_relationship_id)
  NULLS NOT DISTINCT WHERE state='open';

CREATE TABLE journey_blueprint_comparisons (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  journey_definition_id TEXT NOT NULL CHECK(length(journey_definition_id) BETWEEN 1 AND 128),
  from_version_id TEXT NOT NULL,
  to_version_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(octet_length(result_json)<=262144 AND jsonb_typeof(result_json::jsonb)='object'),
  result_sha256 TEXT NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_blueprint_comparisons_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_blueprint_comparisons_pair_once UNIQUE(space_id,from_version_id,to_version_id,result_sha256),
  CONSTRAINT journey_blueprint_comparisons_not_self CHECK(from_version_id<>to_version_id),
  -- Three-column endpoints pin both sides to one space AND one journey definition,
  -- matching compareServiceBlueprints' cross-space and cross-journey rejections
  -- (journeyServiceBlueprint.ts:1115). CASCADE, not NO ACTION: a stored diff of a
  -- deleted version is meaningless and must not pin the journey alive forever.
  CONSTRAINT journey_blueprint_comparisons_from_fk
    FOREIGN KEY(from_version_id,space_id,journey_definition_id)
    REFERENCES journey_blueprint_versions(id,space_id,journey_definition_id) ON DELETE CASCADE,
  CONSTRAINT journey_blueprint_comparisons_to_fk
    FOREIGN KEY(to_version_id,space_id,journey_definition_id)
    REFERENCES journey_blueprint_versions(id,space_id,journey_definition_id) ON DELETE CASCADE
);
CREATE INDEX journey_blueprint_comparisons_journey
  ON journey_blueprint_comparisons(space_id,journey_definition_id,created_at DESC,id);
CREATE INDEX journey_blueprint_comparisons_retention
  ON journey_blueprint_comparisons(created_at,id);

-- The remaining half of the comparison contract: current -> future. Declarative
-- constraints cannot read the endpoints' blueprint_state, so a trigger does.
CREATE OR REPLACE FUNCTION journey_blueprint_comparison_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_blueprint_comparison_guard$
DECLARE from_state TEXT; to_state TEXT;
BEGIN
  SELECT blueprint_state INTO from_state FROM journey_blueprint_versions
    WHERE id=NEW.from_version_id AND space_id=NEW.space_id;
  SELECT blueprint_state INTO to_state FROM journey_blueprint_versions
    WHERE id=NEW.to_version_id AND space_id=NEW.space_id;
  IF from_state IS DISTINCT FROM 'current' OR to_state IS DISTINCT FROM 'future' THEN
    RAISE EXCEPTION 'Blueprint comparisons run from a current version to a future version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_blueprint_comparison_guard$;
CREATE TRIGGER journey_blueprint_comparison_guard
BEFORE INSERT ON journey_blueprint_comparisons
FOR EACH ROW EXECUTE FUNCTION journey_blueprint_comparison_guard();

CREATE TABLE journey_hierarchy_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json TEXT NOT NULL CHECK(octet_length(response_json)<=131072 AND jsonb_typeof(response_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_operations_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_hierarchy_operations_idempotency UNIQUE(space_id,actor_user_id,idempotency_key)
);

CREATE TABLE journey_hierarchy_activity (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('taxonomy','hierarchy_link','health','resource','blueprint','blueprint_version','gap')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER CHECK(target_revision IS NULL OR target_revision>0),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(octet_length(detail_json)<=32768 AND jsonb_typeof(detail_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_hierarchy_activity_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_hierarchy_activity_history
  ON journey_hierarchy_activity(space_id,target_kind,target_id,created_at DESC,id);
CREATE INDEX journey_hierarchy_activity_retention
  ON journey_hierarchy_activity(created_at,id);

-- Write-time tenancy for the owner/reviewer columns that used to carry a live
-- composite membership foreign key. TG_ARGV[0] names the actor column;
-- to_jsonb(NEW) reads it without dynamic SQL. FOR SHARE is what makes this an
-- invariant rather than advice: under READ COMMITTED a bare EXISTS could be
-- satisfied by a membership row a concurrent transaction is already deleting.
CREATE OR REPLACE FUNCTION journey_hierarchy_membership_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_hierarchy_membership_guard$
DECLARE actor TEXT;
BEGIN
  actor := to_jsonb(NEW) ->> TG_ARGV[0];
  IF actor IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM space_memberships
    WHERE space_id=NEW.space_id AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey hierarchy actor % is not a member of space %', actor, NEW.space_id
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_hierarchy_membership_guard$;
CREATE TRIGGER journey_hierarchy_links_handoff_owner_membership_guard
BEFORE INSERT OR UPDATE OF space_id,handoff_owner_user_id ON journey_hierarchy_links
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard('handoff_owner_user_id');
CREATE TRIGGER journey_hierarchy_links_reviewer_membership_guard
BEFORE INSERT OR UPDATE OF space_id,reviewed_by_user_id ON journey_hierarchy_links
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard('reviewed_by_user_id');
CREATE TRIGGER journey_blueprint_resources_owner_membership_guard
BEFORE INSERT OR UPDATE OF space_id,owner_user_id ON journey_blueprint_resources
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard('owner_user_id');
CREATE TRIGGER journey_blueprints_owner_membership_guard
BEFORE INSERT OR UPDATE OF space_id,owner_user_id ON journey_blueprints
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard('owner_user_id');
CREATE TRIGGER journey_blueprint_gap_assessments_reviewer_membership_guard
BEFORE INSERT OR UPDATE OF space_id,reviewer_user_id ON journey_blueprint_gap_assessments
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard('reviewer_user_id');

CREATE OR REPLACE FUNCTION journey_hierarchy_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_hierarchy_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey hierarchy/blueprint history is append-only' USING ERRCODE='55000';
END
$journey_hierarchy_append_only_guard$;

-- BEFORE UPDATE only, matching 0027's retention-friendly derived-history idiom:
-- these rows must stay immutable while remaining sweepable by a retention job.
CREATE TRIGGER journey_hierarchy_health_snapshots_append_only
BEFORE UPDATE ON journey_hierarchy_health_snapshots
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_blueprint_versions_append_only
BEFORE UPDATE ON journey_blueprint_versions
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_blueprint_comparisons_append_only
BEFORE UPDATE ON journey_blueprint_comparisons
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();

-- A blueprint version's content is sealed by snapshot_sha256, but the content
-- tables themselves had no update guard: any writer could rewrite a frozen
-- version's stages, elements or relationships and the stored hash would silently
-- stop matching. DELETE stays available so the version cascade still works.
-- Each seal is named to sort before the sibling validation trigger on the same
-- table ('journey_blueprint_element_append_only' < '..._element_resource_kind_
-- guard'; '..._element_resource_append_only' < '..._element_resource_role_guard'),
-- so PostgreSQL's alphabetical BEFORE-row ordering makes the reported error
-- deterministic instead of depending on which guard happens to fire first.
CREATE TRIGGER journey_blueprint_element_append_only
BEFORE UPDATE ON journey_blueprint_elements
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_blueprint_element_resource_append_only
BEFORE UPDATE ON journey_blueprint_element_resources
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_blueprint_stages_append_only
BEFORE UPDATE ON journey_blueprint_stages
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_blueprint_relationships_append_only
BEFORE UPDATE ON journey_blueprint_relationships
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();

-- UPDATE OR DELETE, matching 0027:611/614 and every append-only table in 0028.
-- Deleting an operations row would let the same idempotency key replay to a
-- different result; deleting an activity row would erase the audit trail.
CREATE TRIGGER journey_hierarchy_operations_append_only
BEFORE UPDATE OR DELETE ON journey_hierarchy_operations
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();
CREATE TRIGGER journey_hierarchy_activity_append_only
BEFORE UPDATE OR DELETE ON journey_hierarchy_activity
FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard();

UPDATE platform_subscription_plans SET
  limits_json=(limits_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeyHierarchyLinks":0,"journeyBlueprints":0,"journeyBlueprintResources":0}'::jsonb
      WHEN 'team' THEN '{"journeyHierarchyLinks":1000,"journeyBlueprints":100,"journeyBlueprintResources":1000}'::jsonb
      ELSE '{"journeyHierarchyLinks":100000,"journeyBlueprints":10000,"journeyBlueprintResources":100000}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');

-- No experience_runtime_schema_version row is written here. The migration runner
-- owns that table and stamps it itself, inside the same transaction, with a
-- checksum column this file cannot supply -- a migration cannot know its own
-- sha256 (scripts/upgrade-postgres-schema.mjs). A self-stamp would abort the
-- whole file on its last statement with SQLSTATE 23502, and no migration from
-- 0002 to 0028 writes one.
