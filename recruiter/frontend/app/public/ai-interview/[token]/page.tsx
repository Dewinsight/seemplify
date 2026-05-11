"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Clock,
  FileQuestion,
  GripVertical,
  Loader2,
  Mic,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  ShieldCheck,
  TimerReset,
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

function getLatestAiMessageContent(data: PublicAIInterviewState) {
  const currentIndex = data.session.currentQuestionIndex;
  return [...(data.session.messages || [])]
    .reverse()
    .find((chat) => chat.role === "ai" && chat.questionIndex === currentIndex)
    ?.content?.trim() || "";
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
  const recordedTranscriptKeysRef = useRef<Set<string>>(new Set());
  const voiceMicWantedRef = useRef(false);
  const voiceAssistantSpeakingRef = useRef(false);
  const voiceProcessingRef = useRef(false);
  const sessionRef = useRef<PublicAIInterviewState["session"] | null>(null);

  const session = state?.session;
  const interview = state?.interview;
  const questionCount = interview?.questionCount || 0;
  const currentIndex = session?.currentQuestionIndex || 0;
  const progress = questionCount > 0 ? ((currentIndex + (session?.status === "completed" ? 1 : 0)) / questionCount) * 100 : 0;
  const voiceEnabled = Boolean(state?.voice?.enabled);
  const layoutStyle = {
    "--interview-rail-width": sidebarCollapsed ? "76px" : `${sidebarWidth}px`
  } as CSSProperties;

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

    assistantTranscriptBufferRef.current = {};
    voiceMicWantedRef.current = false;
    voiceAssistantSpeakingRef.current = false;
    voiceProcessingRef.current = false;
    setVoiceState("idle");
    setVoiceMicState("off");
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

  const speakVoiceText = useCallback((text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return false;

    voiceAssistantSpeakingRef.current = true;
    pauseCandidateMic("paused", "Interviewer is speaking. Mic is paused.");
    return sendVoiceCommand({ type: "voice.speak_text", text: cleaned });
  }, [pauseCandidateMic, sendVoiceCommand]);

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
    const cleaned = text.trim();
    const activeSession = sessionRef.current;
    if (!cleaned || !activeSession || activeSession.status !== "in_progress") return;

    const key = `candidate:${activeSession.currentQuestionIndex}:${cleaned}`;
    if (recordedTranscriptKeysRef.current.has(key)) return;
    recordedTranscriptKeysRef.current.add(key);
    setLastVoiceTranscript(cleaned);

    voiceProcessingRef.current = true;
    pauseCandidateMic("processing", "Processing what you said...");

    try {
      const data = await aiInterviewService.sendPublicMessage(token, cleaned);
      setState(data);

      const reply = getLatestAiMessageContent(data);
      if (!reply || !speakVoiceText(reply)) {
        resumeCandidateMic();
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to send voice response");
      resumeCandidateMic("I could not process that. Please try speaking again.");
    }
  }, [pauseCandidateMic, resumeCandidateMic, speakVoiceText, token]);

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
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      voiceProcessingRef.current = true;
      pauseCandidateMic("processing", "Processing what you said...");
      return;
    }

    if (type === "response.created" || type === "response.audio.delta") {
      voiceAssistantSpeakingRef.current = true;
      pauseCandidateMic("paused", "Interviewer is speaking. Mic is paused.");
      return;
    }

    if (type === "response.audio.done" || type === "response.done") {
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
      }
      return;
    }

    if (isAssistantTranscriptDoneEvent(type)) {
      const id = event?.response_id || event?.item_id || "active";
      delete assistantTranscriptBufferRef.current[id];
    }
  }, [handleCandidateVoiceTranscript, pauseCandidateMic, resumeCandidateMic]);

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
          ws.send(JSON.stringify({ type: "voice.say_current_question" }));
        }
      }, 500);
    } catch (error: any) {
      cleanupVoice(error.message || "Voice mode failed");
      setVoiceState("error");
      toast.error(error.message || "Unable to start voice mode");
    }
  }, [cleanupVoice, handleVoiceEvent, pauseCandidateMic, session, setVoiceInputEnabled, token, voiceEnabled]);

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    sessionRef.current = session || null;
  }, [session]);

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
      .then(setState)
      .catch((error) => toast.error(error.message || "Question timeout failed"))
      .finally(() => setTimeoutRunning(false));
  }, [questionSeconds, state, timeoutRunning, token]);

  useEffect(() => {
    if (voiceState !== "connected") return;
    const ws = voiceWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || session?.status !== "in_progress") return;

    ws.send(JSON.stringify({ type: "voice.refresh_session" }));
    window.setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        voiceAssistantSpeakingRef.current = true;
        pauseCandidateMic("paused", "Interviewer is getting ready. Mic will open after the prompt.");
        ws.send(JSON.stringify({ type: "voice.say_current_question" }));
      }
    }, 500);
  }, [currentIndex, pauseCandidateMic, session?.status, voiceState]);

  const answeredIndexes = useMemo(() => {
    return new Set((session?.answers || []).filter((answer) => answer.status !== "draft").map((answer) => answer.questionIndex));
  }, [session?.answers]);

  const start = async () => {
    setStarting(true);
    try {
      const data = await aiInterviewService.startPublic(token);
      setState(data);
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
                  <div className="font-semibold text-white">{Math.min(currentIndex + 1, questionCount)}</div>
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
                    disabled={voiceMicState === "paused" || voiceMicState === "processing"}
                    onClick={toggleCandidateMic}
                  >
                    {voiceMicState === "listening" ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {voiceMicState === "listening" ? "Mute mic" : "Turn mic on"}
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
                  {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : voiceEnabled ? <Mic className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  {voiceEnabled ? "Start Interview & Turn Mic On" : "Start Interview"}
                </Button>
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
                      disabled={!voiceEnabled || voiceState === "connecting" || (voiceState === "connected" && (voiceMicState === "paused" || voiceMicState === "processing"))}
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
                          : voiceMicState === "paused"
                            ? "AI speaking"
                            : voiceMicState === "processing"
                              ? "Processing"
                              : "Turn mic on"
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
                      <div className="whitespace-pre-wrap">{chat.content}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="border-t bg-white p-4">
                {voiceState !== "idle" && (
                  <div className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    voiceState === "connected"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : voiceState === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}>
                    {voiceState === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                    <span>{voiceStatus}</span>
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
