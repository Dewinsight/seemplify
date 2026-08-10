import { z } from "zod";
import { api, json } from "@/lib/api";

export const workflowAdapters = [
  "survey_invitation",
  "service_recovery_ticket",
  "assistant_action",
  "internal_notification",
  "signed_webhook",
] as const;
export const safetyGates = [
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
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const trigger = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("event"),
      eventName: z.string(),
      sourceId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("metric_threshold"),
      metricDefinitionId: z.string(),
      operator: z.enum(["gt", "gte", "lt", "lte"]),
      value: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("schedule"),
      scheduleKey: z.string(),
      timezone: z.string(),
    })
    .strict(),
]);
const condition = z
  .object({
    key: z.string(),
    fact: z.string(),
    operator: z.enum([
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "in",
      "exists",
    ]),
    value: z.union([scalar, z.array(scalar)]).optional(),
  })
  .strict();
const action = z
  .object({
    key: z.string(),
    adapter: z.enum(workflowAdapters),
    purpose: z.string(),
    recipientScope: z.string(),
    consequential: z.boolean().optional(),
    externallyVisible: z.boolean().optional(),
  })
  .strict();
const policy = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("human_approval") }).strict(),
  z
    .object({
      mode: z.literal("bounded_automatic"),
      maximumActionsPerRun: z.number(),
      maximumActionsPerSubjectPerDay: z.number(),
      allowedAdapters: z.array(z.enum(workflowAdapters)),
      recipientScopes: z.array(z.string()),
      purpose: z.string(),
      authorisedByUserId: z.string(),
    })
    .strict(),
]);
const draft = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    name: z.string(),
    state: z.literal("draft"),
    revision: z.number(),
    trigger,
    conditions: z.array(condition),
    actions: z.array(action),
    automationPolicy: policy,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const definition = z
  .object({
    id: z.string(),
    spaceId: z.string(),
    name: z.string(),
    state: z.enum(["draft", "published", "retired"]),
    revision: z.number(),
    currentVersionId: z.string().nullable(),
    currentVersionNumber: z.number().nullable(),
    paused: z.boolean(),
    retiredAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const workflow = definition.extend({ draft }).strict();
const version = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    spaceId: z.string(),
    versionNumber: z.number(),
    name: z.string(),
    trigger,
    conditions: z.array(condition),
    actions: z.array(action),
    automationPolicy: policy,
    contentSha256: z.string(),
    publishedByUserId: z.string(),
    publishedAt: z.string(),
  })
  .strict();
const traceStep = z
  .object({
    kind: z.enum(["trigger", "condition", "gate", "approval", "decision"]),
    key: z.string(),
    decision: z.enum(["allow", "deny", "unknown"]),
    reason: z.string(),
  })
  .strict();
const runAction = z
  .object({
    id: z.string(),
    actionKey: z.string(),
    adapter: z.enum(workflowAdapters),
    idempotencyKey: z.string(),
    decision: z.enum(["suppressed", "pending_approval", "approved_held"]),
    approvalRequired: z.boolean(),
    trace: z.array(traceStep),
    createdAt: z.string(),
  })
  .strict();
const resultAction = z
  .object({
    actionKey: z.string(),
    adapter: z.enum(workflowAdapters),
    allowed: z.boolean(),
    approvalRequired: z.boolean(),
    idempotencyKey: z.string(),
    trace: z.array(traceStep),
  })
  .strict();
const run = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    workflowVersionId: z.string(),
    mode: z.enum(["dry_run", "historical"]),
    requestedByUserId: z.string().nullable(),
    triggerFingerprintSha256: z.string(),
    subjectRefSha256: z.string(),
    result: z
      .object({
        mode: z.enum(["dry_run", "historical"]),
        workflowVersionId: z.string(),
        workflowContentSha256: z.string(),
        actions: z.array(resultAction),
      })
      .strict(),
    createdAt: z.string(),
    actions: z.array(runAction),
  })
  .strict();
const approval = z
  .object({
    id: z.string(),
    actionId: z.string(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string(),
    requesterUserId: z.string(),
    reviewerUserId: z.string(),
    createdAt: z.string(),
  })
  .strict();
const queueState = z.enum([
  "held",
  "ready",
  "leased",
  "retry_scheduled",
  "succeeded",
  "dead_letter",
  "cancelled",
]);
const queueItem = z
  .object({
    id: z.string(),
    actionId: z.string(),
    workflowId: z.string(),
    adapter: z.enum(workflowAdapters),
    idempotencyKey: z.string(),
    state: queueState,
    holdReasonCode: z.string().nullable(),
    attemptCount: z.number(),
    maxAttempts: z.number(),
    availableAt: z.string(),
    fencingToken: z.number(),
    leaseExpiresAt: z.string().nullable(),
    terminalAt: z.string().nullable(),
    lastErrorCode: z.string().nullable(),
    revision: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    outcome: z
      .object({
        kind: z.enum(["reviewed_effect", "no_effect"]).nullable(),
        providerReferenceSha256: z.string().nullable(),
        responseSha256: z.string().nullable(),
        receiptFencingToken: z.number().nullable(),
      })
      .strict(),
    provider: z
      .object({
        state: z.string().nullable(),
        status: z.number().nullable(),
        attemptCount: z.number().nullable(),
      })
      .strict(),
    lastAttempt: z
      .object({
        outcome: z.string().nullable(),
        errorCode: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const adapterStatus = z
  .object({
    adapter: z.enum(workflowAdapters),
    enabled: z.boolean(),
    reasonCode: z.string().nullable(),
  })
  .strict();
const operatorStatus = z
  .object({
    worker: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["durable_reviewed_effects", "disabled"]),
      })
      .strict(),
    adapters: z.array(adapterStatus),
  })
  .strict();
const operationsAvailability = z.enum([
  "available",
  "feature_disabled",
  "capability_required",
  "store_unavailable",
]);
const operationsCount = z.object({ state: z.string(), count: z.number() }).strict();
const operationsBase = z.object({
  availability: operationsAvailability,
  counts: z.array(operationsCount),
  oldestPendingAt: z.string().nullable(),
  staleLeaseCount: z.number(),
});
const stageSurveyOperation = z.object({
  id: z.string(), operation: z.string(), state: z.string(), availableAt: z.string(),
  leaseExpiresAt: z.string().nullable(), attemptCount: z.number(), lastErrorCode: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
const eventIntelligenceOperation = z.object({
  id: z.string(), state: z.string(), blockReason: z.string().nullable(),
  retentionExpiresAt: z.string(), createdAt: z.string(),
}).strict();
const connectorOperation = z.object({
  id: z.string(), connectorId: z.string(), state: z.string(), attemptCount: z.number(),
  retryAt: z.string().nullable(), acceptedCount: z.number(), rejectedCount: z.number(),
  tombstoneCount: z.number(), lastErrorCode: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
}).strict();
const operationsConsole = z.object({
  generatedAt: z.string(),
  operator: operatorStatus,
  actionQueue: operationsBase.extend({ items: z.array(z.never()) }).strict(),
  stageSurvey: operationsBase.extend({ items: z.array(stageSurveyOperation) }).strict(),
  eventIntelligence: operationsBase.extend({ items: z.array(eventIntelligenceOperation) }).strict(),
  connectors: operationsBase.extend({ items: z.array(connectorOperation) }).strict(),
  privacy: operationsBase.extend({ items: z.array(z.never()) }).strict(),
  killSwitches: z.object({
    availability: operationsAvailability, disabledCount: z.number(), activePauses: z.number(),
  }).strict(),
}).strict();

export type WorkflowAdapter = (typeof workflowAdapters)[number];
export type SafetyGate = (typeof safetyGates)[number];
export type WorkflowTrigger = z.infer<typeof trigger>;
export type WorkflowCondition = z.infer<typeof condition>;
export type WorkflowAction = z.infer<typeof action>;
export type WorkflowAutomationPolicy = z.infer<typeof policy>;
export type WorkflowDraftInput = Pick<
  z.infer<typeof draft>,
  "name" | "trigger" | "conditions" | "actions" | "automationPolicy"
>;
export type JourneyWorkflowSummary = z.infer<typeof definition>;
export type JourneyWorkflow = z.infer<typeof workflow>;
export type JourneyWorkflowRun = z.infer<typeof run>;
export type JourneyWorkflowRunAction = z.infer<typeof runAction>;
export type JourneyActionQueueItem = z.infer<typeof queueItem>;
export type JourneyActionOperatorStatus = z.infer<typeof operatorStatus>;
export type JourneyOperationsConsole = z.infer<typeof operationsConsole>;
export type JourneyOrchestrationAccess = {
  canManage: boolean;
  canReview: boolean;
};

async function parsed<T>(
  schema: z.ZodType<T>,
  path: string,
  options?: RequestInit,
) {
  return schema.parse(await api<unknown>(path, options));
}
export const listJourneyWorkflows = () =>
  parsed(
    z.object({ workflows: z.array(definition) }).strict(),
    "/api/journey-orchestration/workflows",
  ).then((value) => value.workflows);
export const readJourneyOrchestrationAccess = () =>
  parsed(
    z.object({ canManage: z.boolean(), canReview: z.boolean() }).strict(),
    "/api/journey-orchestration/access",
  );
export const readJourneyWorkflow = (workflowId: string) =>
  parsed(
    z.object({ workflow }).strict(),
    `/api/journey-orchestration/workflows/${encodeURIComponent(workflowId)}`,
  ).then((value) => value.workflow);
export const createJourneyWorkflow = (input: WorkflowDraftInput) =>
  parsed(
    z.object({ workflow }).strict(),
    "/api/journey-orchestration/workflows",
    json("POST", input),
  ).then((value) => value.workflow);
export const reviseJourneyWorkflow = (
  item: JourneyWorkflow,
  patch: Partial<WorkflowDraftInput>,
) =>
  parsed(
    z.object({ workflow }).strict(),
    `/api/journey-orchestration/workflows/${encodeURIComponent(item.id)}`,
    json("PATCH", { expectedRevision: item.revision, ...patch }),
  ).then((value) => value.workflow);
export const publishJourneyWorkflow = (item: JourneyWorkflow) =>
  parsed(
    z.object({ workflow, version }).strict(),
    `/api/journey-orchestration/workflows/${encodeURIComponent(item.id)}/publish`,
    json("POST", { expectedRevision: item.revision }),
  );
export const retireJourneyWorkflow = (item: JourneyWorkflow) =>
  parsed(
    z.object({ workflow }).strict(),
    `/api/journey-orchestration/workflows/${encodeURIComponent(item.id)}/retire`,
    json("POST", { expectedRevision: item.revision }),
  ).then((value) => value.workflow);

export interface SimulationInput {
  mode: "dry_run" | "historical";
  triggerFingerprint: string;
  triggerMatched: boolean;
  subjectId: string;
  facts: Record<string, string | number | boolean | null>;
  gates: Record<SafetyGate, "allow" | "deny" | "unknown">;
  approvedActionKeys?: string[];
}
export const simulateJourneyWorkflow = (
  workflowId: string,
  input: SimulationInput,
) =>
  parsed(
    z.object({ run }).strict(),
    `/api/journey-orchestration/workflows/${encodeURIComponent(workflowId)}/simulations`,
    json("POST", input),
  ).then((value) => value.run);
export const listJourneyWorkflowRuns = (workflowId?: string) =>
  parsed(
    z.object({ runs: z.array(run) }).strict(),
    `/api/journey-orchestration/simulations${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""}`,
  ).then((value) => value.runs);
export const decideJourneyWorkflowAction = (
  actionId: string,
  decision: "approved" | "rejected",
  reason: string,
) =>
  parsed(
    z.object({ approval }).strict(),
    `/api/journey-orchestration/actions/${encodeURIComponent(actionId)}/approval`,
    json("POST", { decision, reason }),
  ).then((value) => value.approval);
export const readJourneyActionOperatorStatus = () =>
  parsed(operatorStatus, "/api/journey-orchestration/operator-status");
export const readJourneyOperationsConsole = () =>
  parsed(operationsConsole, "/api/journey-orchestration/operations");
export const listJourneyActionQueue = () =>
  parsed(
    z.object({ queue: z.array(queueItem) }).strict(),
    "/api/journey-orchestration/queue",
  ).then((value) => value.queue);
export const retryJourneyActionQueueItem = (item: JourneyActionQueueItem) =>
  parsed(
    z
      .object({
        item: queueItem.omit({
          outcome: true,
          provider: true,
          lastAttempt: true,
        }),
      })
      .strict(),
    `/api/journey-orchestration/queue/${encodeURIComponent(item.id)}/retry`,
    json("POST", {
      expectedRevision: item.revision,
      reasonCode: "OPERATOR_RECOVERY",
    }),
  ).then((value) => value.item);
export const cancelJourneyActionQueueItem = (item: JourneyActionQueueItem) =>
  parsed(
    z
      .object({
        item: queueItem.omit({
          outcome: true,
          provider: true,
          lastAttempt: true,
        }),
      })
      .strict(),
    `/api/journey-orchestration/queue/${encodeURIComponent(item.id)}/cancel`,
    json("POST", {
      expectedRevision: item.revision,
      reasonCode: "OPERATOR_CANCEL",
    }),
  ).then((value) => value.item);
