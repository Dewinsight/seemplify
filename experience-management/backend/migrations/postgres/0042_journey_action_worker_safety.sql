-- Runtime schema 42: durable service authority and fenced worker safety reservations.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>41 THEN
    RAISE EXCEPTION 'runtime-42 journey action worker safety requires runtime-41' USING ERRCODE='55000';
  END IF;
END $predecessor$;

-- Secrets never enter this database. key_ref names an external KMS/vault resolver entry.
CREATE TABLE journey_worker_service_principals (
  id TEXT PRIMARY KEY, key_id TEXT NOT NULL UNIQUE CHECK(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  key_ref TEXT NOT NULL UNIQUE CHECK(key_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'),
  state TEXT NOT NULL CHECK(state IN ('active','draining','revoked')),
  allowed_space_ids_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_space_ids_json)='array'
    AND jsonb_array_length(allowed_space_ids_json) BETWEEN 1 AND 100),
  allowed_adapters_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_adapters_json)='array'
    AND jsonb_array_length(allowed_adapters_json) BETWEEN 1 AND 5),
  not_before TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL, CHECK(expires_at>not_before), CHECK(updated_at>=created_at)
);
CREATE INDEX journey_worker_service_principals_state ON journey_worker_service_principals(state,not_before,expires_at,key_id);
CREATE TABLE journey_worker_service_key_audit (
  id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES journey_worker_service_principals(id) ON DELETE NO ACTION,
  action TEXT NOT NULL CHECK(action IN ('provisioned','rotated','draining','revoked')),
  previous_key_id_sha256 TEXT, resulting_key_id_sha256 TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), detail_json JSONB NOT NULL CHECK(jsonb_typeof(detail_json)='object'
    AND NOT (detail_json ?| ARRAY['secret','credential','token','keyRef','key_ref','payload','content','recipient','email'])),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL,
  CHECK(previous_key_id_sha256 IS NULL OR previous_key_id_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK(resulting_key_id_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX journey_worker_service_key_audit_history ON journey_worker_service_key_audit(principal_id,created_at,id);

CREATE TABLE journey_action_live_contexts (
  queue_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, profile_ref_sha256 TEXT NOT NULL CHECK(profile_ref_sha256 ~ '^[a-f0-9]{64}$'),
  purpose_key TEXT NOT NULL CHECK(length(purpose_key) BETWEEN 1 AND 128), source_key TEXT NOT NULL CHECK(length(source_key) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL, FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION
);
CREATE INDEX journey_action_live_context_subject ON journey_action_live_contexts(space_id,profile_ref_sha256,purpose_key,queue_id);
CREATE TABLE journey_action_subject_controls (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, profile_ref_sha256 TEXT NOT NULL CHECK(profile_ref_sha256 ~ '^[a-f0-9]{64}$'),
  purpose_key TEXT NOT NULL, consent_state TEXT NOT NULL CHECK(consent_state IN ('granted','denied','unknown')),
  suppressed BOOLEAN NOT NULL DEFAULT FALSE, quiet_timezone TEXT NOT NULL,
  quiet_start_minute INTEGER NOT NULL CHECK(quiet_start_minute BETWEEN 0 AND 1439),
  quiet_end_minute INTEGER NOT NULL CHECK(quiet_end_minute BETWEEN 0 AND 1439),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,profile_ref_sha256,purpose_key)
);
CREATE TABLE journey_action_source_controls (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','paused','retired','unknown')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,source_key)
);

CREATE TABLE journey_action_quota_counters (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, meter TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
  consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,meter,period_start), CHECK(period_end>period_start)
);
CREATE TABLE journey_action_frequency_counters (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, profile_ref_sha256 TEXT NOT NULL CHECK(profile_ref_sha256 ~ '^[a-f0-9]{64}$'),
  purpose_key TEXT NOT NULL, period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
  consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0), updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,profile_ref_sha256,purpose_key,period_start), CHECK(period_end>period_start)
);
CREATE TABLE journey_action_worker_reservations (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, space_id TEXT NOT NULL,
  profile_ref_sha256 TEXT NOT NULL CHECK(profile_ref_sha256 ~ '^[a-f0-9]{64}$'), purpose_key TEXT NOT NULL, meter TEXT NOT NULL,
  quota_period_start TIMESTAMPTZ NOT NULL, quota_period_end TIMESTAMPTZ NOT NULL,
  frequency_period_start TIMESTAMPTZ NOT NULL, frequency_period_end TIMESTAMPTZ NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0), quota_limit_snapshot INTEGER NOT NULL CHECK(quota_limit_snapshot>=0),
  frequency_limit_snapshot INTEGER NOT NULL CHECK(frequency_limit_snapshot>=0),
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released','expired')),
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0), lease_token_sha256 TEXT NOT NULL CHECK(lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  lease_expires_at TIMESTAMPTZ NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
  CHECK(quota_period_end>quota_period_start), CHECK(frequency_period_end>frequency_period_start), CHECK(updated_at>=created_at)
);
CREATE UNIQUE INDEX journey_action_worker_reservation_fence ON journey_action_worker_reservations(queue_id,fencing_token);
CREATE UNIQUE INDEX journey_action_worker_reservation_active ON journey_action_worker_reservations(queue_id) WHERE state='reserved';
CREATE INDEX journey_action_worker_reservations_reap ON journey_action_worker_reservations(state,lease_expires_at,space_id,queue_id);
CREATE TABLE journey_action_worker_reservation_events (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES journey_action_worker_reservations(id) ON DELETE NO ACTION,
  queue_id TEXT NOT NULL, space_id TEXT NOT NULL, event TEXT NOT NULL CHECK(event IN ('reserved','consumed','released','expired')),
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0), detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX journey_action_worker_reservation_events_history ON journey_action_worker_reservation_events(space_id,queue_id,created_at,id);

-- Serialize subscription changes without granting the worker UPDATE authority
-- over the platform plan control plane.
CREATE OR REPLACE FUNCTION journey_worker_subscription_snapshot(p_space_id TEXT)
RETURNS TABLE(id TEXT,plan_code TEXT,status TEXT) LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public AS $subscription$
  SELECT subscription.id,subscription.plan_code,subscription.status
  FROM public.platform_subscriptions subscription WHERE subscription.space_id=p_space_id
  FOR UPDATE
$subscription$;
REVOKE ALL ON FUNCTION journey_worker_subscription_snapshot(TEXT) FROM PUBLIC;
CREATE OR REPLACE FUNCTION journey_worker_lock_space(p_space_id TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $space_mutex$
  SELECT EXISTS(SELECT 1 FROM public.spaces space_row WHERE space_row.id=p_space_id FOR UPDATE)
$space_mutex$;
REVOKE ALL ON FUNCTION journey_worker_lock_space(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION journey_worker_safety_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN
  RAISE EXCEPTION 'Journey worker safety history is append-only' USING ERRCODE='55000';
END $guard$;
CREATE TRIGGER journey_worker_service_key_audit_append_only BEFORE UPDATE OR DELETE ON journey_worker_service_key_audit
  FOR EACH ROW EXECUTE FUNCTION journey_worker_safety_append_only_guard();
CREATE TRIGGER journey_action_live_contexts_append_only BEFORE UPDATE OR DELETE ON journey_action_live_contexts
  FOR EACH ROW EXECUTE FUNCTION journey_worker_safety_append_only_guard();
CREATE TRIGGER journey_action_worker_reservation_events_append_only BEFORE UPDATE OR DELETE ON journey_action_worker_reservation_events
  FOR EACH ROW EXECUTE FUNCTION journey_worker_safety_append_only_guard();
REVOKE ALL ON FUNCTION journey_worker_safety_append_only_guard() FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON journey_worker_service_principals,journey_worker_service_key_audit,
  journey_action_live_contexts,journey_action_subject_controls,journey_action_source_controls,
  journey_action_quota_counters,journey_action_frequency_counters,journey_action_worker_reservations,
  journey_action_worker_reservation_events FROM PUBLIC;

-- A principal's identity and its external key reference are settled at
-- provisioning. Rotation may drain it and revocation may end it, but nothing can
-- edit a live principal into pointing at different material.
CREATE OR REPLACE FUNCTION journey_worker_service_principal_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql AS $principal_lifecycle$ BEGIN
  IF NEW.id<>OLD.id OR NEW.key_id<>OLD.key_id OR NEW.key_ref<>OLD.key_ref
    OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'A service principal identity and key reference are immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state='revoked' THEN
    RAISE EXCEPTION 'A revoked service principal is terminal' USING ERRCODE='55000';
  END IF;
  IF NOT ((OLD.state='active' AND NEW.state IN ('active','draining','revoked'))
    OR (OLD.state='draining' AND NEW.state IN ('draining','revoked'))) THEN
    RAISE EXCEPTION 'Service principal lifecycle transition is not permitted' USING ERRCODE='55000';
  END IF;
  IF NEW.revision<OLD.revision OR (NEW.state<>OLD.state AND NEW.revision<>OLD.revision+1) THEN
    RAISE EXCEPTION 'Service principal revisions advance by exactly one' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $principal_lifecycle$;
REVOKE ALL ON FUNCTION journey_worker_service_principal_lifecycle_guard() FROM PUBLIC;
CREATE TRIGGER journey_worker_service_principals_lifecycle BEFORE UPDATE ON journey_worker_service_principals
  FOR EACH ROW EXECUTE FUNCTION journey_worker_service_principal_lifecycle_guard();

-- Fencing is enforced here rather than trusted from the caller: a queue row's
-- tokens only ever climb, work that already produced a no-effect receipt cannot
-- take fresh capacity, and a reservation settles exactly once.
CREATE OR REPLACE FUNCTION journey_action_worker_reservation_fence_guard()
RETURNS trigger LANGUAGE plpgsql AS $reservation_fence$
DECLARE highest BIGINT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'reserved' THEN
      RAISE EXCEPTION 'A journey action reservation opens in the reserved state' USING ERRCODE='55000';
    END IF;
    SELECT MAX(fencing_token) INTO highest FROM journey_action_worker_reservations
      WHERE space_id=NEW.space_id AND queue_id=NEW.queue_id;
    IF highest IS NOT NULL AND NEW.fencing_token<=highest THEN
      RAISE EXCEPTION 'A journey action reservation cannot reuse or rewind a fencing token'
        USING ERRCODE='55000';
    END IF;
    IF EXISTS (SELECT 1 FROM journey_action_effect_receipts receipt
      WHERE receipt.queue_id=NEW.queue_id AND receipt.space_id=NEW.space_id) THEN
      RAISE EXCEPTION 'A settled journey action cannot take a further safety reservation'
        USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.queue_id<>OLD.queue_id OR NEW.space_id<>OLD.space_id
    OR NEW.fencing_token<>OLD.fencing_token OR NEW.lease_token_sha256<>OLD.lease_token_sha256
    OR NEW.profile_ref_sha256<>OLD.profile_ref_sha256 OR NEW.purpose_key<>OLD.purpose_key
    OR NEW.meter<>OLD.meter OR NEW.quantity<>OLD.quantity
    OR NEW.quota_period_start<>OLD.quota_period_start
    OR NEW.frequency_period_start<>OLD.frequency_period_start OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'A journey action reservation binding is immutable once taken' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'reserved' THEN
    RAISE EXCEPTION 'A settled journey action reservation cannot be settled again' USING ERRCODE='55000';
  END IF;
  IF NEW.state NOT IN ('consumed','released','expired') THEN
    RAISE EXCEPTION 'A journey action reservation settles as consumed, released, or expired'
      USING ERRCODE='55000';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Journey action reservation revisions advance by exactly one' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $reservation_fence$;
REVOKE ALL ON FUNCTION journey_action_worker_reservation_fence_guard() FROM PUBLIC;
CREATE TRIGGER journey_action_worker_reservations_fenced
  BEFORE INSERT OR UPDATE ON journey_action_worker_reservations
  FOR EACH ROW EXECUTE FUNCTION journey_action_worker_reservation_fence_guard();

-- Counter windows are immutable once opened and consumption is monotonic, so a
-- late or replayed worker cannot rewind spent capacity or widen a cap after the
-- fact. Held capacity may still fall when a reservation is released or expires.
CREATE OR REPLACE FUNCTION journey_action_safety_counter_guard()
RETURNS trigger LANGUAGE plpgsql AS $safety_counter$ BEGIN
  IF NEW.space_id<>OLD.space_id OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end THEN
    RAISE EXCEPTION 'A journey action safety counter window is immutable once opened' USING ERRCODE='55000';
  END IF;
  IF NEW.consumed_quantity<OLD.consumed_quantity THEN
    RAISE EXCEPTION 'Journey action safety consumption never moves backwards' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $safety_counter$;
REVOKE ALL ON FUNCTION journey_action_safety_counter_guard() FROM PUBLIC;
CREATE TRIGGER journey_action_quota_counters_monotonic BEFORE UPDATE ON journey_action_quota_counters
  FOR EACH ROW EXECUTE FUNCTION journey_action_safety_counter_guard();
CREATE TRIGGER journey_action_frequency_counters_monotonic BEFORE UPDATE ON journey_action_frequency_counters
  FOR EACH ROW EXECUTE FUNCTION journey_action_safety_counter_guard();
