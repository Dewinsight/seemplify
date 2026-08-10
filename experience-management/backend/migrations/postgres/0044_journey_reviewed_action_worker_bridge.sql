-- Runtime schema 44: canonical reviewed-effect settlement for the durable journey action worker.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>43 THEN
    RAISE EXCEPTION 'runtime-44 reviewed action worker bridge requires runtime-43' USING ERRCODE='55000';
  END IF;
END $predecessor$;

-- Runtime 38 owns reviewed-effect receipts. Runtime 42 originally fenced only
-- its deterministic no-effect receipt; a reviewed receipt must be equally
-- terminal before a new reservation can be admitted.
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
      RAISE EXCEPTION 'A journey action reservation cannot reuse or rewind a fencing token' USING ERRCODE='55000';
    END IF;
    IF EXISTS (SELECT 1 FROM journey_action_effect_receipts receipt
        WHERE receipt.queue_id=NEW.queue_id AND receipt.space_id=NEW.space_id)
      OR EXISTS (SELECT 1 FROM journey_adapter_effect_receipts receipt
        WHERE receipt.queue_id=NEW.queue_id AND receipt.space_id=NEW.space_id) THEN
      RAISE EXCEPTION 'A settled journey action cannot take a further safety reservation' USING ERRCODE='55000';
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
    RAISE EXCEPTION 'A journey action reservation settles as consumed, released, or expired' USING ERRCODE='55000';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Journey action reservation revisions advance by exactly one' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $reservation_fence$;
REVOKE ALL ON FUNCTION journey_action_worker_reservation_fence_guard() FROM PUBLIC;
