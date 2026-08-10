-- Runtime schema 34: durable portfolio owner attribution with write-time tenancy.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>33 THEN
    RAISE EXCEPTION 'runtime-34 portfolio owner attribution requires runtime-33' USING ERRCODE='55000';
  END IF;
END $predecessor$;

ALTER TABLE journey_portfolio_items
  DROP CONSTRAINT journey_portfolio_items_owner_membership_fk;
ALTER TABLE journey_portfolio_items
  ADD CONSTRAINT journey_portfolio_items_owner_user_fk
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE NO ACTION;

CREATE OR REPLACE FUNCTION journey_portfolio_owner_membership_guard()
RETURNS trigger LANGUAGE plpgsql AS $journey_portfolio_owner_membership_guard$
BEGIN
  IF NEW.owner_user_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM space_memberships
    WHERE space_id=NEW.space_id AND user_id=NEW.owner_user_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey portfolio owner % is not a member of space %', NEW.owner_user_id, NEW.space_id
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END
$journey_portfolio_owner_membership_guard$;

CREATE TRIGGER journey_portfolio_items_owner_membership_guard
BEFORE INSERT OR UPDATE OF space_id,owner_user_id ON journey_portfolio_items
FOR EACH ROW EXECUTE FUNCTION journey_portfolio_owner_membership_guard();

REVOKE ALL ON FUNCTION journey_portfolio_owner_membership_guard() FROM PUBLIC;
