"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Clock,
  FileQuestion,
  Loader2,
  Send,
  ShieldCheck,
  TimerReset,
  Workflow
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import aiInterviewService, { type PublicAIInterviewState } from "@/services/aiInterviewService";

function formatSeconds(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function secondsUntil(value?: string) {
  if (!value) return 0;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 1000);
}

function statusLabel(status?: string) {
  switch (status) {
    case "completed":
      return "Completed";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    case "in_progress":
      return "In progress";
    case "opened":
    case "sent":
      return "Ready";
    default:
      return status || "Loading";
  }
}

export default function PublicAIInterviewPage() {
  const params = useParams();
  const token = params.token as string;
  const [state, setState] = useState<PublicAIInterviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [questionSeconds, setQuestionSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [timeoutRunning, setTimeoutRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const session = state?.session;
  const interview = state?.interview;
  const questionCount = interview?.questionCount || 0;
  const currentIndex = session?.currentQuestionIndex || 0;
  const progress = questionCount > 0 ? ((currentIndex + (session?.status === "completed" ? 1 : 0)) / questionCount) * 100 : 0;

  const load = async () => {
    setLoading(true);
    try {
      const data = await aiInterviewService.bootstrapPublic(token);
      setState(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to load interview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.session?.messages?.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuestionSeconds(secondsUntil(state?.session?.questionDeadlineAt));
      setTotalSeconds(secondsUntil(state?.session?.totalDeadlineAt));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state?.session?.questionDeadlineAt, state?.session?.totalDeadlineAt]);

  useEffect(() => {
    setQuestionSeconds(secondsUntil(state?.session?.questionDeadlineAt));
    setTotalSeconds(secondsUntil(state?.session?.totalDeadlineAt));
  }, [state?.session?.questionDeadlineAt, state?.session?.totalDeadlineAt]);

  useEffect(() => {
    if (!state || state.session.status !== "in_progress") return;
    const remaining = secondsUntil(state.session.questionDeadlineAt);
    if (remaining > 0 || timeoutRunning) return;

    setTimeoutRunning(true);
    aiInterviewService.timeoutPublicQuestion(token)
      .then(setState)
      .catch((error) => toast.error(error.message || "Question timeout failed"))
      .finally(() => setTimeoutRunning(false));
  }, [questionSeconds, state, timeoutRunning, token]);

  const answeredIndexes = useMemo(() => {
    return new Set((session?.answers || []).filter((answer) => answer.status !== "draft").map((answer) => answer.questionIndex));
  }, [session?.answers]);

  const start = async () => {
    setStarting(true);
    try {
      const data = await aiInterviewService.startPublic(token);
      setState(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to start interview");
    } finally {
      setStarting(false);
    }
  };

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) return;

    setSending(true);
    setMessage("");
    try {
      const data = await aiInterviewService.sendPublicMessage(token, text);
      setState(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to send message");
      setMessage(text);
    } finally {
      setSending(false);
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      const data = await aiInterviewService.confirmPublicQuestion(token);
      setState(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to confirm answer");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70 p-4 md:p-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-2xl border bg-white/90 p-5 text-sm text-muted-foreground shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading interview...
        </div>
      </main>
    );
  }

  if (!state || !interview || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70 p-4 md:p-8">
        <div className="w-full max-w-2xl rounded-2xl border bg-white/95 p-8 shadow-xl">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>This interview link could not be opened.</AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  if (session.status === "completed") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70 p-4 md:p-8">
        <div className="w-full max-w-2xl rounded-2xl border bg-white/95 p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">Interview Completed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thank you, {state.candidate?.firstName || state.candidate?.name}. Your responses have been submitted.
          </p>
        </div>
      </main>
    );
  }

  if (["expired", "cancelled"].includes(session.status)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70 p-4 md:p-8">
        <div className="w-full max-w-2xl rounded-2xl border bg-white/95 p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <AlertCircle className="h-9 w-9" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">Interview {statusLabel(session.status)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">This interview is no longer accepting responses.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70">
      <div className="mx-auto grid max-w-screen-2xl gap-5 p-4 md:p-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-2xl border-0 bg-slate-950 text-white shadow-xl">
            <div className="border-b border-white/10 p-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <Workflow className="h-3.5 w-3.5" />
                Candidate interview
              </div>
              <h1 className="mt-3 text-xl font-semibold">{interview.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{state.job?.title}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="border-white/20 bg-white/10 text-white">{statusLabel(session.status)}</Badge>
                <Badge className="border-white/20 bg-white/10 text-white">{questionCount} questions</Badge>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-300">Progress</span>
                  <span className="font-medium">{Math.min(currentIndex + 1, questionCount)} / {questionCount}</span>
                </div>
                <Progress value={Math.min(100, progress)} className="h-2" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Clock className="h-4 w-4" />
                    Question
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {session.status === "in_progress" ? formatSeconds(questionSeconds) : `${interview.timers.perQuestionMinutes}:00`}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2 text-slate-400">
                    <TimerReset className="h-4 w-4" />
                    Total
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {session.status === "in_progress" ? formatSeconds(totalSeconds) : `${interview.timers.totalMinutes}:00`}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white/95 p-4 shadow-lg shadow-slate-200/70">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FileQuestion className="h-4 w-4 text-blue-600" />
              Workflow
            </div>
            <div className="space-y-2">
              {Array.from({ length: questionCount }).map((_, index) => {
                const isCurrent = session.status === "in_progress" && index === currentIndex;
                const isDone = answeredIndexes.has(index) || index < currentIndex;
                return (
                  <div
                    key={index}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                      isCurrent
                        ? "border-slate-900 bg-slate-900 text-white"
                        : isDone
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold ${isCurrent ? "bg-white text-slate-950" : "bg-white text-slate-700"}`}>
                      {index + 1}
                    </span>
                    <span>{isCurrent ? "Current question" : isDone ? "Completed" : "Pending"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="min-h-[calc(100vh-48px)] overflow-hidden rounded-2xl border bg-white/95 shadow-xl shadow-slate-200/70">
          {session.status !== "in_progress" ? (
            <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-4xl flex-col justify-center p-5 md:p-8">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Candidate guidelines
                    </div>
                    <h2 className="text-2xl font-semibold text-slate-950">Before You Start</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Review the structure, timing, and guidelines before starting the interview.
                    </p>
                  </div>
                  <Badge className="w-fit bg-slate-950 text-white">{statusLabel(session.status)}</Badge>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileQuestion className="h-4 w-4" />
                    Questions
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{questionCount}</div>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Per question
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{interview.timers.perQuestionMinutes}m</div>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TimerReset className="h-4 w-4" />
                    Total
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{interview.timers.totalMinutes}m</div>
                </div>
              </div>

              <div className="mt-5 whitespace-pre-wrap rounded-2xl border bg-slate-50 p-5 text-sm leading-6 text-slate-700">
                {interview.guidelines || "Answer each question clearly and use specific examples where possible."}
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-2xl border bg-white p-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-blue-600" />
                  <span>{state.job?.title || "Role interview"}</span>
                </div>
                <Button className="w-full bg-slate-950 text-white hover:bg-slate-800 md:w-auto" onClick={start} disabled={starting}>
                  {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Start Interview
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100vh-48px)] flex-col">
              <div className="border-b bg-slate-950 p-4 text-white">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm text-slate-300">Question {currentIndex + 1} of {questionCount}</div>
                    <h2 className="text-lg font-semibold">Interview Workspace</h2>
                  </div>
                  <Badge className="w-fit border-white/20 bg-white/10 text-white">Confirm required to move on</Badge>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4 md:p-5">
                {(session.messages || []).map((chat, index) => (
                  <div
                    key={chat._id || index}
                    className={`flex ${chat.role === "candidate" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        chat.role === "candidate"
                          ? "bg-slate-950 text-white"
                          : "border bg-white text-slate-900"
                      }`}
                    >
                      <div className="mb-1 text-xs opacity-70">
                        {chat.role === "candidate" ? "You" : "Interviewer"}
                      </div>
                      <div className="whitespace-pre-wrap">{chat.content}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="border-t bg-white p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Type your answer or ask for clarification..."
                    rows={3}
                    className="resize-none bg-slate-50"
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <Button variant="outline" onClick={sendMessage} disabled={sending || !message.trim()} className="min-h-[44px]">
                    {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Send
                  </Button>
                  <Button onClick={confirm} disabled={confirming || timeoutRunning} className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700">
                    {confirming || timeoutRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Confirm & Move On
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  The interview will auto-move when the question timer reaches zero.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
