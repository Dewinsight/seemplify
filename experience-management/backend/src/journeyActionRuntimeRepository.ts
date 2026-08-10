import crypto from "node:crypto";
import { db } from "./database.js";
import { effectiveJourneyRole } from "./journeyCollaboration.js";
import { assertSubscriptionFeature } from "./subscriptionEntitlements.js";
import { workflowActionSchema } from "./journeyAdapterContracts.js";

export class JourneyActionRuntimeError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "JOURNEY_ACTION_RUNTIME_INVALID",
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "JourneyActionRuntimeError";
  }
}

const gateKeys = [
  "consent",
  "suppression",
  "entitlement",
  "quota",
  "quiet_hours",
  "frequency_cap",
  "source_state",
  "platform_kill_switch",
  "space_kill_switch",
  "workflow_kill_switch",
  "adapter_kill_switch",
  "profile_kill_switch",
] as const;
const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const serialize = (value: unknown) => JSON.stringify(value);
const timestamp = (value?: string) => value || new Date().toISOString();

function ensureSqliteSchema() {
  if (db.provider !== "sqlite") return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_action_queue (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, workflow_id TEXT NOT NULL, space_id TEXT NOT NULL,
      adapter TEXT NOT NULL, idempotency_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN
        ('held','ready','leased','retry_scheduled','succeeded','dead_letter','cancelled')),
      hold_reason_code TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_sha256 TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, available_at TEXT NOT NULL,
      lease_owner_sha256 TEXT, lease_token TEXT, fencing_token INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT,
      terminal_at TEXT, last_error_code TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(action_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(action_id,space_id) REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION,
      FOREIGN KEY(workflow_id,space_id) REFERENCES journey_workflow_definitions(id,space_id) ON DELETE NO ACTION);
    CREATE INDEX IF NOT EXISTS journey_action_queue_claim ON journey_action_queue(space_id,state,available_at,created_at,id);
    CREATE TABLE IF NOT EXISTS journey_action_gate_resolutions (
      id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, space_id TEXT NOT NULL, gate_key TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allow','deny','unknown')), reason_code TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL, resolved_at TEXT NOT NULL, UNIQUE(queue_id,gate_key),
      FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_action_attempts (
      id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, space_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
      fencing_token INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN
        ('leased','no_effect_succeeded','retry_scheduled','dead_letter')), error_code TEXT, detail_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(queue_id,attempt_number,outcome),
      FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
    CREATE INDEX IF NOT EXISTS journey_action_attempts_history ON journey_action_attempts(space_id,queue_id,attempt_number,id);
    CREATE TABLE IF NOT EXISTS journey_action_effect_receipts (
      id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, action_id TEXT NOT NULL, space_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, adapter TEXT NOT NULL CHECK(adapter='deterministic_no_effect'),
      effect_sha256 TEXT NOT NULL, fencing_token INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(queue_id), UNIQUE(action_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION);
    CREATE TRIGGER IF NOT EXISTS journey_action_gate_resolutions_update_guard BEFORE UPDATE ON journey_action_gate_resolutions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_action_gate_resolutions_delete_guard BEFORE DELETE ON journey_action_gate_resolutions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_action_attempts_update_guard BEFORE UPDATE ON journey_action_attempts BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_action_attempts_delete_guard BEFORE DELETE ON journey_action_attempts BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_action_effect_receipts_update_guard BEFORE UPDATE ON journey_action_effect_receipts BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_action_effect_receipts_delete_guard BEFORE DELETE ON journey_action_effect_receipts BEGIN SELECT RAISE(ABORT,'append-only'); END;
  `);
}
ensureSqliteSchema();

function access(spaceId: string, userId: string, write = false) {
  assertSubscriptionFeature(spaceId, "journeyOrchestration");
  const membership = db
    .prepare(
      "SELECT role FROM space_memberships WHERE space_id=? AND user_id=?",
    )
    .get(spaceId, userId) as { role?: string } | undefined;
  if (!membership)
    throw new JourneyActionRuntimeError(
      "Space membership is required.",
      403,
      "JOURNEY_ACTION_FORBIDDEN",
    );
  if (write && String(membership.role) === "member")
    throw new JourneyActionRuntimeError(
      "Manager access is required.",
      403,
      "JOURNEY_ACTION_MANAGER_REQUIRED",
    );
  if (
    write &&
    !effectiveJourneyRole(spaceId, userId).capabilities.has("journeys.review")
  )
    throw new JourneyActionRuntimeError(
      "Journey review capability is required.",
      403,
      "JOURNEY_ACTION_REVIEW_REQUIRED",
    );
}

function safeAudit(
  spaceId: string,
  actorUserId: string,
  action: string,
  targetId: string,
  detail: Record<string, unknown>,
  at: string,
) {
  const body = serialize(detail);
  db.prepare(
    `INSERT INTO journey_workflow_audit
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    crypto.randomUUID(),
    spaceId,
    actorUserId,
    action,
    "journey_action_queue",
    targetId,
    body,
    hash(body),
    at,
  );
}

/** Must be called inside the approval transaction. It records no recipient or payload content. */
export function enqueueApprovedActionInTransaction(input: {
  spaceId: string;
  actorUserId: string;
  actionId: string;
  at: string;
}) {
  const action = db
    .prepare(
      `SELECT a.*,r.workflow_id,v.content_json workflow_content_json,w.state workflow_state,w.paused workflow_paused,
      s.paused space_paused FROM journey_workflow_actions a
    JOIN journey_workflow_runs r ON r.id=a.run_id AND r.space_id=a.space_id
    JOIN journey_workflow_versions v ON v.id=r.workflow_version_id AND v.workflow_id=r.workflow_id AND v.space_id=r.space_id
    JOIN journey_workflow_definitions w ON w.id=r.workflow_id AND w.space_id=r.space_id
    LEFT JOIN journey_orchestration_settings s ON s.space_id=a.space_id
    WHERE a.id=? AND a.space_id=?`,
    )
    .get(input.actionId, input.spaceId) as any;
  if (!action)
    throw new JourneyActionRuntimeError(
      "Workflow action not found.",
      404,
      "WORKFLOW_ACTION_NOT_FOUND",
    );
  const trace = JSON.parse(String(action.trace_json)) as Array<{
    kind?: string;
    key?: string;
    decision?: string;
    reason?: string;
  }>;
  const gates = new Map(
    trace
      .filter((step) => step.kind === "gate")
      .map((step) => [String(step.key), step]),
  );
  const missing = gateKeys.filter((key) => !gates.has(key));
  if (missing.length)
    throw new JourneyActionRuntimeError(
      "The action has incomplete safety evidence.",
      409,
      "JOURNEY_ACTION_GATE_EVIDENCE_INCOMPLETE",
      { missing },
    );
  const denied = gateKeys.filter((key) => gates.get(key)?.decision !== "allow");
  const paused =
    Boolean(action.space_paused) ||
    Boolean(action.workflow_paused) ||
    action.workflow_state !== "published";
  const state = paused || denied.length ? "held" : "ready";
  const holdReason = paused
    ? "ORCHESTRATION_PAUSED"
    : denied.length
      ? "SAFETY_GATE_NOT_ALLOWED"
      : null;
  const queueId = crypto.randomUUID();
  const workflowContent = JSON.parse(String(action.workflow_content_json)) as {
    actions?: unknown[];
  };
  const parsedAction = workflowActionSchema.safeParse(
    (workflowContent.actions || []).find(
      (item: any) => item?.key === action.action_key,
    ),
  );
  if (!parsedAction.success)
    throw new JourneyActionRuntimeError(
      "The approved action has no executable reviewed payload.",
      409,
      "JOURNEY_ACTION_REVIEWED_PAYLOAD_UNAVAILABLE",
    );
  const reviewedAction = parsedAction.data;
  const payload = {
    actionId: action.id,
    workflowId: action.workflow_id,
    reviewedAction,
    orchestrationRuntime: "reviewed-adapters/v1",
  };
  const payloadJson = serialize(payload);
  db.prepare(
    `INSERT INTO journey_action_queue
    (id,action_id,workflow_id,space_id,adapter,idempotency_key,state,hold_reason_code,payload_json,payload_sha256,
      attempt_count,max_attempts,available_at,fencing_token,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,5,?,0,1,?,?)`,
  ).run(
    queueId,
    action.id,
    action.workflow_id,
    input.spaceId,
    action.adapter,
    action.idempotency_key,
    state,
    holdReason,
    payloadJson,
    hash(payloadJson),
    input.at,
    input.at,
    input.at,
  );
  for (const key of gateKeys) {
    const gate = gates.get(key)!;
    const evidence = serialize({
      key,
      decision: gate.decision,
      reasonCode: gate.reason,
      traceSha256: action.trace_sha256,
    });
    db.prepare(
      `INSERT INTO journey_action_gate_resolutions
      (id,queue_id,space_id,gate_key,decision,reason_code,evidence_sha256,resolved_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      queueId,
      input.spaceId,
      key,
      gate.decision,
      String(gate.reason),
      hash(evidence),
      input.at,
    );
  }
  safeAudit(
    input.spaceId,
    input.actorUserId,
    "workflow.action.enqueued_nonexternal",
    queueId,
    {
      actionId: action.id,
      state,
      holdReasonCode: holdReason,
      gateCount: gateKeys.length,
      payloadSha256: hash(payloadJson),
    },
    input.at,
  );
  return queueId;
}

function view(row: any) {
  return {
    id: row.id,
    actionId: row.action_id,
    workflowId: row.workflow_id,
    adapter: row.adapter,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    holdReasonCode: row.hold_reason_code || null,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    availableAt: row.available_at,
    fencingToken: Number(row.fencing_token),
    leaseExpiresAt: row.lease_expires_at || null,
    terminalAt: row.terminal_at || null,
    lastErrorCode: row.last_error_code || null,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listJourneyActionQueue(input: {
  spaceId: string;
  actorUserId: string;
  state?: string;
}) {
  access(input.spaceId, input.actorUserId);
  const where = input.state ? "q.space_id=? AND q.state=?" : "q.space_id=?";
  const values = input.state ? [input.spaceId, input.state] : [input.spaceId];
  const rows = db
    .prepare(
      `SELECT q.*,adapter_receipt.id adapter_receipt_id,adapter_receipt.provider_reference_sha256,
      adapter_receipt.response_sha256,adapter_receipt.fencing_token receipt_fencing_token,
      no_effect.id no_effect_receipt_id,dispatch.state provider_state,dispatch.response_status provider_status,
      dispatch.attempt_count provider_attempt_count,attempt.outcome last_attempt_outcome,attempt.error_code last_attempt_error_code
    FROM journey_action_queue q
    LEFT JOIN journey_adapter_effect_receipts adapter_receipt ON adapter_receipt.queue_id=q.id AND adapter_receipt.space_id=q.space_id
    LEFT JOIN journey_action_effect_receipts no_effect ON no_effect.queue_id=q.id AND no_effect.space_id=q.space_id
    LEFT JOIN journey_webhook_dispatches dispatch ON dispatch.queue_id=q.id AND dispatch.space_id=q.space_id
    LEFT JOIN journey_adapter_execution_attempts attempt ON attempt.id=(SELECT candidate.id FROM journey_adapter_execution_attempts candidate
      WHERE candidate.queue_id=q.id AND candidate.space_id=q.space_id ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1)
    WHERE ${where} ORDER BY q.created_at,q.id`,
    )
    .all(...values) as any[];
  return rows.map((row) => ({
    ...view(row),
    outcome: {
      kind: row.adapter_receipt_id
        ? "reviewed_effect"
        : row.no_effect_receipt_id
          ? "no_effect"
          : null,
      providerReferenceSha256: row.provider_reference_sha256 || null,
      responseSha256: row.response_sha256 || null,
      receiptFencingToken:
        row.receipt_fencing_token === null ||
        row.receipt_fencing_token === undefined
          ? null
          : Number(row.receipt_fencing_token),
    },
    provider: {
      state: row.provider_state || null,
      status:
        row.provider_status === null || row.provider_status === undefined
          ? null
          : Number(row.provider_status),
      attemptCount:
        row.provider_attempt_count === null ||
        row.provider_attempt_count === undefined
          ? null
          : Number(row.provider_attempt_count),
    },
    lastAttempt: {
      outcome: row.last_attempt_outcome || null,
      errorCode: row.last_attempt_error_code || null,
    },
  }));
}

export function readJourneyActionOperatorStatus(input: {
  spaceId: string;
  actorUserId: string;
  workerEnabled: boolean;
  configuredSpaceIds: readonly string[];
  configuredAdapters: readonly string[];
  supportedAdapters: readonly string[];
}) {
  access(input.spaceId, input.actorUserId);
  const configured = new Set(input.configuredAdapters),
    supported = new Set(input.supportedAdapters);
  const spaceEnabled =
    input.workerEnabled && input.configuredSpaceIds.includes(input.spaceId);
  const adapters = [
    "service_recovery_ticket",
    "assistant_action",
    "internal_notification",
    "signed_webhook",
    "survey_invitation",
  ] as const;
  return {
    worker: {
      enabled: spaceEnabled,
      mode: spaceEnabled ? "durable_reviewed_effects" : "disabled",
    },
    adapters: adapters.map((adapter) => {
      if (adapter === "survey_invitation")
        return {
          adapter,
          enabled: false,
          reasonCode: "PROVIDER_DURABLE_IDEMPOTENCY_REQUIRED",
        };
      if (!supported.has(adapter))
        return { adapter, enabled: false, reasonCode: "ADAPTER_NOT_REVIEWED" };
      if (!input.workerEnabled)
        return { adapter, enabled: false, reasonCode: "WORKER_DISABLED" };
      if (!spaceEnabled)
        return { adapter, enabled: false, reasonCode: "SPACE_NOT_CONFIGURED" };
      if (!configured.has(adapter))
        return {
          adapter,
          enabled: false,
          reasonCode: "ADAPTER_NOT_CONFIGURED",
        };
      return { adapter, enabled: true, reasonCode: null };
    }),
  };
}

function hasActiveWorkerReservation(queueId: string, spaceId: string) {
  if (db.provider === "sqlite") {
    const exists = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='journey_action_worker_reservations'",
      )
      .get();
    if (!exists) return false;
  }
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM journey_action_worker_reservations WHERE queue_id=? AND space_id=? AND state='reserved'",
      )
      .get(queueId, spaceId),
  );
}

export function retryJourneyAction(input: {
  spaceId: string;
  actorUserId: string;
  queueId: string;
  expectedRevision: number;
  reasonCode: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, true);
  const at = timestamp(input.at);
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
      .get(input.queueId, input.spaceId) as any;
    if (!row)
      throw new JourneyActionRuntimeError(
        "Queued action not found.",
        404,
        "JOURNEY_ACTION_NOT_FOUND",
      );
    if (!["retry_scheduled", "dead_letter"].includes(row.state))
      throw new JourneyActionRuntimeError(
        "Only retry-scheduled or dead-letter actions can be recovered.",
        409,
        "JOURNEY_ACTION_RETRY_STATE_INVALID",
      );
    if (hasActiveWorkerReservation(row.id, input.spaceId))
      throw new JourneyActionRuntimeError(
        "An active worker reservation prevents recovery.",
        409,
        "JOURNEY_ACTION_ACTIVE_RESERVATION",
      );
    const changed = db
      .prepare(
        `UPDATE journey_action_queue SET state='ready',hold_reason_code=NULL,available_at=?,terminal_at=NULL,
      last_error_code=NULL,fencing_token=fencing_token+1,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?
      AND state IN ('retry_scheduled','dead_letter')`,
      )
      .run(at, at, row.id, input.spaceId, input.expectedRevision).changes;
    if (changed !== 1)
      throw new JourneyActionRuntimeError(
        "The queue item changed before recovery.",
        409,
        "JOURNEY_ACTION_REVISION_CONFLICT",
      );
    safeAudit(
      input.spaceId,
      input.actorUserId,
      "workflow.action.recovered",
      row.id,
      {
        reasonCode: input.reasonCode,
        previousState: row.state,
        previousFencingToken: Number(row.fencing_token),
        nextFencingToken: Number(row.fencing_token) + 1,
      },
      at,
    );
    return view(
      db
        .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
        .get(row.id, input.spaceId),
    );
  })();
}

export function cancelJourneyAction(input: {
  spaceId: string;
  actorUserId: string;
  queueId: string;
  expectedRevision: number;
  reasonCode: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, true);
  const at = timestamp(input.at);
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
      .get(input.queueId, input.spaceId) as any;
    if (!row)
      throw new JourneyActionRuntimeError(
        "Queued action not found.",
        404,
        "JOURNEY_ACTION_NOT_FOUND",
      );
    if (
      !["held", "ready", "retry_scheduled", "dead_letter"].includes(row.state)
    )
      throw new JourneyActionRuntimeError(
        "This queue state cannot be cancelled by an operator.",
        409,
        "JOURNEY_ACTION_CANCEL_STATE_INVALID",
      );
    if (hasActiveWorkerReservation(row.id, input.spaceId))
      throw new JourneyActionRuntimeError(
        "An active worker reservation prevents cancellation.",
        409,
        "JOURNEY_ACTION_ACTIVE_RESERVATION",
      );
    const changed = db
      .prepare(
        `UPDATE journey_action_queue SET state='cancelled',hold_reason_code=NULL,terminal_at=?,last_error_code=?,
      fencing_token=fencing_token+1,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?
      AND state IN ('held','ready','retry_scheduled','dead_letter')`,
      )
      .run(
        at,
        "OPERATOR_CANCELLED",
        at,
        row.id,
        input.spaceId,
        input.expectedRevision,
      ).changes;
    if (changed !== 1)
      throw new JourneyActionRuntimeError(
        "The queue item changed before cancellation.",
        409,
        "JOURNEY_ACTION_REVISION_CONFLICT",
      );
    safeAudit(
      input.spaceId,
      input.actorUserId,
      "workflow.action.cancelled",
      row.id,
      {
        reasonCode: input.reasonCode,
        previousState: row.state,
        previousFencingToken: Number(row.fencing_token),
        nextFencingToken: Number(row.fencing_token) + 1,
      },
      at,
    );
    return view(
      db
        .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
        .get(row.id, input.spaceId),
    );
  })();
}

export function claimJourneyAction(input: {
  spaceId: string;
  actorUserId: string;
  workerIdentity: string;
  leaseSeconds: number;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, true);
  const at = timestamp(input.at);
  const expiresAt = new Date(
    Date.parse(at) + input.leaseSeconds * 1000,
  ).toISOString();
  return db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT q.* FROM journey_action_queue q
      JOIN journey_workflow_definitions w ON w.id=q.workflow_id AND w.space_id=q.space_id
      JOIN journey_orchestration_settings s ON s.space_id=q.space_id
      WHERE q.space_id=? AND w.state='published' AND w.paused=FALSE AND s.paused=FALSE
        AND ((q.state IN ('ready','retry_scheduled') AND q.available_at<=?)
          OR (q.state='leased' AND q.lease_expires_at<=?))
        AND NOT EXISTS (SELECT 1 FROM journey_action_gate_resolutions g
          WHERE g.queue_id=q.id AND g.space_id=q.space_id AND g.decision<>'allow')
        AND (SELECT COUNT(*) FROM journey_action_gate_resolutions g WHERE g.queue_id=q.id)=?
      ORDER BY q.available_at,q.created_at,q.id LIMIT 1`,
      )
      .get(input.spaceId, at, at, gateKeys.length) as any;
    if (!candidate) return null;
    const leaseToken = crypto.randomUUID();
    const fence = Number(candidate.fencing_token) + 1;
    const attempt = Number(candidate.attempt_count) + 1;
    const changed = db
      .prepare(
        `UPDATE journey_action_queue SET state='leased',hold_reason_code=NULL,attempt_count=?,
      lease_owner_sha256=?,lease_token=?,fencing_token=?,lease_expires_at=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=? AND ((state IN ('ready','retry_scheduled') AND available_at<=?)
        OR (state='leased' AND lease_expires_at<=?))`,
      )
      .run(
        attempt,
        hash(input.workerIdentity),
        leaseToken,
        fence,
        expiresAt,
        at,
        candidate.id,
        input.spaceId,
        candidate.revision,
        at,
        at,
      ).changes;
    if (!changed)
      throw new JourneyActionRuntimeError(
        "The queue lease raced another worker.",
        409,
        "JOURNEY_ACTION_LEASE_CONFLICT",
      );
    const detail = serialize({
      queueId: candidate.id,
      attemptNumber: attempt,
      fencingToken: fence,
    });
    db.prepare(
      `INSERT INTO journey_action_attempts
      (id,queue_id,space_id,attempt_number,fencing_token,outcome,error_code,detail_sha256,created_at)
      VALUES (?,?,?,?,?,'leased',NULL,?,?)`,
    ).run(
      crypto.randomUUID(),
      candidate.id,
      input.spaceId,
      attempt,
      fence,
      hash(detail),
      at,
    );
    safeAudit(
      input.spaceId,
      input.actorUserId,
      "workflow.action.leased_nonexternal",
      candidate.id,
      {
        attemptNumber: attempt,
        fencingToken: fence,
        leaseOwnerSha256: hash(input.workerIdentity),
      },
      at,
    );
    const current = db
      .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
      .get(candidate.id, input.spaceId);
    return { ...view(current), leaseToken };
  })();
}

function leased(
  input: {
    spaceId: string;
    queueId: string;
    leaseToken: string;
    fencingToken: number;
  },
  at: string,
) {
  const row = db
    .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
    .get(input.queueId, input.spaceId) as any;
  if (!row)
    throw new JourneyActionRuntimeError(
      "Queued action not found.",
      404,
      "JOURNEY_ACTION_NOT_FOUND",
    );
  if (
    row.state !== "leased" ||
    row.lease_token !== input.leaseToken ||
    Number(row.fencing_token) !== input.fencingToken ||
    Date.parse(row.lease_expires_at) <= Date.parse(at)
  )
    throw new JourneyActionRuntimeError(
      "The action lease is stale or expired.",
      409,
      "JOURNEY_ACTION_STALE_FENCE",
    );
  return row;
}

function assertQueueNotPaused(spaceId: string, workflowId: string) {
  const state = db
    .prepare(
      `SELECT w.state,w.paused workflow_paused,s.paused space_paused
    FROM journey_workflow_definitions w LEFT JOIN journey_orchestration_settings s ON s.space_id=w.space_id
    WHERE w.id=? AND w.space_id=?`,
    )
    .get(workflowId, spaceId) as any;
  if (
    !state ||
    state.state !== "published" ||
    Boolean(state.workflow_paused) ||
    Boolean(state.space_paused)
  ) {
    throw new JourneyActionRuntimeError(
      "Orchestration was paused after the lease was issued.",
      409,
      "JOURNEY_ACTION_COMPLETION_PAUSED",
    );
  }
}

export function completeJourneyActionNoEffect(input: {
  spaceId: string;
  actorUserId: string;
  queueId: string;
  leaseToken: string;
  fencingToken: number;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, true);
  const at = timestamp(input.at);
  return db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT * FROM journey_action_effect_receipts WHERE queue_id=? AND space_id=?",
      )
      .get(input.queueId, input.spaceId) as any;
    if (existing)
      return {
        queue: view(
          db
            .prepare(
              "SELECT * FROM journey_action_queue WHERE id=? AND space_id=?",
            )
            .get(input.queueId, input.spaceId),
        ),
        receipt: { id: existing.id, effectSha256: existing.effect_sha256 },
        replayed: true,
      };
    const row = leased(input, at);
    assertQueueNotPaused(input.spaceId, row.workflow_id);
    const effect = serialize({
      queueId: row.id,
      idempotencyKey: row.idempotency_key,
      adapter: "deterministic_no_effect",
      outcome: "no_effect",
    });
    const receiptId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO journey_action_effect_receipts
      (id,queue_id,action_id,space_id,idempotency_key,adapter,effect_sha256,fencing_token,created_at)
      VALUES (?,?,?,?,?,'deterministic_no_effect',?,?,?)`,
    ).run(
      receiptId,
      row.id,
      row.action_id,
      input.spaceId,
      row.idempotency_key,
      hash(effect),
      input.fencingToken,
      at,
    );
    db.prepare(
      `UPDATE journey_action_queue SET state='succeeded',lease_owner_sha256=NULL,lease_token=NULL,
      lease_expires_at=NULL,terminal_at=?,last_error_code=NULL,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`,
    ).run(at, at, row.id, input.spaceId, input.leaseToken, input.fencingToken);
    db.prepare(
      `INSERT INTO journey_action_attempts
      (id,queue_id,space_id,attempt_number,fencing_token,outcome,error_code,detail_sha256,created_at)
      VALUES (?,?,?,?,?,'no_effect_succeeded',NULL,?,?)`,
    ).run(
      crypto.randomUUID(),
      row.id,
      input.spaceId,
      row.attempt_count,
      input.fencingToken,
      hash(effect),
      at,
    );
    safeAudit(
      input.spaceId,
      input.actorUserId,
      "workflow.action.no_effect_succeeded",
      row.id,
      {
        attemptNumber: Number(row.attempt_count),
        fencingToken: input.fencingToken,
        effectSha256: hash(effect),
      },
      at,
    );
    return {
      queue: view(
        db
          .prepare(
            "SELECT * FROM journey_action_queue WHERE id=? AND space_id=?",
          )
          .get(row.id, input.spaceId),
      ),
      receipt: { id: receiptId, effectSha256: hash(effect) },
      replayed: false,
    };
  })();
}

export function failJourneyAction(input: {
  spaceId: string;
  actorUserId: string;
  queueId: string;
  leaseToken: string;
  fencingToken: number;
  errorCode: string;
  at?: string;
}) {
  access(input.spaceId, input.actorUserId, true);
  const at = timestamp(input.at);
  return db.transaction(() => {
    const row = leased(input, at);
    const exhausted = Number(row.attempt_count) >= Number(row.max_attempts);
    const state = exhausted ? "dead_letter" : "retry_scheduled";
    const delay = Math.min(
      3600,
      30 * 2 ** Math.max(0, Number(row.attempt_count) - 1),
    );
    const availableAt = exhausted
      ? at
      : new Date(Date.parse(at) + delay * 1000).toISOString();
    db.prepare(
      `UPDATE journey_action_queue SET state=?,available_at=?,lease_owner_sha256=NULL,lease_token=NULL,
      lease_expires_at=NULL,terminal_at=?,last_error_code=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND fencing_token=?`,
    ).run(
      state,
      availableAt,
      exhausted ? at : null,
      input.errorCode,
      at,
      row.id,
      input.spaceId,
      input.leaseToken,
      input.fencingToken,
    );
    const detail = serialize({
      queueId: row.id,
      attemptNumber: Number(row.attempt_count),
      fencingToken: input.fencingToken,
      outcome: state,
      errorCode: input.errorCode,
      nextAvailableAt: availableAt,
    });
    db.prepare(
      `INSERT INTO journey_action_attempts
      (id,queue_id,space_id,attempt_number,fencing_token,outcome,error_code,detail_sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      row.id,
      input.spaceId,
      row.attempt_count,
      input.fencingToken,
      exhausted ? "dead_letter" : "retry_scheduled",
      input.errorCode,
      hash(detail),
      at,
    );
    safeAudit(
      input.spaceId,
      input.actorUserId,
      `workflow.action.${state}`,
      row.id,
      {
        attemptNumber: Number(row.attempt_count),
        fencingToken: input.fencingToken,
        errorCode: input.errorCode,
        nextAvailableAt: availableAt,
      },
      at,
    );
    return view(
      db
        .prepare("SELECT * FROM journey_action_queue WHERE id=? AND space_id=?")
        .get(row.id, input.spaceId),
    );
  })();
}
