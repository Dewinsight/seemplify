"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Award, Bot, CheckCircle2, Clock, Loader2, Mail, RefreshCw, RotateCcw, Star, Trophy, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import aiInterviewService, { type AIInterview, type AIInterviewSession } from "@/services/aiInterviewService";

function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString();
}

function statusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "in_progress":
    case "opened":
    case "sent":
      return "bg-blue-100 text-blue-800";
    case "credit_blocked":
    case "credit_error":
    case "email_failed":
      return "bg-red-100 text-red-800";
    case "cancelled":
    case "expired":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function getSessionScore(session?: AIInterviewSession) {
  if (session?.scoring?.status !== "completed") return null;
  const score = Number(session.scoring.overallScore);
  return Number.isFinite(score) ? Math.round(score) : null;
}

function formatRecommendation(value?: string) {
  if (!value) return "Review";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function recommendationColor(value?: string) {
  switch (value) {
    case "strong_yes":
    case "yes":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "maybe":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "no":
    case "strong_no":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function AIInterviewDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [aiInterview, setAIInterview] = useState<AIInterview | null>(null);
  const [sessions, setSessions] = useState<AIInterviewSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session._id === selectedSessionId) || sessions[0],
    [sessions, selectedSessionId]
  );
  const rankedSessions = useMemo(() => {
    return sessions
      .filter((session) => getSessionScore(session) !== null)
      .sort((a, b) => (getSessionScore(b) || 0) - (getSessionScore(a) || 0));
  }, [sessions]);
  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aScore = getSessionScore(a);
      const bScore = getSessionScore(b);
      if (aScore !== null && bScore !== null) return bScore - aScore;
      if (aScore !== null) return -1;
      if (bScore !== null) return 1;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }, [sessions]);
  const averageScore = useMemo(() => {
    if (!rankedSessions.length) return null;
    return Math.round(rankedSessions.reduce((sum, session) => sum + (getSessionScore(session) || 0), 0) / rankedSessions.length);
  }, [rankedSessions]);
  const selectedRank = selectedSession
    ? rankedSessions.findIndex((session) => session._id === selectedSession._id) + 1
    : 0;

  const load = async () => {
    setLoading(true);
    try {
      const data = await aiInterviewService.get(id);
      setAIInterview(data.aiInterview);
      setSessions(data.sessions || []);
      const bestSession = [...(data.sessions || [])]
        .filter((session) => getSessionScore(session) !== null)
        .sort((a, b) => (getSessionScore(b) || 0) - (getSessionScore(a) || 0))[0];
      setSelectedSessionId((current) => current || bestSession?._id || data.sessions?.[0]?._id || null);
    } catch (error: any) {
      toast.error(error.message || "Failed to load AI interview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const resend = async (sessionId: string) => {
    setResending(sessionId);
    try {
      await aiInterviewService.resend(id, [sessionId]);
      toast.success("Invite queued for resend");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to resend invite");
    } finally {
      setResending(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this AI interview for all incomplete candidates?")) return;
    setCancelling(true);
    try {
      await aiInterviewService.cancel(id, "Cancelled from AI interview detail page");
      toast.success("AI interview cancelled");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to cancel AI interview");
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !aiInterview) {
    return (
      <div className="container py-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading AI interview...
        </div>
      </div>
    );
  }

  if (!aiInterview) {
    return (
      <div className="container py-8">
        <Alert>
          <AlertDescription>AI interview not found.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container max-w-screen-2xl py-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" asChild className="px-0">
              <Link href="/ai-interviews">
                <ArrowLeft className="mr-2 h-4 w-4" />
                AI Interviews
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                {aiInterview.job?.title || "Job"}
              </div>
              <h1 className="text-2xl font-semibold text-slate-950">{aiInterview.title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            {aiInterview.status !== "cancelled" && aiInterview.status !== "completed" && (
              <Button variant="destructive" onClick={cancel} disabled={cancelling}>
                {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Status</div>
              <Badge className={statusColor(aiInterview.status)}>{aiInterview.status}</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Candidates</div>
              <div className="text-xl font-semibold">{aiInterview.candidateCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Questions</div>
              <div className="text-xl font-semibold">{aiInterview.questionSnapshots.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Completed</div>
              <div className="text-xl font-semibold">{aiInterview.stats?.completed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Avg AI Score</div>
              <div className="flex items-end gap-2">
                <div className="text-xl font-semibold">{averageScore ?? "-"}</div>
                <div className="pb-0.5 text-xs text-muted-foreground">{rankedSessions.length ? `${rankedSessions.length} scored` : "No scores"}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-white">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-violet-600" />
              Candidate Ranking
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {rankedSessions.length ? (
              <div className="space-y-3">
                {rankedSessions.slice(0, 8).map((session, index) => {
                  const score = getSessionScore(session) || 0;
                  return (
                    <button
                      key={session._id}
                      onClick={() => setSelectedSessionId(session._id)}
                      className={`grid w-full gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-slate-50 md:grid-cols-[56px_minmax(0,1fr)_120px_150px] md:items-center ${
                        selectedSession?._id === session._id ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">
                        #{index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-950">{session.candidateSnapshot?.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{session.candidateSnapshot?.email}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                          <Star className="h-4 w-4 text-amber-500" />
                          {score}
                        </div>
                        <Progress value={score} className="mt-1 h-1.5" />
                      </div>
                      <Badge variant="outline" className={`w-fit ${recommendationColor(session.scoring?.recommendation)}`}>
                        {formatRecommendation(session.scoring?.recommendation)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Alert>
                <AlertDescription>Ranking appears when candidates complete the interview and Llama scoring finishes.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3 p-5 text-sm md:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Send time</div>
              <div className="font-medium">{formatDate(aiInterview.schedule.sendAt)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Deadline</div>
              <div className="font-medium">{formatDate(aiInterview.schedule.expiresAt)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Timers</div>
              <div className="font-medium">{aiInterview.timers.perQuestionMinutes} min/question, {aiInterview.timers.totalMinutes} min total</div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Candidate Sessions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {orderedSessions.map((session) => {
                const score = getSessionScore(session);
                const rank = rankedSessions.findIndex((item) => item._id === session._id) + 1;
                return (
                  <button
                    key={session._id}
                    onClick={() => setSelectedSessionId(session._id)}
                    className={`w-full rounded-md border bg-white p-3 text-left transition-colors hover:bg-slate-50 ${
                      selectedSession?._id === session._id ? "border-slate-900" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {rank > 0 && (
                            <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-white">#{rank}</span>
                          )}
                          <div className="truncate font-medium">{session.candidateSnapshot?.name}</div>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{session.candidateSnapshot?.email}</div>
                      </div>
                      <Badge className={statusColor(session.status)}>{session.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {session.email?.sentAt ? "sent" : `${session.email?.attempts || 0} attempts`}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {session.answers?.filter((answer) => answer.status === "answered").length || 0} answers
                      </span>
                      {score !== null && (
                        <span className="flex items-center gap-1 font-semibold text-slate-950">
                          <Star className="h-3 w-3 text-amber-500" />
                          {score}/100
                        </span>
                      )}
                    </div>
                    {score !== null && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Progress value={score} className="h-1.5" />
                        <Badge variant="outline" className={recommendationColor(session.scoring?.recommendation)}>
                          {formatRecommendation(session.scoring?.recommendation)}
                        </Badge>
                      </div>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {selectedSession ? (
            <Tabs defaultValue="transcript" className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <TabsList>
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                  <TabsTrigger value="score">Score</TabsTrigger>
                  <TabsTrigger value="answers">Answers</TabsTrigger>
                </TabsList>
                {["sent", "opened", "email_failed", "credit_blocked", "credit_error"].includes(selectedSession.status) && (
                  <Button size="sm" variant="outline" onClick={() => resend(selectedSession._id)} disabled={resending === selectedSession._id}>
                    {resending === selectedSession._id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    Resend
                  </Button>
                )}
              </div>

              <TabsContent value="transcript">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserRound className="h-4 w-4" />
                      {selectedSession.candidateSnapshot?.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedSession.messages?.length ? (
                      selectedSession.messages.map((message, index) => (
                        <div
                          key={message._id || index}
                          className={`rounded-md p-3 text-sm ${
                            message.role === "candidate" ? "ml-8 bg-slate-900 text-white" : "mr-8 bg-white border"
                          }`}
                        >
                          <div className="mb-1 text-xs opacity-70">
                            {message.role === "candidate" ? "Candidate" : "AI Interviewer"}
                            {typeof message.questionIndex === "number" ? ` - Question ${message.questionIndex + 1}` : ""}
                          </div>
                          <div className="whitespace-pre-wrap">{message.content}</div>
                        </div>
                      ))
                    ) : (
                      <Alert>
                        <AlertDescription>No chat messages captured yet.</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="score">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">AI Score</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedSession.scoring?.status === "completed" ? (
                      <>
                        <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                          <div className="rounded-xl border bg-slate-50 p-4">
                            <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              AI score
                              {selectedRank > 0 && <span>Rank #{selectedRank}</span>}
                            </div>
                            <div className="mt-2 flex items-end gap-2">
                              <div className="text-4xl font-semibold">{selectedSession.scoring.overallScore ?? 0}</div>
                              <span className="pb-1 text-sm text-muted-foreground">/100</span>
                            </div>
                            <Progress value={Number(selectedSession.scoring.overallScore || 0)} className="mt-3 h-2" />
                            <Badge variant="outline" className={`mt-3 ${recommendationColor(selectedSession.scoring.recommendation)}`}>
                              {formatRecommendation(selectedSession.scoring.recommendation)}
                            </Badge>
                          </div>
                          <div className="rounded-xl border bg-white p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                              <Award className="h-4 w-4 text-violet-600" />
                              Scoring summary
                            </div>
                            <p className="text-sm leading-6 text-slate-700">{selectedSession.scoring.summary}</p>
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <h3 className="mb-2 text-sm font-medium">Strengths</h3>
                            <ul className="space-y-1 text-sm text-muted-foreground">
                              {(selectedSession.scoring.strengths || []).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </div>
                          <div>
                            <h3 className="mb-2 text-sm font-medium">Concerns</h3>
                            <ul className="space-y-1 text-sm text-muted-foreground">
                              {(selectedSession.scoring.concerns || []).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {(selectedSession.scoring.questionScores || []).map((score) => (
                            <div key={score.questionIndex} className="rounded-md border bg-white p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Question {score.questionIndex + 1}</span>
                                <span className="flex items-center gap-1 text-sm">
                                  <Star className="h-4 w-4" />
                                  {score.score}/5
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{score.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <Alert>
                        <AlertDescription>Score status: {selectedSession.scoring?.status || "pending"}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="answers">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Captured Answers</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedSession.answers?.length ? selectedSession.answers.map((answer) => (
                      <div key={answer.questionIndex} className="rounded-md border bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">Question {answer.questionIndex + 1}</h3>
                          <Badge className={statusColor(answer.status)}>{answer.status}</Badge>
                        </div>
                        {answer.question && <p className="mb-2 text-sm text-muted-foreground">{answer.question}</p>}
                        <p className="whitespace-pre-wrap text-sm">{answer.answer || "No answer captured."}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {answer.timeSpentSeconds || 0}s
                        </div>
                      </div>
                    )) : (
                      <Alert>
                        <AlertDescription>No answers captured yet.</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : (
            <Alert>
              <AlertDescription>No sessions are available for this interview.</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
