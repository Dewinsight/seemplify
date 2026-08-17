import { actionCatalog, eventCatalog } from "./catalog.js";
import type { ActionDescriptor, ActionStep, CompileIssue, CompileResult, RiskClass, WorkflowDefinition } from "./domain.js";

const riskOrder: RiskClass[] = ["R0", "R1", "R2", "R3"];
const higherRisk = (left: RiskClass, right: RiskClass) => riskOrder.indexOf(left) >= riskOrder.indexOf(right) ? left : right;

function eventBinding(value: unknown) {
  const match = typeof value === "string" ? value.match(/^\$event\.payload\.([A-Za-z0-9_]+)$/u) : null;
  return match?.[1] || null;
}

function referencesStep(value: unknown) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\$steps\.([A-Za-z0-9_-]+)\.output\.[A-Za-z0-9_]+/gu)].map((match) => match[1]);
}

export interface CompileContext {
  connectionAvailable?: (provider: string, connectionId: string | undefined) => boolean;
}

export function compileWorkflow(definition: WorkflowDefinition, context: CompileContext = {}): CompileResult {
  const issues: CompileIssue[] = [];
  const trigger = eventCatalog.find((event) => event.id === definition.trigger.eventId);
  let risk: RiskClass = "R0";
  const externalProviders = new Set<string>();
  if (!definition.name.trim()) issues.push({ code: "NAME_REQUIRED", message: "Give the workflow a name." });
  if (!trigger) issues.push({ code: "TRIGGER_UNKNOWN", message: "Choose a registered, versioned trigger." });
  if (!definition.steps.length) issues.push({ code: "STEPS_REQUIRED", message: "Add at least one action." });
  if (!Number.isInteger(definition.maximumRunsPerHour) || definition.maximumRunsPerHour < 1 || definition.maximumRunsPerHour > 10_000) {
    issues.push({ code: "RUN_CAP_INVALID", message: "The hourly run cap must be between 1 and 10,000." });
  }

  const ids = new Set<string>();
  let lastApprovalIndex = -2;
  let previousAction: ActionDescriptor | null = null;
  const validateAction = (step: ActionStep, index: number, isRejection = false) => {
    const action = actionCatalog.find((item) => item.id === step.actionId);
    if (!action) {
      issues.push({ code: "ACTION_UNKNOWN", message: "Choose a registered, versioned action.", stepId: step.id });
      return null;
    }
    risk = higherRisk(risk, action.risk);
    if (trigger && !action.subjectTypes.includes(trigger.subjectType)) {
      issues.push({ code: "SUBJECT_INCOMPATIBLE", message: `${action.label} does not accept ${trigger.subjectType} subjects.`, stepId: step.id });
    }
    for (const field of Object.keys(action.input)) {
      if (!(field in step.input)) issues.push({ code: "INPUT_REQUIRED", message: `${action.label} requires ${field}.`, stepId: step.id });
    }
    for (const value of Object.values(step.input)) {
      const field = eventBinding(value);
      if (field && trigger && !(field in trigger.output)) {
        issues.push({ code: "EVENT_FIELD_UNKNOWN", message: `The trigger does not provide ${field}.`, stepId: step.id });
      }
      for (const reference of referencesStep(value)) {
        const referencedIndex = definition.steps.findIndex((candidate) => candidate.id === reference);
        if (referencedIndex < 0 || referencedIndex >= index) {
          issues.push({ code: "STEP_REFERENCE_INVALID", message: `Step output ${reference} must come from an earlier step.`, stepId: step.id });
        }
      }
    }
    if (!isRejection && action.approvalRequired && lastApprovalIndex !== index - 1) {
      issues.push({ code: "EXACT_APPROVAL_REQUIRED", message: `${action.label} must immediately follow an exact approval step.`, stepId: step.id });
    }
    if (isRejection && !action.approvalRequired) {
      issues.push({ code: "REJECTION_ACTION_UNPROTECTED", message: "A rejection action must use an approval-protected contract.", stepId: step.id });
    }
    if (action.emittedEvent === definition.trigger.eventId) {
      issues.push({ code: "UNBOUNDED_LOOP", message: `${action.label} would immediately retrigger this workflow.`, stepId: step.id });
    }
    if (action.external && action.provider) {
      externalProviders.add(action.provider);
      if (trigger && !action.dataClasses.includes(trigger.dataClass)) {
        issues.push({ code: "DATA_BOUNDARY_DENIED", message: `${trigger.dataClass} data cannot be sent to ${action.product}.`, stepId: step.id });
      }
      if (!context.connectionAvailable?.(action.provider, step.connectionId)) {
        issues.push({ code: "CONNECTION_REQUIRED", message: `Install and connect ${action.product}, then select that connection.`, stepId: step.id });
      }
    }
    return action;
  };

  definition.steps.forEach((step, index) => {
    if (!step.id.trim() || ids.has(step.id)) issues.push({ code: "STEP_ID_INVALID", message: "Every step needs a unique ID.", stepId: step.id });
    ids.add(step.id);
    if (step.type === "approval") {
      lastApprovalIndex = index;
      if (!step.purpose.trim()) issues.push({ code: "APPROVAL_PURPOSE_REQUIRED", message: "Approval needs a specific business purpose.", stepId: step.id });
      if (!step.approverRoles.length) issues.push({ code: "APPROVER_REQUIRED", message: "Approval needs at least one eligible role.", stepId: step.id });
      if (step.onReject) {
        if (!step.onReject.id.trim() || ids.has(step.onReject.id)) issues.push({ code: "STEP_ID_INVALID", message: "Every step needs a unique ID, including rejection actions.", stepId: step.onReject.id });
        ids.add(step.onReject.id);
        validateAction(step.onReject, index, true);
      }
      return;
    }
    const action = validateAction(step, index);
    if (!action) return;
    if (previousAction?.emittedEvent === definition.trigger.eventId) {
      issues.push({ code: "CAUSATION_LOOP", message: "This sequence can consume its own output without a bounded stop condition.", stepId: step.id });
    }
    previousAction = action;
  });
  return { valid: issues.length === 0, issues, risk, externalProviders: [...externalProviders] };
}
