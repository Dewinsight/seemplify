"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  History,
  Mic2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  SquarePen,
  Trophy,
  Upload,
  UserRound,
  WandSparkles,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { AIVoiceAvatar, AIVoiceWave } from "@/components/ai-voice-avatar";
import { getAIInterviewVoiceAvatar } from "@/lib/aiVoiceAvatars";
import aiInterviewService, {
  type AIInterview,
  type AIInterviewSession,
  type CVProcessingJobResponse
} from "@/services/aiInterviewService";
import { ADMIN_TOKEN_KEY, apiRequest, TOKEN_KEY } from "@/services/apiConfig";
import {
  buildCvRequestFingerprint,
  forgetCvUploadAttempt,
  getOrCreateCvUploadAttempt,
  reconcileAcceptedCvUploads,
  recordAcceptedCvUpload,
  type CvUploadAttempt
} from "@/utils/cvUploadPersistence";

type OptionsState = {
  jobs: Array<{ _id: string; title: string; department?: string; location?: string }>;
  candidates: Array<{ _id: string; name: string; firstName?: string; lastName?: string; email: string; jobId?: string }>;
  questions: Array<{ _id: string; jobId?: string; question: string; type?: string; difficulty?: string; category?: string }>;
  voices: Array<any>;
  tiers: Array<any>;
  defaultVoiceId: string;
  settings: any;
};

type CreatedLink = {
  sessionId: string;
  candidateName: string;
  candidateEmail: string;
  publicUrl: string;
};

type WalletState = {
  currency: string;
  balanceCents: number;
  balanceUsd: number;
  interviewPriceCents: number;
  interviewPriceUsd: number;
};

const fieldClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const panelClass = "rounded-[1.35rem] border border-slate-200 bg-white shadow-sm";

function dateTimeLocal(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function recommendationLabel(value?: string) {
  switch (value) {
    case "strong_yes": return "Strong yes";
    case "yes": return "Yes";
    case "maybe": return "Maybe";
    case "no": return "No";
    default: return "Review";
  }
}

function formatUsdFromCents(cents?: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function AIInterviewStandalonePage() {
  const router = useRouter();
  const [options, setOptions] = useState<OptionsState | null>(null);
  const [interviews, setInterviews] = useState<AIInterview[]>([]);
  const [selectedInterview, setSelectedInterview] = useState<(AIInterview & { sessions?: AIInterviewSession[] }) | null>(null);
  const [selectedSession, setSelectedSession] = useState<AIInterviewSession | null>(null);
  const [tab, setTab] = useState<"library" | "create" | "interviews">("interviews");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [successLinks, setSuccessLinks] = useState<CreatedLink[]>([]);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [user, setUser] = useState<any>(null);
  const [newJob, setNewJob] = useState({
    title: "",
    department: "",
    location: "",
    level: "",
    type: "",
    skills: "",
    description: "",
    requirements: "",
    responsibilities: ""
  });
  const [newCandidate, setNewCandidate] = useState({ name: "", email: "", phone: "", currentTitle: "", skills: "" });
  const [newQuestion, setNewQuestion] = useState({
    question: "",
    type: "behavioral",
    category: "",
    difficulty: "standard",
    expectedAnswer: ""
  });
  const [candidateProfile, setCandidateProfile] = useState<{ candidate: any; history: any[] } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [cvImporting, setCvImporting] = useState(false);
  const [cvProcessingJobs, setCvProcessingJobs] = useState<CVProcessingJobResponse[]>([]);
  const cvPollGeneration = useRef(0);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewUrlRef = useRef<string | null>(null);
  const [questionGeneration, setQuestionGeneration] = useState({
    questionCount: 5,
    difficulty: "medium",
    includeTypes: ["technical", "behavioral", "situational"] as string[],
    focusAreas: ""
  });
  const [form, setForm] = useState({
    title: "Product Owner AI Interview",
    jobId: "job_product_owner",
    candidateIds: ["cand_michael"] as string[],
    guestName: "",
    guestEmail: "",
    questionIds: ["q_agile_prioritization", "q_tradeoff"] as string[],
    guidelines: "Please answer each question with a specific example. You may ask for clarification before answering.",
    sendAt: dateTimeLocal(0),
    expiresAt: dateTimeLocal(7 * 24 * 60),
    perQuestionMinutes: 10,
    totalMinutes: 45,
    voiceId: "en-US-JennyMultilingualNeural"
  });

  const selectedJob = options?.jobs.find((job) => job._id === form.jobId);
  const jobCandidates = useMemo(
    () => options?.candidates.filter((candidate) => !candidate.jobId || candidate.jobId === form.jobId) || [],
    [form.jobId, options]
  );
  const jobQuestions = useMemo(
    () => options?.questions.filter((question) => !question.jobId || question.jobId === form.jobId) || [],
    [form.jobId, options]
  );
  const selectedVoice = options?.voices.find((voice) => voice.id === form.voiceId);

  const metrics = useMemo(() => {
    const allSessions = interviews.flatMap((interview: any) => interview.sessions || []);
    return {
      active: interviews.filter((interview) => ["active", "scheduled"].includes(interview.status)).length,
      completed: allSessions.filter((session) => session.status === "completed").length,
      proctorFailed: allSessions.filter((session) => session.status === "proctor_failed").length,
      averageScore: Math.round(
        allSessions
          .filter((session) => session.scoring?.status === "completed")
          .reduce((sum, session, _index, list) => sum + Number(session.scoring?.overallScore || 0) / Math.max(1, list.length), 0)
      )
    };
  }, [interviews]);

  const rememberCvJob = (job: CVProcessingJobResponse) => {
    setCvProcessingJobs((current) => [
      job,
      ...current.filter((item) => item.jobId !== job.jobId)
    ].filter((item) => !["completed", "cancelled"].includes(item.state)));
  };

  const reconcileCvJobs = (actorId: string, jobs: CVProcessingJobResponse[]) => {
    reconcileAcceptedCvUploads(actorId, jobs);
    for (const job of jobs) {
      if (["completed", "cancelled"].includes(job.state) && job.requestFingerprint) {
        forgetCvUploadAttempt(actorId, job.requestFingerprint);
      }
    }
    return jobs.filter((job) => [
      "queued",
      "waiting_for_chatgpt",
      "processing",
      "failed"
    ].includes(job.state));
  };

  const load = async () => {
    setLoading(true);
    try {
      if (typeof window !== "undefined" && !localStorage.getItem(TOKEN_KEY)) {
        router.replace("/login");
        return;
      }

      const meResponse = await apiRequest("/api/auth/me");
      if (!meResponse.ok) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(ADMIN_TOKEN_KEY);
        }
        router.replace("/login");
        return;
      }
      const mePayload = await meResponse.json();
      if (mePayload.user?.role !== "recruiter") {
        router.replace("/admin");
        return;
      }
      setUser(mePayload.user);

      const [optionsPayload, listPayload, walletResponse, cvJobs] = await Promise.all([
        aiInterviewService.getOptions() as Promise<OptionsState>,
        aiInterviewService.list(),
        apiRequest("/api/wallet").then((response) => response.json()),
        aiInterviewService.listCvProcessingJobs({ limit: 50 })
      ]);
      setOptions(optionsPayload);
      setWallet(walletResponse.wallet);
      setInterviews(listPayload);
      setCvProcessingJobs(reconcileCvJobs(mePayload.user.id, cvJobs));
      if (!selectedInterview && listPayload[0]) setSelectedInterview(listPayload[0] as any);
      setForm((current) => ({
        ...current,
        jobId: current.jobId || optionsPayload.jobs[0]?._id || "",
        voiceId: current.voiceId || optionsPayload.defaultVoiceId,
        questionIds: current.questionIds.length ? current.questionIds : optionsPayload.questions.slice(0, 2).map((question) => question._id)
      }));
    } catch (error: any) {
      toast.error(error.message || "Failed to load AI interview workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const jobs = await aiInterviewService.listCvProcessingJobs({ limit: 50 });
        if (stopped) return;
        setCvProcessingJobs(reconcileCvJobs(user.id, jobs));
      } catch {
        // The accepted descriptors remain in actor-scoped storage until the API recovers.
      }
    };
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!options) return;
    void aiInterviewService.estimateCost({
      candidateCount: form.candidateIds.length + (form.guestEmail ? 1 : 0),
      questionCount: form.questionIds.length,
      totalMinutes: form.totalMinutes,
      voiceId: form.voiceId
    }).then(setCostEstimate).catch(() => setCostEstimate(null));
  }, [form.candidateIds.length, form.guestEmail, form.questionIds.length, form.totalMinutes, form.voiceId, options]);

  const toggleCandidate = (candidateId: string) => {
    setForm((current) => ({
      ...current,
      candidateIds: current.candidateIds.includes(candidateId)
        ? current.candidateIds.filter((id) => id !== candidateId)
        : [...current.candidateIds, candidateId]
    }));
  };

  const toggleQuestion = (questionId: string) => {
    setForm((current) => ({
      ...current,
      questionIds: current.questionIds.includes(questionId)
        ? current.questionIds.filter((id) => id !== questionId)
        : [...current.questionIds, questionId]
    }));
  };

  const createInterview = async () => {
    setCreating(true);
    try {
      const guestRecipients = form.guestEmail ? [{ name: form.guestName || form.guestEmail, email: form.guestEmail }] : [];
      const result: any = await aiInterviewService.create({
        title: form.title,
        jobId: form.jobId,
        candidateIds: form.candidateIds,
        guestRecipients,
        questionIds: form.questionIds,
        guidelines: form.guidelines,
        sendAt: new Date(form.sendAt).toISOString(),
        expiresAt: new Date(form.expiresAt).toISOString(),
        perQuestionMinutes: form.perQuestionMinutes,
        totalMinutes: form.totalMinutes,
        voiceId: form.voiceId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      } as any);
      setSuccessLinks(result.publicLinks || []);
      toast.success("AI interview scheduled and invitation links prepared.");
      setTab("interviews");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Could not create AI interview");
    } finally {
      setCreating(false);
    }
  };

  const openInterview = async (interview: AIInterview) => {
    const details = await aiInterviewService.get(interview._id);
    setSelectedInterview({ ...(details.aiInterview as any), sessions: details.sessions });
    setSelectedSession(details.sessions[0] || null);
  };

  const playVoice = async (voiceId: string) => {
    try {
      voicePreviewRef.current?.pause();
      if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
      setPreviewingVoiceId(voiceId);
      const blob = await aiInterviewService.previewVoice({ voiceId });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voicePreviewRef.current = audio;
      voicePreviewUrlRef.current = url;
      const finish = () => {
        URL.revokeObjectURL(url);
        if (voicePreviewUrlRef.current === url) voicePreviewUrlRef.current = null;
        if (voicePreviewRef.current === audio) voicePreviewRef.current = null;
        setPreviewingVoiceId((current) => current === voiceId ? null : current);
      };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch (error: any) {
      voicePreviewRef.current?.pause();
      if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
      voicePreviewRef.current = null;
      voicePreviewUrlRef.current = null;
      setPreviewingVoiceId(null);
      toast.error(error.message || "Voice preview is unavailable");
    }
  };

  useEffect(() => () => {
    cvPollGeneration.current += 1;
    voicePreviewRef.current?.pause();
    if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
  }, []);

  const waitForCvProcessing = async (initial: CVProcessingJobResponse) => {
    const generation = ++cvPollGeneration.current;
    let current = initial;
    rememberCvJob(current);
    while (generation === cvPollGeneration.current) {
      if (current.state === "completed") {
        if (user?.id && current.requestFingerprint) {
          forgetCvUploadAttempt(user.id, current.requestFingerprint);
        }
        setCvProcessingJobs((jobs) => jobs.filter((job) => job.jobId !== current.jobId));
        return current;
      }
      if (current.state === "failed") {
        throw new Error(current.error?.message || "CV processing failed.");
      }
      if (current.state === "cancelled") throw new Error("CV processing was cancelled.");
      await new Promise((resolve) => window.setTimeout(resolve, current.state === "processing" ? 1200 : 2200));
      try {
        current = await aiInterviewService.getCvProcessingJob({
          jobId: initial.jobId,
          statusToken: initial.statusToken,
          statusUrl: initial.statusUrl
        });
        rememberCvJob(current);
      } catch {
        // The job is durable; transient polling failures should not turn into a failed upload.
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    }
    throw new Error("CV status polling stopped.");
  };

  const createJob = async () => {
    try {
      const job = await aiInterviewService.createJob({
        ...newJob,
        skills: newJob.skills.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)
      });
      toast.success("Job created.");
      setNewJob({ title: "", department: "", location: "", level: "", type: "", skills: "", description: "", requirements: "", responsibilities: "" });
      await load();
      setForm((current) => ({ ...current, jobId: job._id, candidateIds: [], questionIds: [] }));
    } catch (error: any) {
      toast.error(error.message || "Could not create job");
    }
  };

  const createCandidate = async () => {
    try {
      if (!form.jobId) throw new Error("Select or create a job first.");
      const candidate = await aiInterviewService.createCandidate({
        ...newCandidate,
        skills: newCandidate.skills.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean),
        jobId: form.jobId
      } as any);
      toast.success("Candidate added.");
      setNewCandidate({ name: "", email: "", phone: "", currentTitle: "", skills: "" });
      await load();
      setForm((current) => ({ ...current, candidateIds: Array.from(new Set([...current.candidateIds, candidate._id])) }));
      await openCandidateProfile(candidate._id);
    } catch (error: any) {
      toast.error(error.message || "Could not add candidate");
    }
  };

  const createQuestion = async () => {
    try {
      if (!form.jobId) throw new Error("Select or create a job first.");
      const question = await aiInterviewService.createQuestion({ ...newQuestion, jobId: form.jobId });
      toast.success("Question added.");
      setNewQuestion({ question: "", type: "behavioral", category: "", difficulty: "standard", expectedAnswer: "" });
      await load();
      setForm((current) => ({ ...current, questionIds: Array.from(new Set([...current.questionIds, question._id])) }));
    } catch (error: any) {
      toast.error(error.message || "Could not add question");
    }
  };

  const openCandidateProfile = async (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    setProfileLoading(true);
    try {
      const profile = await aiInterviewService.getCandidateProfile(candidateId);
      setCandidateProfile(profile);
    } catch (error: any) {
      toast.error(error.message || "Could not load candidate profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const importCandidateCv = async (file?: File | null) => {
    if (!file) return;
    if (!form.jobId) {
      toast.error("Select or create a job before importing a CV.");
      return;
    }
    if (!user?.id) return;
    setCvImporting(true);
    let attempt: CvUploadAttempt | null = null;
    try {
      const fingerprint = await buildCvRequestFingerprint(file, {
        mode: "import",
        jobId: form.jobId
      });
      attempt = getOrCreateCvUploadAttempt(user.id, {
        fingerprint,
        mode: "import",
        jobId: form.jobId
      });
      const accepted = await aiInterviewService.importCandidateCv({
        jobId: form.jobId,
        file,
        idempotencyKey: attempt.idempotencyKey
      });
      const queued = {
        ...accepted,
        requestFingerprint: accepted.requestFingerprint || fingerprint
      };
      recordAcceptedCvUpload(user.id, fingerprint, queued);
      toast.success("CV queued for local analysis.");
      const result = await waitForCvProcessing(queued);
      if (!result.candidate) throw new Error("CV processing completed without a candidate.");
      const candidate = result.candidate;
      toast.success(`${candidate.name} imported from CV.`);
      await load();
      setForm((current) => ({ ...current, candidateIds: Array.from(new Set([...current.candidateIds, candidate._id])) }));
      setCandidateProfile({ candidate, history: result.history || [] });
      setSelectedCandidateId(candidate._id);
    } catch (error: any) {
      if (attempt && Number(error?.status || 0) >= 400 && Number(error?.status || 0) < 500) {
        forgetCvUploadAttempt(user.id, attempt.fingerprint);
      }
      toast.error(error.message || "Could not import CV");
    } finally {
      setCvImporting(false);
    }
  };

  const enrichCandidateCv = async (file?: File | null) => {
    if (!file || !selectedCandidateId) return;
    if (!user?.id) return;
    setCvImporting(true);
    let attempt: CvUploadAttempt | null = null;
    try {
      const targetJobId = candidateProfile?.candidate?.jobId
        ?? options?.candidates.find((candidate) => candidate._id === selectedCandidateId)?.jobId
        ?? "";
      const fingerprint = await buildCvRequestFingerprint(file, {
        mode: "enrich",
        jobId: targetJobId,
        candidateId: selectedCandidateId
      });
      attempt = getOrCreateCvUploadAttempt(user.id, {
        fingerprint,
        mode: "enrich",
        jobId: targetJobId,
        candidateId: selectedCandidateId
      });
      const accepted = await aiInterviewService.enrichCandidateCv({
        candidateId: selectedCandidateId,
        file,
        idempotencyKey: attempt.idempotencyKey
      });
      const queued = {
        ...accepted,
        requestFingerprint: accepted.requestFingerprint || fingerprint
      };
      recordAcceptedCvUpload(user.id, fingerprint, queued);
      toast.success("CV queued for local analysis.");
      const result = await waitForCvProcessing(queued);
      if (!result.candidate) throw new Error("CV processing completed without a candidate.");
      toast.success(`${result.candidate.name} updated from CV.`);
      await load();
      setCandidateProfile({ candidate: result.candidate, history: result.history || [] });
    } catch (error: any) {
      if (attempt && Number(error?.status || 0) >= 400 && Number(error?.status || 0) < 500) {
        forgetCvUploadAttempt(user.id, attempt.fingerprint);
      }
      toast.error(error.message || "Could not enrich candidate profile");
    } finally {
      setCvImporting(false);
    }
  };

  const retryCvProcessing = async (job: CVProcessingJobResponse) => {
    try {
      const retried = await aiInterviewService.retryCvProcessingJob(job.jobId);
      rememberCvJob(retried);
      if (user?.id && job.requestFingerprint) {
        recordAcceptedCvUpload(user.id, job.requestFingerprint, retried);
      }
      toast.success("CV processing queued again.");
    } catch (error: any) {
      toast.error(error.message || "Could not retry CV processing");
    }
  };

  const importCandidatesTable = async (file?: File | null) => {
    if (!file) return;
    if (!form.jobId) {
      toast.error("Select or create a job before importing candidates.");
      return;
    }
    setBulkImporting(true);
    try {
      const result = await aiInterviewService.importCandidatesTable({ jobId: form.jobId, file });
      toast.success(`Imported ${result.importedCount}, updated ${result.updatedCount}${result.skippedCount ? `, skipped ${result.skippedCount}` : ""}.`);
      await load();
    } catch (error: any) {
      toast.error(error.message || "Could not import candidate table");
    } finally {
      setBulkImporting(false);
    }
  };

  const generateQuestions = async () => {
    if (!form.jobId) {
      toast.error("Select or create a job before generating questions.");
      return;
    }
    setGenerating(true);
    try {
      const questions = await aiInterviewService.generateQuestions({
        jobId: form.jobId,
        questionCount: questionGeneration.questionCount,
        difficulty: questionGeneration.difficulty,
        includeTypes: questionGeneration.includeTypes,
        focusAreas: questionGeneration.focusAreas.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)
      });
      toast.success(`Generated ${questions.length} interview questions.`);
      await load();
      setForm((current) => ({
        ...current,
        questionIds: Array.from(new Set([...current.questionIds, ...questions.map((question) => question._id)]))
      }));
    } catch (error: any) {
      toast.error(error.message || "Could not generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const logout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
    router.replace("/login");
  };

  if (loading && !options) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">Loading standalone AI Interview...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_34%),linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)] text-slate-950">
      <header className="sticky top-0 z-30 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
              <Mic2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">AI Interview</div>
              <div className="text-xs text-slate-500">Standalone workflow, voice, scoring, and proctoring</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border bg-white p-1 sm:flex">
            {(["library", "create", "interviews"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${tab === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {user && <div className="hidden text-right text-xs text-slate-500 md:block"><div className="font-semibold text-slate-900">{user.name}</div><div>{user.email}</div></div>}
            <button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold shadow-sm">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button onClick={logout} className="inline-flex h-10 items-center rounded-xl border bg-white px-3 text-sm font-semibold shadow-sm">
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Active interviews", value: metrics.active, icon: CalendarClock, tone: "bg-blue-50 text-blue-700" },
            { label: "Completed sessions", value: metrics.completed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
            { label: "Avg score", value: metrics.averageScore || 0, icon: Trophy, tone: "bg-violet-50 text-violet-700" },
            { label: "Wallet balance", value: wallet ? formatUsdFromCents(wallet.balanceCents) : "$0.00", icon: CircleDollarSign, tone: "bg-amber-50 text-amber-700" }
          ].map((metric) => (
            <div key={metric.label} className={`${panelClass} p-4`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-500">{metric.label}</div>
                <div className={`rounded-xl p-2 ${metric.tone}`}><metric.icon className="h-4 w-4" /></div>
              </div>
              <div className="mt-3 text-3xl font-bold">{metric.value}</div>
            </div>
          ))}
        </section>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:hidden">
          {(["library", "create", "interviews"] as const).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-xl px-3 py-2 text-sm font-semibold capitalize ${tab === item ? "bg-slate-950 text-white" : "border bg-white"}`}>{item}</button>
          ))}
        </div>

        {successLinks.length > 0 && (
          <section className="mt-6 rounded-[1.35rem] border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
              <CheckCircle2 className="h-5 w-5" />
              AI interview scheduled successfully
            </div>
            <p className="mt-1 text-sm text-emerald-800">Use these generated links to test the standalone candidate flow.</p>
            <div className="mt-4 grid gap-3">
              {successLinks.map((link) => (
                <a key={link.sessionId} href={link.publicUrl} target="_blank" className="rounded-xl border bg-white px-4 py-3 text-sm font-medium text-blue-700 shadow-sm" rel="noreferrer">
                  {link.candidateName} - {link.publicUrl}
                </a>
              ))}
            </div>
          </section>
        )}

        {tab === "library" && options && (
          <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
            <div className="space-y-5">
              <div className={`${panelClass} p-5`}>
                <div className="flex items-center gap-2 text-xl font-semibold"><BriefcaseBusiness className="h-5 w-5 text-blue-600" />Jobs</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {options.jobs.map((job) => (
                    <button
                      key={job._id}
                      onClick={() => setForm((current) => ({ ...current, jobId: job._id, candidateIds: [], questionIds: [] }))}
                      className={`rounded-2xl border p-4 text-left transition ${form.jobId === job._id ? "border-blue-300 bg-blue-50" : "bg-white hover:bg-slate-50"}`}
                    >
                      <div className="font-semibold">{job.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{job.department || "No department"} {job.location ? `- ${job.location}` : ""}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className={`${panelClass} p-5`}>
                  <div className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5 text-emerald-600" />Candidates for {selectedJob?.title || "selected job"}</div>
                  <div className="mt-4 space-y-2">
                    {jobCandidates.length ? jobCandidates.map((candidate) => (
                      <button
                        key={candidate._id}
                        type="button"
                        onClick={() => void openCandidateProfile(candidate._id)}
                        className={`w-full rounded-2xl border p-3 text-left transition ${selectedCandidateId === candidate._id ? "border-emerald-300 bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{candidate.name}</div>
                            <div className="text-xs text-slate-500">{candidate.email}</div>
                          </div>
                          {(candidate as any).currentTitle && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{(candidate as any).currentTitle}</span>}
                        </div>
                        {Array.isArray((candidate as any).skills) && (candidate as any).skills.length > 0 && (
                          <div className="mt-2 line-clamp-1 text-xs text-slate-500">{(candidate as any).skills.slice(0, 6).join(", ")}</div>
                        )}
                      </button>
                    )) : <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-500">No saved candidates for this job yet. Add one or import a CV/CSV file.</div>}
                  </div>
                </div>

                <div className={`${panelClass} p-5`}>
                  <div className="flex items-center gap-2 text-lg font-semibold"><SquarePen className="h-5 w-5 text-violet-600" />Questions for {selectedJob?.title || "selected job"}</div>
                  <div className="mt-3 rounded-2xl border bg-violet-50/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-violet-950"><WandSparkles className="h-4 w-4" />Generate with AI harness</div>
                        <div className="mt-1 text-xs text-violet-700">Uses the standalone Llama/Azure harness and this job profile.</div>
                      </div>
                      <button onClick={() => void generateQuestions()} disabled={generating} className="rounded-xl bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                        {generating ? "Generating..." : "Generate"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {jobQuestions.length ? jobQuestions.map((question, index) => (
                      <div key={question._id} className="rounded-2xl border bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question {index + 1} - {question.difficulty || "standard"}</div>
                        <div className="mt-1 text-sm font-medium">{question.question}</div>
                      </div>
                    )) : <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-500">No questions for this job yet. Add one before scheduling an interview.</div>}
                  </div>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className={`${panelClass} p-5`}>
                <div className="text-lg font-semibold">Add job</div>
                <div className="mt-4 grid gap-3">
                  <input className={fieldClass} value={newJob.title} onChange={(event) => setNewJob({ ...newJob, title: event.target.value })} placeholder="Job title" />
                  <input className={fieldClass} value={newJob.department} onChange={(event) => setNewJob({ ...newJob, department: event.target.value })} placeholder="Department" />
                  <input className={fieldClass} value={newJob.location} onChange={(event) => setNewJob({ ...newJob, location: event.target.value })} placeholder="Location" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className={fieldClass} value={newJob.level} onChange={(event) => setNewJob({ ...newJob, level: event.target.value })} placeholder="Level" />
                    <input className={fieldClass} value={newJob.type} onChange={(event) => setNewJob({ ...newJob, type: event.target.value })} placeholder="Employment type" />
                  </div>
                  <input className={fieldClass} value={newJob.skills} onChange={(event) => setNewJob({ ...newJob, skills: event.target.value })} placeholder="Key skills, comma separated" />
                  <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={newJob.description} onChange={(event) => setNewJob({ ...newJob, description: event.target.value })} placeholder="Short role description" />
                  <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={newJob.requirements} onChange={(event) => setNewJob({ ...newJob, requirements: event.target.value })} placeholder="Requirements" />
                  <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={newJob.responsibilities} onChange={(event) => setNewJob({ ...newJob, responsibilities: event.target.value })} placeholder="Responsibilities" />
                  <button onClick={() => void createJob()} className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">Create job</button>
                </div>
              </div>

              <div className={`${panelClass} p-5`}>
                <div className="text-lg font-semibold">Add candidate</div>
                <div className="mt-2 text-xs text-slate-500">Saved under {selectedJob?.title || "the selected job"}.</div>
                <div className="mt-4 grid gap-3">
                  <input className={fieldClass} value={newCandidate.name} onChange={(event) => setNewCandidate({ ...newCandidate, name: event.target.value })} placeholder="Full name" />
                  <input className={fieldClass} value={newCandidate.email} onChange={(event) => setNewCandidate({ ...newCandidate, email: event.target.value })} placeholder="email@example.com" />
                  <input className={fieldClass} value={newCandidate.phone} onChange={(event) => setNewCandidate({ ...newCandidate, phone: event.target.value })} placeholder="Phone optional" />
                  <input className={fieldClass} value={newCandidate.currentTitle} onChange={(event) => setNewCandidate({ ...newCandidate, currentTitle: event.target.value })} placeholder="Current title optional" />
                  <input className={fieldClass} value={newCandidate.skills} onChange={(event) => setNewCandidate({ ...newCandidate, skills: event.target.value })} placeholder="Skills, comma separated" />
                  <button onClick={() => void createCandidate()} className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">Add candidate</button>
                </div>
              </div>

              <div className={`${panelClass} p-5`}>
                <div className="flex items-center gap-2 text-lg font-semibold"><Upload className="h-5 w-5 text-emerald-600" />Import candidates</div>
                <div className="mt-2 text-xs leading-5 text-slate-500">Import one CV for AI parsing, or bulk import CSV/XLSX rows with name, email, phone, title, and skills columns.</div>
                <div className="mt-4 grid gap-3">
                  {cvProcessingJobs.length > 0 && (
                    <div className="divide-y rounded-lg border bg-white">
                      {cvProcessingJobs.map((job) => {
                        const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
                        const failed = job.state === "failed";
                        const label = failed
                          ? "Processing failed"
                          : job.state === "waiting_for_chatgpt"
                            ? "Waiting for ChatGPT"
                            : job.state === "processing"
                              ? "Analysing CV"
                              : "Queued";
                        return (
                          <div key={job.jobId} className="px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{job.fileName || "CV upload"}</div>
                                <div className={`mt-0.5 text-xs ${failed ? "text-red-700" : "text-slate-600"}`}>{label}</div>
                              </div>
                              {failed && job.retryable ? (
                                <button
                                  type="button"
                                  onClick={() => void retryCvProcessing(job)}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-semibold hover:bg-slate-50"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />Retry
                                </button>
                              ) : <span className="text-xs font-medium text-slate-600">{progress}%</span>}
                            </div>
                            {!failed && (
                              <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                                <div className="h-full bg-slate-700 transition-[width] duration-500" style={{ width: `${Math.max(4, progress)}%` }} />
                              </div>
                            )}
                            <div className="mt-2 text-[11px] leading-4 text-slate-500">
                              {failed
                                ? job.retryable
                                  ? "The saved upload can be retried without selecting the file again."
                                  : "Upload the CV again to create a new processing job."
                                : `${job.position ? `Queue position ${job.position}. ` : ""}The upload is stored durably.`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-white p-3 text-sm font-semibold hover:bg-slate-50">
                    <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-600" />Import one CV</span>
                    <span className="text-xs text-slate-500">{cvImporting ? "Working..." : "PDF/DOCX/TXT"}</span>
                    <input type="file" accept=".pdf,.docx,.txt" className="hidden" disabled={cvImporting} onChange={(event) => void importCandidateCv(event.target.files?.[0])} />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-white p-3 text-sm font-semibold hover:bg-slate-50">
                    <span className="flex items-center gap-2"><Users className="h-4 w-4 text-emerald-600" />Bulk import list</span>
                    <span className="text-xs text-slate-500">{bulkImporting ? "Working..." : "CSV/XLSX"}</span>
                    <input type="file" accept=".csv,.xlsx" className="hidden" disabled={bulkImporting} onChange={(event) => void importCandidatesTable(event.target.files?.[0])} />
                  </label>
                  {selectedCandidateId && (
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-blue-50 p-3 text-sm font-semibold text-blue-950 hover:bg-blue-100">
                      <span className="flex items-center gap-2"><UserRound className="h-4 w-4" />Enhance selected profile</span>
                      <span className="text-xs text-blue-700">CV</span>
                      <input type="file" accept=".pdf,.docx,.txt" className="hidden" disabled={cvImporting} onChange={(event) => void enrichCandidateCv(event.target.files?.[0])} />
                    </label>
                  )}
                </div>
              </div>

              <div className={`${panelClass} p-5`}>
                <div className="flex items-center gap-2 text-lg font-semibold"><History className="h-5 w-5 text-slate-700" />Candidate profile</div>
                {profileLoading ? (
                  <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-500">Loading profile...</div>
                ) : candidateProfile ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl bg-slate-950 p-4 text-white">
                      <div className="text-lg font-semibold">{candidateProfile.candidate.name}</div>
                      <div className="text-sm text-white/70">{candidateProfile.candidate.currentTitle || "Candidate"} - {candidateProfile.candidate.email}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(candidateProfile.candidate.skills || []).slice(0, 8).map((skill: string) => (
                          <span key={skill} className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{skill}</span>
                        ))}
                      </div>
                    </div>
                    {candidateProfile.candidate.summary && (
                      <p className="rounded-2xl border bg-white p-3 text-sm leading-6 text-slate-700">{candidateProfile.candidate.summary}</p>
                    )}
                    <div className="rounded-2xl border bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Interview history</div>
                      {candidateProfile.history?.length ? candidateProfile.history.slice(0, 5).map((item: any) => (
                        <div key={item.session._id} className="border-t py-2 first:border-t-0">
                          <div className="text-sm font-semibold">{item.interview?.title || "AI interview"}</div>
                          <div className="text-xs text-slate-500">{item.job?.title || "Job"} - {item.session.status} {item.scoring?.overallScore !== undefined ? `- Score ${item.scoring.overallScore}` : ""}</div>
                        </div>
                      )) : <div className="text-sm text-slate-500">No interview history yet.</div>}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-500">Select a candidate to view CV analysis, profile enrichment, and interview history.</div>
                )}
              </div>

              <div className={`${panelClass} p-5`}>
                <div className="text-lg font-semibold">Add interview question</div>
                <div className="mt-2 text-xs text-slate-500">Hidden scoring notes stay recruiter-only and are used by final scoring.</div>
                <div className="mt-4 rounded-2xl border bg-violet-50 p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-violet-950"><WandSparkles className="h-4 w-4" />Generate from job context</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input type="number" min={1} max={20} className={fieldClass} value={questionGeneration.questionCount} onChange={(event) => setQuestionGeneration({ ...questionGeneration, questionCount: Number(event.target.value) })} />
                    <select className={fieldClass} value={questionGeneration.difficulty} onChange={(event) => setQuestionGeneration({ ...questionGeneration, difficulty: event.target.value })}>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                      <option value="senior">Senior</option>
                    </select>
                  </div>
                  <input className={`${fieldClass} mt-3`} value={questionGeneration.focusAreas} onChange={(event) => setQuestionGeneration({ ...questionGeneration, focusAreas: event.target.value })} placeholder="Optional focus areas, comma separated" />
                  <button onClick={() => void generateQuestions()} disabled={generating} className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-violet-700 text-sm font-semibold text-white disabled:opacity-60">
                    {generating ? "Generating..." : "Generate questions"}
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={newQuestion.question} onChange={(event) => setNewQuestion({ ...newQuestion, question: event.target.value })} placeholder="Question text" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className={fieldClass} value={newQuestion.type} onChange={(event) => setNewQuestion({ ...newQuestion, type: event.target.value })} placeholder="Type" />
                    <input className={fieldClass} value={newQuestion.difficulty} onChange={(event) => setNewQuestion({ ...newQuestion, difficulty: event.target.value })} placeholder="Difficulty" />
                  </div>
                  <input className={fieldClass} value={newQuestion.category} onChange={(event) => setNewQuestion({ ...newQuestion, category: event.target.value })} placeholder="Category" />
                  <textarea className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={newQuestion.expectedAnswer} onChange={(event) => setNewQuestion({ ...newQuestion, expectedAnswer: event.target.value })} placeholder="Expected answer / scoring notes for AI scoring" />
                  <button onClick={() => void createQuestion()} className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">Add question</button>
                </div>
              </div>
            </aside>
          </section>
        )}

        {tab === "create" && options && (
          <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className={`${panelClass} p-5`}>
              <div className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="h-5 w-5 text-blue-600" />Create AI interview</div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">Interview title
                  <input className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Job
                  <select className={fieldClass} value={form.jobId} onChange={(event) => setForm({ ...form, jobId: event.target.value, candidateIds: [], questionIds: [] })}>
                    {options.jobs.map((job) => <option key={job._id} value={job._id}>{job.title}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium">Send time
                  <input type="datetime-local" className={fieldClass} value={form.sendAt} onChange={(event) => setForm({ ...form, sendAt: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Expiry deadline
                  <input type="datetime-local" className={fieldClass} value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Per question minutes
                  <input type="number" className={fieldClass} value={form.perQuestionMinutes} onChange={(event) => setForm({ ...form, perQuestionMinutes: Number(event.target.value) })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Total minutes
                  <input type="number" className={fieldClass} value={form.totalMinutes} onChange={(event) => setForm({ ...form, totalMinutes: Number(event.target.value) })} />
                </label>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold">Candidates</div>
                  <button
                    className="text-sm font-semibold text-blue-700"
                    onClick={() => setForm((current) => ({ ...current, candidateIds: current.candidateIds.length === jobCandidates.length ? [] : jobCandidates.map((candidate) => candidate._id) }))}
                  >
                    Bulk select
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {jobCandidates.map((candidate) => (
                    <button key={candidate._id} onClick={() => toggleCandidate(candidate._id)} className={`rounded-2xl border p-3 text-left ${form.candidateIds.includes(candidate._id) ? "border-blue-300 bg-blue-50" : "bg-white"}`}>
                      <div className="font-semibold">{candidate.name}</div>
                      <div className="text-xs text-slate-500">{candidate.email}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 rounded-2xl border bg-slate-50 p-3 md:grid-cols-2">
                  <label className="text-sm font-medium">Guest full name
                    <input className={fieldClass} value={form.guestName} onChange={(event) => setForm({ ...form, guestName: event.target.value })} placeholder="Guest Candidate" />
                  </label>
                  <label className="text-sm font-medium">Guest email
                    <input className={fieldClass} value={form.guestEmail} onChange={(event) => setForm({ ...form, guestEmail: event.target.value })} placeholder="guest@example.com" />
                  </label>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold">Questions</div>
                <div className="grid gap-2">
                  {jobQuestions.map((question, index) => (
                    <button key={question._id} onClick={() => toggleQuestion(question._id)} className={`rounded-2xl border p-3 text-left ${form.questionIds.includes(question._id) ? "border-emerald-300 bg-emerald-50" : "bg-white"}`}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question {index + 1} - {question.difficulty || "standard"}</div>
                      <div className="mt-1 text-sm font-medium">{question.question}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="mt-5 block space-y-1.5 text-sm font-medium">Candidate-facing guidelines
                <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" value={form.guidelines} onChange={(event) => setForm({ ...form, guidelines: event.target.value })} />
              </label>
            </div>

            <aside className="space-y-4">
              <div className={`${panelClass} p-5`}>
                <div className="flex items-center gap-2 text-lg font-semibold"><Mic2 className="h-5 w-5 text-blue-600" />Voice</div>
                <div className="mt-4 grid gap-2">
                  {options.voices.map((voice) => {
                    const selected = form.voiceId === voice.id;
                    const previewing = previewingVoiceId === voice.id;
                    const avatar = getAIInterviewVoiceAvatar(voice);
                    return (
                      <div key={voice.id} className={`rounded-lg border p-3 ${selected ? "border-blue-300 bg-blue-50" : "bg-white"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setForm({ ...form, voiceId: voice.id })} aria-pressed={selected}>
                            <AIVoiceAvatar voice={voice} size="lg" active={previewing} decorative className="ring-1 ring-slate-200" />
                            <div className="min-w-0">
                              <div className="font-semibold">{voice.displayName}</div>
                              <div className="text-xs text-slate-500">{voice.tierLabel} - included in wallet price</div>
                              <div className="mt-2 text-xs leading-5 text-slate-600">{voice.description}</div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                <AIVoiceWave active={previewing} compact level={previewing ? 72 : 18} tone={avatar.tone} />
                                <span>{previewing ? "Playing sample" : avatar.label}</span>
                              </div>
                            </div>
                          </button>
                          <button type="button" onClick={() => void playVoice(voice.id)} className="rounded-md border bg-white p-2" aria-label={`Preview ${voice.displayName}`} title={`Preview ${voice.displayName}`}>
                            <Play className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={`${panelClass} p-5`}>
                <div className="flex items-center gap-2 text-lg font-semibold"><CircleDollarSign className="h-5 w-5 text-emerald-600" />Cost estimate</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Per interview</div><div className="text-2xl font-bold">{formatUsdFromCents(costEstimate?.unitPriceCents)}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Total charge</div><div className="text-2xl font-bold">{formatUsdFromCents(costEstimate?.totalCents)}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Wallet</div><div className="text-2xl font-bold">{formatUsdFromCents(costEstimate?.walletBalanceCents ?? wallet?.balanceCents)}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Voice</div><div className="text-sm font-bold">{selectedVoice?.tierLabel}</div></div>
                </div>
                {costEstimate?.enoughFunds === false && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
                    Add funds before scheduling. The backend will not create an interview that would make the wallet negative.
                  </div>
                )}
                <button onClick={createInterview} disabled={creating || costEstimate?.enoughFunds === false} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-semibold text-white disabled:opacity-60">
                  <Send className="h-4 w-4" />
                  {creating ? "Scheduling..." : `Schedule and debit ${formatUsdFromCents(costEstimate?.totalCents)}`}
                </button>
              </div>
            </aside>
          </section>
        )}

        {tab === "interviews" && (
          <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="grid gap-4 lg:grid-cols-2">
              {interviews.map((interview: any) => (
                <button key={interview._id} onClick={() => void openInterview(interview)} className={`${panelClass} p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{interview.title}</div>
                      <div className="text-sm text-slate-500">{interview.job?.title || selectedJob?.title}</div>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{interview.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-2xl bg-slate-50 p-3"><Users className="mb-2 h-4 w-4 text-slate-500" /><div className="text-xl font-bold">{interview.candidateCount}</div><div className="text-xs text-slate-500">Candidates</div></div>
                    <div className="rounded-2xl bg-slate-50 p-3"><CheckCircle2 className="mb-2 h-4 w-4 text-slate-500" /><div className="text-xl font-bold">{interview.stats?.completed || 0}</div><div className="text-xs text-slate-500">Done</div></div>
                    <div className="rounded-2xl bg-slate-50 p-3"><Trophy className="mb-2 h-4 w-4 text-slate-500" /><div className="text-xl font-bold">{interview.scoringSummary?.averageScore || 0}</div><div className="text-xs text-slate-500">Avg</div></div>
                  </div>
                  <div className="mt-4 rounded-2xl border bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Candidate ranking</div>
                    {interview.scoringSummary?.rankings?.length ? interview.scoringSummary.rankings.slice(0, 3).map((rank: any) => (
                      <div key={rank.sessionId} className="mt-2 flex items-center justify-between gap-3 text-sm">
                        <span><b>#{rank.rank}</b> {rank.candidateName}</span>
                        <span className="font-bold">{rank.score}</span>
                      </div>
                    )) : <div className="mt-2 text-sm text-slate-500">Ranking appears after candidates complete the interview.</div>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>Sends {formatDate(interview.schedule?.sendAt)}</span>
                    <span>Charged {formatUsdFromCents(interview.billing?.totalCents)}</span>
                  </div>
                </button>
              ))}
            </div>

            <aside className={`${panelClass} max-h-[calc(100vh-170px)] overflow-y-auto p-5`}>
              {selectedInterview ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold">{selectedInterview.title}</div>
                      <div className="text-sm text-slate-500">Interview detail, wallet charge, and ranking</div>
                    </div>
                    <a href="/public/ai-interview/demo-token" target="_blank" className="rounded-xl border bg-white px-3 py-2 text-xs font-semibold text-blue-700" rel="noreferrer">Demo link</a>
                  </div>
                  <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
                    <div className="mb-3 rounded-xl bg-white/10 p-3 text-sm">
                      Wallet charge: <b>{formatUsdFromCents(selectedInterview.billing?.totalCents)}</b>
                      <span className="ml-2 text-white/60">({formatUsdFromCents(selectedInterview.billing?.unitPriceCents)} per candidate interview)</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold"><Trophy className="h-4 w-4" />Ranking</div>
                    {(selectedInterview as any).scoringSummary?.rankings?.length ? (selectedInterview as any).scoringSummary.rankings.map((rank: any) => (
                      <div key={rank.sessionId} className="mt-3 rounded-xl bg-white/10 p-3">
                        <div className="flex items-center justify-between"><span>#{rank.rank} {rank.candidateName}</span><b>{rank.score}</b></div>
                        <div className="text-xs text-white/60">{recommendationLabel(rank.recommendation)}</div>
                      </div>
                    )) : <div className="mt-3 text-sm text-white/70">No ranked candidates yet.</div>}
                  </div>
                  <div className="mt-4 space-y-2">
                    {((selectedInterview as any).sessions || []).map((session: AIInterviewSession) => (
                      <button key={session._id} onClick={() => setSelectedSession(session)} className={`w-full rounded-2xl border p-3 text-left ${selectedSession?._id === session._id ? "border-blue-300 bg-blue-50" : "bg-white"}`}>
                        <div className="flex items-center justify-between gap-3"><b>{session.candidateSnapshot.name}</b><span className="text-xs font-semibold">{session.status}</span></div>
                        <div className="text-xs text-slate-500">{session.candidateSnapshot.email}</div>
                        <div className="mt-2 text-xs text-slate-500">Proctoring: {session.proctoring?.focusViolationCount || 0} screen leaves, {session.proctoring?.pasteAttemptCount || 0} paste/drop</div>
                      </button>
                    ))}
                  </div>
                  {selectedSession && (
                    <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4" />Transcript</div>
                      <div className="space-y-2">
                        {selectedSession.messages?.length ? selectedSession.messages.map((message, index) => (
                          <div key={message._id || index} className={`rounded-xl p-3 text-sm ${message.role === "candidate" ? "bg-blue-600 text-white" : "bg-white"}`}>
                            <div className="mb-1 text-xs opacity-70">{message.role === "candidate" ? "Candidate" : "Interviewer"}</div>
                            {message.content}
                          </div>
                        )) : <div className="text-sm text-slate-500">No transcript yet.</div>}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-slate-500">Select an interview to inspect ranking, transcript, and proctoring.</div>
              )}
            </aside>
          </section>
        )}

      </div>
    </main>
  );
}
