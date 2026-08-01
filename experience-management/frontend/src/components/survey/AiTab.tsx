import { useEffect, useState } from "react";
import {
  BookOpenCheck,
  Check,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api, json, waitForJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { AiJob, Survey } from "@/types";

type Insight = { id: string; kind: string; payload: any; createdAt: string };

const intelligenceLabel: Record<string, string> = {
  ai_insights: "Survey intelligence",
  executive_report: "Executive report",
  research_answer: "Research answer",
  knowledge_entry: "Knowledge entry",
};

function IntelligenceOutput({
  item,
  onPromote,
  promoting,
}: {
  item: Insight;
  onPromote: (item: Insight) => void;
  promoting: boolean;
}) {
  const value = item.payload || {};
  if (item.kind === "ai_insights")
    return (
      <div className="mt-4 space-y-5 border-t pt-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-[96px_1fr]">
          <div>
            <div className="text-2xl font-semibold">
              {value.healthScore ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Health score</div>
          </div>
          <p className="leading-6">{value.executiveSummary}</p>
        </div>
        {value.keyFindings?.length > 0 && (
          <section>
            <div className="font-semibold">Key findings</div>
            <div className="mt-2 divide-y border">
              {value.keyFindings.map((finding: any, index: number) => (
                <div className="p-3" key={`${finding.title}-${index}`}>
                  <div className="font-medium">{finding.title}</div>
                  <p className="mt-1 leading-6 text-muted-foreground">
                    {finding.detail}
                  </p>
                  {finding.evidence?.length > 0 && (
                    <p className="mt-2 text-xs">
                      Evidence: {finding.evidence.join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {value.recommendations?.length > 0 && (
          <section>
            <div className="font-semibold">Recommended actions</div>
            <ol className="mt-2 space-y-2">
              {value.recommendations.map(
                (recommendation: any, index: number) => (
                  <li
                    className="border-l-2 pl-3"
                    key={`${recommendation.action}-${index}`}
                  >
                    <span className="font-medium">{recommendation.action}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {recommendation.priority} · {recommendation.owner}
                    </span>
                    <p className="mt-1 text-muted-foreground">
                      {recommendation.rationale}
                    </p>
                  </li>
                ),
              )}
            </ol>
          </section>
        )}
      </div>
    );
  if (item.kind === "executive_report")
    return (
      <div className="mt-4 space-y-4 border-t pt-4 text-sm">
        <p className="leading-6">{value.executiveSummary}</p>
        {value.sections?.map((section: any, index: number) => (
          <section key={`${section.heading}-${index}`}>
            <div className="font-semibold">{section.heading}</div>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>
    );
  if (item.kind === "research_answer" || item.kind === "knowledge_entry")
    return (
      <div className="mt-4 space-y-4 border-t pt-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Question
          </div>
          <p className="mt-1 font-medium">{value.question}</p>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Answer
          </div>
          <p className="mt-1 whitespace-pre-wrap leading-6">{value.answer}</p>
        </div>
        {value.evidence?.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Evidence
            </div>
            <ul className="mt-1 space-y-1 text-xs">
              {value.evidence.map((citation: any, index: number) => (
                <li key={`${citation.responseId}-${index}`}>
                  {citation.responseId?.slice(0, 8)} — “{citation.excerpt}”
                </li>
              ))}
            </ul>
          </div>
        )}
        {item.kind === "research_answer" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={promoting}
            onClick={() => onPromote(item)}
          >
            {promoting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <BookOpenCheck />
            )}
            Add to knowledge base
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5" />
            Available in Workspace knowledge
          </div>
        )}
      </div>
    );
  return (
    <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap border bg-muted/30 p-3 text-xs leading-5">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AiTab({
  survey,
  onApplyImprovement,
  refreshKey,
}: {
  survey: Survey;
  onApplyImprovement: (values: any) => void;
  refreshKey: number;
}) {
  const [job, setJob] = useState<AiJob | null>(null);
  const [question, setQuestion] = useState(
    "What should the team prioritise, and which responses support that conclusion?",
  );
  const [answer, setAnswer] = useState<any>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [promotingId, setPromotingId] = useState("");
  const loadInsights = () =>
    api<Insight[]>(`/api/surveys/${survey.id}/insights`).then((items) =>
      setInsights(
        items.filter((item) =>
          [
            "ai_insights",
            "executive_report",
            "research_answer",
            "knowledge_entry",
          ].includes(item.kind),
        ),
      ),
    );
  useEffect(() => {
    void loadInsights();
  }, [survey.id, refreshKey, job?.state]);

  async function promoteToKnowledge(item: Insight) {
    try {
      setPromotingId(item.id);
      await api(
        `/api/surveys/${survey.id}/insights/${item.id}/knowledge`,
        json("POST", {}),
      );
      await loadInsights();
      toast.success("Added to Workspace knowledge");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not add this answer to knowledge",
      );
    } finally {
      setPromotingId("");
    }
  }

  async function run(path: string, body: Record<string, unknown> = {}) {
    try {
      setJob(null);
      const queued = await api<{ jobId: string }>(
        `/api/surveys/${survey.id}/ai/${path}`,
        json("POST", body),
      );
      const done = await waitForJob(queued.jobId, setJob);
      const output = done.result?.output;
      if (path === "ask") setAnswer(output);
      if (path === "improve") onApplyImprovement(output);
      toast.success("Experience AI completed the request");
      return output;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Experience AI request failed",
      );
      return null;
    }
  }
  const busy = job && ["queued", "processing"].includes(job.state);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Ask the research</CardTitle>
            <CardDescription>
              Experience AI can query responses, calculated metrics, and prior
              insights. Answers are saved automatically and must cite the
              supplied evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={4}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button
              disabled={Boolean(busy) || question.trim().length < 5}
              onClick={() => run("ask", { question })}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MessageSquareText />
              )}
              Ask Experience AI
            </Button>
            {answer && (
              <div className="border bg-muted/25 p-5">
                <div className="text-sm font-semibold">Answer</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {answer.answer}
                </p>
                {answer.evidence?.length > 0 && (
                  <div className="mt-4 border-t pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Evidence
                    </div>
                    {answer.evidence.map((citation: any, index: number) => (
                      <div
                        className="mt-2 text-xs"
                        key={`${citation.responseId}-${index}`}
                      >
                        <span className="font-mono text-muted-foreground">
                          {citation.responseId?.slice(0, 8)}
                        </span>{" "}
                        — “{citation.excerpt}”
                      </div>
                    ))}
                  </div>
                )}
                {answer.savedInsightId && (
                  <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Check className="h-3.5 w-3.5" />
                      Saved to this survey
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={promotingId === answer.savedInsightId}
                      onClick={() =>
                        promoteToKnowledge({
                          id: answer.savedInsightId,
                          kind: "research_answer",
                          payload: { question, ...answer },
                          createdAt: new Date().toISOString(),
                        })
                      }
                    >
                      {promotingId === answer.savedInsightId ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <BookOpenCheck />
                      )}
                      Add to knowledge base
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Saved survey intelligence</CardTitle>
            <CardDescription>
              Decision-ready findings, research answers, and reports remain
              attached to this survey.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {insights.length ? (
              <div className="divide-y border-t">
                {insights.map((item) => (
                  <details className="group px-5 py-4" key={item.id}>
                    <summary className="cursor-pointer list-none text-sm font-medium">
                      {intelligenceLabel[item.kind] ||
                        item.kind.replaceAll("_", " ")}
                      <span className="float-right text-xs font-normal text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </summary>
                    <IntelligenceOutput
                      item={item}
                      onPromote={promoteToKnowledge}
                      promoting={promotingId === item.id}
                    />
                  </details>
                ))}
              </div>
            ) : (
              <div className="border-t px-5 py-10 text-center text-sm text-muted-foreground">
                Ask the research, generate survey intelligence, or create an
                executive report to build the research record.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Experience AI tools</CardTitle>
            <CardDescription>
              Every action is queued durably and uses the Experience default
              managed in Local Control Center.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-3"
              disabled={Boolean(busy)}
              onClick={() => run("improve")}
            >
              <WandSparkles />
              <span className="text-left">
                <span className="block">Quality review</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Bias, wording, effort and metric fit
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-3"
              disabled={Boolean(busy)}
              onClick={() => run("insights")}
            >
              <Lightbulb />
              <span className="text-left">
                <span className="block">Generate survey intelligence</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Evidence-backed findings, risks and actions
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-3"
              disabled={Boolean(busy)}
              onClick={() =>
                run("report", { audience: "executive leadership" })
              }
            >
              <FileText />
              <span className="text-left">
                <span className="block">Executive report</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Evidence, limitations and actions
                </span>
              </span>
            </Button>
          </CardContent>
        </Card>
        {job && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Current AI job</CardTitle>
                <span className="text-xs font-medium capitalize text-muted-foreground">
                  {job.state}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>
                  {job.stage === "waiting_for_terra"
                    ? "waiting for Experience AI"
                    : job.stage.replaceAll("_", " ")}
                </span>
                <span>{job.progress}%</span>
              </div>
              {["waiting_for_runtime", "waiting_for_terra"].includes(
                job.stage,
              ) && (
                <p className="mt-3 text-xs leading-5 text-amber-700">
                  The selected Experience AI provider is unavailable. The job
                  remains in the durable queue and will resume automatically.
                </p>
              )}
            </CardContent>
          </Card>
        )}
        <div className="flex gap-3 border bg-card p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="leading-5 text-muted-foreground">
            Respondent text is treated as untrusted data. Generated claims are
            constrained to survey metrics and supplied response evidence.
          </p>
        </div>
      </div>
    </div>
  );
}
