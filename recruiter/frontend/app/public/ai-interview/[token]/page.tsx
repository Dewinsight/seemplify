"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
  Send,
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

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, 3000);

    function onStateChange() {
      if (peerConnection.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    }

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function parseVoiceMessage(raw: MessageEvent["data"]) {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return null;
  }
}

function getVoiceTranscriptText(event: any) {
  const candidates = [
    event?.transcript,
    event?.text,
    event?.delta,
    event?.item?.transcript,
    event?.item?.formatted?.transcript,
    event?.item?.content?.[0]?.transcript,
    event?.item?.content?.[0]?.text,
    event?.response?.output_text
  ];

  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
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

function isCandidateTranscriptEvent(type?: string) {
  return Boolean(type && type.includes("input_audio_transcription") && (type.endsWith(".completed") || type.endsWith(".done")));
}

function isCandidateTranscriptDeltaEvent(type?: string) {
  return Boolean(type && type.includes("input_audio_transcription") && type.endsWith(".delta"));
}

function isCandidateTranscriptFailedEvent(type?: string) {
  return Boolean(type && type.includes("input_audio_transcription") && type.endsWith(".failed"));
}

type VoiceMicState = "off" | "listening" | "paused" | "processing";
type VoiceTurnPhase = "off" | "assistant_speaking" | "listening" | "processing";
type BrowserSpeechState = "checking" | "unavailable" | "off" | "listening";

const USE_BROWSER_SPEECH_FALLBACK = false;

type AssistantSpeechState = {
  active: boolean;
  text: string;
  progress: number;
};

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
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
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [voiceStatus, setVoiceStatus] = useState("Voice mode is off");
  const [voiceMicState, setVoiceMicState] = useState<VoiceMicState>("off");
  const [, setBrowserSpeechState] = useState<BrowserSpeechState>("checking");
  const [assistantSpeech, setAssistantSpeech] = useState<AssistantSpeechState>({
    active: false,
    text: "",
    progress: 0
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeTtsUrlRef = useRef("");
  const speechRequestIdRef = useRef(0);
  const spokenAiMessageKeysRef = useRef<Set<string>>(new Set());
  const speechQueueRunningRef = useRef(false);
  const speechQueueDrainRequestedRef = useRef(false);
  const voiceWsRef = useRef<WebSocket | null>(null);
  const voicePeerRef = useRef<RTCPeerConnection | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceDataChannelRef = useRef<RTCDataChannel | null>(null);
  const assistantSpeechTimerRef = useRef<number | null>(null);
  const assistantSpeechTextRef = useRef("");
  const assistantSpeechStartedAtRef = useRef(0);
  const assistantSpeechDurationRef = useRef(0);
  const recordedTranscriptKeysRef = useRef<Set<string>>(new Set());
  const voiceMicWantedRef = useRef(false);
  const voiceAssistantSpeakingRef = useRef(false);
  const voiceProcessingRef = useRef(false);
  const voiceTurnEpochRef = useRef(0);
  const activeCandidateTurnEpochRef = useRef(0);
  const candidateSpeechTurnEpochRef = useRef(0);
  const voiceTurnPhaseRef = useRef<VoiceTurnPhase>("off");
  const browserSpeechSupportedRef = useRef(false);
  const browserSpeechWantedRef = useRef(false);
  const browserSpeechRecognitionRef = useRef<any>(null);
  const browserSpeechRestartTimerRef = useRef<number | null>(null);
  const stateRef = useRef<PublicAIInterviewState | null>(null);
  const sessionRef = useRef<PublicAIInterviewState["session"] | null>(null);

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
  const micControlLabel = voiceMicState === "listening"
    ? "Mute mic"
    : voiceMicState === "processing"
      ? "Processing"
      : assistantSpeech.active
        ? "AI speaking"
        : "Speak now";
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

  const stopBrowserSpeechRecognition = useCallback((setOffState = true) => {
    browserSpeechWantedRef.current = false;

    if (browserSpeechRestartTimerRef.current) {
      window.clearTimeout(browserSpeechRestartTimerRef.current);
      browserSpeechRestartTimerRef.current = null;
    }

    try {
      browserSpeechRecognitionRef.current?.stop?.();
    } catch {
      try {
        browserSpeechRecognitionRef.current?.abort?.();
      } catch {
        // Ignore speech recognition cleanup errors.
      }
    }

    if (setOffState) {
      setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
    }
  }, []);

  const cleanupVoice = useCallback((status = "Voice mode is off") => {
    voiceDataChannelRef.current?.close();
    voiceDataChannelRef.current = null;

    voicePeerRef.current?.close();
    voicePeerRef.current = null;

    voiceWsRef.current?.close();
    voiceWsRef.current = null;

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;

    speechRequestIdRef.current += 1;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.removeAttribute("src");
      ttsAudioRef.current.load();
    }
    if (activeTtsUrlRef.current) {
      URL.revokeObjectURL(activeTtsUrlRef.current);
      activeTtsUrlRef.current = "";
    }

    if (assistantSpeechTimerRef.current) {
      window.clearInterval(assistantSpeechTimerRef.current);
      assistantSpeechTimerRef.current = null;
    }

    stopBrowserSpeechRecognition(false);

    assistantSpeechTextRef.current = "";
    assistantSpeechStartedAtRef.current = 0;
    assistantSpeechDurationRef.current = 0;
    spokenAiMessageKeysRef.current.clear();
    speechQueueRunningRef.current = false;
    speechQueueDrainRequestedRef.current = false;
    voiceMicWantedRef.current = false;
    voiceAssistantSpeakingRef.current = false;
    voiceProcessingRef.current = false;
    voiceTurnEpochRef.current += 1;
    activeCandidateTurnEpochRef.current = 0;
    candidateSpeechTurnEpochRef.current = 0;
    voiceTurnPhaseRef.current = "off";
    setVoiceState("idle");
    setVoiceMicState("off");
    setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
    setAssistantSpeech({ active: false, text: "", progress: 0 });
    setVoiceStatus(status);
  }, [stopBrowserSpeechRecognition]);

  const setVoiceInputEnabled = useCallback((enabled: boolean) => {
    voiceStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  const isVoiceTransportActive = useCallback(() => {
    const peerConnection = voicePeerRef.current;
    const dataChannel = voiceDataChannelRef.current;

    const peerState = peerConnection?.connectionState;
    const iceState = peerConnection?.iceConnectionState;
    const peerUsable = Boolean(peerConnection)
      && !["closed", "failed", "disconnected"].includes(peerState || "")
      && !["closed", "failed", "disconnected"].includes(iceState || "");

    return (
      dataChannel?.readyState === "open" ||
      peerUsable ||
      voiceWsRef.current?.readyState === WebSocket.OPEN
    );
  }, []);

  const startVoiceTurn = useCallback((phase: VoiceTurnPhase) => {
    const nextEpoch = voiceTurnEpochRef.current + 1;
    voiceTurnEpochRef.current = nextEpoch;
    voiceTurnPhaseRef.current = phase;

    if (phase === "listening") {
      activeCandidateTurnEpochRef.current = nextEpoch;
      candidateSpeechTurnEpochRef.current = 0;
    } else if (phase !== "processing") {
      activeCandidateTurnEpochRef.current = 0;
      candidateSpeechTurnEpochRef.current = 0;
    }

    return nextEpoch;
  }, []);

  const isCandidateSpeechTurnActive = useCallback(() => {
    return (
      !voiceAssistantSpeakingRef.current &&
      activeCandidateTurnEpochRef.current > 0 &&
      ["listening", "processing"].includes(voiceTurnPhaseRef.current)
    );
  }, []);

  const isCurrentCandidateSpeechEvent = useCallback(() => {
    return (
      isCandidateSpeechTurnActive() &&
      candidateSpeechTurnEpochRef.current > 0 &&
      candidateSpeechTurnEpochRef.current === activeCandidateTurnEpochRef.current
    );
  }, [isCandidateSpeechTurnActive]);

  const resumeCandidateMic = useCallback((status = "Listening. Speak naturally when you are ready.") => {
    voiceProcessingRef.current = false;

    if (!isVoiceTransportActive() || !voiceMicWantedRef.current) {
      startVoiceTurn("off");
      voiceAssistantSpeakingRef.current = false;
      setVoiceInputEnabled(false);
      setVoiceMicState("off");
      setVoiceStatus("Mic is off");
      return;
    }

    if (voiceAssistantSpeakingRef.current || Boolean(assistantSpeechTextRef.current)) {
      setVoiceInputEnabled(false);
      setVoiceMicState("paused");
      setVoiceStatus("Interviewer is speaking. Mic is locked.");
      return;
    }

    voiceAssistantSpeakingRef.current = false;
    startVoiceTurn("listening");
    setVoiceInputEnabled(true);
    setVoiceMicState("listening");
    setVoiceStatus(status);
  }, [isVoiceTransportActive, setVoiceInputEnabled, startVoiceTurn]);

  const waitForCandidateMicPress = useCallback((status = "Tap the mic when you are ready to speak.") => {
    voiceProcessingRef.current = false;
    voiceAssistantSpeakingRef.current = false;
    voiceMicWantedRef.current = false;
    setVoiceInputEnabled(false);
    setVoiceMicState("off");
    startVoiceTurn("off");
    setVoiceStatus(status);
  }, [setVoiceInputEnabled, startVoiceTurn]);

  const pauseCandidateMic = useCallback((
    state: Exclude<VoiceMicState, "listening">,
    status: string,
    options: {
      preserveCandidateTurn?: boolean;
      phase?: VoiceTurnPhase;
    } = {}
  ) => {
    stopBrowserSpeechRecognition(true);
    setVoiceInputEnabled(false);
    setVoiceMicState(state);
    if (options.preserveCandidateTurn) {
      voiceTurnPhaseRef.current = options.phase || (state === "processing" ? "processing" : "off");
    } else {
      startVoiceTurn(options.phase || (state === "paused" ? "assistant_speaking" : "off"));
    }
    setVoiceStatus(status);
  }, [setVoiceInputEnabled, startVoiceTurn, stopBrowserSpeechRecognition]);

  const recordAssistantVoiceTranscript = useCallback(async (
    text: string,
    messageType: "greeting" | "question" | "clarification" | "acknowledgement" | "transition" | "system" = "acknowledgement"
  ) => {
    const cleaned = normalizeTranscriptText(text);
    const activeSession = sessionRef.current;
    if (!cleaned || cleaned === "Interviewer is speaking..." || !activeSession || activeSession.status !== "in_progress") return;

    const key = transcriptKey("ai", activeSession.currentQuestionIndex, cleaned);
    if (recordedTranscriptKeysRef.current.has(key)) return;

    if (hasEquivalentTranscriptMessage(stateRef.current, "ai", activeSession.currentQuestionIndex, cleaned)) {
      recordedTranscriptKeysRef.current.add(key);
      return;
    }

    recordedTranscriptKeysRef.current.add(key);

    try {
      const data = await aiInterviewService.recordPublicVoiceTranscript(token, {
        role: "ai",
        message: cleaned,
        messageType
      });
      applyPublicState(data);
    } catch (error) {
      recordedTranscriptKeysRef.current.delete(key);
      console.warn("Failed to save assistant voice transcript", error);
    }
  }, [applyPublicState, token]);

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

  const speakVoiceText = useCallback(async (
    text: string,
    options: {
      persist?: boolean;
      resumeAfter?: boolean;
      messageType?: "greeting" | "question" | "clarification" | "acknowledgement" | "transition" | "system";
    } = {}
  ) => {
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned) return false;

    if (options.persist !== false) {
      void recordAssistantVoiceTranscript(cleaned, options.messageType);
    }

    voiceAssistantSpeakingRef.current = true;
    pauseCandidateMic("paused", "Interviewer is speaking. Mic is paused.");
    setVoiceStatus("Preparing interviewer voice...");

    const requestId = speechRequestIdRef.current + 1;
    speechRequestIdRef.current = requestId;

    // Stop any current playback but DO NOT call removeAttribute("src") or load().
    // Resetting the element un-primes it on iOS Safari, causing subsequent
    // audio.play() to silently fail and never fire 'ended'.
    const audio = ttsAudioRef.current;
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
    }
    const previousTtsUrl = activeTtsUrlRef.current;

    try {
      const audioBlob = await aiInterviewService.synthesizePublicSpeech(token, cleaned);
      if (speechRequestIdRef.current !== requestId) return false;
      if (!audio) return false;

      const objectUrl = URL.createObjectURL(audioBlob);
      activeTtsUrlRef.current = objectUrl;
      const audioEl: HTMLAudioElement = audio;
      audioEl.src = objectUrl;

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
          reject(new Error("Unable to play interviewer audio."));
        };
        const onTimeUpdate = () => {
          if (speechRequestIdRef.current !== requestId || !Number.isFinite(audioEl.duration) || audioEl.duration <= 0) return;
          const progress = Math.max(2, Math.min(99, Math.round((audioEl.currentTime / audioEl.duration) * 100)));
          setAssistantSpeech((current) => (
            current.text === cleaned ? { ...current, active: true, progress } : current
          ));
        };

        // Safety net: if the audio never reaches 'ended' (silent failure on
        // some mobile browsers), give up after a generous timeout so the
        // queue can recover and the mic does not stay stuck "paused".
        const guardTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Interviewer voice playback timed out."));
        }, 120_000);

        function cleanup() {
          window.clearTimeout(guardTimer);
          audioEl.removeEventListener("ended", onEnded);
          audioEl.removeEventListener("error", onError);
          audioEl.removeEventListener("timeupdate", onTimeUpdate);
        }

        audioEl.addEventListener("ended", onEnded);
        audioEl.addEventListener("error", onError);
        audioEl.addEventListener("timeupdate", onTimeUpdate);

        startAssistantSpeechVisual(cleaned, false);
        setVoiceStatus("Interviewer is speaking. Your mic is muted.");
        audioEl.play().catch((error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        });
      });

      // Revoke the old blob URL only after the new one has played, so the
      // browser is never juggling a revoked URL as the active source.
      if (previousTtsUrl && previousTtsUrl !== objectUrl) {
        URL.revokeObjectURL(previousTtsUrl);
      }

      if (speechRequestIdRef.current !== requestId) return false;
      finishAssistantSpeechVisual();
      if (options.resumeAfter !== false) {
        voiceAssistantSpeakingRef.current = false;
        waitForCandidateMicPress();
      } else {
        setVoiceStatus("Preparing next interviewer message...");
      }
      return true;
    } catch (error: any) {
      if (speechRequestIdRef.current === requestId) {
        finishAssistantSpeechVisual();
        // Always clear the speaking flag so the mic toggle is not stuck in
        // the "Interviewer is speaking. Mic is locked" branch.
        voiceAssistantSpeakingRef.current = false;
        if (options.resumeAfter !== false) {
          waitForCandidateMicPress("Interviewer voice could not play. Tap the mic or type to continue.");
          toast.error(error?.message || "Unable to play interviewer voice");
        } else {
          // The caller (speakPendingAiMessages) will handle final mic state
          // once the whole queue has drained.
          console.warn("Interviewer voice playback failed:", error?.message || error);
        }
      }
      return false;
    }
  }, [finishAssistantSpeechVisual, pauseCandidateMic, recordAssistantVoiceTranscript, startAssistantSpeechVisual, token, waitForCandidateMicPress]);

  const speakPendingAiMessages = useCallback(async (data: PublicAIInterviewState | null) => {
    if (!data || data.session.status !== "in_progress") return false;
    if (speechQueueRunningRef.current) {
      speechQueueDrainRequestedRef.current = true;
      return true;
    }

    speechQueueRunningRef.current = true;
    let spokeAny = false;
    let attemptedAny = false;
    try {
      let source: PublicAIInterviewState | null = data;

      do {
        speechQueueDrainRequestedRef.current = false;
        source = stateRef.current || source;

        while (source?.session.status === "in_progress") {
          const pendingMessages = getSpeakableAiMessages(source)
            .map((message) => ({ message, key: getAiMessageSpeakKey(message), content: message.content?.trim() || "" }))
            .filter((item) => item.key && item.content && !spokenAiMessageKeysRef.current.has(item.key));

          if (!pendingMessages.length) break;

          for (const item of pendingMessages) {
            spokenAiMessageKeysRef.current.add(item.key);
            attemptedAny = true;
            const spoke = await speakVoiceText(item.content, {
              persist: false,
              resumeAfter: false
            });
            if (spoke) {
              spokeAny = true;
            }
            // Either way (success or failure), keep the key marked so we
            // don't infinitely retry a broken message. Continue to the next
            // message so a single failure doesn't strand the rest of the
            // transcript unspoken.
            source = stateRef.current || source;
          }

          source = stateRef.current || source;
        }
      } while (speechQueueDrainRequestedRef.current);

      if (attemptedAny) {
        voiceAssistantSpeakingRef.current = false;
        waitForCandidateMicPress();
      }

      if (!spokeAny && !attemptedAny) {
        return voiceAssistantSpeakingRef.current || Boolean(assistantSpeechTextRef.current);
      }

      return spokeAny;
    } finally {
      speechQueueRunningRef.current = false;
      // Final safety: if the queue exited without leaving any audio mid-play,
      // make sure the speaking flag is cleared so a subsequent mic tap can
      // start listening instead of being trapped in the "AI is speaking" branch.
      if (!assistantSpeechTextRef.current) {
        voiceAssistantSpeakingRef.current = false;
      }
    }
  }, [speakVoiceText, waitForCandidateMicPress]);

  const toggleCandidateMic = useCallback(() => {
    if (voiceState !== "connected") return;

    // Self-heal: if the speaking flag is stuck true but nothing is actually
    // playing or queued, clear it so the click can put the mic into listen
    // mode instead of looping back to "Interviewer is speaking".
    const audio = ttsAudioRef.current;
    const audioBusy = Boolean(audio && !audio.paused && !audio.ended);
    if (
      voiceAssistantSpeakingRef.current &&
      !audioBusy &&
      !assistantSpeechTextRef.current &&
      !assistantSpeech.active &&
      !speechQueueRunningRef.current
    ) {
      voiceAssistantSpeakingRef.current = false;
    }

    const next = !voiceMicWantedRef.current;
    voiceMicWantedRef.current = next;

    if (!next) {
      pauseCandidateMic("off", "Mic is off");
      return;
    }

    if (voiceAssistantSpeakingRef.current || assistantSpeech.active) {
      voiceMicWantedRef.current = false;
      pauseCandidateMic("paused", "Interviewer is speaking. Mic is locked.");
      return;
    }

    if (voiceProcessingRef.current) {
      pauseCandidateMic("processing", "Processing what you said...");
      return;
    }

    resumeCandidateMic();
  }, [assistantSpeech.active, pauseCandidateMic, resumeCandidateMic, voiceState]);

  const handleCandidateVoiceTranscript = useCallback(async (text: string) => {
    const cleaned = normalizeTranscriptText(text);
    const activeSession = sessionRef.current;
    if (!cleaned || !activeSession || activeSession.status !== "in_progress") return;
    if (voiceWsRef.current?.readyState === WebSocket.OPEN && !isCandidateSpeechTurnActive()) return;

    const key = transcriptKey("candidate", activeSession.currentQuestionIndex, cleaned);
    if (recordedTranscriptKeysRef.current.has(key)) return;
    recordedTranscriptKeysRef.current.add(key);
    candidateSpeechTurnEpochRef.current = 0;
    activeCandidateTurnEpochRef.current = 0;
    voiceTurnPhaseRef.current = "processing";

    voiceProcessingRef.current = true;
    pauseCandidateMic("processing", "Processing what you said...", { phase: "processing" });

    try {
      const data = await aiInterviewService.sendPublicMessage(token, cleaned);
      applyPublicState(data);
      setMessage("");

      const spoke = await speakPendingAiMessages(data);
      if (!spoke) {
        waitForCandidateMicPress();
      }
    } catch (error: any) {
      recordedTranscriptKeysRef.current.delete(key);
      toast.error(error.message || "Failed to send voice response");
      waitForCandidateMicPress("I could not process that. Tap the mic to try again.");
    }
  }, [applyPublicState, isCandidateSpeechTurnActive, pauseCandidateMic, speakPendingAiMessages, token, waitForCandidateMicPress]);

  const handleVoiceEvent = useCallback((event: any) => {
    const type = event?.type;
    if (!type) return;

    if (type === "voice.proxy.ready") {
      setVoiceStatus("Voice mode is ready");
      return;
    }

    if (type === "voice.output.blocked") {
      return;
    }

    if (type === "voice.error" || type === "error") {
      setVoiceState("error");
      setVoiceStatus(event?.message || event?.error?.message || "Voice mode failed");
      finishAssistantSpeechVisual();
      return;
    }

    if (type === "session.updated") {
      setVoiceStatus("Voice session ready");
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      if (!isCandidateSpeechTurnActive()) return;
      candidateSpeechTurnEpochRef.current = activeCandidateTurnEpochRef.current;
      voiceTurnPhaseRef.current = "listening";
      voiceProcessingRef.current = false;
      setVoiceStatus("Listening...");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      if (!isCurrentCandidateSpeechEvent()) return;
      if (browserSpeechSupportedRef.current) {
        setVoiceStatus("Listening for your transcript...");
      } else {
        voiceProcessingRef.current = true;
        pauseCandidateMic("processing", "Processing what you said...", {
          preserveCandidateTurn: true,
          phase: "processing"
        });
      }
      return;
    }

    if (isCandidateTranscriptDeltaEvent(type)) {
      if (!isCurrentCandidateSpeechEvent()) return;
      setVoiceStatus("Transcribing with Azure Speech...");
      return;
    }

    if (isCandidateTranscriptFailedEvent(type)) {
      if (!isCurrentCandidateSpeechEvent()) return;
      voiceProcessingRef.current = false;
      candidateSpeechTurnEpochRef.current = 0;
      setVoiceStatus("Azure Speech could not transcribe that. Please try again.");
      waitForCandidateMicPress("I did not catch that. Tap the mic to try again.");
      return;
    }

    if (type === "response.created" || type === "response.audio.delta" || type === "response.audio.done" || type === "response.done") {
      setVoiceStatus("Ignoring unexpected Voice Live output. Interview speech is controlled by Azure Speech TTS.");
      return;
    }

    if (isCandidateTranscriptEvent(type)) {
      if (!isCurrentCandidateSpeechEvent()) return;
      const transcript = getVoiceTranscriptText(event);
      if (transcript) {
        void handleCandidateVoiceTranscript(transcript);
      } else {
        waitForCandidateMicPress("I did not catch that. Tap the mic to try again.");
      }
      return;
    }

    if (type.startsWith("response.")) return;
  }, [finishAssistantSpeechVisual, handleCandidateVoiceTranscript, isCandidateSpeechTurnActive, isCurrentCandidateSpeechEvent, pauseCandidateMic, waitForCandidateMicPress]);

  const disconnectVoice = useCallback(() => {
    cleanupVoice("Voice mode is off");
  }, [cleanupVoice]);

  const connectVoice = useCallback(async (stateOverride?: PublicAIInterviewState) => {
    const activeSession = stateOverride?.session || session;
    const activeVoiceEnabled = Boolean(stateOverride?.voice?.enabled ?? voiceEnabled);

    if (!activeVoiceEnabled) {
      toast.error("Voice Live is not configured for this interview yet");
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

    cleanupVoice("Starting voice mode...");
    setVoiceState("connecting");
    setVoiceStatus("Connecting to Voice Live...");

    try {
      const ws = new WebSocket(aiInterviewService.getVoiceWebSocketUrl(token));
      voiceWsRef.current = ws;

      const proxyReady = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Voice proxy did not become ready")), 15000);
        ws.addEventListener("message", function onMessage(event) {
          const payload = parseVoiceMessage(event.data);
          if (payload?.type === "voice.proxy.ready") {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            handleVoiceEvent(payload);
            resolve();
          } else if (payload?.type === "voice.error" || payload?.type === "error") {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            reject(new Error(payload.message || payload.error?.message || "Voice proxy failed"));
          }
        });
        ws.addEventListener("error", () => reject(new Error("Voice WebSocket failed")), { once: true });
      });

      ws.addEventListener("message", (event) => {
        const payload = parseVoiceMessage(event.data);
        if (payload) handleVoiceEvent(payload);
      });

      ws.addEventListener("close", () => {
        if (voiceWsRef.current === ws) {
          voiceWsRef.current = null;
          if (isVoiceTransportActive()) {
            setVoiceState("connected");
            if (!assistantSpeechTextRef.current && !voiceAssistantSpeakingRef.current) {
              setVoiceStatus("Voice mode is ready. Tap the mic when you are ready to speak.");
            }
            return;
          }
          waitForCandidateMicPress("Voice connection closed. Start voice mode again to continue by voice.");
          setVoiceState("idle");
        }
      });

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error("Voice WebSocket failed")), { once: true });
      });
      await proxyReady;

      const peerConnection = new RTCPeerConnection();
      voicePeerRef.current = peerConnection;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceMicWantedRef.current = false;
      setVoiceInputEnabled(false);
      setVoiceMicState("paused");
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.ontrack = () => {
        // Voice Live is used for Azure STT only. Interviewer audio is produced by Azure Speech TTS.
      };

      const dataChannel = peerConnection.createDataChannel("voice-live-events");
      voiceDataChannelRef.current = dataChannel;
      dataChannel.onmessage = (event) => {
        const payload = parseVoiceMessage(event.data);
        if (payload) handleVoiceEvent(payload);
      };
      dataChannel.onopen = () => setVoiceStatus("Connected. The interviewer will speak first. Tap the mic when you are ready to answer.");
      dataChannel.onclose = () => {
        if (voiceDataChannelRef.current === dataChannel) {
          voiceDataChannelRef.current = null;
          waitForCandidateMicPress("Voice input channel closed. Start voice mode again to continue by voice.");
          setVoiceState("idle");
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (voicePeerRef.current !== peerConnection) return;
        if (peerConnection.connectionState === "connected") {
          setVoiceState("connected");
          if (!assistantSpeechTextRef.current && !voiceMicWantedRef.current) {
            setVoiceStatus("Voice mode is ready. Tap the mic when you are ready to speak.");
          }
        }
        if (peerConnection.connectionState === "disconnected") {
          setVoiceState("connected");
          setVoiceInputEnabled(false);
          setVoiceMicState("paused");
          setVoiceStatus("Voice connection is reconnecting...");
          return;
        }
        if (["failed", "closed"].includes(peerConnection.connectionState)) {
          waitForCandidateMicPress("Voice connection closed. Start voice mode again to continue by voice.");
          setVoiceState("idle");
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const answerPromise = new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Voice Live did not return an SDP answer")), 15000);
        ws.addEventListener("message", function onMessage(event) {
          const payload = parseVoiceMessage(event.data);
          if (payload?.type === "rtc.call.sdp.created" && payload.sdp_answer) {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            resolve(payload.sdp_answer);
          } else if (payload?.type === "voice.error" || payload?.type === "error") {
            window.clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            reject(new Error(payload.message || payload.error?.message || "Voice Live failed"));
          }
        });
      });

      ws.send(JSON.stringify({
        type: "rtc.call.sdp.create",
        sdp_offer: peerConnection.localDescription?.sdp
      }));

      const sdpAnswer = await answerPromise;
      await peerConnection.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
      setVoiceState("connected");
      voiceAssistantSpeakingRef.current = true;
      pauseCandidateMic("paused", "Interviewer is getting ready. Mic is locked.");

      window.setTimeout(() => {
        const activeState = stateOverride || stateRef.current;
        void speakPendingAiMessages(activeState).then((spoke) => {
          if (!spoke) waitForCandidateMicPress();
        });
      }, 500);
    } catch (error: any) {
      cleanupVoice(error.message || "Voice mode failed");
      setVoiceState("error");
      toast.error(error.message || "Unable to start voice mode");
    }
  }, [cleanupVoice, handleVoiceEvent, isVoiceTransportActive, pauseCandidateMic, session, setVoiceInputEnabled, speakPendingAiMessages, token, voiceEnabled, waitForCandidateMicPress]);

  const startBrowserSpeechRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      browserSpeechSupportedRef.current = false;
      setBrowserSpeechState("unavailable");
      return false;
    }

    browserSpeechSupportedRef.current = true;
    browserSpeechWantedRef.current = true;

    if (!browserSpeechRecognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let finalTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = event.results[index]?.[0]?.transcript || "";
          if (event.results[index]?.isFinal) {
            finalTranscript += transcript;
          }
        }

        if (finalTranscript.trim()) {
          void handleCandidateVoiceTranscript(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        const error = String(event?.error || "");
        if (["aborted", "no-speech"].includes(error)) return;
        setVoiceStatus(error === "not-allowed" ? "Microphone permission was blocked." : "Speech recognition paused. You can keep speaking or type instead.");
      };

      recognition.onend = () => {
        if (!browserSpeechWantedRef.current) {
          setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
          return;
        }

        if (
          voiceWsRef.current?.readyState === WebSocket.OPEN &&
          voiceMicWantedRef.current &&
          !voiceAssistantSpeakingRef.current &&
          !voiceProcessingRef.current
        ) {
          setBrowserSpeechState("listening");
          browserSpeechRestartTimerRef.current = window.setTimeout(() => {
            if (browserSpeechWantedRef.current) {
              try {
                recognition.start();
              } catch {
                // Browser may still be settling from the previous speech session.
              }
            }
          }, 250);
        } else {
          setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
        }
      };

      browserSpeechRecognitionRef.current = recognition;
    }

    try {
      browserSpeechRecognitionRef.current.start();
      setBrowserSpeechState("listening");
      return true;
    } catch {
      setBrowserSpeechState("listening");
      return true;
    }
  }, [handleCandidateVoiceTranscript]);

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    browserSpeechSupportedRef.current = USE_BROWSER_SPEECH_FALLBACK && Boolean(SpeechRecognition);
    setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
  }, []);

  useEffect(() => {
    if (USE_BROWSER_SPEECH_FALLBACK && voiceState === "connected" && voiceMicState === "listening") {
      startBrowserSpeechRecognition();
      return;
    }

    stopBrowserSpeechRecognition();
  }, [startBrowserSpeechRecognition, stopBrowserSpeechRecognition, voiceMicState, voiceState]);

  useEffect(() => {
    stateRef.current = state;
    sessionRef.current = session || null;
  }, [session, state]);

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
    if (voiceState !== "connected") return;
    if (session?.status !== "in_progress" || !speakableAiMessageSignature) return;
    if (!isVoiceTransportActive()) return;

    const ws = voiceWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voice.refresh_session" }));
    }
    window.setTimeout(() => {
      if (!isVoiceTransportActive()) return;
      voiceAssistantSpeakingRef.current = true;
      pauseCandidateMic("paused", "Interviewer is getting ready. Mic is locked.");
      void speakPendingAiMessages(stateRef.current).then((spoke) => {
        if (!spoke) waitForCandidateMicPress();
      });
    }, 500);
  }, [currentIndex, isVoiceTransportActive, pauseCandidateMic, session?.status, speakPendingAiMessages, speakableAiMessageSignature, voiceState, waitForCandidateMicPress]);

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

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) return;

    setSending(true);
    setMessage("");
    try {
      const data = await aiInterviewService.sendPublicMessage(token, text);
      applyPublicState(data);
      if (voiceState === "connected") {
        void speakPendingAiMessages(data);
      }
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
      applyPublicState(data);
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
    <main className="min-h-[100dvh] overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)]">
      <audio ref={ttsAudioRef} preload="auto" className="hidden" />
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

          {session.status === "in_progress" && (
            <div className="rounded-2xl border bg-white/95 p-4 shadow-lg shadow-slate-200/70">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Volume2 className="h-4 w-4 text-emerald-600" />
                  Voice mode
                </div>
                <Badge variant={voiceState === "connected" ? "default" : "secondary"} className={voiceState === "connected" ? "bg-emerald-600" : ""}>
                  {voiceState === "connected" ? "Live" : voiceState === "connecting" ? "Connecting" : voiceEnabled ? "Ready" : "Off"}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-slate-600">{voiceStatus}</p>
              {assistantSpeech.active && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      </span>
                      AI is speaking
                    </div>
                    <Badge variant="outline" className="border-emerald-200 bg-white text-emerald-700">Mic muted</Badge>
                  </div>
                  <div className="mb-2 flex h-7 items-end gap-1">
                    {[0, 1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className="w-1.5 rounded-full bg-emerald-500/80"
                        style={{
                          height: `${10 + ((bar * 7 + Math.round(assistantSpeech.progress)) % 18)}px`
                        }}
                      />
                    ))}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${assistantSpeech.progress}%` }} />
                  </div>
                </div>
              )}
              {voiceState === "connected" && (
                <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  <span className="font-medium text-slate-900">Mic:</span>{" "}
                  {voiceMicState === "listening"
                    ? "Open. You can speak now."
                    : voiceMicState === "paused"
                      ? "Paused while the interviewer speaks."
                      : voiceMicState === "processing"
                        ? "Paused while your response is processed."
                        : "Off."}
                </div>
              )}
              {voiceState === "connected" ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={voiceMicState === "listening" ? "outline" : "default"}
                    disabled={assistantSpeech.active || voiceMicState === "processing"}
                    onClick={toggleCandidateMic}
                  >
                    {voiceMicState === "listening" ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {micControlLabel}
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnectVoice}>
                    End voice
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  className="mt-4 w-full bg-slate-950 text-white hover:bg-slate-800"
                  disabled={!voiceEnabled || voiceState === "connecting"}
                  onClick={() => connectVoice()}
                >
                  {voiceState === "connecting" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="mr-2 h-4 w-4" />
                  )}
                  Start voice mode
                </Button>
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
              <div className="mx-auto grid max-w-6xl gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="border-b bg-slate-950 px-4 py-5 text-white sm:px-7 sm:py-7">
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
                        <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal sm:text-4xl">
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

                  <div className="space-y-4 p-4 sm:space-y-5 sm:p-7">
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { label: "Question time", value: questionTimeLabel, icon: Clock, tone: "blue" },
                        { label: "Total window", value: totalTimeLabel, icon: TimerReset, tone: "emerald" },
                        { label: "Progress", value: `${Math.min(activeStep, questionCount)} / ${questionCount}`, icon: Workflow, tone: "slate" }
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border bg-slate-50/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-slate-600">{item.label}</div>
                            <item.icon className={`h-4 w-4 ${
                              item.tone === "emerald" ? "text-emerald-600" : item.tone === "blue" ? "text-blue-600" : "text-slate-500"
                            }`} />
                          </div>
                          <div className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">{item.value}</div>
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
                    <Button className="mt-5 h-12 w-full bg-white text-slate-950 hover:bg-slate-100" onClick={start} disabled={starting}>
                      {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                      Start Interview
                    </Button>
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      Voice stays off until you tap the mic in the workspace. You can type at any time.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[100dvh] min-h-0 flex-col sm:h-[calc(100dvh-32px)] xl:h-[calc(100dvh-48px)]">
              <div className="border-b bg-slate-950 p-3 pb-2 text-white sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 sm:gap-2 sm:text-sm">
                      <span>Question {currentIndex + 1} of {questionCount}</span>
                      <span className="hidden h-1 w-1 rounded-full bg-slate-500 sm:inline-flex" />
                      <span className="truncate">{state.job?.title || interview.title}</span>
                    </div>
                    <h2 className="mt-1 text-lg font-semibold tracking-normal sm:text-xl">Interview Workspace</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] sm:mt-3 sm:gap-2 sm:text-xs">
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!voiceEnabled || voiceState === "connecting" || (voiceState === "connected" && (assistantSpeech.active || voiceMicState === "processing"))}
                      onClick={voiceState === "connected" ? toggleCandidateMic : () => connectVoice()}
                      className="h-11 min-w-11 rounded-xl bg-white px-3 text-slate-950 hover:bg-slate-100 sm:px-4"
                    >
                      {voiceState === "connecting" ? (
                        <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                      ) : voiceState === "connected" && voiceMicState === "listening" ? (
                        <MicOff className="h-4 w-4 sm:mr-2" />
                      ) : (
                        <Mic className="h-4 w-4 sm:mr-2" />
                      )}
                      <span className="hidden sm:inline">
                        {voiceState === "connected"
                          ? voiceMicState === "listening"
                            ? "Mute mic"
                            : micControlLabel
                          : "Voice"}
                      </span>
                    </Button>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-2 sm:p-4 md:p-5">
                <div className="mx-auto flex max-w-5xl flex-col gap-3">
                {(session.messages || []).map((chat, index) => (
                  <div
                    key={chat._id || index}
                    className={`flex ${chat.role === "candidate" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[min(88%,820px)] rounded-2xl px-3 py-2.5 text-[15px] leading-6 shadow-sm sm:max-w-[min(92%,820px)] sm:px-5 sm:py-4 sm:text-sm ${
                        chat.role === "candidate"
                          ? "rounded-br-md bg-slate-950 text-white"
                          : "rounded-bl-md border bg-white text-slate-900"
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
                <div ref={bottomRef} />
                </div>
              </div>

              <div className="border-t bg-white/95 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:p-4">
                <div className="mx-auto max-w-5xl">
                {voiceState !== "idle" && (
                  <div className={`mb-2 rounded-2xl border px-3 py-2.5 text-xs sm:mb-3 sm:py-3 ${
                    voiceState === "connected"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : voiceState === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        {voiceState === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                        <span className="truncate">{voiceStatus}</span>
                      </div>
                      {voiceState === "connected" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              voiceMicState === "listening"
                                ? "border-emerald-200 bg-white text-emerald-700"
                                : voiceMicState === "processing"
                                  ? "border-blue-200 bg-white text-blue-700"
                                  : "border-slate-200 bg-white text-slate-700"
                            }
                          >
                            {assistantSpeech.active
                              ? "AI speaking"
                              : voiceMicState === "listening"
                                ? "Speak now"
                                : voiceMicState === "processing"
                                  ? "Processing"
                                  : "Mic muted"}
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant={voiceMicState === "listening" ? "outline" : "default"}
                            disabled={assistantSpeech.active || voiceMicState === "processing"}
                            onClick={toggleCandidateMic}
                            className="h-8"
                          >
                            {voiceMicState === "listening" ? <MicOff className="mr-2 h-3.5 w-3.5" /> : <Mic className="mr-2 h-3.5 w-3.5" />}
                            {micControlLabel}
                          </Button>
                        </div>
                      )}
                    </div>
                    {assistantSpeech.active && (
                      <div className="mt-3 rounded-lg bg-white/80 p-3 text-slate-700">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="font-semibold text-emerald-900">AI is speaking. Your mic is muted.</span>
                          <span className="text-[11px] text-emerald-700">{Math.round(assistantSpeech.progress)}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${assistantSpeech.progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-2xl border bg-white p-2 shadow-sm">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Type your answer or ask for clarification..."
                    rows={2}
                    className="min-h-[56px] max-h-[160px] resize-none border-0 bg-slate-50 text-base shadow-none focus-visible:ring-0 sm:min-h-[82px] sm:max-h-[220px] sm:resize-y sm:text-sm"
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <div className="mt-2 grid grid-cols-[44px_1fr] gap-2 sm:grid-cols-[auto_auto_1fr]">
                    <Button variant="outline" onClick={() => setMessage("")} disabled={!message.trim()} className="min-h-[44px] px-0 sm:px-4">
                      <X className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Clear</span>
                    </Button>
                    <Button variant="outline" onClick={sendMessage} disabled={sending || !message.trim()} className="min-h-[44px]">
                      {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Send
                    </Button>
                    <Button onClick={confirm} disabled={confirming || timeoutRunning} className="col-span-2 min-h-[46px] bg-emerald-600 hover:bg-emerald-700 sm:col-span-1 sm:justify-self-end">
                      {confirming || timeoutRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Confirm & Move On
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
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
