"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  FileQuestion,
  Loader2,
  ListPlus,
  Medal,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  TimerReset,
  Trophy,
  Users,
  Volume2,
  Workflow,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { InterviewQuestionSelector } from "@/components/ui/interview-question-selector";
import { getAllJobs, type JobData } from "@/services/jobService";
import { getAllCandidates } from "@/services/candidateService";
import interviewService from "@/services/interviewService";
import aiInterviewService, { type AIInterview, type AIInterviewCostEstimate, type AIInterviewVoiceOption } from "@/services/aiInterviewService";
import { AddToCandidateListDialog } from "@/components/candidate-lists/AddToCandidateListDialog";

function toLocalInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString();
}

function formatCurrencyValue(amount?: number | null, currency = "USD", locale?: string) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "-";
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount >= 100 ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatCompactNumber(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function voiceTierClass(tier?: string) {
  switch (tier) {
    case "hd":
      return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200";
    case "mai_premium":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
    case "multilingual":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
    default:
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200";
  }
}

function voiceInitials(voice?: AIInterviewVoiceOption | null) {
  const name = voice?.name || voice?.displayName || "AI";
  return name.slice(0, 2).toUpperCase();
}

function statusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "active":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "cancelled":
    case "expired":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "proctor_failed":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-amber-100 text-amber-800 border-amber-200";
  }
}

function getDepartmentName(department: JobData["department"]) {
  return typeof department === "object" && department !== null ? department.name : department;
}

function candidateName(candidate: any) {
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
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

function scoreBand(score?: number | null) {
  const value = Number(score || 0);
  if (value >= 85) {
    return {
      label: "Priority",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      barClassName: "bg-emerald-500",
      textClassName: "text-emerald-700"
    };
  }
  if (value >= 70) {
    return {
      label: "Strong review",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      barClassName: "bg-blue-500",
      textClassName: "text-blue-700"
    };
  }
  if (value >= 55) {
    return {
      label: "Needs discussion",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      barClassName: "bg-amber-500",
      textClassName: "text-amber-700"
    };
  }
  return {
    label: "Low fit",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    barClassName: "bg-rose-500",
    textClassName: "text-rose-700"
  };
}

function buildRankingBands(rankings: Array<{ score: number }>) {
  return [
    { id: "priority", label: "Priority", count: rankings.filter((item) => item.score >= 85).length, className: "bg-emerald-500" },
    { id: "strong", label: "Strong review", count: rankings.filter((item) => item.score >= 70 && item.score < 85).length, className: "bg-blue-500" },
    { id: "discussion", label: "Needs discussion", count: rankings.filter((item) => item.score >= 55 && item.score < 70).length, className: "bg-amber-500" },
    { id: "low", label: "Low fit", count: rankings.filter((item) => item.score < 55).length, className: "bg-rose-500" }
  ];
}

type JobRankingCandidate = {
  sessionId: string;
  candidateId?: string;
  candidateName: string;
  candidateEmail?: string;
  score: number;
  recommendation: string;
  rank: number;
  completedAt?: string;
  answeredCount?: number;
  concernCount?: number;
  strengthCount?: number;
  interviewId: string;
  interviewTitle: string;
  jobId: string;
  jobTitle: string;
  jobRank: number;
};

type GuestRecipient = {
  id: string;
  fullName: string;
  email: string;
};

export default function AIInterviewsPage() {
  const searchParams = useSearchParams();
  const presetJobId = searchParams.get("jobId") || "";
  const presetAppliedRef = useRef(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewUrlRef = useRef<string | null>(null);
  const [interviews, setInterviews] = useState<AIInterview[]>([]);
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [voiceOptions, setVoiceOptions] = useState<AIInterviewVoiceOption[]>([]);
  const [costEstimate, setCostEstimate] = useState<AIInterviewCostEstimate | null>(null);
  const [estimatingCost, setEstimatingCost] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [guestRecipients, setGuestRecipients] = useState<GuestRecipient[]>([]);
  const [guestFullName, setGuestFullName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [questionSelectorKey, setQuestionSelectorKey] = useState(0);
  const [activeTab, setActiveTab] = useState("create");
  const [selectedJobRankingId, setSelectedJobRankingId] = useState<string | null>(null);
  const [rankingListTopN, setRankingListTopN] = useState(10);
  const [rankingListEntries, setRankingListEntries] = useState<any[]>([]);
  const [showRankingListDialog, setShowRankingListDialog] = useState(false);
  const [lastScheduledInterview, setLastScheduledInterview] = useState<{
    id: string;
    jobId: string;
    jobTitle: string;
    title: string;
    candidateCount: number;
    sendAt: string;
    expiresAt: string;
    totalCredits?: number;
    voiceName?: string;
  } | null>(null);

  const [form, setForm] = useState({
    title: "",
    jobId: "",
    guidelines: "Please answer each question with a specific example where possible. You can ask the interviewer to clarify a question before answering.",
    sendAt: toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000)),
    expiresAt: toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    perQuestionMinutes: 10,
    totalMinutes: 45,
    voiceId: ""
  });
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);

  const selectedJob = jobs.find((job) => job._id === form.jobId);
  const selectedVoice = useMemo(
    () => voiceOptions.find((voice) => voice.id === form.voiceId) || voiceOptions.find((voice) => voice.isDefault) || voiceOptions[0] || null,
    [form.voiceId, voiceOptions]
  );
  const filteredCandidates = useMemo(() => {
    const term = candidateSearch.toLowerCase().trim();
    if (!term) return candidates;
    return candidates.filter((candidate) => {
      const name = candidateName(candidate).toLowerCase();
      return name.includes(term) || String(candidate.email || "").toLowerCase().includes(term);
    });
  }, [candidates, candidateSearch]);
  const filteredCandidateIds = useMemo(() => filteredCandidates.map((candidate) => candidate._id), [filteredCandidates]);
  const selectedVisibleCount = useMemo(
    () => filteredCandidateIds.filter((id) => selectedCandidateIds.includes(id)).length,
    [filteredCandidateIds, selectedCandidateIds]
  );
  const allVisibleSelected = filteredCandidateIds.length > 0 && selectedVisibleCount === filteredCandidateIds.length;
  const selectedCandidateRecords = useMemo(
    () => candidates.filter((candidate) => selectedCandidateIds.includes(candidate._id)),
    [candidates, selectedCandidateIds]
  );
  const guestEmailSet = useMemo(
    () => new Set(guestRecipients.map((guest) => guest.email.toLowerCase())),
    [guestRecipients]
  );
  const selectedRecipientCount = selectedCandidateIds.length + guestRecipients.length;
  const estimateRecipientCount = Math.max(1, selectedRecipientCount);
  const selectedRecipientPills = useMemo(
    () => [
      ...selectedCandidateRecords.map((candidate) => ({
        id: `candidate-${candidate._id}`,
        label: candidateName(candidate)
      })),
      ...guestRecipients.map((guest) => ({
        id: `guest-${guest.id}`,
        label: `${guest.fullName} (guest)`
      }))
    ],
    [guestRecipients, selectedCandidateRecords]
  );
  const totalCandidateSessions = useMemo(
    () => interviews.reduce((sum, interview) => sum + Number(interview.candidateCount || 0), 0),
    [interviews]
  );
  const completedSessions = useMemo(
    () => interviews.reduce((sum, interview) => sum + Number(interview.stats?.completed || 0), 0),
    [interviews]
  );
  const scoredSessionCount = useMemo(
    () => interviews.reduce((sum, interview) => sum + Number(interview.scoringSummary?.scoredCount || 0), 0),
    [interviews]
  );
  const averageAIScore = useMemo(() => {
    const weighted = interviews.reduce((sum, interview) => {
      const count = Number(interview.scoringSummary?.scoredCount || 0);
      const average = Number(interview.scoringSummary?.averageScore || 0);
      return sum + count * average;
    }, 0);
    return scoredSessionCount > 0 ? Math.round(weighted / scoredSessionCount) : null;
  }, [interviews, scoredSessionCount]);
  const jobRankingGroups = useMemo(() => {
    const groups = new Map<string, {
      jobId: string;
      jobTitle: string;
      interviews: AIInterview[];
      candidateCount: number;
      completedCount: number;
      blockedCount: number;
      failedCount: number;
      proctorFailedCount: number;
      activeCount: number;
      scheduledCount: number;
      rankings: JobRankingCandidate[];
    }>();

    interviews.forEach((interview) => {
      const job = interview.job && typeof interview.job === "object" ? interview.job : null;
      const jobId = job?._id || job?.id || `unlinked-${interview._id}`;
      const jobTitle = job?.title || "Unlinked job";
      let group = groups.get(jobId);

      if (!group) {
        group = {
          jobId,
          jobTitle,
          interviews: [],
          candidateCount: 0,
          completedCount: 0,
          blockedCount: 0,
          failedCount: 0,
          proctorFailedCount: 0,
          activeCount: 0,
          scheduledCount: 0,
          rankings: []
        };
        groups.set(jobId, group);
      }

      group.interviews.push(interview);
      group.candidateCount += Number(interview.candidateCount || 0);
      group.completedCount += Number(interview.stats?.completed || 0);
      group.blockedCount += Number(interview.stats?.blocked || 0);
      group.failedCount += Number(interview.stats?.failed || 0);
      group.proctorFailedCount += Number(interview.stats?.proctorFailed || 0);
      if (interview.status === "active") group.activeCount += 1;
      if (interview.status === "scheduled") group.scheduledCount += 1;

      (interview.scoringSummary?.rankings || []).forEach((ranking) => {
        group.rankings.push({
          ...ranking,
          interviewId: interview._id,
          interviewTitle: interview.title,
          jobId,
          jobTitle,
          jobRank: 0
        });
      });
    });

    return Array.from(groups.values())
      .map((group) => {
        const rankings = [...group.rankings]
          .sort((a, b) => b.score - a.score || a.candidateName.localeCompare(b.candidateName))
          .map((candidate, index) => ({ ...candidate, jobRank: index + 1 }));
        const scoredCount = rankings.length;
        const averageScore = scoredCount
          ? Math.round(rankings.reduce((sum, candidate) => sum + candidate.score, 0) / scoredCount)
          : null;
        const completion = group.candidateCount > 0
          ? Math.round((group.completedCount / group.candidateCount) * 100)
          : 0;
        const priorityCount = rankings.filter((candidate) => candidate.score >= 85).length;

        return {
          ...group,
          rankings,
          scoredCount,
          averageScore,
          completion,
          priorityCount,
          topCandidate: rankings[0] || null
        };
      })
      .sort((a, b) => {
        const scoreDelta = Number(b.averageScore ?? -1) - Number(a.averageScore ?? -1);
        if (scoreDelta) return scoreDelta;
        return b.candidateCount - a.candidateCount;
      });
  }, [interviews]);
  const selectedJobRanking = useMemo(
    () => jobRankingGroups.find((group) => group.jobId === selectedJobRankingId) || null,
    [jobRankingGroups, selectedJobRankingId]
  );

  const resolveRankingCandidateId = (ranking: JobRankingCandidate) => {
    if (ranking.candidateId) return ranking.candidateId;
    const email = String(ranking.candidateEmail || "").toLowerCase();
    if (email) {
      const byEmail = candidates.find((candidate) => String(candidate.email || "").toLowerCase() === email);
      if (byEmail?._id) return byEmail._id;
    }

    const name = ranking.candidateName.toLowerCase();
    const byName = candidates.find((candidate) => candidateName(candidate).toLowerCase() === name);
    return byName?._id || null;
  };

  const openRankingList = () => {
    if (!selectedJobRanking?.rankings.length) {
      toast.error("No ranked candidates available");
      return;
    }

    const entries = selectedJobRanking.rankings
      .slice(0, Math.max(1, rankingListTopN))
      .map((candidate) => ({
        candidateId: resolveRankingCandidateId(candidate),
        rank: candidate.jobRank,
        score: candidate.score,
        source: "ai_interview",
        notes: `${candidate.score} interview score for ${selectedJobRanking.jobTitle}`,
      }))
      .filter((entry) => entry.candidateId);

    if (!entries.length) {
      toast.error("No saved candidate records matched this ranking");
      return;
    }

    setRankingListEntries(entries);
    setShowRankingListDialog(true);
  };

  const topRankedJob = useMemo(
    () => jobRankingGroups.find((group) => group.scoredCount > 0) || null,
    [jobRankingGroups]
  );
  const activeInterviews = useMemo(
    () => interviews.filter((interview) => interview.status === "active").length,
    [interviews]
  );
  const scheduledInterviews = useMemo(
    () => interviews.filter((interview) => interview.status === "scheduled").length,
    [interviews]
  );
  const createProgress = useMemo(() => {
    const steps = [
      Boolean(form.jobId),
      selectedRecipientCount > 0,
      selectedQuestionIds.length > 0,
      Boolean(form.sendAt && form.expiresAt)
    ];
    return Math.round((steps.filter(Boolean).length / steps.length) * 100);
  }, [form.jobId, form.sendAt, form.expiresAt, selectedQuestionIds.length, selectedRecipientCount]);

  const loadData = async () => {
    setLoading(true);
    setLoadingCandidates(true);
    try {
      const [interviewList, jobList, candidateList] = await Promise.all([
        aiInterviewService.list(),
        getAllJobs({ limit: 200 }),
        getAllCandidates(1000)
      ]);
      const options = await aiInterviewService.getOptions();
      setInterviews(interviewList);
      setJobs(jobList || []);
      setCandidates(candidateList || []);
      setVoiceOptions(options.voices || []);
      setForm((current) => ({
        ...current,
        voiceId: current.voiceId || options.defaultVoiceId || options.voices?.find((voice) => voice.isDefault)?.id || ""
      }));
    } catch (error: any) {
      toast.error(error.message || "Failed to load AI interviews");
    } finally {
      setLoading(false);
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    return () => {
      voicePreviewAudioRef.current?.pause();
      voicePreviewAudioRef.current = null;
      if (voicePreviewUrlRef.current) {
        URL.revokeObjectURL(voicePreviewUrlRef.current);
        voicePreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setSelectedCandidateIds([]);
    setGuestRecipients([]);
    setCandidateSearch("");
  }, [form.jobId]);

  useEffect(() => {
    if (presetAppliedRef.current || !presetJobId || !jobs.length) return;

    const presetJob = jobs.find((job) => job._id === presetJobId);
    presetAppliedRef.current = true;

    if (!presetJob) {
      toast.error("The selected job was not found in this workspace");
      return;
    }

    setForm((current) => ({
      ...current,
      jobId: presetJobId,
      title: current.title || `${presetJob.title} AI Interview`
    }));
    setSelectedQuestionIds([]);
    setQuestionSelectorKey((value) => value + 1);
  }, [jobs, presetJobId]);

  useEffect(() => {
    if (!selectedJobRankingId || loading) return;
    if (!jobRankingGroups.some((group) => group.jobId === selectedJobRankingId)) {
      setSelectedJobRankingId(null);
    }
  }, [jobRankingGroups, loading, selectedJobRankingId]);

  useEffect(() => {
    if (!form.voiceId || !voiceOptions.length) return;

    const timer = window.setTimeout(async () => {
      setEstimatingCost(true);
      try {
        const estimate = await aiInterviewService.estimateCost({
          candidateCount: estimateRecipientCount,
          questionCount: Math.max(1, selectedQuestionIds.length || 1),
          totalMinutes: Number(form.totalMinutes) || 45,
          voiceId: form.voiceId
        });
        setCostEstimate(estimate);
      } catch (error) {
        console.error("Failed to estimate AI interview cost:", error);
      } finally {
        setEstimatingCost(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [estimateRecipientCount, form.totalMinutes, form.voiceId, selectedQuestionIds.length, voiceOptions.length]);

  const previewVoice = async (voice: AIInterviewVoiceOption) => {
    setForm((current) => ({ ...current, voiceId: voice.id }));
    voicePreviewAudioRef.current?.pause();
    voicePreviewAudioRef.current = null;
    if (voicePreviewUrlRef.current) {
      URL.revokeObjectURL(voicePreviewUrlRef.current);
      voicePreviewUrlRef.current = null;
    }
    setPreviewingVoiceId(voice.id);

    let audioUrl: string | null = null;
    try {
      const audioBlob = await aiInterviewService.previewVoice({
        voiceId: voice.id,
        text: voice.samplePhrase
      });
      audioUrl = URL.createObjectURL(audioBlob);
      voicePreviewUrlRef.current = audioUrl;
      const currentAudioUrl = audioUrl;
      const audio = new Audio(audioUrl);
      voicePreviewAudioRef.current = audio;
      audio.onended = () => {
        if (voicePreviewUrlRef.current === currentAudioUrl) {
          URL.revokeObjectURL(currentAudioUrl);
          voicePreviewUrlRef.current = null;
        }
        setPreviewingVoiceId((current) => (current === voice.id ? null : current));
        if (voicePreviewAudioRef.current === audio) {
          voicePreviewAudioRef.current = null;
        }
      };
      audio.onerror = () => {
        if (voicePreviewUrlRef.current === currentAudioUrl) {
          URL.revokeObjectURL(currentAudioUrl);
          voicePreviewUrlRef.current = null;
        }
        setPreviewingVoiceId((current) => (current === voice.id ? null : current));
        if (voicePreviewAudioRef.current === audio) {
          voicePreviewAudioRef.current = null;
        }
        toast.error("Could not play this voice preview");
      };
      await audio.play();
    } catch (error: any) {
      if (audioUrl && voicePreviewUrlRef.current === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        voicePreviewUrlRef.current = null;
      }
      setPreviewingVoiceId((current) => (current === voice.id ? null : current));
      toast.error(error.message || "Could not generate this voice preview");
    }
  };

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }

      const candidate = candidates.find((item) => item._id === candidateId);
      const email = String(candidate?.email || "").toLowerCase();
      if (email && guestEmailSet.has(email)) {
        toast.error("That email is already added as a guest recipient");
        return current;
      }

      return [...current, candidateId];
    });
  };

  const selectVisibleCandidates = () => {
    const selectableIds = filteredCandidates
      .filter((candidate) => !guestEmailSet.has(String(candidate.email || "").toLowerCase()))
      .map((candidate) => candidate._id);
    setSelectedCandidateIds((current) => Array.from(new Set([...current, ...selectableIds])));
  };

  const clearVisibleCandidates = () => {
    setSelectedCandidateIds((current) => current.filter((id) => !filteredCandidateIds.includes(id)));
  };

  const addGuestRecipient = () => {
    const fullName = guestFullName.trim();
    const email = guestEmail.trim().toLowerCase();

    if (!fullName || !email) {
      toast.error("Enter the guest candidate's full name and email");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid guest candidate email");
      return;
    }
    const selectedSavedEmail = selectedCandidateRecords.some((candidate) => String(candidate.email || "").toLowerCase() === email);
    const existingGuestEmail = guestRecipients.some((guest) => guest.email.toLowerCase() === email);
    if (selectedSavedEmail || existingGuestEmail) {
      toast.error("That email is already selected");
      return;
    }

    setGuestRecipients((current) => [
      ...current,
      {
        id: `${email}-${Date.now()}`,
        fullName,
        email
      }
    ]);
    setGuestFullName("");
    setGuestEmail("");
  };

  const removeGuestRecipient = (id: string) => {
    setGuestRecipients((current) => current.filter((guest) => guest.id !== id));
  };

  const generateQuestions = async () => {
    if (!form.jobId) {
      toast.error("Select a job before generating questions");
      return;
    }

    setGenerating(true);
    try {
      const generated = await interviewService.generateQuestions(form.jobId, {
        questionCount: 5,
        difficulty: "medium",
        includeTypes: ["technical", "behavioral", "situational"],
        ensureDiversity: true
      });
      setSelectedQuestionIds(generated.map((question) => question._id));
      setQuestionSelectorKey((value) => value + 1);
      toast.success(`Generated ${generated.length} questions`);
    } catch (error: any) {
      toast.error(error.message || "Failed to generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    // Tell the user exactly what's missing before scheduling
    const missing: string[] = [];
    if (!form.jobId) missing.push("a job");
    if (selectedRecipientCount === 0) missing.push("at least one recipient (candidate or guest)");
    if (selectedQuestionIds.length === 0) missing.push("at least one interview question");
    if (!form.sendAt || !form.expiresAt) missing.push("a send time and an expiry time");
    if (missing.length > 0) {
      toast.error(`Cannot schedule yet — please add ${missing.join(", ")}.`);
      return;
    }
    if (costEstimate?.enoughCredits === false) {
      toast.error("Not enough credits to schedule this interview. Reduce the questions/recipients or top up your credits.");
      return;
    }

    setSaving(true);
    try {
      const result = await aiInterviewService.create({
        title: form.title || `${selectedJob?.title || "Role"} AI Interview`,
        jobId: form.jobId,
        candidateIds: selectedCandidateIds,
        guestCandidates: guestRecipients.map((guest) => ({
          fullName: guest.fullName,
          email: guest.email
        })),
        questionIds: selectedQuestionIds,
        guidelines: form.guidelines,
        sendAt: new Date(form.sendAt).toISOString(),
        expiresAt: new Date(form.expiresAt).toISOString(),
        perQuestionMinutes: Number(form.perQuestionMinutes),
        totalMinutes: Number(form.totalMinutes),
        voiceId: form.voiceId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });

      setLastScheduledInterview({
        id: result.aiInterview._id,
        jobId: form.jobId,
        jobTitle: selectedJob?.title || result.aiInterview.job?.title || "Job",
        title: result.aiInterview.title,
        candidateCount: result.sessions?.length || selectedRecipientCount,
        sendAt: result.aiInterview.schedule?.sendAt || new Date(form.sendAt).toISOString(),
        expiresAt: result.aiInterview.schedule?.expiresAt || new Date(form.expiresAt).toISOString(),
        totalCredits: result.creditPreview?.estimate?.totalCredits || result.aiInterview.costEstimate?.totalCredits,
        voiceName: result.aiInterview.voice?.displayName || selectedVoice?.displayName
      });
      setSelectedJobRankingId(form.jobId);
      setActiveTab("interviews");
      toast.success("AI interview scheduled");
      setSelectedCandidateIds([]);
      setGuestRecipients([]);
      setGuestFullName("");
      setGuestEmail("");
      setSelectedQuestionIds([]);
      setForm((current) => ({
        ...current,
        title: "",
        sendAt: toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000)),
        expiresAt: toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      }));
      await loadData();
    } catch (error: any) {
      toast.error(error.data?.message || error.message || "Failed to schedule AI interview");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-[#F1ECFF]/60 to-[#F1ECFF]/70 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="container max-w-screen-2xl space-y-6 py-6">
        <div className="rounded-2xl border border-white/70 bg-white/85 p-5 shadow-lg shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85 dark:shadow-none">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                <Workflow className="h-3.5 w-3.5" />
                Structured candidate interview workflow
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-normal text-slate-950 dark:text-white md:text-3xl">AI Interviews</h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                  Schedule guided chat interviews, control the question set, and track candidate progress from one workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {presetJobId && selectedJob && (
                <Button asChild variant="outline" className="justify-start">
                  <Link href={`/jobs/${selectedJob._id}`}>
                    <Briefcase className="mr-2 h-4 w-4" />
                    Back to job
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={loadData} disabled={loading} className="justify-start">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 dark:border-blue-900/70 dark:bg-blue-950/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Active</span>
                <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{activeInterviews}</div>
              <p className="text-xs text-blue-700/80 dark:text-blue-300/80">Running interview batches</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Scheduled</span>
                <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{scheduledInterviews}</div>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">Waiting for send time</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/90 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Completed</span>
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{completedSessions}</div>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">Candidate sessions submitted</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50/90 p-4 dark:border-violet-900/70 dark:bg-violet-950/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Avg AI Score</span>
                <Trophy className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{averageAIScore ?? "-"}</div>
              <p className="truncate text-xs text-violet-700/80 dark:text-violet-300/80">
                {topRankedJob ? `Top job: ${topRankedJob.jobTitle}` : "No scored jobs yet"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Candidates</span>
                <Users className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{totalCandidateSessions}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total invited across interviews</p>
            </div>
          </div>
        </div>

        {lastScheduledInterview && (
          <Card className="border-emerald-200 bg-emerald-50/90 shadow-lg shadow-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/30 dark:shadow-none">
            <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-emerald-950 dark:text-emerald-100">AI interview scheduled</div>
                  <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                    {lastScheduledInterview.title} is queued for {lastScheduledInterview.candidateCount} recipient{lastScheduledInterview.candidateCount === 1 ? "" : "s"} under {lastScheduledInterview.jobTitle}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-emerald-800 dark:text-emerald-200">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">
                      <Clock className="h-3.5 w-3.5" />
                      Sends {formatDate(lastScheduledInterview.sendAt)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">
                      <TimerReset className="h-3.5 w-3.5" />
                      Deadline {formatDate(lastScheduledInterview.expiresAt)}
                    </span>
                    {lastScheduledInterview.voiceName && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">
                        <Volume2 className="h-3.5 w-3.5" />
                        {lastScheduledInterview.voiceName}
                      </span>
                    )}
                    {typeof lastScheduledInterview.totalCredits === "number" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 dark:bg-white/10">
                        <DollarSign className="h-3.5 w-3.5" />
                        {lastScheduledInterview.totalCredits} credits reserved
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="bg-emerald-700 text-white hover:bg-emerald-800"
                  onClick={() => {
                    setActiveTab("interviews");
                    setSelectedJobRankingId(lastScheduledInterview.jobId);
                  }}
                >
                  Open job ranking
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </Button>
                <Button asChild variant="outline" className="border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100">
                  <Link href={`/ai-interviews/${lastScheduledInterview.id}`}>
                    Open batch
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button type="button" variant="ghost" className="text-emerald-900 hover:text-emerald-950 dark:text-emerald-100" onClick={() => setLastScheduledInterview(null)}>
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:w-[420px]">
            <TabsTrigger value="create" className="rounded-lg py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950">
              <Plus className="mr-2 h-4 w-4" />
              Create
            </TabsTrigger>
            <TabsTrigger value="interviews" className="rounded-lg py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950">
              <CalendarClock className="mr-2 h-4 w-4" />
              Interviews
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-6">
                <Card className="overflow-hidden border-0 bg-white/90 shadow-lg shadow-slate-200/70 dark:bg-slate-900/90 dark:shadow-none">
                  <CardHeader className="border-b bg-slate-950 px-5 py-4 text-white dark:border-slate-800">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Briefcase className="h-4 w-4 text-emerald-300" />
                          Interview Setup
                        </CardTitle>
                        <CardDescription className="mt-1 text-slate-300">
                          Select the role, candidate instructions, and timing controls.
                        </CardDescription>
                      </div>
                      <Badge className="w-fit border-white/20 bg-white/10 text-white">
                        {createProgress}% ready
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 p-5">
                    <div className="grid gap-3 md:grid-cols-4">
                      {[
                        { label: "Job", done: Boolean(form.jobId), icon: Briefcase },
                        { label: "Recipients", done: selectedRecipientCount > 0, icon: Users },
                        { label: "Questions", done: selectedQuestionIds.length > 0, icon: FileQuestion },
                        { label: "Schedule", done: Boolean(form.sendAt && form.expiresAt), icon: CalendarClock }
                      ].map((step, index) => {
                        const StepIcon = step.icon;
                        return (
                          <div
                            key={step.label}
                            className={`flex items-center gap-3 rounded-xl border p-3 ${
                              step.done
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-950 shadow-sm dark:bg-slate-900 dark:text-white">
                              <StepIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold uppercase tracking-wide">Step {index + 1}</div>
                              <div className="truncate text-sm font-medium">{step.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Progress value={createProgress} className="h-2" />

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Job</Label>
                        <Select
                          value={form.jobId}
                          onValueChange={(jobId) => {
                            setForm((current) => ({ ...current, jobId }));
                            setSelectedQuestionIds([]);
                            setQuestionSelectorKey((value) => value + 1);
                          }}
                        >
                          <SelectTrigger className="bg-white dark:bg-slate-950">
                            <SelectValue placeholder="Select job" />
                          </SelectTrigger>
                          <SelectContent>
                            {jobs.map((job) => (
                              <SelectItem key={job._id} value={job._id}>
                                {job.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Title</Label>
                        <Input
                          value={form.title}
                          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                          placeholder={selectedJob ? `${selectedJob.title} AI Interview` : "AI Interview title"}
                          className="bg-white dark:bg-slate-950"
                        />
                      </div>
                    </div>

                    {selectedJob && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/25">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-950 dark:text-white">{selectedJob.title}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <span>{getDepartmentName(selectedJob.department) || "Department not set"}</span>
                              <span>{selectedJob.location || "Location not set"}</span>
                              <span>{selectedJob.type || "Type not set"}</span>
                            </div>
                          </div>
                          <Button asChild variant="outline" size="sm" className="w-fit bg-white/80 dark:bg-slate-900">
                            <Link href={`/jobs/${selectedJob._id}`}>
                              View job
                            </Link>
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Candidate guidelines</Label>
                      <Textarea
                        rows={5}
                        value={form.guidelines}
                        onChange={(event) => setForm((current) => ({ ...current, guidelines: event.target.value }))}
                        className="bg-white leading-6 dark:bg-slate-950"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Send time</Label>
                        <Input
                          type="datetime-local"
                          value={form.sendAt}
                          onChange={(event) => setForm((current) => ({ ...current, sendAt: event.target.value }))}
                          className="bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Deadline</Label>
                        <Input
                          type="datetime-local"
                          value={form.expiresAt}
                          onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                          className="bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Minutes per question</Label>
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={form.perQuestionMinutes}
                          onChange={(event) => setForm((current) => ({ ...current, perQuestionMinutes: Number(event.target.value) }))}
                          className="bg-white dark:bg-slate-950"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Total minutes</Label>
                        <Input
                          type="number"
                          min={1}
                          max={480}
                          value={form.totalMinutes}
                          onChange={(event) => setForm((current) => ({ ...current, totalMinutes: Number(event.target.value) }))}
                          className="bg-white dark:bg-slate-950"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border-0 bg-white/90 shadow-lg shadow-slate-200/70 dark:bg-slate-900/90 dark:shadow-none">
                  <CardHeader className="border-b bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white">
                          <Volume2 className="h-4 w-4 text-emerald-600" />
                          Interview Voice
                        </CardTitle>
                        <CardDescription>Select the interviewer voice and quality tier. Azure Speech remains the TTS provider.</CardDescription>
                      </div>
                      {selectedVoice && (
                        <Badge variant="outline" className={voiceTierClass(selectedVoice.tier)}>
                          {selectedVoice.tierLabel}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-5">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {voiceOptions.map((voice) => {
                        const selected = form.voiceId === voice.id;
                        const previewing = previewingVoiceId === voice.id;
                        return (
                          <div
                            key={voice.id}
                            className={`group rounded-2xl border p-4 text-left transition-all ${
                              selected
                                ? "border-slate-950 bg-slate-950 text-white shadow-lg dark:border-white dark:bg-white dark:text-slate-950"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                type="button"
                                onClick={() => setForm((current) => ({ ...current, voiceId: voice.id }))}
                                className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                aria-pressed={selected}
                              >
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${
                                  selected ? "bg-white text-slate-950 dark:bg-slate-950 dark:text-white" : "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                                }`}>
                                  {voiceInitials(voice)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="font-semibold">{voice.displayName}</div>
                                    {voice.isDefault && (
                                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${selected ? "bg-emerald-400/20 text-emerald-100 dark:text-emerald-800" : "bg-emerald-50 text-emerald-700"}`}>
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  <div className={`mt-1 text-xs ${selected ? "text-slate-200 dark:text-slate-700" : "text-muted-foreground"}`}>
                                    {voice.description}
                                  </div>
                                </div>
                              </button>
                              <Button
                                type="button"
                                size="sm"
                                variant={selected ? "secondary" : "outline"}
                                className={`h-9 shrink-0 rounded-full px-3 ${selected ? "dark:bg-slate-950 dark:text-white" : ""}`}
                                onClick={() => previewVoice(voice)}
                                disabled={Boolean(previewingVoiceId && !previewing)}
                                aria-label={`Play ${voice.displayName} voice sample`}
                              >
                                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                <span className="ml-1 hidden sm:inline">Play</span>
                              </Button>
                            </div>
                            <button
                              type="button"
                              onClick={() => setForm((current) => ({ ...current, voiceId: voice.id }))}
                              className="mt-3 flex w-full flex-wrap items-center gap-2 text-left"
                              aria-label={`Select ${voice.displayName} voice`}
                            >
                              <Badge variant="outline" className={selected ? "border-white/20 bg-white/10 text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900" : voiceTierClass(voice.tier)}>
                                {voice.tierLabel}
                              </Badge>
                              {Number(voice.surchargeCredits || 0) > 0 && (
                                <span className={`rounded-full px-2 py-1 text-xs ${selected ? "bg-white/10 text-slate-100 dark:bg-slate-100 dark:text-slate-800" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
                                  +{voice.surchargeCredits} credit
                                </span>
                              )}
                              <span className={`rounded-full px-2 py-1 text-xs ${selected ? "bg-white/10 text-slate-100 dark:bg-slate-100 dark:text-slate-800" : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
                                ${voice.usdPerMillionCharacters}/1M chars
                              </span>
                            </button>
                            {voice.samplePhrase && (
                              <button
                                type="button"
                                onClick={() => setForm((current) => ({ ...current, voiceId: voice.id }))}
                                className={`mt-3 w-full rounded-xl border px-3 py-2 text-left text-xs leading-5 ${
                                selected ? "border-white/15 bg-white/10 text-slate-100 dark:border-slate-200 dark:bg-slate-100 dark:text-slate-700" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                              }`}>
                                "{voice.samplePhrase}"
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm dark:border-blue-900/60 dark:bg-blue-950/25">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-semibold text-slate-950 dark:text-white">
                            <Sparkles className="h-4 w-4 text-blue-600" />
                            Voice cost estimate
                          </div>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            Based on estimated Azure + LLM cost, a $1 target profit per candidate, then rounded to credits.
                          </p>
                        </div>
                        {estimatingCost && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                      </div>
                      {selectedRecipientCount === 0 && (
                        <div className="mt-3 rounded-xl border border-blue-100 bg-white/70 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-slate-950/50 dark:text-blue-100">
                          Add candidates or guest recipients to calculate the real batch total. Showing a one-candidate preview for now.
                        </div>
                      )}
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl bg-white p-3 dark:bg-slate-950/60">
                          <div className="text-xs text-muted-foreground">Per candidate</div>
                          <div className="mt-1 text-lg font-bold">{costEstimate?.creditCostPerCandidate ?? 8} credits</div>
                        </div>
                        <div className="rounded-xl bg-white p-3 dark:bg-slate-950/60">
                          <div className="text-xs text-muted-foreground">{selectedRecipientCount > 0 ? "Total batch" : "Preview total"}</div>
                          <div className="mt-1 text-lg font-bold">{costEstimate?.totalCredits ?? estimateRecipientCount * 8} credits</div>
                        </div>
                        <div className="rounded-xl bg-white p-3 dark:bg-slate-950/60">
                          <div className="text-xs text-muted-foreground">Estimated backend cost</div>
                          <div className="mt-1 text-lg font-bold">{formatCurrencyValue(costEstimate?.estimatedBackendCostUsd, "USD")}</div>
                        </div>
                        <div className="rounded-xl bg-white p-3 dark:bg-slate-950/60">
                          <div className="text-xs text-muted-foreground">Customer charge</div>
                          <div className="mt-1 text-lg font-bold">
                            {formatCurrencyValue(
                              costEstimate?.estimatedUsdValue,
                              "USD"
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <span>Target profit {formatCurrencyValue(costEstimate?.targetProfitUsd, "USD")}</span>
                        {Number(costEstimate?.voiceSurchargeCredits || 0) > 0 && (
                          <span>
                            Premium voice +{costEstimate?.voiceSurchargeCredits} credits ({formatCurrencyValue(costEstimate?.voiceSurchargeUsd, "USD")})
                          </span>
                        )}
                        <span>Credit rate {formatCurrencyValue(costEstimate?.creditRate?.usdPerCredit ?? 0.25, "USD")}/credit</span>
                        {costEstimate?.displayValue?.currency && costEstimate.displayValue.currency !== "USD" && (
                          <span>
                            {costEstimate.displayValue.currency} {formatCurrencyValue(
                              costEstimate.displayValue.amount,
                              costEstimate.displayValue.currency,
                              costEstimate.displayValue.metadata?.locale
                            )}
                          </span>
                        )}
                        <span>Estimated TTS {formatCompactNumber(costEstimate?.estimatedSpeechCharacters)} characters</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border-0 bg-white/90 shadow-lg shadow-slate-200/70 dark:bg-slate-900/90 dark:shadow-none">
                  <CardHeader className="border-b bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white">
                          <FileQuestion className="h-4 w-4 text-purple-600" />
                          Question Set
                        </CardTitle>
                        <CardDescription>Choose existing questions or generate a fresh set for the selected job.</CardDescription>
                      </div>
                      <Button size="sm" variant="outline" onClick={generateQuestions} disabled={!form.jobId || generating}>
                        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileQuestion className="mr-2 h-4 w-4" />}
                        Generate
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-5">
                    <InterviewQuestionSelector
                      key={`${form.jobId}-${questionSelectorKey}`}
                      jobId={form.jobId}
                      selectedQuestionIds={selectedQuestionIds}
                      onSelectionChange={setSelectedQuestionIds}
                    />
                  </CardContent>
                </Card>
              </div>

              <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
                <Card className="overflow-hidden border-0 bg-white/90 shadow-lg shadow-slate-200/70 dark:bg-slate-900/90 dark:shadow-none">
                  <CardHeader className="border-b bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white">
                          <Users className="h-4 w-4 text-blue-600" />
                          Recipients
                        </CardTitle>
                        <CardDescription>
                          {selectedRecipientCount} selected: {selectedCandidateIds.length} saved, {guestRecipients.length} guest
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{selectedVisibleCount}/{filteredCandidateIds.length} visible</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-5">
                    <Input
                      placeholder="Search all saved candidates"
                      value={candidateSearch}
                      onChange={(event) => setCandidateSearch(event.target.value)}
                      className="bg-white dark:bg-slate-950"
                    />
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                      <label className="flex cursor-pointer items-center gap-3">
                        <Checkbox
                          checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              selectVisibleCandidates();
                            } else {
                              clearVisibleCandidates();
                            }
                          }}
                        />
                        <span className="font-medium text-slate-900 dark:text-white">Select all visible saved candidates</span>
                      </label>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={selectVisibleCandidates} disabled={!filteredCandidateIds.length}>
                          Select visible
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={clearVisibleCandidates} disabled={!selectedVisibleCount}>
                          Clear visible
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedCandidateIds([])} disabled={!selectedCandidateIds.length}>
                          Clear all
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-950 dark:text-white">Add guest candidate</div>
                          <div className="text-xs text-muted-foreground">Invite someone who is not saved in the candidate database.</div>
                        </div>
                        <Badge variant="outline">{guestRecipients.length} guest</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <Input
                          placeholder="Full name"
                          value={guestFullName}
                          onChange={(event) => setGuestFullName(event.target.value)}
                          className="bg-white dark:bg-slate-950"
                        />
                        <Input
                          type="email"
                          placeholder="Email address"
                          value={guestEmail}
                          onChange={(event) => setGuestEmail(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addGuestRecipient();
                            }
                          }}
                          className="bg-white dark:bg-slate-950"
                        />
                        <Button type="button" variant="outline" onClick={addGuestRecipient} className="shrink-0 bg-white dark:bg-slate-950">
                          <Plus className="mr-2 h-4 w-4" />
                          Add
                        </Button>
                      </div>
                      {guestRecipients.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {guestRecipients.map((guest) => (
                            <span key={guest.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-slate-700 ring-1 ring-blue-100 dark:bg-slate-950 dark:text-slate-200 dark:ring-blue-900">
                              <span className="truncate">{guest.fullName} - {guest.email}</span>
                              <button
                                type="button"
                                onClick={() => removeGuestRecipient(guest.id)}
                                className="rounded-full text-slate-400 hover:text-red-600"
                                aria-label={`Remove ${guest.fullName}`}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {loadingCandidates && (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-950/40">
                          Loading saved candidates...
                        </div>
                      )}
                      {!loadingCandidates && filteredCandidates.map((candidate) => {
                        const checked = selectedCandidateIds.includes(candidate._id);
                        const name = candidateName(candidate);
                        return (
                          <label
                            key={candidate._id}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors ${
                              checked
                                ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30"
                                : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900"
                            }`}
                          >
                            <Checkbox checked={checked} onCheckedChange={() => toggleCandidate(candidate._id)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-900 dark:text-white">{name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{candidate.email}</span>
                            </span>
                          </label>
                        );
                      })}
                      {!loadingCandidates && !filteredCandidates.length && (
                        <Alert>
                          <AlertDescription>No saved candidates found. Add a guest recipient above.</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border-0 bg-slate-950 text-white shadow-xl shadow-slate-300/60 dark:shadow-none">
                  <CardHeader className="border-b border-white/10 px-5 py-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldCheck className="h-4 w-4 text-emerald-300" />
                      Schedule Summary
                    </CardTitle>
                    <CardDescription className="text-slate-300">Review the batch before creating candidate links.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 p-5 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-slate-400">Recipients</div>
                        <div className="mt-1 text-xl font-bold">{selectedRecipientCount}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-slate-400">Questions</div>
                        <div className="mt-1 text-xl font-bold">{selectedQuestionIds.length}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-slate-400">Per question</div>
                        <div className="mt-1 text-xl font-bold">{form.perQuestionMinutes}m</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-slate-400">Credits</div>
                        <div className="mt-1 text-xl font-bold">{costEstimate?.totalCredits ?? estimateRecipientCount * 8}</div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start gap-3">
                        <Volume2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                        <div className="min-w-0">
                          <div className="text-xs text-slate-400">Voice</div>
                          <div className="truncate font-medium">
                            {selectedVoice ? `${selectedVoice.displayName} (${selectedVoice.tierLabel})` : "Default voice"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Briefcase className="mt-0.5 h-4 w-4 text-blue-300" />
                        <div className="min-w-0">
                          <div className="text-xs text-slate-400">Job</div>
                          <div className="truncate font-medium">{selectedJob?.title || "No job selected"}</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Clock className="mt-0.5 h-4 w-4 text-amber-300" />
                        <div className="min-w-0">
                          <div className="text-xs text-slate-400">Send time</div>
                          <div className="truncate font-medium">{formatDate(form.sendAt)}</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <TimerReset className="mt-0.5 h-4 w-4 text-rose-300" />
                        <div className="min-w-0">
                          <div className="text-xs text-slate-400">Deadline</div>
                          <div className="truncate font-medium">{formatDate(form.expiresAt)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Estimated charge</div>
                        {estimatingCost && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />}
                      </div>
                      <div className="grid gap-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Per recipient</span>
                          <span className="font-semibold">{costEstimate?.creditCostPerCandidate ?? 8} credits</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Batch total</span>
                          <span className="font-semibold">{costEstimate?.totalCredits ?? estimateRecipientCount * 8} credits</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Backend cost</span>
                          <span className="font-semibold">{formatCurrencyValue(costEstimate?.estimatedBackendCostUsd, "USD")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Target profit</span>
                          <span className="font-semibold">{formatCurrencyValue(costEstimate?.targetProfitUsd, "USD")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Customer charge</span>
                          <span className="font-semibold">{formatCurrencyValue(costEstimate?.estimatedUsdValue, "USD")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">{costEstimate?.displayValue?.currency || "Org currency"}</span>
                          <span className="font-semibold">
                            {formatCurrencyValue(
                              costEstimate?.displayValue?.amount,
                              costEstimate?.displayValue?.currency || "USD",
                              costEstimate?.displayValue?.metadata?.locale
                            )}
                          </span>
                        </div>
                      </div>
                      {costEstimate?.remainingCredits !== null && typeof costEstimate?.remainingCredits === "number" && (
                        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                          costEstimate.enoughCredits ? "bg-emerald-400/10 text-emerald-100" : "bg-red-400/10 text-red-100"
                        }`}>
                          {costEstimate.enoughCredits
                            ? `${costEstimate.remainingCredits} credits available`
                            : `Only ${costEstimate.remainingCredits} credits available`}
                        </div>
                      )}
                    </div>

                    {selectedRecipientPills.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Selected recipients</div>
                        <div className="flex flex-wrap gap-2">
                          {selectedRecipientPills.slice(0, 6).map((recipient) => (
                            <span key={recipient.id} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-100">
                              {recipient.label}
                            </span>
                          ))}
                          {selectedRecipientPills.length > 6 && (
                            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-100">
                              +{selectedRecipientPills.length - 6} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <Button className="w-full bg-emerald-500 text-white hover:bg-emerald-600" onClick={submit} disabled={saving}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Schedule AI Interview
                    </Button>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="interviews" className="space-y-5">
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border bg-white p-5 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading AI interviews...
              </div>
            ) : jobRankingGroups.length ? (
              selectedJobRanking ? (
                <div className="space-y-5">
                  <Card className="overflow-hidden border-0 bg-slate-950 text-white shadow-xl shadow-slate-200/70 dark:shadow-none">
                    <CardContent className="p-5">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-3">
                          <Button
                            type="button"
                            variant="ghost"
                            className="-ml-3 h-8 px-2 text-slate-300 hover:bg-white/10 hover:text-white"
                            onClick={() => setSelectedJobRankingId(null)}
                          >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Jobs
                          </Button>
                          <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                              <Trophy className="h-3.5 w-3.5" />
                              Job candidate ranking
                            </div>
                            <h2 className="mt-3 text-2xl font-semibold">{selectedJobRanking.jobTitle}</h2>
                            <p className="mt-1 max-w-2xl text-sm text-slate-300">
                              Rankings here are scoped to this job across every AI interview batch for the role.
                            </p>
                          </div>
                        </div>
                        <div className="grid w-full gap-2 sm:grid-cols-4 lg:max-w-2xl">
                          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                            <div className="text-xs text-slate-300">Batches</div>
                            <div className="text-2xl font-semibold">{selectedJobRanking.interviews.length}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                            <div className="text-xs text-slate-300">Candidates</div>
                            <div className="text-2xl font-semibold">{selectedJobRanking.candidateCount}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                            <div className="text-xs text-slate-300">Scored</div>
                            <div className="text-2xl font-semibold">{selectedJobRanking.scoredCount}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/10 p-3">
                            <div className="text-xs text-slate-300">Avg score</div>
                            <div className="text-2xl font-semibold">{selectedJobRanking.averageScore ?? "-"}</div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                      <div className="flex flex-col gap-3 border-b bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">Candidate ranking</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            All scored candidates for this job, highest Llama score first. Interview batches are grouped beside this ranking.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={selectedJobRanking.rankings.length || 1}
                            value={rankingListTopN}
                            onChange={(event) => setRankingListTopN(Math.min(Math.max(Number(event.target.value) || 1, 1), selectedJobRanking.rankings.length || 1))}
                            className="h-9 w-24"
                            aria-label="Top ranked candidates to save"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={openRankingList}>
                            <ListPlus className="mr-2 h-4 w-4" />
                            List top
                          </Button>
                          <Badge variant="outline" className="w-fit">
                            {selectedJobRanking.priorityCount} priority
                          </Badge>
                        </div>
                      </div>
                      <div className="p-5">
                        {selectedJobRanking.rankings.length ? (
                          <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                            {selectedJobRanking.rankings.map((candidate) => {
                              const band = scoreBand(candidate.score);
                              return (
                                <Link
                                  key={`${candidate.interviewId}-${candidate.sessionId}`}
                                  href={`/ai-interviews/${candidate.interviewId}`}
                                  className="group grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-950 md:grid-cols-[54px_minmax(0,1fr)_130px_150px_32px] md:items-center"
                                >
                                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                                    #{candidate.jobRank}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-950 dark:text-white">{candidate.candidateName}</div>
                                    <div className="truncate text-xs text-muted-foreground">{candidate.interviewTitle}</div>
                                  </div>
                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">Score</span>
                                      <span className="font-semibold text-slate-950 dark:text-white">{candidate.score}</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
                                      <div className={`h-2 rounded-full ${band.barClassName}`} style={{ width: `${candidate.score}%` }} />
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2 md:justify-end">
                                    <Badge variant="outline" className={band.className}>{band.label}</Badge>
                                    <Badge variant="outline" className={recommendationColor(candidate.recommendation)}>
                                      {formatRecommendation(candidate.recommendation)}
                                    </Badge>
                                  </div>
                                  <ArrowUpRight className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-950 dark:group-hover:text-white" />
                                </Link>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-950/50">
                            Ranking appears here after candidates complete interviews for this job and Llama scoring finishes.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Interview batches</h3>
                            <p className="mt-1 text-xs text-muted-foreground">Included in this ranking</p>
                          </div>
                          <Badge variant="outline">{selectedJobRanking.interviews.length}</Badge>
                        </div>
                        <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                          {selectedJobRanking.interviews.map((interview) => {
                            const completed = Number(interview.stats?.completed || 0);
                            const total = Number(interview.candidateCount || 0);
                            const completion = total > 0 ? Math.round((completed / total) * 100) : 0;
                            const scoringSummary = interview.scoringSummary;
                            const rankings = scoringSummary?.rankings || [];
                            const topCandidate = rankings[0];
                            const hasScores = Number(scoringSummary?.scoredCount || 0) > 0;
                            return (
                              <Link
                                key={interview._id}
                                href={`/ai-interviews/${interview._id}`}
                                className="group block rounded-2xl border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-950"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">{interview.title}</div>
                                    <div className="mt-1 truncate text-xs text-muted-foreground">Sends {formatDate(interview.schedule?.sendAt)}</div>
                                  </div>
                                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-950 dark:group-hover:text-white" />
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <Badge className={statusColor(interview.status)}>{interview.status}</Badge>
                                  <Badge variant="outline">{completed}/{total} complete</Badge>
                                  {Number(interview.stats?.proctorFailed || 0) > 0 && (
                                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                                      {interview.stats?.proctorFailed} proctor ended
                                    </Badge>
                                  )}
                                  {hasScores ? (
                                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                                      Avg {scoringSummary?.averageScore ?? "-"}
                                    </Badge>
                                  ) : null}
                                </div>
                                {topCandidate ? (
                                  <div className="mt-3 rounded-xl bg-white p-3 text-xs dark:bg-slate-900">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">Top: {topCandidate.candidateName}</span>
                                      <span className="flex shrink-0 items-center gap-1 font-semibold text-slate-950 dark:text-white">
                                        <Star className="h-3.5 w-3.5 text-amber-500" />
                                        {topCandidate.score}
                                      </span>
                                    </div>
                                  </div>
                                ) : null}
                                <div className="mt-3 space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                    <span>Batch completion</span>
                                    <span>{completion}%</span>
                                  </div>
                                  <Progress value={completion} className="h-1.5" />
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-lg shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85 dark:shadow-none">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-slate-950 dark:text-white">Score distribution</h3>
                            <p className="mt-1 text-xs text-muted-foreground">This job only</p>
                          </div>
                          <Medal className="h-5 w-5 text-violet-600" />
                        </div>
                        <div className="mt-5 space-y-4">
                          {buildRankingBands(selectedJobRanking.rankings).map((band) => {
                            const percentage = selectedJobRanking.rankings.length
                              ? Math.round((band.count / selectedJobRanking.rankings.length) * 100)
                              : 0;
                            return (
                              <div key={band.id}>
                                <div className="mb-1 flex items-center justify-between text-sm">
                                  <span className="font-medium text-slate-700 dark:text-slate-200">{band.label}</span>
                                  <span className="text-muted-foreground">{band.count}</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div className={`h-2 rounded-full ${band.className}`} style={{ width: `${percentage}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                        <h3 className="text-base font-semibold text-slate-950 dark:text-white">Job activity</h3>
                        <div className="mt-4 space-y-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Completion</span>
                            <span className="font-semibold">{selectedJobRanking.completion}%</span>
                          </div>
                          <Progress value={selectedJobRanking.completion} className="h-2" />
                          <div className="grid grid-cols-2 gap-2 pt-2">
                            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                              <div className="text-xs text-muted-foreground">Active</div>
                              <div className="text-lg font-semibold">{selectedJobRanking.activeCount}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                              <div className="text-xs text-muted-foreground">Scheduled</div>
                              <div className="text-lg font-semibold">{selectedJobRanking.scheduledCount}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                              <div className="text-xs text-muted-foreground">Completed</div>
                              <div className="text-lg font-semibold">{selectedJobRanking.completedCount}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                              <div className="text-xs text-muted-foreground">Needs review</div>
                              <div className="text-lg font-semibold">{selectedJobRanking.blockedCount + selectedJobRanking.failedCount}</div>
                            </div>
                            <div className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                              <div className="text-xs opacity-75">Proctor ended</div>
                              <div className="text-lg font-semibold">{selectedJobRanking.proctorFailedCount}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Jobs with AI interviews</h2>
                      <p className="text-sm text-muted-foreground">
                        Open a job to rank candidates only against other candidates for that role.
                      </p>
                    </div>
                    <Badge variant="outline" className="w-fit">
                      {jobRankingGroups.length} job{jobRankingGroups.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {jobRankingGroups.map((group) => {
                      const hasScores = group.scoredCount > 0;
                      return (
                        <button
                          key={group.jobId}
                          type="button"
                          className="w-full text-left"
                          onClick={() => setSelectedJobRankingId(group.jobId)}
                        >
                          <Card className="h-full overflow-hidden border-0 bg-white/90 shadow-lg shadow-slate-200/70 transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-slate-900/90 dark:shadow-none">
                            <CardContent className="p-5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                    <Briefcase className="h-3.5 w-3.5" />
                                    Job ranking
                                  </div>
                                  <h3 className="mt-2 truncate text-lg font-semibold text-slate-950 dark:text-white">{group.jobTitle}</h3>
                                  {group.proctorFailedCount > 0 && (
                                    <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-amber-800">
                                      {group.proctorFailedCount} proctor ended
                                    </Badge>
                                  )}
                                </div>
                                <ArrowUpRight className="h-5 w-5 text-slate-400" />
                              </div>
                              <div className="mt-5 grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                                  <div className="text-muted-foreground">Batches</div>
                                  <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{group.interviews.length}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                                  <div className="text-muted-foreground">Candidates</div>
                                  <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{group.candidateCount}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                                  <div className="text-muted-foreground">Scored</div>
                                  <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{group.scoredCount}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                                  <div className="text-muted-foreground">Avg</div>
                                  <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{group.averageScore ?? "-"}</div>
                                </div>
                              </div>
                              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
                                {hasScores ? (
                                  <div className="p-3">
                                    <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-950 p-4 text-white">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-200">
                                          <Trophy className="h-3.5 w-3.5" />
                                          Top ranked
                                        </div>
                                        <div className="mt-1 truncate text-sm font-semibold">{group.topCandidate?.candidateName}</div>
                                        <div className="mt-1 text-xs text-slate-400">{group.priorityCount} priority candidate{group.priorityCount === 1 ? "" : "s"}</div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-3xl font-semibold">{group.averageScore}</div>
                                        <div className="text-xs text-slate-400">avg score</div>
                                      </div>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                      {group.rankings.slice(0, 3).map((candidate) => (
                                        <div key={`${candidate.interviewId}-${candidate.sessionId}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-[11px] font-semibold text-white">
                                              {candidate.jobRank}
                                            </span>
                                            <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{candidate.candidateName}</span>
                                          </div>
                                          <span className="flex shrink-0 items-center gap-1 font-semibold">
                                            <Star className="h-3.5 w-3.5 text-amber-500" />
                                            {candidate.score}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                                    <Medal className="h-4 w-4 text-slate-400" />
                                    Ranking appears after candidates complete interviews for this job.
                                  </div>
                                )}
                              </div>
                              <div className="mt-4 space-y-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>Completion</span>
                                  <span>{group.completion}%</span>
                                </div>
                                <Progress value={group.completion} className="h-2" />
                              </div>
                            </CardContent>
                          </Card>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              <Alert className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <AlertDescription>No AI interviews have been created yet.</AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AddToCandidateListDialog
        open={showRankingListDialog}
        onOpenChange={setShowRankingListDialog}
        entries={rankingListEntries}
        source="ai_interview"
        sourceRef={{ jobId: selectedJobRanking?.jobId, jobTitle: selectedJobRanking?.jobTitle }}
        defaultName={`${selectedJobRanking?.jobTitle || "AI interview"} - top ${rankingListEntries.length || rankingListTopN}`}
        defaultDescription={selectedJobRanking?.jobTitle ? `AI interview ranking for ${selectedJobRanking.jobTitle}` : "AI interview ranking"}
        countLabel={`${rankingListEntries.length} ranked candidate${rankingListEntries.length === 1 ? "" : "s"} will be saved.`}
        onCompleted={() => setRankingListEntries([])}
      />
    </div>
  );
}
