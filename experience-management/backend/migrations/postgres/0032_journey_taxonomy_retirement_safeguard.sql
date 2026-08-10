-- Runtime schema 32: serialize taxonomy assignment with term retirement.

DO $journey_taxonomy_retirement_predecessor$
BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>31 THEN
    RAISE EXCEPTION 'runtime-32 taxonomy retirement safeguard requires runtime-31 journey identity profiles'
      USING ERRCODE='55000';
  END IF;
END
$journey_taxonomy_retirement_predecessor$;

CREATE OR REPLACE FUNCTION journey_taxonomy_assignment_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_taxonomy_assignment_lifecycle_guard$
DECLARE lock_space_id TEXT;
DECLARE lock_term_id TEXT;
BEGIN
  lock_space_id := NEW.space_id;
  lock_term_id := CASE WHEN TG_TABLE_NAME='journey_taxonomy_terms' THEN NEW.id ELSE NEW.term_id END;
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_space_id || ':' || lock_term_id, 0));

  IF TG_TABLE_NAME='journey_definition_taxonomy' THEN
    IF NOT EXISTS (SELECT 1 FROM journey_taxonomy_terms
        WHERE id=NEW.term_id AND space_id=NEW.space_id AND lifecycle='active') THEN
      RAISE EXCEPTION 'Journey taxonomy assignments require an active same-space term' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.lifecycle='retired' AND OLD.lifecycle='active' AND EXISTS (
      SELECT 1 FROM journey_definition_taxonomy assignment
        WHERE assignment.term_id=NEW.id AND assignment.space_id=NEW.space_id) THEN
    RAISE EXCEPTION 'Remove journey assignments before retiring this taxonomy term' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$journey_taxonomy_assignment_lifecycle_guard$;

CREATE TRIGGER journey_taxonomy_assignment_lifecycle_guard
BEFORE INSERT OR UPDATE OF space_id,term_id ON journey_definition_taxonomy
FOR EACH ROW EXECUTE FUNCTION journey_taxonomy_assignment_lifecycle_guard();

CREATE TRIGGER journey_taxonomy_retirement_assignment_guard
BEFORE UPDATE OF space_id,lifecycle ON journey_taxonomy_terms
FOR EACH ROW EXECUTE FUNCTION journey_taxonomy_assignment_lifecycle_guard();

-- Trigger execution does not require callers to invoke the trigger function directly.
REVOKE EXECUTE ON FUNCTION journey_taxonomy_assignment_lifecycle_guard() FROM PUBLIC;
