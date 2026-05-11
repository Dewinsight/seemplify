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

function isAssistantTranscriptDoneEvent(type?: string) {
  return [
    "response.audio_transcript.done",
    "response.output_text.done",
    "response.text.done"
  ].includes(type || "");
}

function isAssistantTranscriptDeltaEvent(type?: string) {
  return [
    "response.audio_transcript.delta",
    "response.output_text.delta",
    "response.text.delta"
  ].includes(type || "");
}

type VoiceMicState = "off" | "listening" | "paused" | "processing";
type BrowserSpeechState = "checking" | "unavailable" | "off" | "listening";

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

function getLatestAiMessageContent(data: PublicAIInterviewState) {
  const currentIndex = data.session.currentQuestionIndex;
  return [...(data.session.messages || [])]
    .reverse()
    .find((chat) => chat.role === "ai" && chat.questionIndex === currentIndex)
    ?.content?.trim() || "";
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
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const [voiceInputDraft, setVoiceInputDraft] = useState("");
  const [browserSpeechState, setBrowserSpeechState] = useState<BrowserSpeechState>("checking");
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
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceWsRef = useRef<WebSocket | null>(null);
  const voicePeerRef = useRef<RTCPeerConnection | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceDataChannelRef = useRef<RTCDataChannel | null>(null);
  const assistantTranscriptBufferRef = useRef<Record<string, string>>({});
  const assistantSpeechTimerRef = useRef<number | null>(null);
  const assistantSpeechTextRef = useRef("");
  const assistantSpeechStartedAtRef = useRef(0);
  const assistantSpeechDurationRef = useRef(0);
  const recordedTranscriptKeysRef = useRef<Set<string>>(new Set());
  const voiceMicWantedRef = useRef(false);
  const voiceAssistantSpeakingRef = useRef(false);
  const voiceProcessingRef = useRef(false);
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
  const assistantHighlightedWords = useMemo(
    () => getHighlightedWordCount(assistantSpeech.text, assistantSpeech.progress),
    [assistantSpeech.progress, assistantSpeech.text]
  );
  const micControlLabel = voiceMicState === "listening"
    ? "Mute mic"
    : voiceMicState === "processing"
      ? "Processing"
      : assistantSpeech.active
        ? "Mic muted"
        : "Unmute mic";
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

  const cleanupVoice = useCallback((status = "Voice mode is off") => {
    voiceDataChannelRef.current?.close();
    voiceDataChannelRef.current = null;

    voicePeerRef.current?.close();
    voicePeerRef.current = null;

    voiceWsRef.current?.close();
    voiceWsRef.current = null;

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (assistantSpeechTimerRef.current) {
      window.clearInterval(assistantSpeechTimerRef.current);
      assistantSpeechTimerRef.current = null;
    }

    if (browserSpeechRestartTimerRef.current) {
      window.clearTimeout(browserSpeechRestartTimerRef.current);
      browserSpeechRestartTimerRef.current = null;
    }

    browserSpeechWantedRef.current = false;
    try {
      browserSpeechRecognitionRef.current?.abort?.();
    } catch {
      // Ignore browser speech cleanup errors.
    }

    assistantTranscriptBufferRef.current = {};
    assistantSpeechTextRef.current = "";
    assistantSpeechStartedAtRef.current = 0;
    assistantSpeechDurationRef.current = 0;
    voiceMicWantedRef.current = false;
    voiceAssistantSpeakingRef.current = false;
    voiceProcessingRef.current = false;
    setVoiceState("idle");
    setVoiceMicState("off");
    setBrowserSpeechState(browserSpeechSupportedRef.current ? "off" : "unavailable");
    setAssistantSpeech({ active: false, text: "", progress: 0 });
    setVoiceInputDraft("");
    setVoiceStatus(status);
  }, []);

  const setVoiceInputEnabled = useCallback((enabled: boolean) => {
    voiceStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  const resumeCandidateMic = useCallback((status = "Listening. Speak naturally when you are ready.") => {
    voiceProcessingRef.current = false;
    voiceAssistantSpeakingRef.current = false;

    if (voiceWsRef.current?.readyState !== WebSocket.OPEN || !voiceMicWantedRef.current) {
      setVoiceInputEnabled(false);
      setVoiceMicState("off");
      setVoiceStatus("Mic is off");
      return;
    }

    setVoiceInputEnabled(true);
    setVoiceMicState("listening");
    setVoiceStatus(status);
  }, [setVoiceInputEnabled]);

  const pauseCandidateMic = useCallback((state: Exclude<VoiceMicState, "listening">, status: string) => {
    setVoiceInputEnabled(false);
    setVoiceMicState(state);
    setVoiceStatus(status);
  }, [setVoiceInputEnabled]);

  const sendVoiceCommand = useCallback((payload: Record<string, unknown>) => {
    const ws = voiceWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

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

  const startAssistantSpeechVisual = useCallback((text: string) => {
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

  const speakVoiceText = useCallback((
    text: string,
    options: { persist?: boolean; messageType?: "greeting" | "question" | "clarification" | "acknowledgement" | "transition" | "system" } = {}
  ) => {
    const cleaned = normalizeTranscriptText(text);
    if (!cleaned) return false;

    if (options.persist !== false) {
      void recordAssistantVoiceTranscript(cleaned, options.messageType);
    }

    voiceAssistantSpeakingRef.current = true;
    pauseCandidateMic("paused", "Interviewer is speaking. Mic is paused.");
    const sent = sendVoiceCommand({ type: "voice.speak_text", text: cleaned });
    if (sent) {
      startAssistantSpeechVisual(cleaned);
    } else {
      finishAssistantSpeechVisual();
    }
    return sent;
  }, [finishAssistantSpeechVisual, pauseCandidateMic, recordAssistantVoiceTranscript, sendVoiceCommand, startAssistantSpeechVisual]);

  const toggleCandidateMic = useCallback(() => {
    if (voiceState !== "connected") return;
    const next = !voiceMicWantedRef.current;
    voiceMicWantedRef.current = next;

    if (!next) {
      pauseCandidateMic("off", "Mic is off");
      return;
    }

    if (voiceAssistantSpeakingRef.current) {
      pauseCandidateMic("paused", "Interviewer is speaking. Mic will reopen after the reply.");
      return;
    }

    if (voiceProcessingRef.current) {
      pauseCandidateMic("processing", "Processing what you said...");
      return;
    }

    resumeCandidateMic();
  }, [pauseCandidateMic, resumeCandidateMic, voiceState]);

  const handleCandidateVoiceTranscript = useCallback(async (text: string) => {
    const cleaned = normalizeTranscriptText(text);
    const activeSession = sessionRef.current;
    if (!cleaned || !activeSession || activeSession.status !== "in_progress") return;

    const key = transcriptKey("candidate", activeSession.currentQuestionIndex, cleaned);
    if (recordedTranscriptKeysRef.current.has(key)) return;
    recordedTranscriptKeysRef.current.add(key);
    setLastVoiceTranscript(cleaned);
    setVoiceInputDraft("");
    setMessage(cleaned);

    voiceProcessingRef.current = true;
    pauseCandidateMic("processing", "Processing what you said...");

    try {
      const data = await aiInterviewService.sendPublicMessage(token, cleaned);
      applyPublicState(data);
      setMessage("");

      const reply = getLatestAiMessageContent(data);
      if (!reply || !speakVoiceText(reply, { persist: false })) {
        resumeCandidateMic();
      }
    } catch (error: any) {
      recordedTranscriptKeysRef.current.delete(key);
      toast.error(error.message || "Failed to send voice response");
      resumeCandidateMic("I could not process that. Please try speaking again.");
    }
  }, [applyPublicState, pauseCandidateMic, resumeCandidateMic, speakVoiceText, token]);

  const handleVoiceEvent = useCallback((event: any) => {
    const type = event?.type;
    if (!type) return;

    if (type === "voice.proxy.ready") {
      setVoiceStatus("Voice mode is ready");
      return;
    }

    if (type === "voice.error" || type === "error") {
      setVoiceState("error");
      setVoiceStatus(event?.message || event?.error?.message || "Voice mode failed");
      finishAssistantSpeechVisual();
      return;
    }

    if (type === "session.updated") {
      if (!voiceAssistantSpeakingRef.current && !voiceProcessingRef.current) {
        resumeCandidateMic();
      }
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      if (!voiceAssistantSpeakingRef.current) {
        setVoiceStatus("Listening...");
        setVoiceInputDraft("");
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      if (browserSpeechSupportedRef.current) {
        setVoiceStatus("Finishing your transcript...");
      } else {
        voiceProcessingRef.current = true;
        pauseCandidateMic("processing", "Processing what you said...");
      }
      return;
    }

    if (type === "response.created" || type === "response.audio.delta") {
      voiceAssistantSpeakingRef.current = true;
      pauseCandidateMic("paused", "Interviewer is speaking. Mic is paused.");
      if (!assistantSpeechTextRef.current) {
        startAssistantSpeechVisual("Interviewer is speaking...");
      }
      return;
    }

    if (type === "response.audio.done" || type === "response.done") {
      finishAssistantSpeechVisual();
      window.setTimeout(() => {
        resumeCandidateMic();
      }, 600);
      return;
    }

    if (isCandidateTranscriptEvent(type)) {
      const transcript = getVoiceTranscriptText(event);
      if (transcript) {
        void handleCandidateVoiceTranscript(transcript);
      } else {
        resumeCandidateMic("I did not catch that. Please try again.");
      }
      return;
    }

    if (isAssistantTranscriptDeltaEvent(type)) {
      const id = event?.response_id || event?.item_id || "active";
      const delta = getVoiceTranscriptText(event);
      if (delta) {
        assistantTranscriptBufferRef.current[id] = `${assistantTranscriptBufferRef.current[id] || ""}${delta}`;
        const expectedText = assistantSpeechTextRef.current;
        if (expectedText) {
          const spokenLength = assistantTranscriptBufferRef.current[id].length;
          const progress = Math.min(98, Math.round((spokenLength / Math.max(expectedText.length, 1)) * 100));
          setAssistantSpeech((current) => (
            current.active && current.text === expectedText
              ? { ...current, progress: Math.max(current.progress, progress) }
              : current
          ));
        }
      }
      return;
    }

    if (isAssistantTranscriptDoneEvent(type)) {
      const id = event?.response_id || event?.item_id || "active";
      const transcript = getVoiceTranscriptText(event) || assistantTranscriptBufferRef.current[id] || "";
      delete assistantTranscriptBufferRef.current[id];
      if (transcript) {
        void recordAssistantVoiceTranscript(transcript);
      }
    }
  }, [finishAssistantSpeechVisual, handleCandidateVoiceTranscript, pauseCandidateMic, recordAssistantVoiceTranscript, resumeCandidateMic, startAssistantSpeechVisual]);

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
          setVoiceState("idle");
          setVoiceStatus("Voice connection closed");
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
      voiceMicWantedRef.current = true;
      setVoiceInputEnabled(false);
      setVoiceMicState("paused");
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        remoteAudioRef.current.srcObject = event.streams[0];
        void remoteAudioRef.current.play().catch(() => undefined);
      };

      const dataChannel = peerConnection.createDataChannel("voice-live-events");
      voiceDataChannelRef.current = dataChannel;
      dataChannel.onmessage = (event) => {
        const payload = parseVoiceMessage(event.data);
        if (payload) handleVoiceEvent(payload);
      };
      dataChannel.onopen = () => setVoiceStatus("Connected. The interviewer will speak first, then your mic will open.");

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
      pauseCandidateMic("paused", "Interviewer is getting ready. Mic will open after the prompt.");

      window.setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const prompt = stateOverride ? getLatestAiMessageContent(stateOverride) : stateRef.current ? getLatestAiMessageContent(stateRef.current) : "";
          if (prompt) startAssistantSpeechVisual(prompt);
          ws.send(JSON.stringify({ type: "voice.say_current_question" }));
        }
      }, 500);
    } catch (error: any) {
      cleanupVoice(error.message || "Voice mode failed");
      setVoiceState("error");
      toast.error(error.message || "Unable to start voice mode");
    }
  }, [cleanupVoice, handleVoiceEvent, pauseCandidateMic, session, setVoiceInputEnabled, startAssistantSpeechVisual, token, voiceEnabled]);

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
        let interimTranscript = "";
        let finalTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = event.results[index]?.[0]?.transcript || "";
          if (event.results[index]?.isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const draft = (interimTranscript || finalTranscript).trim();
        if (draft) {
          setVoiceInputDraft(draft);
          setMessage(draft);
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
    browserSpeechSupportedRef.current = Boolean(SpeechRecognition);
    setBrowserSpeechState(SpeechRecognition ? "off" : "unavailable");
  }, []);

  useEffect(() => {
    if (voiceState === "connected" && voiceMicState === "listening") {
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
    const ws = voiceWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || session?.status !== "in_progress") return;

    ws.send(JSON.stringify({ type: "voice.refresh_session" }));
    window.setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        voiceAssistantSpeakingRef.current = true;
        pauseCandidateMic("paused", "Interviewer is getting ready. Mic will open after the prompt.");
        const prompt = stateRef.current ? getLatestAiMessageContent(stateRef.current) : "";
        if (prompt) startAssistantSpeechVisual(prompt);
        ws.send(JSON.stringify({ type: "voice.say_current_question" }));
      }
    }, 500);
  }, [currentIndex, pauseCandidateMic, session?.status, startAssistantSpeechVisual, voiceState]);

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
        const reply = getLatestAiMessageContent(data);
        if (reply) speakVoiceText(reply, { persist: false });
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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/70">
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
      <div
        ref={layoutRef}
        style={layoutStyle}
        className="mx-auto grid max-w-screen-2xl gap-4 p-3 sm:p-4 md:p-6 xl:grid-cols-[var(--interview-rail-width)_12px_minmax(0,1fr)]"
      >
        <aside className={`space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)] xl:self-start xl:overflow-y-auto xl:pr-1 ${sidebarCollapsed ? "hidden xl:block" : ""}`}>
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
                  <div className="max-h-24 overflow-y-auto rounded-lg bg-white/80 p-2 text-xs leading-5">
                    {renderHighlightedSpeech(assistantSpeech.text, assistantHighlightedWords)}
                  </div>
                </div>
              )}
              {voiceInputDraft && voiceMicState === "listening" && (
                <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                  <span className="font-semibold">You are saying:</span> {voiceInputDraft}
                </div>
              )}
              {voiceState === "connected" && (
                <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  <span className="font-medium text-slate-900">Mic:</span>{" "}
                  {voiceMicState === "listening"
                    ? browserSpeechState === "listening"
                      ? "Open and transcribing. You can speak now."
                      : "Open. You can speak now."
                    : voiceMicState === "paused"
                      ? "Paused while the interviewer speaks."
                      : voiceMicState === "processing"
                        ? "Paused while your response is processed."
                        : "Off."}
                </div>
              )}
              {lastVoiceTranscript && (
                <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  <span className="font-medium text-slate-900">Last transcript:</span> {lastVoiceTranscript}
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

        <section className="min-w-0 min-h-[calc(100vh-24px)] overflow-hidden rounded-2xl border bg-white/95 shadow-xl shadow-slate-200/70 md:min-h-[calc(100vh-48px)]">
          {session.status !== "in_progress" ? (
            <div className="min-h-[calc(100vh-80px)] p-4 sm:p-6 lg:p-8">
              <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="border-b bg-slate-950 px-5 py-5 text-white sm:px-7">
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
                        <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-normal sm:text-4xl">
                          Get ready for your structured AI interview
                        </h2>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                          You will answer one question at a time. You can ask for clarification, then confirm when you are ready to move forward.
                        </p>
                      </div>
                      <div className="grid min-w-[220px] grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
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

                  <div className="space-y-5 p-5 sm:p-7">
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

                    <div className="rounded-2xl border bg-white p-5">
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

                    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
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

                  <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl">
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
                      {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : voiceEnabled ? <Mic className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                      {voiceEnabled ? "Start Interview & Turn Mic On" : "Start Interview"}
                    </Button>
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      Your answers are saved to the transcript as you go. You can still type if voice is unavailable.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100vh-24px)] min-h-[620px] flex-col md:h-[calc(100vh-48px)]">
              <div className="border-b bg-slate-950 p-4 text-white">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm text-slate-300">Question {currentIndex + 1} of {questionCount}</div>
                    <h2 className="text-lg font-semibold">Interview Workspace</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="bg-white text-slate-950 hover:bg-slate-100"
                      onClick={() => setSidebarCollapsed((value) => !value)}
                      aria-label={sidebarCollapsed ? "Show interview panel" : "Hide interview panel"}
                    >
                      {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    </Button>
                    <Badge className="w-fit border-white/20 bg-white/10 text-white">Confirm required to move on</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!voiceEnabled || voiceState === "connecting" || (voiceState === "connected" && (assistantSpeech.active || voiceMicState === "processing"))}
                      onClick={voiceState === "connected" ? toggleCandidateMic : () => connectVoice()}
                      className="bg-white text-slate-950 hover:bg-slate-100"
                    >
                      {voiceState === "connecting" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : voiceState === "connected" && voiceMicState === "listening" ? (
                        <MicOff className="mr-2 h-4 w-4" />
                      ) : (
                        <Mic className="mr-2 h-4 w-4" />
                      )}
                      {voiceState === "connected"
                        ? voiceMicState === "listening"
                          ? "Mute mic"
                          : micControlLabel
                        : "Voice"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 sm:p-4 md:p-5">
                {(session.messages || []).map((chat, index) => (
                  <div
                    key={chat._id || index}
                    className={`flex ${chat.role === "candidate" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[min(88%,780px)] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        chat.role === "candidate"
                          ? "bg-slate-950 text-white"
                          : "border bg-white text-slate-900"
                      }`}
                    >
                      <div className="mb-1 text-xs opacity-70">
                        {chat.role === "candidate" ? "You" : "Interviewer"}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {chat.role === "ai" && assistantSpeech.active && assistantSpeech.text === chat.content.trim()
                          ? renderHighlightedSpeech(chat.content, assistantHighlightedWords)
                          : chat.content}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="border-t bg-white p-4">
                {voiceState !== "idle" && (
                  <div className={`mb-3 rounded-xl border px-3 py-3 text-xs ${
                    voiceState === "connected"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : voiceState === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        {voiceState === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                        <span className="truncate">{voiceStatus}</span>
                      </div>
                      {voiceState === "connected" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={voiceMicState === "listening" ? "border-emerald-200 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-700"}>
                            {voiceMicState === "listening" ? "Mic open" : "Mic muted"}
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
                          <span className="font-semibold text-emerald-900">AI reading this response</span>
                          <span className="text-[11px] text-emerald-700">{Math.round(assistantSpeech.progress)}%</span>
                        </div>
                        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-emerald-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${assistantSpeech.progress}%` }} />
                        </div>
                        <div className="max-h-24 overflow-y-auto text-sm leading-6">
                          {renderHighlightedSpeech(assistantSpeech.text, assistantHighlightedWords)}
                        </div>
                      </div>
                    )}
                    {voiceInputDraft && voiceMicState === "listening" && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-white/80 p-3 text-blue-900">
                        <span className="font-semibold">Live transcript:</span> {voiceInputDraft}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Type your answer or ask for clarification..."
                    rows={3}
                    className="min-h-[92px] max-h-[240px] resize-y bg-slate-50"
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
                  The interview will auto-move when the question timer reaches zero. Voice answers are saved to the same transcript.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
