import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  BarChart3,
  Download,
  GitBranch,
  LayoutGrid,
  List,
  LoaderCircle,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession, useSessionFeature } from "@/lib/authSessionContext";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  assessJourneyPortfolioItem,
  cancelJourneyPortfolioTransition,
  captureJourneyPortfolioBaseline,
  createJourneyPortfolioOperationalLink,
  createJourneyPortfolioOutcome,
  createJourneyPortfolioDependency,
  createJourneyPortfolioItem,
  createJourneyPortfolioPolicy,
  createJourneyPortfolioRelationship,
  createJourneyPortfolioSavedView,
  decideJourneyPortfolioTransition,
  deleteJourneyPortfolioDependency,
  deleteJourneyPortfolioRelationship,
  downloadJourneyPortfolioExecutiveReport,
  listJourneyPortfolioDependencies,
  listJourneyPortfolioItems,
  listJourneyPortfolioPolicies,
  listJourneyPortfolioRelationships,
  listJourneyPortfolioSavedViews,
  listJourneyPortfolioTransitionRequests,
  readJourneyPortfolioItem,
  readJourneyPortfolioExecutiveReport,
  updateJourneyPortfolioItem,
  updateJourneyPortfolioOperationalOutcome,
  requestJourneyPortfolioTransition,
  reviseJourneyPortfolioSavedView,
  setJourneyPortfolioDefaultView,
  type JourneyPortfolioBaseline,
  type JourneyPortfolioDependency,
  type JourneyPortfolioFilters,
  type JourneyPortfolioExecutiveReport,
  type JourneyPortfolioItem,
  type JourneyPortfolioItemDraft,
  type JourneyPortfolioKind,
  type JourneyPortfolioPolicy,
  type JourneyPortfolioOperationalKind,
  type JourneyPortfolioOperationalLink,
  type JourneyPortfolioOperationalOutcome,
  type JourneyPortfolioPriority,
  type JourneyPortfolioRelationship,
  type JourneyPortfolioRisk,
  type JourneyPortfolioSavedView,
  type JourneyPortfolioTransitionRequest,
} from "@/lib/journeyPortfolio";

type PortfolioView = "table" | "board" | "matrix" | "relationships" | "report";

const kindLabels: Record<JourneyPortfolioKind, string> = {
  pain_point: "Pain point",
  opportunity: "Opportunity",
  solution: "Solution",
  initiative: "Initiative",
};
const kindPluralLabels: Record<JourneyPortfolioKind, string> = {
  pain_point: "Pain points",
  opportunity: "Opportunities",
  solution: "Solutions",
  initiative: "Initiatives",
};
const kindOrder: JourneyPortfolioKind[] = [
  "pain_point",
  "opportunity",
  "solution",
  "initiative",
];
const priorityOrder: JourneyPortfolioPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];
const riskOrder: JourneyPortfolioRisk[] = ["high", "medium", "low", "unknown"];
const relationshipLabels: Record<JourneyPortfolioRelationship["type"], string> =
  {
    pain_point_to_opportunity: "Pain point → opportunity",
    opportunity_to_solution: "Opportunity → solution",
    solution_to_initiative: "Solution → initiative",
  };

function message(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function createDraft(input: ItemEditorState): JourneyPortfolioItemDraft {
  const base: JourneyPortfolioItemDraft = {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description.trim(),
    lifecycle: input.kind === "initiative" ? "planned" : "draft",
    ownerUserId: null,
    ownerTeamId: null,
    priority: input.kind === "initiative" ? input.priority : null,
    risk:
      input.kind === "solution" || input.kind === "initiative"
        ? input.risk
        : null,
    severity: input.kind === "pain_point" ? input.severity : null,
    frequency: input.kind === "pain_point" ? input.frequency : null,
    desiredOutcome: input.kind === "opportunity" ? input.outcome.trim() : null,
    hypothesis: input.kind === "solution" ? input.outcome.trim() : null,
    constraints: [],
    estimatedEffort: input.kind === "solution" ? input.effort : null,
    estimatedCost: null,
    expectedOutcome: input.kind === "initiative" ? input.outcome.trim() : null,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    dueDate: input.kind === "initiative" ? input.dueDate || null : null,
    progressPercent: input.kind === "initiative" ? 0 : null,
    reviewCadenceDays: input.kind === "initiative" ? 30 : null,
    targetMetrics: [],
    evidenceLinkIds: [],
    tags: input.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
  return base;
}

function updatePatch(
  input: ItemEditorState,
): Partial<JourneyPortfolioItemDraft> {
  const common: Partial<JourneyPortfolioItemDraft> = {
    title: input.title.trim(),
    description: input.description.trim(),
    tags: input.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
  if (input.kind === "pain_point")
    return { ...common, severity: input.severity, frequency: input.frequency };
  if (input.kind === "opportunity")
    return { ...common, desiredOutcome: input.outcome.trim() };
  if (input.kind === "solution")
    return {
      ...common,
      hypothesis: input.outcome.trim(),
      risk: input.risk,
      estimatedEffort: input.effort,
    };
  return {
    ...common,
    expectedOutcome: input.outcome.trim(),
    priority: input.priority,
    risk: input.risk,
    dueDate: input.dueDate || null,
  };
}

type ItemEditorState = {
  kind: JourneyPortfolioKind;
  title: string;
  description: string;
  priority: JourneyPortfolioPriority;
  risk: JourneyPortfolioRisk;
  severity: 1 | 2 | 3 | 4 | 5;
  frequency: "rare" | "occasional" | "frequent" | "pervasive" | "unknown";
  outcome: string;
  effort: number | null;
  dueDate: string;
  tags: string;
};

const emptyEditor: ItemEditorState = {
  kind: "pain_point",
  title: "",
  description: "",
  priority: "medium",
  risk: "unknown",
  severity: 3,
  frequency: "unknown",
  outcome: "",
  effort: null,
  dueDate: "",
  tags: "",
};

function InitiativeEvidence({
  item,
  detail,
  canManage,
  onChanged,
}: {
  item: JourneyPortfolioItem;
  detail: Awaited<ReturnType<typeof readJourneyPortfolioItem>>;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] =
    useState<JourneyPortfolioOperationalKind>("assistant_action");
  const [operationalId, setOperationalId] = useState("");
  const [relationship, setRelationship] =
    useState<JourneyPortfolioOperationalLink["relationship"]>("supports");
  const [observationId, setObservationId] = useState("");
  const [baselineId, setBaselineId] = useState(
    detail.baselines[0]?.baselineId || "",
  );
  const [afterObservationId, setAfterObservationId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  useEffect(() => {
    if (!baselineId && detail.baselines[0])
      setBaselineId(detail.baselines[0].baselineId);
  }, [baselineId, detail.baselines]);
  async function run(name: string, action: () => Promise<unknown>) {
    try {
      setBusy(name);
      setError("");
      setConflict("");
      await action();
      await onChanged();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409)
        setConflict(`${reason.message} Reloaded the latest audit record.`);
      else
        setError(
          message(reason, "The initiative evidence change could not be saved."),
        );
      if (reason instanceof ApiError && reason.status === 409)
        await onChanged();
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      className="space-y-4 border-t pt-4"
      data-testid="initiative-evidence"
    >
      <div>
        <h2 className="text-sm font-semibold">Operational evidence</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Links retain the exact operational record, relationship, revision, and
          audit attribution.
        </p>
      </div>
      {(error || conflict) && (
        <div
          role="alert"
          className="border border-destructive/30 px-3 py-2 text-sm text-destructive"
        >
          {conflict || error}
        </div>
      )}
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_170px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void run("link", async () => {
              await createJourneyPortfolioOperationalLink({
                initiativeId: item.id,
                operationalKind: kind,
                operationalId: operationalId.trim(),
                relationship,
              });
              setOperationalId("");
            });
          }}
        >
          <select
            aria-label="Operational record type"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as JourneyPortfolioOperationalKind)
            }
          >
            <option value="assistant_action">Assistant action</option>
            <option value="recovery_ticket">Recovery ticket</option>
          </select>
          <Input
            aria-label="Operational record ID"
            required
            placeholder="Exact record ID"
            value={operationalId}
            onChange={(event) => setOperationalId(event.target.value)}
          />
          <select
            aria-label="Operational relationship"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={relationship}
            onChange={(event) =>
              setRelationship(
                event.target
                  .value as JourneyPortfolioOperationalLink["relationship"],
              )
            }
          >
            <option value="informs">Informs</option>
            <option value="supports">Supports</option>
            <option value="delivers_follow_up">Delivers follow-up</option>
          </select>
          <Button size="sm" disabled={Boolean(busy)}>
            {busy === "link" && <LoaderCircle className="animate-spin" />}Link
          </Button>
        </form>
      )}
      {detail.operationalLinks.length ? (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <caption className="sr-only">Operational evidence links</caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Relationship</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {detail.operationalLinks.map((link) => (
                <OperationalRow
                  key={link.id}
                  link={link}
                  canManage={canManage}
                  busy={Boolean(busy)}
                  onUpdate={(state, note) =>
                    run(`outcome-${link.id}`, () =>
                      updateJourneyPortfolioOperationalOutcome(
                        link,
                        state,
                        note ? { note } : {},
                      ),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border px-3 py-5 text-sm text-muted-foreground">
          No assistant action or recovery ticket is linked.
        </p>
      )}
      <div>
        <h2 className="text-sm font-semibold">Before and after measurement</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only persisted metric observations are accepted. Comparisons preserve
          exact definition versions, windows, samples, checksums, and
          non-causation language.
        </p>
      </div>
      {canManage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <form
            className="grid gap-2 border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run("baseline", async () => {
                const result = await captureJourneyPortfolioBaseline(
                  item.id,
                  observationId.trim(),
                );
                setBaselineId(result.baseline.baselineId);
                setObservationId("");
              });
            }}
          >
            <Label htmlFor="baseline-observation">
              Baseline observation ID
            </Label>
            <Input
              id="baseline-observation"
              required
              placeholder="Exact persisted observation ID"
              value={observationId}
              onChange={(event) => setObservationId(event.target.value)}
            />
            <Button
              size="sm"
              className="justify-self-start"
              disabled={Boolean(busy)}
            >
              {busy === "baseline" && <LoaderCircle className="animate-spin" />}
              Capture baseline
            </Button>
          </form>
          <form
            className="grid gap-2 border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run("comparison", async () => {
                await createJourneyPortfolioOutcome(
                  baselineId,
                  afterObservationId.trim(),
                );
                setAfterObservationId("");
              });
            }}
          >
            <Label htmlFor="comparison-baseline">Immutable baseline</Label>
            <select
              id="comparison-baseline"
              required
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={baselineId}
              onChange={(event) => setBaselineId(event.target.value)}
            >
              <option value="">Choose baseline</option>
              {detail.baselines.map((baseline) => (
                <option key={baseline.baselineId} value={baseline.baselineId}>
                  {baseline.observation.metricId} ·{" "}
                  {displayDate(baseline.capturedAt)}
                </option>
              ))}
            </select>
            <Label htmlFor="after-observation">After observation ID</Label>
            <Input
              id="after-observation"
              required
              placeholder="Exact persisted observation ID"
              value={afterObservationId}
              onChange={(event) => setAfterObservationId(event.target.value)}
            />
            <Button
              size="sm"
              className="justify-self-start"
              disabled={Boolean(busy) || !baselineId}
            >
              {busy === "comparison" && (
                <LoaderCircle className="animate-spin" />
              )}
              Compare outcome
            </Button>
          </form>
        </div>
      )}
      <MeasurementHistory
        baselines={detail.baselines}
        outcomes={detail.outcomes}
      />
    </section>
  );
}

function OperationalRow({
  link,
  canManage,
  busy,
  onUpdate,
}: {
  link: JourneyPortfolioOperationalLink;
  canManage: boolean;
  busy: boolean;
  onUpdate: (
    state: JourneyPortfolioOperationalOutcome,
    note: string,
  ) => Promise<void>;
}) {
  const [state, setState] = useState<JourneyPortfolioOperationalOutcome>(
    link.outcomeState,
  );
  const [note, setNote] = useState("");
  useEffect(() => setState(link.outcomeState), [link.outcomeState]);
  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-medium">
          {link.operationalKind.replace("_", " ")}
        </span>
        <div className="font-mono text-xs text-muted-foreground">
          {link.operationalId}
        </div>
      </td>
      <td className="px-3 py-2">{link.relationship.replaceAll("_", " ")}</td>
      <td className="px-3 py-2">
        {canManage ? (
          <div className="flex min-w-[260px] gap-2">
            <select
              aria-label={`Outcome for ${link.operationalId}`}
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={state}
              onChange={(event) =>
                setState(
                  event.target.value as JourneyPortfolioOperationalOutcome,
                )
              }
            >
              {["linked", "succeeded", "failed", "cancelled", "unknown"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
            <Input
              aria-label={`Outcome note for ${link.operationalId}`}
              className="h-8"
              maxLength={2000}
              placeholder="Audit note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onUpdate(state, note)}
            >
              Save
            </Button>
          </div>
        ) : (
          link.outcomeState
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        Revision {link.revision}
        <br />
        Created {displayDate(link.createdAt)}
        <br />
        Updated {displayDate(link.updatedAt)}
      </td>
    </tr>
  );
}

function MeasurementHistory({
  baselines,
  outcomes,
}: {
  baselines: JourneyPortfolioBaseline[];
  outcomes: Awaited<ReturnType<typeof readJourneyPortfolioItem>>["outcomes"];
}) {
  if (!baselines.length)
    return (
      <p className="border px-3 py-5 text-sm text-muted-foreground">
        No immutable baseline has been captured.
      </p>
    );
  return (
    <div className="space-y-3">
      {baselines.map((baseline) => {
        const comparisons = outcomes.filter(
          (outcome) => outcome.baselineId === baseline.baselineId,
        );
        return (
          <div key={baseline.baselineId} className="border p-3">
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground">Metric/version</span>
                <div className="font-mono text-xs">
                  {baseline.observation.metricId}
                  <br />
                  {baseline.observation.metricDefinitionVersion}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Baseline window</span>
                <div>
                  {displayDate(baseline.observation.period.start)} –{" "}
                  {displayDate(baseline.observation.period.end)}
                </div>
                <div>
                  {baseline.observation.value} {baseline.observation.unit} ·
                  sample {baseline.observation.sampleSize}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Integrity</span>
                <div>Initiative revision {baseline.initiativeRevision}</div>
                <div
                  className="truncate font-mono text-xs"
                  title={baseline.checksum}
                >
                  {baseline.checksum}
                </div>
              </div>
            </div>
            {comparisons.length ? (
              <ul className="mt-3 divide-y border-t">
                {comparisons.map((outcome) => (
                  <li key={outcome.id} className="py-3 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <strong>{outcome.comparison.directionalResult}</strong>
                      <span>
                        Change {outcome.comparison.absoluteChange}{" "}
                        {outcome.afterObservation.unit}
                      </span>
                      <span>
                        Target{" "}
                        {outcome.comparison.targetResult.replace("_", " ")}
                      </span>
                      <span>
                        After sample {outcome.afterObservation.sampleSize}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {outcome.comparison.interpretation.statement}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                No after observation has been compared.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function editorFromItem(item: JourneyPortfolioItem): ItemEditorState {
  return {
    kind: item.kind,
    title: item.title,
    description: item.description,
    priority: item.priority || "medium",
    risk: item.risk || "unknown",
    severity: item.severity || 3,
    frequency: item.frequency || "unknown",
    outcome:
      item.desiredOutcome || item.hypothesis || item.expectedOutcome || "",
    effort: item.estimatedEffort,
    dueDate: item.dueDate || "",
    tags: item.tags.join(", "),
  };
}

function ItemEditor({
  open,
  item,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  item: JourneyPortfolioItem | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: ItemEditorState) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ItemEditorState>(emptyEditor);
  useEffect(() => {
    if (open) setDraft(item ? editorFromItem(item) : emptyEditor);
  }, [item, open]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(draft);
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit portfolio item" : "New portfolio item"}
          </DialogTitle>
          <DialogDescription>
            Keep the canonical record concise. Evidence and journey usage remain
            linked separately.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="portfolio-kind">Type</Label>
              <select
                id="portfolio-kind"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={draft.kind}
                disabled={Boolean(item)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kind: event.target.value as JourneyPortfolioKind,
                  })
                }
              >
                {kindOrder.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabels[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="portfolio-title">Title</Label>
              <Input
                id="portfolio-title"
                value={draft.title}
                maxLength={200}
                required
                autoFocus
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portfolio-description">Description</Label>
            <Textarea
              id="portfolio-description"
              rows={4}
              maxLength={10_000}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </div>
          {(draft.kind === "opportunity" ||
            draft.kind === "solution" ||
            draft.kind === "initiative") && (
            <div className="grid gap-1.5">
              <Label htmlFor="portfolio-outcome">
                {draft.kind === "opportunity"
                  ? "Desired outcome"
                  : draft.kind === "solution"
                    ? "Hypothesis"
                    : "Expected outcome"}
              </Label>
              <Textarea
                id="portfolio-outcome"
                rows={2}
                required
                value={draft.outcome}
                onChange={(event) =>
                  setDraft({ ...draft, outcome: event.target.value })
                }
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {draft.kind === "pain_point" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="portfolio-severity">Severity</Label>
                  <select
                    id="portfolio-severity"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.severity}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        severity: Number(
                          event.target.value,
                        ) as ItemEditorState["severity"],
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="portfolio-frequency">Frequency</Label>
                  <select
                    id="portfolio-frequency"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.frequency}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        frequency: event.target
                          .value as ItemEditorState["frequency"],
                      })
                    }
                  >
                    {[
                      "unknown",
                      "rare",
                      "occasional",
                      "frequent",
                      "pervasive",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {(draft.kind === "solution" || draft.kind === "initiative") && (
              <div className="grid gap-1.5">
                <Label htmlFor="portfolio-risk">Risk</Label>
                <select
                  id="portfolio-risk"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={draft.risk}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      risk: event.target.value as JourneyPortfolioRisk,
                    })
                  }
                >
                  {["unknown", "low", "medium", "high"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            )}
            {draft.kind === "initiative" && (
              <div className="grid gap-1.5">
                <Label htmlFor="portfolio-priority">Priority</Label>
                <select
                  id="portfolio-priority"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      priority: event.target.value as JourneyPortfolioPriority,
                    })
                  }
                >
                  {["low", "medium", "high", "critical"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            )}
            {draft.kind === "solution" && (
              <div className="grid gap-1.5">
                <Label htmlFor="portfolio-effort">Estimated effort</Label>
                <Input
                  id="portfolio-effort"
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.effort ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      effort:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </div>
            )}
            {draft.kind === "initiative" && (
              <div className="grid gap-1.5">
                <Label htmlFor="portfolio-due">Due date</Label>
                <Input
                  id="portfolio-due"
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) =>
                    setDraft({ ...draft, dueDate: event.target.value })
                  }
                />
              </div>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portfolio-tags">Tags</Label>
            <Input
              id="portfolio-tags"
              value={draft.tags}
              placeholder="retention, mobile, onboarding"
              onChange={(event) =>
                setDraft({ ...draft, tags: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !draft.title.trim()}>
              {busy && <LoaderCircle className="animate-spin" />}
              {item ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ItemDetail({
  item,
  policies,
  canManage,
  onClose,
  onEdit,
  onScored,
}: {
  item: JourneyPortfolioItem | null;
  policies: JourneyPortfolioPolicy[];
  canManage: boolean;
  onClose: () => void;
  onEdit: (item: JourneyPortfolioItem) => void;
  onScored: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof readJourneyPortfolioItem>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [score, setScore] = useState({
    reach: 10,
    impact: 2,
    confidence: 0.8,
    effort: 2,
    ease: 5,
  });
  useEffect(() => {
    setDetail(null);
    setError("");
    if (!item) return;
    void readJourneyPortfolioItem(item.id)
      .then(setDetail)
      .catch((reason) =>
        setError(message(reason, "Item details could not be loaded.")),
      );
  }, [item]);
  const activePolicies = policies.filter((policy) => policy.state === "active");
  useEffect(() => {
    if (!policyId && activePolicies[0]) setPolicyId(activePolicies[0].id);
  }, [activePolicies, policyId]);
  async function assess() {
    if (!item || !policyId) return;
    try {
      setBusy(true);
      setError("");
      const policy = policies.find((entry) => entry.id === policyId);
      const scoreInput =
        policy?.method === "ice"
          ? {
              reach: score.reach,
              impact: score.impact,
              confidence: score.confidence,
              ease: score.ease,
            }
          : {
              reach: score.reach,
              impact: score.impact,
              confidence: score.confidence,
              effort: score.effort,
            };
      await assessJourneyPortfolioItem({
        itemId: item.id,
        policyId,
        scoreInput,
      });
      setDetail(await readJourneyPortfolioItem(item.id));
      await onScored();
    } catch (reason) {
      setError(message(reason, "Priority could not be assessed."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{item.title}</DialogTitle>
              <DialogDescription>
                {kindLabels[item.kind]} · {item.lifecycle.replaceAll("_", " ")}{" "}
                · revision {item.revision}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <div
                className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0 space-y-5">
                <section>
                  <h2 className="text-sm font-semibold">Description</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.description || "No description."}
                  </p>
                </section>
                <section>
                  <h2 className="text-sm font-semibold">Evidence and usage</h2>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Evidence links</dt>
                      <dd className="font-medium">
                        {item.evidenceCount ?? item.evidenceLinkIds.length}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Journey usage</dt>
                      <dd className="font-medium">
                        {item.usageCount ?? detail?.journeyLinks.length ?? 0}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <h2 className="text-sm font-semibold">Assessment history</h2>
                  {!detail ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Loading history…
                    </p>
                  ) : detail.assessments.length ? (
                    <table className="mt-2 w-full text-left text-sm">
                      <caption className="sr-only">
                        Priority assessment history
                      </caption>
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="py-2 font-medium">Method</th>
                          <th className="py-2 font-medium">Score</th>
                          <th className="py-2 font-medium">Assessed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {detail.assessments.map((assessment) => (
                          <tr key={assessment.id}>
                            <td className="py-2 uppercase">
                              {assessment.method}
                            </td>
                            <td className="py-2 tabular-nums">
                              {assessment.score?.toFixed(2) ?? "Incomplete"}
                            </td>
                            <td className="py-2">
                              {displayDate(assessment.assessedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No priority assessment has been recorded.
                    </p>
                  )}
                </section>
              </div>
              <aside className="border-l pl-4">
                <h2 className="text-sm font-semibold">Item details</h2>
                <dl className="mt-3 space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd className="mt-0.5 capitalize">
                      {item.priority || "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Risk</dt>
                    <dd className="mt-0.5 capitalize">
                      {item.risk || "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Due</dt>
                    <dd className="mt-0.5">{displayDate(item.dueDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Tags</dt>
                    <dd className="mt-0.5">{item.tags.join(", ") || "None"}</dd>
                  </div>
                </dl>
              </aside>
            </div>
            {canManage &&
              (item.kind === "opportunity" || item.kind === "initiative") && (
                <section className="border-t pt-4">
                  <h2 className="text-sm font-semibold">Assess priority</h2>
                  {activePolicies.length ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-6">
                      <select
                        aria-label="Scoring policy"
                        className="h-9 rounded-md border bg-background px-2 text-sm sm:col-span-2"
                        value={policyId}
                        onChange={(event) => setPolicyId(event.target.value)}
                      >
                        {activePolicies.map((policy) => (
                          <option key={policy.id} value={policy.id}>
                            {policy.name} ({policy.method.toUpperCase()})
                          </option>
                        ))}
                      </select>
                      {(
                        [
                          "reach",
                          "impact",
                          "confidence",
                          policies.find((policy) => policy.id === policyId)
                            ?.method === "ice"
                            ? "ease"
                            : "effort",
                        ] as const
                      ).map((field) => (
                        <Input
                          key={field}
                          aria-label={field}
                          type="number"
                          min="0"
                          step={field === "confidence" ? "0.05" : "0.1"}
                          value={score[field]}
                          onChange={(event) =>
                            setScore({
                              ...score,
                              [field]: Number(event.target.value),
                            })
                          }
                        />
                      ))}
                      <Button
                        size="sm"
                        onClick={() => void assess()}
                        disabled={busy}
                      >
                        {busy && <LoaderCircle className="animate-spin" />}
                        Assess
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Create and activate a scoring policy in the relationship
                      view first.
                    </p>
                  )}
                </section>
              )}
            {item.kind === "initiative" && detail && (
              <InitiativeEvidence
                item={item}
                detail={detail}
                canManage={canManage}
                onChanged={async () => {
                  setDetail(await readJourneyPortfolioItem(item.id));
                  await onScored();
                }}
              />
            )}
            <DialogFooter>
              {canManage && (
                <Button variant="outline" onClick={() => onEdit(item)}>
                  <Pencil />
                  Edit
                </Button>
              )}
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PortfolioTable({
  items,
  onOpen,
}: {
  items: JourneyPortfolioItem[];
  onOpen: (item: JourneyPortfolioItem) => void;
}) {
  return (
    <div
      className="overflow-x-auto border"
      data-testid="journey-portfolio-table"
    >
      <table className="w-full min-w-[900px] text-left text-sm">
        <caption className="sr-only">Journey portfolio items</caption>
        <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">Item</th>
            <th className="px-3 py-2.5 font-medium">Type</th>
            <th className="px-3 py-2.5 font-medium">State</th>
            <th className="px-3 py-2.5 font-medium">Priority</th>
            <th className="px-3 py-2.5 font-medium">Score</th>
            <th className="px-3 py-2.5 font-medium">Evidence</th>
            <th className="px-3 py-2.5 font-medium">Journeys</th>
            <th className="px-3 py-2.5 font-medium">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted/20">
              <td className="max-w-[360px] px-3 py-3">
                <button
                  className="text-left font-medium hover:underline"
                  onClick={() => onOpen(item)}
                >
                  {item.title}
                </button>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.description || "No description"}
                </p>
              </td>
              <td className="px-3 py-3">{kindLabels[item.kind]}</td>
              <td className="px-3 py-3 capitalize">
                {item.lifecycle.replaceAll("_", " ")}
              </td>
              <td className="px-3 py-3 capitalize">{item.priority || "—"}</td>
              <td className="px-3 py-3 tabular-nums">
                {item.latestScore?.toFixed(2) ?? "—"}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {item.evidenceCount ?? 0}
              </td>
              <td className="px-3 py-3 tabular-nums">{item.usageCount ?? 0}</td>
              <td className="px-3 py-3">{displayDate(item.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const boardTransitions: Partial<
  Record<JourneyPortfolioItem["lifecycle"], JourneyPortfolioItem["lifecycle"][]>
> = {
  draft: ["validated", "planned", "cancelled", "archived"],
  validated: ["draft", "archived"],
  approved: ["validated", "archived"],
  planned: ["draft", "cancelled"],
  active: ["cancelled"],
  blocked: ["cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
};

function PortfolioBoard({
  items,
  canManage,
  busy,
  onOpen,
  onMove,
}: {
  items: JourneyPortfolioItem[];
  canManage: boolean;
  busy: boolean;
  onOpen: (item: JourneyPortfolioItem) => void;
  onMove: (
    item: JourneyPortfolioItem,
    lifecycle: JourneyPortfolioItem["lifecycle"],
  ) => Promise<void>;
}) {
  const groups = [
    {
      label: "Insights",
      lifecycles: ["draft", "validated", "approved", "archived"] as const,
      accepts: (item: JourneyPortfolioItem) => item.kind !== "initiative",
    },
    {
      label: "Initiatives",
      lifecycles: [
        "draft",
        "planned",
        "active",
        "blocked",
        "completed",
        "cancelled",
        "archived",
      ] as const,
      accepts: (item: JourneyPortfolioItem) => item.kind === "initiative",
    },
  ];
  return (
    <div className="space-y-5" data-testid="journey-portfolio-board">
      {groups.map((group) => (
        <section key={group.label}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">{group.label}</h2>
            <p className="text-xs text-muted-foreground">
              Status reflects the canonical lifecycle.
            </p>
          </div>
          <div className="overflow-x-auto border">
            <div className="grid min-w-max auto-cols-[260px] grid-flow-col divide-x">
              {group.lifecycles.map((lifecycle) => {
                const rows = items.filter(
                  (item) => group.accepts(item) && item.lifecycle === lifecycle,
                );
                return (
                  <section key={lifecycle} className="w-[260px] bg-muted/10">
                    <header className="flex items-center justify-between border-b px-3 py-2.5">
                      <h3 className="text-sm font-medium capitalize">
                        {lifecycle}
                      </h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {rows.length}
                      </span>
                    </header>
                    <div className="divide-y">
                      {rows.map((item) => {
                        const next = (
                          boardTransitions[item.lifecycle] || []
                        ).filter((value) =>
                          item.kind === "initiative"
                            ? !["validated", "approved"].includes(value)
                            : ![
                                "planned",
                                "active",
                                "blocked",
                                "completed",
                                "cancelled",
                              ].includes(value),
                        );
                        return (
                          <article
                            key={item.id}
                            className="bg-background px-3 py-3"
                          >
                            <button
                              className="block w-full text-left font-medium hover:underline"
                              onClick={() => onOpen(item)}
                            >
                              {item.title}
                            </button>
                            <div className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
                              <span>{kindLabels[item.kind]}</span>
                              <span>
                                {item.latestScore?.toFixed(1) ?? "Not scored"}
                              </span>
                            </div>
                            {canManage && next.length > 0 && (
                              <label className="mt-3 block text-xs text-muted-foreground">
                                Request status
                                <select
                                  aria-label={`Request status for ${item.title}`}
                                  className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                                  value=""
                                  disabled={busy}
                                  onChange={(event) => {
                                    const value = event.target
                                      .value as JourneyPortfolioItem["lifecycle"];
                                    if (value) void onMove(item, value);
                                  }}
                                >
                                  <option value="">Choose status</option>
                                  {next.map((value) => (
                                    <option key={value} value={value}>
                                      {value.replaceAll("_", " ")}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </article>
                        );
                      })}
                      {!rows.length && (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                          No items
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        A requested status never changes the item until a different authorised
        manager approves the exact item revision and target.
      </p>
    </div>
  );
}

function SavedViewToolbar({
  saved,
  defaultViewId,
  preferenceRevision,
  filters,
  presentation,
  busy,
  onReload,
  onApply,
}: {
  saved: JourneyPortfolioSavedView[];
  defaultViewId: string | null;
  preferenceRevision: number;
  filters: JourneyPortfolioFilters;
  presentation: PortfolioView;
  busy: boolean;
  onReload: () => Promise<void>;
  onApply: (view: JourneyPortfolioSavedView) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const selected = saved.find((item) => item.id === selectedId) || null;
  const configuration = {
    presentation: (["table", "board", "matrix"].includes(presentation)
      ? presentation
      : "table") as "table" | "board" | "matrix",
    filters: Object.fromEntries(
      Object.entries(filters).filter(
        ([key, value]) =>
          !["limit", "offset", "sort"].includes(key) && value !== undefined,
      ),
    ),
    sort: filters.sort || "updated",
    columns: [
      "item",
      "type",
      "state",
      "priority",
      "score",
      "evidence",
      "journeys",
      "due",
    ],
  };
  return (
    <section className="border" aria-label="Saved portfolio views">
      <div className="grid gap-2 p-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto_auto_auto]">
        <select
          aria-label="Saved view"
          className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            const item = saved.find((row) => row.id === event.target.value);
            if (item) {
              setName(item.name);
              onApply(item);
            }
          }}
        >
          <option value="">Current unsaved view</option>
          {saved.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.id === defaultViewId ? " (default)" : ""}
            </option>
          ))}
        </select>
        <Input
          aria-label="Saved view name"
          maxLength={160}
          placeholder="View name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !name.trim()}
          onClick={() =>
            void (
              selected
                ? reviseJourneyPortfolioSavedView(
                    selected,
                    name.trim(),
                    configuration,
                  )
                : createJourneyPortfolioSavedView(name.trim(), configuration)
            ).then(onReload)
          }
        >
          {" "}
          {selected ? "Save revision" : "Save view"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !selected}
          onClick={() =>
            void setJourneyPortfolioDefaultView(
              selected?.id || null,
              preferenceRevision,
            ).then(onReload)
          }
        >
          {selected?.id === defaultViewId ? "Default" : "Set default"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !defaultViewId}
          onClick={() =>
            void setJourneyPortfolioDefaultView(null, preferenceRevision).then(
              onReload,
            )
          }
        >
          Reset default
        </Button>
      </div>
    </section>
  );
}

function TransitionRequestsPanel({
  requests,
  items,
  actorUserId,
  canManage,
  busy,
  onDecision,
  onCancel,
}: {
  requests: JourneyPortfolioTransitionRequest[];
  items: JourneyPortfolioItem[];
  actorUserId: string;
  canManage: boolean;
  busy: boolean;
  onDecision: (
    item: JourneyPortfolioTransitionRequest,
    decision: "approve" | "reject",
    reason: string,
  ) => Promise<void>;
  onCancel: (
    item: JourneyPortfolioTransitionRequest,
    reason: string,
  ) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const itemNames = new Map(items.map((item) => [item.id, item.title]));
  return (
    <section className="border" aria-labelledby="portfolio-transition-heading">
      <div className="border-b px-3 py-2.5">
        <h2 id="portfolio-transition-heading" className="text-sm font-semibold">
          Status requests
        </h2>
      </div>
      <div className="divide-y">
        {requests.map((request) => (
          <article
            className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
            key={request.id}
          >
            <div>
              <p className="text-sm font-medium">
                {itemNames.get(request.itemId) || request.itemId}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {request.fromLifecycle.replaceAll("_", " ")} →{" "}
                {request.requestedTargetLifecycle.replaceAll("_", " ")} · item
                revision {request.requestedItemRevision} · {request.status}
              </p>
              <p className="mt-2 text-sm">{request.reason}</p>
            </div>
            {request.status === "pending" &&
            canManage &&
            request.requestedByUserId !== actorUserId ? (
              <div className="grid gap-2">
                <Input
                  aria-label={`Decision reason for ${itemNames.get(request.itemId) || request.itemId}`}
                  placeholder="Decision reason"
                  value={reasons[request.id] || ""}
                  onChange={(event) =>
                    setReasons({ ...reasons, [request.id]: event.target.value })
                  }
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={
                      busy || (reasons[request.id] || "").trim().length < 3
                    }
                    onClick={() =>
                      void onDecision(request, "approve", reasons[request.id])
                    }
                  >
                    Approve exact move
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy || (reasons[request.id] || "").trim().length < 3
                    }
                    onClick={() =>
                      void onDecision(request, "reject", reasons[request.id])
                    }
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ) : request.status === "pending" &&
              canManage &&
              request.requestedByUserId === actorUserId ? (
              <div className="grid gap-2">
                <Input
                  aria-label={`Cancellation reason for ${itemNames.get(request.itemId) || request.itemId}`}
                  placeholder="Cancellation reason"
                  value={reasons[request.id] || ""}
                  onChange={(event) =>
                    setReasons({ ...reasons, [request.id]: event.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy || (reasons[request.id] || "").trim().length < 3
                  }
                  onClick={() => void onCancel(request, reasons[request.id])}
                >
                  Cancel request
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {request.status === "pending"
                  ? "Awaiting a different authorised manager."
                  : request.decisionReason || "Decision recorded."}
              </p>
            )}
          </article>
        ))}
        {requests.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No status requests have been recorded.
          </p>
        )}
      </div>
    </section>
  );
}

function ExecutiveReport({
  report,
  busy,
  onExport,
}: {
  report: JourneyPortfolioExecutiveReport;
  busy: boolean;
  onExport: () => Promise<void>;
}) {
  const rows = [
    ["Active portfolio items", report.scope.itemCount],
    ["Items with evidence", report.items.withEvidence],
    ["Scored items", report.items.scored],
    ["Initiatives", report.initiatives.total],
    ["Owned initiatives", report.initiatives.owned],
    ["Overdue initiatives", report.initiatives.overdue],
    ["Initiatives with baselines", report.initiatives.initiativesWithBaseline],
    [
      "Initiatives with comparisons",
      report.initiatives.initiativesWithComparison,
    ],
  ] as const;
  return (
    <div className="space-y-5" data-testid="journey-portfolio-executive-report">
      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">
            Executive portfolio report
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recorded state at {displayDate(report.asOf)}.{" "}
            {report.interpretation.statement}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void onExport()}
        >
          <Download />
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Executive portfolio measures</caption>
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 font-medium">Measure</th>
              <th className="px-3 py-2 font-medium">Recorded value</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="px-3 py-2.5">{label}</td>
                <td className="px-3 py-2.5 tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportBreakdown title="Lifecycle" rows={report.items.byLifecycle} />
        <ReportBreakdown
          title="Recorded before/after direction"
          rows={report.observedOutcomes.directionalComparisons}
        />
      </div>
      <dl className="grid gap-x-6 gap-y-3 border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Known progress</dt>
          <dd>{report.initiatives.progressKnown} initiatives</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Average recorded progress</dt>
          <dd>
            {report.initiatives.averageProgress == null
              ? "Unavailable"
              : `${report.initiatives.averageProgress}%`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dependencies</dt>
          <dd>{report.initiatives.dependencies}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Operational links</dt>
          <dd>{report.initiatives.operationalLinks}</dd>
        </div>
      </dl>
    </div>
  );
}

function ReportBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; count: number }>;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 border">
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <span className="capitalize">
                  {row.key.replaceAll("_", " ")}
                </span>
                <span className="tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-5 text-sm text-muted-foreground">
            No recorded values.
          </p>
        )}
      </div>
    </section>
  );
}

function PortfolioMatrix({
  items,
  onOpen,
}: {
  items: JourneyPortfolioItem[];
  onOpen: (item: JourneyPortfolioItem) => void;
}) {
  const candidates = items.filter(
    (item) => item.kind === "opportunity" || item.kind === "initiative",
  );
  const highValue = (item: JourneyPortfolioItem) =>
    (item.latestScore ?? 0) >= 5 ||
    item.priority === "critical" ||
    item.priority === "high";
  const highEffort = (item: JourneyPortfolioItem) =>
    (item.estimatedEffort ?? (item.risk === "high" ? 10 : 0)) >= 5;
  const cells = [
    {
      title: "Strategic bets",
      test: (item: JourneyPortfolioItem) => highValue(item) && highEffort(item),
    },
    {
      title: "Prioritise",
      test: (item: JourneyPortfolioItem) =>
        highValue(item) && !highEffort(item),
    },
    {
      title: "Defer",
      test: (item: JourneyPortfolioItem) =>
        !highValue(item) && highEffort(item),
    },
    {
      title: "Consider",
      test: (item: JourneyPortfolioItem) =>
        !highValue(item) && !highEffort(item),
    },
  ];
  return (
    <div data-testid="journey-portfolio-matrix">
      <div className="mb-2 flex justify-between text-xs text-muted-foreground">
        <span>Higher effort</span>
        <span>Lower effort</span>
      </div>
      <div className="grid border sm:grid-cols-2">
        {cells.map((cell) => (
          <section
            key={cell.title}
            className="min-h-48 border-b p-3 odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
          >
            <h2 className="text-sm font-semibold">{cell.title}</h2>
            <div className="mt-3 space-y-2">
              {candidates.filter(cell.test).map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center justify-between gap-3 border bg-background px-3 py-2 text-left hover:bg-muted/30"
                  onClick={() => onOpen(item)}
                >
                  <span className="truncate text-sm">{item.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.latestScore?.toFixed(1) ?? item.priority ?? "—"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Position uses the latest configured score and recorded effort or risk.
        It is a prioritisation aid, not an automated decision.
      </p>
    </div>
  );
}

function RelationshipWorkspace({
  items,
  relationships,
  dependencies,
  policies,
  canManage,
  busy,
  onCreateRelationship,
  onDeleteRelationship,
  onCreateDependency,
  onDeleteDependency,
  onCreatePolicy,
}: {
  items: JourneyPortfolioItem[];
  relationships: JourneyPortfolioRelationship[];
  dependencies: JourneyPortfolioDependency[];
  policies: JourneyPortfolioPolicy[];
  canManage: boolean;
  busy: boolean;
  onCreateRelationship: (
    input: Pick<
      JourneyPortfolioRelationship,
      "type" | "fromItemId" | "toItemId"
    >,
  ) => Promise<void>;
  onDeleteRelationship: (id: string) => Promise<void>;
  onCreateDependency: (
    input: Pick<
      JourneyPortfolioDependency,
      "initiativeId" | "dependsOnInitiativeId" | "type"
    >,
  ) => Promise<void>;
  onDeleteDependency: (id: string) => Promise<void>;
  onCreatePolicy: (input: {
    name: string;
    method: "rice" | "ice";
    state: "draft" | "active";
  }) => Promise<void>;
}) {
  const [relationType, setRelationType] = useState<
    JourneyPortfolioRelationship["type"]
  >("pain_point_to_opportunity");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [dependsOnId, setDependsOnId] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [policyMethod, setPolicyMethod] = useState<"rice" | "ice">("rice");
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const [fromKind, toKind] =
    relationType === "pain_point_to_opportunity"
      ? ["pain_point", "opportunity"]
      : relationType === "opportunity_to_solution"
        ? ["opportunity", "solution"]
        : ["solution", "initiative"];
  const initiatives = items.filter((item) => item.kind === "initiative");
  return (
    <div
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
      data-testid="journey-portfolio-relationships"
    >
      <div className="space-y-6">
        <section>
          <h2 className="text-base font-semibold">Improvement chain</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Canonical links connect pain points to opportunities, solutions, and
            delivery initiatives.
          </p>
          <div className="mt-3 border">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>From</span>
              <span></span>
              <span>To</span>
              <span className="w-8"></span>
            </div>
            {relationships.length ? (
              <ul className="divide-y">
                {relationships.map((relationship) => (
                  <li
                    key={relationship.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-sm"
                  >
                    <span className="truncate">
                      {itemById.get(relationship.fromItemId)?.title ||
                        relationship.fromItemId}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">
                      {itemById.get(relationship.toItemId)?.title ||
                        relationship.toItemId}
                    </span>
                    {canManage ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete relationship"
                        disabled={busy}
                        onClick={() =>
                          void onDeleteRelationship(relationship.id)
                        }
                      >
                        <Trash2 />
                      </Button>
                    ) : (
                      <span className="w-8" />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No relationships have been created.
              </p>
            )}
          </div>
          {canManage && (
            <form
              className="mt-3 grid gap-2 md:grid-cols-[220px_1fr_1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateRelationship({
                  type: relationType,
                  fromItemId: fromId,
                  toItemId: toId,
                }).then(() => {
                  setFromId("");
                  setToId("");
                });
              }}
            >
              <select
                aria-label="Relationship type"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={relationType}
                onChange={(event) => {
                  setRelationType(
                    event.target.value as JourneyPortfolioRelationship["type"],
                  );
                  setFromId("");
                  setToId("");
                }}
              >
                {Object.entries(relationshipLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Source item"
                required
                className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                <option value="">
                  Choose{" "}
                  {kindLabels[fromKind as JourneyPortfolioKind].toLowerCase()}
                </option>
                {items
                  .filter((item) => item.kind === fromKind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Target item"
                required
                className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                <option value="">
                  Choose{" "}
                  {kindLabels[toKind as JourneyPortfolioKind].toLowerCase()}
                </option>
                {items
                  .filter((item) => item.kind === toKind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !fromId || !toId}
              >
                <Plus />
                Link
              </Button>
            </form>
          )}
        </section>
        <section>
          <h2 className="text-base font-semibold">Initiative dependencies</h2>
          <div className="mt-3 border">
            {dependencies.length ? (
              <ul className="divide-y">
                {dependencies.map((dependency) => (
                  <li
                    key={dependency.id}
                    className="flex items-center gap-3 px-3 py-3 text-sm"
                  >
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <strong>
                        {itemById.get(dependency.initiativeId)?.title ||
                          dependency.initiativeId}
                      </strong>{" "}
                      {dependency.type === "blocks"
                        ? "is blocked by"
                        : "starts after"}{" "}
                      <strong>
                        {itemById.get(dependency.dependsOnInitiativeId)
                          ?.title || dependency.dependsOnInitiativeId}
                      </strong>
                    </span>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete dependency"
                        disabled={busy}
                        onClick={() => void onDeleteDependency(dependency.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No initiative dependencies have been created.
              </p>
            )}
          </div>
          {canManage && (
            <form
              className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_160px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateDependency({
                  initiativeId,
                  dependsOnInitiativeId: dependsOnId,
                  type: "finish_to_start",
                }).then(() => {
                  setInitiativeId("");
                  setDependsOnId("");
                });
              }}
            >
              <select
                aria-label="Dependent initiative"
                required
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={initiativeId}
                onChange={(event) => setInitiativeId(event.target.value)}
              >
                <option value="">Initiative</option>
                {initiatives.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Prerequisite initiative"
                required
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={dependsOnId}
                onChange={(event) => setDependsOnId(event.target.value)}
              >
                <option value="">Depends on</option>
                {initiatives
                  .filter((item) => item.id !== initiativeId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
              <span className="flex h-9 items-center px-2 text-sm text-muted-foreground">
                Finish to start
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !initiativeId || !dependsOnId}
              >
                <Plus />
                Add
              </Button>
            </form>
          )}
        </section>
      </div>
      <aside>
        <h2 className="text-base font-semibold">Scoring policies</h2>
        <div className="mt-3 border">
          {policies.length ? (
            <ul className="divide-y">
              {policies.map((policy) => (
                <li key={policy.id} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{policy.name}</span>
                    <span className="text-xs uppercase text-muted-foreground">
                      {policy.method}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {policy.state} · version{" "}
                    {policy.currentVersion.versionNumber}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No scoring policies.
            </p>
          )}
        </div>
        {canManage && (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreatePolicy({
                name: policyName,
                method: policyMethod,
                state: "active",
              }).then(() => setPolicyName(""));
            }}
          >
            <Input
              aria-label="Policy name"
              required
              placeholder="Product opportunity score"
              value={policyName}
              onChange={(event) => setPolicyName(event.target.value)}
            />
            <div className="flex gap-2">
              <select
                aria-label="Scoring method"
                className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                value={policyMethod}
                onChange={(event) =>
                  setPolicyMethod(event.target.value as "rice" | "ice")
                }
              >
                <option value="rice">RICE</option>
                <option value="ice">ICE</option>
              </select>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !policyName.trim()}
              >
                <Plus />
                Create
              </Button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}

export function JourneyPortfolioPage() {
  const enabled = useSessionFeature("journeyPortfolio");
  const session = useAuthSession();
  const canManage = Boolean(
    session?.activeSpace && session.activeSpace.role !== "member",
  );
  const [items, setItems] = useState<JourneyPortfolioItem[]>([]);
  const [relationships, setRelationships] = useState<
    JourneyPortfolioRelationship[]
  >([]);
  const [dependencies, setDependencies] = useState<
    JourneyPortfolioDependency[]
  >([]);
  const [policies, setPolicies] = useState<JourneyPortfolioPolicy[]>([]);
  const [report, setReport] = useState<JourneyPortfolioExecutiveReport | null>(
    null,
  );
  const [savedViews, setSavedViews] = useState<JourneyPortfolioSavedView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string | null>(null);
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [transitionRequests, setTransitionRequests] = useState<
    JourneyPortfolioTransitionRequest[]
  >([]);
  const defaultApplied = useRef(false);
  const [page, setPage] = useState({
    limit: 100,
    offset: 0,
    total: 0,
    hasMore: false,
  });
  const [filters, setFilters] = useState<JourneyPortfolioFilters>({
    sort: "updated",
    limit: 100,
  });
  const [search, setSearch] = useState("");
  const [view, setView] = useState<PortfolioView>("table");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<JourneyPortfolioItem | null>(
    null,
  );
  const [detailItem, setDetailItem] = useState<JourneyPortfolioItem | null>(
    null,
  );

  const load = useCallback(
    async (nextFilters = filters) => {
      try {
        setLoading(true);
        setError("");
        const [
          itemResult,
          relationshipResult,
          dependencyResult,
          policyResult,
          reportResult,
          savedResult,
          requestResult,
        ] = await Promise.all([
          listJourneyPortfolioItems(nextFilters),
          listJourneyPortfolioRelationships(),
          listJourneyPortfolioDependencies(),
          listJourneyPortfolioPolicies(),
          readJourneyPortfolioExecutiveReport(),
          listJourneyPortfolioSavedViews(),
          listJourneyPortfolioTransitionRequests(),
        ]);
        setItems(itemResult.items);
        setPage(itemResult.page);
        setRelationships(relationshipResult.relationships);
        setDependencies(dependencyResult.dependencies);
        setPolicies(policyResult.policies);
        setReport(reportResult.report);
        setSavedViews(savedResult.views);
        setDefaultViewId(savedResult.defaultViewId);
        setPreferenceRevision(savedResult.preferenceRevision);
        setTransitionRequests(requestResult);
        if (!defaultApplied.current && savedResult.defaultViewId) {
          const selected = savedResult.views.find(
            (entry) => entry.id === savedResult.defaultViewId,
          );
          if (selected) {
            defaultApplied.current = true;
            const next = {
              ...selected.configuration.filters,
              sort: selected.configuration.sort,
              limit: 100,
              offset: 0,
            };
            setFilters(next);
            setSearch(selected.configuration.filters.search || "");
            setView(selected.configuration.presentation);
            if (JSON.stringify(next) !== JSON.stringify(nextFilters))
              void load(next);
          }
        }
      } catch (reason) {
        setError(message(reason, "Journey portfolio could not be loaded."));
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mutate(action: () => Promise<unknown>) {
    try {
      setBusy(true);
      setError("");
      await action();
      await load();
    } catch (reason) {
      setError(message(reason, "The portfolio change could not be saved."));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(draft: ItemEditorState) {
    try {
      await mutate(() =>
        editingItem
          ? updateJourneyPortfolioItem(
              editingItem,
              updatePatch(draft),
              "Updated in portfolio workspace",
            )
          : createJourneyPortfolioItem(createDraft(draft)),
      );
      setEditorOpen(false);
      setEditingItem(null);
    } catch {
      /* Error is shown in the page alert. */
    }
  }

  function applyFilters() {
    const next = { ...filters, search: search.trim() || undefined, offset: 0 };
    setFilters(next);
    void load(next);
  }

  if (!enabled) return null;
  const views: Array<{
    value: PortfolioView;
    label: string;
    icon: typeof List;
  }> = [
    { value: "table", label: "Table", icon: List },
    { value: "board", label: "Board", icon: LayoutGrid },
    { value: "matrix", label: "Priority matrix", icon: Scale },
    { value: "relationships", label: "Relationships", icon: Network },
    { value: "report", label: "Executive report", icon: BarChart3 },
  ];
  return (
    <div
      className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 sm:py-6"
      data-testid="journey-portfolio-page"
    >
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Journey portfolio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage reusable pain points, opportunities, solutions, and
            initiatives across journeys.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditingItem(null);
              setEditorOpen(true);
            }}
          >
            <Plus />
            New item
          </Button>
        )}
      </header>
      {!canManage && (
        <div
          className="border bg-muted/30 px-4 py-3 text-sm"
          data-testid="journey-portfolio-read-only"
        >
          Portfolio items and status requests are read-only. You can still save
          and reset your own private views.
        </div>
      )}
      {error && (
        <div
          className="flex items-start justify-between gap-3 border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      )}
      <section className="border" aria-label="Portfolio filters">
        <div className="grid gap-3 p-3 md:grid-cols-[minmax(220px,1fr)_180px_160px_160px_auto]">
          <Input
            aria-label="Search portfolio"
            placeholder="Search title or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilters();
            }}
          />
          <select
            aria-label="Item type"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filters.kind || ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                kind: (event.target.value as JourneyPortfolioKind) || undefined,
              })
            }
          >
            <option value="">All types</option>
            {kindOrder.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabels[kind]}
              </option>
            ))}
          </select>
          <select
            aria-label="Priority"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filters.priority || ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                priority:
                  (event.target.value as JourneyPortfolioPriority) || undefined,
              })
            }
          >
            <option value="">All priorities</option>
            {priorityOrder.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort portfolio"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filters.sort || "updated"}
            onChange={(event) =>
              setFilters({
                ...filters,
                sort: event.target.value as JourneyPortfolioFilters["sort"],
              })
            }
          >
            <option value="updated">Recently updated</option>
            <option value="priority">Priority</option>
            <option value="score">Score</option>
            <option value="due">Due date</option>
          </select>
          <Button variant="outline" onClick={applyFilters}>
            Apply
          </Button>
        </div>
      </section>
      <SavedViewToolbar
        saved={savedViews}
        defaultViewId={defaultViewId}
        preferenceRevision={preferenceRevision}
        filters={filters}
        presentation={view}
        busy={busy}
        onReload={async () => {
          const result = await listJourneyPortfolioSavedViews();
          setSavedViews(result.views);
          setDefaultViewId(result.defaultViewId);
          setPreferenceRevision(result.preferenceRevision);
        }}
        onApply={(selected) => {
          const next = {
            ...selected.configuration.filters,
            sort: selected.configuration.sort,
            limit: 100,
            offset: 0,
          };
          setFilters(next);
          setSearch(selected.configuration.filters.search || "");
          setView(selected.configuration.presentation);
          void load(next);
        }}
      />
      <div className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex overflow-x-auto"
          role="tablist"
          aria-label="Portfolio views"
        >
          {views.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="tab"
              aria-selected={view === value}
              className={cn(
                "flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium text-muted-foreground",
                view === value
                  ? "border-foreground text-foreground"
                  : "border-transparent hover:text-foreground",
              )}
              onClick={() => setView(value)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="pb-2 text-sm tabular-nums text-muted-foreground sm:pb-0">
          {page.total} item{page.total === 1 ? "" : "s"}
        </p>
      </div>
      {loading ? (
        <div className="flex min-h-64 items-center justify-center border">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">
            Loading portfolio…
          </span>
        </div>
      ) : !items.length && view !== "report" ? (
        <div className="border px-5 py-14 text-center">
          <h2 className="text-base font-semibold">No portfolio items found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create the first reusable item or change the active filters.
          </p>
          {canManage && (
            <Button className="mt-4" onClick={() => setEditorOpen(true)}>
              <Plus />
              New item
            </Button>
          )}
        </div>
      ) : (
        <>
          {view === "table" && (
            <PortfolioTable items={items} onOpen={setDetailItem} />
          )}
          {view === "board" && (
            <>
              <PortfolioBoard
                items={items}
                canManage={canManage}
                busy={busy}
                onOpen={setDetailItem}
                onMove={async (item, lifecycle) => {
                  try {
                    await mutate(() =>
                      requestJourneyPortfolioTransition(
                        item,
                        lifecycle,
                        `Requested ${lifecycle.replaceAll("_", " ")} from the portfolio board.`,
                      ),
                    );
                  } catch {
                    /* Page alert owns the failure. */
                  }
                }}
              />
              <TransitionRequestsPanel
                requests={transitionRequests}
                items={items}
                actorUserId={session?.user?.id || ""}
                canManage={canManage}
                busy={busy}
                onDecision={async (item, decision, reason) => {
                  await mutate(() =>
                    decideJourneyPortfolioTransition(item, decision, reason),
                  );
                }}
                onCancel={async (item, reason) => {
                  await mutate(() =>
                    cancelJourneyPortfolioTransition(item, reason),
                  );
                }}
              />
            </>
          )}
          {view === "matrix" && (
            <PortfolioMatrix items={items} onOpen={setDetailItem} />
          )}
          {view === "relationships" && (
            <RelationshipWorkspace
              items={items}
              relationships={relationships}
              dependencies={dependencies}
              policies={policies}
              canManage={canManage}
              busy={busy}
              onCreateRelationship={async (input) => {
                try {
                  await mutate(() => createJourneyPortfolioRelationship(input));
                } catch {
                  /* Page alert owns the failure. */
                }
              }}
              onDeleteRelationship={async (id) => {
                try {
                  await mutate(() => deleteJourneyPortfolioRelationship(id));
                } catch {
                  /* Page alert owns the failure. */
                }
              }}
              onCreateDependency={async (input) => {
                try {
                  await mutate(() => createJourneyPortfolioDependency(input));
                } catch {
                  /* Page alert owns the failure. */
                }
              }}
              onDeleteDependency={async (id) => {
                try {
                  await mutate(() => deleteJourneyPortfolioDependency(id));
                } catch {
                  /* Page alert owns the failure. */
                }
              }}
              onCreatePolicy={async (input) => {
                try {
                  await mutate(() => createJourneyPortfolioPolicy(input));
                } catch {
                  /* Page alert owns the failure. */
                }
              }}
            />
          )}
          {view === "report" && report && (
            <ExecutiveReport
              report={report}
              busy={busy}
              onExport={async () => {
                try {
                  setBusy(true);
                  setError("");
                  await downloadJourneyPortfolioExecutiveReport();
                } catch (reason) {
                  setError(
                    message(
                      reason,
                      "The executive report could not be exported.",
                    ),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </>
      )}
      {page.hasMore && (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first {items.length} of {page.total} items. Refine filters
          to narrow the result.
        </p>
      )}
      <ItemEditor
        open={editorOpen}
        item={editingItem}
        busy={busy}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditingItem(null);
        }}
        onSave={saveItem}
      />
      <ItemDetail
        item={detailItem}
        policies={policies}
        canManage={canManage}
        onClose={() => setDetailItem(null)}
        onEdit={(item) => {
          setDetailItem(null);
          setEditingItem(item);
          setEditorOpen(true);
        }}
        onScored={async () => {
          await load();
        }}
      />
    </div>
  );
}
