"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_REALTIME_MODEL,
  REALTIME_MODELS,
  defaultVoiceFor,
  transportFor,
  voicesFor,
} from "@/lib/realtime";

type Status = "idle" | "connecting" | "connected" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

const STORAGE_MODEL = "tamara:model";
const STORAGE_VOICE = "tamara:voice";

// Public landing demo : capped session duration so anonymous visitors can
// try the agent but can't burn unlimited Realtime API budget. After this
// many seconds the session auto-disconnects with a "demo terminée" UX.
const DEMO_SESSION_SECONDS = 40;

export default function VoiceAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_REALTIME_MODEL);
  const [voice, setVoice] = useState<string>(defaultVoiceFor(DEFAULT_REALTIME_MODEL));
  // null = pas de timer en cours, sinon secondes restantes (décrémente à 1Hz).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [demoEnded, setDemoEnded] = useState(false);

  const modelIds = useMemo(() => REALTIME_MODELS.map((m) => m.id), []);
  const availableVoices = useMemo(() => voicesFor(model), [model]);
  const transport = useMemo(() => transportFor(model), [model]);
  const isUnsupported = transport !== "webrtc";

  // Restore last selection from localStorage on mount.
  /* eslint-disable react-hooks/set-state-in-effect -- legitimate browser-API sync (no SSR access to localStorage) */
  useEffect(() => {
    const m = localStorage.getItem(STORAGE_MODEL);
    const v = localStorage.getItem(STORAGE_VOICE);
    const validModel = m && modelIds.includes(m) ? m : DEFAULT_REALTIME_MODEL;
    const allowed = voicesFor(validModel);
    const validVoice = v && allowed.includes(v) ? v : defaultVoiceFor(validModel);
    setModel(validModel);
    setVoice(validVoice);
  }, [modelIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pcRef       = useRef<RTCPeerConnection | null>(null);
  const dcRef       = useRef<RTCDataChannel | null>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const pendingCalls = useRef<Map<string, string>>(new Map()); // call_id → function_name
  const stopSessionRef = useRef<() => void>(() => {});

  // ── Tool execution ────────────────────────────────────────────────────────

  const executeTool = useCallback(async (name: string, args: Record<string, unknown>, callId: string) => {
    let result: unknown;
    let shouldHangUp = false;

    try {
      if (name === "check_availability") {
        const res = await fetch("/api/calendar/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        result = await res.json();
      } else if (name === "book_appointment") {
        const res = await fetch("/api/calendar/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        result = await res.json();
      } else if (name === "save_contact") {
        const res = await fetch("/api/sheets/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        result = await res.json();
      } else if (name === "end_call") {
        result = { success: true, ended: true, reason: args.reason ?? "completed" };
        shouldHangUp = true;
      } else {
        result = { error: `Outil inconnu: ${name}` };
      }
    } catch (e) {
      result = { error: e instanceof Error ? e.message : "Erreur réseau" };
    }

    if (!dcRef.current || dcRef.current.readyState !== "open") return;

    dcRef.current.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      })
    );

    if (shouldHangUp) {
      // Give the agent a beat to flush its closing audio, then tear down.
      setTimeout(() => stopSessionRef.current(), 1500);
      return;
    }

    dcRef.current.send(JSON.stringify({ type: "response.create" }));
  }, []);

  // ── Data channel event handler ────────────────────────────────────────────

  const handleDataChannelMessage = useCallback(
    (ev: MessageEvent) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }

      const type = event.type as string;

      if (type === "error") {
        console.error("[realtime] error event", event);
        setError(`Realtime: ${JSON.stringify(event.error ?? event)}`);
        return;
      }

      // Accumulate function call arguments
      if (type === "response.output_item.added") {
        const item = event.item as Record<string, unknown>;
        if (item?.type === "function_call") {
          pendingCalls.current.set(item.call_id as string, item.name as string);
        }
      }

      if (type === "response.function_call_arguments.done") {
        const callId   = event.call_id as string;
        const funcName = pendingCalls.current.get(callId) ?? "";
        const argsStr  = event.arguments as string;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(argsStr); } catch { /* ignore */ }
        pendingCalls.current.delete(callId);
        executeTool(funcName, args, callId);
      }

      // Transcript: assistant text
      if (type === "response.audio_transcript.done") {
        const text = event.transcript as string;
        if (text) {
          setTranscript((prev) => [...prev, { role: "assistant", text }]);
        }
      }

      // Transcript: user speech
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = event.transcript as string;
        if (text) {
          setTranscript((prev) => [...prev, { role: "user", text }]);
        }
      }
    },
    [executeTool]
  );

  // ── Start session ─────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setError(null);
    setDemoEnded(false);
    setTranscript([]);

    if (transport !== "webrtc") {
      setStatus("error");
      setError(
        `Le modèle ${model} requiert un transport ${transport.toUpperCase()} non encore implémenté côté client.`,
      );
      return;
    }

    setStatus("connecting");

    try {
      // 1. Get ephemeral token (model/voice picked client-side, validated server-side)
      const tokenRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice }),
      });
      if (!tokenRes.ok) throw new Error("Impossible d'obtenir le token de session");
      const tokenData = await tokenRes.json();
      const ephemeralKey = tokenData.value;
      // Server echoes `model` directly; fall back to OpenAI's `session.model` shape.
      const sessionModel = tokenData.model ?? tokenData.session?.model;
      const webrtcUrl = tokenData.webrtc_url;
      if (!ephemeralKey) throw new Error("Token invalide");
      if (!sessionModel) throw new Error("Modèle absent de la session");
      if (!webrtcUrl) throw new Error("URL WebRTC absente");

      // 2. Set up peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Remote audio → <audio> element
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };

      // 4. Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // 5. Data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

      // 6. SDP offer → OpenAI
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `${webrtcUrl}?model=${encodeURIComponent(sessionModel)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        const txt = await sdpRes.text();
        throw new Error(`OpenAI WebRTC: ${txt}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      dc.onopen = () => {
        setStatus("connected");
        // Démarrer le countdown de session démo dès que le canal est ouvert.
        setSecondsLeft(DEMO_SESSION_SECONDS);
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "Salue l'appelant en français : 'Bonjour, Tamara à votre écoute, comment puis-je vous aider ?' Si l'appelant répond en hébreu, bascule en hébreu.",
            },
          })
        );
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStatus("error");
          setError("Connexion perdue");
        }
      };
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }, [handleDataChannelMessage, model, voice, transport]);

  // ── Stop session ──────────────────────────────────────────────────────────

  const stopSession = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    dcRef.current  = null;
    pcRef.current  = null;
    streamRef.current = null;
    setStatus("idle");
    setSecondsLeft(null);
  }, []);

  // Countdown : décrémente secondsLeft à 1Hz, déclenche stopSession à 0.
  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) {
      setDemoEnded(true);
      stopSession();
      return;
    }
    const id = setInterval(() => {
      setSecondsLeft((s) => (s == null ? null : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft, stopSession]);

  const toggleMute = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.enabled = isMuted;
    });
    setIsMuted((m) => !m);
  }, [isMuted]);

  useEffect(() => {
    stopSessionRef.current = stopSession;
  }, [stopSession]);

  useEffect(() => () => stopSession(), [stopSession]);

  // ── UI ────────────────────────────────────────────────────────────────────

  const statusLabel: Record<Status, string> = {
    idle: "Prêt",
    connecting: "Connexion en cours…",
    connected: "En ligne — parlez",
    error: "Erreur",
  };

  const statusDotClass: Record<Status, string> = {
    idle: "bg-[var(--color-muted-foreground)]/40",
    connecting: "bg-[var(--color-warning)] animate-pulse",
    connected: "bg-[var(--color-success)] animate-pulse",
    error: "bg-[var(--color-destructive)]",
  };

  const isLive = status === "connecting" || status === "connected";

  const onModelChange = (m: string) => {
    setModel(m);
    localStorage.setItem(STORAGE_MODEL, m);
    const allowed = voicesFor(m);
    if (!allowed.includes(voice)) {
      const v = defaultVoiceFor(m);
      setVoice(v);
      localStorage.setItem(STORAGE_VOICE, v);
    }
  };

  const onVoiceChange = (v: string) => {
    setVoice(v);
    localStorage.setItem(STORAGE_VOICE, v);
  };

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Model / voice picker */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-[var(--color-muted-foreground)]">Modèle</span>
          <select
            value={model}
            disabled={isLive}
            onChange={(e) => onModelChange(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {REALTIME_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-[var(--color-muted-foreground)]">Voix</span>
          <select
            value={voice}
            disabled={isLive}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {availableVoices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isUnsupported && (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
          role="alert"
        >
          Transport {transport.toUpperCase()} non implémenté côté client. La connexion échouera.
        </p>
      )}

      {error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {demoEnded && (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800"
          role="status"
        >
          ⏰ Session de démo terminée ({DEMO_SESSION_SECONDS}s).{" "}
          <a href="/signup" className="font-semibold underline hover:no-underline">
            Crée un compte
          </a>{" "}
          pour passer/recevoir des appels sans limite.
        </p>
      )}

      {/* Countdown banner (active uniquement pendant la session démo) */}
      {secondsLeft != null && secondsLeft > 0 && (
        <div
          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium tabular-nums transition-colors ${
            secondsLeft <= 10
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-[var(--color-border)] bg-white/60 text-[var(--color-muted-foreground)]"
          }`}
          role="timer"
          aria-live="polite"
        >
          <span>⏱️ Démo</span>
          <span className="font-mono">
            00:{String(secondsLeft).padStart(2, "0")}
          </span>
        </div>
      )}

      {/* Mic button */}
      <div className="flex flex-col items-center gap-3 py-2">
        <button
          onClick={status === "idle" || status === "error" ? startSession : stopSession}
          disabled={status === "connecting"}
          aria-label={isLive ? "Arrêter l'appel" : "Démarrer l'appel"}
          className={`relative inline-flex h-20 w-20 items-center justify-center rounded-full text-white shadow-md transition-all duration-200 disabled:cursor-not-allowed
            ${
              status === "idle" || status === "error"
                ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] hover:scale-[1.04] hover:shadow-lg active:scale-95"
                : status === "connecting"
                ? "bg-[var(--color-warning)]/80"
                : "bg-gradient-to-br from-[var(--color-destructive)] to-[#a21717] hover:scale-[1.02] active:scale-95"
            }`}
        >
          {status === "connecting" ? (
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 animate-spin">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : isLive ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
              <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {status === "connected" && (
            <span className="absolute inset-0 -z-10 rounded-full bg-[var(--color-primary)] opacity-30 motion-safe:animate-ping" />
          )}
        </button>

        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-muted)] px-3 py-1 text-xs font-medium text-[var(--color-foreground)]">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass[status]}`} />
          {statusLabel[status]}
        </div>

        {status === "connected" && (
          <button
            onClick={toggleMute}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              isMuted
                ? "bg-[var(--color-foreground)] text-white"
                : "bg-white text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
            }`}
          >
            {isMuted ? "Micro coupé" : "Couper le micro"}
          </button>
        )}
      </div>

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
          {transcript.map((entry, i) => (
            <div
              key={i}
              className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  entry.role === "user"
                    ? "bg-[var(--color-primary)] text-white rounded-br-md"
                    : "bg-white text-[var(--color-foreground)] border border-[var(--color-border)] rounded-bl-md"
                }`}
              >
                {entry.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
