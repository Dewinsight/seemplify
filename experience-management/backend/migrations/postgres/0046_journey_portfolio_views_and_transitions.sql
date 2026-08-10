-- Runtime schema 46: portfolio saved-view revisions and exact requested lifecycle transitions.
DO $predecessor$ BEGIN
  IF COALESCE((SELECT MAX(version) FROM experience_runtime_schema_version),0)<>45 THEN
    RAISE EXCEPTION 'runtime-46 journey portfolio governance requires runtime-45' USING ERRCODE='55000';
  END IF;
END $predecessor$;

CREATE TABLE journey_portfolio_view_definitions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  state TEXT NOT NULL CHECK(state IN ('active','deleted')),
  current_version_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,deleted_at TIMESTAMPTZ,
  UNIQUE(id,space_id),
  FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  CHECK(updated_at>=created_at),
  CHECK((state='active' AND deleted_at IS NULL) OR (state='deleted' AND deleted_at IS NOT NULL))
);
CREATE UNIQUE INDEX journey_portfolio_view_name_active
  ON journey_portfolio_view_definitions(space_id,owner_user_id,LOWER(name)) WHERE state='active';
CREATE INDEX journey_portfolio_view_owner
  ON journey_portfolio_view_definitions(space_id,owner_user_id,state,updated_at DESC,id);

CREATE TABLE journey_portfolio_view_versions (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),view_id TEXT NOT NULL,space_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),configuration_json TEXT NOT NULL,
  configuration_sha256 TEXT NOT NULL CHECK(configuration_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,space_id),UNIQUE(id,view_id,space_id),UNIQUE(view_id,space_id,version_number),
  FOREIGN KEY(view_id,space_id) REFERENCES journey_portfolio_view_definitions(id,space_id) ON DELETE CASCADE,
  CHECK(octet_length(configuration_json) BETWEEN 2 AND 32768 AND jsonb_typeof(configuration_json::jsonb)='object')
);
ALTER TABLE journey_portfolio_view_definitions ADD CONSTRAINT journey_portfolio_view_current_version_fk
  FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_portfolio_view_versions(id,view_id,space_id) ON DELETE NO ACTION;

CREATE TABLE journey_portfolio_view_preferences (
  space_id TEXT NOT NULL,user_id TEXT NOT NULL,default_view_id TEXT,
  revision INTEGER NOT NULL CHECK(revision>0),updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(space_id,user_id),
  FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(default_view_id,space_id) REFERENCES journey_portfolio_view_definitions(id,space_id) ON DELETE SET NULL (default_view_id)
);

CREATE TABLE journey_portfolio_transition_requests (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),space_id TEXT NOT NULL,item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('pain_point','opportunity','solution','initiative')),
  requested_item_revision INTEGER NOT NULL CHECK(requested_item_revision>0),
  from_lifecycle TEXT NOT NULL CHECK(from_lifecycle IN ('draft','validated','approved','planned','active','blocked','completed','cancelled','archived')),
  requested_target_lifecycle TEXT NOT NULL CHECK(requested_target_lifecycle IN ('draft','validated','approved','planned','active','blocked','completed','cancelled','archived')),
  status TEXT NOT NULL CHECK(status IN ('pending','applied','rejected','cancelled','superseded')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),requested_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,decision_reason TEXT CHECK(decision_reason IS NULL OR length(decision_reason) BETWEEN 3 AND 1000),
  applied_item_revision INTEGER CHECK(applied_item_revision IS NULL OR applied_item_revision>0),
  revision INTEGER NOT NULL CHECK(revision>0),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,decided_at TIMESTAMPTZ,
  UNIQUE(id,space_id),
  FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(item_id,space_id,requested_item_revision) REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE NO ACTION,
  FOREIGN KEY(space_id,requested_by_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE NO ACTION,
  FOREIGN KEY(space_id,reviewed_by_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE NO ACTION,
  CHECK(from_lifecycle<>requested_target_lifecycle),CHECK(updated_at>=created_at),
  CHECK((status='pending' AND reviewed_by_user_id IS NULL AND decision_reason IS NULL AND applied_item_revision IS NULL AND decided_at IS NULL)
    OR (status='cancelled' AND reviewed_by_user_id IS NULL AND decision_reason IS NOT NULL AND applied_item_revision IS NULL AND decided_at IS NOT NULL)
    OR (status IN ('rejected','superseded') AND reviewed_by_user_id IS NOT NULL AND decision_reason IS NOT NULL AND applied_item_revision IS NULL AND decided_at IS NOT NULL)
    OR (status='applied' AND reviewed_by_user_id IS NOT NULL AND decision_reason IS NOT NULL AND applied_item_revision=requested_item_revision+1 AND decided_at IS NOT NULL)),
  CHECK(reviewed_by_user_id IS NULL OR reviewed_by_user_id<>requested_by_user_id)
);
CREATE UNIQUE INDEX journey_portfolio_transition_one_pending
  ON journey_portfolio_transition_requests(space_id,item_id) WHERE status='pending';
CREATE INDEX journey_portfolio_transition_history
  ON journey_portfolio_transition_requests(space_id,status,created_at DESC,id);

CREATE TABLE journey_portfolio_transition_events (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),request_id TEXT NOT NULL,space_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('requested','applied','rejected','cancelled','superseded')),
  request_revision INTEGER NOT NULL CHECK(request_revision>0),actor_user_id TEXT,
  detail_json TEXT NOT NULL,detail_sha256 TEXT NOT NULL CHECK(detail_sha256 ~ '^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(request_id,request_revision),
  FOREIGN KEY(request_id,space_id) REFERENCES journey_portfolio_transition_requests(id,space_id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK(octet_length(detail_json) BETWEEN 2 AND 8192 AND jsonb_typeof(detail_json::jsonb)='object')
);

CREATE OR REPLACE FUNCTION journey_portfolio_runtime46_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_TABLE_NAME IN ('journey_portfolio_view_versions','journey_portfolio_transition_events') THEN
    RAISE EXCEPTION 'runtime46 history is append-only' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'portfolio transition requests cannot be deleted' USING ERRCODE='55000';
  END IF;
  IF OLD.id<>NEW.id OR OLD.space_id<>NEW.space_id OR OLD.item_id<>NEW.item_id
    OR OLD.requested_item_revision<>NEW.requested_item_revision OR OLD.from_lifecycle<>NEW.from_lifecycle
    OR OLD.requested_target_lifecycle<>NEW.requested_target_lifecycle OR OLD.requested_by_user_id<>NEW.requested_by_user_id
    OR OLD.created_at<>NEW.created_at OR OLD.status<>'pending' OR NEW.status='pending' OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'invalid portfolio transition request lifecycle' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_portfolio_view_versions_guard BEFORE UPDATE OR DELETE ON journey_portfolio_view_versions
  FOR EACH ROW EXECUTE FUNCTION journey_portfolio_runtime46_guard();
CREATE TRIGGER journey_portfolio_transition_events_guard BEFORE UPDATE OR DELETE ON journey_portfolio_transition_events
  FOR EACH ROW EXECUTE FUNCTION journey_portfolio_runtime46_guard();
CREATE TRIGGER journey_portfolio_transition_request_guard BEFORE UPDATE OR DELETE ON journey_portfolio_transition_requests
  FOR EACH ROW EXECUTE FUNCTION journey_portfolio_runtime46_guard();

CREATE OR REPLACE FUNCTION journey_portfolio_view_preference_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF NEW.default_view_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_portfolio_view_definitions view
      WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id AND view.owner_user_id=NEW.user_id AND view.state='active') THEN
    RAISE EXCEPTION 'default portfolio view must be the active user-owned view' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER journey_portfolio_view_preference_guard BEFORE INSERT OR UPDATE ON journey_portfolio_view_preferences
  FOR EACH ROW EXECUTE FUNCTION journey_portfolio_view_preference_guard();

REVOKE UPDATE,DELETE ON journey_portfolio_view_versions,journey_portfolio_transition_events FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION journey_portfolio_runtime46_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION journey_portfolio_view_preference_guard() FROM PUBLIC;
