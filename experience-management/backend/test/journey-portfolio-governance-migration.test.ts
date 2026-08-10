import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const sql = fs.readFileSync(
  new URL(
    "../migrations/postgres/0046_journey_portfolio_views_and_transitions.sql",
    import.meta.url,
  ),
  "utf8",
);
test("runtime46 requires exact predecessor45 and uses distinct durable tables", () => {
  assert.match(sql, /MAX\(version\).*<>45/s);
  for (const table of [
    "journey_portfolio_view_definitions",
    "journey_portfolio_view_versions",
    "journey_portfolio_view_preferences",
    "journey_portfolio_transition_requests",
    "journey_portfolio_transition_events",
  ])
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  assert.doesNotMatch(
    sql,
    /CREATE TABLE journey_saved_views|CREATE TABLE journey_portfolio_reviews/u,
  );
});
test("saved views preserve immutable configuration revisions and owned defaults", () => {
  assert.match(sql, /configuration_sha256/);
  assert.match(sql, /UNIQUE\(view_id,space_id,version_number\)/);
  assert.match(sql, /UNIQUE\(id,view_id,space_id\)/);
  assert.match(
    sql,
    /default portfolio view must be the active user-owned view/,
  );
  assert.match(sql, /view_versions_guard BEFORE UPDATE OR DELETE/);
  assert.match(sql, /ON DELETE SET NULL \(default_view_id\)/u);
});
test("requested target lifecycle is exact, one-active, two-person and append-only", () => {
  assert.match(sql, /requested_target_lifecycle/);
  assert.match(sql, /requested_item_revision/);
  assert.match(sql, /WHERE status='pending'/);
  assert.match(sql, /reviewed_by_user_id<>requested_by_user_id/);
  assert.match(sql, /transition_events_guard BEFORE UPDATE OR DELETE/);
  assert.match(
    sql,
    /transition_request_guard BEFORE UPDATE OR DELETE/u,
  );
  assert.doesNotMatch(sql, /INSERT INTO experience_runtime_schema_version/u);
});
