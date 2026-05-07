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

const STORAGE_MODEL = "assist-ai:model";
const STORAGE_VOICE = "assist-ai:voice";

export default function VoiceAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_REALTIME_MODEL);
  const [voice, setVoice] = useState<string>(defaultVoiceFor(DEFAULT_REALTIME_MODEL));

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

  // ── Tool execution ────────────────────────────────────────────────────────

  const executeTool = useCallback(async (name: string, args: Record<string, unknown>, callId: string) => {
    let result: unknown;

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
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "Salue l'appelant en français : 'Bonjour, AssistAI à votre écoute, comment puis-je vous aider ?' Si l'appelant répond en hébreu, bascule en hébreu.",
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
  }, []);

  const toggleMute = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.enabled = isMuted;
    });
    setIsMuted((m) => !m);
  }, [isMuted]);

  useEffect(() => () => stopSession(), [stopSession]);

  // ── UI ────────────────────────────────────────────────────────────────────

  const statusLabel: Record<Status, string> = {
    idle:       "Appuyez pour démarrer",
    connecting: "Connexion en cours…",
    connected:  "En ligne — parlez maintenant",
    error:      "Erreur de connexion",
  };

  const statusColor: Record<Status, string> = {
    idle:       "bg-zinc-200 text-zinc-700",
    connecting: "bg-yellow-100 text-yellow-700",
    connected:  "bg-green-100 text-green-700",
    error:      "bg-red-100 text-red-700",
  };

  const isLive = status === "connecting" || status === "connected";

  const onModelChange = (m: string) => {
    setModel(m);
    localStorage.setItem(STORAGE_MODEL, m);
    // If the new provider doesn't support the current voice, snap to its default.
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
    <div className="flex flex-col items-center gap-6 w-full max-w-lg mx-auto">
      {/* Model / voice picker */}
      <div className="grid grid-cols-2 gap-3 w-full">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Modèle
          <select
            value={model}
            disabled={isLive}
            onChange={(e) => onModelChange(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
          >
            {REALTIME_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
          {isUnsupported && (
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-snug">
              ⚠ Transport {transport.toUpperCase()} — non implémenté côté client. La connexion échouera.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Voix
          <select
            value={voice}
            disabled={isLive}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
          >
            {availableVoices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Status badge */}
      <span className={`px-4 py-1 rounded-full text-sm font-medium ${statusColor[status]}`}>
        {statusLabel[status]}
      </span>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2 text-center">
          {error}
        </p>
      )}

      {/* Main button */}
      <button
        onClick={status === "idle" || status === "error" ? startSession : stopSession}
        disabled={status === "connecting"}
        className={`relative w-24 h-24 rounded-full shadow-lg transition-all duration-200 flex items-center justify-center text-white text-3xl
          ${status === "idle" || status === "error"
            ? "bg-blue-600 hover:bg-blue-700 active:scale-95"
            : status === "connecting"
            ? "bg-yellow-400 cursor-not-allowed"
            : "bg-red-500 hover:bg-red-600 active:scale-95"}
        `}
      >
        {status === "connecting" ? (
          <span className="animate-spin text-2xl">⟳</span>
        ) : status === "connected" ? (
          "⏹"
        ) : (
          "🎙"
        )}
        {status === "connected" && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-30" />
        )}
      </button>

      {/* Mute button (only when connected) */}
      {status === "connected" && (
        <button
          onClick={toggleMute}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            isMuted
              ? "bg-zinc-700 text-white"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
          }`}
        >
          {isMuted ? "🔇 Micro coupé" : "🎤 Couper le micro"}
        </button>
      )}

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="w-full bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 max-h-72 overflow-y-auto flex flex-col gap-3">
          {transcript.map((entry, i) => (
            <div
              key={i}
              className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  entry.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-zinc-100 text-zinc-800 rounded-bl-sm"
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
