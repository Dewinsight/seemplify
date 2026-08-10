import crypto from "node:crypto";
import { db } from "./database.js";
import { effectiveJourneyRole } from "./journeyCollaboration.js";
import { assertSubscriptionFeature } from "./subscriptionEntitlements.js";
import {
  applyJourneyPortfolioRequestedTransitionInTransaction,
  JourneyPortfolioError,
  validateJourneyPortfolioRequestedTransition,
  type PortfolioLifecycle,
} from "./journeyPortfolio.js";

export type PortfolioViewConfiguration = {
  presentation: "table" | "board" | "matrix";
  filters: {
    kind?: string;
    lifecycle?: string;
    priority?: string;
    risk?: string;
    evidenceState?: string;
    search?: string;
  };
  sort: "updated" | "priority" | "due" | "score";
  columns: string[];
};
const lifecycle = new Set([
  "draft",
  "validated",
  "approved",
  "planned",
  "active",
  "blocked",
  "completed",
  "cancelled",
  "archived",
]);
const columns = new Set([
  "item",
  "type",
  "state",
  "priority",
  "score",
  "evidence",
  "journeys",
  "due",
]);
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value;
const json = (value: unknown) => JSON.stringify(stable(value));
const sha = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const now = (value?: string) => value || new Date().toISOString();
const token = (value: unknown, label: string, max = 128) => {
  const result = String(value ?? "").trim();
  if (!result || result.length > max)
    throw new JourneyPortfolioError(
      `${label} is invalid.`,
      400,
      "JOURNEY_PORTFOLIO_GOVERNANCE_INPUT_INVALID",
    );
  return result;
};

function initializeSqlite() {
  if (db.provider !== "sqlite") return;
  db.exec(`
  CREATE TABLE IF NOT EXISTS journey_portfolio_view_definitions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','deleted')),current_version_id TEXT,revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,UNIQUE(id,space_id),
    FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
    CHECK((state='active' AND deleted_at IS NULL) OR (state='deleted' AND deleted_at IS NOT NULL)));
  CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_view_name_active ON journey_portfolio_view_definitions(space_id,owner_user_id,name COLLATE NOCASE) WHERE state='active';
  CREATE TABLE IF NOT EXISTS journey_portfolio_view_versions(id TEXT PRIMARY KEY,view_id TEXT NOT NULL,space_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),configuration_sha256 TEXT NOT NULL,
    created_by_user_id TEXT,created_at TEXT NOT NULL,UNIQUE(id,space_id),UNIQUE(id,view_id,space_id),UNIQUE(view_id,space_id,version_number),
    FOREIGN KEY(view_id,space_id) REFERENCES journey_portfolio_view_definitions(id,space_id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS journey_portfolio_view_preferences(space_id TEXT NOT NULL,user_id TEXT NOT NULL,default_view_id TEXT,
    revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(space_id,user_id),
    FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS journey_portfolio_transition_requests(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,item_id TEXT NOT NULL,
    item_kind TEXT NOT NULL,requested_item_revision INTEGER NOT NULL,from_lifecycle TEXT NOT NULL,requested_target_lifecycle TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','applied','rejected','cancelled','superseded')),reason TEXT NOT NULL,
    requested_by_user_id TEXT NOT NULL,reviewed_by_user_id TEXT,decision_reason TEXT,applied_item_revision INTEGER,revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,decided_at TEXT,UNIQUE(id,space_id),
    FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(item_id,space_id,requested_item_revision) REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE NO ACTION);
  CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_transition_one_pending ON journey_portfolio_transition_requests(space_id,item_id) WHERE status='pending';
  CREATE TABLE IF NOT EXISTS journey_portfolio_transition_events(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,space_id TEXT NOT NULL,
    event TEXT NOT NULL,request_revision INTEGER NOT NULL,actor_user_id TEXT,detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
    detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(request_id,request_revision),
    FOREIGN KEY(request_id,space_id) REFERENCES journey_portfolio_transition_requests(id,space_id) ON DELETE CASCADE);
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_view_versions_update_guard BEFORE UPDATE ON journey_portfolio_view_versions BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_view_versions_delete_guard BEFORE DELETE ON journey_portfolio_view_versions BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_transition_events_update_guard BEFORE UPDATE ON journey_portfolio_transition_events BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_transition_events_delete_guard BEFORE DELETE ON journey_portfolio_transition_events BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_transition_requests_delete_guard BEFORE DELETE ON journey_portfolio_transition_requests BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_transition_requests_update_guard BEFORE UPDATE ON journey_portfolio_transition_requests
    WHEN OLD.id<>NEW.id OR OLD.space_id<>NEW.space_id OR OLD.item_id<>NEW.item_id
      OR OLD.requested_item_revision<>NEW.requested_item_revision OR OLD.from_lifecycle<>NEW.from_lifecycle
      OR OLD.requested_target_lifecycle<>NEW.requested_target_lifecycle OR OLD.requested_by_user_id<>NEW.requested_by_user_id
      OR OLD.created_at<>NEW.created_at OR OLD.status<>'pending' OR NEW.status='pending' OR NEW.revision<>OLD.revision+1
    BEGIN SELECT RAISE(ABORT,'invalid portfolio transition request lifecycle');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_view_preference_insert_guard BEFORE INSERT ON journey_portfolio_view_preferences
    WHEN NEW.default_view_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_portfolio_view_definitions view
      WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id AND view.owner_user_id=NEW.user_id AND view.state='active')
    BEGIN SELECT RAISE(ABORT,'default portfolio view must be user-owned');END;
  CREATE TRIGGER IF NOT EXISTS journey_portfolio_view_preference_update_guard BEFORE UPDATE ON journey_portfolio_view_preferences
    WHEN NEW.default_view_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_portfolio_view_definitions view
      WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id AND view.owner_user_id=NEW.user_id AND view.state='active')
    BEGIN SELECT RAISE(ABORT,'default portfolio view must be user-owned');END;
`);
}
initializeSqlite();

function access(
  spaceId: string,
  userId: string,
  capability?: "journeys.edit" | "journeys.review",
) {
  assertSubscriptionFeature(spaceId, "journeyPortfolio");
  const membership = db
    .prepare(
      "SELECT role FROM space_memberships WHERE space_id=? AND user_id=?",
    )
    .get(spaceId, userId) as { role?: string } | undefined;
  if (!membership)
    throw new JourneyPortfolioError(
      "Space membership is required.",
      403,
      "JOURNEY_PORTFOLIO_FORBIDDEN",
    );
  if (
    capability &&
    (membership.role === "member" ||
      !effectiveJourneyRole(spaceId, userId).capabilities.has(capability))
  )
    throw new JourneyPortfolioError(
      "The required journey capability is unavailable.",
      403,
      "JOURNEY_PORTFOLIO_CAPABILITY_REQUIRED",
      { capability },
    );
}
function config(input: PortfolioViewConfiguration) {
  const result = {
    presentation: input.presentation,
    filters: { ...input.filters },
    sort: input.sort,
    columns: [...input.columns],
  };
  if (
    !["table", "board", "matrix"].includes(result.presentation) ||
    !["updated", "priority", "due", "score"].includes(result.sort) ||
    !result.columns.length ||
    result.columns.length > 8 ||
    new Set(result.columns).size !== result.columns.length ||
    result.columns.some((v) => !columns.has(v))
  )
    throw new JourneyPortfolioError(
      "Saved view configuration is invalid.",
      400,
      "JOURNEY_PORTFOLIO_VIEW_CONFIG_INVALID",
    );
  const allowed = new Set([
    "kind",
    "lifecycle",
    "priority",
    "risk",
    "evidenceState",
    "search",
  ]);
  for (const [key, value] of Object.entries(result.filters)) {
    if (
      !allowed.has(key) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 200
    )
      throw new JourneyPortfolioError(
        "Saved view filters are invalid.",
        400,
        "JOURNEY_PORTFOLIO_VIEW_CONFIG_INVALID",
        { field: key },
      );
  }
  return result;
}
function replay(
  spaceId: string,
  userId: string,
  key: string,
  action: string,
  intent: unknown,
) {
  const row = db
    .prepare(
      `SELECT action,intent_sha256,response_json
  FROM journey_portfolio_operations WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`,
    )
    .get(spaceId, userId, key) as any;
  if (!row) return null;
  if (row.action !== action || row.intent_sha256 !== sha(json(intent)))
    throw new JourneyPortfolioError(
      "Idempotency key conflict.",
      409,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_CONFLICT",
    );
  return JSON.parse(String(row.response_json));
}
function record(
  spaceId: string,
  userId: string,
  key: string,
  action: string,
  intent: unknown,
  response: unknown,
  at: string,
) {
  db.prepare(
    `INSERT INTO journey_portfolio_operations
  (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    spaceId,
    userId,
    key,
    action,
    sha(json(intent)),
    json(response),
    at,
  );
}
function event(
  spaceId: string,
  userId: string,
  requestId: string,
  revision: number,
  name: string,
  detail: Record<string, unknown>,
  at: string,
) {
  const body = json(detail);
  db.prepare(
    `INSERT INTO journey_portfolio_transition_events(id,request_id,space_id,event,request_revision,actor_user_id,detail_json,detail_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    requestId,
    spaceId,
    name,
    revision,
    userId,
    body,
    sha(body),
    at,
  );
}
function view(row: any) {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    revision: Number(row.revision),
    versionId: row.current_version_id,
    versionNumber: Number(row.version_number),
    configuration: JSON.parse(String(row.configuration_json)),
    configurationSha256: row.configuration_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function transition(row: any) {
  return {
    id: row.id,
    itemId: row.item_id,
    itemKind: row.item_kind,
    requestedItemRevision: Number(row.requested_item_revision),
    fromLifecycle: row.from_lifecycle,
    requestedTargetLifecycle: row.requested_target_lifecycle,
    status: row.status,
    reason: row.reason,
    requestedByUserId: row.requested_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id || null,
    decisionReason: row.decision_reason || null,
    appliedItemRevision:
      row.applied_item_revision === null
        ? null
        : Number(row.applied_item_revision),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at || null,
  };
}

export function listPortfolioSavedViews(input: {
  spaceId: string;
  actorUserId: string;
}) {
  access(input.spaceId, input.actorUserId);
  const rows = db
    .prepare(
      `SELECT view.*,version.version_number,version.configuration_json,version.configuration_sha256
  FROM journey_portfolio_view_definitions view JOIN journey_portfolio_view_versions version ON version.id=view.current_version_id AND version.space_id=view.space_id
  WHERE view.space_id=? AND view.owner_user_id=? AND view.state='active' ORDER BY LOWER(view.name),view.id`,
    )
    .all(input.spaceId, input.actorUserId) as any[];
  const pref = db
    .prepare(
      "SELECT default_view_id,revision FROM journey_portfolio_view_preferences WHERE space_id=? AND user_id=?",
    )
    .get(input.spaceId, input.actorUserId) as any;
  return {
    views: rows.map(view),
    defaultViewId: pref?.default_view_id || null,
    preferenceRevision: Number(pref?.revision || 0),
  };
}
export function createPortfolioSavedView(input: {
  spaceId: string;
  actorUserId: string;
  name: string;
  configuration: PortfolioViewConfiguration;
  makeDefault?: boolean;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId);
  const name = token(input.name, "name", 160),
    configuration = config(input.configuration),
    key = token(input.idempotencyKey, "idempotencyKey", 200),
    intent = { name, configuration, makeDefault: Boolean(input.makeDefault) },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.create",
      intent,
    );
    if (seen) return { ...seen, replayed: true };
    const id = crypto.randomUUID(),
      versionId = crypto.randomUUID(),
      body = json(configuration);
    db.prepare(
      `INSERT INTO journey_portfolio_view_definitions
      (id,space_id,owner_user_id,name,state,current_version_id,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,'active',NULL,1,?,?,NULL)`,
    ).run(id, input.spaceId, input.actorUserId, name, at, at);
    db.prepare(
      `INSERT INTO journey_portfolio_view_versions
      (id,view_id,space_id,version_number,configuration_json,configuration_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      versionId,
      id,
      input.spaceId,
      1,
      body,
      sha(body),
      input.actorUserId,
      at,
    );
    db.prepare(
      "UPDATE journey_portfolio_view_definitions SET current_version_id=? WHERE id=? AND space_id=?",
    ).run(versionId, id, input.spaceId);
    if (input.makeDefault)
      setDefaultInside(input.spaceId, input.actorUserId, id, undefined, at);
    const result = { viewId: id };
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.create",
      intent,
      result,
      at,
    );
    return { ...result, replayed: false };
  })();
}
export function revisePortfolioSavedView(input: {
  spaceId: string;
  actorUserId: string;
  viewId: string;
  expectedRevision: number;
  name?: string;
  configuration: PortfolioViewConfiguration;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId);
  const configuration = config(input.configuration),
    key = token(input.idempotencyKey, "idempotencyKey", 200),
    intent = {
      viewId: input.viewId,
      expectedRevision: input.expectedRevision,
      name: input.name || null,
      configuration,
    },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.revise",
      intent,
    );
    if (seen) return { ...seen, replayed: true };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_view_definitions WHERE id=? AND space_id=? AND owner_user_id=? AND state='active'",
      )
      .get(input.viewId, input.spaceId, input.actorUserId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Saved view not found.",
        404,
        "JOURNEY_PORTFOLIO_VIEW_NOT_FOUND",
      );
    if (Number(row.revision) !== input.expectedRevision)
      throw new JourneyPortfolioError(
        "Saved view revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_VIEW_REVISION_CONFLICT",
      );
    const versionId = crypto.randomUUID(),
      body = json(configuration),
      next = input.expectedRevision + 1;
    db.prepare(
      `INSERT INTO journey_portfolio_view_versions(id,view_id,space_id,version_number,configuration_json,configuration_sha256,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      versionId,
      row.id,
      input.spaceId,
      next,
      body,
      sha(body),
      input.actorUserId,
      at,
    );
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_view_definitions SET name=?,current_version_id=?,revision=?,updated_at=?
      WHERE id=? AND space_id=? AND owner_user_id=? AND revision=? AND state='active'`,
      )
      .run(
        input.name ? token(input.name, "name", 160) : row.name,
        versionId,
        next,
        at,
        row.id,
        input.spaceId,
        input.actorUserId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Saved view revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_VIEW_REVISION_CONFLICT",
      );
    const result = { viewId: row.id };
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.revise",
      intent,
      result,
      at,
    );
    return { ...result, replayed: false };
  })();
}
function setDefaultInside(
  spaceId: string,
  userId: string,
  viewId: string | null,
  expected: number | undefined,
  at: string,
) {
  if (
    viewId &&
    !db
      .prepare(
        "SELECT 1 FROM journey_portfolio_view_definitions WHERE id=? AND space_id=? AND owner_user_id=? AND state='active'",
      )
      .get(viewId, spaceId, userId)
  )
    throw new JourneyPortfolioError(
      "Saved view not found.",
      404,
      "JOURNEY_PORTFOLIO_VIEW_NOT_FOUND",
    );
  const current = db
    .prepare(
      "SELECT revision FROM journey_portfolio_view_preferences WHERE space_id=? AND user_id=?",
    )
    .get(spaceId, userId) as any;
  const actual = Number(current?.revision || 0);
  if (expected !== undefined && actual !== expected)
    throw new JourneyPortfolioError(
      "Default view revision conflict.",
      409,
      "JOURNEY_PORTFOLIO_VIEW_PREFERENCE_CONFLICT",
    );
  if (current)
    db.prepare(
      "UPDATE journey_portfolio_view_preferences SET default_view_id=?,revision=revision+1,updated_at=? WHERE space_id=? AND user_id=? AND revision=?",
    ).run(viewId, at, spaceId, userId, actual);
  else
    db.prepare(
      "INSERT INTO journey_portfolio_view_preferences(space_id,user_id,default_view_id,revision,updated_at) VALUES (?,?,?,1,?)",
    ).run(spaceId, userId, viewId, at);
  return actual + 1;
}
export function setPortfolioDefaultView(input: {
  spaceId: string;
  actorUserId: string;
  viewId: string | null;
  expectedRevision: number;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotencyKey", 200),
    intent = { viewId: input.viewId, expectedRevision: input.expectedRevision },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.default",
      intent,
    );
    if (seen) return { ...seen, replayed: true };
    const preferenceRevision = setDefaultInside(
        input.spaceId,
        input.actorUserId,
        input.viewId,
        input.expectedRevision,
        at,
      ),
      result = { defaultViewId: input.viewId, preferenceRevision };
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_view.default",
      intent,
      result,
      at,
    );
    return { ...result, replayed: false };
  })();
}

export function listPortfolioTransitionRequests(input: {
  spaceId: string;
  actorUserId: string;
  status?: string;
}) {
  access(input.spaceId, input.actorUserId);
  const rows = db
    .prepare(
      `SELECT * FROM journey_portfolio_transition_requests WHERE space_id=?${input.status ? " AND status=?" : ""} ORDER BY created_at DESC,id`,
    )
    .all(
      ...(input.status ? [input.spaceId, input.status] : [input.spaceId]),
    ) as any[];
  return rows.map(transition);
}
export function requestPortfolioTransition(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  expectedItemRevision: number;
  targetLifecycle: PortfolioLifecycle;
  reason: string;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, "journeys.edit");
  const key = token(input.idempotencyKey, "idempotencyKey", 200),
    reason = token(input.reason, "reason", 1000),
    intent = {
      itemId: input.itemId,
      expectedItemRevision: input.expectedItemRevision,
      targetLifecycle: input.targetLifecycle,
      reason,
    },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.request",
      intent,
    );
    if (seen)
      return {
        request: transition(
          db
            .prepare(
              "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
            )
            .get(seen.requestId, input.spaceId),
        ),
        replayed: true,
      };
    const { item } = validateJourneyPortfolioRequestedTransition({
      spaceId: input.spaceId,
      itemId: input.itemId,
      expectedRevision: input.expectedItemRevision,
      targetLifecycle: input.targetLifecycle,
    });
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO journey_portfolio_transition_requests(id,space_id,item_id,item_kind,requested_item_revision,
      from_lifecycle,requested_target_lifecycle,status,reason,requested_by_user_id,reviewed_by_user_id,decision_reason,applied_item_revision,revision,
      created_at,updated_at,decided_at) VALUES (?,?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL,1,?,?,NULL)`,
    ).run(
      id,
      input.spaceId,
      item.id,
      item.kind,
      item.revision,
      item.lifecycle,
      input.targetLifecycle,
      reason,
      input.actorUserId,
      at,
      at,
    );
    event(
      input.spaceId,
      input.actorUserId,
      id,
      1,
      "requested",
      {
        itemRevision: item.revision,
        fromLifecycle: item.lifecycle,
        targetLifecycle: input.targetLifecycle,
      },
      at,
    );
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.request",
      intent,
      { requestId: id },
      at,
    );
    return {
      request: transition(
        db
          .prepare(
            "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
          )
          .get(id, input.spaceId),
      ),
      replayed: false,
    };
  })();
}
export function decidePortfolioTransition(input: {
  spaceId: string;
  actorUserId: string;
  requestId: string;
  expectedRevision: number;
  decision: "approve" | "reject";
  reason: string;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, "journeys.review");
  const key = token(input.idempotencyKey, "idempotencyKey", 200),
    reason = token(input.reason, "reason", 1000),
    intent = {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      reason,
    },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.decide",
      intent,
    );
    if (seen)
      return {
        request: transition(
          db
            .prepare(
              "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
            )
            .get(seen.requestId, input.spaceId),
        ),
        replayed: true,
      };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=? AND status='pending'",
      )
      .get(input.requestId, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Pending transition request not found.",
        404,
        "JOURNEY_PORTFOLIO_TRANSITION_NOT_FOUND",
      );
    if (Number(row.revision) !== input.expectedRevision)
      throw new JourneyPortfolioError(
        "Transition request revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_TRANSITION_REVISION_CONFLICT",
      );
    if (row.requested_by_user_id === input.actorUserId)
      throw new JourneyPortfolioError(
        "A second manager must review this transition.",
        409,
        "JOURNEY_PORTFOLIO_TRANSITION_TWO_PERSON_REQUIRED",
      );
    let status = "rejected",
      appliedRevision: null | number = null;
    if (input.decision === "approve") {
      const current = db
        .prepare(
          "SELECT revision,lifecycle FROM journey_portfolio_items WHERE id=? AND space_id=? AND state='active'",
        )
        .get(row.item_id, input.spaceId) as any;
      if (
        !current ||
        Number(current.revision) !== Number(row.requested_item_revision) ||
        current.lifecycle !== row.from_lifecycle
      )
        status = "superseded";
      else {
        const item = applyJourneyPortfolioRequestedTransitionInTransaction({
          spaceId: input.spaceId,
          actorUserId: input.actorUserId,
          itemId: row.item_id,
          expectedRevision: Number(row.requested_item_revision),
          targetLifecycle: row.requested_target_lifecycle,
          requestId: row.id,
          decisionReason: reason,
          at,
        });
        status = "applied";
        appliedRevision = item.revision;
      }
    }
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_transition_requests SET status=?,reviewed_by_user_id=?,decision_reason=?,applied_item_revision=?,
      revision=revision+1,updated_at=?,decided_at=? WHERE id=? AND space_id=? AND revision=? AND status='pending'`,
      )
      .run(
        status,
        input.actorUserId,
        reason,
        appliedRevision,
        at,
        at,
        row.id,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Transition request revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_TRANSITION_REVISION_CONFLICT",
      );
    event(
      input.spaceId,
      input.actorUserId,
      row.id,
      input.expectedRevision + 1,
      status,
      {
        requestedItemRevision: Number(row.requested_item_revision),
        appliedItemRevision: appliedRevision,
        targetLifecycle: row.requested_target_lifecycle,
      },
      at,
    );
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.decide",
      intent,
      { requestId: row.id },
      at,
    );
    return {
      request: transition(
        db
          .prepare(
            "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
          )
          .get(row.id, input.spaceId),
      ),
      replayed: false,
    };
  })();
}

export function cancelPortfolioTransition(input: {
  spaceId: string;
  actorUserId: string;
  requestId: string;
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, "journeys.edit");
  const key = token(input.idempotencyKey, "idempotencyKey", 200),
    reason = token(input.reason, "reason", 1000),
    intent = {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      reason,
    },
    at = now(input.at);
  return db.transaction(() => {
    const seen = replay(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.cancel",
      intent,
    );
    if (seen)
      return {
        request: transition(
          db
            .prepare(
              "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
            )
            .get(seen.requestId, input.spaceId),
        ),
        replayed: true,
      };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=? AND status='pending'",
      )
      .get(input.requestId, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Pending transition request not found.",
        404,
        "JOURNEY_PORTFOLIO_TRANSITION_NOT_FOUND",
      );
    if (Number(row.revision) !== input.expectedRevision)
      throw new JourneyPortfolioError(
        "Transition request revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_TRANSITION_REVISION_CONFLICT",
      );
    if (row.requested_by_user_id !== input.actorUserId)
      throw new JourneyPortfolioError(
        "Only the requesting manager can cancel this request.",
        403,
        "JOURNEY_PORTFOLIO_TRANSITION_CANCEL_FORBIDDEN",
      );
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_transition_requests SET status='cancelled',decision_reason=?,revision=revision+1,
      updated_at=?,decided_at=? WHERE id=? AND space_id=? AND revision=? AND status='pending'`,
      )
      .run(
        reason,
        at,
        at,
        row.id,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Transition request revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_TRANSITION_REVISION_CONFLICT",
      );
    event(
      input.spaceId,
      input.actorUserId,
      row.id,
      input.expectedRevision + 1,
      "cancelled",
      {
        requestedItemRevision: Number(row.requested_item_revision),
        targetLifecycle: row.requested_target_lifecycle,
      },
      at,
    );
    record(
      input.spaceId,
      input.actorUserId,
      key,
      "portfolio_transition.cancel",
      intent,
      { requestId: row.id },
      at,
    );
    return {
      request: transition(
        db
          .prepare(
            "SELECT * FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
          )
          .get(row.id, input.spaceId),
      ),
      replayed: false,
    };
  })();
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function exportPortfolioSavedViews(input: {
  spaceId: string;
  actorUserId: string;
}) {
  const result = listPortfolioSavedViews(input);
  return Buffer.from(
    `name,presentation,sort,filters,columns,default\r\n${result.views
      .map((entry) =>
        [
          entry.name,
          entry.configuration.presentation,
          entry.configuration.sort,
          json(entry.configuration.filters),
          entry.configuration.columns.join("|"),
          entry.id === result.defaultViewId ? "yes" : "no",
        ]
          .map(csvCell)
          .join(","),
      )
      .join("\r\n")}\r\n`,
    "utf8",
  );
}
