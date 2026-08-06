-- Runtime schema 27: governed reusable Journey portfolio and initiative outcomes.
--
-- Portfolio records are canonical, tenant-bound business objects. Current
-- working journey links follow the canonical record; published journey links
-- retain an immutable item snapshot. Scoring and before/after comparisons are
-- descriptive, versioned facts and never claim causality.

DO $journey_portfolio_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>26 THEN
    RAISE EXCEPTION 'runtime-27 journey portfolio requires the checksummed runtime-26 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_portfolio_predecessor$;

CREATE TABLE journey_portfolio_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 3650),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  default_scoring_policy_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_settings_time_order CHECK(updated_at>=created_at)
);

CREATE TABLE journey_portfolio_items (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('pain_point','opportunity','solution','initiative')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 10000),
  lifecycle TEXT NOT NULL CHECK(lifecycle IN (
    'draft','validated','approved','planned','active','blocked','completed','cancelled','archived')),
  owner_user_id TEXT,
  owner_team_id TEXT CHECK(owner_team_id IS NULL OR length(owner_team_id) BETWEEN 1 AND 128),
  priority TEXT CHECK(priority IS NULL OR priority IN ('low','medium','high','critical')),
  risk TEXT CHECK(risk IS NULL OR risk IN ('low','medium','high','unknown')),
  severity INTEGER CHECK(severity IS NULL OR severity BETWEEN 1 AND 5),
  frequency TEXT CHECK(frequency IS NULL OR frequency IN ('rare','occasional','frequent','pervasive','unknown')),
  desired_outcome TEXT CHECK(desired_outcome IS NULL OR length(desired_outcome) BETWEEN 1 AND 5000),
  hypothesis TEXT CHECK(hypothesis IS NULL OR length(hypothesis) BETWEEN 1 AND 5000),
  constraints_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(constraints_json)<=32768 AND jsonb_typeof(constraints_json::jsonb)='array'),
  estimated_effort NUMERIC CHECK(estimated_effort IS NULL OR estimated_effort>=0),
  estimated_cost NUMERIC CHECK(estimated_cost IS NULL OR estimated_cost>=0),
  expected_outcome TEXT CHECK(expected_outcome IS NULL OR length(expected_outcome) BETWEEN 1 AND 5000),
  planned_start DATE,
  planned_end DATE,
  actual_start DATE,
  actual_end DATE,
  due_date DATE,
  progress_percent INTEGER CHECK(progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  review_cadence_days INTEGER CHECK(review_cadence_days IS NULL OR review_cadence_days BETWEEN 1 AND 3650),
  review_state TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK(review_state IN ('not_submitted','in_review','approved','changes_requested')),
  latest_review_id TEXT,
  target_metrics_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(target_metrics_json)<=65536 AND jsonb_typeof(target_metrics_json::jsonb)='array'),
  evidence_link_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(evidence_link_ids_json)<=65536 AND jsonb_typeof(evidence_link_ids_json::jsonb)='array'),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(
    octet_length(tags_json)<=32768 AND jsonb_typeof(tags_json::jsonb)='array'),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  CONSTRAINT journey_portfolio_items_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_items_owner_membership_fk FOREIGN KEY(space_id,owner_user_id)
    REFERENCES space_memberships(space_id,user_id) ON DELETE NO ACTION,
  CONSTRAINT journey_portfolio_items_time_order CHECK(updated_at>=created_at),
  CONSTRAINT journey_portfolio_items_planned_order CHECK(
    planned_start IS NULL OR planned_end IS NULL OR planned_end>=planned_start),
  CONSTRAINT journey_portfolio_items_actual_order CHECK(
    actual_start IS NULL OR actual_end IS NULL OR actual_end>=actual_start),
  CONSTRAINT journey_portfolio_items_lifecycle_shape CHECK(
    (kind<>'initiative' AND lifecycle IN ('draft','validated','approved','archived'))
    OR (kind='initiative' AND lifecycle IN ('draft','planned','active','blocked','completed','cancelled','archived'))),
  CONSTRAINT journey_portfolio_items_kind_shape CHECK(
    (kind='pain_point' AND severity IS NOT NULL AND frequency IS NOT NULL
      AND desired_outcome IS NULL AND hypothesis IS NULL AND expected_outcome IS NULL
      AND priority IS NULL AND risk IS NULL)
    OR (kind='opportunity' AND desired_outcome IS NOT NULL
      AND severity IS NULL AND frequency IS NULL AND hypothesis IS NULL AND expected_outcome IS NULL
      AND priority IS NULL AND risk IS NULL)
    OR (kind='solution' AND hypothesis IS NOT NULL AND risk IS NOT NULL
      AND severity IS NULL AND frequency IS NULL AND desired_outcome IS NULL AND expected_outcome IS NULL
      AND priority IS NULL)
    OR (kind='initiative' AND expected_outcome IS NOT NULL AND priority IS NOT NULL AND risk IS NOT NULL
      AND severity IS NULL AND frequency IS NULL AND desired_outcome IS NULL AND hypothesis IS NULL)),
  CONSTRAINT journey_portfolio_items_initiative_schedule_shape CHECK(
    (kind='initiative' AND progress_percent IS NOT NULL)
    OR (kind<>'initiative' AND due_date IS NULL AND progress_percent IS NULL)),
  CONSTRAINT journey_portfolio_items_lifecycle_state CHECK(
    (state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
    OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL
      AND retention_expires_at>=deleted_at))
);
CREATE INDEX journey_portfolio_items_query
  ON journey_portfolio_items(space_id,state,kind,lifecycle,updated_at DESC,id);
CREATE INDEX journey_portfolio_items_owner
  ON journey_portfolio_items(space_id,owner_user_id,state,updated_at DESC,id);
CREATE INDEX journey_portfolio_items_retention
  ON journey_portfolio_items(retention_expires_at,id) WHERE state='deleted';
CREATE INDEX journey_portfolio_items_delivery
  ON journey_portfolio_items(space_id,state,kind,lifecycle,due_date,priority,id);

CREATE TABLE journey_portfolio_item_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  item_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  snapshot_json TEXT NOT NULL CHECK(
    octet_length(snapshot_json) BETWEEN 2 AND 131072 AND jsonb_typeof(snapshot_json::jsonb)='object'),
  snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  change_reason TEXT CHECK(change_reason IS NULL OR length(change_reason)<=1000),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_item_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_item_versions_item_revision UNIQUE(item_id,space_id,revision),
  CONSTRAINT journey_portfolio_item_versions_item_tenant_fk FOREIGN KEY(item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_portfolio_item_versions_history
  ON journey_portfolio_item_versions(space_id,item_id,revision DESC,id);

CREATE TABLE journey_portfolio_item_evidence (
  item_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  evidence_link_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 255),
  PRIMARY KEY(item_id,evidence_link_id),
  CONSTRAINT journey_portfolio_item_evidence_ordinal UNIQUE(item_id,ordinal),
  CONSTRAINT journey_portfolio_item_evidence_item_fk FOREIGN KEY(item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_item_evidence_source_fk FOREIGN KEY(evidence_link_id,space_id)
    REFERENCES journey_evidence_links(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_portfolio_item_evidence_reverse
  ON journey_portfolio_item_evidence(space_id,evidence_link_id,item_id);

CREATE TABLE journey_portfolio_item_tags (
  item_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 80),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
  PRIMARY KEY(item_id,tag),
  CONSTRAINT journey_portfolio_item_tags_ordinal UNIQUE(item_id,ordinal),
  CONSTRAINT journey_portfolio_item_tags_item_fk FOREIGN KEY(item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_portfolio_item_tags_reverse
  ON journey_portfolio_item_tags(space_id,tag,item_id);

CREATE TABLE journey_initiative_metric_targets (
  item_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  metric_definition_id TEXT NOT NULL,
  metric_definition_version_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('higher_is_better','lower_is_better')),
  target_value NUMERIC NOT NULL,
  unit TEXT NOT NULL CHECK(length(unit) BETWEEN 1 AND 80),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
  PRIMARY KEY(item_id,metric_definition_id,metric_definition_version_id),
  CONSTRAINT journey_initiative_metric_targets_ordinal UNIQUE(item_id,ordinal),
  CONSTRAINT journey_initiative_metric_targets_item_fk FOREIGN KEY(item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_initiative_metric_targets_metric_fk FOREIGN KEY(metric_definition_id,space_id)
    REFERENCES journey_metric_definitions(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_initiative_metric_targets_version_fk
    FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
    REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_initiative_metric_targets_metric
  ON journey_initiative_metric_targets(space_id,metric_definition_id,item_id);

CREATE TABLE journey_portfolio_relationships (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN (
    'pain_point_to_opportunity','opportunity_to_solution','solution_to_initiative')),
  from_item_id TEXT NOT NULL,
  from_item_kind TEXT NOT NULL CHECK(from_item_kind IN ('pain_point','opportunity','solution')),
  to_item_id TEXT NOT NULL,
  to_item_kind TEXT NOT NULL CHECK(to_item_kind IN ('opportunity','solution','initiative')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_relationships_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_relationships_edge_once UNIQUE(space_id,relationship_type,from_item_id,to_item_id),
  -- space_id inherits from an unbounded TEXT primary key upstream, so per-column
  -- length checks alone cannot bound a composite btree key. Budget it explicitly.
  CONSTRAINT journey_portfolio_relationships_index_width CHECK(
    octet_length(space_id)+octet_length(from_item_id)+octet_length(to_item_id)<=1024),
  CONSTRAINT journey_portfolio_relationships_no_self CHECK(from_item_id<>to_item_id),
  CONSTRAINT journey_portfolio_relationships_shape CHECK(
    (relationship_type='pain_point_to_opportunity' AND from_item_kind='pain_point' AND to_item_kind='opportunity')
    OR (relationship_type='opportunity_to_solution' AND from_item_kind='opportunity' AND to_item_kind='solution')
    OR (relationship_type='solution_to_initiative' AND from_item_kind='solution' AND to_item_kind='initiative')),
  CONSTRAINT journey_portfolio_relationships_from_tenant_fk FOREIGN KEY(from_item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_relationships_to_tenant_fk FOREIGN KEY(to_item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_portfolio_relationships_from
  ON journey_portfolio_relationships(space_id,from_item_id,relationship_type,to_item_id);
CREATE INDEX journey_portfolio_relationships_to
  ON journey_portfolio_relationships(space_id,to_item_id,relationship_type,from_item_id);

CREATE OR REPLACE FUNCTION journey_portfolio_relationship_kind_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_relationship_kind_guard$
DECLARE actual_from TEXT; actual_to TEXT;
BEGIN
  SELECT kind INTO actual_from FROM journey_portfolio_items
    WHERE id=NEW.from_item_id AND space_id=NEW.space_id AND state='active';
  SELECT kind INTO actual_to FROM journey_portfolio_items
    WHERE id=NEW.to_item_id AND space_id=NEW.space_id AND state='active';
  IF actual_from IS DISTINCT FROM NEW.from_item_kind OR actual_to IS DISTINCT FROM NEW.to_item_kind THEN
    RAISE EXCEPTION 'Portfolio relationship kinds do not match active canonical items' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_portfolio_relationship_kind_guard$;
CREATE TRIGGER journey_portfolio_relationship_kind_guard
BEFORE INSERT OR UPDATE OF space_id,from_item_id,from_item_kind,to_item_id,to_item_kind
ON journey_portfolio_relationships
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_relationship_kind_guard();

CREATE TABLE journey_portfolio_journey_links (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('pain_point','opportunity','solution','initiative')),
  canonical_item_revision INTEGER NOT NULL CHECK(canonical_item_revision>0),
  journey_definition_id TEXT NOT NULL,
  journey_version_id TEXT,
  target_type TEXT NOT NULL CHECK(target_type IN ('journey','stage','touchpoint','persona')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  relationship TEXT NOT NULL CHECK(relationship IN ('occurs_at','affects','improves','changes','delivers')),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  item_snapshot_json TEXT,
  item_snapshot_sha256 TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_journey_links_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_journey_links_once UNIQUE(
    space_id,item_id,journey_definition_id,journey_version_id,target_type,target_id,relationship),
  CONSTRAINT journey_portfolio_journey_links_item_tenant_fk FOREIGN KEY(item_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_journey_links_item_version_fk
    FOREIGN KEY(item_id,space_id,canonical_item_revision)
    REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_journey_links_journey_tenant_fk FOREIGN KEY(journey_definition_id,space_id)
    REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
  -- journey_map_versions.definition_id cascades from journey_definitions
  -- (0012:56), and journey_definitions is hard-deleted (journeyMaps.ts:2161).
  -- The same DELETE therefore cascades this row away through
  -- journey_portfolio_journey_links_journey_tenant_fk while checking this edge.
  -- RESTRICT is enforced inside the statement, so success would depend on
  -- referential-action firing order; NO ACTION refuses orphans just as firmly
  -- but defers to end-of-statement, after the sibling cascade has landed. This
  -- is the rule runtime-29 already adopted for the identical edge.
  CONSTRAINT journey_portfolio_journey_links_version_tenant_fk
    FOREIGN KEY(journey_version_id,journey_definition_id,space_id)
    REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION,
  -- space_id / journey_definition_id / journey_version_id inherit from unbounded
  -- TEXT primary keys upstream; the seven-column logical key needs an explicit
  -- octet budget to stay statically provable against the btree page limit.
  CONSTRAINT journey_portfolio_journey_links_index_width CHECK(
    octet_length(space_id)+octet_length(item_id)+octet_length(journey_definition_id)
    +COALESCE(octet_length(journey_version_id),0)+octet_length(target_type)
    +octet_length(target_id)+octet_length(relationship)<=1024),
  CONSTRAINT journey_portfolio_journey_links_window CHECK(
    valid_from IS NULL OR valid_until IS NULL OR valid_until>valid_from),
  CONSTRAINT journey_portfolio_journey_links_snapshot_shape CHECK(
    (journey_version_id IS NULL AND item_snapshot_json IS NULL AND item_snapshot_sha256 IS NULL)
    OR (journey_version_id IS NOT NULL AND item_snapshot_json IS NOT NULL
      AND jsonb_typeof(item_snapshot_json::jsonb)='object'
      AND octet_length(item_snapshot_json)<=131072
      AND item_snapshot_sha256 ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX journey_portfolio_journey_links_item
  ON journey_portfolio_journey_links(space_id,item_id,journey_definition_id,journey_version_id);
CREATE INDEX journey_portfolio_journey_links_journey
  ON journey_portfolio_journey_links(space_id,journey_definition_id,target_type,target_id,item_kind);
CREATE UNIQUE INDEX journey_portfolio_journey_links_current_once
  ON journey_portfolio_journey_links(space_id,item_id,journey_definition_id,target_type,target_id,relationship)
  WHERE journey_version_id IS NULL;

CREATE OR REPLACE FUNCTION journey_portfolio_journey_link_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_journey_link_guard$
DECLARE actual_kind TEXT; effective_version_id TEXT;
BEGIN
  SELECT kind INTO actual_kind FROM journey_portfolio_items
    WHERE id=NEW.item_id AND space_id=NEW.space_id AND state='active';
  IF actual_kind IS DISTINCT FROM NEW.item_kind THEN
    RAISE EXCEPTION 'Portfolio journey link kind does not match its canonical item' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(NEW.journey_version_id,current_version_id) INTO effective_version_id
    FROM journey_definitions WHERE id=NEW.journey_definition_id AND space_id=NEW.space_id;
  IF NEW.target_type='journey' AND NEW.target_id<>NEW.journey_definition_id THEN
    RAISE EXCEPTION 'Journey-level portfolio link target must equal its journey' USING ERRCODE='23514';
  ELSIF NEW.target_type='stage' AND NOT EXISTS (
      SELECT 1 FROM journey_map_stages WHERE id=NEW.target_id AND space_id=NEW.space_id
        AND version_id=effective_version_id) THEN
    RAISE EXCEPTION 'Portfolio stage target is outside the selected journey version' USING ERRCODE='23503';
  ELSIF NEW.target_type='touchpoint' AND NOT EXISTS (
      SELECT 1 FROM journey_touchpoints WHERE id=NEW.target_id AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Portfolio touchpoint target is outside the tenant' USING ERRCODE='23503';
  ELSIF NEW.target_type='persona' AND NOT EXISTS (
      SELECT 1 FROM journey_definition_personas WHERE definition_id=NEW.journey_definition_id
        AND persona_id=NEW.target_id) THEN
    RAISE EXCEPTION 'Portfolio persona target is not linked to the journey' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_portfolio_journey_link_guard$;
CREATE TRIGGER journey_portfolio_journey_link_guard
BEFORE INSERT OR UPDATE OF space_id,item_id,item_kind,journey_definition_id,journey_version_id,target_type,target_id
ON journey_portfolio_journey_links
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_journey_link_guard();

CREATE TABLE journey_initiative_dependencies (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL,
  depends_on_initiative_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL CHECK(dependency_type IN ('finish_to_start','blocks')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_initiative_dependencies_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_initiative_dependencies_once UNIQUE(space_id,initiative_id,depends_on_initiative_id),
  CONSTRAINT journey_initiative_dependencies_no_self CHECK(initiative_id<>depends_on_initiative_id),
  CONSTRAINT journey_initiative_dependencies_initiative_tenant_fk FOREIGN KEY(initiative_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_initiative_dependencies_prerequisite_tenant_fk FOREIGN KEY(depends_on_initiative_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
);
-- journey_initiative_dependencies_once already indexes the forward direction the
-- recursive guard walks. The reverse edge ("what depends on this initiative")
-- has no access path of its own and would otherwise sequentially scan.
CREATE INDEX journey_initiative_dependencies_reverse
  ON journey_initiative_dependencies(space_id,depends_on_initiative_id,dependency_type,initiative_id);

CREATE OR REPLACE FUNCTION journey_initiative_dependency_kind_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_initiative_dependency_kind_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journey_portfolio_items
      WHERE id=NEW.initiative_id AND space_id=NEW.space_id AND kind='initiative' AND state='active')
    OR NOT EXISTS (SELECT 1 FROM journey_portfolio_items
      WHERE id=NEW.depends_on_initiative_id AND space_id=NEW.space_id AND kind='initiative' AND state='active') THEN
    RAISE EXCEPTION 'Initiative dependencies require active same-space initiatives' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE predecessors(id) AS (
      SELECT depends_on_initiative_id FROM journey_initiative_dependencies
        WHERE space_id=NEW.space_id AND initiative_id=NEW.depends_on_initiative_id
      UNION
      SELECT dependency.depends_on_initiative_id
        FROM journey_initiative_dependencies dependency
        JOIN predecessors ON predecessors.id=dependency.initiative_id
        WHERE dependency.space_id=NEW.space_id)
    SELECT 1 FROM predecessors WHERE id=NEW.initiative_id) THEN
    RAISE EXCEPTION 'Initiative dependency would create a cycle' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_initiative_dependency_kind_guard$;
CREATE TRIGGER journey_initiative_dependency_kind_guard
BEFORE INSERT OR UPDATE OF space_id,initiative_id,depends_on_initiative_id
ON journey_initiative_dependencies
FOR EACH ROW EXECUTE FUNCTION journey_initiative_dependency_kind_guard();

CREATE TABLE journey_portfolio_scoring_policies (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  method TEXT NOT NULL CHECK(method IN ('rice','ice','weighted')),
  state TEXT NOT NULL CHECK(state IN ('draft','active','retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  current_version_id TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_scoring_policies_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_scoring_policies_time_order CHECK(updated_at>=created_at)
);
-- Quota admission counts every non-retired policy in a space on each create
-- (countRetainedPolicies, journeyPortfolio.ts), which has no access path
-- without this index.
CREATE INDEX journey_portfolio_scoring_policies_state
  ON journey_portfolio_scoring_policies(space_id,state,updated_at DESC,id);

CREATE TABLE journey_portfolio_scoring_policy_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  policy_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  method TEXT NOT NULL CHECK(method IN ('rice','ice','weighted')),
  formula_version TEXT NOT NULL CHECK(length(formula_version) BETWEEN 1 AND 80),
  configuration_json TEXT NOT NULL CHECK(
    octet_length(configuration_json) BETWEEN 2 AND 32768 AND jsonb_typeof(configuration_json::jsonb)='object'),
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_scoring_policy_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_scoring_policy_versions_current_identity UNIQUE(id,policy_id,space_id),
  CONSTRAINT journey_portfolio_scoring_policy_versions_policy_version UNIQUE(policy_id,space_id,version_number),
  CONSTRAINT journey_portfolio_scoring_policy_versions_parent_fk FOREIGN KEY(policy_id,space_id)
    REFERENCES journey_portfolio_scoring_policies(id,space_id) ON DELETE CASCADE
);
ALTER TABLE journey_portfolio_scoring_policies ADD CONSTRAINT journey_portfolio_scoring_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id)
  REFERENCES journey_portfolio_scoring_policy_versions(id,policy_id,space_id)
  DEFERRABLE INITIALLY DEFERRED;
-- Both sides cascade from spaces, so a space delete would check this edge inside
-- the same statement that removes the policy. NO ACTION refuses the same orphans
-- without depending on referential-action firing order.
ALTER TABLE journey_portfolio_settings ADD CONSTRAINT journey_portfolio_settings_default_policy_fk
  FOREIGN KEY(default_scoring_policy_id,space_id)
  REFERENCES journey_portfolio_scoring_policies(id,space_id) ON DELETE NO ACTION;

-- current_version_id stays physically nullable because the policy root and its
-- first immutable version reference each other: journeyPortfolio.ts inserts the
-- policy with NULL, then the version, then the pointer, inside one transaction.
-- A commit-time invariant is the strongest form that ordering allows, and the
-- facade already treats a violation as corruption -- policyFromRow raises
-- JOURNEY_PORTFOLIO_POLICY_INTEGRITY_FAILED both when the current version is
-- missing and when its method disagrees with the policy -- so without this the
-- only enforcement of a documented integrity rule lives in application code.
-- Mirrors journey_personas_current_version_required in runtime-23.
CREATE OR REPLACE FUNCTION journey_portfolio_policy_current_version_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_policy_current_version_guard$
DECLARE current_method TEXT;
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RAISE EXCEPTION 'journey_portfolio_scoring_policies.current_version_id is required'
      USING ERRCODE='23502';
  END IF;
  SELECT method INTO current_method FROM journey_portfolio_scoring_policy_versions
    WHERE id=NEW.current_version_id AND policy_id=NEW.id AND space_id=NEW.space_id;
  IF current_method IS NULL THEN
    RAISE EXCEPTION 'journey_portfolio_scoring_policies.current_version_id must reference this policy and space'
      USING ERRCODE='23503';
  END IF;
  IF current_method<>NEW.method THEN
    RAISE EXCEPTION 'journey_portfolio_scoring_policies.method must match its current version'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_portfolio_policy_current_version_guard$;
CREATE CONSTRAINT TRIGGER journey_portfolio_policy_current_version_required
AFTER INSERT OR UPDATE ON journey_portfolio_scoring_policies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_policy_current_version_guard();

CREATE TABLE journey_portfolio_priority_assessments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_revision INTEGER NOT NULL CHECK(item_revision>0),
  policy_version_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('rice','ice','weighted')),
  input_json TEXT NOT NULL CHECK(octet_length(input_json)<=32768 AND jsonb_typeof(input_json::jsonb)='object'),
  result_json TEXT NOT NULL CHECK(octet_length(result_json)<=32768 AND jsonb_typeof(result_json::jsonb)='object'),
  score NUMERIC,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_priority_assessments_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_priority_assessments_item_version_fk
    FOREIGN KEY(item_id,space_id,item_revision)
    REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_priority_assessments_policy_version_fk
    FOREIGN KEY(policy_version_id,space_id)
    REFERENCES journey_portfolio_scoring_policy_versions(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_portfolio_priority_assessments_history
  ON journey_portfolio_priority_assessments(space_id,item_id,assessed_at DESC,id);

CREATE TABLE journey_initiative_baselines (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL,
  initiative_revision INTEGER NOT NULL CHECK(initiative_revision>0),
  metric_definition_id TEXT NOT NULL,
  metric_definition_version TEXT NOT NULL CHECK(length(metric_definition_version) BETWEEN 1 AND 128),
  target_json TEXT NOT NULL CHECK(octet_length(target_json)<=16384 AND jsonb_typeof(target_json::jsonb)='object'),
  observation_json TEXT NOT NULL CHECK(octet_length(observation_json)<=65536 AND jsonb_typeof(observation_json::jsonb)='object'),
  checksum TEXT NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  captured_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_initiative_baselines_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_initiative_baselines_initiative_version_fk
    FOREIGN KEY(initiative_id,space_id,initiative_revision)
    REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE
);
CREATE INDEX journey_initiative_baselines_history
  ON journey_initiative_baselines(space_id,initiative_id,captured_at DESC,id);

CREATE TABLE journey_initiative_outcome_comparisons (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  baseline_checksum TEXT NOT NULL CHECK(baseline_checksum ~ '^[a-f0-9]{64}$'),
  after_observation_json TEXT NOT NULL CHECK(
    octet_length(after_observation_json)<=65536 AND jsonb_typeof(after_observation_json::jsonb)='object'),
  comparison_json TEXT NOT NULL CHECK(
    octet_length(comparison_json)<=65536 AND jsonb_typeof(comparison_json::jsonb)='object'),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  compared_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_initiative_outcome_comparisons_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_initiative_outcomes_baseline_tenant_fk FOREIGN KEY(baseline_id,space_id)
    REFERENCES journey_initiative_baselines(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_initiative_outcomes_initiative_tenant_fk FOREIGN KEY(initiative_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_initiative_outcome_history
  ON journey_initiative_outcome_comparisons(space_id,initiative_id,compared_at DESC,id);

-- Review events are append-only decisions against an exact item revision.
-- The canonical item points at the latest event so lifecycle transitions can
-- assert approval without rewriting or erasing the review history.
CREATE TABLE journey_portfolio_reviews (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_revision INTEGER NOT NULL CHECK(item_revision>0),
  decision TEXT NOT NULL CHECK(decision IN ('submit','approve','request_changes','withdraw')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=4000),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_reviews_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_reviews_item_version_fk
    FOREIGN KEY(item_id,space_id,item_revision)
    REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE
);
CREATE INDEX journey_portfolio_reviews_history
  ON journey_portfolio_reviews(space_id,item_id,created_at DESC,id);
ALTER TABLE journey_portfolio_items ADD CONSTRAINT journey_portfolio_items_latest_review_fk
  FOREIGN KEY(latest_review_id,space_id)
  REFERENCES journey_portfolio_reviews(id,space_id) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION journey_portfolio_item_review_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_item_review_guard$
DECLARE requires_approval BOOLEAN; latest_decision TEXT; latest_revision INTEGER;
BEGIN
  SELECT approval_required INTO requires_approval FROM journey_portfolio_settings WHERE space_id=NEW.space_id;
  requires_approval := COALESCE(requires_approval,TRUE);
  IF NEW.review_state='approved' THEN
    SELECT decision,item_revision INTO latest_decision,latest_revision
      FROM journey_portfolio_reviews WHERE id=NEW.latest_review_id AND space_id=NEW.space_id;
    IF latest_decision IS DISTINCT FROM 'approve' OR latest_revision IS DISTINCT FROM NEW.revision THEN
      RAISE EXCEPTION 'Approved portfolio items require an approval for the exact current revision' USING ERRCODE='23514';
    END IF;
  END IF;
  IF requires_approval AND (
      (NEW.kind<>'initiative' AND NEW.lifecycle='approved')
      OR (NEW.kind='initiative' AND NEW.lifecycle IN ('active','blocked','completed')))
      AND NEW.review_state<>'approved' THEN
    RAISE EXCEPTION 'Portfolio lifecycle transition requires approval' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_portfolio_item_review_guard$;
CREATE CONSTRAINT TRIGGER journey_portfolio_item_review_guard
AFTER INSERT OR UPDATE ON journey_portfolio_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_item_review_guard();

-- Assistant actions and service-recovery tickets remain their own operational
-- objects. These links provide traceability without converting either into an
-- initiative or silently transferring lifecycle/ownership semantics.
CREATE TABLE journey_portfolio_operational_links (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL,
  operational_kind TEXT NOT NULL CHECK(operational_kind IN ('assistant_action','recovery_ticket')),
  operational_id TEXT NOT NULL CHECK(length(operational_id) BETWEEN 1 AND 128),
  relationship TEXT NOT NULL CHECK(relationship IN ('informs','supports','delivers_follow_up')),
  outcome_state TEXT NOT NULL DEFAULT 'linked' CHECK(outcome_state IN ('linked','succeeded','failed','cancelled','unknown')),
  outcome_detail_json TEXT NOT NULL DEFAULT '{}' CHECK(
    octet_length(outcome_detail_json)<=16384 AND jsonb_typeof(outcome_detail_json::jsonb)='object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_operational_links_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_operational_links_once UNIQUE(
    space_id,initiative_id,operational_kind,operational_id,relationship),
  CONSTRAINT journey_portfolio_operational_links_index_width CHECK(
    octet_length(space_id)+octet_length(initiative_id)+octet_length(operational_id)<=1024),
  CONSTRAINT journey_portfolio_operational_links_initiative_fk FOREIGN KEY(initiative_id,space_id)
    REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_portfolio_operational_links_time_order CHECK(updated_at>=created_at)
);

CREATE OR REPLACE FUNCTION journey_portfolio_operational_link_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_operational_link_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journey_portfolio_items
      WHERE id=NEW.initiative_id AND space_id=NEW.space_id AND kind='initiative' AND state='active') THEN
    RAISE EXCEPTION 'Operational links require an active same-space initiative' USING ERRCODE='23514';
  END IF;
  IF NEW.operational_kind='assistant_action' AND NOT EXISTS (
      SELECT 1 FROM assistant_actions WHERE id=NEW.operational_id AND space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Assistant action is outside the portfolio tenant' USING ERRCODE='23503';
  ELSIF NEW.operational_kind='recovery_ticket' AND NOT EXISTS (
      SELECT 1 FROM tickets ticket JOIN surveys survey ON survey.id=ticket.survey_id
        WHERE ticket.id=NEW.operational_id AND survey.space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Recovery ticket is outside the portfolio tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_portfolio_operational_link_guard$;
-- Narrow on purpose. Under the broad form this guard re-asserted an active
-- initiative and a live assistant_actions/tickets row on every UPDATE, so
-- recording that a link had failed or been cancelled -- the exact transition
-- outcome_state exists for -- became impossible once the operational source row
-- was gone or the initiative was soft-deleted.
CREATE TRIGGER journey_portfolio_operational_link_guard
BEFORE INSERT OR UPDATE OF space_id,initiative_id,operational_kind,operational_id
ON journey_portfolio_operational_links
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_operational_link_guard();

CREATE TABLE journey_portfolio_operations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  intent_sha256 TEXT NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
  response_json TEXT NOT NULL CHECK(octet_length(response_json)<=131072 AND jsonb_typeof(response_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_operations_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_portfolio_operations_idempotency UNIQUE(space_id,actor_user_id,idempotency_key),
  -- A width overflow on the replay key is unrecoverable: the INSERT that records
  -- the operation fails after its effects were computed, so the caller can
  -- neither commit nor safely retry. space_id and actor_user_id inherit from
  -- unbounded TEXT primary keys, so the budget has to be declared here.
  CONSTRAINT journey_portfolio_operations_index_width CHECK(
    octet_length(space_id)+octet_length(actor_user_id)+octet_length(idempotency_key)<=1024)
);

CREATE TABLE journey_portfolio_activity (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),
  target_kind TEXT NOT NULL CHECK(length(target_kind) BETWEEN 1 AND 64),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER CHECK(target_revision IS NULL OR target_revision>0),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(
    octet_length(detail_json)<=32768 AND jsonb_typeof(detail_json::jsonb)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_portfolio_activity_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_portfolio_activity_history
  ON journey_portfolio_activity(space_id,target_kind,target_id,created_at DESC,id);
CREATE INDEX journey_portfolio_activity_retention
  ON journey_portfolio_activity(created_at,id);

CREATE OR REPLACE FUNCTION journey_portfolio_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_append_only_guard$
BEGIN
  RAISE EXCEPTION 'Journey portfolio history is append-only' USING ERRCODE='55000';
END
$journey_portfolio_append_only_guard$;
CREATE TRIGGER journey_portfolio_item_versions_append_only
BEFORE UPDATE ON journey_portfolio_item_versions
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
-- UPDATE-only, like every other sealed table in this file and like the SQLite
-- mirror (journey_portfolio_policy_versions_update_guard). Under OR DELETE the
-- declared spaces -> policies -> policy_versions cascade could never complete:
-- the cascade issues a DELETE against this table, which the guard refused.
CREATE TRIGGER journey_portfolio_policy_versions_append_only
BEFORE UPDATE ON journey_portfolio_scoring_policy_versions
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_assessments_append_only
BEFORE UPDATE ON journey_portfolio_priority_assessments
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_baselines_append_only
BEFORE UPDATE ON journey_initiative_baselines
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_outcomes_append_only
BEFORE UPDATE ON journey_initiative_outcome_comparisons
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_reviews_append_only
BEFORE UPDATE ON journey_portfolio_reviews
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_operations_append_only
BEFORE UPDATE OR DELETE ON journey_portfolio_operations
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();
CREATE TRIGGER journey_portfolio_activity_append_only
BEFORE UPDATE OR DELETE ON journey_portfolio_activity
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_append_only_guard();

-- Preserve customised plans. Only absent portfolio allowance keys inherit the
-- runtime defaults; every route must still enforce feature, permission and
-- quota atomically.
UPDATE platform_subscription_plans SET
  limits_json=(limits_json::jsonb || (
    (CASE code WHEN 'starter' THEN '{"journeyPortfolioItems":0,"journeyPortfolioScoringPolicies":0}'::jsonb
      WHEN 'team' THEN '{"journeyPortfolioItems":1000,"journeyPortfolioScoringPolicies":10}'::jsonb
      ELSE '{"journeyPortfolioItems":100000,"journeyPortfolioScoringPolicies":500}'::jsonb END)
    - ARRAY(SELECT jsonb_object_keys(limits_json::jsonb))
  ))::text,
  updated_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE code IN ('starter','team','enterprise');

-- No experience_runtime_schema_version row is written here. The migration runner
-- owns that table and stamps it itself, inside the same transaction, with a
-- checksum column this file cannot supply -- a migration cannot know its own
-- sha256 (scripts/upgrade-postgres-schema.mjs). A self-stamp would abort the
-- whole file on its last statement with SQLSTATE 23502, and no migration from
-- 0002 to 0026 writes one.
