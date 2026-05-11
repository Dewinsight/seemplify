"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpDown,
  Award,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  ListFilter,
  Loader2,
  Mail,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Timer,
  Trophy,
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
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

export default function AIInterviewDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [aiInterview, setAIInterview] = useState<AIInterview | null>(null);
  const [sessions, setSessions] = useState<AIInterviewSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rankingSearch, setRankingSearch] = useState("");
  const [rankingRecommendation, setRankingRecommendation] = useState("all");
  const [rankingSort, setRankingSort] = useState("score");

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
  const topSession = rankedSessions[0] || null;
  const scoreSpread = useMemo(() => {
    if (!rankedSessions.length) return null;
    const scores = rankedSessions.map((session) => getSessionScore(session) || 0);
    return Math.max(...scores) - Math.min(...scores);
  }, [rankedSessions]);
  const recommendationCounts = useMemo(() => {
    return rankedSessions.reduce<Record<string, number>>((counts, session) => {
      const key = session.scoring?.recommendation || "review";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }, [rankedSessions]);
  const scoreBands = useMemo(() => {
    return [
      { id: "priority", label: "Priority", count: rankedSessions.filter((session) => (getSessionScore(session) || 0) >= 85).length, className: "bg-emerald-500" },
      { id: "strong", label: "Strong review", count: rankedSessions.filter((session) => {
        const score = getSessionScore(session) || 0;
        return score >= 70 && score < 85;
      }).length, className: "bg-blue-500" },
      { id: "discussion", label: "Needs discussion", count: rankedSessions.filter((session) => {
        const score = getSessionScore(session) || 0;
        return score >= 55 && score < 70;
      }).length, className: "bg-amber-500" },
      { id: "low", label: "Low fit", count: rankedSessions.filter((session) => (getSessionScore(session) || 0) < 55).length, className: "bg-rose-500" }
    ];
  }, [rankedSessions]);
  const filteredReviewSessions = useMemo(() => {
    const term = rankingSearch.toLowerCase().trim();
    return [...orderedSessions]
      .filter((session) => {
        const searchable = `${candidateDisplayName(session)} ${session.candidateSnapshot?.email || ""}`.toLowerCase();
        const matchesSearch = !term || searchable.includes(term);
        const matchesRecommendation = rankingRecommendation === "all" || session.scoring?.recommendation === rankingRecommendation;
        return matchesSearch && matchesRecommendation;
      })
      .sort((a, b) => {
        if (rankingSort === "name") return candidateDisplayName(a).localeCompare(candidateDisplayName(b));
        if (rankingSort === "completed") return new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime();
        if (rankingSort === "answers") return answeredCount(b) - answeredCount(a);
        return (getSessionScore(b) || -1) - (getSessionScore(a) || -1);
      });
  }, [orderedSessions, rankingRecommendation, rankingSearch, rankingSort]);
  const filteredRankedSessions = useMemo(
    () => filteredReviewSessions.filter((session) => getSessionScore(session) !== null),
    [filteredReviewSessions]
  );
  const selectedRank = selectedSession
    ? rankedSessions.findIndex((session) => session._id === selectedSession._id) + 1
    : 0;
  const selectedScore = selectedSession ? getSessionScore(selectedSession) : null;
  const selectedBand = scoreBand(selectedScore);
  const selectedAnsweredCount = selectedSession ? answeredCount(selectedSession) : 0;
  const selectedAnswerTime = selectedSession ? totalAnswerTime(selectedSession) : 0;

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

        <Card className="overflow-hidden border-0 bg-white shadow-lg shadow-slate-200/70">
          <CardHeader className="border-b bg-slate-950 text-white">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-emerald-300" />
                  Candidate Ranking Board
                </CardTitle>
                <p className="mt-1 text-sm text-slate-300">
                  Sorted by AI score by default, with filters for recommendation and evidence review.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-right sm:min-w-[360px]">
                <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                  <div className="text-xs text-slate-300">Average</div>
                  <div className="text-2xl font-semibold">{averageScore ?? "-"}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                  <div className="text-xs text-slate-300">Scored</div>
                  <div className="text-2xl font-semibold">{rankedSessions.length}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                  <div className="text-xs text-slate-300">Spread</div>
                  <div className="text-2xl font-semibold">{scoreSpread ?? "-"}</div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <Award className="h-4 w-4 text-emerald-600" />
                      Current leader
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Avatar className="h-12 w-12 rounded-2xl">
                        <AvatarFallback className="rounded-2xl bg-slate-950 text-white">{candidateInitials(topSession || undefined)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold text-slate-950">
                          {topSession ? candidateDisplayName(topSession) : "No scored candidate yet"}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">{topSession?.candidateSnapshot?.email || "Scores appear after completion"}</div>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-[180px] rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Top score</span>
                      <Star className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="mt-1 text-4xl font-semibold text-slate-950">{topSession ? getSessionScore(topSession) : "-"}</div>
                    <Progress value={topSession ? getSessionScore(topSession) || 0 : 0} className="mt-3 h-2" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <BarChart3 className="h-4 w-4 text-blue-600" />
                    Score bands
                  </div>
                  <span className="text-xs text-muted-foreground">{rankedSessions.length} scored</span>
                </div>
                <div className="space-y-3">
                  {scoreBands.map((band) => {
                    const percentage = rankedSessions.length ? Math.round((band.count / rankedSessions.length) * 100) : 0;
                    return (
                      <div key={band.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{band.label}</span>
                          <span className="text-muted-foreground">{band.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${band.className}`} style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={rankingSearch}
                  onChange={(event) => setRankingSearch(event.target.value)}
                  placeholder="Search candidate name or email"
                  className="h-11 rounded-xl border-slate-200 bg-white pl-9"
                />
              </div>
              <Select value={rankingRecommendation} onValueChange={setRankingRecommendation}>
                <SelectTrigger className="h-11 rounded-xl">
                  <ListFilter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Recommendation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All recommendations</SelectItem>
                  {Object.keys(recommendationCounts).map((key) => (
                    <SelectItem key={key} value={key}>
                      {formatRecommendation(key)} ({recommendationCounts[key]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={rankingSort} onValueChange={setRankingSort}>
                <SelectTrigger className="h-11 rounded-xl">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">AI score highest</SelectItem>
                  <SelectItem value="answers">Answers completed</SelectItem>
                  <SelectItem value="completed">Recently completed</SelectItem>
                  <SelectItem value="name">Candidate name</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rankedSessions.length ? (
              <>
                <div className="hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="w-20">Rank</TableHead>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Recommendation</TableHead>
                        <TableHead>Evidence</TableHead>
                        <TableHead className="text-right">Review</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRankedSessions.map((session) => {
                        const score = getSessionScore(session);
                        const rank = rankedSessions.findIndex((item) => item._id === session._id) + 1;
                        const band = scoreBand(score);
                        return (
                          <TableRow
                            key={session._id}
                            onClick={() => setSelectedSessionId(session._id)}
                            data-state={selectedSession?._id === session._id ? "selected" : undefined}
                            className="cursor-pointer bg-white"
                          >
                            <TableCell>
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">
                                #{rank}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar className="h-10 w-10 rounded-xl">
                                  <AvatarFallback className="rounded-xl bg-slate-100 text-slate-700">{candidateInitials(session)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-950">{candidateDisplayName(session)}</div>
                                  <div className="truncate text-xs text-muted-foreground">{session.candidateSnapshot?.email}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="min-w-[150px]">
                                <div className="mb-1 flex items-center justify-between text-sm">
                                  <span className="font-semibold text-slate-950">{score}</span>
                                  <Badge variant="outline" className={band.className}>{band.label}</Badge>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100">
                                  <div className={`h-2 rounded-full ${band.barClassName}`} style={{ width: `${score || 0}%` }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={recommendationColor(session.scoring?.recommendation)}>
                                {formatRecommendation(session.scoring?.recommendation)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                                  <MessageSquareText className="h-3.5 w-3.5" />
                                  {answeredCount(session)} answers
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                                  <Timer className="h-3.5 w-3.5" />
                                  {formatDuration(totalAnswerTime(session))}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" type="button">
                                Open
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3 lg:hidden">
                  {filteredRankedSessions.map((session) => {
                    const score = getSessionScore(session);
                    const rank = rankedSessions.findIndex((item) => item._id === session._id) + 1;
                    const band = scoreBand(score);
                    return (
                      <button
                        key={session._id}
                        onClick={() => setSelectedSessionId(session._id)}
                        className={`w-full rounded-2xl border p-4 text-left shadow-sm ${
                          selectedSession?._id === session._id ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">
                              #{rank}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-950">{candidateDisplayName(session)}</div>
                              <div className="truncate text-xs text-muted-foreground">{session.candidateSnapshot?.email}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-semibold text-slate-950">{score}</div>
                            <div className="text-xs text-muted-foreground">/100</div>
                          </div>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${band.barClassName}`} style={{ width: `${score || 0}%` }} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline" className={band.className}>{band.label}</Badge>
                          <Badge variant="outline" className={recommendationColor(session.scoring?.recommendation)}>
                            {formatRecommendation(session.scoring?.recommendation)}
                          </Badge>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-muted-foreground">
                            <MessageSquareText className="h-3.5 w-3.5" />
                            {answeredCount(session)} answers
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <Alert>
                <AlertDescription>Ranking appears when candidates complete the interview and Llama scoring finishes.</AlertDescription>
              </Alert>
            )}
            {rankedSessions.length > 0 && filteredRankedSessions.length === 0 && (
              <Alert>
                <AlertDescription>No scored candidates match the current search and filter.</AlertDescription>
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
          <Card className="overflow-hidden border-0 bg-white shadow-sm">
            <CardHeader className="border-b bg-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-blue-600" />
                    Review Queue
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Uses the same search, filter, and sort as the ranking board.
                  </p>
                </div>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {filteredReviewSessions.length} shown
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[680px]">
                <div className="space-y-2 p-4">
                  {filteredReviewSessions.map((session) => {
                    const score = getSessionScore(session);
                    const rank = rankedSessions.findIndex((item) => item._id === session._id) + 1;
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
                                  {rank > 0 && (
                                    <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-white">#{rank}</span>
                                  )}
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
                  {!filteredReviewSessions.length && (
                    <Alert>
                      <AlertDescription>No candidate sessions match the current ranking filters.</AlertDescription>
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
                          {selectedRank > 0 && (
                            <Badge className="bg-slate-950 text-white">Rank #{selectedRank}</Badge>
                          )}
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
