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

// Single source of truth for the voice-mode lifecycle. Every UI element and
// every voice handler reads this — no more competing refs that get out of sync.
//   off        — voice mode is not running
//   connecting — establishing WS/RTC connection
//   speaking   — TTS is playing one or more AI messages back-to-back
//   listening  — mic is open and Azure STT is transcribing
//   processing — user finished speaking (or hit "I'm done"); we're sending and
//                waiting for the AI response
//   error      — voice mode failed; user must restart
type VoicePhase = "off" | "connecting" | "speaking" | "listening" | "processing" | "error";

type AssistantSpeechState = {
  active: boolean;
  text: string;
  progress: number;
};

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
  const [voicePhase, setVoicePhaseState] = useState<VoicePhase>("off");
  const [voiceStatus, setVoiceStatus] = useState("Voice mode is off");
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
  // Phase mirror so async work (audio playback, fetches, WS events) can read
  // the current phase without waiting for a re-render.
  const voicePhaseRef = useRef<VoicePhase>("off");
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
  // The single voice action button has different meanings per phase:
  //   off / error   — primary action is to start voice mode
  //   speaking      — disabled (the AI is talking)
  //   listening     — primary action is "I'm done speaking" → moves to processing
  //   processing    — disabled (we're talking to the backend)
  //   connecting    — disabled spinner
  const voiceActionLabel = (() => {
    switch (voicePhase) {
      case "speaking": return "AI is speaking";
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
    if (voicePhase === "listening") return "listening";
    if (voicePhase === "processing") return "processing";
    if (voicePhase === "error") return "error";
    return "neutral";
  })();
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

  // Single setter that updates the phase ref AND state in one place. Every
  // transition flows through here so the ref and the React state can never
  // disagree (a class of bugs the previous implementation kept hitting).
  const setVoicePhase = useCallback((next: VoicePhase, status?: string) => {
    voicePhaseRef.current = next;
    setVoicePhaseState(next);
    if (status !== undefined) setVoiceStatus(status);
  }, []);

  const setMicTrackEnabled = useCallback((enabled: boolean) => {
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

  const cleanupVoice = useCallback((status = "Voice mode is off", nextPhase: VoicePhase = "off") => {
    voiceDataChannelRef.current?.close();
    voiceDataChannelRef.current = null;

    voicePeerRef.current?.close();
    voicePeerRef.current = null;

    voiceWsRef.current?.close();
    voiceWsRef.current = null;

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;

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
  }, [setVoicePhase]);

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
  const playSpeechClip = useCallback(async (text: string, requestId: number) => {
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned) return;
    const maybeAudio = ttsAudioRef.current;
    if (!maybeAudio) throw new Error("Audio element not ready.");
    const audio: HTMLAudioElement = maybeAudio;

    // Stop any current playback before swapping the source. We DO NOT call
    // removeAttribute("src") + load() here — that un-primes the element on
    // iOS Safari and causes the very next play() to silently never fire
    // 'ended'.
    try { audio.pause(); } catch { /* ignore */ }

    const previousUrl = activeTtsUrlRef.current;
    const audioBlob = await aiInterviewService.synthesizePublicSpeech(token, cleaned);
    if (speechRequestIdRef.current !== requestId) return;

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
  }, [token]);

  // The single voice-flow driver. Reads the current session state and:
  //   1. Speaks every queued AI message that hasn't been spoken yet.
  //   2. After draining, automatically opens the mic and moves to 'listening'.
  // Re-entry is safe; concurrent invocations no-op.
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
        setMicTrackEnabled(false);

        const requestId = ++speechRequestIdRef.current;
        const cleaned = normalizeTranscriptText(item.content);
        startAssistantSpeechVisual(cleaned, false);

        try {
          console.debug("[ai-interview] speaking", { key: item.key });
          await playSpeechClip(cleaned, requestId);
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

      // Queue drained. If voice is still on and the session is live, auto-listen.
      const phaseAfterDrain = voicePhaseRef.current as VoicePhase;
      if (
        phaseAfterDrain !== "off" &&
        phaseAfterDrain !== "error" &&
        sessionRef.current?.status === "in_progress" &&
        isVoiceTransportActive()
      ) {
        setMicTrackEnabled(true);
        setVoicePhase("listening", "I'm listening — speak naturally. Tap \"I'm done\" when you finish.");
      }
    } finally {
      speechQueueRunningRef.current = false;
    }
  }, [isVoiceTransportActive, playSpeechClip, setMicTrackEnabled, setVoicePhase, startAssistantSpeechVisual, finishAssistantSpeechVisual]);

  // User pressed "I'm done" while listening — close the mic and move into
  // processing so the upcoming Azure transcript is treated as the answer.
  const endListening = useCallback(() => {
    if (voicePhaseRef.current !== "listening") return;
    setMicTrackEnabled(false);
    setVoicePhase("processing", "Got it — let me think about that…");
  }, [setMicTrackEnabled, setVoicePhase]);

  const handleCandidateVoiceTranscript = useCallback(async (text: string) => {
    const cleaned = normalizeTranscriptText(text);
    const activeSession = sessionRef.current;
    if (!cleaned || !activeSession || activeSession.status !== "in_progress") return;
    // Only accept transcripts when we're listening or already processing one.
    if (voicePhaseRef.current !== "listening" && voicePhaseRef.current !== "processing") return;

    const key = transcriptKey("candidate", activeSession.currentQuestionIndex, cleaned);
    if (recordedTranscriptKeysRef.current.has(key)) return;
    recordedTranscriptKeysRef.current.add(key);

    setMicTrackEnabled(false);
    setVoicePhase("processing", "Got it — let me think about that…");

    try {
      const data = await aiInterviewService.sendPublicMessage(token, cleaned);
      applyPublicState(data);
      setMessage("");
      // The state change will trigger the speakableAiMessageSignature effect
      // which calls advanceVoiceFlow() — but we also invoke it here to keep
      // the experience snappy and to avoid relying on render scheduling.
      void advanceVoiceFlow();
    } catch (error: any) {
      recordedTranscriptKeysRef.current.delete(key);
      toast.error(error?.message || "Failed to send your answer");
      if (isVoiceTransportActive()) {
        setMicTrackEnabled(true);
        setVoicePhase("listening", "Let's try that again — I'm listening.");
      } else {
        setVoicePhase("off", "Voice connection lost. Restart voice mode to continue.");
      }
    }
  }, [applyPublicState, advanceVoiceFlow, isVoiceTransportActive, setMicTrackEnabled, setVoicePhase, token]);

  const handleVoiceEvent = useCallback((event: any) => {
    const type = event?.type;
    if (!type) return;

    if (type === "voice.proxy.ready" || type === "session.updated" || type === "voice.output.blocked") {
      return;
    }

    if (type === "voice.error" || type === "error") {
      setVoicePhase("error", event?.message || event?.error?.message || "Voice mode failed");
      finishAssistantSpeechVisual();
      toast.error(event?.message || event?.error?.message || "Voice mode failed");
      return;
    }

    // We only care about candidate transcript events while the user is in
    // listening/processing — anything earlier is residual from the previous
    // turn and should be ignored.
    const listeningOrProcessing = voicePhaseRef.current === "listening" || voicePhaseRef.current === "processing";

    if (type === "input_audio_buffer.speech_started") {
      if (voicePhaseRef.current === "listening") {
        setVoiceStatus("Listening… you can keep speaking.");
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      // Azure detected the user stopped talking. Switch to processing so the
      // transcription event below routes correctly.
      if (voicePhaseRef.current === "listening") {
        setMicTrackEnabled(false);
        setVoicePhase("processing", "Got it — let me think about that…");
      }
      return;
    }

    if (isCandidateTranscriptDeltaEvent(type)) {
      if (!listeningOrProcessing) return;
      // Could be used in future to show interim transcript text.
      return;
    }

    if (isCandidateTranscriptFailedEvent(type)) {
      if (!listeningOrProcessing) return;
      if (isVoiceTransportActive()) {
        setMicTrackEnabled(true);
        setVoicePhase("listening", "I didn't catch that — try again.");
      }
      return;
    }

    if (isCandidateTranscriptEvent(type)) {
      if (!listeningOrProcessing) return;
      const transcript = getVoiceTranscriptText(event);
      if (transcript) {
        void handleCandidateVoiceTranscript(transcript);
      } else if (isVoiceTransportActive()) {
        setMicTrackEnabled(true);
        setVoicePhase("listening", "I didn't catch that — try again.");
      }
      return;
    }

    // Anything from Voice Live's own LLM (response.*) is ignored — we use
    // Azure Speech TTS, not Voice Live's response audio.
    if (type.startsWith("response.")) return;
  }, [finishAssistantSpeechVisual, handleCandidateVoiceTranscript, isVoiceTransportActive, setMicTrackEnabled, setVoicePhase]);

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

    cleanupVoice("Starting voice mode…", "connecting");
    setVoicePhase("connecting", "Connecting voice mode…");

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
          // If the RTC peer is still up, keep going — Azure tears the WS
          // down once RTC is established. Otherwise the connection is gone.
          if (!isVoiceTransportActive()) {
            setMicTrackEnabled(false);
            setVoicePhase("off", "Voice connection closed. Restart voice mode to continue.");
          }
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
      // Mic stays muted until the queue has drained and we move to 'listening'.
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.ontrack = () => {
        // Voice Live audio output is intentionally ignored; we use Azure TTS.
      };

      const dataChannel = peerConnection.createDataChannel("voice-live-events");
      voiceDataChannelRef.current = dataChannel;
      dataChannel.onmessage = (event) => {
        const payload = parseVoiceMessage(event.data);
        if (payload) handleVoiceEvent(payload);
      };
      dataChannel.onclose = () => {
        if (voiceDataChannelRef.current === dataChannel) {
          voiceDataChannelRef.current = null;
          if (!isVoiceTransportActive()) {
            setMicTrackEnabled(false);
            setVoicePhase("off", "Voice connection closed. Restart voice mode to continue.");
          }
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (voicePeerRef.current !== peerConnection) return;
        if (peerConnection.connectionState === "disconnected") {
          setVoiceStatus("Voice connection is reconnecting…");
          return;
        }
        if (["failed", "closed"].includes(peerConnection.connectionState)) {
          setMicTrackEnabled(false);
          setVoicePhase("off", "Voice connection closed. Restart voice mode to continue.");
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

      // Voice is live. Transition to 'speaking' and let advanceVoiceFlow drain
      // the queue, after which it'll automatically move to 'listening'.
      setVoicePhase("speaking", "Voice ready. Interviewer is starting…");
      // A small delay lets the audio element finish settling after any prior
      // cleanup and gives React a paint before audio starts.
      window.setTimeout(() => { void advanceVoiceFlow(); }, 200);
    } catch (error: any) {
      cleanupVoice(error?.message || "Voice mode failed", "error");
      toast.error(error?.message || "Unable to start voice mode");
    }
  }, [advanceVoiceFlow, cleanupVoice, handleVoiceEvent, isVoiceTransportActive, session, setMicTrackEnabled, setVoicePhase, token, voiceEnabled]);

  useEffect(() => {
    load();
  }, [token]);

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

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) return;

    setSending(true);
    setMessage("");
    // If we were listening, stop — typing implicitly ends the listening turn
    // and the AI response will trigger another listen cycle when it arrives.
    if (voicePhaseRef.current === "listening") {
      setMicTrackEnabled(false);
      setVoicePhase("processing", "Got it — let me think about that…");
    }
    try {
      const data = await aiInterviewService.sendPublicMessage(token, text);
      applyPublicState(data);
      // The speakableAiMessageSignature effect will pick up the new message
      // and call advanceVoiceFlow if voice is on.
    } catch (error: any) {
      toast.error(error?.message || "Failed to send message");
      setMessage(text);
      // Roll back to listening if we were there and the transport is still up.
      if (voicePhaseRef.current === "processing" && isVoiceTransportActive()) {
        setMicTrackEnabled(true);
        setVoicePhase("listening", "Let's try that again — I'm listening.");
      }
    } finally {
      setSending(false);
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
                <Badge
                  variant={voicePhase === "listening" || voicePhase === "speaking" || voicePhase === "processing" ? "default" : "secondary"}
                  className={
                    voicePhase === "listening" ? "bg-blue-600" :
                    voicePhase === "speaking" ? "bg-emerald-600" :
                    voicePhase === "processing" ? "bg-amber-500" :
                    voicePhase === "error" ? "bg-red-600" : ""
                  }
                >
                  {voicePhase === "speaking" ? "Speaking" :
                    voicePhase === "listening" ? "Listening" :
                    voicePhase === "processing" ? "Thinking" :
                    voicePhase === "connecting" ? "Connecting" :
                    voicePhase === "error" ? "Error" :
                    voiceEnabled ? "Ready" : "Off"}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-slate-600">{voiceStatus}</p>

              {voicePhase === "speaking" && assistantSpeech.active && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      </span>
                      Interviewer is speaking
                    </div>
                    <Badge variant="outline" className="border-emerald-200 bg-white text-emerald-700">Mic muted</Badge>
                  </div>
                  <div className="mb-2 flex h-7 items-end gap-1">
                    {[0, 1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className="w-1.5 rounded-full bg-emerald-500/80"
                        style={{ height: `${10 + ((bar * 7 + Math.round(assistantSpeech.progress)) % 18)}px` }}
                      />
                    ))}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${assistantSpeech.progress}%` }} />
                  </div>
                </div>
              )}

              {voicePhase === "listening" && (
                <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-900">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
                    </span>
                    Listening… speak naturally
                  </div>
                  <p className="mt-2 text-xs leading-5 text-blue-800">
                    I'll wait for you to finish. Tap <span className="font-semibold">I'm done</span> below when you're ready to send.
                  </p>
                </div>
              )}

              {voicePhase === "processing" && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Thinking about your answer…
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
                    variant={voicePhase === "listening" ? "default" : "outline"}
                    className={voicePhase === "listening" ? "bg-blue-600 hover:bg-blue-700" : ""}
                    disabled={voiceActionDisabled}
                    onClick={endListening}
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
                      disabled={!voiceEnabled || voicePhase === "connecting" || voicePhase === "speaking" || voicePhase === "processing"}
                      onClick={
                        voicePhase === "listening"
                          ? endListening
                          : (voicePhase === "off" || voicePhase === "error")
                            ? () => connectVoice()
                            : undefined
                      }
                      className="h-11 min-w-11 rounded-xl bg-white px-3 text-slate-950 hover:bg-slate-100 sm:px-4"
                    >
                      {voicePhase === "connecting" ? (
                        <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                      ) : voicePhase === "listening" ? (
                        <MicOff className="h-4 w-4 sm:mr-2" />
                      ) : (
                        <Mic className="h-4 w-4 sm:mr-2" />
                      )}
                      <span className="hidden sm:inline">{voiceActionLabel}</span>
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
                {voicePhase !== "off" && (
                  <div className={`mb-2 rounded-2xl border px-3 py-2.5 text-xs sm:mb-3 sm:py-3 ${
                    voiceBannerTone === "speaking"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : voiceBannerTone === "listening"
                        ? "border-blue-200 bg-blue-50 text-blue-900"
                        : voiceBannerTone === "processing"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : voiceBannerTone === "error"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        {voicePhase === "connecting" || voicePhase === "processing"
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : voicePhase === "listening"
                            ? <Mic className="h-3.5 w-3.5" />
                            : <Volume2 className="h-3.5 w-3.5" />}
                        <span className="truncate">{voiceStatus}</span>
                      </div>
                      {(voicePhase === "speaking" || voicePhase === "listening" || voicePhase === "processing") && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              voicePhase === "listening"
                                ? "border-blue-200 bg-white text-blue-700"
                                : voicePhase === "processing"
                                  ? "border-amber-200 bg-white text-amber-800"
                                  : "border-emerald-200 bg-white text-emerald-700"
                            }
                          >
                            {voicePhase === "speaking"
                              ? "AI speaking"
                              : voicePhase === "listening"
                                ? "Listening"
                                : "Thinking"}
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant={voicePhase === "listening" ? "default" : "outline"}
                            className={voicePhase === "listening" ? "h-8 bg-blue-600 hover:bg-blue-700" : "h-8"}
                            disabled={voiceActionDisabled}
                            onClick={endListening}
                          >
                            {voicePhase === "listening"
                              ? <MicOff className="mr-2 h-3.5 w-3.5" />
                              : <Mic className="mr-2 h-3.5 w-3.5" />}
                            {voiceActionLabel}
                          </Button>
                        </div>
                      )}
                      {voicePhase === "error" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-8"
                          disabled={!voiceEnabled}
                          onClick={() => connectVoice()}
                        >
                          <Mic className="mr-2 h-3.5 w-3.5" />
                          Restart voice
                        </Button>
                      )}
                    </div>
                    {voicePhase === "speaking" && assistantSpeech.active && (
                      <div className="mt-3 rounded-lg bg-white/80 p-3 text-slate-700">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="font-semibold text-emerald-900">Interviewer is speaking — mic is muted.</span>
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
