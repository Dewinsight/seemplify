-- Runtime schema 40: durable five-level journey kill switches.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>39 THEN
    RAISE EXCEPTION 'runtime-40 journey kill switch requires runtime-39' USING ERRCODE='55000';
  END IF;
END $predecessor$;

-- Effective state per scope. Platform is global and tenant-free; every other
-- level is tenant bound, so a space manager can never author a row that another
-- tenant resolves.
CREATE TABLE journey_kill_switch_states (
  id TEXT PRIMARY KEY,
  scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 128),
  state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('operational_incident','safety_incident','compliance_hold',
    'maintenance','cost_control','governance_review','recovery_verified')),
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_kill_switch_states_platform_shape CHECK(
    (scope_level='platform' AND space_id IS NULL AND scope_key='platform')
    OR (scope_level<>'platform' AND space_id IS NOT NULL)),
  CONSTRAINT journey_kill_switch_states_space_shape CHECK(scope_level<>'space' OR scope_key=space_id),
  CONSTRAINT journey_kill_switch_states_profile_shape CHECK(
    scope_level<>'profile' OR scope_key ~ '^[a-f0-9]{64}$'),
  CHECK(updated_at>=created_at)
);
-- NULL space_id is distinct under a plain UNIQUE, so the platform singleton and
-- the tenant scopes need separate partial indexes.
CREATE UNIQUE INDEX journey_kill_switch_platform_singleton
  ON journey_kill_switch_states(scope_level) WHERE scope_level='platform';
CREATE UNIQUE INDEX journey_kill_switch_tenant_scope
  ON journey_kill_switch_states(scope_level,space_id,scope_key) WHERE space_id IS NOT NULL;

-- One row per accepted mutation. The idempotency key makes a retried disable
-- replay its recorded outcome instead of pausing a second cohort of work.
CREATE TABLE journey_kill_switch_mutations (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL REFERENCES journey_kill_switch_states(id) ON DELETE NO ACTION,
  scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
  space_id TEXT REFERENCES spaces(id) ON DELETE NO ACTION,
  scope_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  requested_state TEXT NOT NULL CHECK(requested_state IN ('enabled','disabled')),
  resulting_revision INTEGER NOT NULL CHECK(resulting_revision>0),
  paused_count INTEGER NOT NULL CHECK(paused_count>=0),
  released_lease_count INTEGER NOT NULL CHECK(released_lease_count>=0),
  resumed_count INTEGER NOT NULL CHECK(resumed_count>=0),
  still_disabled_count INTEGER NOT NULL CHECK(still_disabled_count>=0),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_kill_switch_mutation_idempotency UNIQUE(state_id,idempotency_key)
);
CREATE INDEX journey_kill_switch_mutation_list
  ON journey_kill_switch_mutations(state_id,created_at DESC,id);

-- What a disable did to work that was already in flight. Immutable, so recovery
-- can never be replayed against a rewritten history.
CREATE TABLE journey_kill_switch_pauses (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL REFERENCES journey_kill_switch_states(id) ON DELETE NO ACTION,
  mutation_id TEXT NOT NULL REFERENCES journey_kill_switch_mutations(id) ON DELETE NO ACTION,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  queue_id TEXT NOT NULL,
  previous_state TEXT NOT NULL CHECK(previous_state IN ('ready','retry_scheduled','leased')),
  lease_released INTEGER NOT NULL CHECK(lease_released IN (0,1)),
  fencing_token INTEGER NOT NULL CHECK(fencing_token>=0),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('platform_kill_switch','space_kill_switch',
    'workflow_kill_switch','adapter_kill_switch','profile_kill_switch')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_kill_switch_pause_once UNIQUE(mutation_id,queue_id),
  CONSTRAINT journey_kill_switch_pause_queue_fk FOREIGN KEY(queue_id,space_id)
    REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
  CONSTRAINT journey_kill_switch_pause_lease_shape CHECK(
    (previous_state='leased' AND lease_released=1) OR (previous_state<>'leased' AND lease_released=0))
);
CREATE INDEX journey_kill_switch_pause_open
  ON journey_kill_switch_pauses(state_id,space_id,queue_id,id);

-- Recovery is explicit: a paused row is only ever consumed once, and the
-- outcome records why work was not requeued.
CREATE TABLE journey_kill_switch_resumptions (
  id TEXT PRIMARY KEY,
  pause_id TEXT NOT NULL REFERENCES journey_kill_switch_pauses(id) ON DELETE NO ACTION,
  mutation_id TEXT NOT NULL REFERENCES journey_kill_switch_mutations(id) ON DELETE NO ACTION,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  queue_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('requeued','skipped_state_changed','skipped_terminal','skipped_missing')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_kill_switch_resumption_once UNIQUE(pause_id)
);
CREATE INDEX journey_kill_switch_resumption_list
  ON journey_kill_switch_resumptions(mutation_id,queue_id,id);

-- Content-safe audit. A kill switch is operated during incidents, so the audit
-- must survive being read widely: it carries scope identity, authority and
-- counts, never the payload or the person the paused work was about. The
-- top-level key guard is a backstop under the recursive check in the domain.
CREATE TABLE journey_kill_switch_audit (
  id TEXT PRIMARY KEY,
  space_id TEXT REFERENCES spaces(id) ON DELETE NO ACTION,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  authority TEXT NOT NULL CHECK(authority IN ('platform_admin','space_manager')),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
  scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
  scope_key TEXT NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 128),
  detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT journey_kill_switch_audit_content_safe CHECK(NOT (detail_json ?| ARRAY[
    'payload','payloadJson','payload_json','content','body','message','subject','subjectId','recipient',
    'email','identifier','identifiers','secret','token','credential','apiKey','api_key'])),
  CONSTRAINT journey_kill_switch_audit_platform_shape CHECK(
    scope_level<>'platform' OR space_id IS NULL)
);
CREATE INDEX journey_kill_switch_audit_list
  ON journey_kill_switch_audit(space_id,created_at DESC,id);

CREATE TRIGGER journey_kill_switch_mutations_append_only
  BEFORE UPDATE OR DELETE ON journey_kill_switch_mutations
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_kill_switch_pauses_append_only
  BEFORE UPDATE OR DELETE ON journey_kill_switch_pauses
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_kill_switch_resumptions_append_only
  BEFORE UPDATE OR DELETE ON journey_kill_switch_resumptions
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
CREATE TRIGGER journey_kill_switch_audit_append_only
  BEFORE UPDATE OR DELETE ON journey_kill_switch_audit
  FOR EACH ROW EXECUTE FUNCTION journey_orchestration_append_only_guard();
