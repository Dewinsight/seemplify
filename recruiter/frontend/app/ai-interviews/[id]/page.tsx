"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Award,
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Timer,
  UserRound,
  Users,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
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

function candidateDisplayName(session?: AIInterviewSession) {
  return session?.candidateSnapshot?.name || session?.candidateSnapshot?.email || "Candidate";
}

function candidateInitials(session?: AIInterviewSession) {
  const value = candidateDisplayName(session);
  const parts = value.split(/\s+/).filter(Boolean);
  if (!parts.length) return "C";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function answeredCount(session: AIInterviewSession) {
  return session.answers?.filter((answer) => answer.status === "answered").length || 0;
}

function totalAnswerTime(session: AIInterviewSession) {
  return session.answers?.reduce((sum, answer) => sum + Number(answer.timeSpentSeconds || 0), 0) || 0;
}

function formatDuration(totalSeconds?: number) {
  const value = Number(totalSeconds || 0);
  if (!value) return "0m";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes <= 0) return `${seconds}s`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function scoreBand(score: number | null) {
  if (score === null) {
    return {
      label: "Pending score",
      className: "border-slate-200 bg-slate-50 text-slate-700",
      barClassName: "bg-slate-300",
      dotClassName: "bg-slate-400"
    };
  }
  if (score >= 85) {
    return {
      label: "Priority",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      barClassName: "bg-emerald-500",
      dotClassName: "bg-emerald-500"
    };
  }
  if (score >= 70) {
    return {
      label: "Strong review",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      barClassName: "bg-blue-500",
      dotClassName: "bg-blue-500"
    };
  }
  if (score >= 55) {
    return {
      label: "Needs discussion",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      barClassName: "bg-amber-500",
      dotClassName: "bg-amber-500"
    };
  }
  return {
    label: "Low fit",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    barClassName: "bg-rose-500",
    dotClassName: "bg-rose-500"
  };
}

type TranscriptMessage = AIInterviewSession["messages"][number];

function transcriptRoleLabel(role: TranscriptMessage["role"]) {
  if (role === "candidate") return "Candidate";
  if (role === "system") return "System";
  return "AI Interviewer";
}

function transcriptStageLabel(message: TranscriptMessage) {
  if (typeof message.questionIndex === "number") {
    return `Question ${message.questionIndex + 1}`;
  }
  if (message.messageType === "greeting") return "Opening";
  if (message.messageType === "completion") return "Completion";
  return "General";
}

function transcriptStageKey(message: TranscriptMessage) {
  if (typeof message.questionIndex === "number") return `q-${message.questionIndex}`;
  return message.messageType || "general";
}

function compactQuestionText(question?: string) {
  if (!question) return "";
  return question.length > 140 ? `${question.slice(0, 140).trim()}...` : question;
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
  const [transcriptSearch, setTranscriptSearch] = useState("");

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
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }, [sessions]);
  const averageScore = useMemo(() => {
    if (!rankedSessions.length) return null;
    return Math.round(rankedSessions.reduce((sum, session) => sum + (getSessionScore(session) || 0), 0) / rankedSessions.length);
  }, [rankedSessions]);
  const selectedScore = selectedSession ? getSessionScore(selectedSession) : null;
  const selectedBand = scoreBand(selectedScore);
  const selectedAnsweredCount = selectedSession ? answeredCount(selectedSession) : 0;
  const selectedAnswerTime = selectedSession ? totalAnswerTime(selectedSession) : 0;
  const transcriptMessages = selectedSession?.messages || [];
  const transcriptStats = useMemo(() => {
    const messages = selectedSession?.messages || [];
    const aiCount = messages.filter((message) => message.role === "ai").length;
    const candidateCount = messages.filter((message) => message.role === "candidate").length;
    const questionCount = new Set(messages
      .map((message) => message.questionIndex)
      .filter((value): value is number => typeof value === "number")
    ).size;
    return {
      total: messages.length,
      aiCount,
      candidateCount,
      questionCount
    };
  }, [selectedSession]);
  const transcriptGroups = useMemo(() => {
    const query = transcriptSearch.trim().toLowerCase();
    const groups: Array<{
      key: string;
      title: string;
      question?: string;
      messages: TranscriptMessage[];
    }> = [];
    const groupMap = new Map<string, (typeof groups)[number]>();

    transcriptMessages.forEach((message) => {
      const haystack = [
        transcriptRoleLabel(message.role),
        transcriptStageLabel(message),
        message.messageType,
        message.content
      ].filter(Boolean).join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return;

      const key = transcriptStageKey(message);
      let group = groupMap.get(key);
      if (!group) {
        const question = typeof message.questionIndex === "number"
          ? compactQuestionText(aiInterview?.questionSnapshots?.[message.questionIndex]?.question)
          : undefined;
        group = {
          key,
          title: transcriptStageLabel(message),
          question,
          messages: []
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.messages.push(message);
    });

    return groups;
  }, [aiInterview?.questionSnapshots, transcriptMessages, transcriptSearch]);
  const transcriptText = useMemo(() => {
    if (!selectedSession) return "";
    const lines = [
      `${aiInterview?.title || "AI Interview"} transcript`,
      `Candidate: ${candidateDisplayName(selectedSession)}`,
      selectedSession.candidateSnapshot?.email ? `Email: ${selectedSession.candidateSnapshot.email}` : "",
      "",
      ...transcriptMessages.map((message) => {
        const stage = transcriptStageLabel(message);
        const timestamp = message.createdAt ? ` ${formatDate(message.createdAt)}` : "";
        return `[${stage}] ${transcriptRoleLabel(message.role)}${timestamp}\n${message.content}`;
      })
    ].filter((line) => line !== "");
    return lines.join("\n\n");
  }, [aiInterview?.title, selectedSession, transcriptMessages]);

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

  const copyTranscript = async () => {
    if (!transcriptText.trim()) {
      toast.error("No transcript to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(transcriptText);
      toast.success("Transcript copied");
    } catch {
      toast.error("Unable to copy transcript");
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
          <Card className="overflow-hidden border-0 bg-white shadow-sm">
            <CardHeader className="border-b bg-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-blue-600" />
                    Candidate Sessions
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open a candidate to review the transcript, captured answers, and AI score evidence.
                  </p>
                </div>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {orderedSessions.length} sessions
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[680px]">
                <div className="space-y-2 p-4">
                  {orderedSessions.map((session) => {
                    const score = getSessionScore(session);
                    const band = scoreBand(score);
                    return (
                      <button
                        key={session._id}
                        onClick={() => setSelectedSessionId(session._id)}
                        className={`w-full rounded-2xl border p-3 text-left transition-colors hover:bg-slate-50 ${
                          selectedSession?._id === session._id ? "border-slate-950 bg-slate-50 shadow-sm" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="h-10 w-10 rounded-xl">
                            <AvatarFallback className="rounded-xl bg-slate-100 text-slate-700">{candidateInitials(session)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="truncate font-semibold text-slate-950">{candidateDisplayName(session)}</div>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">{session.candidateSnapshot?.email}</div>
                              </div>
                              <Badge className={statusColor(session.status)}>{session.status}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                                <Mail className="h-3 w-3" />
                                {session.email?.sentAt ? "sent" : `${session.email?.attempts || 0} attempts`}
                              </span>
                              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                                <CheckCircle2 className="h-3 w-3" />
                                {answeredCount(session)} answers
                              </span>
                              {score !== null && (
                                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-950">
                                  <Star className="h-3 w-3 text-amber-500" />
                                  {score}/100
                                </span>
                              )}
                            </div>
                            {score !== null && (
                              <div className="mt-3">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <Badge variant="outline" className={band.className}>{band.label}</Badge>
                                  <Badge variant="outline" className={recommendationColor(session.scoring?.recommendation)}>
                                    {formatRecommendation(session.scoring?.recommendation)}
                                  </Badge>
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-100">
                                  <div className={`h-1.5 rounded-full ${band.barClassName}`} style={{ width: `${score}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {!orderedSessions.length && (
                    <Alert>
                      <AlertDescription>No candidate sessions are available for this interview yet.</AlertDescription>
                    </Alert>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {selectedSession ? (
            <Tabs defaultValue="transcript" className="space-y-4">
              <Card className="overflow-hidden border-0 bg-white shadow-sm">
                <CardContent className="p-0">
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="flex min-w-0 items-center gap-4 p-5">
                      <Avatar className="h-14 w-14 rounded-2xl">
                        <AvatarFallback className="rounded-2xl bg-slate-950 text-base font-semibold text-white">
                          {candidateInitials(selectedSession)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-xl font-semibold text-slate-950">{candidateDisplayName(selectedSession)}</h2>
                          <Badge className={statusColor(selectedSession.status)}>{selectedSession.status}</Badge>
                        </div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">{selectedSession.candidateSnapshot?.email}</div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                            <MessageSquareText className="h-3.5 w-3.5" />
                            {selectedAnsweredCount} answers
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                            <Timer className="h-3.5 w-3.5" />
                            {formatDuration(selectedAnswerTime)}
                          </span>
                          {selectedSession.completedAt && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Completed {formatDate(selectedSession.completedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="border-t bg-slate-50 p-5 lg:border-l lg:border-t-0">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI score</div>
                          <div className="mt-1 flex items-end gap-1">
                            <span className="text-4xl font-semibold text-slate-950">{selectedScore ?? "-"}</span>
                            <span className="pb-1 text-sm text-muted-foreground">/100</span>
                          </div>
                        </div>
                        <Badge variant="outline" className={selectedBand.className}>{selectedBand.label}</Badge>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-200">
                        <div className={`h-2 rounded-full ${selectedBand.barClassName}`} style={{ width: `${selectedScore || 0}%` }} />
                      </div>
                      {selectedSession.scoring?.recommendation && (
                        <Badge variant="outline" className={`mt-3 ${recommendationColor(selectedSession.scoring.recommendation)}`}>
                          {formatRecommendation(selectedSession.scoring.recommendation)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
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
                <Card className="overflow-hidden border-0 bg-white shadow-sm">
                  <CardHeader className="space-y-4 border-b bg-gradient-to-br from-slate-50 to-white">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText className="h-4 w-4 text-blue-600" />
                          Interview transcript
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Review the conversation by stage, search for evidence, and copy a clean transcript for notes.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={copyTranscript}
                        disabled={!transcriptMessages.length}
                        className="w-fit"
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copy transcript
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {[
                        { label: "Messages", value: transcriptStats.total },
                        { label: "Candidate", value: transcriptStats.candidateCount },
                        { label: "Interviewer", value: transcriptStats.aiCount },
                        { label: "Stages", value: transcriptStats.questionCount || (transcriptStats.total ? 1 : 0) }
                      ].map((item) => (
                        <div key={item.label} className="rounded-xl border bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">{item.label}</div>
                          <div className="mt-1 text-lg font-semibold text-slate-950">{item.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={transcriptSearch}
                        onChange={(event) => setTranscriptSearch(event.target.value)}
                        placeholder="Search transcript, roles, or question stage..."
                        className="pl-9"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    {transcriptGroups.length ? (
                      transcriptGroups.map((group) => (
                        <section key={group.key} className="overflow-hidden rounded-2xl border bg-slate-50/70">
                          <div className="border-b bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-slate-950 text-white">
                                  {group.title}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {group.messages.length} message{group.messages.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              {group.question && (
                                <span className="max-w-full truncate text-xs text-muted-foreground md:max-w-xl">
                                  {group.question}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-3 p-3 sm:p-4">
                            {group.messages.map((message, index) => {
                              const isCandidate = message.role === "candidate";
                              const isSystem = message.role === "system";
                              return (
                                <div key={message._id || `${group.key}-${index}`} className={`flex gap-3 ${isCandidate ? "justify-end" : "justify-start"}`}>
                                  {!isCandidate && (
                                    <span className={`mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${
                                      isSystem ? "bg-slate-200 text-slate-700" : "bg-blue-50 text-blue-700"
                                    }`}>
                                      {isSystem ? <FileText className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                    </span>
                                  )}
                                  <div className={`max-w-[min(100%,820px)] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                                    isCandidate
                                      ? "rounded-br-md bg-slate-950 text-white"
                                      : isSystem
                                        ? "border bg-white text-slate-700"
                                        : "rounded-bl-md border bg-white text-slate-900"
                                  }`}>
                                    <div className={`mb-1 flex flex-wrap items-center gap-2 text-xs ${isCandidate ? "text-slate-300" : "text-muted-foreground"}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${isCandidate ? "bg-white/70" : isSystem ? "bg-slate-400" : "bg-blue-500"}`} />
                                      <span className="font-medium">{transcriptRoleLabel(message.role)}</span>
                                      {message.messageType && <span className="capitalize">{message.messageType.replace(/_/g, " ")}</span>}
                                      {message.createdAt && <span>{formatDate(message.createdAt)}</span>}
                                    </div>
                                    <div className="whitespace-pre-wrap leading-6">{message.content}</div>
                                  </div>
                                  {isCandidate && (
                                    <span className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white sm:flex">
                                      <UserRound className="h-4 w-4" />
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    ) : transcriptMessages.length ? (
                      <Alert>
                        <AlertDescription>No transcript messages match your search.</AlertDescription>
                      </Alert>
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
                              <span>Candidate review</span>
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
