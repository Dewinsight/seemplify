import { api, json } from "@/lib/api";

export type JourneyPortfolioKind =
  "pain_point" | "opportunity" | "solution" | "initiative";
export type JourneyPortfolioLifecycle =
  | "draft"
  | "validated"
  | "approved"
  | "archived"
  | "planned"
  | "active"
  | "blocked"
  | "completed"
  | "cancelled";
export type JourneyPortfolioPriority = "low" | "medium" | "high" | "critical";
export type JourneyPortfolioRisk = "low" | "medium" | "high" | "unknown";
export type JourneyPortfolioFrequency =
  "rare" | "occasional" | "frequent" | "pervasive" | "unknown";

export interface JourneyPortfolioItem {
  id: string;
  kind: JourneyPortfolioKind;
  title: string;
  description: string;
  lifecycle: JourneyPortfolioLifecycle;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  priority: JourneyPortfolioPriority | null;
  risk: JourneyPortfolioRisk | null;
  severity: 1 | 2 | 3 | 4 | 5 | null;
  frequency: JourneyPortfolioFrequency | null;
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
  reviewState: "not_submitted" | "in_review" | "approved" | "changes_requested";
  latestReviewId: string | null;
  targetMetrics: Array<{
    metricId: string;
    metricDefinitionVersion: string;
    direction: "higher_is_better" | "lower_is_better";
    targetValue: number;
    unit: string;
  }>;
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
  latestScore?: number | null;
  usageCount?: number;
  evidenceCount?: number;
}

export interface JourneyPortfolioRelationship {
  id: string;
  type:
    | "pain_point_to_opportunity"
    | "opportunity_to_solution"
    | "solution_to_initiative";
  fromItemId: string;
  fromItemKind: Exclude<JourneyPortfolioKind, "initiative">;
  toItemId: string;
  toItemKind: Exclude<JourneyPortfolioKind, "pain_point">;
  createdByUserId: string | null;
  createdAt: string;
}

export interface JourneyPortfolioDependency {
  id: string;
  initiativeId: string;
  dependsOnInitiativeId: string;
  type: "finish_to_start" | "blocks";
  createdByUserId: string | null;
  createdAt: string;
}

export interface JourneyPortfolioPolicy {
  id: string;
  name: string;
  method: "rice" | "ice" | "weighted";
  state: "draft" | "active" | "retired";
  revision: number;
  currentVersionId: string;
  currentVersion: {
    id: string;
    policyId: string;
    versionNumber: number;
    method: "rice" | "ice" | "weighted";
    formulaVersion: "rice.v1" | "ice.v1" | "weighted.v1";
    configuration: Record<string, unknown>;
    configurationSha256: string;
    actorUserId: string | null;
    createdAt: string;
  };
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyPortfolioAssessment {
  id: string;
  itemId: string;
  itemRevision: number;
  policyVersionId: string;
  method: "rice" | "ice" | "weighted";
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  score: number | null;
  actorUserId: string | null;
  assessedAt: string;
}

export type JourneyPortfolioOperationalKind =
  "assistant_action" | "recovery_ticket";
export type JourneyPortfolioOperationalOutcome =
  "linked" | "succeeded" | "failed" | "cancelled" | "unknown";
export interface JourneyPortfolioOperationalLink {
  id: string;
  initiativeId: string;
  operationalKind: JourneyPortfolioOperationalKind;
  operationalId: string;
  relationship: "informs" | "supports" | "delivers_follow_up";
  outcomeState: JourneyPortfolioOperationalOutcome;
  outcomeDetail: Record<string, unknown>;
  revision: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface JourneyPortfolioObservationSnapshot {
  observationId: string;
  metricId: string;
  metricDefinitionVersion: string;
  calculationVersion: string;
  value: number;
  unit: string;
  numerator: number | null;
  denominator: number;
  sampleSize: number;
  period: { start: string; end: string; timezone: string };
  populationKey: string;
  filterKey: string;
  sourceRefs: string[];
}
export interface JourneyPortfolioBaseline {
  baselineVersion: "journey-initiative-baseline/v1";
  baselineId: string;
  initiativeId: string;
  initiativeRevision: number;
  capturedAt: string;
  capturedByUserId: string;
  target: JourneyPortfolioItem["targetMetrics"][number];
  observation: JourneyPortfolioObservationSnapshot;
  checksum: string;
}
export interface JourneyPortfolioOutcomeComparison {
  id: string;
  initiativeId: string;
  baselineId: string;
  baselineChecksum: string;
  afterObservation: JourneyPortfolioObservationSnapshot;
  comparison: {
    absoluteChange: number;
    relativeChangePercentage: number | null;
    directionalResult: "improved" | "unchanged" | "deteriorated";
    targetResult: "met" | "not_met";
    comparedAt: string;
    interpretation: { mode: "descriptive_before_after"; statement: string };
  };
  actorUserId: string | null;
  comparedAt: string;
}

export interface JourneyPortfolioItemDraft {
  kind: JourneyPortfolioKind;
  title: string;
  description: string;
  lifecycle: JourneyPortfolioLifecycle;
  ownerUserId?: string | null;
  ownerTeamId?: string | null;
  priority?: JourneyPortfolioPriority | null;
  risk?: JourneyPortfolioRisk | null;
  severity?: 1 | 2 | 3 | 4 | 5 | null;
  frequency?: JourneyPortfolioFrequency | null;
  desiredOutcome?: string | null;
  hypothesis?: string | null;
  constraints?: string[];
  estimatedEffort?: number | null;
  estimatedCost?: number | null;
  expectedOutcome?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  dueDate?: string | null;
  progressPercent?: number | null;
  reviewCadenceDays?: number | null;
  targetMetrics?: JourneyPortfolioItem["targetMetrics"];
  evidenceLinkIds?: string[];
  tags?: string[];
}

export interface JourneyPortfolioFilters {
  kind?: JourneyPortfolioKind;
  lifecycle?: JourneyPortfolioLifecycle;
  priority?: JourneyPortfolioPriority;
  risk?: JourneyPortfolioRisk;
  evidenceState?: "with_evidence" | "without_evidence";
  search?: string;
  sort?: "updated" | "priority" | "due" | "score";
  limit?: number;
  offset?: number;
}
export interface JourneyPortfolioSavedView {
  id: string;
  name: string;
  state: "active" | "deleted";
  revision: number;
  versionId: string;
  versionNumber: number;
  configuration: {
    presentation: "table" | "board" | "matrix";
    filters: Omit<JourneyPortfolioFilters, "limit" | "offset" | "sort">;
    sort: "updated" | "priority" | "due" | "score";
    columns: string[];
  };
  configurationSha256: string;
  createdAt: string;
  updatedAt: string;
}
export interface JourneyPortfolioTransitionRequest {
  id: string;
  itemId: string;
  itemKind: JourneyPortfolioKind;
  requestedItemRevision: number;
  fromLifecycle: JourneyPortfolioLifecycle;
  requestedTargetLifecycle: JourneyPortfolioLifecycle;
  status: "pending" | "applied" | "rejected" | "cancelled" | "superseded";
  reason: string;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  decisionReason: string | null;
  appliedItemRevision: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface JourneyPortfolioExecutiveReport {
  schemaVersion: "journey-portfolio-executive-report/v1";
  asOf: string;
  scope: { state: "active"; itemCount: number };
  items: {
    byKind: Array<{ key: string; count: number }>;
    byLifecycle: Array<{ key: string; count: number }>;
    withEvidence: number;
    scored: number;
  };
  initiatives: {
    total: number;
    owned: number;
    overdue: number;
    progressKnown: number;
    averageProgress: number | null;
    dependencies: number;
    initiativesWithBaseline: number;
    initiativesWithComparison: number;
    operationalLinks: number;
  };
  observedOutcomes: {
    directionalComparisons: Array<{ key: string; count: number }>;
    operationalOutcomes: Array<{ key: string; count: number }>;
  };
  interpretation: { mode: "descriptive_portfolio_snapshot"; statement: string };
}

function query<T extends object>(path: string, values: T) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    values as Record<string, unknown>,
  )) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function key(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function listJourneyPortfolioItems(
  filters: JourneyPortfolioFilters = {},
) {
  return api<{
    items: JourneyPortfolioItem[];
    page: { limit: number; offset: number; total: number; hasMore: boolean };
  }>(query("/api/journey-portfolio/items", filters));
}

export function readJourneyPortfolioExecutiveReport() {
  return api<{ report: JourneyPortfolioExecutiveReport }>(
    "/api/journey-portfolio/executive-report",
  );
}

export async function downloadJourneyPortfolioExecutiveReport() {
  const response = await fetch("/api/journey-portfolio/executive-report.csv", {
    credentials: "include",
  });
  if (!response.ok)
    throw new Error("The executive report could not be exported.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "journey-portfolio-executive-report.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function readJourneyPortfolioItem(itemId: string) {
  return api<{
    item: JourneyPortfolioItem;
    versions: Array<{
      id: string;
      revision: number;
      changeReason: string | null;
      actorUserId: string | null;
      createdAt: string;
    }>;
    reviews: Array<{
      id: string;
      itemRevision: number;
      decision: string;
      note: string;
      actorUserId: string | null;
      createdAt: string;
    }>;
    assessments: JourneyPortfolioAssessment[];
    journeyLinks: Array<{
      id: string;
      journeyDefinitionId: string;
      targetType: string;
      targetId: string;
      relationship: string;
      createdAt: string;
    }>;
    operationalLinks: JourneyPortfolioOperationalLink[];
    baselines: JourneyPortfolioBaseline[];
    outcomes: JourneyPortfolioOutcomeComparison[];
  }>(`/api/journey-portfolio/items/${encodeURIComponent(itemId)}`);
}

export function createJourneyPortfolioItem(draft: JourneyPortfolioItemDraft) {
  return api<{ item: JourneyPortfolioItem; replayed: boolean }>(
    "/api/journey-portfolio/items",
    json("POST", {
      draft,
      idempotencyKey: key("portfolio-item-create"),
    }),
  );
}

export function updateJourneyPortfolioItem(
  item: JourneyPortfolioItem,
  patch: Partial<JourneyPortfolioItemDraft>,
  changeReason?: string,
) {
  return api<{ item: JourneyPortfolioItem; replayed: boolean }>(
    `/api/journey-portfolio/items/${encodeURIComponent(item.id)}`,
    json("PATCH", {
      expectedRevision: item.revision,
      patch,
      changeReason: changeReason || null,
      idempotencyKey: key("portfolio-item-update"),
    }),
  );
}
export function listJourneyPortfolioSavedViews() {
  return api<{
    views: JourneyPortfolioSavedView[];
    defaultViewId: string | null;
    preferenceRevision: number;
  }>("/api/journey-portfolio/saved-views");
}
export function createJourneyPortfolioSavedView(
  name: string,
  configuration: JourneyPortfolioSavedView["configuration"],
  makeDefault = false,
) {
  return api<{ viewId: string; replayed: boolean }>(
    "/api/journey-portfolio/saved-views",
    json("POST", {
      name,
      configuration,
      makeDefault,
      idempotencyKey: key("portfolio-view-create"),
    }),
  );
}
export function reviseJourneyPortfolioSavedView(
  item: JourneyPortfolioSavedView,
  name: string,
  configuration: JourneyPortfolioSavedView["configuration"],
) {
  return api<{ viewId: string; replayed: boolean }>(
    `/api/journey-portfolio/saved-views/${encodeURIComponent(item.id)}`,
    json("PATCH", {
      expectedRevision: item.revision,
      name,
      configuration,
      idempotencyKey: key("portfolio-view-revise"),
    }),
  );
}
export function setJourneyPortfolioDefaultView(
  viewId: string | null,
  expectedRevision: number,
) {
  return api<{
    defaultViewId: string | null;
    preferenceRevision: number;
    replayed: boolean;
  }>(
    "/api/journey-portfolio/saved-views/default",
    json("PUT", {
      viewId,
      expectedRevision,
      idempotencyKey: key("portfolio-view-default"),
    }),
  );
}
export function listJourneyPortfolioTransitionRequests() {
  return api<{ requests: JourneyPortfolioTransitionRequest[] }>(
    "/api/journey-portfolio/transition-requests",
  ).then((value) => value.requests);
}
export function requestJourneyPortfolioTransition(
  item: JourneyPortfolioItem,
  targetLifecycle: JourneyPortfolioLifecycle,
  reason: string,
) {
  return api<{ request: JourneyPortfolioTransitionRequest; replayed: boolean }>(
    "/api/journey-portfolio/transition-requests",
    json("POST", {
      itemId: item.id,
      expectedItemRevision: item.revision,
      targetLifecycle,
      reason,
      idempotencyKey: key("portfolio-transition-request"),
    }),
  );
}
export function decideJourneyPortfolioTransition(
  item: JourneyPortfolioTransitionRequest,
  decision: "approve" | "reject",
  reason: string,
) {
  return api<{ request: JourneyPortfolioTransitionRequest; replayed: boolean }>(
    `/api/journey-portfolio/transition-requests/${encodeURIComponent(item.id)}/decision`,
    json("POST", {
      expectedRevision: item.revision,
      decision,
      reason,
      idempotencyKey: key("portfolio-transition-decision"),
    }),
  );
}
export function cancelJourneyPortfolioTransition(
  item: JourneyPortfolioTransitionRequest,
  reason: string,
) {
  return api<{ request: JourneyPortfolioTransitionRequest; replayed: boolean }>(
    `/api/journey-portfolio/transition-requests/${encodeURIComponent(item.id)}/cancel`,
    json("POST", {
      expectedRevision: item.revision,
      reason,
      idempotencyKey: key("portfolio-transition-cancel"),
    }),
  );
}

export function listJourneyPortfolioRelationships() {
  return api<{ relationships: JourneyPortfolioRelationship[] }>(
    "/api/journey-portfolio/relationships",
  );
}

export function createJourneyPortfolioRelationship(
  input: Pick<JourneyPortfolioRelationship, "type" | "fromItemId" | "toItemId">,
) {
  return api<{ relationship: JourneyPortfolioRelationship; replayed: boolean }>(
    "/api/journey-portfolio/relationships",
    json("POST", {
      ...input,
      idempotencyKey: key("portfolio-relationship-create"),
    }),
  );
}

export function deleteJourneyPortfolioRelationship(relationshipId: string) {
  return api<{ deleted: boolean; replayed: boolean }>(
    `/api/journey-portfolio/relationships/${encodeURIComponent(relationshipId)}`,
    json("DELETE", {
      idempotencyKey: key("portfolio-relationship-delete"),
    }),
  );
}

export function listJourneyPortfolioDependencies() {
  return api<{
    dependencies: JourneyPortfolioDependency[];
    analysis: { valid: boolean; cycles: string[][] };
  }>("/api/journey-portfolio/dependencies");
}

export function createJourneyPortfolioDependency(
  input: Pick<
    JourneyPortfolioDependency,
    "initiativeId" | "dependsOnInitiativeId" | "type"
  >,
) {
  return api<{ dependency: JourneyPortfolioDependency; replayed: boolean }>(
    "/api/journey-portfolio/dependencies",
    json("POST", {
      ...input,
      idempotencyKey: key("portfolio-dependency-create"),
    }),
  );
}

export function deleteJourneyPortfolioDependency(dependencyId: string) {
  return api<{ deleted: boolean; replayed: boolean }>(
    `/api/journey-portfolio/dependencies/${encodeURIComponent(dependencyId)}`,
    json("DELETE", {
      idempotencyKey: key("portfolio-dependency-delete"),
    }),
  );
}

export function listJourneyPortfolioPolicies() {
  return api<{ policies: JourneyPortfolioPolicy[] }>(
    "/api/journey-portfolio/policies",
  );
}

export function createJourneyPortfolioPolicy(input: {
  name: string;
  method: "rice" | "ice";
  state: "draft" | "active";
}) {
  return api<{ policy: JourneyPortfolioPolicy; replayed: boolean }>(
    "/api/journey-portfolio/policies",
    json("POST", {
      ...input,
      configuration: {},
      idempotencyKey: key("portfolio-policy-create"),
    }),
  );
}

export function assessJourneyPortfolioItem(input: {
  itemId: string;
  policyId: string;
  scoreInput: {
    reach: number;
    impact: number;
    confidence: number;
    effort?: number;
    ease?: number;
  };
}) {
  return api<{ assessment: JourneyPortfolioAssessment; replayed: boolean }>(
    "/api/journey-portfolio/assessments",
    json("POST", {
      ...input,
      idempotencyKey: key("portfolio-assessment-create"),
    }),
  );
}

export function createJourneyPortfolioOperationalLink(
  input: Pick<
    JourneyPortfolioOperationalLink,
    "initiativeId" | "operationalKind" | "operationalId" | "relationship"
  >,
) {
  return api<{
    operationalLink: JourneyPortfolioOperationalLink;
    replayed: boolean;
  }>(
    "/api/journey-portfolio/operational-links",
    json("POST", {
      ...input,
      idempotencyKey: key("portfolio-operational-link"),
    }),
  );
}

export function updateJourneyPortfolioOperationalOutcome(
  link: JourneyPortfolioOperationalLink,
  outcomeState: JourneyPortfolioOperationalOutcome,
  outcomeDetail: Record<string, unknown>,
) {
  return api<{ operationalLink: JourneyPortfolioOperationalLink }>(
    `/api/journey-portfolio/operational-links/${encodeURIComponent(link.id)}/outcome`,
    json("PATCH", {
      expectedRevision: link.revision,
      outcomeState,
      outcomeDetail,
    }),
  );
}

export function captureJourneyPortfolioBaseline(
  initiativeId: string,
  observationId: string,
) {
  return api<{ baseline: JourneyPortfolioBaseline; replayed: boolean }>(
    "/api/journey-portfolio/baselines",
    json("POST", {
      initiativeId,
      observationId,
      idempotencyKey: key("portfolio-baseline"),
    }),
  );
}

export function createJourneyPortfolioOutcome(
  baselineId: string,
  afterObservationId: string,
) {
  return api<{ outcome: JourneyPortfolioOutcomeComparison; replayed: boolean }>(
    "/api/journey-portfolio/outcomes",
    json("POST", {
      baselineId,
      afterObservationId,
      idempotencyKey: key("portfolio-outcome"),
    }),
  );
}
