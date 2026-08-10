-- Runtime schema 47: dedicated, scoped service authority and fenced lifecycle
-- for resumable privacy propagation. Secrets and raw subject identifiers never
-- enter these control-plane tables.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>46 THEN
    RAISE EXCEPTION 'runtime-47 journey privacy propagation requires runtime-46' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_privacy_service_principals (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  key_id TEXT NOT NULL UNIQUE CHECK(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  key_ref TEXT NOT NULL UNIQUE CHECK(key_ref ~ '^(kms|vault|external-file)://[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$'),
  state TEXT NOT NULL CHECK(state IN ('active','draining','revoked')),
  allowed_space_ids_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_space_ids_json)='array'
    AND jsonb_array_length(allowed_space_ids_json) BETWEEN 1 AND 100),
  allowed_regions_json JSONB NOT NULL CHECK(jsonb_typeof(allowed_regions_json)='array'
    AND jsonb_array_length(allowed_regions_json) BETWEEN 1 AND 32),
  not_before TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  CHECK(expires_at>not_before),CHECK(updated_at>=created_at)
);
CREATE INDEX journey_privacy_service_principals_active
  ON journey_privacy_service_principals(state,not_before,expires_at,key_id);

CREATE TABLE journey_privacy_service_key_audit (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  principal_id TEXT NOT NULL REFERENCES journey_privacy_service_principals(id) ON DELETE NO ACTION,
  action TEXT NOT NULL CHECK(action IN ('provisioned','rotation_started','rotation_activated','revoked')),
  previous_key_id_sha256 TEXT,resulting_key_id_sha256 TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),detail_json JSONB NOT NULL,
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL,
  CHECK(previous_key_id_sha256 IS NULL OR previous_key_id_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK(resulting_key_id_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK(jsonb_typeof(detail_json)='object' AND octet_length(detail_json::text)<=4096
    AND NOT(detail_json ?| ARRAY['secret','credential','token','keyRef','key_ref','payload','content','email','identifier','subject']))
);
CREATE INDEX journey_privacy_service_key_audit_history
  ON journey_privacy_service_key_audit(principal_id,created_at,id);

CREATE TABLE journey_privacy_erasure_authorities (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  privacy_job_id TEXT NOT NULL,legal_hold_state TEXT NOT NULL CHECK(legal_hold_state IN ('unknown','clear','active')),
  backup_state TEXT NOT NULL CHECK(backup_state IN ('unknown','not_applicable','deletion_scheduled','deletion_confirmed')),
  region_state TEXT NOT NULL CHECK(region_state IN ('unknown','not_applicable','deletion_scheduled','deletion_confirmed')),
  raw_erasure_state TEXT NOT NULL CHECK(raw_erasure_state IN ('awaiting_authority','authorized','completed')),
  authority_reference_sha256 TEXT CHECK(authority_reference_sha256 IS NULL OR authority_reference_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,revision INTEGER NOT NULL CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ,
  UNIQUE(space_id,privacy_job_id),
  FOREIGN KEY(privacy_job_id) REFERENCES journey_profile_privacy_jobs(id) ON DELETE NO ACTION,
  CHECK(updated_at>=created_at),
  CHECK((raw_erasure_state='awaiting_authority' AND completed_at IS NULL)
    OR (raw_erasure_state='authorized' AND completed_at IS NULL AND legal_hold_state='clear'
      AND backup_state<>'unknown' AND region_state<>'unknown' AND authority_reference_sha256 IS NOT NULL)
    OR (raw_erasure_state='completed' AND completed_at IS NOT NULL AND legal_hold_state='clear'
      AND backup_state IN ('not_applicable','deletion_confirmed')
      AND region_state IN ('not_applicable','deletion_confirmed') AND authority_reference_sha256 IS NOT NULL))
);
CREATE INDEX journey_privacy_erasure_authorities_backlog
  ON journey_privacy_erasure_authorities(raw_erasure_state,legal_hold_state,updated_at,space_id,id);

CREATE TABLE journey_privacy_propagation_claims (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 260),source_type TEXT NOT NULL CHECK(source_type IN ('privacy_job','correction_run')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
  operation TEXT NOT NULL CHECK(operation IN ('suppress','erasure','correction')),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','waiting','operator_required','completed')),
  available_at TIMESTAMPTZ NOT NULL,lease_owner_sha256 TEXT,lease_token_sha256 TEXT,
  lease_generation BIGINT NOT NULL DEFAULT 0 CHECK(lease_generation>=0),lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 1000),
  checkpoint_json JSONB NOT NULL,checkpoint_sha256 TEXT NOT NULL CHECK(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ,
  UNIQUE(source_type,source_id),UNIQUE(id,space_id),
  CHECK(jsonb_typeof(checkpoint_json)='object' AND octet_length(checkpoint_json::text)<=32768
    AND checkpoint_json::text !~* '"(payload|content|email|identifier|profileId|profile_id|subjectId|subject_id|secret|token)"[[:space:]]*:'),
  CHECK(lease_owner_sha256 IS NULL OR lease_owner_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK(lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK((state='leased' AND lease_owner_sha256 IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner_sha256 IS NULL AND lease_token_sha256 IS NULL AND lease_expires_at IS NULL)),
  CHECK((state='completed')=(completed_at IS NOT NULL)),CHECK(updated_at>=created_at)
);
CREATE INDEX journey_privacy_propagation_claim
  ON journey_privacy_propagation_claims(state,available_at,lease_expires_at,created_at,id);

CREATE TABLE journey_privacy_propagation_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),claim_id TEXT NOT NULL,space_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('claimed','checkpointed','waiting','operator_required','completed','lease_expired')),
  lease_generation BIGINT NOT NULL CHECK(lease_generation>0),revision INTEGER NOT NULL CHECK(revision>0),
  detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(claim_id,space_id) REFERENCES journey_privacy_propagation_claims(id,space_id) ON DELETE NO ACTION,
  UNIQUE(claim_id,lease_generation,revision,event)
);
CREATE INDEX journey_privacy_propagation_events_history
  ON journey_privacy_propagation_events(space_id,claim_id,lease_generation,revision,id);

CREATE OR REPLACE FUNCTION journey_privacy_principal_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $scope$
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.allowed_space_ids_json) value
      WHERE jsonb_typeof(value)<>'string' OR length(value#>>'{}') NOT BETWEEN 1 AND 128)
    OR (SELECT COUNT(*) FROM jsonb_array_elements_text(NEW.allowed_space_ids_json))<>
       (SELECT COUNT(DISTINCT value) FROM jsonb_array_elements_text(NEW.allowed_space_ids_json) value)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.allowed_space_ids_json) value
      WHERE NOT EXISTS(SELECT 1 FROM spaces WHERE spaces.id=value))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.allowed_regions_json) value
      WHERE value !~ '^[A-Z][A-Z0-9-]{1,31}$')
    OR (SELECT COUNT(*) FROM jsonb_array_elements_text(NEW.allowed_regions_json))<>
       (SELECT COUNT(DISTINCT value) FROM jsonb_array_elements_text(NEW.allowed_regions_json) value) THEN
    RAISE EXCEPTION 'privacy principal scope is invalid' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $scope$;
CREATE TRIGGER journey_privacy_principal_scope BEFORE INSERT OR UPDATE ON journey_privacy_service_principals
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_principal_scope_guard();

CREATE OR REPLACE FUNCTION journey_privacy_authority_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $scope$
DECLARE job_space TEXT;job_operation TEXT;
BEGIN
  SELECT space_id,operation INTO job_space,job_operation FROM journey_profile_privacy_jobs WHERE id=NEW.privacy_job_id;
  IF job_space IS NULL OR job_space<>NEW.space_id OR job_operation<>'erasure' THEN
    RAISE EXCEPTION 'erasure authority must bind the tenant erasure job' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $scope$;
CREATE TRIGGER journey_privacy_authority_scope BEFORE INSERT OR UPDATE ON journey_privacy_erasure_authorities
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_authority_scope_guard();

CREATE OR REPLACE FUNCTION journey_privacy_runtime47_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'runtime-47 privacy authority history cannot be deleted' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME IN ('journey_privacy_service_key_audit','journey_privacy_propagation_events') THEN
    RAISE EXCEPTION 'runtime47 privacy history is append-only' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='journey_privacy_service_principals' THEN
    IF NEW.id<>OLD.id OR NEW.key_id<>OLD.key_id OR NEW.key_ref<>OLD.key_ref
      OR NEW.allowed_space_ids_json<>OLD.allowed_space_ids_json OR NEW.allowed_regions_json<>OLD.allowed_regions_json
      OR NEW.not_before<>OLD.not_before OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at
      OR OLD.state='revoked' OR NOT((OLD.state='active' AND NEW.state IN ('draining','revoked'))
        OR (OLD.state='draining' AND NEW.state='revoked')) OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'invalid privacy principal lifecycle' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='journey_privacy_erasure_authorities' THEN
    IF NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.privacy_job_id<>OLD.privacy_job_id OR NEW.created_at<>OLD.created_at
      OR OLD.raw_erasure_state='completed' OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'invalid privacy erasure authority lifecycle' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='journey_privacy_propagation_claims' THEN
    IF NEW.id<>OLD.id OR NEW.source_type<>OLD.source_type OR NEW.source_id<>OLD.source_id OR NEW.space_id<>OLD.space_id
      OR NEW.operation<>OLD.operation OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'invalid privacy claim lifecycle' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_privacy_principal_guard BEFORE UPDATE OR DELETE ON journey_privacy_service_principals
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_runtime47_guard();
CREATE TRIGGER journey_privacy_key_audit_guard BEFORE UPDATE OR DELETE ON journey_privacy_service_key_audit
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_runtime47_guard();
CREATE TRIGGER journey_privacy_authority_guard BEFORE UPDATE OR DELETE ON journey_privacy_erasure_authorities
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_runtime47_guard();
CREATE TRIGGER journey_privacy_claim_guard BEFORE UPDATE OR DELETE ON journey_privacy_propagation_claims
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_runtime47_guard();
CREATE TRIGGER journey_privacy_event_guard BEFORE UPDATE OR DELETE ON journey_privacy_propagation_events
  FOR EACH ROW EXECUTE FUNCTION journey_privacy_runtime47_guard();

CREATE OR REPLACE FUNCTION journey_privacy_erasure_ready(p_principal_id TEXT,p_privacy_job_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $ready$
  SELECT EXISTS(SELECT 1 FROM public.journey_privacy_service_principals principal
    JOIN public.journey_profile_privacy_jobs job ON job.id=p_privacy_job_id
    JOIN public.journey_privacy_erasure_authorities authority
      ON authority.privacy_job_id=job.id AND authority.space_id=job.space_id
    WHERE principal.id=p_principal_id AND principal.state IN ('active','draining')
      AND principal.allowed_space_ids_json ? job.space_id AND job.operation='erasure'
      AND authority.raw_erasure_state='completed' AND authority.legal_hold_state='clear'
      AND authority.backup_state IN ('not_applicable','deletion_confirmed')
      AND authority.region_state IN ('not_applicable','deletion_confirmed'))
$ready$;

CREATE OR REPLACE FUNCTION journey_privacy_claim(
  p_principal_id TEXT,p_owner_sha256 TEXT,p_lease_token_sha256 TEXT,p_now TIMESTAMPTZ,p_lease_seconds INTEGER)
RETURNS SETOF journey_privacy_propagation_claims LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $claim$
DECLARE principal journey_privacy_service_principals%ROWTYPE;candidate journey_privacy_propagation_claims%ROWTYPE;
BEGIN
  SELECT * INTO principal FROM public.journey_privacy_service_principals WHERE id=p_principal_id FOR UPDATE;
  IF principal.id IS NULL OR principal.state<>'active' OR p_now<principal.not_before OR p_now>=principal.expires_at
    OR p_owner_sha256 !~ '^[a-f0-9]{64}$' OR p_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'privacy service authority is invalid' USING ERRCODE='42501'; END IF;

  FOR candidate IN SELECT claim.* FROM public.journey_privacy_propagation_claims claim
    WHERE claim.state='operator_required' AND claim.operation='erasure'
      AND claim.checkpoint_json->>'status'='operator_required'
      AND (claim.checkpoint_json->>'cursor') ~ '^[0-9]+$' AND (claim.checkpoint_json->>'cursor')::integer>=9
      AND principal.allowed_space_ids_json ? claim.space_id
      AND public.journey_privacy_erasure_ready(principal.id,claim.source_id)
    ORDER BY claim.created_at,claim.id FOR UPDATE OF claim
  LOOP
    UPDATE public.journey_privacy_propagation_claims SET state='waiting',available_at=p_now,revision=revision+1,updated_at=p_now
      WHERE id=candidate.id RETURNING * INTO candidate;
    UPDATE public.journey_profile_privacy_jobs SET result_json=jsonb_set(result_json,'{privacyPropagation,status}','"running"',false)
      WHERE id=candidate.source_id AND space_id=candidate.space_id;
    INSERT INTO public.journey_privacy_propagation_events(id,claim_id,space_id,event,lease_generation,revision,detail_sha256,created_at)
      VALUES(gen_random_uuid()::text,candidate.id,candidate.space_id,'waiting',candidate.lease_generation,candidate.revision,repeat('0',64),p_now);
  END LOOP;

  WITH expired AS (UPDATE public.journey_privacy_propagation_claims claim SET state='waiting',available_at=p_now,
    lease_owner_sha256=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=p_now
    WHERE claim.state='leased' AND claim.lease_expires_at<=p_now AND principal.allowed_space_ids_json ? claim.space_id
    RETURNING claim.*)
  INSERT INTO public.journey_privacy_propagation_events(id,claim_id,space_id,event,lease_generation,revision,detail_sha256,created_at)
    SELECT gen_random_uuid()::text,id,space_id,'lease_expired',lease_generation,revision,repeat('0',64),p_now FROM expired;

  INSERT INTO public.journey_privacy_propagation_claims(id,source_type,source_id,space_id,operation,state,available_at,
    lease_generation,attempt_count,checkpoint_json,checkpoint_sha256,revision,created_at,updated_at)
  SELECT 'privacy_job:'||job.id,'privacy_job',job.id,job.space_id,job.operation,'pending',p_now,0,0,
    '{}'::jsonb,repeat('0',64),1,p_now,p_now
  FROM public.journey_profile_privacy_jobs job WHERE job.state='queued' AND principal.allowed_space_ids_json ? job.space_id
  ON CONFLICT(source_type,source_id) DO NOTHING;

  INSERT INTO public.journey_privacy_propagation_claims(id,source_type,source_id,space_id,operation,state,available_at,
    lease_generation,attempt_count,checkpoint_json,checkpoint_sha256,revision,created_at,updated_at)
  SELECT 'correction_run:'||run.id,'correction_run',run.id,run.space_id,'correction','pending',p_now,0,0,
    '{}'::jsonb,repeat('0',64),1,p_now,p_now
  FROM public.journey_identity_correction_runs run WHERE principal.allowed_space_ids_json ? run.space_id
    AND COALESCE(run.result_json->'privacyPropagation'->>'status','running') NOT IN ('completed','operator_required')
  ON CONFLICT(source_type,source_id) DO NOTHING;

  SELECT * INTO candidate FROM public.journey_privacy_propagation_claims claim
    WHERE claim.state IN ('pending','waiting') AND claim.available_at<=p_now
      AND principal.allowed_space_ids_json ? claim.space_id
    ORDER BY CASE WHEN claim.state='pending' THEN 0 ELSE 1 END,claim.available_at,claim.created_at,claim.id
    FOR UPDATE SKIP LOCKED LIMIT 1;
  IF candidate.id IS NULL THEN RETURN; END IF;
  UPDATE public.journey_privacy_propagation_claims SET state='leased',lease_owner_sha256=p_owner_sha256,
    lease_token_sha256=p_lease_token_sha256,lease_generation=lease_generation+1,
    lease_expires_at=p_now+(p_lease_seconds||' seconds')::interval,attempt_count=attempt_count+1,
    revision=revision+1,updated_at=p_now WHERE id=candidate.id RETURNING * INTO candidate;
  INSERT INTO public.journey_privacy_propagation_events(id,claim_id,space_id,event,lease_generation,revision,detail_sha256,created_at)
    VALUES(gen_random_uuid()::text,candidate.id,candidate.space_id,'claimed',candidate.lease_generation,candidate.revision,repeat('0',64),p_now);
  RETURN NEXT candidate;
END $claim$;

CREATE OR REPLACE FUNCTION journey_privacy_checkpoint(
  p_principal_id TEXT,p_claim_id TEXT,p_generation BIGINT,p_lease_token_sha256 TEXT,p_expected_revision INTEGER,
  p_state TEXT,p_checkpoint JSONB,p_checkpoint_sha256 TEXT,p_available_at TIMESTAMPTZ,p_now TIMESTAMPTZ)
RETURNS journey_privacy_propagation_claims LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $checkpoint$
DECLARE principal journey_privacy_service_principals%ROWTYPE;claim journey_privacy_propagation_claims%ROWTYPE;
  authority journey_privacy_erasure_authorities%ROWTYPE;event_name TEXT;
BEGIN
  SELECT * INTO principal FROM public.journey_privacy_service_principals WHERE id=p_principal_id;
  SELECT * INTO claim FROM public.journey_privacy_propagation_claims WHERE id=p_claim_id FOR UPDATE;
  IF principal.id IS NULL OR principal.state NOT IN ('active','draining') OR p_now<principal.not_before OR p_now>=principal.expires_at
    OR claim.id IS NULL OR NOT(principal.allowed_space_ids_json ? claim.space_id) OR claim.state<>'leased'
    OR claim.lease_generation<>p_generation OR claim.lease_token_sha256<>p_lease_token_sha256 OR claim.revision<>p_expected_revision
    OR claim.lease_expires_at<=p_now THEN RAISE EXCEPTION 'privacy claim fence is invalid' USING ERRCODE='40001'; END IF;
  IF p_state NOT IN ('pending','waiting','operator_required','completed') OR p_checkpoint_sha256 !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_checkpoint)<>'object' OR octet_length(p_checkpoint::text)>32768
    OR p_checkpoint::text ~* '"(payload|content|email|identifier|profileId|profile_id|subjectId|subject_id|secret|token)"[[:space:]]*:'
    THEN RAISE EXCEPTION 'privacy checkpoint is invalid' USING ERRCODE='22023'; END IF;
  IF p_state='completed' AND claim.operation='erasure' THEN
    SELECT * INTO authority FROM public.journey_privacy_erasure_authorities
      WHERE space_id=claim.space_id AND privacy_job_id=claim.source_id;
    IF authority.id IS NULL OR authority.raw_erasure_state<>'completed' OR authority.legal_hold_state<>'clear'
      OR authority.backup_state NOT IN ('not_applicable','deletion_confirmed')
      OR authority.region_state NOT IN ('not_applicable','deletion_confirmed') THEN
      RAISE EXCEPTION 'physical erasure authority is incomplete' USING ERRCODE='42501'; END IF;
  END IF;
  UPDATE public.journey_privacy_propagation_claims SET state=p_state,available_at=COALESCE(p_available_at,p_now),
    lease_owner_sha256=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,checkpoint_json=p_checkpoint,
    checkpoint_sha256=p_checkpoint_sha256,revision=revision+1,updated_at=p_now,completed_at=CASE WHEN p_state='completed' THEN p_now ELSE NULL END
    WHERE id=claim.id RETURNING * INTO claim;
  IF claim.source_type='privacy_job' THEN
    UPDATE public.journey_profile_privacy_jobs SET result_json=jsonb_set(result_json,'{privacyPropagation}',p_checkpoint,true),
      state=CASE WHEN p_state='completed' THEN 'completed' ELSE state END,
      completed_at=CASE WHEN p_state='completed' THEN p_now ELSE completed_at END WHERE id=claim.source_id AND space_id=claim.space_id;
  ELSE
    UPDATE public.journey_identity_correction_runs SET result_json=jsonb_set(result_json,'{privacyPropagation}',p_checkpoint,true)
      WHERE id=claim.source_id AND space_id=claim.space_id;
  END IF;
  event_name:=CASE p_state WHEN 'completed' THEN 'completed' WHEN 'operator_required' THEN 'operator_required'
    WHEN 'waiting' THEN 'waiting' ELSE 'checkpointed' END;
  INSERT INTO public.journey_privacy_propagation_events(id,claim_id,space_id,event,lease_generation,revision,detail_sha256,created_at)
    VALUES(gen_random_uuid()::text,claim.id,claim.space_id,event_name,claim.lease_generation,claim.revision,p_checkpoint_sha256,p_now);
  RETURN claim;
END $checkpoint$;

REVOKE ALL ON FUNCTION journey_privacy_runtime47_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_privacy_principal_scope_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_privacy_authority_scope_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_privacy_erasure_ready(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_privacy_claim(TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION journey_privacy_checkpoint(TEXT,TEXT,BIGINT,TEXT,INTEGER,TEXT,JSONB,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON journey_privacy_service_principals,journey_privacy_service_key_audit,
  journey_privacy_erasure_authorities,journey_privacy_propagation_claims,journey_privacy_propagation_events FROM PUBLIC;
