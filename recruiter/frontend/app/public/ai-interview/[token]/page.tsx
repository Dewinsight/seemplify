"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileQuestion,
  GripVertical,
  Headphones,
  Info,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  TimerReset,
  UserRound,
  Volume2,
  Workflow,
  X
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { AIVoiceAvatar, AIVoiceWave } from "@/components/ai-voice-avatar";
import { getAIInterviewVoiceAvatar } from "@/lib/aiVoiceAvatars";
import aiInterviewService, { type AIInterviewProctoringEventType, type PublicAIInterviewState } from "@/services/aiInterviewService";
import { CandidateChatgptGate } from "@/components/ui/candidate-chatgpt-gate";

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
    case "proctor_failed":
      return "Ended";
    case "in_progress":
      return "In progress";
    case "opened":
    case "sent":
      return "Ready";
    default:
      return status || "Loading";
  }
}

function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function canonicalTranscriptText(value: string) {
  return normalizeTranscriptText(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function transcriptKey(role: "ai" | "candidate", questionIndex: number, text: string) {
  return `${role}:${questionIndex}:${canonicalTranscriptText(text)}`;
}

function areEquivalentTranscriptTexts(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 30 && longer.includes(shorter);
}

function mergeTranscriptPreview(current: string, incoming: string) {
  const existing = normalizeTranscriptText(current);
  const next = normalizeTranscriptText(incoming);
  if (!existing) return next;
  if (!next) return existing;

  const canonicalExisting = canonicalTranscriptText(existing);
  const canonicalNext = canonicalTranscriptText(next);
  if (!canonicalNext || canonicalExisting.includes(canonicalNext)) return existing;
  if (canonicalNext.includes(canonicalExisting)) return next;

  const existingWords = existing.split(/\s+/).filter(Boolean);
  const nextWords = next.split(/\s+/).filter(Boolean);
  const canonicalExistingWords = existingWords.map(canonicalTranscriptText);
  const canonicalNextWords = nextWords.map(canonicalTranscriptText);
  const maxOverlap = Math.min(12, canonicalExistingWords.length, canonicalNextWords.length);
  let overlap = 0;

  for (let count = maxOverlap; count > 0; count -= 1) {
    const left = canonicalExistingWords.slice(-count).join(" ");
    const right = canonicalNextWords.slice(0, count).join(" ");
    if (left && left === right) {
      overlap = count;
      break;
    }
  }

  return normalizeTranscriptText(`${existing} ${nextWords.slice(overlap).join(" ")}`);
}

function hasEquivalentTranscriptMessage(
  data: PublicAIInterviewState | null,
  role: "ai" | "candidate",
  questionIndex: number,
  text: string
) {
  const normalized = canonicalTranscriptText(text);
  if (!normalized) return false;

  return Boolean(data?.session.messages?.some((message) => {
    if (message.role !== role || message.questionIndex !== questionIndex) return false;
    const existing = canonicalTranscriptText(message.content || "");
    if (!existing) return false;
    return areEquivalentTranscriptTexts(existing, normalized);
  }));
}

// Single source of truth for the voice-mode lifecycle. Every UI element reads
// this so TTS playback and candidate recording cannot fight each other. Keep
// all voice hooks below ordered by dependency to avoid production TDZ crashes.
//   off        - voice mode is not running
//   connecting - preparing audio devices
//   speaking   - TTS is playing one or more AI messages back-to-back
//   ready      - voice is available, mic is off, candidate can tap the mic
//   listening  - mic is recording candidate audio
//   processing - Azure STT is transcribing, then the answer is submitted
//   error      - voice mode failed; user must restart
type VoicePhase = "off" | "connecting" | "speaking" | "ready" | "listening" | "processing" | "error";

type ProctoringModalState = {
  open: boolean;
  severity: "warning" | "final" | "blocked" | "input";
  title: string;
  message: string;
  details?: string;
  primaryAction?: string;
  focusCount?: number;
  maxFocusViolations?: number;
  pasteCount?: number;
  locked?: boolean;
};

type AssistantSpeechState = {
  active: boolean;
  text: string;
  progress: number;
};

type AudioDeviceOption = {
  deviceId: string;
  label: string;
};

type CandidateAudioRecorder = {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
};

function flattenAudioChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function downsampleAudioBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (outputSampleRate === inputSampleRate) return buffer;
  if (outputSampleRate > inputSampleRate) return buffer;

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accumulator = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accumulator += buffer[i];
      count += 1;
    }

    result[offsetResult] = count ? accumulator / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function writeAsciiString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWavBlob(chunks: Float32Array[], sampleRate: number) {
  const targetSampleRate = 16000;
  const samples = downsampleAudioBuffer(flattenAudioChunks(chunks), sampleRate, targetSampleRate);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([view], { type: "audio/wav" });
}

function getSpeakableAiMessages(data: PublicAIInterviewState) {
  const currentIndex = data.session.currentQuestionIndex;
  return (data.session.messages || []).filter((chat) => {
    if (chat.role !== "ai") return false;
    if (chat.questionIndex == null) {
      return chat.messageType === "greeting" && data.session.status === "in_progress";
    }
    return chat.questionIndex === currentIndex && ["transition", "question", "clarification", "acknowledgement"].includes(chat.messageType);
  });
}

function getAiMessageSpeakKey(message?: PublicAIInterviewState["session"]["messages"][number]) {
  if (!message) return "";
  return message._id || `${message.questionIndex ?? "none"}:${message.messageType}:${canonicalTranscriptText(message.content || "")}`;
}

function getHighlightedWordCount(text: string, progress: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  return Math.max(1, Math.min(words.length, Math.ceil((Math.max(0, Math.min(100, progress)) / 100) * words.length)));
}

function renderHighlightedSpeech(text: string, highlightedWordCount: number) {
  let wordIndex = 0;
  return text.split(/(\s+)/).map((part, index) => {
    if (!part.trim()) return part;
    wordIndex += 1;
    const isHighlighted = wordIndex <= highlightedWordCount;
    return (
      <span
        key={`${part}-${index}`}
        className={isHighlighted ? "rounded bg-emerald-100 px-0.5 text-emerald-950" : "text-slate-500"}
      >
        {part}
      </span>
    );
  });
}

function buildFocusProctoringModal(
  action: "warned" | "final_warning" | "terminated",
  warningMessage: string | undefined,
  focusCount: number,
  maxFocusViolations: number
): ProctoringModalState {
  const remaining = Math.max(0, maxFocusViolations - focusCount);

  if (action === "terminated") {
    return {
      open: true,
      severity: "blocked",
      title: "Interview ended",
      message: warningMessage || "You left the interview screen too many times, so this interview has been ended.",
      details: "The recruiter will see the proctoring log for this session.",
      primaryAction: "Review status",
      focusCount,
      maxFocusViolations,
      locked: true
    };
  }

  if (action === "final_warning") {
    return {
      open: true,
      severity: "final",
      title: "Final proctoring warning",
      message: `You have moved away from the interview screen ${focusCount} times. If you leave again, this interview will automatically end.`,
      details: warningMessage || "Keep this tab visible until the interview is complete.",
      primaryAction: "I understand",
      focusCount,
      maxFocusViolations
    };
  }

  return {
    open: true,
    severity: "warning",
    title: "Proctoring warning",
    message: `You moved away from the interview screen ${focusCount} time${focusCount === 1 ? "" : "s"}. You have ${remaining} more before the interview is blocked.`,
    details: warningMessage || "Stay on this tab while the interview is in progress.",
    primaryAction: "I understand",
    focusCount,
    maxFocusViolations
  };
}

function buildInputProctoringModal(type: "paste_attempt" | "drop_attempt", pasteCount: number, warningMessage?: string): ProctoringModalState {
  const isDrop = type === "drop_attempt";
  return {
    open: true,
    severity: "input",
    title: isDrop ? "Drop blocked" : "Paste blocked",
    message: isDrop
      ? "Dropping prepared text or files into the answer box is not allowed."
      : "Pasting prepared answers into this interview is not allowed.",
    details: warningMessage || "This attempt has been logged for the recruiter. Please type your answer in your own words.",
    primaryAction: "I understand",
    pasteCount
  };
}

function renderVoiceBars(level: number, tone: "blue" | "emerald" | "slate" | "white" = "blue", compact = false) {
  const bars = Array.from({ length: compact ? 12 : 18 });
  const normalized = Math.max(8, Math.min(100, level));
  const toneClass = tone === "emerald" ? "bg-emerald-400" : tone === "blue" ? "bg-blue-500" : tone === "white" ? "bg-white" : "bg-slate-400";

  return (
    <div className={`flex ${compact ? "h-7 gap-0.5" : "h-9 gap-1"} items-center`}>
      {bars.map((_, index) => {
        const wave = Math.abs(Math.sin((index + 1) * 0.72));
        const height = compact
          ? 7 + wave * 14 + (normalized / 100) * 10
          : 8 + wave * 18 + (normalized / 100) * 14;
        return (
          <span
            key={index}
            className={`w-1 rounded-full ${toneClass} transition-all duration-150 ${level > 12 ? "animate-pulse" : ""}`}
            style={{
              height: `${Math.round(height)}px`,
              opacity: 0.42 + wave * 0.48,
              animationDelay: `${index * 45}ms`
            }}
          />
        );
      })}
    </div>
  );
}

function PublicAIInterviewExperience() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  // When the page is opened with ?demo=1 we expose a "Reset interview" control
  // so a single bookmarked interview can be tested over and over without
  // creating a new candidate each time.
  const demoMode = searchParams?.get("demo") === "1";
  const [state, setState] = useState<PublicAIInterviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [starting, setStarting] = useState(false);
  // The interview runs on the candidate's own ChatGPT account, so it cannot
  // begin until they have connected one and acknowledged the data notice.
  const [chatgptReady, setChatgptReady] = useState(false);
  const [disconnectingChatgpt, setDisconnectingChatgpt] = useState(false);
  const [chatgptDisconnected, setChatgptDisconnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [questionSeconds, setQuestionSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [timeoutRunning, setTimeoutRunning] = useState(false);
  const [voicePhase, setVoicePhaseState] = useState<VoicePhase>("off");
  const [voiceStatus, setVoiceStatus] = useState("Voice mode is off");
  const [audioInputs, setAudioInputs] = useState<AudioDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<AudioDeviceOption[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("");
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState("");
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false);
  const [proctoringModal, setProctoringModal] = useState<ProctoringModalState | null>(null);
  const [assistantSpeech, setAssistantSpeech] = useState<AssistantSpeechState>({
    active: false,
    text: "",
    progress: 0
  });
  const [micLevel, setMicLevel] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const disconnectChatgpt = useCallback(async () => {
    if (disconnectingChatgpt) return;
    setDisconnectingChatgpt(true);
    try {
      await aiInterviewService.disconnectPublicChatgpt(token);
      setChatgptDisconnected(true);
      toast.success("Your ChatGPT connection has been removed.");
    } catch (reason: any) {
      toast.error(reason?.message || "Your ChatGPT connection could not be removed yet.");
    } finally {
      setDisconnectingChatgpt(false);
    }
  }, [disconnectingChatgpt, token]);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeTtsUrlRef = useRef("");
  const speechRequestIdRef = useRef(0);
  const spokenAiMessageKeysRef = useRef<Set<string>>(new Set());
  const speechQueueRunningRef = useRef(false);
  const messageRef = useRef("");
  const speechRecognitionActiveRef = useRef(false);
  const candidateAudioRecorderRef = useRef<CandidateAudioRecorder | null>(null);
  const voiceAudioCaptureEnabledRef = useRef(false);
  const assistantSpeechTimerRef = useRef<number | null>(null);
  const assistantSpeechTextRef = useRef("");
  const assistantSpeechStartedAtRef = useRef(0);
  const assistantSpeechDurationRef = useRef(0);
  const liveTranscriptTimerRef = useRef<number | null>(null);
  const liveTranscriptRequestIdRef = useRef(0);
  const liveTranscriptInFlightRef = useRef(false);
  const liveTranscriptChunkCursorRef = useRef(0);
  const liveTranscriptPreviewTextRef = useRef("");
  const micLevelLastUpdateRef = useRef(0);
  const recordedTranscriptKeysRef = useRef<Set<string>>(new Set());
  // Phase mirror so async work (audio playback, fetches, WS events) can read
  // the current phase without waiting for a re-render.
  const voicePhaseRef = useRef<VoicePhase>("off");
  const stateRef = useRef<PublicAIInterviewState | null>(null);
  const sessionRef = useRef<PublicAIInterviewState["session"] | null>(null);
  const proctoringEventInFlightRef = useRef(false);
  const lastProctoringEventAtRef = useRef<Record<string, number>>({});

  const applyPublicState = useCallback((data: PublicAIInterviewState) => {
    stateRef.current = data;
    sessionRef.current = data.session;
    setState(data);
  }, []);

  const session = state?.session;
  const interview = state?.interview;
  const questionCount = interview?.questionCount || 0;
  const currentIndex = session?.currentQuestionIndex || 0;
  const voiceEnabled = Boolean(state?.voice?.enabled);
  const activeStep = session?.status === "completed"
    ? questionCount
    : session?.status === "in_progress"
      ? currentIndex + 1
      : 0;
  const progress = questionCount > 0 ? (activeStep / questionCount) * 100 : 0;
  const proctoring = session?.proctoring;
  const focusViolationCount = Number(proctoring?.focusViolationCount || 0);
  const maxFocusViolations = Number(proctoring?.maxFocusViolations || 3);
  const pasteAttemptCount = Number(proctoring?.pasteAttemptCount || 0);
  const focusAttemptsRemaining = Math.max(0, maxFocusViolations - focusViolationCount);
  const candidateName = state?.candidate?.name || [state?.candidate?.firstName, state?.candidate?.lastName].filter(Boolean).join(" ") || "Candidate";
  const questionTimeLabel = `${interview?.timers.perQuestionMinutes || 0}m`;
  const totalTimeLabel = `${interview?.timers.totalMinutes || 0}m`;
  const voiceModeLabel = voiceEnabled ? "Voice and text" : "Text only";
  const speakableAiMessageSignature = useMemo(() => (
    state
      ? getSpeakableAiMessages(state).map((message) => getAiMessageSpeakKey(message)).filter(Boolean).join("|")
      : ""
  ), [state]);
  const assistantHighlightedWords = useMemo(
    () => getHighlightedWordCount(assistantSpeech.text, assistantSpeech.progress),
    [assistantSpeech.progress, assistantSpeech.text]
  );
  // The single voice action button has different meanings per phase:
  //   off / error   — primary action is to start voice mode
  //   speaking      — disabled (the AI is talking)
  //   listening     — primary action is "I'm done speaking" → moves to processing
  //   processing    — disabled (we're talking to the backend)
  //   connecting    — disabled spinner
  const voiceActionLabel = (() => {
    switch (voicePhase) {
      case "speaking": return "AI is speaking";
      case "ready": return "Open mic";
      case "listening": return "I'm done";
      case "processing": return "Thinking…";
      case "connecting": return "Connecting…";
      case "error": return "Restart voice";
      default: return "Start voice";
    }
  })();
  const voiceActionDisabled = voicePhase === "speaking" || voicePhase === "processing" || voicePhase === "connecting";
  const voiceBannerTone: "speaking" | "listening" | "processing" | "error" | "neutral" = (() => {
    if (voicePhase === "speaking") return "speaking";
    if (voicePhase === "ready") return "listening";
    if (voicePhase === "listening") return "listening";
    if (voicePhase === "processing") return "processing";
    if (voicePhase === "error") return "error";
    return "neutral";
  })();
  const selectedVoice = state?.voice?.selectedVoice || null;
  const voiceAvatar = getAIInterviewVoiceAvatar(selectedVoice);
  const interviewerIsSpeaking = voicePhase === "speaking" && assistantSpeech.active;
  const interviewerWaveLevel = interviewerIsSpeaking
    ? assistantSpeech.progress
    : voicePhase === "processing"
      ? 48
      : voicePhase === "ready" || voicePhase === "listening"
        ? 28
        : 14;
  const layoutStyle = {
    "--interview-rail-width": sidebarCollapsed ? "76px" : `${sidebarWidth}px`
  } as CSSProperties;

  const load = async () => {
    setLoading(true);
    try {
      const data = await aiInterviewService.bootstrapPublic(token);
      applyPublicState(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to load interview");
    } finally {
      setLoading(false);
    }
  };

  const recordProctoringEvent = useCallback(async (
    type: AIInterviewProctoringEventType,
    metadata?: { visibilityState?: string; reason?: string }
  ) => {
    const sessionStatus = sessionRef.current?.status;
    if (sessionStatus !== "in_progress") return;

    const category = type === "paste_attempt" || type === "drop_attempt" ? "input" : "focus";
    const now = Date.now();
    const lastAt = lastProctoringEventAtRef.current[category] || 0;
    const cooldownMs = category === "focus" ? 3000 : 900;
    if (now - lastAt < cooldownMs) return;
    lastProctoringEventAtRef.current[category] = now;

    if (category === "focus" && proctoringEventInFlightRef.current) return;
    if (category === "focus") proctoringEventInFlightRef.current = true;

    try {
      const data = await aiInterviewService.recordPublicProctoringEvent(token, {
        type,
        metadata: {
          visibilityState: typeof document !== "undefined" ? document.visibilityState : undefined,
          ...metadata
        }
      });
      applyPublicState(data);
      const nextProctoring = data.session?.proctoring;
      const nextFocusCount = Number(nextProctoring?.focusViolationCount || 0);
      const nextMaxFocusViolations = Number(nextProctoring?.maxFocusViolations || 3);
      const nextPasteCount = Number(nextProctoring?.pasteAttemptCount || 0);

      if (data.action === "terminated") {
        ttsAudioRef.current?.pause();
        setAssistantSpeech({ active: false, text: "", progress: 0 });
        setVoicePhaseState("off");
        voicePhaseRef.current = "off";
        setVoiceStatus("Interview ended due to proctoring");
        setProctoringModal(buildFocusProctoringModal("terminated", data.warningMessage, nextFocusCount, nextMaxFocusViolations));
        toast.error(data.warningMessage || "Interview ended due to proctoring violations.");
      } else if (data.action === "final_warning") {
        setProctoringModal(buildFocusProctoringModal("final_warning", data.warningMessage, nextFocusCount, nextMaxFocusViolations));
        toast.warning(data.warningMessage || "Final warning: leaving again will end the interview.");
      } else if (data.action === "warned") {
        setProctoringModal(buildFocusProctoringModal("warned", data.warningMessage, nextFocusCount, nextMaxFocusViolations));
        toast.warning(data.warningMessage || "Please keep this interview tab open.");
      } else if (category === "input" && !data.deduped) {
        setProctoringModal(buildInputProctoringModal(type as "paste_attempt" | "drop_attempt", nextPasteCount, data.warningMessage));
        toast.warning(data.warningMessage || (category === "input" ? "Pasting is disabled for this interview." : "Please keep this interview tab open."));
      }
    } catch (error: any) {
      if (category === "input") {
        const currentPasteCount = Number(sessionRef.current?.proctoring?.pasteAttemptCount || 0);
        setProctoringModal(buildInputProctoringModal(type as "paste_attempt" | "drop_attempt", currentPasteCount + 1));
        toast.warning(type === "drop_attempt" ? "Dropping content is disabled for this interview." : "Pasting is disabled for this interview.");
      } else {
        toast.error(error?.message || "Could not record proctoring event");
      }
    } finally {
      if (category === "focus") proctoringEventInFlightRef.current = false;
    }
  }, [applyPublicState, token]);

  const loadAudioDevices = useCallback(async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let permissionStream: MediaStream | null = null;
    try {
      if (requestPermission) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`
        }));
      const outputs = devices
        .filter((device) => device.kind === "audiooutput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${index + 1}`
        }));

      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      setSelectedInputDeviceId((current) => (
        current && inputs.some((device) => device.deviceId === current) ? current : inputs[0]?.deviceId || ""
      ));
      setSelectedOutputDeviceId((current) => (
        current && outputs.some((device) => device.deviceId === current) ? current : outputs[0]?.deviceId || ""
      ));
    } catch (error) {
      if (requestPermission) {
        toast.error("Unable to access microphone devices");
      }
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }, []);

  const applyOutputDevice = useCallback(async (deviceId: string) => {
    const audio = ttsAudioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!audio?.setSinkId || !deviceId) return;
    try {
      await audio.setSinkId(deviceId);
    } catch {
      toast.error("Could not switch speaker output in this browser");
    }
  }, []);

  // Single setter that updates the phase ref AND state in one place. Every
  // transition flows through here so the ref and the React state can never
  // disagree (a class of bugs the previous implementation kept hitting).
  const setVoicePhase = useCallback((next: VoicePhase, status?: string) => {
    voicePhaseRef.current = next;
    setVoicePhaseState(next);
    if (status !== undefined) setVoiceStatus(status);
  }, []);

  const setMicTrackEnabled = useCallback((enabled: boolean) => {
    voiceAudioCaptureEnabledRef.current = enabled;
  }, []);

  const isVoiceTransportActive = useCallback(() => {
    return Boolean(stateRef.current?.voice?.enabled ?? voiceEnabled);
  }, [voiceEnabled]);

  const openCandidateMic = useCallback(() => {
    setMicTrackEnabled(true);
  }, [setMicTrackEnabled]);

  const stopLiveTranscriptionPreview = useCallback(() => {
    if (liveTranscriptTimerRef.current) {
      window.clearInterval(liveTranscriptTimerRef.current);
      liveTranscriptTimerRef.current = null;
    }
    liveTranscriptRequestIdRef.current += 1;
    liveTranscriptInFlightRef.current = false;
  }, []);

  const updateLiveTranscriptionPreview = useCallback(async (force = false) => {
    if (liveTranscriptInFlightRef.current && !force) return;
    const recorder = candidateAudioRecorderRef.current;
    if (!recorder || voicePhaseRef.current !== "listening") return;

    const endChunkIndex = recorder.chunks.length;
    const startChunkIndex = liveTranscriptChunkCursorRef.current;
    const newChunkCount = endChunkIndex - startChunkIndex;
    if (!force && newChunkCount < 22) return;
    if (newChunkCount <= 0) return;

    const requestId = ++liveTranscriptRequestIdRef.current;
    const overlap = startChunkIndex > 0 ? Math.min(6, startChunkIndex) : 0;
    const audioBlob = encodeWavBlob(recorder.chunks.slice(startChunkIndex - overlap, endChunkIndex), recorder.sampleRate);
    if (audioBlob.size < 4000) return;

    try {
      liveTranscriptInFlightRef.current = true;
      const result = await aiInterviewService.transcribePublicSpeech(token, audioBlob);
      if (requestId !== liveTranscriptRequestIdRef.current || voicePhaseRef.current !== "listening") return;

      const transcript = normalizeTranscriptText(result.transcript || "");
      liveTranscriptChunkCursorRef.current = Math.max(liveTranscriptChunkCursorRef.current, endChunkIndex);
      if (!transcript) return;

      const merged = mergeTranscriptPreview(messageRef.current || liveTranscriptPreviewTextRef.current, transcript);
      setMessage(merged);
      messageRef.current = merged;
      liveTranscriptPreviewTextRef.current = merged;
      setVoiceStatus("Listening. Your answer is appearing in the chat.");
    } catch {
      // Live preview is best-effort. The final Azure transcription still runs
      // when the candidate taps "I'm done".
    } finally {
      liveTranscriptInFlightRef.current = false;
    }
  }, [token]);

  const startLiveTranscriptionPreview = useCallback(() => {
    stopLiveTranscriptionPreview();
    liveTranscriptTimerRef.current = window.setInterval(() => {
      void updateLiveTranscriptionPreview(false);
    }, 2600);
  }, [stopLiveTranscriptionPreview, updateLiveTranscriptionPreview]);

  const stopCandidateRecording = useCallback(() => {
    stopLiveTranscriptionPreview();
    setMicTrackEnabled(false);
    speechRecognitionActiveRef.current = false;
    setMicLevel(0);

    const recorder = candidateAudioRecorderRef.current;
    candidateAudioRecorderRef.current = null;
    if (!recorder) return null;

    try { recorder.processor.disconnect(); } catch { /* ignore */ }
    try { recorder.source.disconnect(); } catch { /* ignore */ }
    recorder.stream.getTracks().forEach((track) => track.stop());
    void recorder.audioContext.close().catch(() => {});

    if (!recorder.chunks.length) return null;
    return encodeWavBlob(recorder.chunks, recorder.sampleRate);
  }, [setMicTrackEnabled, stopLiveTranscriptionPreview]);

  const startCandidateRecording = useCallback(async () => {
    stopCandidateRecording();
    setMicTrackEnabled(true);
    liveTranscriptChunkCursorRef.current = 0;
    liveTranscriptPreviewTextRef.current = messageRef.current;

    const AudioContextConstructor =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support microphone recording.");
    }

    const selectedDevice = selectedInputDeviceId && selectedInputDeviceId !== "default" ? selectedInputDeviceId : "";
    const buildConstraints = (deviceId?: string): MediaStreamConstraints => ({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(buildConstraints(selectedDevice));
    } catch (error) {
      if (!selectedDevice) throw error;
      setSelectedInputDeviceId("");
      stream = await navigator.mediaDevices.getUserMedia(buildConstraints());
      toast.info("Selected microphone was unavailable. Using the default microphone.");
    }

    const audioContext = new AudioContextConstructor();
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];

    processor.onaudioprocess = (event) => {
      if (!voiceAudioCaptureEnabledRef.current || voicePhaseRef.current !== "listening") return;
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      const now = Date.now();
      if (now - micLevelLastUpdateRef.current > 90) {
        let sum = 0;
        for (let i = 0; i < input.length; i += 1) {
          sum += input[i] * input[i];
        }
        const rms = Math.sqrt(sum / input.length);
        setMicLevel(Math.max(4, Math.min(100, Math.round(rms * 650))));
        micLevelLastUpdateRef.current = now;
      }
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    candidateAudioRecorderRef.current = {
      stream,
      audioContext,
      source,
      processor,
      chunks,
      sampleRate: audioContext.sampleRate
    };
    speechRecognitionActiveRef.current = true;
    startLiveTranscriptionPreview();
  }, [selectedInputDeviceId, setSelectedInputDeviceId, startLiveTranscriptionPreview, stopCandidateRecording]);

  const pauseCandidateMic = useCallback((_options: { endTurn?: boolean } = {}) => {
    stopCandidateRecording();
  }, [stopCandidateRecording]);

  const startListeningTurn = useCallback(async () => {
    if (!isVoiceTransportActive()) {
      setVoicePhase("off", "Voice connection lost. Restart voice mode to continue.");
      return;
    }
    openCandidateMic();
    setVoicePhase("listening", "Opening your microphone...");

    try {
      await startCandidateRecording();
      setVoicePhase("listening", "Listening. Your answer is appearing in the chat. Tap I'm done to submit.");
    } catch (error: any) {
      setMicTrackEnabled(false);
      setVoicePhase("ready", "Speech recognition could not start. Check your microphone and try again.");
      toast.error(error?.message || "Speech recognition failed to start");
    }
  }, [isVoiceTransportActive, openCandidateMic, setMicTrackEnabled, setVoicePhase, startCandidateRecording]);

  const cleanupVoice = useCallback((status = "Voice mode is off", nextPhase: VoicePhase = "off") => {
    stopCandidateRecording();
    speechRecognitionActiveRef.current = false;
    voiceAudioCaptureEnabledRef.current = false;

    // Bumping this aborts any in-flight TTS fetch/playback awaiting on the
    // current request id.
    speechRequestIdRef.current += 1;
    if (ttsAudioRef.current) {
      try {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.removeAttribute("src");
        ttsAudioRef.current.load();
      } catch {
        // ignore
      }
    }
    if (activeTtsUrlRef.current) {
      URL.revokeObjectURL(activeTtsUrlRef.current);
      activeTtsUrlRef.current = "";
    }

    if (assistantSpeechTimerRef.current) {
      window.clearInterval(assistantSpeechTimerRef.current);
      assistantSpeechTimerRef.current = null;
    }

    assistantSpeechTextRef.current = "";
    assistantSpeechStartedAtRef.current = 0;
    assistantSpeechDurationRef.current = 0;
    spokenAiMessageKeysRef.current.clear();
    speechQueueRunningRef.current = false;
    setAssistantSpeech({ active: false, text: "", progress: 0 });
    setVoicePhase(nextPhase, status);
  }, [setVoicePhase, stopCandidateRecording]);

  // Reserved for future use — AI messages are already persisted by the
  // backend when they are created, so the frontend does not need to record
  // them again. We keep the helpers around in case a future caller needs to
  // push a transcript out-of-band.

  const startAssistantSpeechVisual = useCallback((text: string, useEstimatedTimer = true) => {
    const cleaned = text.trim();
    if (!cleaned) return;

    if (assistantSpeechTimerRef.current) {
      window.clearInterval(assistantSpeechTimerRef.current);
      assistantSpeechTimerRef.current = null;
    }

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    const estimatedDuration = Math.min(45000, Math.max(2800, wordCount * 430));
    assistantSpeechTextRef.current = cleaned;
    assistantSpeechStartedAtRef.current = Date.now();
    assistantSpeechDurationRef.current = estimatedDuration;
    setAssistantSpeech({ active: true, text: cleaned, progress: 2 });

    if (!useEstimatedTimer) return;

    assistantSpeechTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - assistantSpeechStartedAtRef.current;
      const progress = Math.min(92, Math.round((elapsed / assistantSpeechDurationRef.current) * 100));
      setAssistantSpeech((current) => (
        current.active && current.text === assistantSpeechTextRef.current
          ? { ...current, progress }
          : current
      ));
    }, 180);
  }, []);

  const finishAssistantSpeechVisual = useCallback(() => {
    if (assistantSpeechTimerRef.current) {
      window.clearInterval(assistantSpeechTimerRef.current);
      assistantSpeechTimerRef.current = null;
    }

    const spokenText = assistantSpeechTextRef.current;
    if (!spokenText) {
      setAssistantSpeech((current) => {
        if (!current.active) return { active: false, text: "", progress: 0 };
        const currentText = current.text;
        window.setTimeout(() => {
          setAssistantSpeech((latest) => (
            latest.text === currentText ? { active: false, text: "", progress: 0 } : latest
          ));
        }, 900);
        return { ...current, progress: 100 };
      });
      return;
    }

    setAssistantSpeech({ active: true, text: spokenText, progress: 100 });
    assistantSpeechTextRef.current = "";

    window.setTimeout(() => {
      setAssistantSpeech((current) => (
        current.text === spokenText ? { active: false, text: "", progress: 0 } : current
      ));
    }, 900);
  }, []);

  // Play exactly one TTS clip via the persistent audio element. Resolves on
  // 'ended', rejects on error/abort. Caller is responsible for updating phase
  // and the visible progress bar.
  const playSpeechClip = useCallback(async (
    text: string,
    requestId: number,
    options: { messageId?: string } = {}
  ) => {
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned) return;
    const maybeAudio = ttsAudioRef.current;
    if (!maybeAudio) throw new Error("Audio element not ready.");
    const audio: HTMLAudioElement = maybeAudio;
    await applyOutputDevice(selectedOutputDeviceId);

    // Stop any current playback before swapping the source. We DO NOT call
    // removeAttribute("src") + load() here — that un-primes the element on
    // iOS Safari and causes the very next play() to silently never fire
    // 'ended'.
    try { audio.pause(); } catch { /* ignore */ }

    const previousUrl = activeTtsUrlRef.current;
    // Prefer sending the message id so the backend can speak the exact stored
    // content — bypasses the canonical-text approval check which had false
    // negatives for some messages.
    const audioBlob = await aiInterviewService.synthesizePublicSpeech(
      token,
      options.messageId ? { messageId: options.messageId, text: cleaned } : { text: cleaned }
    );
    if (speechRequestIdRef.current !== requestId) return;

    console.debug("[ai-interview] tts blob received", {
      size: audioBlob.size,
      type: audioBlob.type
    });

    // Defensive validation — if the server returned something that isn't
    // audio (HTML/JSON edge errors or a truncated stream) we'd otherwise
    // try to play it and the browser would emit garbled static. Surface
    // the real problem instead.
    if (!audioBlob.size) {
      throw new Error("Interviewer voice response was empty.");
    }
    if (audioBlob.type && !/^audio\//i.test(audioBlob.type)) {
      throw new Error(`Interviewer voice response was not audio (got ${audioBlob.type}).`);
    }

    const objectUrl = URL.createObjectURL(audioBlob);
    activeTtsUrlRef.current = objectUrl;
    audio.src = objectUrl;
    // Force the new resource to start loading. Without this, browsers can
    // be lazy after a previous 'ended' and play() stalls forever.
    try { audio.load(); } catch { /* ignore */ }

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const onEnded = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const onError = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Audio playback failed."));
        };
        const onTimeUpdate = () => {
          if (speechRequestIdRef.current !== requestId) return;
          if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
          const progress = Math.max(2, Math.min(99, Math.round((audio.currentTime / audio.duration) * 100)));
          setAssistantSpeech((current) => (
            current.text === cleaned ? { ...current, active: true, progress } : current
          ));
        };
        // Safety net so a stalled play() can never deadlock the queue.
        const guardTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Interviewer voice playback timed out."));
        }, 120_000);
        function cleanup() {
          window.clearTimeout(guardTimer);
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          audio.removeEventListener("timeupdate", onTimeUpdate);
        }
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.play().catch((error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        });
      });
    } finally {
      // Revoke the prior blob URL only after the new one has played so the
      // browser never has a revoked URL set as the active media source.
      if (previousUrl && previousUrl !== objectUrl) {
        try { URL.revokeObjectURL(previousUrl); } catch { /* ignore */ }
      }
    }
  }, [applyOutputDevice, selectedOutputDeviceId, token]);

  const submitCandidateText = useCallback(async (text: string) => {
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned) return false;

    const activeSession = sessionRef.current;
    if (!activeSession || activeSession.status !== "in_progress") return false;

    const key = transcriptKey("candidate", activeSession.currentQuestionIndex, cleaned);
    if (recordedTranscriptKeysRef.current.has(key) || hasEquivalentTranscriptMessage(stateRef.current, "candidate", activeSession.currentQuestionIndex, cleaned)) {
      setMessage("");
      messageRef.current = "";
      return true;
    }

    recordedTranscriptKeysRef.current.add(key);
    setSending(true);
    setMessage("");
    messageRef.current = "";

    try {
      const data = await aiInterviewService.sendPublicMessage(token, cleaned);
      applyPublicState(data);
      return true;
    } catch (error: any) {
      recordedTranscriptKeysRef.current.delete(key);
      setMessage(cleaned);
      messageRef.current = cleaned;
      toast.error(error?.message || "Failed to send your answer");
      return false;
    } finally {
      setSending(false);
    }
  }, [applyPublicState, token]);

  // Speaks every queued AI message that has not been spoken yet, then opens
  // the candidate mic automatically. Re-entry is safe; concurrent invocations
  // no-op.
  const advanceVoiceFlow = useCallback(async () => {
    if (speechQueueRunningRef.current) return;
    if (voicePhaseRef.current === "off" || voicePhaseRef.current === "error" || voicePhaseRef.current === "connecting") {
      return;
    }
    if (!isVoiceTransportActive()) {
      setVoicePhase("off", "Voice connection lost. Restart voice mode to continue.");
      return;
    }

    speechQueueRunningRef.current = true;
    try {
      while (true) {
        const data = stateRef.current;
        if (!data || data.session.status !== "in_progress") break;

        const pending = getSpeakableAiMessages(data)
          .map((message) => ({
            message,
            key: getAiMessageSpeakKey(message),
            content: (message.content || "").trim()
          }))
          .filter((item) => item.key && item.content && !spokenAiMessageKeysRef.current.has(item.key));

        if (pending.length === 0) break;

        const item = pending[0];
        spokenAiMessageKeysRef.current.add(item.key);

        setVoicePhase("speaking", "Interviewer is speaking…");
        pauseCandidateMic();

        const requestId = ++speechRequestIdRef.current;
        const cleaned = normalizeTranscriptText(item.content);
        startAssistantSpeechVisual(cleaned, false);

        try {
          console.debug("[ai-interview] speaking", { key: item.key });
          await playSpeechClip(cleaned, requestId, { messageId: item.message._id });
          console.debug("[ai-interview] spoken", { key: item.key });
        } catch (error: any) {
          console.warn("[ai-interview] playback failed", { key: item.key, error });
          toast.error(error?.message || "Unable to play interviewer voice");
          // Keep the key marked as spoken so the queue keeps moving — the
          // alternative is an infinite retry loop on a broken message.
        } finally {
          finishAssistantSpeechVisual();
        }

        // If the user disconnected voice mid-clip, bail out cleanly. The ref
        // is narrowed by control flow above, so cast through unknown to
        // re-widen — its value really can have changed during the await.
        const phaseAfterClip = voicePhaseRef.current as VoicePhase;
        if (phaseAfterClip === "off" || phaseAfterClip === "error") return;
      }

      // Queue drained. Hand the turn to the candidate immediately.
      const phaseAfterDrain = voicePhaseRef.current as VoicePhase;
      if (
        phaseAfterDrain === "speaking" &&
        sessionRef.current?.status === "in_progress" &&
        isVoiceTransportActive()
      ) {
        setVoicePhase("ready", "Interviewer finished. Opening your mic...");
        await startListeningTurn();
      }
    } finally {
      speechQueueRunningRef.current = false;
    }
  }, [isVoiceTransportActive, pauseCandidateMic, playSpeechClip, setVoicePhase, startAssistantSpeechVisual, finishAssistantSpeechVisual, startListeningTurn]);

  // User pressed "I'm done" while listening — close the mic and move into
  // processing so the upcoming Azure transcript is treated as the answer.
  const endListening = useCallback(async () => {
    if (voicePhaseRef.current !== "listening") return;
    const audioBlob = stopCandidateRecording();
    setVoicePhase("processing", "Transcribing your response with Azure Speech...");

    try {
      if (!audioBlob || audioBlob.size < 800) {
        throw new Error("I didn't catch any audio. Tap the mic and try again.");
      }

      const result = await aiInterviewService.transcribePublicSpeech(token, audioBlob);
      const transcript = normalizeTranscriptText(result.transcript || "");
      if (!transcript) {
        throw new Error("I didn't catch that. Tap the mic to try again.");
      }

      setMessage(transcript);
      messageRef.current = transcript;
      const sent = await submitCandidateText(transcript);
      if (sent) {
        void advanceVoiceFlow();
      } else if (isVoiceTransportActive()) {
        setVoicePhase("ready", "Let's try that again. Tap the mic when ready.");
      }
    } catch (error: any) {
      if (isVoiceTransportActive()) {
        setVoicePhase("ready", error?.message || "I didn't catch that. Tap the mic to try again.");
      } else {
        setVoicePhase("off", "Voice connection lost. Restart voice mode to continue.");
      }
      toast.error(error?.message || "Speech transcription failed");
    }
  }, [advanceVoiceFlow, isVoiceTransportActive, setVoicePhase, stopCandidateRecording, submitCandidateText, token]);

  const disconnectVoice = useCallback(() => {
    cleanupVoice("Voice mode is off");
  }, [cleanupVoice]);

  const connectVoice = useCallback(async (stateOverride?: PublicAIInterviewState) => {
    const activeSession = stateOverride?.session || session;
    const activeVoiceEnabled = Boolean(stateOverride?.voice?.enabled ?? voiceEnabled);

    if (!activeVoiceEnabled) {
      toast.error("Azure Speech is not configured for this interview yet");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser does not support microphone access");
      return;
    }
    if (activeSession?.status !== "in_progress") {
      toast.error("Start the interview before enabling voice mode");
      return;
    }

    cleanupVoice("Starting voice mode…", "connecting");
    setVoicePhase("connecting", "Connecting voice mode…");

    try {
      await loadAudioDevices(true);

      // Voice is live. Transition to 'speaking' and let advanceVoiceFlow drain
      // the queue, after which the candidate mic opens automatically.
      setVoicePhase("speaking", "Voice ready. Interviewer is starting…");
      // A small delay lets the audio element finish settling after any prior
      // cleanup and gives React a paint before audio starts.
      window.setTimeout(() => { void advanceVoiceFlow(); }, 200);
    } catch (error: any) {
      cleanupVoice(error?.message || "Voice mode failed", "error");
      toast.error(error?.message || "Unable to start voice mode");
    }
  }, [advanceVoiceFlow, cleanupVoice, loadAudioDevices, session, setVoicePhase, voiceEnabled]);

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    void loadAudioDevices(false);
    const handler = () => { void loadAudioDevices(false); };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [loadAudioDevices]);

  useEffect(() => {
    void applyOutputDevice(selectedOutputDeviceId);
  }, [applyOutputDevice, selectedOutputDeviceId]);

  useEffect(() => {
    stateRef.current = state;
    sessionRef.current = session || null;
  }, [session, state]);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    return () => cleanupVoice();
  }, [cleanupVoice]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const onPointerMove = (event: PointerEvent) => {
      const containerLeft = layoutRef.current?.getBoundingClientRect().left || 0;
      const maxWidth = Math.min(520, Math.max(360, window.innerWidth * 0.44));
      const nextWidth = Math.min(maxWidth, Math.max(280, event.clientX - containerLeft));
      setSidebarWidth(Math.round(nextWidth));
    };

    const stopResize = () => setIsResizingSidebar(false);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.session?.messages?.length]);

  useEffect(() => {
    if (voicePhase !== "listening") return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [message, voicePhase]);

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
      .then(applyPublicState)
      .catch((error) => toast.error(error.message || "Question timeout failed"))
      .finally(() => setTimeoutRunning(false));
  }, [applyPublicState, questionSeconds, state, timeoutRunning, token]);

  useEffect(() => {
    if (session?.status !== "in_progress") return;

    const reportFocusEvent = (type: AIInterviewProctoringEventType, reason: string) => {
      void recordProctoringEvent(type, { reason });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportFocusEvent("visibility_hidden", "document hidden");
      }
    };

    const onWindowBlur = () => {
      window.setTimeout(() => {
        if (!document.hasFocus()) {
          reportFocusEvent("window_blur", "window lost focus");
        }
      }, 250);
    };

    const onPageHide = () => {
      reportFocusEvent("pagehide", "page hidden or unloading");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [recordProctoringEvent, session?.status]);

  // Whenever new speakable AI messages appear (after the candidate sends a
  // message, confirms a question, etc.), drive the voice flow forward. This
  // single effect replaces every ad-hoc `if (voiceState === "connected") speak()`
  // sprinkled across send/confirm/start.
  useEffect(() => {
    if (voicePhase === "off" || voicePhase === "connecting" || voicePhase === "error") return;
    if (session?.status !== "in_progress" || !speakableAiMessageSignature) return;
    if (!isVoiceTransportActive()) return;
    void advanceVoiceFlow();
  }, [advanceVoiceFlow, isVoiceTransportActive, session?.status, speakableAiMessageSignature, voicePhase]);

  const answeredIndexes = useMemo(() => {
    return new Set((session?.answers || []).filter((answer) => answer.status !== "draft").map((answer) => answer.questionIndex));
  }, [session?.answers]);

  const start = async () => {
    setStarting(true);
    try {
      const data = await aiInterviewService.startPublic(token);
      applyPublicState(data);
      if (data.voice?.enabled) {
        void connectVoice(data);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to start interview");
    } finally {
      setStarting(false);
    }
  };

  // Reset this public session to a fresh "ready to start" state so the same
  // demo URL can be replayed end to end. Only invoked when ?demo=1 is set.
  const resetDemo = async () => {
    if (!window.confirm("Reset this interview to a fresh state? All messages and answers in this session will be cleared.")) {
      return;
    }
    setResettingDemo(true);
    try {
      cleanupVoice("Voice mode is off");
      const data = await aiInterviewService.resetPublicSession(token);
      applyPublicState(data);
      spokenAiMessageKeysRef.current.clear();
      recordedTranscriptKeysRef.current.clear();
      setMessage("");
      messageRef.current = "";
      toast.success("Interview reset. Press Start to begin again.");
    } catch (error: any) {
      toast.error(error?.message || "Failed to reset interview");
    } finally {
      setResettingDemo(false);
    }
  };

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) return;

    if (voicePhaseRef.current === "listening") {
      pauseCandidateMic({ endTurn: true });
      setVoicePhase("processing", "Got it. Sending your response...");
    }

    const sent = await submitCandidateText(text);
    if (sent) {
      void advanceVoiceFlow();
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      const data = await aiInterviewService.confirmPublicQuestion(token);
      applyPublicState(data);
      // The new transition + question messages will be picked up by the
      // speakableAiMessageSignature effect and read aloud automatically.
    } catch (error: any) {
      toast.error(error?.message || "Failed to confirm answer");
    } finally {
      setConfirming(false);
    }
  };

  const restartVoiceWithSelectedDevices = () => {
    void loadAudioDevices(true);
    if (session?.status === "in_progress" && !["off", "error", "connecting"].includes(voicePhase)) {
      cleanupVoice("Switching voice devices...", "connecting");
      window.setTimeout(() => { void connectVoice(); }, 200);
    }
  };

  const blockPasteOrDrop = (type: "paste_attempt" | "drop_attempt") => {
    const currentPasteCount = Number(sessionRef.current?.proctoring?.pasteAttemptCount || 0);
    setProctoringModal(buildInputProctoringModal(type, currentPasteCount + 1));
    void recordProctoringEvent(type, {
      reason: type === "drop_attempt" ? "candidate attempted to drop content" : "candidate attempted to paste content"
    });
  };

  const renderAudioDeviceSettings = (compact = false) => (
    <div className={`rounded-2xl border bg-white ${compact ? "p-3" : "p-4"} shadow-sm`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Settings className="h-4 w-4 text-blue-600" />
          Audio settings
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void loadAudioDevices(true)}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Detect
        </Button>
      </div>

      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        <label className="space-y-1.5 text-xs font-medium text-slate-600">
          Microphone
          <select
            value={selectedInputDeviceId}
            onChange={(event) => setSelectedInputDeviceId(event.target.value)}
            className="h-11 w-full rounded-xl border bg-white px-3 text-sm font-normal text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {audioInputs.length ? audioInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )) : (
              <option value="">Default microphone</option>
            )}
          </select>
        </label>

        <label className="space-y-1.5 text-xs font-medium text-slate-600">
          Speaker
          <select
            value={selectedOutputDeviceId}
            onChange={(event) => setSelectedOutputDeviceId(event.target.value)}
            className="h-11 w-full rounded-xl border bg-white px-3 text-sm font-normal text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {audioOutputs.length ? audioOutputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )) : (
              <option value="">Default speaker</option>
            )}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Tap I'm done to transcribe and submit your spoken answer. Use Send for typed answers.
        </p>
        {session?.status === "in_progress" && voicePhase !== "off" && voicePhase !== "error" && (
          <Button type="button" size="sm" onClick={restartVoiceWithSelectedDevices}>
            Apply
          </Button>
        )}
      </div>
    </div>
  );

  const renderInterviewerPresence = (compact = false) => {
    const statusText = interviewerIsSpeaking
      ? "Speaking now"
      : voicePhase === "listening"
        ? "Listening while you answer"
        : voicePhase === "processing"
          ? "Reviewing your answer"
          : voiceEnabled
            ? "Ready as your AI interviewer"
            : "Text interview";

    return (
      <div className={`rounded-lg border bg-white/95 ${compact ? "p-3" : "p-4"} shadow-sm`}>
        <div className="flex items-center gap-3">
          <AIVoiceAvatar
            voice={selectedVoice}
            size={compact ? "lg" : "2xl"}
            active={interviewerIsSpeaking}
            className="ring-1 ring-slate-200"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-sm font-semibold text-slate-950">{voiceAvatar.label}</div>
              <span className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                AI
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-600">{statusText}</p>
            <div className="mt-2 flex items-center gap-2">
              <AIVoiceWave
                active={interviewerIsSpeaking || voicePhase === "listening"}
                compact
                level={interviewerWaveLevel}
                tone={interviewerIsSpeaking ? voiceAvatar.tone : voicePhase === "listening" ? "blue" : voiceAvatar.tone}
              />
              <span className="min-w-0 truncate text-[11px] text-slate-500">{voiceStatus}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderProctoringModal = () => {
    if (!proctoringModal) return null;

    const isSevere = proctoringModal.severity === "final" || proctoringModal.severity === "blocked";
    const isInput = proctoringModal.severity === "input";
    const tone = isInput
      ? "border-red-200 bg-red-50 text-red-700"
      : isSevere
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-blue-200 bg-blue-50 text-blue-700";
    const buttonClass = isInput
      ? "bg-red-600 hover:bg-red-700"
      : isSevere
        ? "bg-amber-600 hover:bg-amber-700"
        : "bg-slate-950 hover:bg-slate-800";

    return (
      <Dialog
        open={proctoringModal.open}
        onOpenChange={(open) => {
          if (!open && !proctoringModal.locked) setProctoringModal(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-2xl sm:max-w-xl">
          <div className={`border-b px-5 py-5 sm:px-6 ${tone}`}>
            <DialogHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm">
                  {isInput ? <AlertCircle className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                </span>
                <div>
                  <DialogTitle className="text-2xl font-semibold tracking-normal text-slate-950">
                    {proctoringModal.title}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-sm font-medium text-slate-700">
                    Proctoring event recorded
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-5 py-5 sm:px-6">
            <p className="text-lg font-semibold leading-7 text-slate-950">
              {proctoringModal.message}
            </p>
            {proctoringModal.details && (
              <p className="text-sm leading-6 text-slate-600">
                {proctoringModal.details}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {typeof proctoringModal.focusCount === "number" && (
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Screen leave events</div>
                  <div className="mt-2 text-3xl font-bold text-slate-950">
                    {proctoringModal.focusCount}
                    <span className="text-base font-semibold text-slate-500"> / {proctoringModal.maxFocusViolations || 3}</span>
                  </div>
                </div>
              )}
              {typeof proctoringModal.pasteCount === "number" && (
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paste/drop attempts</div>
                  <div className="mt-2 text-3xl font-bold text-slate-950">{proctoringModal.pasteCount}</div>
                </div>
              )}
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white sm:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Required action</div>
                <div className="mt-2 text-sm leading-6">
                  Keep the interview tab open and type answers directly in your own words.
                </div>
              </div>
            </div>

            {!proctoringModal.locked && (
              <Button
                type="button"
                className={`h-12 w-full rounded-2xl text-base font-semibold text-white ${buttonClass}`}
                onClick={() => setProctoringModal(null)}
              >
                {proctoringModal.primaryAction || "I understand"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
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
          <div className="mx-auto mt-5 max-w-md rounded-xl border bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            The connection gateway automatically removes your saved ChatGPT credential after scoring finishes.
            You can also remove it immediately.
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            disabled={disconnectingChatgpt || chatgptDisconnected}
            onClick={() => void disconnectChatgpt()}
          >
            {disconnectingChatgpt && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {chatgptDisconnected ? "ChatGPT disconnected" : "Disconnect ChatGPT now"}
          </Button>
        </div>
      </main>
    );
  }

  if (session.status === "proctor_failed") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-amber-50/60 to-rose-50/70 p-4 md:p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-amber-200 bg-white/95 p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <ShieldCheck className="h-9 w-9" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">Interview Ended</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This interview ended because the interview screen was left multiple times. The recruiter can review the proctoring log.
          </p>
          <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-left text-sm">
            <div className="font-medium text-slate-950">Proctoring summary</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-white px-3 py-2">
                <div className="text-xs text-muted-foreground">Screen leave events</div>
                <div className="text-lg font-semibold text-slate-950">{focusViolationCount}/{maxFocusViolations}</div>
              </div>
              <div className="rounded-xl bg-white px-3 py-2">
                <div className="text-xs text-muted-foreground">Paste attempts</div>
                <div className="text-lg font-semibold text-slate-950">{pasteAttemptCount}</div>
              </div>
            </div>
          </div>
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
    <main className="min-h-[100dvh] overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)]">
      <audio ref={ttsAudioRef} preload="auto" className="hidden" />
      {renderProctoringModal()}
      <div
        ref={layoutRef}
        style={layoutStyle}
        className="mx-auto grid min-h-[100dvh] max-w-[1800px] gap-0 p-0 sm:gap-4 sm:p-4 lg:p-6 xl:grid-cols-[var(--interview-rail-width)_12px_minmax(0,1fr)]"
      >
        <aside className={`hidden space-y-4 xl:sticky xl:top-6 xl:block xl:max-h-[calc(100vh-48px)] xl:self-start xl:overflow-y-auto xl:pr-1 ${sidebarCollapsed ? "xl:block" : ""}`}>
          {sidebarCollapsed ? (
            <div className="hidden overflow-hidden rounded-2xl border bg-slate-950 text-white shadow-xl xl:block">
              <div className="flex flex-col items-center gap-4 p-3">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Expand interview panel"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
                <div className="h-px w-full bg-white/10" />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-200">
                  <Workflow className="h-5 w-5" />
                </div>
                <div className="text-center text-xs text-slate-300">
                  <div className="font-semibold text-white">{Math.min(activeStep, questionCount)}</div>
                  <div>/ {questionCount}</div>
                </div>
                <div className="h-28 w-2 overflow-hidden rounded-full bg-white/15">
                  <div className="w-full rounded-full bg-emerald-300" style={{ height: `${Math.min(100, progress)}%` }} />
                </div>
                {session.status === "in_progress" && (
                  <div className="space-y-3 text-center text-[11px] text-slate-300">
                    <div>
                      <Clock className="mx-auto mb-1 h-4 w-4" />
                      <span className="font-semibold text-white">{formatSeconds(questionSeconds)}</span>
                    </div>
                    <div>
                      <TimerReset className="mx-auto mb-1 h-4 w-4" />
                      <span className="font-semibold text-white">{formatSeconds(totalSeconds)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
          <>
          <div className="overflow-hidden rounded-2xl border-0 bg-slate-950 text-white shadow-xl">
            <div className="border-b border-white/10 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                  <Workflow className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Candidate interview</span>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="hidden h-8 w-8 shrink-0 text-slate-300 hover:bg-white/10 hover:text-white xl:inline-flex"
                  onClick={() => setSidebarCollapsed(true)}
                  aria-label="Collapse interview panel"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
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
                  <span className="font-medium">{Math.min(activeStep, questionCount)} / {questionCount}</span>
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

          {session.status === "in_progress" && renderInterviewerPresence(false)}

          {session.status === "in_progress" && (
            <div className="rounded-2xl border bg-white/95 p-4 shadow-lg shadow-slate-200/70">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Volume2 className="h-4 w-4 text-emerald-600" />
                  Voice mode
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={voicePhase === "ready" || voicePhase === "listening" || voicePhase === "speaking" || voicePhase === "processing" ? "default" : "secondary"}
                    className={
                      voicePhase === "ready" ? "bg-slate-700" :
                      voicePhase === "listening" ? "bg-blue-600" :
                      voicePhase === "speaking" ? "bg-emerald-600" :
                      voicePhase === "processing" ? "bg-amber-500" :
                      voicePhase === "error" ? "bg-red-600" : ""
                    }
                  >
                    {voicePhase === "speaking" ? "Speaking" :
                      voicePhase === "ready" ? "Ready" :
                      voicePhase === "listening" ? "Listening" :
                      voicePhase === "processing" ? "Thinking" :
                      voicePhase === "connecting" ? "Connecting" :
                      voicePhase === "error" ? "Error" :
                      voiceEnabled ? "Ready" : "Off"}
                  </Badge>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setDeviceSettingsOpen((value) => !value)}
                    aria-label="Voice settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-600">{voiceStatus}</p>
              {deviceSettingsOpen && <div className="mt-3">{renderAudioDeviceSettings(true)}</div>}

              {voicePhase === "speaking" && assistantSpeech.active && (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-200">
                      <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/40" />
                      <Volume2 className="relative h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-emerald-950">Interviewer speaking</span>
                        <span className="text-[11px] font-medium text-emerald-700">Mic muted</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        {renderVoiceBars(assistantSpeech.progress, "emerald", true)}
                        <span className="text-[11px] tabular-nums text-emerald-700">{Math.round(assistantSpeech.progress)}%</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-emerald-100">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${assistantSpeech.progress}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {voicePhase === "ready" && (
                <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-100">
                      <Mic className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-blue-950">Ready for your response</div>
                      <p className="mt-1 text-xs leading-5 text-blue-800">
                        If your mic did not open automatically, tap the mic button.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {voicePhase === "listening" && (
                <div className="mt-3 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-100">
                      <span className="absolute h-full w-full animate-ping rounded-full bg-blue-400/40" />
                      <Mic className="relative h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-blue-950">Listening now</span>
                        <span className="text-[11px] font-medium text-blue-700">Live draft</span>
                      </div>
                      <div className="mt-1.5">{renderVoiceBars(micLevel, "blue", true)}</div>
                      <p className="mt-1 text-xs leading-5 text-blue-800">
                        Your words appear in the chat draft. Tap <span className="font-semibold">I'm done</span> to send.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {voicePhase === "processing" && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Finalizing your answer...
                  </div>
                </div>
              )}
              {voicePhase === "off" || voicePhase === "error" ? (
                <Button
                  type="button"
                  className="mt-4 w-full bg-slate-950 text-white hover:bg-slate-800"
                  disabled={!voiceEnabled}
                  onClick={() => connectVoice()}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  {voicePhase === "error" ? "Restart voice mode" : "Start voice mode"}
                </Button>
              ) : voicePhase === "connecting" ? (
                <Button type="button" className="mt-4 w-full" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting…
                </Button>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={voicePhase === "listening" || voicePhase === "ready" ? "default" : "outline"}
                    className={voicePhase === "listening" || voicePhase === "ready" ? "bg-blue-600 hover:bg-blue-700" : ""}
                    disabled={voiceActionDisabled}
                    onClick={voicePhase === "ready" ? startListeningTurn : endListening}
                  >
                    {voicePhase === "listening" ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {voiceActionLabel}
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnectVoice}>
                    End voice
                  </Button>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </aside>

        <button
          type="button"
          aria-label="Resize interview panel"
          className={`hidden h-[calc(100vh-48px)] cursor-col-resize items-center justify-center rounded-full border bg-white/80 text-slate-400 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-700 xl:flex ${sidebarCollapsed ? "pointer-events-none opacity-0" : ""}`}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizingSidebar(true);
          }}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <section className="min-h-[100dvh] min-w-0 overflow-hidden rounded-none border-0 bg-white/95 shadow-none sm:min-h-[calc(100dvh-32px)] sm:rounded-[1.5rem] sm:border sm:shadow-xl sm:shadow-slate-200/70 xl:min-h-[calc(100dvh-48px)]">
          {session.status !== "in_progress" ? (
            <div className="min-h-[100dvh] overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:min-h-[calc(100dvh-32px)] sm:p-5 lg:p-7">
              <div className="mx-auto grid max-w-7xl gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="border-b bg-slate-950 px-4 py-5 text-white sm:px-6 sm:py-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Candidate briefing
                          </span>
                          <Badge className="border-white/15 bg-white/10 text-white">{statusLabel(session.status)}</Badge>
                        </div>
                        <p className="text-sm text-slate-300">Welcome, {candidateName}</p>
                        <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal sm:text-3xl">
                          Get ready for your structured AI interview
                        </h2>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                          You will answer one question at a time. Ask for clarification when needed, then confirm when your answer is ready.
                        </p>
                      </div>
                      <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm sm:w-auto sm:min-w-[240px]">
                        <div>
                          <div className="text-slate-400">Questions</div>
                          <div className="text-2xl font-semibold">{questionCount}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Mode</div>
                          <div className="text-base font-semibold">{voiceModeLabel}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { label: "Question time", value: questionTimeLabel, icon: Clock, tone: "blue" },
                        { label: "Total window", value: totalTimeLabel, icon: TimerReset, tone: "emerald" },
                        { label: "Progress", value: `${Math.min(activeStep, questionCount)} / ${questionCount}`, icon: Workflow, tone: "slate" }
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border bg-slate-50/80 p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-slate-600">{item.label}</div>
                            <item.icon className={`h-4 w-4 ${
                              item.tone === "emerald" ? "text-emerald-600" : item.tone === "blue" ? "text-blue-600" : "text-slate-500"
                            }`} />
                          </div>
                          <div className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">{item.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border bg-white p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                            <ListChecks className="h-4 w-4 text-blue-600" />
                            Interview flow
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            Complete the steps in order. The confirm button is required unless the timer expires.
                          </p>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 lg:max-w-xs">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        {[
                          { title: "Read the brief", body: "Check the guidelines and timing before you begin.", icon: Info },
                          { title: "Answer naturally", body: "Use the chat or voice mode for each question.", icon: Headphones },
                          { title: "Confirm to continue", body: "Move forward only when your answer is ready.", icon: CheckCircle2 }
                        ].map((step, index) => (
                          <div key={step.title} className="rounded-2xl border bg-slate-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-950 shadow-sm">
                                {index + 1}
                              </span>
                              <step.icon className="h-4 w-4 text-slate-500" />
                            </div>
                            <div className="text-sm font-semibold text-slate-950">{step.title}</div>
                            <p className="mt-1 text-xs leading-5 text-slate-600">{step.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                            <ShieldCheck className="h-4 w-4" />
                            Proctoring rules
                          </div>
                          <p className="mt-2 text-sm leading-6 text-amber-950">
                            These rules are enforced during the interview. Violations are logged and repeated screen switching can end the session.
                          </p>
                        </div>
                        <Badge className="w-fit border-amber-200 bg-white text-amber-900">
                          {maxFocusViolations} tab warnings max
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        {[
                          "Do not paste or drop prepared text. Paste attempts are blocked and logged.",
                          "Keep this interview tab visible while the interview is in progress.",
                          "Leaving the tab or browser triggers warnings; the third screen-leave ends the interview."
                        ].map((rule) => (
                          <div key={rule} className="rounded-2xl border border-amber-100 bg-white/85 p-3 text-sm font-medium leading-6 text-slate-900">
                            {rule}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-950">
                        <ShieldCheck className="h-4 w-4" />
                        Guidelines from the recruiter
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                        {interview.guidelines || "Answer each question clearly and use specific examples where possible."}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <UserRound className="h-4 w-4 text-blue-600" />
                      Session details
                    </div>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">Candidate</span>
                        <span className="max-w-[160px] truncate font-medium text-slate-950">{candidateName}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">Role</span>
                        <span className="max-w-[160px] truncate font-medium text-slate-950">{state.job?.title || "Role interview"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                        <span className="text-slate-600">Input</span>
                        <span className="font-medium text-slate-950">{voiceModeLabel}</span>
                      </div>
                    </div>
                  </div>

                  {renderAudioDeviceSettings()}

                  <div className="rounded-3xl border bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <CalendarClock className="h-4 w-4 text-emerald-600" />
                      Timing
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border bg-slate-50 p-4">
                        <div className="text-xs text-slate-500">Per question</div>
                        <div className="mt-1 text-2xl font-semibold text-slate-950">{questionTimeLabel}</div>
                      </div>
                      <div className="rounded-2xl border bg-slate-50 p-4">
                        <div className="text-xs text-slate-500">Total</div>
                        <div className="mt-1 text-2xl font-semibold text-slate-950">{totalTimeLabel}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl xl:sticky xl:top-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-slate-300">Ready to begin</div>
                        <div className="mt-1 text-xl font-semibold">Start when you have a quiet space.</div>
                      </div>
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                        {voiceEnabled ? <Mic className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                      </span>
                    </div>
                    {chatgptReady ? (
                      <Button className="mt-5 h-12 w-full bg-white text-slate-950 hover:bg-slate-100" onClick={start} disabled={starting}>
                        {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        Start Interview
                      </Button>
                    ) : (
                      <div className="mt-5">
                        <CandidateChatgptGate token={token} onReady={() => setChatgptReady(true)} />
                      </div>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      Voice reads interviewer messages first, then opens your mic automatically for your answer.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[100dvh] min-h-0 flex-col sm:h-[calc(100dvh-32px)] xl:h-[calc(100dvh-48px)]">
              <div className="border-b bg-slate-950 p-2.5 pb-2 text-white sm:p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 sm:gap-2 sm:text-sm">
                      <span>Question {currentIndex + 1} of {questionCount}</span>
                      <span className="hidden h-1 w-1 rounded-full bg-slate-500 sm:inline-flex" />
                      <span className="truncate">{state.job?.title || interview.title}</span>
                    </div>
                    <h2 className="mt-1 text-base font-semibold tracking-normal sm:text-lg">Interview Workspace</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] sm:text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-slate-100">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Question </span>{formatSeconds(questionSeconds)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-slate-100">
                        <TimerReset className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Total </span>{formatSeconds(totalSeconds)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-100">
                        <Workflow className="h-3.5 w-3.5" />
                        {Math.min(activeStep, questionCount)} / {questionCount}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="hidden bg-white text-slate-950 hover:bg-slate-100 xl:inline-flex"
                      onClick={() => setSidebarCollapsed((value) => !value)}
                      aria-label={sidebarCollapsed ? "Show interview panel" : "Hide interview panel"}
                    >
                      {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    </Button>
                    <Badge className="hidden w-fit border-white/20 bg-white/10 text-white sm:inline-flex">Confirm required to move on</Badge>
                    <Badge className={`hidden w-fit sm:inline-flex ${
                      focusViolationCount >= maxFocusViolations - 1
                        ? "border-amber-300/30 bg-amber-400/15 text-amber-100"
                        : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                    }`}>
                      Proctoring {focusViolationCount}/{maxFocusViolations}
                    </Badge>
                    {demoMode && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={resetDemo}
                        disabled={resettingDemo}
                        className="h-11 rounded-xl bg-amber-100 px-3 text-amber-900 hover:bg-amber-200 sm:px-4"
                        title="Reset this demo interview"
                      >
                        {resettingDemo ? <Loader2 className="h-4 w-4 animate-spin sm:mr-2" /> : <RotateCcw className="h-4 w-4 sm:mr-2" />}
                        <span className="hidden sm:inline">Reset demo</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="h-11 min-w-11 rounded-xl bg-white px-3 text-slate-950 hover:bg-slate-100"
                      onClick={() => setDeviceSettingsOpen((value) => !value)}
                      aria-label="Audio settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!voiceEnabled || voicePhase === "connecting" || voicePhase === "speaking" || voicePhase === "processing"}
                      onClick={
                        voicePhase === "listening"
                          ? endListening
                          : voicePhase === "ready"
                            ? startListeningTurn
                          : (voicePhase === "off" || voicePhase === "error")
                            ? () => connectVoice()
                            : undefined
                      }
                      className="h-11 min-w-11 rounded-xl bg-white px-3 text-slate-950 hover:bg-slate-100 sm:px-4"
                      aria-label={voiceActionLabel}
                      title={voiceActionLabel}
                    >
                      {voicePhase === "connecting" ? (
                        <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                      ) : voicePhase === "listening" ? (
                        <MicOff className="h-4 w-4 sm:mr-2" />
                      ) : (
                        <Mic className="h-4 w-4 sm:mr-2" />
                      )}
                      <span className={`${voicePhase === "off" || voicePhase === "error" || voicePhase === "listening" || voicePhase === "ready" ? "ml-2 inline text-sm" : "hidden sm:inline"}`}>
                        {voicePhase === "off" ? "Voice" : voicePhase === "listening" ? "Done" : voiceActionLabel}
                      </span>
                    </Button>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
                </div>
                {(focusViolationCount > 0 || pasteAttemptCount > 0) && (
                  <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-300/12 p-3 text-amber-50 shadow-inner">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide">Proctoring warning active</div>
                        <div className="mt-1 text-sm leading-5 text-amber-50/95">
                          {focusViolationCount > 0
                            ? `Screen leave events: ${focusViolationCount}/${maxFocusViolations}. ${focusAttemptsRemaining > 0 ? `${focusAttemptsRemaining} more before automatic end.` : "No screen leaves remaining."}`
                            : "Stay inside the interview tab until the session is complete."}
                          {pasteAttemptCount > 0 ? ` Paste/drop attempts blocked: ${pasteAttemptCount}.` : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {deviceSettingsOpen && (
                  <div className="mt-3 text-slate-950">
                    {renderAudioDeviceSettings(true)}
                  </div>
                )}
              </div>

              <div className="border-b bg-white/95 p-2 sm:p-3 xl:hidden">
                {renderInterviewerPresence(true)}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.08),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] p-2 sm:p-3 md:p-4">
                <div className="mx-auto flex max-w-7xl flex-col gap-3">
                {(session.messages || []).map((chat, index) => (
                  <div
                    key={chat._id || index}
                    className={`flex items-end gap-2 ${chat.role === "candidate" ? "justify-end" : "justify-start"}`}
                  >
                    {chat.role === "ai" && (
                      <AIVoiceAvatar
                        voice={selectedVoice}
                        size="sm"
                        active={assistantSpeech.active && normalizeTranscriptText(assistantSpeech.text) === normalizeTranscriptText(chat.content || "")}
                        decorative
                        className="mb-1 hidden sm:inline-flex"
                      />
                    )}
                    <div
                      className={`max-w-[min(88%,960px)] rounded-[1.35rem] px-3.5 py-2.5 text-[15px] leading-6 shadow-sm sm:max-w-[min(90%,960px)] sm:px-4 sm:py-3 sm:text-sm ${
                        chat.role === "candidate"
                          ? "rounded-br-md bg-slate-950 text-white shadow-slate-300/60"
                          : "rounded-bl-md border border-white bg-white/95 text-slate-900 shadow-slate-200/80 ring-1 ring-slate-200/70"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                        <span className={`h-1.5 w-1.5 rounded-full ${chat.role === "candidate" ? "bg-white/70" : "bg-emerald-500"}`} />
                        {chat.role === "candidate" ? "You" : "Interviewer"}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {chat.role === "ai" && assistantSpeech.active && normalizeTranscriptText(assistantSpeech.text) === normalizeTranscriptText(chat.content || "")
                          ? renderHighlightedSpeech(chat.content, assistantHighlightedWords)
                          : chat.content}
                      </div>
                    </div>
                  </div>
                ))}
                {voicePhase === "listening" && (
                  <div className="flex items-end justify-end gap-2">
                    <div className="max-w-[min(88%,900px)] rounded-[1.35rem] rounded-br-md bg-blue-600 px-3.5 py-2.5 text-[15px] leading-6 text-white shadow-sm shadow-blue-200/70 sm:max-w-[min(86%,900px)] sm:px-4 sm:py-3 sm:text-sm">
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-blue-100">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                          You
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                          <Mic className="h-3 w-3" />
                          Drafting
                        </span>
                      </div>
                      {message.trim() ? (
                        <div className="whitespace-pre-wrap">{message}</div>
                      ) : (
                        <div className="flex items-center gap-3 text-blue-50">
                          {renderVoiceBars(micLevel, "white", true)}
                          <span className="text-sm">Listening...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
                </div>
              </div>

              <div className="border-t bg-white/95 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:p-3">
                <div className="mx-auto max-w-7xl">
                {voicePhase !== "off" && (
                  <div className={`mb-2 overflow-hidden rounded-2xl border bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur sm:mb-3 sm:px-3 sm:py-2 ${
                    voiceBannerTone === "speaking"
                      ? "border-emerald-200"
                      : voiceBannerTone === "listening"
                        ? "border-blue-200"
                        : voiceBannerTone === "processing"
                          ? "border-amber-200"
                          : voiceBannerTone === "error"
                            ? "border-red-200"
                            : "border-slate-200"
                  }`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg ${
                        voicePhase === "listening"
                          ? "bg-blue-600 shadow-blue-100"
                          : voicePhase === "speaking"
                            ? "bg-emerald-600 shadow-emerald-100"
                            : voicePhase === "processing"
                              ? "bg-amber-500 shadow-amber-100"
                              : voicePhase === "error"
                                ? "bg-red-600 shadow-red-100"
                                : "bg-slate-900 shadow-slate-100"
                      }`}>
                        {(voicePhase === "listening" || voicePhase === "speaking") && <span className="absolute h-full w-full animate-ping rounded-full bg-current opacity-20" />}
                        {voicePhase === "connecting" || voicePhase === "processing" ? (
                          <Loader2 className="relative h-4 w-4 animate-spin" />
                        ) : voicePhase === "listening" ? (
                          <Mic className="relative h-4 w-4" />
                        ) : voicePhase === "ready" ? (
                          <Mic className="relative h-4 w-4" />
                        ) : voicePhase === "error" ? (
                          <AlertCircle className="relative h-4 w-4" />
                        ) : (
                          <Volume2 className="relative h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[13px] font-semibold text-slate-950 sm:text-sm">
                            {voicePhase === "speaking"
                              ? "AI is speaking"
                              : voicePhase === "listening"
                                ? "Listening now"
                                : voicePhase === "ready"
                                  ? "Ready for you"
                                  : voicePhase === "processing"
                                    ? "Finalizing answer"
                                    : voicePhase === "error"
                                      ? "Voice needs restart"
                                      : "Voice mode"}
                          </div>
                          <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${
                            voicePhase === "speaking"
                              ? "bg-emerald-50 text-emerald-700"
                              : voicePhase === "listening"
                                ? "bg-blue-50 text-blue-700"
                                : voicePhase === "processing"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}>
                            {voicePhase === "speaking" ? "Mic muted" : voicePhase === "listening" ? "Live draft" : voicePhase === "ready" ? "Mic ready" : voicePhase === "processing" ? "Azure STT" : "Status"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {voicePhase === "speaking"
                            ? renderVoiceBars(assistantSpeech.progress, "emerald", true)
                            : voicePhase === "listening"
                              ? renderVoiceBars(micLevel, "blue", true)
                              : voicePhase === "processing"
                                ? renderVoiceBars(45, "slate", true)
                                : <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/3 rounded-full bg-slate-400" /></div>}
                          <span className="hidden min-w-0 truncate text-[11px] text-slate-500 md:block">{voiceStatus}</span>
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0 rounded-full"
                        onClick={() => setDeviceSettingsOpen((value) => !value)}
                        aria-label="Audio settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>

                      {(voicePhase === "speaking" || voicePhase === "ready" || voicePhase === "listening" || voicePhase === "processing") && (
                        <Button
                          type="button"
                          size="sm"
                          variant={voicePhase === "listening" || voicePhase === "ready" ? "default" : "outline"}
                          className={voicePhase === "listening" || voicePhase === "ready" ? "h-9 shrink-0 rounded-full bg-blue-600 px-3 hover:bg-blue-700" : "h-9 w-9 shrink-0 rounded-full px-0 sm:w-auto sm:px-3"}
                          disabled={voiceActionDisabled}
                          onClick={voicePhase === "ready" ? startListeningTurn : endListening}
                        >
                          {voicePhase === "listening" || voicePhase === "speaking" ? (
                            <MicOff className={`${voicePhase === "speaking" ? "sm:mr-1.5" : "mr-1.5"} h-3.5 w-3.5`} />
                          ) : (
                            <Mic className={`${voicePhase === "processing" ? "sm:mr-1.5" : "mr-1.5"} h-3.5 w-3.5`} />
                          )}
                          <span className={`${voicePhase === "speaking" || voicePhase === "processing" ? "hidden sm:inline" : "text-xs sm:text-sm"}`}>
                            {voicePhase === "listening" ? "Done" : voiceActionLabel}
                          </span>
                        </Button>
                      )}
                      {voicePhase === "error" && (
                        <Button type="button" size="sm" className="h-9 shrink-0 rounded-full" disabled={!voiceEnabled} onClick={() => connectVoice()}>
                          Restart
                        </Button>
                      )}
                    </div>
                    {deviceSettingsOpen && <div className="mt-3">{renderAudioDeviceSettings(true)}</div>}
                  </div>
                )}
                <div className={`rounded-[1.35rem] border bg-white p-2 shadow-sm transition-colors ${
                  voicePhase === "listening" ? "border-blue-200 shadow-blue-100" : "border-slate-200"
                }`}>
                  <Textarea
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      messageRef.current = event.target.value;
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      blockPasteOrDrop("paste_attempt");
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      blockPasteOrDrop("drop_attempt");
                    }}
                    onBeforeInput={(event) => {
                      const inputType = (event.nativeEvent as InputEvent).inputType || "";
                      if (inputType === "insertFromPaste" || inputType === "insertFromPasteAsQuotation") {
                        event.preventDefault();
                        blockPasteOrDrop("paste_attempt");
                      }
                      if (inputType === "insertFromDrop") {
                        event.preventDefault();
                        blockPasteOrDrop("drop_attempt");
                      }
                    }}
                    placeholder={voicePhase === "listening" ? "Listening... your answer will appear here" : "Type your answer or ask for clarification..."}
                    rows={voicePhase === "listening" ? 1 : 2}
                    className={`min-h-[42px] max-h-[84px] resize-none border-0 text-base shadow-none transition-colors focus-visible:ring-0 sm:min-h-[60px] sm:max-h-[160px] sm:resize-y sm:text-sm ${
                      voicePhase === "listening" ? "bg-blue-50/70" : "bg-slate-50"
                    }`}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => { setMessage(""); messageRef.current = ""; }}
                      disabled={!message.trim()}
                      className="h-10 w-10 shrink-0 rounded-xl px-0 sm:w-auto sm:px-4"
                      aria-label="Clear answer"
                    >
                      <X className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Clear</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={sendMessage}
                      disabled={sending || !message.trim()}
                      className="h-10 w-10 shrink-0 rounded-xl px-0 sm:w-auto sm:px-4"
                      aria-label="Send answer"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin sm:mr-2" /> : <Send className="h-4 w-4 sm:mr-2" />}
                      <span className="hidden sm:inline">Send</span>
                    </Button>
                    <Button
                      onClick={confirm}
                      disabled={confirming || timeoutRunning}
                      className="ml-auto h-10 shrink-0 rounded-xl bg-emerald-600 px-3 text-sm hover:bg-emerald-700 sm:px-4"
                    >
                      {confirming || timeoutRunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin sm:mr-2" /> : <CheckCircle2 className="mr-1.5 h-4 w-4 sm:mr-2" />}
                      Confirm<span className="hidden sm:inline">&nbsp;& Move On</span>
                    </Button>
                  </div>
                </div>
                <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
                  The interview will auto-move when the question timer reaches zero. Voice answers are saved to the same transcript.
                </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function PublicAIInterviewPage() {
  const { isLoading, isFeatureEnabled } = useFeatureFlags();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Loading interview" />
      </main>
    );
  }

  if (!isFeatureEnabled("aiInterviews")) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-lg border-l-4 border-slate-300 bg-white px-6 py-8 shadow-sm">
          <AlertCircle className="mb-4 h-6 w-6 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-950">Interview temporarily unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            AI interviews are currently unavailable. Please contact the hiring team for next steps.
          </p>
        </div>
      </main>
    );
  }

  return <PublicAIInterviewExperience />;
}
