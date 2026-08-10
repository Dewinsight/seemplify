import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Ban,
  Check,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  X,
} from "lucide-react";
import { useAuthSession, useSessionFeature } from "@/lib/authSessionContext";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cancelJourneyActionQueueItem,
  createJourneyWorkflow,
  decideJourneyWorkflowAction,
  listJourneyActionQueue,
  listJourneyWorkflowRuns,
  listJourneyWorkflows,
  publishJourneyWorkflow,
  readJourneyOrchestrationAccess,
  readJourneyOperationsConsole,
  readJourneyWorkflow,
  retireJourneyWorkflow,
  reviseJourneyWorkflow,
  safetyGates,
  retryJourneyActionQueueItem,
  simulateJourneyWorkflow,
  type JourneyActionOperatorStatus,
  type JourneyActionQueueItem,
  type JourneyOperationsConsole,
  type JourneyOrchestrationAccess,
  type JourneyWorkflow,
  type JourneyWorkflowRun,
  type JourneyWorkflowRunAction,
  type SafetyGate,
  type WorkflowAction,
  type WorkflowAutomationPolicy,
  type WorkflowCondition,
  type WorkflowDraftInput,
  type WorkflowTrigger,
} from "@/lib/journeyOrchestration";

const selectClass = "h-9 min-w-0 rounded-md border bg-background px-2 text-sm";
const textareaClass =
  "min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const humanPolicy: WorkflowAutomationPolicy = { mode: "human_approval" };
const defaultAction: WorkflowAction[] = [
  {
    key: "notify-owner",
    adapter: "internal_notification",
    purpose: "Notify the journey owner",
    recipientScope: "journey-owner",
  },
];
const defaultTrigger: WorkflowTrigger = {
  type: "event",
  eventName: "journey.signal",
  sourceId: "experience-platform",
};
const allowGates = Object.fromEntries(
  safetyGates.map((gate) => [gate, "allow"]),
) as Record<SafetyGate, "allow" | "deny" | "unknown">;
const readable = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
const message = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;
const jsonObject = <T,>(value: string, label: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
};

interface EditorState {
  name: string;
  trigger: WorkflowTrigger;
  conditionsText: string;
  actionsText: string;
  policyMode: "human_approval" | "bounded_automatic";
  maximumActionsPerRun: number;
  maximumActionsPerSubjectPerDay: number;
  purpose: string;
}
const blankEditor = (): EditorState => ({
  name: "",
  trigger: defaultTrigger,
  conditionsText: "[]",
  actionsText: JSON.stringify(defaultAction, null, 2),
  policyMode: "human_approval",
  maximumActionsPerRun: 10,
  maximumActionsPerSubjectPerDay: 2,
  purpose: "Operate within the reviewed journey policy.",
});
function editorFrom(item: JourneyWorkflow): EditorState {
  const bounded =
    item.draft.automationPolicy.mode === "bounded_automatic"
      ? item.draft.automationPolicy
      : null;
  return {
    name: item.draft.name,
    trigger: item.draft.trigger,
    conditionsText: JSON.stringify(item.draft.conditions, null, 2),
    actionsText: JSON.stringify(item.draft.actions, null, 2),
    policyMode: item.draft.automationPolicy.mode,
    maximumActionsPerRun: bounded?.maximumActionsPerRun || 10,
    maximumActionsPerSubjectPerDay:
      bounded?.maximumActionsPerSubjectPerDay || 2,
    purpose: bounded?.purpose || "Operate within the reviewed journey policy.",
  };
}

function TriggerFields({
  value,
  disabled,
  onChange,
}: {
  value: WorkflowTrigger;
  disabled: boolean;
  onChange: (value: WorkflowTrigger) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="grid gap-1.5">
        <Label htmlFor="workflow-trigger-type">Trigger type</Label>
        <select
          id="workflow-trigger-type"
          className={selectClass}
          disabled={disabled}
          value={value.type}
          onChange={(event) => {
            const type = event.target.value;
            onChange(
              type === "metric_threshold"
                ? {
                    type,
                    metricDefinitionId: "journey.metric",
                    operator: "gte",
                    value: 1,
                  }
                : type === "schedule"
                  ? { type, scheduleKey: "journey-daily", timezone: "UTC" }
                  : defaultTrigger,
            );
          }}
        >
          <option value="event">Event</option>
          <option value="metric_threshold">Metric threshold</option>
          <option value="schedule">Schedule</option>
        </select>
      </div>
      {value.type === "event" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="workflow-event-name">Event name</Label>
            <Input
              id="workflow-event-name"
              disabled={disabled}
              value={value.eventName}
              onChange={(event) =>
                onChange({ ...value, eventName: event.target.value })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workflow-source-id">Source ID</Label>
            <Input
              id="workflow-source-id"
              disabled={disabled}
              value={value.sourceId}
              onChange={(event) =>
                onChange({ ...value, sourceId: event.target.value })
              }
            />
          </div>
        </>
      )}
      {value.type === "metric_threshold" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="workflow-metric-id">Metric definition</Label>
            <Input
              id="workflow-metric-id"
              disabled={disabled}
              value={value.metricDefinitionId}
              onChange={(event) =>
                onChange({ ...value, metricDefinitionId: event.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-metric-operator">Operator</Label>
              <select
                id="workflow-metric-operator"
                className={selectClass}
                disabled={disabled}
                value={value.operator}
                onChange={(event) =>
                  onChange({
                    ...value,
                    operator: event.target.value as typeof value.operator,
                  })
                }
              >
                {["gt", "gte", "lt", "lte"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-metric-value">Value</Label>
              <Input
                id="workflow-metric-value"
                type="number"
                disabled={disabled}
                value={value.value}
                onChange={(event) =>
                  onChange({ ...value, value: Number(event.target.value) })
                }
              />
            </div>
          </div>
        </>
      )}
      {value.type === "schedule" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="workflow-schedule-key">Schedule key</Label>
            <Input
              id="workflow-schedule-key"
              disabled={disabled}
              value={value.scheduleKey}
              onChange={(event) =>
                onChange({ ...value, scheduleKey: event.target.value })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workflow-timezone">Timezone</Label>
            <Input
              id="workflow-timezone"
              disabled={disabled}
              value={value.timezone}
              onChange={(event) =>
                onChange({ ...value, timezone: event.target.value })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function WorkflowEditor({
  value,
  disabled,
  actorUserId,
  submitLabel,
  busy,
  onChange,
  onSubmit,
}: {
  value: EditorState;
  disabled: boolean;
  actorUserId: string;
  submitLabel: string;
  busy: boolean;
  onChange: (next: EditorState) => void;
  onSubmit: (input: WorkflowDraftInput) => Promise<void>;
}) {
  async function submit(event: FormEvent) {
    event.preventDefault();
    const conditions = jsonObject<WorkflowCondition[]>(
      value.conditionsText,
      "Conditions",
    );
    const actions = jsonObject<WorkflowAction[]>(value.actionsText, "Actions");
    const automationPolicy: WorkflowAutomationPolicy =
      value.policyMode === "human_approval"
        ? humanPolicy
        : {
            mode: "bounded_automatic",
            maximumActionsPerRun: value.maximumActionsPerRun,
            maximumActionsPerSubjectPerDay:
              value.maximumActionsPerSubjectPerDay,
            allowedAdapters: [
              ...new Set(actions.map((action) => action.adapter)),
            ],
            recipientScopes: [
              ...new Set(actions.map((action) => action.recipientScope)),
            ],
            purpose: value.purpose,
            authorisedByUserId: actorUserId,
          };
    await onSubmit({
      name: value.name.trim(),
      trigger: value.trigger,
      conditions,
      actions,
      automationPolicy,
    });
  }
  return (
    <form
      className="grid gap-4 border p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="workflow-name">Workflow name</Label>
        <Input
          id="workflow-name"
          required
          maxLength={160}
          disabled={disabled}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>
      <TriggerFields
        value={value.trigger}
        disabled={disabled}
        onChange={(trigger) => onChange({ ...value, trigger })}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="workflow-conditions">Conditions (JSON)</Label>
          <textarea
            id="workflow-conditions"
            className={textareaClass}
            disabled={disabled}
            value={value.conditionsText}
            onChange={(event) =>
              onChange({ ...value, conditionsText: event.target.value })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="workflow-actions">Actions (JSON)</Label>
          <textarea
            id="workflow-actions"
            className={textareaClass}
            disabled={disabled}
            value={value.actionsText}
            onChange={(event) =>
              onChange({ ...value, actionsText: event.target.value })
            }
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor="workflow-policy">Automation policy</Label>
          <select
            id="workflow-policy"
            className={selectClass}
            disabled={disabled}
            value={value.policyMode}
            onChange={(event) =>
              onChange({
                ...value,
                policyMode: event.target.value as EditorState["policyMode"],
              })
            }
          >
            <option value="human_approval">Human approval</option>
            <option value="bounded_automatic">Bounded automatic</option>
          </select>
        </div>
        {value.policyMode === "bounded_automatic" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-run-cap">Run cap</Label>
              <Input
                id="workflow-run-cap"
                type="number"
                min={1}
                max={1000}
                disabled={disabled}
                value={value.maximumActionsPerRun}
                onChange={(event) =>
                  onChange({
                    ...value,
                    maximumActionsPerRun: Number(event.target.value),
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-subject-cap">Subject daily cap</Label>
              <Input
                id="workflow-subject-cap"
                type="number"
                min={1}
                max={100}
                disabled={disabled}
                value={value.maximumActionsPerSubjectPerDay}
                onChange={(event) =>
                  onChange({
                    ...value,
                    maximumActionsPerSubjectPerDay: Number(event.target.value),
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-policy-purpose">Policy purpose</Label>
              <Input
                id="workflow-policy-purpose"
                disabled={disabled}
                value={value.purpose}
                onChange={(event) =>
                  onChange({ ...value, purpose: event.target.value })
                }
              />
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || busy || !value.name.trim()}>
          <Save className="h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function SimulationPanel({
  workflow,
  runs,
  canManage,
  busy,
  onRun,
}: {
  workflow: JourneyWorkflow;
  runs: JourneyWorkflowRun[];
  canManage: boolean;
  busy: boolean;
  onRun: (
    input: Parameters<typeof simulateJourneyWorkflow>[1],
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"dry_run" | "historical">("dry_run");
  const [fingerprint, setFingerprint] = useState("review-1");
  const [subject, setSubject] = useState("profile-1");
  const [facts, setFacts] = useState("{}");
  const [gates, setGates] = useState(allowGates);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onRun({
      mode,
      triggerFingerprint: fingerprint,
      triggerMatched: true,
      subjectId: subject,
      facts: jsonObject<Record<string, string | number | boolean | null>>(
        facts,
        "Facts",
      ),
      gates,
    });
  }
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <form
        className="h-fit border p-4"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="text-sm font-semibold">Simulation input</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Simulations evaluate immutable published versions. Identifiers are
          stored as hashes.
        </p>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="simulation-mode">Mode</Label>
            <select
              id="simulation-mode"
              className={selectClass}
              value={mode}
              disabled={!canManage}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="dry_run">Dry run</option>
              <option value="historical">Historical</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="simulation-fingerprint">Trigger fingerprint</Label>
            <Input
              id="simulation-fingerprint"
              value={fingerprint}
              disabled={!canManage}
              onChange={(event) => setFingerprint(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="simulation-subject">Subject reference</Label>
            <Input
              id="simulation-subject"
              value={subject}
              disabled={!canManage}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="simulation-facts">Facts (JSON)</Label>
            <textarea
              id="simulation-facts"
              className={textareaClass}
              value={facts}
              disabled={!canManage}
              onChange={(event) => setFacts(event.target.value)}
            />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Safety gates
            </summary>
            <div className="mt-3 grid gap-2">
              {safetyGates.map((gate) => (
                <label
                  className="grid grid-cols-[1fr_110px] items-center gap-2 text-xs"
                  key={gate}
                >
                  <span>{readable(gate)}</span>
                  <select
                    aria-label={`${readable(gate)} gate`}
                    className={selectClass}
                    value={gates[gate]}
                    disabled={!canManage}
                    onChange={(event) =>
                      setGates({
                        ...gates,
                        [gate]: event.target.value as
                          "allow" | "deny" | "unknown",
                      })
                    }
                  >
                    <option>allow</option>
                    <option>deny</option>
                    <option>unknown</option>
                  </select>
                </label>
              ))}
            </div>
          </details>
          <Button
            type="submit"
            disabled={!canManage || busy || workflow.state !== "published"}
          >
            <Play className="h-4 w-4" />
            Run simulation
          </Button>
        </div>
      </form>
      <RunHistory runs={runs} />
    </div>
  );
}

function RunHistory({ runs }: { runs: JourneyWorkflowRun[] }) {
  return (
    <section className="min-w-0 border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Simulation history</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Actions</th>
              <th className="px-3 py-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr className="border-b last:border-0" key={run.id}>
                <td className="px-3 py-2">
                  {new Date(run.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{readable(run.mode)}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {run.workflowVersionId.slice(0, 12)}
                </td>
                <td className="px-3 py-2">{run.actions.length}</td>
                <td className="px-3 py-2">
                  {run.actions
                    .map((item) => readable(item.decision))
                    .join(", ") || "No action matched"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          No simulations have been recorded for this workflow.
        </p>
      )}
    </section>
  );
}

function ApprovalPanel({
  actions,
  canReview,
  reviewerUserId,
  busy,
  onDecision,
}: {
  actions: Array<JourneyWorkflowRunAction & { requestedByUserId: string | null }>;
  canReview: boolean;
  reviewerUserId: string;
  busy: boolean;
  onDecision: (
    action: JourneyWorkflowRunAction,
    decision: "approved" | "rejected",
    reason: string,
  ) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const pending = actions.filter(
    (action) => action.decision === "pending_approval",
  );
  return (
    <section className="border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Approval queue</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Approval records the reviewed decision. Eligible actions enter the
          durable queue; execution still depends on the worker, adapter, and
          safety gates.
        </p>
      </div>
      <div className="divide-y">
        {pending.map((action) => {
          const independentReviewer = Boolean(action.requestedByUserId)
            && action.requestedByUserId !== reviewerUserId;
          const decisionDisabled = !canReview || !independentReviewer;
          return (
          <article
            className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,360px)]"
            key={action.id}
          >
            <div>
              <h3 className="text-sm font-medium">{action.actionKey}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {readable(action.adapter)} · {action.trace.length} explanation
                steps
              </p>
              <ol className="mt-3 space-y-1 text-xs">
                {action.trace.map((step, index) => (
                  <li key={`${step.kind}-${step.key}-${index}`}>
                    <span className="font-medium">{readable(step.kind)}:</span>{" "}
                    {readable(step.decision)} · {step.reason}
                  </li>
                ))}
              </ol>
              <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                <dt className="text-muted-foreground">Requester</dt>
                <dd className="break-all font-mono">{action.requestedByUserId || "Unavailable"}</dd>
                <dt className="text-muted-foreground">Reviewer</dt>
                <dd className="break-all font-mono">{reviewerUserId || "Unavailable"}</dd>
              </dl>
              {!independentReviewer && (
                <p className="mt-3 text-xs font-medium text-amber-800">
                  {action.requestedByUserId
                    ? "You requested this run. Another user with journey review access must decide it."
                    : "The requester cannot be verified. Approval is blocked."}
                </p>
              )}
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor={`approval-reason-${action.id}`}>
                Decision reason
              </Label>
              <textarea
                id={`approval-reason-${action.id}`}
                className={textareaClass}
                disabled={decisionDisabled}
                value={reasons[action.id] || ""}
                onChange={(event) =>
                  setReasons({ ...reasons, [action.id]: event.target.value })
                }
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={
                    decisionDisabled ||
                    busy ||
                    (reasons[action.id] || "").trim().length < 3
                  }
                  onClick={() =>
                    void onDecision(
                      action,
                      "approved",
                      reasons[action.id] || "",
                    )
                  }
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    decisionDisabled ||
                    busy ||
                    (reasons[action.id] || "").trim().length < 3
                  }
                  onClick={() =>
                    void onDecision(
                      action,
                      "rejected",
                      reasons[action.id] || "",
                    )
                  }
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          </article>
          );
        })}
        {pending.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No actions are awaiting approval.
          </p>
        )}
      </div>
    </section>
  );
}

function RuntimeQueue({
  status,
  items,
  canManage,
  busy,
  onRetry,
  onCancel,
}: {
  status: JourneyActionOperatorStatus | null;
  items: JourneyActionQueueItem[];
  canManage: boolean;
  busy: boolean;
  onRetry: (item: JourneyActionQueueItem) => void;
  onCancel: (item: JourneyActionQueueItem) => void;
}) {
  return (
    <section className="border" aria-labelledby="action-runtime-heading">
      <div className="grid gap-4 border-b px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]">
        <div>
          <h2 id="action-runtime-heading" className="text-sm font-semibold">
            Action runtime
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {status?.worker.enabled
              ? "The durable reviewed-action worker is enabled for its configured tenant and adapter scope."
              : "The durable reviewed-action worker is disabled. Approved actions can queue, but no worker execution occurs until it is explicitly enabled."}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {status?.adapters.map((adapter) => (
            <div
              className="flex justify-between gap-3 border-b py-1"
              key={adapter.adapter}
            >
              <dt>{readable(adapter.adapter)}</dt>
              <dd
                className={
                  adapter.enabled ? "text-foreground" : "text-muted-foreground"
                }
              >
                {adapter.enabled
                  ? "Enabled"
                  : adapter.adapter === "survey_invitation"
                    ? "Unavailable: provider idempotency required"
                    : "Disabled"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2">Queued</th>
              <th className="px-3 py-2">Adapter</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Lease / retry</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Operator</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-b last:border-0" key={item.id}>
                <td className="px-3 py-2">
                  <span className="block">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {item.id.slice(0, 12)}
                  </span>
                </td>
                <td className="px-3 py-2">{readable(item.adapter)}</td>
                <td className="px-3 py-2">
                  <span className="block">{readable(item.state)}</span>
                  <span className="text-xs text-muted-foreground">
                    Attempt {item.attemptCount}/{item.maxAttempts} · fence{" "}
                    {item.fencingToken}
                  </span>
                  {item.lastErrorCode && (
                    <span className="block text-xs text-destructive">
                      {item.lastErrorCode}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {item.leaseExpiresAt
                    ? `Lease expires ${new Date(item.leaseExpiresAt).toLocaleString()}`
                    : item.state === "retry_scheduled"
                      ? `Available ${new Date(item.availableAt).toLocaleString()}`
                      : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="block">
                    {item.outcome.kind
                      ? readable(item.outcome.kind)
                      : item.lastAttempt.outcome
                        ? readable(item.lastAttempt.outcome)
                        : "Pending"}
                  </span>
                  {item.provider.state && (
                    <span className="block text-muted-foreground">
                      Provider: {readable(item.provider.state)}
                      {item.provider.status ? ` · ${item.provider.status}` : ""}
                    </span>
                  )}
                  {item.outcome.providerReferenceSha256 && (
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      Receipt{" "}
                      {item.outcome.providerReferenceSha256.slice(0, 12)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <div className="flex gap-1">
                      {["retry_scheduled", "dead_letter"].includes(
                        item.state,
                      ) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onRetry(item)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Retry
                        </Button>
                      )}
                      {[
                        "held",
                        "ready",
                        "retry_scheduled",
                        "dead_letter",
                      ].includes(item.state) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => onCancel(item)}
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Read only
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          No reviewed actions are queued.
        </p>
      )}
    </section>
  );
}

function countState(counts: Array<{ state: string; count: number }>, state: string) {
  return counts.find((item) => item.state === state)?.count || 0;
}

function OperationsConsole({ data }: { data: JourneyOperationsConsole | null }) {
  if (!data) return null;
  const feeds = [
    { name: "Stage survey feed", section: data.stageSurvey,
      attention: `${countState(data.stageSurvey.counts, "pending") + countState(data.stageSurvey.counts, "retry_wait") + countState(data.stageSurvey.counts, "leased")} open · ${countState(data.stageSurvey.counts, "dead_letter")} dead letter` },
    { name: "Event intelligence feed", section: data.eventIntelligence,
      attention: `${countState(data.eventIntelligence.counts, "ready")} ready · ${countState(data.eventIntelligence.counts, "blocked")} blocked` },
    { name: "Connector imports", section: data.connectors,
      attention: `${countState(data.connectors.counts, "retry_wait")} retry wait · ${countState(data.connectors.counts, "failed")} failed` },
    { name: "Privacy propagation", section: data.privacy,
      attention: `${countState(data.privacy.counts, "queued")} queued` },
  ];
  const openQueue = ["held", "ready", "leased", "retry_scheduled"].reduce(
    (total, state) => total + countState(data.actionQueue.counts, state), 0,
  );
  const availability = (value: string) => value === "available" ? "Available" : readable(value);
  const time = (value: string | null) => value ? new Date(value).toLocaleString() : "None";
  return (
    <section aria-labelledby="journey-operations-heading" className="border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 id="journey-operations-heading" className="text-sm font-semibold">Operations console</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Bounded tenant status from durable journey stores. Feed rows are diagnostic and read-only.</p>
        </div>
        <span className="text-xs text-muted-foreground">Updated {new Date(data.generatedAt).toLocaleString()}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 font-medium">Operation</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Open / attention</th><th className="px-3 py-2 font-medium">Oldest pending</th><th className="px-3 py-2 font-medium">Stale leases</th></tr>
          </thead>
          <tbody className="divide-y">
            <tr><td className="px-4 py-2 font-medium">Reviewed action queue</td><td className="px-3 py-2">{availability(data.actionQueue.availability)}</td><td className="px-3 py-2">{openQueue} open · {countState(data.actionQueue.counts, "dead_letter")} dead letter</td><td className="px-3 py-2 text-xs">{time(data.actionQueue.oldestPendingAt)}</td><td className="px-3 py-2">{data.actionQueue.staleLeaseCount}</td></tr>
            {feeds.map(({ name, section, attention }) => <tr key={name}><td className="px-4 py-2 font-medium">{name}</td><td className="px-3 py-2">{availability(section.availability)}</td><td className="px-3 py-2">{attention}</td><td className="px-3 py-2 text-xs">{time(section.oldestPendingAt)}</td><td className="px-3 py-2">{section.staleLeaseCount}</td></tr>)}
            <tr><td className="px-4 py-2 font-medium">Kill switches</td><td className="px-3 py-2">{availability(data.killSwitches.availability)}</td><td className="px-3 py-2">{data.killSwitches.disabledCount} disabled · {data.killSwitches.activePauses} paused actions</td><td className="px-3 py-2 text-xs"><a className="underline underline-offset-2" href="/journey-safety">Open safety controls</a></td><td className="px-3 py-2">—</td></tr>
          </tbody>
        </table>
      </div>
      {(data.stageSurvey.items.length > 0 || data.eventIntelligence.items.length > 0 || data.connectors.items.length > 0) && (
        <details className="border-t">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Recent feed exceptions and retries</summary>
          <div className="overflow-x-auto border-t">
            <table className="min-w-[680px] w-full text-left text-xs">
              <thead className="border-b bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Feed</th><th className="px-3 py-2 font-medium">Reference</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Attempts</th><th className="px-3 py-2 font-medium">Available / retry</th><th className="px-3 py-2 font-medium">Code</th></tr></thead>
              <tbody className="divide-y">
                {data.stageSurvey.items.map((item) => <tr key={`survey:${item.id}`}><td className="px-4 py-2">Stage survey</td><td className="px-3 py-2 font-mono">{item.id.slice(0, 12)}</td><td className="px-3 py-2">{readable(item.state)}</td><td className="px-3 py-2">{item.attemptCount}</td><td className="px-3 py-2">{time(item.availableAt)}</td><td className="px-3 py-2">{item.lastErrorCode || "—"}</td></tr>)}
                {data.eventIntelligence.items.map((item) => <tr key={`event:${item.id}`}><td className="px-4 py-2">Event intelligence</td><td className="px-3 py-2 font-mono">{item.id.slice(0, 12)}</td><td className="px-3 py-2">{readable(item.state)}</td><td className="px-3 py-2">—</td><td className="px-3 py-2">—</td><td className="px-3 py-2">{item.blockReason || "—"}</td></tr>)}
                {data.connectors.items.map((item) => <tr key={`connector:${item.id}`}><td className="px-4 py-2">Connector import</td><td className="px-3 py-2 font-mono">{item.id.slice(0, 12)}</td><td className="px-3 py-2">{readable(item.state)}</td><td className="px-3 py-2">{item.attemptCount}</td><td className="px-3 py-2">{time(item.retryAt)}</td><td className="px-3 py-2">{item.lastErrorCode || "—"}</td></tr>)}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export function JourneyOrchestrationPage() {
  const enabled = useSessionFeature("journeyOrchestration");
  const session = useAuthSession();
  const sessionCanManage = Boolean(
    session?.activeSpace && session.activeSpace.role !== "member",
  );
  const actorUserId = session?.user?.id || "";
  const [workflows, setWorkflows] = useState<
    Awaited<ReturnType<typeof listJourneyWorkflows>>
  >([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<JourneyWorkflow | null>(null);
  const [runs, setRuns] = useState<JourneyWorkflowRun[]>([]);
  const [editor, setEditor] = useState(blankEditor);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runtimeStatus, setRuntimeStatus] =
    useState<JourneyActionOperatorStatus | null>(null);
  const [operations, setOperations] = useState<JourneyOperationsConsole | null>(null);
  const [access, setAccess] = useState<JourneyOrchestrationAccess | null>(null);
  const [queue, setQueue] = useState<JourneyActionQueueItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const [decided, setDecided] = useState<Record<string, string>>({});
  const canManage = access?.canManage ?? sessionCanManage;
  const canReview = access?.canReview ?? false;
  const pendingActions = useMemo(
    () =>
      runs
        .flatMap((run) => run.actions.map((action) => ({
          ...action,
          requestedByUserId: run.requestedByUserId,
        })))
        .filter((action) => !decided[action.id]),
    [decided, runs],
  );
  const loadIndex = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const [next, consoleData, items, nextAccess] = await Promise.all([
        listJourneyWorkflows(),
        readJourneyOperationsConsole(),
        listJourneyActionQueue(),
        readJourneyOrchestrationAccess(),
      ]);
      setWorkflows(next);
      setOperations(consoleData);
      setRuntimeStatus(consoleData.operator);
      setQueue(items);
      setAccess(nextAccess);
      setSelectedId((current) =>
        next.some((item) => item.id === current) ? current : next[0]?.id || "",
      );
    } catch (reason) {
      setError(message(reason, "Journey orchestration could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [enabled]);
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const [workflow, history] = await Promise.all([
        readJourneyWorkflow(id),
        listJourneyWorkflowRuns(id),
      ]);
      setSelected(workflow);
      setRuns(history);
      setEditor(editorFrom(workflow));
    } catch (reason) {
      setError(message(reason, "Workflow details could not be loaded."));
      setSelected(null);
      setRuns([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setSelected(null);
      setRuns([]);
    }
  }, [loadDetail, selectedId]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setConflict("");
    try {
      await action();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setConflict(
          "This workflow changed elsewhere. The latest revision has been reloaded; review it before retrying.",
        );
        if (selectedId) await loadDetail(selectedId);
      } else
        setError(
          message(reason, "The orchestration change could not be completed."),
        );
    } finally {
      setBusy(false);
    }
  }
  if (!enabled) return null;
  if (loading)
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading journey orchestration…
      </div>
    );
  return (
    <div
      className="min-w-0 space-y-5"
      data-testid="journey-orchestration-workspace"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Journey orchestration
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Author governed workflows, evaluate them safely, and review every
            consequential action.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void loadIndex()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {canManage && (
            <Button
              onClick={() => {
                setCreating(true);
                setEditor(blankEditor());
              }}
            >
              <Plus className="h-4 w-4" />
              New workflow
            </Button>
          )}
        </div>
      </header>
      {!canManage && (
        <div className="border bg-muted/40 px-4 py-3 text-sm">
          Read-only: workflow authoring, simulation, publishing, and retirement
          are disabled for members. {canReview
            ? "You may independently review actions requested by another user."
            : "Approval actions require delegated journey review access."}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {conflict && (
        <div
          role="alert"
          className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {conflict}
        </div>
      )}
      {creating && canManage && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Create workflow</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
          <WorkflowEditor
            value={editor}
            disabled={busy}
            actorUserId={actorUserId}
            submitLabel="Create draft"
            busy={busy}
            onChange={setEditor}
            onSubmit={async (input) =>
              act(async () => {
                const created = await createJourneyWorkflow(input);
                setCreating(false);
                await loadIndex();
                setSelectedId(created.id);
              })
            }
          />
        </section>
      )}
      <OperationsConsole data={operations} />
      <RuntimeQueue
        status={runtimeStatus}
        items={queue}
        canManage={canManage}
        busy={busy}
        onRetry={(item) =>
          void act(async () => {
            await retryJourneyActionQueueItem(item);
            setQueue(await listJourneyActionQueue());
          })
        }
        onCancel={(item) =>
          void act(async () => {
            await cancelJourneyActionQueueItem(item);
            setQueue(await listJourneyActionQueue());
          })
        }
      />
      <section className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Workflows</h2>
          </div>
          <div className="max-h-[520px] overflow-y-auto p-2">
            {workflows.map((item) => (
              <button
                type="button"
                className="w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-muted"
                aria-current={selectedId === item.id ? "true" : undefined}
                onClick={() => setSelectedId(item.id)}
                key={item.id}
              >
                <span className="block truncate text-sm font-medium">
                  {item.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {readable(item.state)} · revision {item.revision}
                </span>
              </button>
            ))}
            {workflows.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No orchestration workflows have been created.
              </p>
            )}
          </div>
        </aside>
        <div className="min-w-0">
          {detailLoading && (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading workflow…
            </div>
          )}
          {!detailLoading && !selected && workflows.length > 0 && (
            <p className="border p-4 text-sm text-muted-foreground">
              Choose a workflow to inspect it.
            </p>
          )}
          {!detailLoading && selected && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border px-4 py-3">
                <div>
                  <h2 className="font-semibold">{selected.name}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {readable(selected.state)} · revision {selected.revision}
                    {selected.currentVersionNumber
                      ? ` · published version ${selected.currentVersionNumber}`
                      : ""}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || selected.state === "retired"}
                      onClick={() =>
                        void act(async () => {
                          const result = await publishJourneyWorkflow(selected);
                          await loadIndex();
                          await loadDetail(result.workflow.id);
                        })
                      }
                    >
                      <Send className="h-4 w-4" />
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || selected.state === "retired"}
                      onClick={() =>
                        void act(async () => {
                          await retireJourneyWorkflow(selected);
                          await loadIndex();
                          await loadDetail(selected.id);
                        })
                      }
                    >
                      Retire
                    </Button>
                  </div>
                )}
              </div>
              <Tabs defaultValue="definition">
                <div className="max-w-full overflow-x-auto">
                  <TabsList
                    className="w-max min-w-full justify-start"
                    role="tablist"
                  >
                    <TabsTrigger value="definition">Definition</TabsTrigger>
                    <TabsTrigger value="simulation">Simulations</TabsTrigger>
                    <TabsTrigger value="approvals">Approvals</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="definition">
                  <WorkflowEditor
                    value={editor}
                    disabled={
                      !canManage || busy || selected.state === "retired"
                    }
                    actorUserId={actorUserId}
                    submitLabel="Save revision"
                    busy={busy}
                    onChange={setEditor}
                    onSubmit={async (input) =>
                      act(async () => {
                        const updated = await reviseJourneyWorkflow(
                          selected,
                          input,
                        );
                        setSelected(updated);
                        setEditor(editorFrom(updated));
                        await loadIndex();
                      })
                    }
                  />
                </TabsContent>
                <TabsContent value="simulation">
                  <SimulationPanel
                    workflow={selected}
                    runs={runs}
                    canManage={canManage}
                    busy={busy}
                    onRun={async (input) =>
                      act(async () => {
                        await simulateJourneyWorkflow(selected.id, input);
                        setRuns(await listJourneyWorkflowRuns(selected.id));
                      })
                    }
                  />
                </TabsContent>
                <TabsContent value="approvals">
                  <ApprovalPanel
                    actions={pendingActions}
                    canReview={canReview}
                    reviewerUserId={actorUserId}
                    busy={busy}
                    onDecision={async (action, decision, reason) =>
                      act(async () => {
                        const approval = await decideJourneyWorkflowAction(
                          action.id,
                          decision,
                          reason,
                        );
                        setDecided((current) => ({
                          ...current,
                          [action.id]: approval.decision,
                        }));
                        setQueue(await listJourneyActionQueue());
                      })
                    }
                  />
                  {Object.keys(decided).length > 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {Object.keys(decided).length} decision recorded in this
                      session. Eligible approvals are visible in the action
                      runtime above.
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
