-- Runtime schema 31: durable connected-journey identity profiles, bindings,
-- merges, memberships, tombstones, processed commands, and audit.
--
-- This runtime persists the existing pure identity reducer so profile/account
-- foundations can move beyond anonymous-only stage processing.

DO $journey_identity_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>30 THEN
    RAISE EXCEPTION 'runtime-31 journey identity profiles require the checksummed runtime-30 predecessor'
      USING ERRCODE='55000';
  END IF;
END
$journey_identity_predecessor$;

CREATE TABLE journey_identity_profiles (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('anonymous','known')),
  status TEXT NOT NULL CHECK(status IN ('active','deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_command_id TEXT NOT NULL CHECK(length(created_by_command_id) BETWEEN 1 AND 200),
  known_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT journey_identity_profiles_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_identity_profiles_known_shape CHECK(
    (kind='known' AND known_at IS NOT NULL) OR kind='anonymous' OR known_at IS NULL)
);
CREATE INDEX journey_identity_profiles_space_history
  ON journey_identity_profiles(space_id,created_at DESC,id);

CREATE TABLE journey_identity_bindings (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 512),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  identifier_kind TEXT NOT NULL CHECK(identifier_kind IN ('anonymous_id','authenticated_user_id','external_user_id')),
  identifier_namespace TEXT NOT NULL CHECK(length(identifier_namespace) BETWEEN 1 AND 160),
  identifier_value TEXT NOT NULL CHECK(length(identifier_value) BETWEEN 1 AND 512),
  profile_id TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL,
  bound_by_command_id TEXT NOT NULL CHECK(length(bound_by_command_id) BETWEEN 1 AND 200),
  CONSTRAINT journey_identity_bindings_exact UNIQUE(space_id,identifier_kind,identifier_namespace,identifier_value),
  CONSTRAINT journey_identity_bindings_profile_tenant_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_bindings_profile
  ON journey_identity_bindings(space_id,profile_id,bound_at DESC,id);

CREATE TABLE journey_identity_merges (
  merge_audit_id TEXT PRIMARY KEY CHECK(length(merge_audit_id) BETWEEN 1 AND 200),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_profile_id TEXT NOT NULL,
  target_profile_id TEXT NOT NULL,
  canonical_target_profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
  active BOOLEAN NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL,
  merged_by_command_id TEXT NOT NULL CHECK(length(merged_by_command_id) BETWEEN 1 AND 200),
  split_at TIMESTAMPTZ,
  split_by_command_id TEXT,
  CONSTRAINT journey_identity_merges_source_tenant_fk FOREIGN KEY(source_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_merges_target_tenant_fk FOREIGN KEY(target_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_merges_canonical_tenant_fk FOREIGN KEY(canonical_target_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_merges_space_history
  ON journey_identity_merges(space_id,merged_at DESC,merge_audit_id);

CREATE TABLE journey_identity_memberships (
  membership_id TEXT PRIMARY KEY CHECK(length(membership_id) BETWEEN 1 AND 200),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  group_type TEXT NOT NULL CHECK(group_type IN ('account','group')),
  group_id TEXT NOT NULL CHECK(length(group_id) BETWEEN 1 AND 128),
  active BOOLEAN NOT NULL,
  added_at TIMESTAMPTZ NOT NULL,
  added_by_command_id TEXT NOT NULL CHECK(length(added_by_command_id) BETWEEN 1 AND 200),
  removed_at TIMESTAMPTZ,
  removed_by_command_id TEXT,
  CONSTRAINT journey_identity_memberships_exact UNIQUE(space_id,group_type,group_id,profile_id),
  CONSTRAINT journey_identity_memberships_profile_tenant_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_memberships_profile
  ON journey_identity_memberships(space_id,profile_id,added_at DESC,membership_id);

CREATE TABLE journey_identity_groups (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  group_type TEXT NOT NULL CHECK(group_type IN ('account','group')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  external_ref TEXT CHECK(external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT journey_identity_groups_tenant_identity UNIQUE(space_id,group_type,id),
  CONSTRAINT journey_identity_groups_tenant_external UNIQUE(space_id,group_type,external_ref)
);
CREATE INDEX journey_identity_groups_space_history
  ON journey_identity_groups(space_id,group_type,updated_at DESC,id);

CREATE TABLE journey_identity_source_facts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 512),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  fact_id TEXT NOT NULL CHECK(length(fact_id) BETWEEN 1 AND 128),
  profile_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 160),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 400),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_by_command_id TEXT NOT NULL CHECK(length(recorded_by_command_id) BETWEEN 1 AND 200),
  CONSTRAINT journey_identity_source_facts_exact UNIQUE(space_id,fact_id),
  CONSTRAINT journey_identity_source_facts_profile_tenant_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_source_facts_profile
  ON journey_identity_source_facts(space_id,profile_id,occurred_at DESC,id);

CREATE TABLE journey_identity_audit_facts (
  audit_id TEXT PRIMARY KEY CHECK(length(audit_id) BETWEEN 1 AND 200),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL CHECK(length(command_id) BETWEEN 1 AND 200),
  policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 80),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('observe','identify','alias','merge','split','add_membership','remove_membership','delete')),
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected')),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 120),
  explanation TEXT NOT NULL CHECK(length(explanation) BETWEEN 1 AND 4000),
  occurred_at TIMESTAMPTZ NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT journey_identity_audit_facts_details_shape CHECK(
    jsonb_typeof(details_json)='object' AND octet_length(details_json::text)<=65535)
);
CREATE INDEX journey_identity_audit_space_history
  ON journey_identity_audit_facts(space_id,occurred_at DESC,audit_id);

CREATE TABLE journey_identity_profile_tombstones (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL,
  deleted_by_command_id TEXT NOT NULL CHECK(length(deleted_by_command_id) BETWEEN 1 AND 200),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
  CONSTRAINT journey_identity_profile_tombstones_exact UNIQUE(space_id,profile_id)
);

CREATE TABLE journey_identity_identifier_tombstones (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 512),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  identifier_kind TEXT NOT NULL CHECK(identifier_kind IN ('anonymous_id','authenticated_user_id','external_user_id')),
  identifier_namespace TEXT NOT NULL CHECK(length(identifier_namespace) BETWEEN 1 AND 160),
  identifier_value TEXT NOT NULL CHECK(length(identifier_value) BETWEEN 1 AND 512),
  profile_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL,
  deleted_by_command_id TEXT NOT NULL CHECK(length(deleted_by_command_id) BETWEEN 1 AND 200),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
  CONSTRAINT journey_identity_identifier_tombstones_exact UNIQUE(space_id,identifier_kind,identifier_namespace,identifier_value)
);

CREATE TABLE journey_identity_processed_commands (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 512),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL CHECK(length(command_id) BETWEEN 1 AND 200),
  command_fingerprint TEXT NOT NULL CHECK(length(command_fingerprint) BETWEEN 1 AND 50000),
  decision_json JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_processed_commands_exact UNIQUE(space_id,command_id),
  CONSTRAINT journey_identity_processed_commands_decision_shape CHECK(
    jsonb_typeof(decision_json)='object' AND octet_length(decision_json::text)<=262144)
);
CREATE INDEX journey_identity_processed_commands_space_history
  ON journey_identity_processed_commands(space_id,processed_at DESC,id);

CREATE TABLE journey_profile_timeline_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  canonical_profile_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(length(event_kind) BETWEEN 1 AND 80),
  occurred_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 4000),
  source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 1 AND 80),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 200),
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_profile_timeline_events_exact UNIQUE(space_id,profile_id,event_kind,source_type,source_id),
  CONSTRAINT journey_profile_timeline_events_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_profile_timeline_events_canonical_fk FOREIGN KEY(canonical_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_profile_timeline_events_detail_shape CHECK(
    jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=65535)
);
CREATE INDEX journey_profile_timeline_events_profile
  ON journey_profile_timeline_events(space_id,profile_id,occurred_at DESC,id);
CREATE INDEX journey_profile_timeline_events_canonical
  ON journey_profile_timeline_events(space_id,canonical_profile_id,occurred_at DESC,id);

CREATE TABLE journey_identity_sessions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  canonical_profile_id TEXT NOT NULL,
  identifier_namespace TEXT NOT NULL CHECK(length(identifier_namespace) BETWEEN 1 AND 160),
  identifier_value TEXT NOT NULL CHECK(length(identifier_value) BETWEEN 1 AND 512),
  started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK(event_count >= 0),
  source_fact_count INTEGER NOT NULL DEFAULT 0 CHECK(source_fact_count >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_sessions_exact UNIQUE(space_id,profile_id,identifier_namespace,identifier_value),
  CONSTRAINT journey_identity_sessions_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_sessions_canonical_fk FOREIGN KEY(canonical_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_sessions_profile
  ON journey_identity_sessions(space_id,profile_id,last_seen_at DESC,id);
CREATE INDEX journey_identity_sessions_canonical
  ON journey_identity_sessions(space_id,canonical_profile_id,last_seen_at DESC,id);

CREATE TABLE journey_identity_segments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  state TEXT NOT NULL CHECK(state IN ('active','retired')),
  active_version_id TEXT NOT NULL,
  active_version_number INTEGER NOT NULL DEFAULT 1 CHECK(active_version_number > 0),
  materialized_member_count INTEGER NOT NULL DEFAULT 0 CHECK(materialized_member_count >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_segments_tenant_identity UNIQUE(id,space_id)
);
CREATE INDEX journey_identity_segments_space_history
  ON journey_identity_segments(space_id,updated_at DESC,id);

CREATE TABLE journey_identity_segment_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  rule_json JSONB NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','superseded')),
  validation_state TEXT NOT NULL CHECK(validation_state IN ('valid')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_segment_versions_exact UNIQUE(space_id,segment_id,version_number),
  CONSTRAINT journey_identity_segment_versions_tenant_identity UNIQUE(id,space_id),
  CONSTRAINT journey_identity_segment_versions_segment_fk FOREIGN KEY(segment_id,space_id)
    REFERENCES journey_identity_segments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_segment_versions_rule_shape CHECK(
    jsonb_typeof(rule_json)='object' AND octet_length(rule_json::text)<=65535)
);
CREATE INDEX journey_identity_segment_versions_segment
  ON journey_identity_segment_versions(space_id,segment_id,version_number DESC,id);

CREATE TABLE journey_identity_segment_memberships (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 260),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  segment_version_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  canonical_profile_id TEXT NOT NULL,
  matched_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_segment_memberships_exact UNIQUE(space_id,segment_id,profile_id),
  CONSTRAINT journey_identity_segment_memberships_segment_fk FOREIGN KEY(segment_id,space_id)
    REFERENCES journey_identity_segments(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_segment_memberships_version_fk FOREIGN KEY(segment_version_id,space_id)
    REFERENCES journey_identity_segment_versions(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_segment_memberships_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_identity_segment_memberships_canonical_fk FOREIGN KEY(canonical_profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_identity_segment_memberships_segment
  ON journey_identity_segment_memberships(space_id,segment_id,matched_at DESC,id);

CREATE TABLE journey_profile_privacy_states (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('analytics','personalisation','research_contact','marketing')),
  state TEXT NOT NULL CHECK(state IN ('unknown','granted','denied','suppressed')),
  lawful_basis TEXT CHECK(lawful_basis IS NULL OR length(lawful_basis) BETWEEN 1 AND 160),
  policy_reference TEXT CHECK(policy_reference IS NULL OR length(policy_reference) BETWEEN 1 AND 200),
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT journey_profile_privacy_states_pk PRIMARY KEY(space_id,profile_id,purpose),
  CONSTRAINT journey_profile_privacy_states_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE
);
CREATE INDEX journey_profile_privacy_states_profile
  ON journey_profile_privacy_states(space_id,profile_id,purpose);

CREATE TABLE journey_profile_export_jobs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('analytics','personalisation','research_contact','marketing')),
  format TEXT NOT NULL CHECK(format='json'),
  state TEXT NOT NULL CHECK(state='completed'),
  export_json JSONB NOT NULL,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_profile_export_jobs_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_profile_export_jobs_export_shape CHECK(
    jsonb_typeof(export_json)='object' AND octet_length(export_json::text)<=262144),
  CONSTRAINT journey_profile_export_jobs_completed_order CHECK(completed_at>=created_at)
);
CREATE INDEX journey_profile_export_jobs_profile
  ON journey_profile_export_jobs(space_id,profile_id,created_at DESC,id);

CREATE TABLE journey_profile_privacy_jobs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('suppress','erasure')),
  purpose TEXT CHECK(purpose IS NULL OR purpose IN ('analytics','personalisation','research_contact','marketing')),
  state TEXT NOT NULL CHECK(state IN ('queued','completed')),
  request_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT journey_profile_privacy_jobs_profile_fk FOREIGN KEY(profile_id,space_id)
    REFERENCES journey_identity_profiles(id,space_id) ON DELETE CASCADE,
  CONSTRAINT journey_profile_privacy_jobs_request_shape CHECK(
    jsonb_typeof(request_json)='object' AND octet_length(request_json::text)<=16384),
  CONSTRAINT journey_profile_privacy_jobs_result_shape CHECK(
    jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536),
  CONSTRAINT journey_profile_privacy_jobs_state_completed CHECK(
    (state='completed' AND completed_at IS NOT NULL) OR (state='queued' AND completed_at IS NULL))
);
CREATE INDEX journey_profile_privacy_jobs_profile
  ON journey_profile_privacy_jobs(space_id,profile_id,created_at DESC,id);

CREATE TABLE journey_identity_correction_runs (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('merge_command','late_source_fact','identity_command')),
  command_id TEXT NOT NULL CHECK(length(command_id) BETWEEN 1 AND 200),
  profile_ids_json JSONB NOT NULL,
  state TEXT NOT NULL CHECK(state='completed'),
  result_json JSONB NOT NULL,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_identity_correction_runs_profile_ids_shape CHECK(
    jsonb_typeof(profile_ids_json)='array' AND octet_length(profile_ids_json::text)<=16384),
  CONSTRAINT journey_identity_correction_runs_result_shape CHECK(
    jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536),
  CONSTRAINT journey_identity_correction_runs_completed_order CHECK(completed_at>=created_at)
);
CREATE INDEX journey_identity_correction_runs_space_history
  ON journey_identity_correction_runs(space_id,created_at DESC,id);
