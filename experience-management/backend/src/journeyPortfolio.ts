import crypto from "node:crypto";
import { db } from "./database.js";
import {
  analyseJourneyInitiativeDependencies,
  compareJourneyInitiativeOutcome,
  createJourneyInitiativeBaseline,
  verifyJourneyInitiativeBaseline,
  validateJourneyPortfolioLifecycleTransition,
  JourneyPortfolioDomainError,
  type JourneyInitiativeBaseline,
  type JourneyInitiative,
  type JourneyInitiativeLifecycle,
  type JourneyInsightLifecycle,
  type JourneyMetricObservationSnapshot,
  type JourneyPortfolioItem,
  type JourneyPortfolioItemKind,
  type JourneyPortfolioRelationship,
} from "./journeyPortfolioDomain.js";
import {
  calculateJourneyPortfolioScore,
  JourneyPortfolioScoreError,
  type JourneyScoreInput,
  type JourneyScoreMethod,
  type JourneyWeightedScoreDimension,
} from "./journeyPortfolioScoring.js";
import {
  getJourneyMetricObservation,
  JourneyMetricsError,
} from "./journeyMetrics.js";
import { isDatabaseConstraintError } from "./databaseAdapter.js";
import {
  assertSubscriptionFeature,
  assertSubscriptionQuota,
} from "./subscriptionEntitlements.js";

export const JOURNEY_PORTFOLIO_SCHEMA_VERSION = 1 as const;
export const journeyPortfolioLimits = Object.freeze({
  titleCharacters: 200,
  descriptionCharacters: 10_000,
  detailCharacters: 5_000,
  tags: 64,
  evidenceLinks: 256,
  metricTargets: 64,
  relationshipsPerBulkRequest: 100,
  pageSize: 100,
  policyConfigurationBytes: 32_768,
  itemSnapshotBytes: 131_072,
  scoreInputBytes: 16_384,
});

type InsightLifecycle = JourneyInsightLifecycle;
type InitiativeLifecycle = JourneyInitiativeLifecycle;
export type PortfolioLifecycle = InsightLifecycle | InitiativeLifecycle;
export type PortfolioReviewState =
  "not_submitted" | "in_review" | "approved" | "changes_requested";
export type PortfolioRisk = "low" | "medium" | "high" | "unknown";
export type PortfolioPriority = "low" | "medium" | "high" | "critical";
export type PortfolioFrequency =
  "rare" | "occasional" | "frequent" | "pervasive" | "unknown";

export type PortfolioMetricTarget = {
  metricId: string;
  metricDefinitionVersion: string;
  direction: "higher_is_better" | "lower_is_better";
  targetValue: number;
  unit: string;
};

export type PortfolioItem = {
  id: string;
  kind: JourneyPortfolioItemKind;
  title: string;
  description: string;
  lifecycle: PortfolioLifecycle;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  priority: PortfolioPriority | null;
  risk: PortfolioRisk | null;
  severity: 1 | 2 | 3 | 4 | 5 | null;
  frequency: PortfolioFrequency | null;
  desiredOutcome: string | null;
  hypothesis: string | null;
  constraints: string[];
  estimatedEffort: number | null;
  estimatedCost: number | null;
  expectedOutcome: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  dueDate: string | null;
  progressPercent: number | null;
  reviewCadenceDays: number | null;
  reviewState: PortfolioReviewState;
  latestReviewId: string | null;
  targetMetrics: PortfolioMetricTarget[];
  evidenceLinkIds: string[];
  tags: string[];
  state: "active" | "deleted";
  revision: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  retentionExpiresAt: string | null;
};

export type PortfolioItemDraft = Omit<
  PortfolioItem,
  | "id"
  | "state"
  | "revision"
  | "reviewState"
  | "latestReviewId"
  | "createdByUserId"
  | "updatedByUserId"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "retentionExpiresAt"
>;

export type PortfolioItemPatch = Partial<Omit<PortfolioItemDraft, "kind">>;

export type PortfolioRelationship = {
  id: string;
  type:
    | "pain_point_to_opportunity"
    | "opportunity_to_solution"
    | "solution_to_initiative";
  fromItemId: string;
  fromItemKind: "pain_point" | "opportunity" | "solution";
  toItemId: string;
  toItemKind: "opportunity" | "solution" | "initiative";
  createdByUserId: string | null;
  createdAt: string;
};

export type PortfolioJourneyLink = {
  id: string;
  itemId: string;
  itemKind: JourneyPortfolioItemKind;
  canonicalItemRevision: number;
  journeyDefinitionId: string;
  journeyVersionId: string | null;
  targetType: "journey" | "stage" | "touchpoint" | "persona";
  targetId: string;
  relationship: "occurs_at" | "affects" | "improves" | "changes" | "delivers";
  validFrom: string | null;
  validUntil: string | null;
  itemSnapshot: Record<string, unknown> | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type PortfolioDependency = {
  id: string;
  initiativeId: string;
  dependsOnInitiativeId: string;
  type: "finish_to_start" | "blocks";
  createdByUserId: string | null;
  createdAt: string;
};

export type PortfolioPolicy = {
  id: string;
  name: string;
  method: JourneyScoreMethod;
  state: "draft" | "active" | "retired";
  revision: number;
  currentVersionId: string;
  currentVersion: PortfolioPolicyVersion;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioPolicyVersion = {
  id: string;
  policyId: string;
  versionNumber: number;
  method: JourneyScoreMethod;
  formulaVersion: "rice.v1" | "ice.v1" | "weighted.v1";
  configuration: Record<string, unknown>;
  configurationSha256: string;
  actorUserId: string | null;
  createdAt: string;
};

export class JourneyPortfolioError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "JOURNEY_PORTFOLIO_INVALID",
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "JourneyPortfolioError";
  }
}

function nowIso(value: Date | string = new Date()) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new JourneyPortfolioError("A valid timestamp is required.");
  return date.toISOString();
}
function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
/** Checksums must reproduce byte-for-byte on every host, so keys are ordered by
 * code point rather than by the ICU- and locale-dependent `localeCompare`. The
 * domain module orders its own output the same way. */
function compareKey(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareKey(left, right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  return value;
}
function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}
function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
function token(value: unknown, label: string, maximum = 128) {
  const result = String(value ?? "").trim();
  if (
    !result ||
    result.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(result)
  ) {
    throw new JourneyPortfolioError(
      `A valid ${label} is required.`,
      400,
      "JOURNEY_PORTFOLIO_INPUT_INVALID",
      { field: label },
    );
  }
  return result;
}
function optionalToken(value: unknown, label: string, maximum = 128) {
  if (value === null || value === undefined || value === "") return null;
  return token(value, label, maximum);
}
function dateOnly(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const result = String(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(result) ||
    !Number.isFinite(Date.parse(`${result}T00:00:00.000Z`))
  ) {
    throw new JourneyPortfolioError(
      `${label} must be a valid ISO date.`,
      400,
      "JOURNEY_PORTFOLIO_DATE_INVALID",
      { field: label },
    );
  }
  return result;
}
function finiteOrNull(value: unknown, label: string, minimum = 0) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum)
    throw new JourneyPortfolioError(
      `${label} must be a finite number of at least ${minimum}.`,
      400,
      "JOURNEY_PORTFOLIO_NUMBER_INVALID",
      { field: label },
    );
  return number;
}

/** The scoring calculator is the authoritative validator for weighted policies and
 * score inputs, but it raises its own error type carrying no transport status.
 * Ordinary bad input must not surface as an unhandled 500 once this façade is
 * routed, so its failures are mapped onto the module's governed error contract. */
function withScoreErrors<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof JourneyPortfolioScoreError)) throw error;
    throw new JourneyPortfolioError(
      error.message,
      422,
      "JOURNEY_PORTFOLIO_SCORE_INVALID",
      { field: error.field, scoreCode: error.code },
    );
  }
}

/** PostgreSQL is migrated offline. SQLite receives an equivalent development
 * schema here so service tests exercise the same tenant and history model. */
function ensureSqliteSchema() {
  if (db.provider !== "sqlite") return;
  const portfolioItemSql = String(
    (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='journey_portfolio_items'",
        )
        .get() as { sql?: string } | undefined
    )?.sql || "",
  );
  const hasLegacyOwnerMembershipFk =
    /FOREIGN KEY\s*\(\s*space_id\s*,\s*owner_user_id\s*\)\s*REFERENCES\s+space_memberships/iu.test(
      portfolioItemSql,
    );
  if (hasLegacyOwnerMembershipFk) {
    const replacementSql = portfolioItemSql
      .replace(
        /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?journey_portfolio_items["`\]]?/iu,
        "CREATE TABLE journey_portfolio_items",
      )
      .replace(
        /FOREIGN KEY\s*\(\s*space_id\s*,\s*owner_user_id\s*\)\s*REFERENCES\s+space_memberships\s*\(\s*space_id\s*,\s*user_id\s*\)\s*ON DELETE\s+(?:RESTRICT|NO ACTION)/iu,
        "FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE NO ACTION",
      );
    if (
      replacementSql === portfolioItemSql ||
      /REFERENCES\s+space_memberships/iu.test(replacementSql)
    ) {
      throw new Error(
        "The Journey portfolio SQLite owner compatibility upgrade could not rewrite the legacy foreign key.",
      );
    }
    const columns = (
      db.pragma("table_info(journey_portfolio_items)") as Array<{
        name: string;
      }>
    )
      .map(({ name }) => `"${name.replace(/"/gu, '""')}"`)
      .join(",");
    const schemaObjects: Array<{ type: string; name: string; sql: string }> = db
      .prepare(
        `SELECT type,name,sql FROM sqlite_master WHERE tbl_name='journey_portfolio_items'
       AND type IN ('index','trigger') AND sql IS NOT NULL`,
      )
      .all() as Array<{ type: string; name: string; sql: string }>;
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    try {
      db.transaction(() => {
        db.exec(
          "ALTER TABLE journey_portfolio_items RENAME TO journey_portfolio_items_owner_membership_legacy",
        );
        db.exec(replacementSql);
        db.exec(`INSERT INTO journey_portfolio_items(${columns}) SELECT ${columns}
          FROM journey_portfolio_items_owner_membership_legacy`);
        db.exec("DROP TABLE journey_portfolio_items_owner_membership_legacy");
        for (const object of schemaObjects) db.exec(object.sql);
      })();
    } finally {
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
    }
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length) {
      throw new Error(
        "The Journey portfolio SQLite owner compatibility upgrade violated referential integrity.",
      );
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_definitions_tenant_identity ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_versions_tenant_identity ON journey_map_versions(id,definition_id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_evidence_tenant_identity ON journey_evidence_links(id,space_id);
    CREATE TABLE IF NOT EXISTS journey_portfolio_settings (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 3650),
      approval_required INTEGER NOT NULL DEFAULT 1 CHECK(approval_required IN (0,1)),
      default_scoring_policy_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_items (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('pain_point','opportunity','solution','initiative')),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 10000),
      lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','validated','approved','planned','active','blocked','completed','cancelled','archived')),
      owner_user_id TEXT, owner_team_id TEXT, priority TEXT, risk TEXT, severity INTEGER, frequency TEXT,
      desired_outcome TEXT, hypothesis TEXT, constraints_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(constraints_json)),
      estimated_effort REAL, estimated_cost REAL, expected_outcome TEXT,
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, due_date TEXT, progress_percent INTEGER,
      review_cadence_days INTEGER, review_state TEXT NOT NULL DEFAULT 'not_submitted'
        CHECK(review_state IN ('not_submitted','in_review','approved','changes_requested')), latest_review_id TEXT,
      target_metrics_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(target_metrics_json)),
      evidence_link_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_link_ids_json)),
      tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, retention_expires_at TEXT,
      UNIQUE(id,space_id), FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE NO ACTION,
      CHECK((state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL)),
      CHECK((kind='initiative' AND progress_percent BETWEEN 0 AND 100)
        OR (kind<>'initiative' AND progress_percent IS NULL AND due_date IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_portfolio_items_query ON journey_portfolio_items(space_id,state,kind,lifecycle,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_portfolio_items_owner ON journey_portfolio_items(space_id,owner_user_id,state,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_portfolio_items_delivery ON journey_portfolio_items(space_id,state,kind,lifecycle,due_date,priority,id);
    CREATE INDEX IF NOT EXISTS journey_portfolio_items_retention ON journey_portfolio_items(retention_expires_at,id) WHERE state='deleted';
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_items_owner_membership_insert_guard
      BEFORE INSERT ON journey_portfolio_items
      WHEN NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM space_memberships WHERE space_id=NEW.space_id AND user_id=NEW.owner_user_id)
      BEGIN SELECT RAISE(ABORT,'Journey portfolio owner is not a member of the space'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_items_owner_membership_update_guard
      BEFORE UPDATE OF space_id,owner_user_id ON journey_portfolio_items
      WHEN NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM space_memberships WHERE space_id=NEW.space_id AND user_id=NEW.owner_user_id)
      BEGIN SELECT RAISE(ABORT,'Journey portfolio owner is not a member of the space'); END;
    CREATE TABLE IF NOT EXISTS journey_portfolio_item_versions (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, space_id TEXT NOT NULL, revision INTEGER NOT NULL,
      schema_version INTEGER NOT NULL CHECK(schema_version=1), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64), change_reason TEXT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(item_id,space_id,revision),
      FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_portfolio_item_versions_history ON journey_portfolio_item_versions(space_id,item_id,revision DESC,id);
    CREATE TABLE IF NOT EXISTS journey_portfolio_item_evidence (
      item_id TEXT NOT NULL, space_id TEXT NOT NULL, evidence_link_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      PRIMARY KEY(item_id,evidence_link_id), UNIQUE(item_id,ordinal),
      FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(evidence_link_id,space_id) REFERENCES journey_evidence_links(id,space_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_item_tags (
      item_id TEXT NOT NULL, space_id TEXT NOT NULL, tag TEXT NOT NULL, ordinal INTEGER NOT NULL,
      PRIMARY KEY(item_id,tag), UNIQUE(item_id,ordinal),
      FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_initiative_metric_targets (
      item_id TEXT NOT NULL, space_id TEXT NOT NULL, metric_definition_id TEXT NOT NULL,
      metric_definition_version_id TEXT NOT NULL, direction TEXT NOT NULL, target_value REAL NOT NULL,
      unit TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(item_id,metric_definition_id,metric_definition_version_id),
      UNIQUE(item_id,ordinal), FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_relationships (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL, from_item_id TEXT NOT NULL, from_item_kind TEXT NOT NULL,
      to_item_id TEXT NOT NULL, to_item_kind TEXT NOT NULL, created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(space_id,relationship_type,from_item_id,to_item_id),
      FOREIGN KEY(from_item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(to_item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_journey_links (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
      item_kind TEXT NOT NULL, canonical_item_revision INTEGER NOT NULL, journey_definition_id TEXT NOT NULL,
      journey_version_id TEXT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, relationship TEXT NOT NULL,
      valid_from TEXT, valid_until TEXT, item_snapshot_json TEXT, item_snapshot_sha256 TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), FOREIGN KEY(item_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(item_id,space_id,canonical_item_revision) REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE,
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(journey_version_id,journey_definition_id,space_id) REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_portfolio_journey_links_current_once
      ON journey_portfolio_journey_links(space_id,item_id,journey_definition_id,target_type,target_id,relationship) WHERE journey_version_id IS NULL;
    CREATE INDEX IF NOT EXISTS journey_portfolio_journey_links_item ON journey_portfolio_journey_links(space_id,item_id,journey_definition_id,journey_version_id);
    CREATE INDEX IF NOT EXISTS journey_portfolio_journey_links_journey ON journey_portfolio_journey_links(space_id,journey_definition_id,target_type,target_id,item_kind);
    CREATE TABLE IF NOT EXISTS journey_initiative_dependencies (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      initiative_id TEXT NOT NULL, depends_on_initiative_id TEXT NOT NULL, dependency_type TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,initiative_id,depends_on_initiative_id), CHECK(initiative_id<>depends_on_initiative_id),
      FOREIGN KEY(initiative_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(depends_on_initiative_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_scoring_policies (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('rice','ice','weighted')), state TEXT NOT NULL CHECK(state IN ('draft','active','retired')),
      revision INTEGER NOT NULL DEFAULT 1, current_version_id TEXT, created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_scoring_policy_versions (
      id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, space_id TEXT NOT NULL, version_number INTEGER NOT NULL,
      method TEXT NOT NULL, formula_version TEXT NOT NULL, configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
      configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64), actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(id,policy_id,space_id), UNIQUE(policy_id,space_id,version_number),
      FOREIGN KEY(policy_id,space_id) REFERENCES journey_portfolio_scoring_policies(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_priority_assessments (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
      item_revision INTEGER NOT NULL, policy_version_id TEXT NOT NULL, method TEXT NOT NULL,
      input_json TEXT NOT NULL CHECK(json_valid(input_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
      score REAL, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, assessed_at TEXT NOT NULL,
      UNIQUE(id,space_id), FOREIGN KEY(item_id,space_id,item_revision)
        REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE,
      FOREIGN KEY(policy_version_id,space_id) REFERENCES journey_portfolio_scoring_policy_versions(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_portfolio_priority_assessments_history
      ON journey_portfolio_priority_assessments(space_id,item_id,assessed_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_initiative_baselines (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, initiative_id TEXT NOT NULL,
      initiative_revision INTEGER NOT NULL, metric_definition_id TEXT NOT NULL, metric_definition_version TEXT NOT NULL,
      target_json TEXT NOT NULL CHECK(json_valid(target_json)), observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
      checksum TEXT NOT NULL CHECK(length(checksum)=64), captured_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      captured_at TEXT NOT NULL, UNIQUE(id,space_id), FOREIGN KEY(initiative_id,space_id,initiative_revision)
        REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_initiative_outcome_comparisons (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, initiative_id TEXT NOT NULL,
      baseline_id TEXT NOT NULL, baseline_checksum TEXT NOT NULL, after_observation_json TEXT NOT NULL CHECK(json_valid(after_observation_json)),
      comparison_json TEXT NOT NULL CHECK(json_valid(comparison_json)), actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      compared_at TEXT NOT NULL, UNIQUE(id,space_id), FOREIGN KEY(baseline_id,space_id)
        REFERENCES journey_initiative_baselines(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(initiative_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_initiative_outcome_history
      ON journey_initiative_outcome_comparisons(space_id,initiative_id,compared_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_portfolio_reviews (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
      item_revision INTEGER NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('submit','approve','request_changes','withdraw')),
      note TEXT NOT NULL DEFAULT '', actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), FOREIGN KEY(item_id,space_id,item_revision)
        REFERENCES journey_portfolio_item_versions(item_id,space_id,revision) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_portfolio_reviews_history ON journey_portfolio_reviews(space_id,item_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_portfolio_operational_links (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, initiative_id TEXT NOT NULL,
      operational_kind TEXT NOT NULL CHECK(operational_kind IN ('assistant_action','recovery_ticket')), operational_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK(relationship IN ('informs','supports','delivers_follow_up')),
      outcome_state TEXT NOT NULL DEFAULT 'linked' CHECK(outcome_state IN ('linked','succeeded','failed','cancelled','unknown')),
      outcome_detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(outcome_detail_json)), revision INTEGER NOT NULL DEFAULT 1,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,space_id),
      UNIQUE(space_id,initiative_id,operational_kind,operational_id,relationship),
      FOREIGN KEY(initiative_id,space_id) REFERENCES journey_portfolio_items(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_operations (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, idempotency_key TEXT NOT NULL,
      action TEXT NOT NULL, intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64), response_json TEXT NOT NULL CHECK(json_valid(response_json)),
      created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(space_id,actor_user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS journey_portfolio_activity (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL, target_revision INTEGER, detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
      created_at TEXT NOT NULL, UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_portfolio_activity_history
      ON journey_portfolio_activity(space_id,target_kind,target_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_item_versions_update_guard BEFORE UPDATE ON journey_portfolio_item_versions
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_policy_versions_update_guard BEFORE UPDATE ON journey_portfolio_scoring_policy_versions
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_assessments_update_guard BEFORE UPDATE ON journey_portfolio_priority_assessments
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_baselines_update_guard BEFORE UPDATE ON journey_initiative_baselines
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_outcomes_update_guard BEFORE UPDATE ON journey_initiative_outcome_comparisons
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_reviews_update_guard BEFORE UPDATE ON journey_portfolio_reviews
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_operations_update_guard BEFORE UPDATE ON journey_portfolio_operations
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_operations_delete_guard BEFORE DELETE ON journey_portfolio_operations
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_activity_update_guard BEFORE UPDATE ON journey_portfolio_activity
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_portfolio_activity_delete_guard BEFORE DELETE ON journey_portfolio_activity
      BEGIN SELECT RAISE(ABORT,'Journey portfolio history is append-only'); END;
  `);
}
ensureSqliteSchema();

function settings(spaceId: string) {
  const row = db
    .prepare("SELECT * FROM journey_portfolio_settings WHERE space_id=?")
    .get(spaceId) as any;
  return row
    ? {
        enabled: Boolean(Number(row.enabled)),
        retentionDays: Number(row.retention_days),
        approvalRequired: Boolean(Number(row.approval_required)),
        defaultScoringPolicyId: row.default_scoring_policy_id || null,
        revision: Number(row.revision),
        updatedAt: row.updated_at as string,
      }
    : {
        enabled: true,
        retentionDays: 30,
        approvalRequired: true,
        defaultScoringPolicyId: null as string | null,
        revision: 0,
        updatedAt: null as string | null,
      };
}

function assertFeature(spaceId: string) {
  return assertSubscriptionFeature(spaceId, "journeyPortfolio");
}
function assertEnabled(spaceId: string) {
  assertFeature(spaceId);
  if (!settings(spaceId).enabled)
    throw new JourneyPortfolioError(
      "Journey portfolio is disabled for this space.",
      403,
      "JOURNEY_PORTFOLIO_DISABLED",
    );
}
function membershipRole(spaceId: string, userId: string) {
  const row = db
    .prepare(
      "SELECT role FROM space_memberships WHERE space_id=? AND user_id=?",
    )
    .get(spaceId, userId) as { role?: string } | undefined;
  if (!row || !["owner", "admin", "member"].includes(String(row.role))) {
    throw new JourneyPortfolioError(
      "Space membership is required.",
      403,
      "JOURNEY_PORTFOLIO_FORBIDDEN",
    );
  }
  return row.role as "owner" | "admin" | "member";
}
function assertManager(spaceId: string, userId: string) {
  const role = membershipRole(spaceId, userId);
  if (role === "member")
    throw new JourneyPortfolioError(
      "You do not have permission to manage the journey portfolio.",
      403,
      "JOURNEY_PORTFOLIO_FORBIDDEN",
    );
  return role;
}
function assertApprover(spaceId: string, userId: string) {
  return assertManager(spaceId, userId);
}
function lockSpace(spaceId: string) {
  const suffix = db.provider === "postgres" ? " FOR UPDATE" : "";
  const row = db
    .prepare(`SELECT id FROM spaces WHERE id=?${suffix}`)
    .get(spaceId) as { id?: string } | undefined;
  if (!row?.id)
    throw new JourneyPortfolioError("Space not found.", 404, "SPACE_NOT_FOUND");
}
function countActive(spaceId: string, table: string) {
  return Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) count FROM ${table} WHERE space_id=? AND state='active'`,
        )
        .get(spaceId) as { count?: number } | undefined
    )?.count || 0,
  );
}
/** Draft policies still occupy the allowance: they can be promoted to active
 * without a further admission check, so counting only active rows would let an
 * unlimited number of drafts queue up behind the quota. */
function countRetainedPolicies(spaceId: string) {
  return Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) count FROM journey_portfolio_scoring_policies
    WHERE space_id=? AND state<>'retired'`,
        )
        .get(spaceId) as { count?: number } | undefined
    )?.count || 0,
  );
}

function assertPortfolioQuota(
  spaceId: string,
  quota: "journeyPortfolioItems" | "journeyPortfolioScoringPolicies",
  current: number,
  additional = 1,
) {
  return assertSubscriptionQuota(spaceId, quota, current, additional);
}

function activity(input: {
  spaceId: string;
  actorUserId: string | null;
  action: string;
  targetKind: string;
  targetId: string;
  targetRevision?: number | null;
  detail?: Record<string, unknown>;
  at?: string;
}) {
  db.prepare(
    `INSERT INTO journey_portfolio_activity
    (id,space_id,actor_user_id,action,target_kind,target_id,target_revision,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    input.spaceId,
    input.actorUserId,
    input.action,
    input.targetKind,
    input.targetId,
    input.targetRevision ?? null,
    stableJson(input.detail || {}),
    input.at || nowIso(),
  );
}

function operationReplay(
  spaceId: string,
  actorUserId: string,
  key: string,
  action: string,
  intent: unknown,
) {
  const row = db
    .prepare(
      `SELECT action,intent_sha256,response_json FROM journey_portfolio_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`,
    )
    .get(spaceId, actorUserId, key) as any;
  if (!row) return null;
  const digest = sha256(stableJson(intent));
  if (row.action !== action || row.intent_sha256 !== digest)
    throw new JourneyPortfolioError(
      "This idempotency key was already used for a different request.",
      409,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_CONFLICT",
    );
  return parseJson<Record<string, unknown>>(row.response_json, {});
}
function recordOperation(
  spaceId: string,
  actorUserId: string,
  key: string,
  action: string,
  intent: unknown,
  response: Record<string, unknown>,
  at: string,
) {
  db.prepare(
    `INSERT INTO journey_portfolio_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    spaceId,
    actorUserId,
    key,
    action,
    sha256(stableJson(intent)),
    stableJson(response),
    at,
  );
}

function uniqueTokens(
  values: readonly unknown[],
  label: string,
  maximumItems: number,
  maximumLength = 128,
) {
  if (!Array.isArray(values) || values.length > maximumItems)
    throw new JourneyPortfolioError(
      `${label} exceeds its maximum size.`,
      400,
      "JOURNEY_PORTFOLIO_INPUT_INVALID",
      { field: label },
    );
  const result = values.map((value) => token(value, label, maximumLength));
  if (new Set(result).size !== result.length)
    throw new JourneyPortfolioError(
      `${label} contains a duplicate.`,
      400,
      "JOURNEY_PORTFOLIO_INPUT_INVALID",
      { field: label },
    );
  return result;
}

function assertOwner(spaceId: string, ownerUserId: string | null) {
  if (!ownerUserId) return;
  if (
    !db
      .prepare("SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?")
      .get(spaceId, ownerUserId)
  ) {
    throw new JourneyPortfolioError(
      "The selected owner is not a member of this space.",
      422,
      "JOURNEY_PORTFOLIO_OWNER_UNAVAILABLE",
    );
  }
}
function assertEvidence(spaceId: string, ids: string[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id FROM journey_evidence_links WHERE space_id=? AND id IN (${placeholders})
    AND invalidated_at IS NULL`,
    )
    .all(spaceId, ...ids) as Array<{ id: string }>;
  if (new Set(rows.map((row) => row.id)).size !== ids.length)
    throw new JourneyPortfolioError(
      "One or more evidence links are unavailable, invalidated, or outside this space.",
      422,
      "JOURNEY_PORTFOLIO_EVIDENCE_UNAVAILABLE",
    );
}

function normaliseTargets(
  spaceId: string,
  kind: JourneyPortfolioItemKind,
  input: readonly PortfolioMetricTarget[],
) {
  if (kind !== "initiative" && input.length)
    throw new JourneyPortfolioError(
      "Only initiatives can declare metric targets.",
      422,
      "JOURNEY_PORTFOLIO_KIND_FIELDS_INVALID",
    );
  if (input.length > journeyPortfolioLimits.metricTargets)
    throw new JourneyPortfolioError(
      "Too many metric targets.",
      400,
      "JOURNEY_PORTFOLIO_INPUT_INVALID",
    );
  const keys = new Set<string>();
  return input.map((entry, index) => {
    const target = {
      metricId: token(entry.metricId, `targetMetrics[${index}].metricId`),
      metricDefinitionVersion: token(
        entry.metricDefinitionVersion,
        `targetMetrics[${index}].metricDefinitionVersion`,
      ),
      direction: entry.direction,
      targetValue: Number(entry.targetValue),
      unit: token(entry.unit, `targetMetrics[${index}].unit`, 80),
    };
    if (
      !["higher_is_better", "lower_is_better"].includes(target.direction) ||
      !Number.isFinite(target.targetValue)
    ) {
      throw new JourneyPortfolioError(
        "Metric target direction and value are invalid.",
        400,
        "JOURNEY_PORTFOLIO_TARGET_INVALID",
        { index },
      );
    }
    const key = `${target.metricId}\u0000${target.metricDefinitionVersion}`;
    if (keys.has(key))
      throw new JourneyPortfolioError(
        "Metric target is duplicated.",
        400,
        "JOURNEY_PORTFOLIO_TARGET_DUPLICATE",
        { index },
      );
    keys.add(key);
    const version = db
      .prepare(
        `SELECT version.id FROM journey_metric_definition_versions version
      JOIN journey_metric_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
      WHERE definition.id=? AND version.id=? AND definition.space_id=?`,
      )
      .get(target.metricId, target.metricDefinitionVersion, spaceId);
    if (!version)
      throw new JourneyPortfolioError(
        "A metric target is unavailable or outside this space.",
        422,
        "JOURNEY_PORTFOLIO_TARGET_UNAVAILABLE",
        { index },
      );
    return target;
  });
}

const insightLifecycles = new Set<PortfolioLifecycle>([
  "draft",
  "validated",
  "approved",
  "archived",
]);
const initiativeLifecycles = new Set<PortfolioLifecycle>([
  "draft",
  "planned",
  "active",
  "blocked",
  "completed",
  "cancelled",
  "archived",
]);
function normaliseDraft(
  spaceId: string,
  input: PortfolioItemDraft,
): PortfolioItemDraft {
  const kind = input.kind;
  if (!["pain_point", "opportunity", "solution", "initiative"].includes(kind))
    throw new JourneyPortfolioError(
      "Unknown portfolio item kind.",
      400,
      "JOURNEY_PORTFOLIO_KIND_INVALID",
    );
  const lifecycle = input.lifecycle;
  if (
    !(kind === "initiative" ? initiativeLifecycles : insightLifecycles).has(
      lifecycle,
    )
  )
    throw new JourneyPortfolioError(
      "Lifecycle is not valid for this item kind.",
      422,
      "JOURNEY_PORTFOLIO_LIFECYCLE_INVALID",
    );
  const title = token(
    input.title,
    "title",
    journeyPortfolioLimits.titleCharacters,
  );
  const description = token(
    input.description,
    "description",
    journeyPortfolioLimits.descriptionCharacters,
  );
  const ownerUserId = optionalToken(input.ownerUserId, "ownerUserId");
  const ownerTeamId = optionalToken(input.ownerTeamId, "ownerTeamId");
  assertOwner(spaceId, ownerUserId);
  const evidenceLinkIds = uniqueTokens(
    input.evidenceLinkIds || [],
    "evidenceLinkIds",
    journeyPortfolioLimits.evidenceLinks,
  );
  assertEvidence(spaceId, evidenceLinkIds);
  const tags = uniqueTokens(
    input.tags || [],
    "tags",
    journeyPortfolioLimits.tags,
    80,
  )
    .map((tag) => tag.toLocaleLowerCase("en-US"))
    .sort();
  const constraints = uniqueTokens(
    input.constraints || [],
    "constraints",
    64,
    1_000,
  );
  const targetMetrics = normaliseTargets(
    spaceId,
    kind,
    input.targetMetrics || [],
  );
  const plannedStart = dateOnly(input.plannedStart, "plannedStart");
  const plannedEnd = dateOnly(input.plannedEnd, "plannedEnd");
  const actualStart = dateOnly(input.actualStart, "actualStart");
  const actualEnd = dateOnly(input.actualEnd, "actualEnd");
  const dueDate = dateOnly(input.dueDate, "dueDate");
  if (plannedStart && plannedEnd && plannedStart > plannedEnd)
    throw new JourneyPortfolioError(
      "Planned end must be on or after planned start.",
      422,
      "JOURNEY_PORTFOLIO_DATE_ORDER_INVALID",
    );
  if (actualStart && actualEnd && actualStart > actualEnd)
    throw new JourneyPortfolioError(
      "Actual end must be on or after actual start.",
      422,
      "JOURNEY_PORTFOLIO_DATE_ORDER_INVALID",
    );
  const cadence =
    input.reviewCadenceDays == null ? null : Number(input.reviewCadenceDays);
  if (
    cadence !== null &&
    (!Number.isSafeInteger(cadence) || cadence < 1 || cadence > 3650)
  )
    throw new JourneyPortfolioError(
      "Review cadence must be between 1 and 3650 days.",
      400,
      "JOURNEY_PORTFOLIO_CADENCE_INVALID",
    );
  const progress =
    input.progressPercent == null ? null : Number(input.progressPercent);
  if (
    kind === "initiative" &&
    (!Number.isSafeInteger(progress) || progress! < 0 || progress! > 100)
  ) {
    throw new JourneyPortfolioError(
      "Initiative progress must be a whole percentage from 0 to 100.",
      400,
      "JOURNEY_PORTFOLIO_PROGRESS_INVALID",
    );
  }
  if (kind !== "initiative" && (progress !== null || dueDate !== null))
    throw new JourneyPortfolioError(
      "Only initiatives can have progress or a delivery due date.",
      422,
      "JOURNEY_PORTFOLIO_KIND_FIELDS_INVALID",
    );
  const base = {
    kind,
    title,
    description,
    lifecycle,
    ownerUserId,
    ownerTeamId,
    evidenceLinkIds,
    tags,
    constraints,
    targetMetrics,
    plannedStart,
    plannedEnd,
    actualStart,
    actualEnd,
    dueDate,
    progressPercent: progress,
    reviewCadenceDays: cadence,
  };
  if (kind === "pain_point") {
    const severity = Number(input.severity);
    if (
      ![1, 2, 3, 4, 5].includes(severity) ||
      !["rare", "occasional", "frequent", "pervasive", "unknown"].includes(
        String(input.frequency),
      )
    ) {
      throw new JourneyPortfolioError(
        "Pain points require severity and frequency.",
        422,
        "JOURNEY_PORTFOLIO_KIND_FIELDS_INVALID",
      );
    }
    return {
      ...base,
      priority: null,
      risk: null,
      severity: severity as 1 | 2 | 3 | 4 | 5,
      frequency: input.frequency,
      desiredOutcome: null,
      hypothesis: null,
      estimatedEffort: null,
      estimatedCost: null,
      expectedOutcome: null,
    };
  }
  if (kind === "opportunity")
    return {
      ...base,
      priority: null,
      risk: null,
      severity: null,
      frequency: null,
      desiredOutcome: token(
        input.desiredOutcome,
        "desiredOutcome",
        journeyPortfolioLimits.detailCharacters,
      ),
      hypothesis: null,
      estimatedEffort: null,
      estimatedCost: null,
      expectedOutcome: null,
    };
  if (kind === "solution")
    return {
      ...base,
      priority: null,
      severity: null,
      frequency: null,
      desiredOutcome: null,
      hypothesis: token(
        input.hypothesis,
        "hypothesis",
        journeyPortfolioLimits.detailCharacters,
      ),
      estimatedEffort: finiteOrNull(input.estimatedEffort, "estimatedEffort"),
      estimatedCost: finiteOrNull(input.estimatedCost, "estimatedCost"),
      expectedOutcome: null,
      risk: ["low", "medium", "high", "unknown"].includes(String(input.risk))
        ? input.risk
        : "unknown",
    };
  if (
    !["low", "medium", "high", "critical"].includes(String(input.priority)) ||
    !["low", "medium", "high", "unknown"].includes(String(input.risk))
  )
    throw new JourneyPortfolioError(
      "Initiatives require priority and risk.",
      422,
      "JOURNEY_PORTFOLIO_KIND_FIELDS_INVALID",
    );
  return {
    ...base,
    severity: null,
    frequency: null,
    desiredOutcome: null,
    hypothesis: null,
    estimatedEffort: null,
    estimatedCost: null,
    expectedOutcome: token(
      input.expectedOutcome,
      "expectedOutcome",
      journeyPortfolioLimits.detailCharacters,
    ),
    priority: input.priority,
    risk: input.risk,
  };
}

/** PostgreSQL returns `DATE` and `TIMESTAMPTZ` as JavaScript `Date` values,
 * while SQLite stores the canonical strings this module writes. Normalise on
 * read so a round-tripped item still satisfies `dateOnly`/`nowIso` on update. */
function rowDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : null;
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/u.test(text) ? text.slice(0, 10) : text;
}
function rowInstant(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return String(value);
}

function itemFromRow(row: any): PortfolioItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    lifecycle: row.lifecycle,
    ownerUserId: row.owner_user_id || null,
    ownerTeamId: row.owner_team_id || null,
    priority: row.priority || null,
    risk: row.risk || null,
    severity:
      row.severity === null
        ? null
        : (Number(row.severity) as PortfolioItem["severity"]),
    frequency: row.frequency || null,
    desiredOutcome: row.desired_outcome || null,
    hypothesis: row.hypothesis || null,
    constraints: parseJson(row.constraints_json, []),
    estimatedEffort:
      row.estimated_effort === null ? null : Number(row.estimated_effort),
    estimatedCost:
      row.estimated_cost === null ? null : Number(row.estimated_cost),
    expectedOutcome: row.expected_outcome || null,
    plannedStart: rowDate(row.planned_start),
    plannedEnd: rowDate(row.planned_end),
    actualStart: rowDate(row.actual_start),
    actualEnd: rowDate(row.actual_end),
    dueDate: rowDate(row.due_date),
    progressPercent:
      row.progress_percent === null ? null : Number(row.progress_percent),
    reviewCadenceDays:
      row.review_cadence_days === null ? null : Number(row.review_cadence_days),
    reviewState: row.review_state,
    latestReviewId: row.latest_review_id || null,
    targetMetrics: parseJson(row.target_metrics_json, []),
    evidenceLinkIds: parseJson(row.evidence_link_ids_json, []),
    tags: parseJson(row.tags_json, []),
    state: row.state,
    revision: Number(row.revision),
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    createdAt: rowInstant(row.created_at) as string,
    updatedAt: rowInstant(row.updated_at) as string,
    deletedAt: rowInstant(row.deleted_at),
    retentionExpiresAt: rowInstant(row.retention_expires_at),
  };
}

function itemSnapshot(item: PortfolioItem) {
  const snapshot = { schemaVersion: JOURNEY_PORTFOLIO_SCHEMA_VERSION, ...item };
  const serialized = stableJson(snapshot);
  if (
    Buffer.byteLength(serialized, "utf8") >
    journeyPortfolioLimits.itemSnapshotBytes
  )
    throw new JourneyPortfolioError(
      "Portfolio item snapshot is too large.",
      413,
      "JOURNEY_PORTFOLIO_ITEM_TOO_LARGE",
    );
  return { snapshot, serialized, checksum: sha256(serialized) };
}

function insertVersion(
  spaceId: string,
  actorUserId: string,
  item: PortfolioItem,
  reason: string | null,
  at: string,
) {
  const canonical = itemSnapshot(item);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO journey_portfolio_item_versions
    (id,item_id,space_id,revision,schema_version,snapshot_json,snapshot_sha256,change_reason,actor_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    item.id,
    spaceId,
    item.revision,
    JOURNEY_PORTFOLIO_SCHEMA_VERSION,
    canonical.serialized,
    canonical.checksum,
    reason,
    actorUserId,
    at,
  );
  return { id, checksum: canonical.checksum };
}

function syncNormalised(spaceId: string, item: PortfolioItem) {
  db.prepare(
    "DELETE FROM journey_portfolio_item_evidence WHERE item_id=? AND space_id=?",
  ).run(item.id, spaceId);
  db.prepare(
    "DELETE FROM journey_portfolio_item_tags WHERE item_id=? AND space_id=?",
  ).run(item.id, spaceId);
  db.prepare(
    "DELETE FROM journey_initiative_metric_targets WHERE item_id=? AND space_id=?",
  ).run(item.id, spaceId);
  const evidence = db.prepare(`INSERT INTO journey_portfolio_item_evidence
    (item_id,space_id,evidence_link_id,ordinal) VALUES (?,?,?,?)`);
  item.evidenceLinkIds.forEach((id, ordinal) =>
    evidence.run(item.id, spaceId, id, ordinal),
  );
  const tag = db.prepare(
    "INSERT INTO journey_portfolio_item_tags (item_id,space_id,tag,ordinal) VALUES (?,?,?,?)",
  );
  item.tags.forEach((value, ordinal) =>
    tag.run(item.id, spaceId, value, ordinal),
  );
  const target = db.prepare(`INSERT INTO journey_initiative_metric_targets
    (item_id,space_id,metric_definition_id,metric_definition_version_id,direction,target_value,unit,ordinal)
    VALUES (?,?,?,?,?,?,?,?)`);
  item.targetMetrics.forEach((value, ordinal) =>
    target.run(
      item.id,
      spaceId,
      value.metricId,
      value.metricDefinitionVersion,
      value.direction,
      value.targetValue,
      value.unit,
      ordinal,
    ),
  );
}

function insertCurrent(
  spaceId: string,
  actorUserId: string,
  item: PortfolioItem,
) {
  db.prepare(
    `INSERT INTO journey_portfolio_items
    (id,space_id,kind,title,description,lifecycle,owner_user_id,owner_team_id,priority,risk,severity,frequency,
     desired_outcome,hypothesis,constraints_json,estimated_effort,estimated_cost,expected_outcome,planned_start,planned_end,
     actual_start,actual_end,due_date,progress_percent,review_cadence_days,review_state,latest_review_id,target_metrics_json,
     evidence_link_ids_json,tags_json,state,revision,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`,
  ).run(
    item.id,
    spaceId,
    item.kind,
    item.title,
    item.description,
    item.lifecycle,
    item.ownerUserId,
    item.ownerTeamId,
    item.priority,
    item.risk,
    item.severity,
    item.frequency,
    item.desiredOutcome,
    item.hypothesis,
    stableJson(item.constraints),
    item.estimatedEffort,
    item.estimatedCost,
    item.expectedOutcome,
    item.plannedStart,
    item.plannedEnd,
    item.actualStart,
    item.actualEnd,
    item.dueDate,
    item.progressPercent,
    item.reviewCadenceDays,
    item.reviewState,
    item.latestReviewId,
    stableJson(item.targetMetrics),
    stableJson(item.evidenceLinkIds),
    stableJson(item.tags),
    item.revision,
    actorUserId,
    actorUserId,
    item.createdAt,
    item.updatedAt,
    null,
    null,
  );
}

function exactItem(spaceId: string, itemId: string, includeDeleted = false) {
  const row = db
    .prepare(
      `SELECT * FROM journey_portfolio_items WHERE id=? AND space_id=?${includeDeleted ? "" : " AND state='active'"}`,
    )
    .get(itemId, spaceId) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "Portfolio item not found.",
      404,
      "JOURNEY_PORTFOLIO_ITEM_NOT_FOUND",
    );
  return itemFromRow(row);
}

function writeCurrent(
  spaceId: string,
  actorUserId: string,
  item: PortfolioItem,
  expectedRevision: number,
  at: string,
) {
  const changed = db
    .prepare(
      `UPDATE journey_portfolio_items SET title=?,description=?,lifecycle=?,owner_user_id=?,owner_team_id=?,
    priority=?,risk=?,severity=?,frequency=?,desired_outcome=?,hypothesis=?,constraints_json=?,estimated_effort=?,estimated_cost=?,
    expected_outcome=?,planned_start=?,planned_end=?,actual_start=?,actual_end=?,due_date=?,progress_percent=?,review_cadence_days=?,
    review_state=?,latest_review_id=?,target_metrics_json=?,evidence_link_ids_json=?,tags_json=?,revision=?,updated_by_user_id=?,updated_at=?
    WHERE id=? AND space_id=? AND state='active' AND revision=?`,
    )
    .run(
      item.title,
      item.description,
      item.lifecycle,
      item.ownerUserId,
      item.ownerTeamId,
      item.priority,
      item.risk,
      item.severity,
      item.frequency,
      item.desiredOutcome,
      item.hypothesis,
      stableJson(item.constraints),
      item.estimatedEffort,
      item.estimatedCost,
      item.expectedOutcome,
      item.plannedStart,
      item.plannedEnd,
      item.actualStart,
      item.actualEnd,
      item.dueDate,
      item.progressPercent,
      item.reviewCadenceDays,
      item.reviewState,
      item.latestReviewId,
      stableJson(item.targetMetrics),
      stableJson(item.evidenceLinkIds),
      stableJson(item.tags),
      item.revision,
      actorUserId,
      at,
      item.id,
      spaceId,
      expectedRevision,
    ).changes;
  if (changed !== 1)
    throw new JourneyPortfolioError(
      "Portfolio item revision conflict.",
      409,
      "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      { expectedRevision },
    );
  syncNormalised(spaceId, item);
}

function replayedItem(spaceId: string, marker: Record<string, unknown>) {
  const itemId = token(marker.itemId, "operation.itemId");
  const revision = Number(marker.revision);
  const row = db
    .prepare(
      `SELECT snapshot_json,snapshot_sha256 FROM journey_portfolio_item_versions
    WHERE item_id=? AND space_id=? AND revision=?`,
    )
    .get(itemId, spaceId, revision) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "The original idempotent result expired with its retention record.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  const snapshot = parseJson<Record<string, unknown>>(row.snapshot_json, {});
  if (!snapshot || sha256(stableJson(snapshot)) !== row.snapshot_sha256)
    throw new JourneyPortfolioError(
      "Portfolio item history failed its integrity check.",
      409,
      "JOURNEY_PORTFOLIO_INTEGRITY_FAILED",
    );
  const { schemaVersion: _schemaVersion, ...item } = snapshot;
  return item as PortfolioItem;
}

export function createJourneyPortfolioItem(input: {
  spaceId: string;
  actorUserId: string;
  draft: PortfolioItemDraft;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const draft = normaliseDraft(input.spaceId, input.draft);
  /** A new item has no review, so it cannot start in a lifecycle that only
   * review approval may grant. PostgreSQL enforces the same rule on INSERT
   * through `journey_portfolio_item_review_guard`; refusing here keeps SQLite
   * and PostgreSQL in agreement and returns the governed error instead of a
   * deferred constraint violation. */
  if (protectedLifecycles.has(draft.lifecycle))
    throw new JourneyPortfolioError(
      "This lifecycle must be reached through review approval, not at creation.",
      422,
      "JOURNEY_PORTFOLIO_APPROVAL_REQUIRED",
      { targetLifecycle: draft.lifecycle },
    );
  const intent = { draft };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "item.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    assertPortfolioQuota(
      input.spaceId,
      "journeyPortfolioItems",
      countActive(input.spaceId, "journey_portfolio_items"),
      1,
    );
    const item: PortfolioItem = {
      id: crypto.randomUUID(),
      ...draft,
      state: "active",
      revision: 1,
      reviewState: "not_submitted",
      latestReviewId: null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      retentionExpiresAt: null,
    };
    insertCurrent(input.spaceId, input.actorUserId, item);
    insertVersion(input.spaceId, input.actorUserId, item, "created", at);
    syncNormalised(input.spaceId, item);
    const marker = { itemId: item.id, revision: item.revision };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "item.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "item.created",
      targetKind: item.kind,
      targetId: item.id,
      targetRevision: item.revision,
      detail: {
        lifecycle: item.lifecycle,
        ownerAssigned: Boolean(item.ownerUserId || item.ownerTeamId),
      },
      at,
    });
    return { marker, replayed: false };
  })();
  return {
    item: result.replayed
      ? replayedItem(input.spaceId, result.marker)
      : exactItem(input.spaceId, String(result.marker.itemId)),
    replayed: result.replayed,
  };
}

function relationshipsForSpace(
  spaceId: string,
): JourneyPortfolioRelationship[] {
  return (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_relationships WHERE space_id=? ORDER BY created_at,id`,
      )
      .all(spaceId) as any[]
  ).map((row) => ({
    id: row.id,
    spaceId,
    type: row.relationship_type,
    fromKind: row.from_item_kind,
    fromId: row.from_item_id,
    toKind: row.to_item_kind,
    toId: row.to_item_id,
    createdAt: row.created_at,
  })) as JourneyPortfolioRelationship[];
}
function dependenciesForSpace(spaceId: string) {
  return (
    db
      .prepare(
        `SELECT * FROM journey_initiative_dependencies WHERE space_id=? ORDER BY created_at,id`,
      )
      .all(spaceId) as any[]
  ).map((row) => ({
    id: row.id,
    spaceId,
    initiativeId: row.initiative_id,
    dependsOnInitiativeId: row.depends_on_initiative_id,
    type: row.dependency_type,
    createdAt: row.created_at,
  }));
}
function domainItem(
  item: PortfolioItem,
  spaceId: string,
): JourneyPortfolioItem {
  const base = {
    id: item.id,
    spaceId,
    revision: item.revision,
    title: item.title,
    description: item.description,
    ownerUserId: item.ownerUserId,
    ownerTeamId: item.ownerTeamId,
    evidenceLinkIds: item.evidenceLinkIds,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (item.kind === "pain_point")
    return {
      ...base,
      kind: item.kind,
      lifecycle: item.lifecycle as InsightLifecycle,
      severity: item.severity!,
      frequency: item.frequency!,
    };
  if (item.kind === "opportunity")
    return {
      ...base,
      kind: item.kind,
      lifecycle: item.lifecycle as InsightLifecycle,
      desiredOutcome: item.desiredOutcome!,
    };
  if (item.kind === "solution")
    return {
      ...base,
      kind: item.kind,
      lifecycle: item.lifecycle as InsightLifecycle,
      hypothesis: item.hypothesis!,
      constraints: item.constraints,
      estimatedEffort: item.estimatedEffort,
      estimatedCost: item.estimatedCost,
      risk: item.risk!,
    };
  return {
    ...base,
    kind: item.kind,
    lifecycle: item.lifecycle as InitiativeLifecycle,
    priority: item.priority!,
    risk: item.risk!,
    expectedOutcome: item.expectedOutcome!,
    plannedStart: item.plannedStart,
    plannedEnd: item.plannedEnd,
    actualStart: item.actualStart,
    actualEnd: item.actualEnd,
    reviewCadenceDays: item.reviewCadenceDays,
    targetMetrics: item.targetMetrics,
  };
}

/** `outcomeComparisonIds` gates completion of the item being transitioned, so it
 * is scoped to that initiative. A space-wide list would let one initiative's
 * recorded before/after comparison satisfy the completion evidence rule for
 * every other initiative in the space. Relationships, dependencies and
 * initiatives stay space-wide because the readiness rules compare across them. */
function lifecycleContext(spaceId: string, initiativeId: string) {
  const initiatives = (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_items
    WHERE space_id=? AND state='active' AND kind='initiative' ORDER BY id`,
      )
      .all(spaceId) as any[]
  )
    .map(itemFromRow)
    .map((item) => domainItem(item, spaceId)) as JourneyInitiative[];
  return {
    relationships: relationshipsForSpace(spaceId),
    dependencies: dependenciesForSpace(spaceId),
    initiatives,
    outcomeComparisonIds: (
      db
        .prepare(
          `SELECT id FROM journey_initiative_outcome_comparisons
      WHERE space_id=? AND initiative_id=? ORDER BY compared_at,id`,
        )
        .all(spaceId, initiativeId) as Array<{ id: string }>
    ).map((row) => row.id),
  };
}

function mergePatch(
  spaceId: string,
  current: PortfolioItem,
  patch: PortfolioItemPatch,
) {
  const draft: PortfolioItemDraft = {
    kind: current.kind,
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    lifecycle: patch.lifecycle ?? current.lifecycle,
    ownerUserId:
      patch.ownerUserId === undefined ? current.ownerUserId : patch.ownerUserId,
    ownerTeamId:
      patch.ownerTeamId === undefined ? current.ownerTeamId : patch.ownerTeamId,
    priority: patch.priority === undefined ? current.priority : patch.priority,
    risk: patch.risk === undefined ? current.risk : patch.risk,
    severity: patch.severity === undefined ? current.severity : patch.severity,
    frequency:
      patch.frequency === undefined ? current.frequency : patch.frequency,
    desiredOutcome:
      patch.desiredOutcome === undefined
        ? current.desiredOutcome
        : patch.desiredOutcome,
    hypothesis:
      patch.hypothesis === undefined ? current.hypothesis : patch.hypothesis,
    constraints: patch.constraints ?? current.constraints,
    estimatedEffort:
      patch.estimatedEffort === undefined
        ? current.estimatedEffort
        : patch.estimatedEffort,
    estimatedCost:
      patch.estimatedCost === undefined
        ? current.estimatedCost
        : patch.estimatedCost,
    expectedOutcome:
      patch.expectedOutcome === undefined
        ? current.expectedOutcome
        : patch.expectedOutcome,
    plannedStart:
      patch.plannedStart === undefined
        ? current.plannedStart
        : patch.plannedStart,
    plannedEnd:
      patch.plannedEnd === undefined ? current.plannedEnd : patch.plannedEnd,
    actualStart:
      patch.actualStart === undefined ? current.actualStart : patch.actualStart,
    actualEnd:
      patch.actualEnd === undefined ? current.actualEnd : patch.actualEnd,
    dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
    progressPercent:
      patch.progressPercent === undefined
        ? current.progressPercent
        : patch.progressPercent,
    reviewCadenceDays:
      patch.reviewCadenceDays === undefined
        ? current.reviewCadenceDays
        : patch.reviewCadenceDays,
    targetMetrics: patch.targetMetrics ?? current.targetMetrics,
    evidenceLinkIds: patch.evidenceLinkIds ?? current.evidenceLinkIds,
    tags: patch.tags ?? current.tags,
  };
  return normaliseDraft(spaceId, draft);
}

const protectedLifecycles = new Set<PortfolioLifecycle>([
  "approved",
  "active",
  "blocked",
  "completed",
]);
function updateItemInside(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  expectedRevision: number;
  patch: PortfolioItemPatch;
  reason?: string | null;
  at: string;
}) {
  const current = exactItem(input.spaceId, input.itemId);
  if (current.revision !== input.expectedRevision)
    throw new JourneyPortfolioError(
      "Portfolio item revision conflict.",
      409,
      "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      {
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision,
      },
    );
  const draft = mergePatch(input.spaceId, current, input.patch);
  if (draft.lifecycle !== current.lifecycle) {
    if (protectedLifecycles.has(draft.lifecycle))
      throw new JourneyPortfolioError(
        "This lifecycle transition must be completed through review approval.",
        409,
        "JOURNEY_PORTFOLIO_APPROVAL_REQUIRED",
        { targetLifecycle: draft.lifecycle },
      );
    const validation = validateJourneyPortfolioLifecycleTransition(
      domainItem(current, input.spaceId),
      draft.lifecycle,
      lifecycleContext(input.spaceId, current.id),
    );
    if (!validation.valid)
      throw new JourneyPortfolioError(
        "Portfolio lifecycle transition is not ready.",
        422,
        "JOURNEY_PORTFOLIO_LIFECYCLE_NOT_READY",
        { issues: validation.issues },
      );
  }
  const next: PortfolioItem = {
    ...current,
    ...draft,
    revision: current.revision + 1,
    reviewState: "not_submitted",
    latestReviewId: null,
    updatedByUserId: input.actorUserId,
    updatedAt: input.at,
  };
  writeCurrent(
    input.spaceId,
    input.actorUserId,
    next,
    current.revision,
    input.at,
  );
  insertVersion(
    input.spaceId,
    input.actorUserId,
    next,
    input.reason || "updated",
    input.at,
  );
  activity({
    spaceId: input.spaceId,
    actorUserId: input.actorUserId,
    action: "item.updated",
    targetKind: next.kind,
    targetId: next.id,
    targetRevision: next.revision,
    detail: {
      previousRevision: current.revision,
      lifecycleFrom: current.lifecycle,
      lifecycleTo: next.lifecycle,
      reviewReset: current.reviewState !== "not_submitted",
    },
    at: input.at,
  });
  return next;
}

/** Runtime46 admission validates the exact canonical revision without mutating it. */
export function validateJourneyPortfolioRequestedTransition(input: {
  spaceId: string;
  itemId: string;
  expectedRevision: number;
  targetLifecycle: PortfolioLifecycle;
}) {
  const current = exactItem(input.spaceId, token(input.itemId, "itemId"));
  if (current.revision !== input.expectedRevision)
    throw new JourneyPortfolioError(
      "Portfolio item revision conflict.",
      409,
      "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      {
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision,
      },
    );
  const validation = validateJourneyPortfolioLifecycleTransition(
    domainItem(current, input.spaceId),
    input.targetLifecycle,
    lifecycleContext(input.spaceId, current.id),
  );
  if (!validation.valid)
    throw new JourneyPortfolioError(
      "Portfolio lifecycle transition is not ready.",
      422,
      "JOURNEY_PORTFOLIO_LIFECYCLE_NOT_READY",
      { issues: validation.issues },
    );
  return { item: current, validation };
}

/** Called only inside the Runtime46 approval transaction after two-person review. */
export function applyJourneyPortfolioRequestedTransitionInTransaction(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  expectedRevision: number;
  targetLifecycle: PortfolioLifecycle;
  requestId: string;
  decisionReason: string;
  at: string;
}) {
  const { item: current } = validateJourneyPortfolioRequestedTransition(input);
  const reviewId = crypto.randomUUID();
  const next: PortfolioItem = {
    ...current,
    lifecycle: input.targetLifecycle,
    revision: current.revision + 1,
    reviewState: "approved",
    latestReviewId: reviewId,
    updatedByUserId: input.actorUserId,
    updatedAt: input.at,
  };
  insertVersion(
    input.spaceId,
    input.actorUserId,
    next,
    `transition request ${input.requestId}`,
    input.at,
  );
  db.prepare(
    `INSERT INTO journey_portfolio_reviews
    (id,space_id,item_id,item_revision,decision,note,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    reviewId,
    input.spaceId,
    current.id,
    next.revision,
    "approve",
    input.decisionReason,
    input.actorUserId,
    input.at,
  );
  writeCurrent(
    input.spaceId,
    input.actorUserId,
    next,
    current.revision,
    input.at,
  );
  activity({
    spaceId: input.spaceId,
    actorUserId: input.actorUserId,
    action: "item.transition_applied",
    targetKind: next.kind,
    targetId: next.id,
    targetRevision: next.revision,
    detail: {
      requestId: input.requestId,
      lifecycleFrom: current.lifecycle,
      lifecycleTo: next.lifecycle,
      previousRevision: current.revision,
    },
    at: input.at,
  });
  return next;
}

export function updateJourneyPortfolioItem(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  expectedRevision: number;
  patch: PortfolioItemPatch;
  changeReason?: string | null;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const itemId = token(input.itemId, "itemId");
  const intent = {
    itemId,
    expectedRevision: input.expectedRevision,
    patch: input.patch,
    changeReason: input.changeReason || null,
  };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "item.update",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const item = updateItemInside({
      ...input,
      itemId,
      at,
      reason: optionalToken(input.changeReason, "changeReason", 1_000),
    });
    const marker = { itemId: item.id, revision: item.revision };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "item.update",
      intent,
      marker,
      at,
    );
    return { marker, replayed: false };
  })();
  return {
    item: result.replayed
      ? replayedItem(input.spaceId, result.marker)
      : exactItem(input.spaceId, itemId),
    replayed: result.replayed,
  };
}

export function bulkUpdateJourneyPortfolioItems(input: {
  spaceId: string;
  actorUserId: string;
  updates: Array<{
    itemId: string;
    expectedRevision: number;
    patch: PortfolioItemPatch;
  }>;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  if (
    !input.updates.length ||
    input.updates.length > journeyPortfolioLimits.relationshipsPerBulkRequest
  ) {
    throw new JourneyPortfolioError(
      "Bulk updates require between 1 and 100 items.",
      400,
      "JOURNEY_PORTFOLIO_BULK_SIZE_INVALID",
    );
  }
  const ids = input.updates.map((entry) => token(entry.itemId, "itemId"));
  if (new Set(ids).size !== ids.length)
    throw new JourneyPortfolioError(
      "Bulk update item IDs must be unique.",
      400,
      "JOURNEY_PORTFOLIO_BULK_DUPLICATE",
    );
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = { updates: input.updates };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "item.bulk_update",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const items = input.updates.map((entry) =>
      updateItemInside({
        spaceId: input.spaceId,
        actorUserId: input.actorUserId,
        itemId: entry.itemId,
        expectedRevision: entry.expectedRevision,
        patch: entry.patch,
        reason: "bulk update",
        at,
      }),
    );
    const marker = {
      items: items.map((item) => ({
        itemId: item.id,
        revision: item.revision,
      })),
    };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "item.bulk_update",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "items.bulk_updated",
      targetKind: "portfolio",
      targetId: input.spaceId,
      detail: { count: items.length },
      at,
    });
    return { marker, replayed: false };
  })();
  const markers = result.marker.items as Array<{
    itemId: string;
    revision: number;
  }>;
  return {
    items: markers.map((marker) =>
      result.replayed
        ? replayedItem(input.spaceId, marker)
        : exactItem(input.spaceId, marker.itemId),
    ),
    replayed: result.replayed,
  };
}

export type PortfolioOperationalLink = {
  id: string;
  initiativeId: string;
  operationalKind: "assistant_action" | "recovery_ticket";
  operationalId: string;
  relationship: "informs" | "supports" | "delivers_follow_up";
  outcomeState: "linked" | "succeeded" | "failed" | "cancelled" | "unknown";
  outcomeDetail: Record<string, unknown>;
  revision: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioOutcomeComparison = {
  id: string;
  initiativeId: string;
  baselineId: string;
  baselineChecksum: string;
  afterObservation: Record<string, unknown>;
  comparison: Record<string, unknown>;
  actorUserId: string | null;
  comparedAt: string;
};

export type PortfolioInitiativeBaseline = JourneyInitiativeBaseline & {
  capturedByUserId: string;
};

type OperationalKind = PortfolioOperationalLink["operationalKind"];
type OperationalRelationship = PortfolioOperationalLink["relationship"];
type OperationalOutcomeState = PortfolioOperationalLink["outcomeState"];

function operationalLinkFromRow(row: any): PortfolioOperationalLink {
  return {
    id: row.id,
    initiativeId: row.initiative_id,
    operationalKind: row.operational_kind,
    operationalId: row.operational_id,
    relationship: row.relationship,
    outcomeState: row.outcome_state,
    outcomeDetail: parseJson(row.outcome_detail_json, {}),
    revision: Number(row.revision),
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    createdAt: rowInstant(row.created_at) as string,
    updatedAt: rowInstant(row.updated_at) as string,
  };
}

function exactOperationalLink(spaceId: string, linkId: string) {
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_operational_links WHERE id=? AND space_id=?",
    )
    .get(linkId, spaceId) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "Operational link not found.",
      404,
      "JOURNEY_PORTFOLIO_OPERATIONAL_LINK_NOT_FOUND",
    );
  return operationalLinkFromRow(row);
}

function assertInitiative(spaceId: string, initiativeId: string) {
  const item = exactItem(spaceId, token(initiativeId, "initiativeId"));
  if (item.kind !== "initiative")
    throw new JourneyPortfolioError(
      "Operational outcomes require an initiative.",
      422,
      "JOURNEY_PORTFOLIO_INITIATIVE_REQUIRED",
    );
  return item;
}

function assertOperationalSource(
  spaceId: string,
  kind: OperationalKind,
  operationalId: string,
) {
  const found =
    kind === "assistant_action"
      ? db
          .prepare("SELECT id FROM assistant_actions WHERE id=? AND space_id=?")
          .get(operationalId, spaceId)
      : db
          .prepare(
            `SELECT ticket.id FROM tickets ticket JOIN surveys survey ON survey.id=ticket.survey_id
        WHERE ticket.id=? AND survey.space_id=?`,
          )
          .get(operationalId, spaceId);
  if (!found)
    throw new JourneyPortfolioError(
      "Operational source not found in this space.",
      404,
      "JOURNEY_PORTFOLIO_OPERATIONAL_SOURCE_NOT_FOUND",
    );
}

function outcomeDetail(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new JourneyPortfolioError(
      "Outcome detail must be a JSON object.",
      400,
      "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
    );
  let entries = 0;
  const validate = (entry: unknown, depth: number): void => {
    if (depth > 8)
      throw new JourneyPortfolioError(
        "Outcome detail is too deeply nested.",
        400,
        "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
      );
    if (entry === null || typeof entry === "boolean") return;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry))
        throw new JourneyPortfolioError(
          "Outcome detail contains a non-finite number.",
          400,
          "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
        );
      return;
    }
    if (typeof entry === "string") {
      if (
        entry.length > 2_000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry)
      ) {
        throw new JourneyPortfolioError(
          "Outcome detail contains unsafe or oversized text.",
          400,
          "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
        );
      }
      return;
    }
    if (Array.isArray(entry)) {
      if (entry.length > 100)
        throw new JourneyPortfolioError(
          "Outcome detail contains too many values.",
          400,
          "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
        );
      entry.forEach((item) => validate(item, depth + 1));
      return;
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      throw new JourneyPortfolioError(
        "Outcome detail must contain JSON-safe values.",
        400,
        "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
      );
    }
    for (const [key, child] of Object.entries(
      entry as Record<string, unknown>,
    )) {
      entries += 1;
      if (
        entries > 200 ||
        !key ||
        key.length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(key) ||
        ["__proto__", "prototype", "constructor"].includes(key)
      )
        throw new JourneyPortfolioError(
          "Outcome detail contains an unsafe or oversized key.",
          400,
          "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_INVALID",
        );
      validate(child, depth + 1);
    }
  };
  validate(value, 0);
  const serialized = stableJson(value);
  if (Buffer.byteLength(serialized, "utf8") > 16_384)
    throw new JourneyPortfolioError(
      "Outcome detail exceeds 16384 bytes.",
      400,
      "JOURNEY_PORTFOLIO_OUTCOME_DETAIL_TOO_LARGE",
    );
  return {
    value: parseJson<Record<string, unknown>>(serialized, {}),
    serialized,
  };
}

export function createJourneyPortfolioOperationalLink(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId: string;
  operationalKind: OperationalKind;
  operationalId: string;
  relationship: OperationalRelationship;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const initiativeId = token(input.initiativeId, "initiativeId");
  const operationalId = token(input.operationalId, "operationalId");
  if (
    !["assistant_action", "recovery_ticket"].includes(input.operationalKind) ||
    !["informs", "supports", "delivers_follow_up"].includes(input.relationship)
  ) {
    throw new JourneyPortfolioError(
      "Operational kind or relationship is invalid.",
      400,
      "JOURNEY_PORTFOLIO_OPERATIONAL_LINK_INVALID",
    );
  }
  const key = token(input.idempotencyKey, "idempotencyKey", 200);
  const intent = {
    initiativeId,
    operationalKind: input.operationalKind,
    operationalId,
    relationship: input.relationship,
  };
  const replay = operationReplay(
    input.spaceId,
    input.actorUserId,
    key,
    "operational_link.create",
    intent,
  );
  if (replay)
    return {
      operationalLink: exactOperationalLink(
        input.spaceId,
        token(replay.operationalLinkId, "operation.operationalLinkId"),
      ),
      replayed: true,
    };
  const at = nowIso(input.now);
  const id = crypto.randomUUID();
  db.transaction(() => {
    lockSpace(input.spaceId);
    assertInitiative(input.spaceId, initiativeId);
    assertOperationalSource(
      input.spaceId,
      input.operationalKind,
      operationalId,
    );
    try {
      db.prepare(
        `INSERT INTO journey_portfolio_operational_links
        (id,space_id,initiative_id,operational_kind,operational_id,relationship,outcome_state,outcome_detail_json,
         revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'linked','{}',1,?,?,?,?)`,
      ).run(
        id,
        input.spaceId,
        initiativeId,
        input.operationalKind,
        operationalId,
        input.relationship,
        input.actorUserId,
        input.actorUserId,
        at,
        at,
      );
    } catch (error) {
      if (!isDatabaseConstraintError(error)) throw error;
      throw new JourneyPortfolioError(
        "This operational source is already linked with that relationship.",
        409,
        "JOURNEY_PORTFOLIO_OPERATIONAL_LINK_DUPLICATE",
      );
    }
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "operational_link.create",
      intent,
      { operationalLinkId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "operational_link.created",
      targetKind: "operational_link",
      targetId: id,
      targetRevision: 1,
      detail: {
        initiativeId,
        operationalKind: input.operationalKind,
        operationalId,
        relationship: input.relationship,
      },
      at,
    });
  })();
  return {
    operationalLink: exactOperationalLink(input.spaceId, id),
    replayed: false,
  };
}

export function updateJourneyPortfolioOperationalOutcome(input: {
  spaceId: string;
  actorUserId: string;
  linkId: string;
  expectedRevision: number;
  outcomeState: OperationalOutcomeState;
  outcomeDetail: Record<string, unknown>;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const linkId = token(input.linkId, "linkId");
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !["linked", "succeeded", "failed", "cancelled", "unknown"].includes(
      input.outcomeState,
    )
  ) {
    throw new JourneyPortfolioError(
      "Outcome state or expected revision is invalid.",
      400,
      "JOURNEY_PORTFOLIO_OPERATIONAL_OUTCOME_INVALID",
    );
  }
  const detail = outcomeDetail(input.outcomeDetail);
  const at = nowIso(input.now);
  db.transaction(() => {
    exactOperationalLink(input.spaceId, linkId);
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_operational_links
      SET outcome_state=?,outcome_detail_json=?,revision=revision+1,updated_by_user_id=?,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`,
      )
      .run(
        input.outcomeState,
        detail.serialized,
        input.actorUserId,
        at,
        linkId,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Operational link revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
        { expectedRevision: input.expectedRevision },
      );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "operational_link.outcome_updated",
      targetKind: "operational_link",
      targetId: linkId,
      targetRevision: input.expectedRevision + 1,
      detail: { outcomeState: input.outcomeState },
      at,
    });
  })();
  return { operationalLink: exactOperationalLink(input.spaceId, linkId) };
}

/** Read-only projections of the operational-traceability and before/after tables.
 * Both are populated by write surfaces that Phase 3 has not delivered yet, so
 * these list empty until those land; the queries stay tenant-scoped and totally
 * ordered so the item detail contract and pagination remain deterministic. */
export function listJourneyPortfolioOperationalLinks(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId?: string;
}): PortfolioOperationalLink[] {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const clauses = ["space_id=?"];
  const values: unknown[] = [input.spaceId];
  if (input.initiativeId) {
    clauses.push("initiative_id=?");
    values.push(token(input.initiativeId, "initiativeId"));
  }
  return (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_operational_links WHERE ${clauses.join(" AND ")}
    ORDER BY created_at,id`,
      )
      .all(...values) as any[]
  ).map(operationalLinkFromRow);
}

function domainFailure(error: unknown): never {
  if (!(error instanceof JourneyPortfolioDomainError)) throw error;
  throw new JourneyPortfolioError(
    error.message,
    422,
    `JOURNEY_PORTFOLIO_${error.code}`,
    { domainCode: error.code },
  );
}

function observationSnapshot(
  spaceId: string,
  actorUserId: string,
  observationId: string,
): JourneyMetricObservationSnapshot {
  // This read provides the metric entitlement/audit boundary. The immutable raw
  // row below is then used because a baseline must preserve exact samples and
  // definition lineage, not the privacy-shaped public projection.
  try {
    getJourneyMetricObservation({ spaceId, observationId, actorUserId });
  } catch (error) {
    if (!(error instanceof JourneyMetricsError)) throw error;
    throw new JourneyPortfolioError(
      error.message,
      error.status === 404 ? 404 : 422,
      error.status === 404
        ? "JOURNEY_PORTFOLIO_OBSERVATION_NOT_FOUND"
        : "JOURNEY_PORTFOLIO_OBSERVATION_UNAVAILABLE",
      { metricCode: error.code },
    );
  }
  const row = db
    .prepare(
      `SELECT observation.*,version.content_sha256,version.population_json,version.filters_json,
      version.configuration_json
    FROM journey_metric_observations observation
    JOIN journey_metric_definition_versions version ON version.id=observation.definition_version_id
      AND version.definition_id=observation.definition_id AND version.space_id=observation.space_id
    WHERE observation.id=? AND observation.space_id=?`,
    )
    .get(observationId, spaceId) as any;
  if (
    !row ||
    row.status !== "available" ||
    row.value === null ||
    Number(row.minimum_sample_warning) === 1
  ) {
    throw new JourneyPortfolioError(
      "The metric observation is unavailable or privacy-suppressed.",
      422,
      "JOURNEY_PORTFOLIO_OBSERVATION_UNAVAILABLE",
    );
  }
  const configuration = parseJson<Record<string, unknown>>(
    row.configuration_json,
    {},
  );
  const configuredRefs = Array.isArray(configuration.sourceRefs)
    ? configuration.sourceRefs.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
  const lineages = Array.isArray(configuration.sourceLineages)
    ? configuration.sourceLineages
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => stableJson(entry))
    : [];
  const sourceRefs = [...new Set([...configuredRefs, ...lineages])].sort(
    compareKey,
  );
  if (!sourceRefs.length)
    sourceRefs.push(`metric-definition-version:${row.definition_version_id}`);
  return {
    observationId: String(row.id),
    metricId: String(row.definition_id),
    metricDefinitionVersion: String(row.definition_version_id),
    calculationVersion: String(row.content_sha256),
    value: Number(row.value),
    unit: String(row.unit),
    numerator: row.numerator === null ? null : Number(row.numerator),
    denominator: Number(row.denominator),
    sampleSize: Number(row.sample_size),
    period: {
      start: nowIso(row.period_start),
      end: nowIso(row.period_end),
      timezone: String(row.timezone),
    },
    populationKey: sha256(stableJson(parseJson(row.population_json, {}))),
    filterKey: sha256(stableJson(parseJson(row.filters_json, {}))),
    sourceRefs,
  };
}

function baselineFromRow(row: any): PortfolioInitiativeBaseline {
  const baseline = {
    baselineVersion: "journey-initiative-baseline/v1" as const,
    baselineId: String(row.id),
    initiativeId: String(row.initiative_id),
    initiativeRevision: Number(row.initiative_revision),
    capturedAt: rowInstant(row.captured_at) as string,
    capturedByUserId: String(row.captured_by_user_id),
    target: parseJson(row.target_json, {}),
    observation: parseJson(row.observation_json, {}),
    checksum: String(row.checksum),
  } as PortfolioInitiativeBaseline;
  try {
    verifyJourneyInitiativeBaseline(baseline);
  } catch (error) {
    domainFailure(error);
  }
  return baseline;
}

function exactBaseline(spaceId: string, baselineId: string) {
  const row = db
    .prepare(
      "SELECT * FROM journey_initiative_baselines WHERE id=? AND space_id=?",
    )
    .get(baselineId, spaceId) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "Initiative baseline not found.",
      404,
      "JOURNEY_PORTFOLIO_BASELINE_NOT_FOUND",
    );
  return baselineFromRow(row);
}

export function listJourneyInitiativeBaselines(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId?: string;
}): PortfolioInitiativeBaseline[] {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const clauses = ["space_id=?"];
  const values: unknown[] = [input.spaceId];
  if (input.initiativeId) {
    clauses.push("initiative_id=?");
    values.push(token(input.initiativeId, "initiativeId"));
  }
  return (
    db
      .prepare(
        `SELECT * FROM journey_initiative_baselines WHERE ${clauses.join(" AND ")}
    ORDER BY captured_at DESC,id`,
      )
      .all(...values) as any[]
  ).map(baselineFromRow);
}

export function captureJourneyInitiativeBaseline(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId: string;
  observationId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const initiativeId = token(input.initiativeId, "initiativeId");
  const observationId = token(input.observationId, "observationId");
  const key = token(input.idempotencyKey, "idempotencyKey", 200);
  const intent = { initiativeId, observationId };
  const replay = operationReplay(
    input.spaceId,
    input.actorUserId,
    key,
    "initiative_baseline.capture",
    intent,
  );
  if (replay)
    return {
      baseline: exactBaseline(
        input.spaceId,
        token(replay.baselineId, "operation.baselineId"),
      ),
      replayed: true,
    };
  const initiative = assertInitiative(input.spaceId, initiativeId);
  const observation = observationSnapshot(
    input.spaceId,
    input.actorUserId,
    observationId,
  );
  const target = initiative.targetMetrics.find(
    (entry) =>
      entry.metricId === observation.metricId &&
      entry.metricDefinitionVersion === observation.metricDefinitionVersion &&
      entry.unit === observation.unit,
  );
  if (!target)
    throw new JourneyPortfolioError(
      "The observation does not match an exact persisted metric target on this initiative.",
      422,
      "JOURNEY_PORTFOLIO_BASELINE_TARGET_MISMATCH",
    );
  const at = nowIso(input.now);
  const id = crypto.randomUUID();
  let baseline: JourneyInitiativeBaseline;
  try {
    baseline = createJourneyInitiativeBaseline({
      baselineId: id,
      initiativeId,
      initiativeRevision: initiative.revision,
      capturedAt: at,
      capturedByUserId: input.actorUserId,
      target,
      observation,
    });
    verifyJourneyInitiativeBaseline(baseline);
  } catch (error) {
    domainFailure(error);
  }
  db.transaction(() => {
    lockSpace(input.spaceId);
    db.prepare(
      `INSERT INTO journey_initiative_baselines
      (id,space_id,initiative_id,initiative_revision,metric_definition_id,metric_definition_version,target_json,
       observation_json,checksum,captured_by_user_id,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.spaceId,
      initiativeId,
      initiative.revision,
      observation.metricId,
      observation.metricDefinitionVersion,
      stableJson(baseline.target),
      stableJson(baseline.observation),
      baseline.checksum,
      input.actorUserId,
      at,
    );
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "initiative_baseline.capture",
      intent,
      { baselineId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "initiative_baseline.captured",
      targetKind: "initiative_baseline",
      targetId: id,
      detail: { initiativeId, observationId },
      at,
    });
  })();
  return { baseline: exactBaseline(input.spaceId, id), replayed: false };
}

export function createJourneyInitiativeOutcomeComparison(input: {
  spaceId: string;
  actorUserId: string;
  baselineId: string;
  afterObservationId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const baselineId = token(input.baselineId, "baselineId");
  const afterObservationId = token(
    input.afterObservationId,
    "afterObservationId",
  );
  const key = token(input.idempotencyKey, "idempotencyKey", 200);
  const intent = { baselineId, afterObservationId };
  const replay = operationReplay(
    input.spaceId,
    input.actorUserId,
    key,
    "initiative_outcome.compare",
    intent,
  );
  if (replay) {
    const comparisonId = token(replay.comparisonId, "operation.comparisonId");
    const found = listJourneyInitiativeOutcomes({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
    }).find((entry) => entry.id === comparisonId);
    if (!found)
      throw new JourneyPortfolioError(
        "Outcome comparison not found.",
        404,
        "JOURNEY_PORTFOLIO_OUTCOME_NOT_FOUND",
      );
    return { outcome: found, replayed: true };
  }
  const baseline = exactBaseline(input.spaceId, baselineId);
  const after = observationSnapshot(
    input.spaceId,
    input.actorUserId,
    afterObservationId,
  );
  const at = nowIso(input.now);
  const id = crypto.randomUUID();
  let comparison: ReturnType<typeof compareJourneyInitiativeOutcome>;
  try {
    comparison = compareJourneyInitiativeOutcome({
      comparisonId: id,
      baseline,
      after,
      comparedAt: at,
    });
  } catch (error) {
    domainFailure(error);
  }
  db.transaction(() => {
    lockSpace(input.spaceId);
    if (
      db
        .prepare(
          `SELECT 1 FROM journey_initiative_outcome_comparisons
      WHERE space_id=? AND baseline_id=? AND after_observation_json=?`,
        )
        .get(input.spaceId, baselineId, stableJson(after))
    ) {
      throw new JourneyPortfolioError(
        "This after observation was already compared with the baseline.",
        409,
        "JOURNEY_PORTFOLIO_OUTCOME_DUPLICATE",
      );
    }
    db.prepare(
      `INSERT INTO journey_initiative_outcome_comparisons
      (id,space_id,initiative_id,baseline_id,baseline_checksum,after_observation_json,comparison_json,actor_user_id,compared_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.spaceId,
      baseline.initiativeId,
      baselineId,
      baseline.checksum,
      stableJson(after),
      stableJson(comparison),
      input.actorUserId,
      at,
    );
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "initiative_outcome.compare",
      intent,
      { comparisonId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "initiative_outcome.compared",
      targetKind: "initiative_outcome",
      targetId: id,
      detail: {
        initiativeId: baseline.initiativeId,
        baselineId,
        afterObservationId,
      },
      at,
    });
  })();
  return {
    outcome: listJourneyInitiativeOutcomes({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      initiativeId: baseline.initiativeId,
    }).find((entry) => entry.id === id)!,
    replayed: false,
  };
}

export function listJourneyInitiativeOutcomes(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId?: string;
}): PortfolioOutcomeComparison[] {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const clauses = ["space_id=?"];
  const values: unknown[] = [input.spaceId];
  if (input.initiativeId) {
    clauses.push("initiative_id=?");
    values.push(token(input.initiativeId, "initiativeId"));
  }
  return (
    db
      .prepare(
        `SELECT * FROM journey_initiative_outcome_comparisons WHERE ${clauses.join(" AND ")}
    ORDER BY compared_at DESC,id`,
      )
      .all(...values) as any[]
  ).map((row) => ({
    id: row.id,
    initiativeId: row.initiative_id,
    baselineId: row.baseline_id,
    baselineChecksum: row.baseline_checksum,
    afterObservation: parseJson(row.after_observation_json, {}),
    comparison: parseJson(row.comparison_json, {}),
    actorUserId: row.actor_user_id || null,
    comparedAt: rowInstant(row.compared_at) as string,
  }));
}

export function getJourneyPortfolioItem(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  includeDeleted?: boolean;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const item = exactItem(
    input.spaceId,
    token(input.itemId, "itemId"),
    Boolean(input.includeDeleted),
  );
  const versions = (
    db
      .prepare(
        `SELECT id,revision,schema_version,snapshot_sha256,change_reason,actor_user_id,created_at
    FROM journey_portfolio_item_versions WHERE item_id=? AND space_id=? ORDER BY revision DESC,id`,
      )
      .all(item.id, input.spaceId) as any[]
  ).map((row) => ({
    id: row.id,
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    snapshotSha256: row.snapshot_sha256,
    changeReason: row.change_reason || null,
    actorUserId: row.actor_user_id || null,
    createdAt: row.created_at,
  }));
  const reviews = (
    db
      .prepare(
        `SELECT id,item_revision,decision,note,actor_user_id,created_at FROM journey_portfolio_reviews
    WHERE item_id=? AND space_id=? ORDER BY created_at DESC,id`,
      )
      .all(item.id, input.spaceId) as any[]
  ).map((row) => ({
    id: row.id,
    itemRevision: Number(row.item_revision),
    decision: row.decision,
    note: row.note,
    actorUserId: row.actor_user_id || null,
    createdAt: row.created_at,
  }));
  const assessments = (
    db
      .prepare(
        `SELECT id,item_revision,policy_version_id,method,input_json,result_json,score,actor_user_id,assessed_at
    FROM journey_portfolio_priority_assessments WHERE item_id=? AND space_id=? ORDER BY assessed_at DESC,id`,
      )
      .all(item.id, input.spaceId) as any[]
  ).map((row) => ({
    id: row.id,
    itemRevision: Number(row.item_revision),
    policyVersionId: row.policy_version_id,
    method: row.method,
    input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, {}),
    score: row.score === null ? null : Number(row.score),
    actorUserId: row.actor_user_id || null,
    assessedAt: row.assessed_at,
  }));
  const journeyLinks = listJourneyPortfolioJourneyLinks({
    ...input,
    itemId: item.id,
  });
  const operationalLinks =
    item.kind === "initiative"
      ? listJourneyPortfolioOperationalLinks({
          ...input,
          initiativeId: item.id,
        })
      : [];
  const baselines =
    item.kind === "initiative"
      ? listJourneyInitiativeBaselines({ ...input, initiativeId: item.id })
      : [];
  const outcomes =
    item.kind === "initiative"
      ? listJourneyInitiativeOutcomes({ ...input, initiativeId: item.id })
      : [];
  return {
    item,
    versions,
    reviews,
    assessments,
    journeyLinks,
    operationalLinks,
    baselines,
    outcomes,
  };
}

export function listJourneyPortfolioItems(input: {
  spaceId: string;
  actorUserId: string;
  kind?: JourneyPortfolioItemKind;
  lifecycle?: PortfolioLifecycle;
  ownerUserId?: string;
  priority?: PortfolioPriority;
  risk?: PortfolioRisk;
  tag?: string;
  search?: string;
  state?: "active" | "deleted";
  dueBefore?: string;
  evidenceState?: "with_evidence" | "without_evidence";
  sort?: "updated" | "priority" | "due" | "score";
  limit?: number;
  offset?: number;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const requestedLimit = Number(input.limit ?? 50);
  const requestedOffset = Number(input.offset ?? 0);
  if (!Number.isFinite(requestedLimit) || !Number.isFinite(requestedOffset))
    throw new JourneyPortfolioError(
      "Pagination limit and offset must be finite numbers.",
      400,
      "JOURNEY_PORTFOLIO_PAGINATION_INVALID",
    );
  const limit = Math.max(
    1,
    Math.min(journeyPortfolioLimits.pageSize, Math.trunc(requestedLimit) || 50),
  );
  const offset = Math.max(0, Math.trunc(requestedOffset));
  const clauses = ["item.space_id=?", "item.state=?"];
  const values: unknown[] = [input.spaceId, input.state || "active"];
  if (input.kind) {
    clauses.push("item.kind=?");
    values.push(input.kind);
  }
  if (input.lifecycle) {
    clauses.push("item.lifecycle=?");
    values.push(input.lifecycle);
  }
  if (input.ownerUserId) {
    clauses.push("item.owner_user_id=?");
    values.push(input.ownerUserId);
  }
  if (input.priority) {
    clauses.push("item.priority=?");
    values.push(input.priority);
  }
  if (input.risk) {
    clauses.push("item.risk=?");
    values.push(input.risk);
  }
  if (input.dueBefore) {
    clauses.push("item.due_date<=?");
    values.push(dateOnly(input.dueBefore, "dueBefore"));
  }
  if (input.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM journey_portfolio_item_tags tag
    WHERE tag.item_id=item.id AND tag.space_id=item.space_id AND tag.tag=?)`);
    values.push(token(input.tag, "tag", 80).toLocaleLowerCase("en-US"));
  }
  if (input.evidenceState === "with_evidence")
    clauses.push(`EXISTS (SELECT 1 FROM journey_portfolio_item_evidence evidence
    WHERE evidence.item_id=item.id AND evidence.space_id=item.space_id)`);
  if (input.evidenceState === "without_evidence")
    clauses.push(`NOT EXISTS (SELECT 1 FROM journey_portfolio_item_evidence evidence
    WHERE evidence.item_id=item.id AND evidence.space_id=item.space_id)`);
  if (input.search) {
    const term = `%${token(input.search, "search", 200).replace(/[%_\\]/gu, "\\$&")}%`;
    clauses.push(
      `(LOWER(item.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(item.description) LIKE LOWER(?) ESCAPE '\\')`,
    );
    values.push(term, term);
  }
  // Ties break the same way the item's assessment history orders, so the listed
  // latest score is always the first row of that history rather than its opposite.
  const latestScore = `(SELECT assessment.score FROM journey_portfolio_priority_assessments assessment
    WHERE assessment.item_id=item.id AND assessment.space_id=item.space_id ORDER BY assessment.assessed_at DESC,assessment.id LIMIT 1)`;
  const linkCount = `(SELECT COUNT(*) FROM journey_portfolio_journey_links link
    WHERE link.item_id=item.id AND link.space_id=item.space_id)`;
  const evidenceCount = `(SELECT COUNT(*) FROM journey_portfolio_item_evidence evidence
    WHERE evidence.item_id=item.id AND evidence.space_id=item.space_id)`;
  const order =
    input.sort === "priority"
      ? `CASE item.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,item.updated_at DESC,item.id`
      : input.sort === "due"
        ? "item.due_date IS NULL,item.due_date,item.id"
        : input.sort === "score"
          ? "latest_score IS NULL,latest_score DESC,item.id"
          : "item.updated_at DESC,item.id";
  const count = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) count FROM journey_portfolio_items item WHERE ${clauses.join(" AND ")}`,
        )
        .get(...values) as { count?: number } | undefined
    )?.count || 0,
  );
  const rows = db
    .prepare(
      `SELECT item.*,${latestScore} latest_score,${linkCount} usage_count,${evidenceCount} evidence_count
    FROM journey_portfolio_items item WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset) as any[];
  return {
    items: rows.map((row) => ({
      ...itemFromRow(row),
      latestScore: row.latest_score === null ? null : Number(row.latest_score),
      usageCount: Number(row.usage_count),
      evidenceCount: Number(row.evidence_count),
    })),
    page: {
      limit,
      offset,
      total: count,
      hasMore: offset + rows.length < count,
    },
  };
}

const relationshipShape = {
  pain_point_to_opportunity: ["pain_point", "opportunity"],
  opportunity_to_solution: ["opportunity", "solution"],
  solution_to_initiative: ["solution", "initiative"],
} as const;

function relationshipFromRow(row: any): PortfolioRelationship {
  return {
    id: row.id,
    type: row.relationship_type,
    fromItemId: row.from_item_id,
    fromItemKind: row.from_item_kind,
    toItemId: row.to_item_id,
    toItemKind: row.to_item_kind,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
  };
}

export function createJourneyPortfolioRelationship(input: {
  spaceId: string;
  actorUserId: string;
  type: keyof typeof relationshipShape;
  fromItemId: string;
  toItemId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const type = input.type;
  const shape = relationshipShape[type];
  if (!shape)
    throw new JourneyPortfolioError(
      "Unknown portfolio relationship type.",
      400,
      "JOURNEY_PORTFOLIO_RELATIONSHIP_INVALID",
    );
  const fromItemId = token(input.fromItemId, "fromItemId");
  const toItemId = token(input.toItemId, "toItemId");
  if (fromItemId === toItemId)
    throw new JourneyPortfolioError(
      "A portfolio item cannot relate to itself.",
      422,
      "JOURNEY_PORTFOLIO_RELATIONSHIP_SELF",
    );
  const intent = { type, fromItemId, toItemId };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "relationship.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const from = exactItem(input.spaceId, fromItemId);
    const to = exactItem(input.spaceId, toItemId);
    if (from.kind !== shape[0] || to.kind !== shape[1])
      throw new JourneyPortfolioError(
        "Relationship endpoints do not match the selected relationship type.",
        422,
        "JOURNEY_PORTFOLIO_RELATIONSHIP_KIND_INVALID",
        { expectedFrom: shape[0], expectedTo: shape[1] },
      );
    const id = crypto.randomUUID();
    try {
      db.prepare(
        `INSERT INTO journey_portfolio_relationships
        (id,space_id,relationship_type,from_item_id,from_item_kind,to_item_id,to_item_kind,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        input.spaceId,
        type,
        from.id,
        from.kind,
        to.id,
        to.kind,
        input.actorUserId,
        at,
      );
    } catch (error) {
      if (!isDatabaseConstraintError(error)) throw error;
      throw new JourneyPortfolioError(
        "This portfolio relationship already exists.",
        409,
        "JOURNEY_PORTFOLIO_RELATIONSHIP_EXISTS",
      );
    }
    const marker = { relationshipId: id };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "relationship.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "relationship.created",
      targetKind: "portfolio_relationship",
      targetId: id,
      detail: { type, fromItemId, toItemId },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_relationships WHERE id=? AND space_id=?",
    )
    .get(String(result.marker.relationshipId), input.spaceId);
  if (!row)
    throw new JourneyPortfolioError(
      "The original relationship result is no longer retained.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  return { relationship: relationshipFromRow(row), replayed: result.replayed };
}

export function deleteJourneyPortfolioRelationship(input: {
  spaceId: string;
  actorUserId: string;
  relationshipId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const id = token(input.relationshipId, "relationshipId");
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = { relationshipId: id };
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "relationship.delete",
      intent,
    );
    if (replay) return { deleted: true, replayed: true };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_relationships WHERE id=? AND space_id=?",
      )
      .get(id, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Portfolio relationship not found.",
        404,
        "JOURNEY_PORTFOLIO_RELATIONSHIP_NOT_FOUND",
      );
    db.prepare(
      "DELETE FROM journey_portfolio_relationships WHERE id=? AND space_id=?",
    ).run(id, input.spaceId);
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "relationship.delete",
      intent,
      { relationshipId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "relationship.deleted",
      targetKind: "portfolio_relationship",
      targetId: id,
      detail: {
        type: row.relationship_type,
        fromItemId: row.from_item_id,
        toItemId: row.to_item_id,
      },
      at,
    });
    return { deleted: true, replayed: false };
  })();
}

export function listJourneyPortfolioRelationships(input: {
  spaceId: string;
  actorUserId: string;
  itemId?: string;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const rows = input.itemId
    ? db
        .prepare(
          `SELECT * FROM journey_portfolio_relationships WHERE space_id=? AND (from_item_id=? OR to_item_id=?)
      ORDER BY created_at,id`,
        )
        .all(input.spaceId, input.itemId, input.itemId)
    : db
        .prepare(
          "SELECT * FROM journey_portfolio_relationships WHERE space_id=? ORDER BY created_at,id",
        )
        .all(input.spaceId);
  return (rows as any[]).map(relationshipFromRow);
}

const itemJourneyRelationships: Record<
  JourneyPortfolioItemKind,
  PortfolioJourneyLink["relationship"][]
> = {
  pain_point: ["occurs_at", "affects"],
  opportunity: ["improves"],
  solution: ["changes"],
  initiative: ["delivers"],
};
function linkFromRow(row: any): PortfolioJourneyLink {
  return {
    id: row.id,
    itemId: row.item_id,
    itemKind: row.item_kind,
    canonicalItemRevision: Number(row.canonical_item_revision),
    journeyDefinitionId: row.journey_definition_id,
    journeyVersionId: row.journey_version_id || null,
    targetType: row.target_type,
    targetId: row.target_id,
    relationship: row.relationship,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    itemSnapshot: row.item_snapshot_json
      ? parseJson(row.item_snapshot_json, {})
      : null,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
  };
}
function assertJourneyTarget(input: {
  spaceId: string;
  journeyDefinitionId: string;
  journeyVersionId: string | null;
  targetType: PortfolioJourneyLink["targetType"];
  targetId: string;
}) {
  const definition = db
    .prepare(
      "SELECT id,current_version_id FROM journey_definitions WHERE id=? AND space_id=?",
    )
    .get(input.journeyDefinitionId, input.spaceId) as any;
  if (!definition)
    throw new JourneyPortfolioError(
      "Journey definition not found.",
      404,
      "JOURNEY_PORTFOLIO_JOURNEY_NOT_FOUND",
    );
  const versionId = input.journeyVersionId || definition.current_version_id;
  if (input.journeyVersionId) {
    const version = db
      .prepare(
        `SELECT id,state FROM journey_map_versions WHERE id=? AND definition_id=? AND space_id=?`,
      )
      .get(
        input.journeyVersionId,
        input.journeyDefinitionId,
        input.spaceId,
      ) as any;
    if (
      !version ||
      !["published", "superseded"].includes(String(version.state))
    )
      throw new JourneyPortfolioError(
        "Pinned portfolio links require an exact published journey version.",
        422,
        "JOURNEY_PORTFOLIO_JOURNEY_VERSION_INVALID",
      );
  }
  let target: unknown;
  if (input.targetType === "journey")
    target = input.targetId === input.journeyDefinitionId ? definition : null;
  if (input.targetType === "stage")
    target = db
      .prepare(
        `SELECT id FROM journey_map_stages
    WHERE id=? AND space_id=? AND version_id=?`,
      )
      .get(input.targetId, input.spaceId, versionId);
  if (input.targetType === "touchpoint")
    target = db
      .prepare(
        `SELECT id FROM journey_touchpoints
    WHERE id=? AND space_id=?`,
      )
      .get(input.targetId, input.spaceId);
  if (input.targetType === "persona")
    target = db
      .prepare(
        `SELECT 1 FROM journey_definition_personas
    WHERE definition_id=? AND persona_id=? AND space_id=?`,
      )
      .get(input.journeyDefinitionId, input.targetId, input.spaceId);
  if (!target)
    throw new JourneyPortfolioError(
      "Journey target is unavailable or outside the selected journey.",
      422,
      "JOURNEY_PORTFOLIO_JOURNEY_TARGET_INVALID",
    );
}

export function createJourneyPortfolioJourneyLink(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  journeyDefinitionId: string;
  journeyVersionId?: string | null;
  targetType: PortfolioJourneyLink["targetType"];
  targetId: string;
  relationship: PortfolioJourneyLink["relationship"];
  validFrom?: string | null;
  validUntil?: string | null;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const itemId = token(input.itemId, "itemId");
  const journeyDefinitionId = token(
    input.journeyDefinitionId,
    "journeyDefinitionId",
  );
  const journeyVersionId = optionalToken(
    input.journeyVersionId,
    "journeyVersionId",
  );
  const targetId = token(input.targetId, "targetId");
  const validFrom = input.validFrom ? nowIso(input.validFrom) : null;
  const validUntil = input.validUntil ? nowIso(input.validUntil) : null;
  if (validFrom && validUntil && validFrom >= validUntil)
    throw new JourneyPortfolioError(
      "Link validity end must be after its start.",
      422,
      "JOURNEY_PORTFOLIO_LINK_WINDOW_INVALID",
    );
  const intent = {
    itemId,
    journeyDefinitionId,
    journeyVersionId,
    targetType: input.targetType,
    targetId,
    relationship: input.relationship,
    validFrom,
    validUntil,
  };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "journey_link.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const item = exactItem(input.spaceId, itemId);
    if (!itemJourneyRelationships[item.kind].includes(input.relationship))
      throw new JourneyPortfolioError(
        "That journey relationship is not valid for this portfolio item type.",
        422,
        "JOURNEY_PORTFOLIO_LINK_RELATIONSHIP_INVALID",
      );
    assertJourneyTarget({
      spaceId: input.spaceId,
      journeyDefinitionId,
      journeyVersionId,
      targetType: input.targetType,
      targetId,
    });
    const snapshot = journeyVersionId ? itemSnapshot(item) : null;
    const id = crypto.randomUUID();
    try {
      db.prepare(
        `INSERT INTO journey_portfolio_journey_links
        (id,space_id,item_id,item_kind,canonical_item_revision,journey_definition_id,journey_version_id,target_type,target_id,
         relationship,valid_from,valid_until,item_snapshot_json,item_snapshot_sha256,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        input.spaceId,
        item.id,
        item.kind,
        item.revision,
        journeyDefinitionId,
        journeyVersionId,
        input.targetType,
        targetId,
        input.relationship,
        validFrom,
        validUntil,
        snapshot?.serialized || null,
        snapshot?.checksum || null,
        input.actorUserId,
        at,
      );
    } catch (error) {
      if (!isDatabaseConstraintError(error)) throw error;
      throw new JourneyPortfolioError(
        "This journey usage link already exists.",
        409,
        "JOURNEY_PORTFOLIO_LINK_EXISTS",
      );
    }
    const marker = { linkId: id };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "journey_link.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "journey_link.created",
      targetKind: item.kind,
      targetId: item.id,
      targetRevision: item.revision,
      detail: {
        linkId: id,
        journeyDefinitionId,
        journeyVersionId,
        targetType: input.targetType,
        targetId,
      },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_journey_links WHERE id=? AND space_id=?",
    )
    .get(String(result.marker.linkId), input.spaceId);
  if (!row)
    throw new JourneyPortfolioError(
      "The original journey link is no longer retained.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  return { link: linkFromRow(row), replayed: result.replayed };
}

export function deleteJourneyPortfolioJourneyLink(input: {
  spaceId: string;
  actorUserId: string;
  linkId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const id = token(input.linkId, "linkId");
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = { linkId: id };
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "journey_link.delete",
      intent,
    );
    if (replay) return { deleted: true, replayed: true };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_journey_links WHERE id=? AND space_id=?",
      )
      .get(id, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Journey usage link not found.",
        404,
        "JOURNEY_PORTFOLIO_LINK_NOT_FOUND",
      );
    db.prepare(
      "DELETE FROM journey_portfolio_journey_links WHERE id=? AND space_id=?",
    ).run(id, input.spaceId);
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "journey_link.delete",
      intent,
      { linkId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "journey_link.deleted",
      targetKind: row.item_kind,
      targetId: row.item_id,
      targetRevision: Number(row.canonical_item_revision),
      detail: { linkId: id, journeyDefinitionId: row.journey_definition_id },
      at,
    });
    return { deleted: true, replayed: false };
  })();
}

export function listJourneyPortfolioJourneyLinks(input: {
  spaceId: string;
  actorUserId: string;
  itemId?: string;
  journeyDefinitionId?: string;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const clauses = ["space_id=?"];
  const values: unknown[] = [input.spaceId];
  if (input.itemId) {
    clauses.push("item_id=?");
    values.push(input.itemId);
  }
  if (input.journeyDefinitionId) {
    clauses.push("journey_definition_id=?");
    values.push(input.journeyDefinitionId);
  }
  return (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_journey_links WHERE ${clauses.join(" AND ")}
    ORDER BY created_at,id`,
      )
      .all(...values) as any[]
  ).map(linkFromRow);
}

function dependencyFromRow(row: any): PortfolioDependency {
  return {
    id: row.id,
    initiativeId: row.initiative_id,
    dependsOnInitiativeId: row.depends_on_initiative_id,
    type: row.dependency_type,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
  };
}
export function createJourneyInitiativeDependency(input: {
  spaceId: string;
  actorUserId: string;
  initiativeId: string;
  dependsOnInitiativeId: string;
  type: PortfolioDependency["type"];
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = {
    initiativeId: token(input.initiativeId, "initiativeId"),
    dependsOnInitiativeId: token(
      input.dependsOnInitiativeId,
      "dependsOnInitiativeId",
    ),
    type: input.type,
  };
  if (intent.initiativeId === intent.dependsOnInitiativeId)
    throw new JourneyPortfolioError(
      "An initiative cannot depend on itself.",
      422,
      "JOURNEY_PORTFOLIO_DEPENDENCY_SELF",
    );
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "dependency.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const initiative = exactItem(input.spaceId, intent.initiativeId);
    const prerequisite = exactItem(input.spaceId, intent.dependsOnInitiativeId);
    if (initiative.kind !== "initiative" || prerequisite.kind !== "initiative")
      throw new JourneyPortfolioError(
        "Dependencies require two initiatives.",
        422,
        "JOURNEY_PORTFOLIO_DEPENDENCY_KIND_INVALID",
      );
    const candidate = {
      id: crypto.randomUUID(),
      spaceId: input.spaceId,
      ...intent,
      createdAt: at,
    };
    const initiatives = (
      db
        .prepare(
          `SELECT * FROM journey_portfolio_items WHERE space_id=? AND kind='initiative' AND state='active'`,
        )
        .all(input.spaceId) as any[]
    )
      .map(itemFromRow)
      .map((item) => domainItem(item, input.spaceId)) as JourneyInitiative[];
    const analysis = analyseJourneyInitiativeDependencies(initiatives, [
      ...dependenciesForSpace(input.spaceId),
      candidate,
    ]);
    if (!analysis.valid)
      throw new JourneyPortfolioError(
        "Initiative dependency would create a cycle.",
        422,
        "JOURNEY_PORTFOLIO_DEPENDENCY_CYCLE",
        { cycles: analysis.cycles },
      );
    try {
      db.prepare(
        `INSERT INTO journey_initiative_dependencies
        (id,space_id,initiative_id,depends_on_initiative_id,dependency_type,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`,
      ).run(
        candidate.id,
        input.spaceId,
        candidate.initiativeId,
        candidate.dependsOnInitiativeId,
        candidate.type,
        input.actorUserId,
        at,
      );
    } catch (error) {
      if (!isDatabaseConstraintError(error)) throw error;
      throw new JourneyPortfolioError(
        "This initiative dependency already exists.",
        409,
        "JOURNEY_PORTFOLIO_DEPENDENCY_EXISTS",
      );
    }
    const marker = { dependencyId: candidate.id };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "dependency.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "dependency.created",
      targetKind: "initiative",
      targetId: candidate.initiativeId,
      detail: {
        dependencyId: candidate.id,
        dependsOnInitiativeId: candidate.dependsOnInitiativeId,
        type: candidate.type,
      },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_initiative_dependencies WHERE id=? AND space_id=?",
    )
    .get(String(result.marker.dependencyId), input.spaceId);
  if (!row)
    throw new JourneyPortfolioError(
      "The original dependency is no longer retained.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  return { dependency: dependencyFromRow(row), replayed: result.replayed };
}

export function deleteJourneyInitiativeDependency(input: {
  spaceId: string;
  actorUserId: string;
  dependencyId: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const id = token(input.dependencyId, "dependencyId");
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = { dependencyId: id };
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "dependency.delete",
      intent,
    );
    if (replay) return { deleted: true, replayed: true };
    const row = db
      .prepare(
        "SELECT * FROM journey_initiative_dependencies WHERE id=? AND space_id=?",
      )
      .get(id, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Initiative dependency not found.",
        404,
        "JOURNEY_PORTFOLIO_DEPENDENCY_NOT_FOUND",
      );
    db.prepare(
      "DELETE FROM journey_initiative_dependencies WHERE id=? AND space_id=?",
    ).run(id, input.spaceId);
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "dependency.delete",
      intent,
      { dependencyId: id },
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "dependency.deleted",
      targetKind: "initiative",
      targetId: row.initiative_id,
      detail: {
        dependencyId: id,
        dependsOnInitiativeId: row.depends_on_initiative_id,
      },
      at,
    });
    return { deleted: true, replayed: false };
  })();
}

export function listJourneyInitiativeDependencies(input: {
  spaceId: string;
  actorUserId: string;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const dependencies = (
    db
      .prepare(
        "SELECT * FROM journey_initiative_dependencies WHERE space_id=? ORDER BY created_at,id",
      )
      .all(input.spaceId) as any[]
  ).map(dependencyFromRow);
  const initiatives = (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_items WHERE space_id=? AND kind='initiative' AND state='active'`,
      )
      .all(input.spaceId) as any[]
  )
    .map(itemFromRow)
    .map((item) => domainItem(item, input.spaceId)) as JourneyInitiative[];
  return {
    dependencies,
    analysis: analyseJourneyInitiativeDependencies(
      initiatives,
      dependencies.map((entry) => ({
        ...entry,
        spaceId: input.spaceId,
        createdAt: entry.createdAt,
      })),
    ),
  };
}

function policyVersionFromRow(row: any): PortfolioPolicyVersion {
  return {
    id: row.id,
    policyId: row.policy_id,
    versionNumber: Number(row.version_number),
    method: row.method,
    formulaVersion: row.formula_version,
    configuration: parseJson(row.configuration_json, {}),
    configurationSha256: row.configuration_sha256,
    actorUserId: row.actor_user_id || null,
    createdAt: row.created_at,
  };
}
function policyFromRow(row: any, versionRow?: any): PortfolioPolicy {
  const version =
    versionRow ||
    db
      .prepare(
        `SELECT * FROM journey_portfolio_scoring_policy_versions
    WHERE id=? AND policy_id=? AND space_id=?`,
      )
      .get(row.current_version_id, row.id, row.space_id);
  if (!version)
    throw new JourneyPortfolioError(
      "Scoring policy current version is unavailable.",
      409,
      "JOURNEY_PORTFOLIO_POLICY_INTEGRITY_FAILED",
    );
  const currentVersion = policyVersionFromRow(version);
  if (currentVersion.method !== row.method)
    throw new JourneyPortfolioError(
      "Scoring policy method does not match its current version.",
      409,
      "JOURNEY_PORTFOLIO_POLICY_INTEGRITY_FAILED",
    );
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    state: row.state,
    revision: Number(row.revision),
    currentVersionId: row.current_version_id,
    currentVersion,
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalisePolicyConfiguration(
  method: JourneyScoreMethod,
  value: Record<string, unknown>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new JourneyPortfolioError(
      "Scoring policy configuration must be an object.",
      400,
      "JOURNEY_PORTFOLIO_POLICY_INVALID",
    );
  const allowed = new Set(
    method === "weighted" ? ["dimensions", "bands"] : ["bands"],
  );
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length)
    throw new JourneyPortfolioError(
      "Scoring policy contains an unsupported configuration field.",
      400,
      "JOURNEY_PORTFOLIO_POLICY_INVALID",
      { field: extra[0] },
    );
  let dimensions: JourneyWeightedScoreDimension[] = [];
  if (method === "weighted") {
    if (
      !Array.isArray(value.dimensions) ||
      value.dimensions.length < 1 ||
      value.dimensions.length > 20
    ) {
      throw new JourneyPortfolioError(
        "A weighted policy requires between 1 and 20 dimensions.",
        400,
        "JOURNEY_PORTFOLIO_POLICY_DIMENSIONS_INVALID",
      );
    }
    dimensions = value.dimensions.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new JourneyPortfolioError(
          "Weighted policy dimension is invalid.",
          400,
          "JOURNEY_PORTFOLIO_POLICY_DIMENSIONS_INVALID",
          { index },
        );
      const dimension = raw as Record<string, unknown>;
      const keys = Object.keys(dimension);
      if (
        keys.some(
          (key) =>
            ![
              "key",
              "label",
              "weight",
              "minimum",
              "maximum",
              "direction",
            ].includes(key),
        )
      ) {
        throw new JourneyPortfolioError(
          "Weighted policy dimension contains an unsupported field.",
          400,
          "JOURNEY_PORTFOLIO_POLICY_DIMENSIONS_INVALID",
          { index },
        );
      }
      // The calculator treats any value other than `higher_is_better` as
      // `lower_is_better`, so an unrecognised direction would be frozen into an
      // immutable, checksummed policy version and silently invert every score.
      if (
        dimension.direction !== "higher_is_better" &&
        dimension.direction !== "lower_is_better"
      ) {
        throw new JourneyPortfolioError(
          "Weighted policy dimension direction is invalid.",
          400,
          "JOURNEY_PORTFOLIO_POLICY_DIMENSIONS_INVALID",
          { index, field: `dimensions[${index}].direction` },
        );
      }
      return {
        key: token(dimension.key, `dimensions[${index}].key`, 64),
        label: token(dimension.label, `dimensions[${index}].label`, 120),
        weight: Number(dimension.weight),
        minimum: Number(dimension.minimum),
        maximum: Number(dimension.maximum),
        direction: dimension.direction,
      };
    });
    // The calculator performs the authoritative uniqueness/range validation.
    withScoreErrors(() =>
      calculateJourneyPortfolioScore(
        "weighted",
        {
          dimensions: Object.fromEntries(
            dimensions.map((entry) => [entry.key, entry.minimum]),
          ),
        },
        dimensions,
      ),
    );
  }
  let bands: Array<{
    key: string;
    label: string;
    minimum: number;
    maximum: number | null;
  }> = [];
  if (value.bands !== undefined) {
    if (!Array.isArray(value.bands) || value.bands.length > 20)
      throw new JourneyPortfolioError(
        "Scoring bands must be an array with at most 20 entries.",
        400,
        "JOURNEY_PORTFOLIO_POLICY_BANDS_INVALID",
      );
    bands = value.bands
      .map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new JourneyPortfolioError(
            "Scoring band is invalid.",
            400,
            "JOURNEY_PORTFOLIO_POLICY_BANDS_INVALID",
            { index },
          );
        const band = raw as Record<string, unknown>;
        const minimum = Number(band.minimum);
        const maximum =
          band.maximum === null || band.maximum === undefined
            ? null
            : Number(band.maximum);
        if (
          !Number.isFinite(minimum) ||
          (maximum !== null &&
            (!Number.isFinite(maximum) || maximum <= minimum))
        ) {
          throw new JourneyPortfolioError(
            "Scoring band bounds are invalid.",
            400,
            "JOURNEY_PORTFOLIO_POLICY_BANDS_INVALID",
            { index },
          );
        }
        return {
          key: token(band.key, `bands[${index}].key`, 64),
          label: token(band.label, `bands[${index}].label`, 120),
          minimum,
          maximum,
        };
      })
      .sort(
        (left, right) =>
          left.minimum - right.minimum || compareKey(left.key, right.key),
      );
    if (new Set(bands.map((entry) => entry.key)).size !== bands.length)
      throw new JourneyPortfolioError(
        "Scoring band keys must be unique.",
        400,
        "JOURNEY_PORTFOLIO_POLICY_BANDS_INVALID",
      );
    for (let index = 1; index < bands.length; index += 1) {
      if (
        bands[index - 1].maximum === null ||
        bands[index - 1].maximum! > bands[index].minimum
      )
        throw new JourneyPortfolioError(
          "Scoring bands must not overlap and only the final band may be open-ended.",
          400,
          "JOURNEY_PORTFOLIO_POLICY_BANDS_INVALID",
        );
    }
  }
  const configuration =
    method === "weighted" ? { dimensions, bands } : { bands };
  const serialized = stableJson(configuration);
  if (
    Buffer.byteLength(serialized, "utf8") >
    journeyPortfolioLimits.policyConfigurationBytes
  )
    throw new JourneyPortfolioError(
      "Scoring policy configuration is too large.",
      413,
      "JOURNEY_PORTFOLIO_POLICY_TOO_LARGE",
    );
  return {
    configuration,
    serialized,
    checksum: sha256(serialized),
    formulaVersion:
      method === "rice"
        ? ("rice.v1" as const)
        : method === "ice"
          ? ("ice.v1" as const)
          : ("weighted.v1" as const),
  };
}

export function createJourneyPortfolioScoringPolicy(input: {
  spaceId: string;
  actorUserId: string;
  name: string;
  method: JourneyScoreMethod;
  configuration: Record<string, unknown>;
  state?: "draft" | "active";
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  if (!["rice", "ice", "weighted"].includes(input.method))
    throw new JourneyPortfolioError(
      "Unknown scoring method.",
      400,
      "JOURNEY_PORTFOLIO_POLICY_METHOD_INVALID",
    );
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const name = token(input.name, "name", 160);
  const config = normalisePolicyConfiguration(
    input.method,
    input.configuration,
  );
  const state = input.state || "draft";
  const intent = {
    name,
    method: input.method,
    configuration: config.configuration,
    state,
  };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "policy.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    assertPortfolioQuota(
      input.spaceId,
      "journeyPortfolioScoringPolicies",
      countRetainedPolicies(input.spaceId),
      1,
    );
    const id = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO journey_portfolio_scoring_policies
      (id,space_id,name,method,state,revision,current_version_id,created_by_user_id,updated_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?,?,?,?)`,
    ).run(
      id,
      input.spaceId,
      name,
      input.method,
      state,
      versionId,
      input.actorUserId,
      input.actorUserId,
      at,
      at,
    );
    db.prepare(
      `INSERT INTO journey_portfolio_scoring_policy_versions
      (id,policy_id,space_id,version_number,method,formula_version,configuration_json,configuration_sha256,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      versionId,
      id,
      input.spaceId,
      1,
      input.method,
      config.formulaVersion,
      config.serialized,
      config.checksum,
      input.actorUserId,
      at,
    );
    const marker = { policyId: id, versionId, revision: 1 };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "policy.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "policy.created",
      targetKind: "portfolio_policy",
      targetId: id,
      targetRevision: 1,
      detail: { method: input.method, state, versionId },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_scoring_policies WHERE id=? AND space_id=?",
    )
    .get(String(result.marker.policyId), input.spaceId) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "The original scoring policy is no longer retained.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  return { policy: policyFromRow(row), replayed: result.replayed };
}

export function createJourneyPortfolioScoringPolicyVersion(input: {
  spaceId: string;
  actorUserId: string;
  policyId: string;
  expectedRevision: number;
  configuration: Record<string, unknown>;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const policyId = token(input.policyId, "policyId");
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const intent = {
    policyId,
    expectedRevision: input.expectedRevision,
    configuration: input.configuration,
  };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "policy.version",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_scoring_policies WHERE id=? AND space_id=?",
      )
      .get(policyId, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Scoring policy not found.",
        404,
        "JOURNEY_PORTFOLIO_POLICY_NOT_FOUND",
      );
    if (row.state === "retired")
      throw new JourneyPortfolioError(
        "Retired scoring policies cannot be changed.",
        409,
        "JOURNEY_PORTFOLIO_POLICY_RETIRED",
      );
    if (Number(row.revision) !== input.expectedRevision)
      throw new JourneyPortfolioError(
        "Scoring policy revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      );
    const config = normalisePolicyConfiguration(
      row.method,
      input.configuration,
    );
    const number = Number(
      (
        db
          .prepare(
            `SELECT COALESCE(MAX(version_number),0)+1 number
      FROM journey_portfolio_scoring_policy_versions WHERE policy_id=? AND space_id=?`,
          )
          .get(policyId, input.spaceId) as any
      ).number,
    );
    const versionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO journey_portfolio_scoring_policy_versions
      (id,policy_id,space_id,version_number,method,formula_version,configuration_json,configuration_sha256,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      versionId,
      policyId,
      input.spaceId,
      number,
      row.method,
      config.formulaVersion,
      config.serialized,
      config.checksum,
      input.actorUserId,
      at,
    );
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_scoring_policies SET current_version_id=?,revision=revision+1,
      updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`,
      )
      .run(
        versionId,
        input.actorUserId,
        at,
        policyId,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Scoring policy revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      );
    const marker = {
      policyId,
      versionId,
      revision: input.expectedRevision + 1,
    };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "policy.version",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "policy.version_created",
      targetKind: "portfolio_policy",
      targetId: policyId,
      targetRevision: input.expectedRevision + 1,
      detail: { versionId, versionNumber: number },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_scoring_policies WHERE id=? AND space_id=?",
    )
    .get(policyId, input.spaceId) as any;
  return { policy: policyFromRow(row), replayed: result.replayed };
}

export function updateJourneyPortfolioScoringPolicyState(input: {
  spaceId: string;
  actorUserId: string;
  policyId: string;
  expectedRevision: number;
  name?: string;
  state?: "draft" | "active" | "retired";
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const policyId = token(input.policyId, "policyId");
  const at = nowIso(input.now);
  // The default-policy check and the allowance check both read state that this
  // statement then changes, so they run under the same space lock and
  // transaction as the write, exactly like every other mutation in this module.
  const updated = db.transaction(() => {
    lockSpace(input.spaceId);
    const row = db
      .prepare(
        "SELECT * FROM journey_portfolio_scoring_policies WHERE id=? AND space_id=?",
      )
      .get(policyId, input.spaceId) as any;
    if (!row)
      throw new JourneyPortfolioError(
        "Scoring policy not found.",
        404,
        "JOURNEY_PORTFOLIO_POLICY_NOT_FOUND",
      );
    if (Number(row.revision) !== input.expectedRevision)
      throw new JourneyPortfolioError(
        "Scoring policy revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      );
    const state = input.state || row.state;
    const name =
      input.name === undefined ? row.name : token(input.name, "name", 160);
    if (
      state === "retired" &&
      settings(input.spaceId).defaultScoringPolicyId === row.id
    )
      throw new JourneyPortfolioError(
        "Choose or clear the default scoring policy before retiring it.",
        409,
        "JOURNEY_PORTFOLIO_DEFAULT_POLICY_IN_USE",
      );
    // Retired policies are outside the allowance, so restoring one re-admits it.
    if (row.state === "retired" && state !== "retired") {
      assertPortfolioQuota(
        input.spaceId,
        "journeyPortfolioScoringPolicies",
        countRetainedPolicies(input.spaceId),
        1,
      );
    }
    const changed = db
      .prepare(
        `UPDATE journey_portfolio_scoring_policies SET name=?,state=?,
      revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`,
      )
      .run(
        name,
        state,
        input.actorUserId,
        at,
        row.id,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyPortfolioError(
        "Scoring policy revision conflict.",
        409,
        "JOURNEY_PORTFOLIO_REVISION_CONFLICT",
      );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "policy.updated",
      targetKind: "portfolio_policy",
      targetId: row.id,
      targetRevision: input.expectedRevision + 1,
      detail: { previousState: row.state, state },
      at,
    });
    return row.id as string;
  })();
  return policyFromRow(
    db
      .prepare(
        "SELECT * FROM journey_portfolio_scoring_policies WHERE id=? AND space_id=?",
      )
      .get(updated, input.spaceId),
  );
}

export function listJourneyPortfolioScoringPolicies(input: {
  spaceId: string;
  actorUserId: string;
  includeRetired?: boolean;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  return (
    db
      .prepare(
        `SELECT * FROM journey_portfolio_scoring_policies WHERE space_id=?${input.includeRetired ? "" : " AND state<>'retired'"}
    ORDER BY state,name,id`,
      )
      .all(input.spaceId) as any[]
  ).map((row) => policyFromRow(row));
}

function scoreBand(
  configuration: Record<string, unknown>,
  score: number | null,
) {
  if (score === null || !Array.isArray(configuration.bands)) return null;
  return (
    (
      configuration.bands as Array<{
        key: string;
        label: string;
        minimum: number;
        maximum: number | null;
      }>
    ).find(
      (band) =>
        score >= band.minimum &&
        (band.maximum === null || score < band.maximum),
    ) || null
  );
}

const scoreInputFields = new Set([
  "reach",
  "impact",
  "confidence",
  "effort",
  "ease",
  "dimensions",
]);
const scoreDimensionKey = /^[a-z][a-z0-9_]{0,63}$/u;
/** The assessment input is persisted verbatim into an append-only history row, so
 * it is bounded and key-checked before it is written rather than after. */
function normaliseScoreInput(value: JourneyScoreInput): JourneyScoreInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new JourneyPortfolioError(
      "Score input must be an object.",
      400,
      "JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID",
    );
  const raw = value as Record<string, unknown>;
  const extra = Object.keys(raw).filter(
    (field) => !scoreInputFields.has(field),
  );
  if (extra.length)
    throw new JourneyPortfolioError(
      "Score input contains an unsupported field.",
      400,
      "JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID",
      { field: extra[0] },
    );
  const result: JourneyScoreInput = {};
  for (const field of [
    "reach",
    "impact",
    "confidence",
    "effort",
    "ease",
  ] as const) {
    if (raw[field] !== undefined)
      result[field] = raw[field] === null ? null : Number(raw[field]);
  }
  if (raw.dimensions !== undefined) {
    if (
      !raw.dimensions ||
      typeof raw.dimensions !== "object" ||
      Array.isArray(raw.dimensions)
    ) {
      throw new JourneyPortfolioError(
        "Score input dimensions must be an object.",
        400,
        "JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID",
        { field: "dimensions" },
      );
    }
    const supplied = raw.dimensions as Record<string, unknown>;
    const keys = Object.keys(supplied);
    if (keys.length > 20)
      throw new JourneyPortfolioError(
        "Score input declares too many dimensions.",
        400,
        "JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID",
        { field: "dimensions" },
      );
    const dimensions: Record<string, number | null> = {};
    for (const dimensionKey of keys) {
      if (!scoreDimensionKey.test(dimensionKey))
        throw new JourneyPortfolioError(
          "Score input dimension keys must be stable identifiers.",
          400,
          "JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID",
          { field: `dimensions.${dimensionKey}` },
        );
      const entry = supplied[dimensionKey];
      dimensions[dimensionKey] =
        entry === null || entry === undefined ? null : Number(entry);
    }
    result.dimensions = dimensions;
  }
  if (
    Buffer.byteLength(stableJson(result), "utf8") >
    journeyPortfolioLimits.scoreInputBytes
  ) {
    throw new JourneyPortfolioError(
      "Score input is too large.",
      413,
      "JOURNEY_PORTFOLIO_SCORE_INPUT_TOO_LARGE",
    );
  }
  return result;
}

export function assessJourneyPortfolioItem(input: {
  spaceId: string;
  actorUserId: string;
  itemId: string;
  policyId?: string | null;
  scoreInput: JourneyScoreInput;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertEnabled(input.spaceId);
  assertManager(input.spaceId, input.actorUserId);
  const itemId = token(input.itemId, "itemId");
  const policyId =
    optionalToken(input.policyId, "policyId") ||
    settings(input.spaceId).defaultScoringPolicyId;
  if (!policyId)
    throw new JourneyPortfolioError(
      "Choose a scoring policy before assessing priority.",
      422,
      "JOURNEY_PORTFOLIO_POLICY_REQUIRED",
    );
  const key = token(input.idempotencyKey, "idempotency key", 200);
  const scoreInput = normaliseScoreInput(input.scoreInput);
  const intent = { itemId, policyId, scoreInput };
  const at = nowIso(input.now);
  const result = db.transaction(() => {
    lockSpace(input.spaceId);
    const replay = operationReplay(
      input.spaceId,
      input.actorUserId,
      key,
      "assessment.create",
      intent,
    );
    if (replay) return { marker: replay, replayed: true };
    const item = exactItem(input.spaceId, itemId);
    if (!["opportunity", "initiative"].includes(item.kind))
      throw new JourneyPortfolioError(
        "Only opportunities and initiatives can be prioritised.",
        422,
        "JOURNEY_PORTFOLIO_ASSESSMENT_KIND_INVALID",
      );
    const policyRow = db
      .prepare(
        `SELECT * FROM journey_portfolio_scoring_policies
      WHERE id=? AND space_id=? AND state='active'`,
      )
      .get(policyId, input.spaceId) as any;
    if (!policyRow)
      throw new JourneyPortfolioError(
        "Active scoring policy not found.",
        404,
        "JOURNEY_PORTFOLIO_POLICY_NOT_FOUND",
      );
    const policy = policyFromRow(policyRow);
    const dimensions =
      policy.method === "weighted"
        ? (policy.currentVersion.configuration
            .dimensions as JourneyWeightedScoreDimension[])
        : [];
    const score = withScoreErrors(() =>
      calculateJourneyPortfolioScore(policy.method, scoreInput, dimensions),
    );
    const band = scoreBand(policy.currentVersion.configuration, score.value);
    const resultJson = { ...score, band };
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO journey_portfolio_priority_assessments
      (id,space_id,item_id,item_revision,policy_version_id,method,input_json,result_json,score,actor_user_id,assessed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.spaceId,
      item.id,
      item.revision,
      policy.currentVersion.id,
      policy.method,
      stableJson(scoreInput),
      stableJson(resultJson),
      score.value,
      input.actorUserId,
      at,
    );
    const marker = {
      assessmentId: id,
      itemId: item.id,
      itemRevision: item.revision,
    };
    recordOperation(
      input.spaceId,
      input.actorUserId,
      key,
      "assessment.create",
      intent,
      marker,
      at,
    );
    activity({
      spaceId: input.spaceId,
      actorUserId: input.actorUserId,
      action: "assessment.created",
      targetKind: item.kind,
      targetId: item.id,
      targetRevision: item.revision,
      detail: {
        assessmentId: id,
        policyVersionId: policy.currentVersion.id,
        method: policy.method,
        scoreStatus: score.status,
        score: score.value,
        band: band?.key || null,
      },
      at,
    });
    return { marker, replayed: false };
  })();
  const row = db
    .prepare(
      "SELECT * FROM journey_portfolio_priority_assessments WHERE id=? AND space_id=?",
    )
    .get(String(result.marker.assessmentId), input.spaceId) as any;
  if (!row)
    throw new JourneyPortfolioError(
      "The original assessment is no longer retained.",
      410,
      "JOURNEY_PORTFOLIO_IDEMPOTENCY_RESULT_RETIRED",
    );
  return {
    assessment: {
      id: row.id,
      itemId: row.item_id,
      itemRevision: Number(row.item_revision),
      policyVersionId: row.policy_version_id,
      method: row.method,
      input: parseJson(row.input_json, {}),
      result: parseJson(row.result_json, {}),
      score: row.score === null ? null : Number(row.score),
      actorUserId: row.actor_user_id || null,
      assessedAt: row.assessed_at,
    },
    replayed: result.replayed,
  };
}
