export type RiskClass = "R0" | "R1" | "R2" | "R3";
export type DataClass = "public" | "internal" | "confidential" | "restricted";

export interface SessionActor {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: string;
  appIds: string[];
  permissions: string[];
}

export interface EventDescriptor {
  id: string;
  product: string;
  label: string;
  description: string;
  subjectType: string;
  schemaVersion: number;
  output: Record<string, "string" | "number" | "boolean" | "object">;
  dataClass: DataClass;
  externalEligible: boolean;
}

export interface ActionDescriptor {
  id: string;
  product: string;
  label: string;
  description: string;
  subjectTypes: string[];
  input: Record<string, "string" | "number" | "boolean" | "object">;
  risk: RiskClass;
  requiredRoles: string[];
  requiredApps: string[];
  approvalRequired: boolean;
  makerChecker: boolean;
  external: boolean;
  provider?: string;
  emittedEvent?: string;
  dataClasses: DataClass[];
  idempotent: boolean;
}

export interface EventEnvelope {
  id: string;
  name: string;
  schemaVersion: number;
  organizationId: string;
  actorId: string;
  subjectType: string;
  subjectId: string;
  subjectRevision: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  dataClass: DataClass;
  payload: Record<string, unknown>;
}

export type ValueBinding = unknown;

export interface ActionStep {
  id: string;
  type: "action";
  actionId: string;
  input: Record<string, ValueBinding>;
  connectionId?: string;
}

export interface ApprovalStep {
  id: string;
  type: "approval";
  purpose: string;
  approverRoles: string[];
  expiresInHours: number;
  /** Optional authoritative action to execute when the reviewer rejects. */
  onReject?: ActionStep;
}

export type WorkflowStep = ActionStep | ApprovalStep;

export interface WorkflowDefinition {
  name: string;
  description: string;
  trigger: { eventId: string };
  steps: WorkflowStep[];
  enabled: boolean;
  maximumRunsPerHour: number;
}

export interface CompileIssue {
  code: string;
  message: string;
  stepId?: string;
}

export interface CompileResult {
  valid: boolean;
  issues: CompileIssue[];
  risk: RiskClass;
  externalProviders: string[];
}

export interface RecipeTemplate {
  id: string;
  category: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
}
