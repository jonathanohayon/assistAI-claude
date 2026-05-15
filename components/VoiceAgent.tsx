"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transportFor } from "@/lib/realtime";
import {
  defaultVoiceForCatalog,
  useRealtimeCatalog,
  voicesForCatalog,
} from "@/lib/use-realtime-catalog";

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

// Modèles autorisés sur la demo publique. On masque le reste du catalog
// OpenAI (admin uniquement) et on les présente sous des noms "marque"
// pour ne pas exposer la techno sous-jacente aux visiteurs.
// Mapping id OpenAI → label visible. L'ID réel reste envoyé à OpenAI.
const DEMO_MODEL_ALLOWLIST: Record<string, string> = {
  "gpt-realtime-2": "tamara-realtime-2",
  "gpt-realtime-mini-2025-12-15": "tamara-realtime-1",
};
// Ordre d'affichage (le plus avancé en premier).
const DEMO_MODEL_ORDER = [
  "gpt-realtime-2",
  "gpt-realtime-mini-2025-12-15",
] as const;
const DEMO_DEFAULT_MODEL = "gpt-realtime-2";

export default function VoiceAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const catalog = useRealtimeCatalog();
  const [model, setModel] = useState<string>(DEMO_DEFAULT_MODEL);
  const [voice, setVoice] = useState<string>(
    defaultVoiceForCatalog(catalog, DEMO_DEFAULT_MODEL),
  );
  // null = pas de timer en cours, sinon secondes restantes (décrémente à 1Hz).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [demoEnded, setDemoEnded] = useState(false);
  // Awaiting assistant response : true entre la fin transcription user et
  // l'arrivée du transcript assistant. Drive l'indicateur typing 3-dots.
  const [awaitingResponse, setAwaitingResponse] = useState(false);

  // Liste filtrée pour le dropdown public : uniquement les modèles de la
  // allowlist, dans l'ordre défini. On garde l'ID OpenAI réel mais on
  // affiche le label "tamara-realtime-X" pour ne pas exposer la techno.
  const demoModels = useMemo(
    () =>
      DEMO_MODEL_ORDER.map((id) => ({
        id: id as string,
        label: DEMO_MODEL_ALLOWLIST[id] ?? id,
      })),
    [],
  );
  const allowedModelIds = useMemo<string[]>(
    () => demoModels.map((m) => m.id),
    [demoModels],
  );

  const availableVoices = useMemo(
    () => voicesForCatalog(catalog, model),
    [catalog, model],
  );
  const transport = useMemo(() => transportFor(model), [model]);
  const isUnsupported = transport !== "webrtc";

  // Restore last selection from localStorage. Si la valeur stockée
  // n'est plus dans l'allowlist (ancien visiteur qui avait choisi un
  // modèle maintenant masqué), on fallback au default demo.
  /* eslint-disable react-hooks/set-state-in-effect -- legitimate browser-API sync (no SSR access to localStorage) */
  useEffect(() => {
    const m = localStorage.getItem(STORAGE_MODEL);
    const v = localStorage.getItem(STORAGE_VOICE);
    const validModel =
      m && allowedModelIds.includes(m) ? m : DEMO_DEFAULT_MODEL;
    const allowed = voicesForCatalog(catalog, validModel);
    const validVoice =
      v && allowed.includes(v)
        ? v
        : defaultVoiceForCatalog(catalog, validModel);
    setModel(validModel);
    setVoice(validVoice);
  }, [allowedModelIds, catalog]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pcRef       = useRef<RTCPeerConnection | null>(null);
  const dcRef       = useRef<RTCDataChannel | null>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingCalls = useRef<Map<string, string>>(new Map()); // call_id → function_name
  const stopSessionRef = useRef<() => void>(() => {});

  // Auto-scroll vers le bas à chaque nouvelle entrée transcript pour suivre
  // la conversation live sans avoir à scroller à la main.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

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
        setAwaitingResponse(false);
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
        setAwaitingResponse(false);
      }

      // Transcript: user speech
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = event.transcript as string;
        if (text) {
          setTranscript((prev) => [...prev, { role: "user", text }]);
        }
        setAwaitingResponse(true);
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

      // 4. Microphone — noise reduction layered (browser + OpenAI near_field
      //    via /api/session). Active aussi sur la démo landing publique.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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
    setIsMuted(false);
    setSecondsLeft(null);
    setAwaitingResponse(false);
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
    connecting: "Connexion…",
    connected: "En ligne — parlez",
    error: "Erreur",
  };

  const statusDotClass: Record<Status, string> = {
    idle: "bg-[#22d3ee]",
    connecting: "bg-[#f59e0b] motion-safe:animate-pulse",
    connected: "bg-[#22d3ee] motion-safe:animate-pulse",
    error: "bg-[#dc2626]",
  };

  // Pill du header — couleur dépend du status pour pas mentir au user.
  const pillTone: Record<Status, { bg: string; text: string; ring: string }> = {
    idle: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    connecting: { bg: "bg-[#fef3c7]", text: "text-[#92400e]", ring: "ring-[#f59e0b]/40" },
    connected: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    error: { bg: "bg-[#fee2e2]", text: "text-[#991b1b]", ring: "ring-[#dc2626]/40" },
  };

  const isLive = status === "connecting" || status === "connected";

  // Renvoie l'heure courante (HH:MM) pour les bulles transcript. On la
  // calcule au render — pas critique d'être figée par message ici, vu que
  // c'est un live test 40s et le user voit la convo se construire.
  const nowHHMM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const onModelChange = (m: string) => {
    setModel(m);
    localStorage.setItem(STORAGE_MODEL, m);
    const allowed = voicesForCatalog(catalog, m);
    if (!allowed.includes(voice)) {
      const v = defaultVoiceForCatalog(catalog, m);
      setVoice(v);
      localStorage.setItem(STORAGE_VOICE, v);
    }
  };

  const onVoiceChange = (v: string) => {
    setVoice(v);
    localStorage.setItem(STORAGE_VOICE, v);
  };

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] border border-white/50 p-7 shadow-[0_8px_40px_-12px_rgba(14,116,144,0.25)] backdrop-blur-xl sm:p-10"
      style={{
        backgroundColor: "#ffffff",
        backgroundImage: `
          radial-gradient(at 12% 100%, rgba(34, 211, 238, 0.18) 0px, transparent 50%),
          radial-gradient(at 90% 10%, rgba(236, 72, 153, 0.15) 0px, transparent 55%),
          radial-gradient(at 50% 50%, rgba(255, 255, 255, 0.6) 0px, transparent 60%)
        `,
      }}
    >
      {/* Keyframes scopés `va-` pour éviter toute collision avec
          .ltp-ripple-ring (LiveTestPanel) si les deux composants se
          retrouvent montés sur la même page un jour. */}
      <style>{`
        @keyframes va-ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .va-ripple-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid #22d3ee;
          pointer-events: none;
          animation: va-ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .va-ripple-ring--2 { animation-delay: 0.8s; }
        .va-ripple-ring--3 { animation-delay: 1.6s; }
        @media (prefers-reduced-motion: reduce) {
          .va-ripple-ring { animation: none; }
        }
      `}</style>

      {/* Blob décoratif coin opposé — pour ne pas avoir un coin trop nu */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#22d3ee]/20 to-transparent blur-3xl"
      />

      {/* Header : barre gradient + titre/subtitle + pill statut */}
      <div className="relative mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-[#22d3ee] to-[#0e7490]" />
          <div className="min-w-0">
            <h2 className="text-2xl font-extrabold tracking-tight text-[#18181b] sm:text-3xl">
              Tester en direct
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              Parlez à Tamara depuis votre navigateur — démo gratuite 40s.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset ${pillTone[status].bg} ${pillTone[status].text} ${pillTone[status].ring}`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {status !== "error" && (
                <span
                  aria-hidden
                  className={`absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping ${statusDotClass[status]}`}
                />
              )}
              <span
                aria-hidden
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${statusDotClass[status]}`}
              />
            </span>
            {statusLabel[status]}
          </span>
        </div>
      </div>

      {/* Model / voice picker — gardés mais relookés pour s'intégrer */}
      <div className="relative mb-6 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold uppercase tracking-wider text-[#0e7490]/80 text-[10px]">
            Modèle
          </span>
          <select
            value={model}
            disabled={isLive}
            onChange={(e) => onModelChange(e.target.value)}
            className="rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 text-sm text-[#18181b] shadow-xs backdrop-blur transition-colors hover:border-[#22d3ee]/50 focus:border-[#22d3ee] focus:outline-none focus:ring-2 focus:ring-[#22d3ee]/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {demoModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold uppercase tracking-wider text-[#0e7490]/80 text-[10px]">
            Voix
          </span>
          <select
            value={voice}
            disabled={isLive}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 text-sm text-[#18181b] shadow-xs backdrop-blur transition-colors hover:border-[#22d3ee]/50 focus:border-[#22d3ee] focus:outline-none focus:ring-2 focus:ring-[#22d3ee]/30 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="relative mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
          role="alert"
        >
          Transport {transport.toUpperCase()} non implémenté côté client. La connexion échouera.
        </p>
      )}

      <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[auto_1fr]">
        {/* ─── COLONNE MIC ────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-44 w-44 items-center justify-center">
            {/* Ripple rings cyan concentriques stagger 0/0.8/1.6s */}
            <span aria-hidden className="va-ripple-ring" />
            <span aria-hidden className="va-ripple-ring va-ripple-ring--2" />
            <span aria-hidden className="va-ripple-ring va-ripple-ring--3" />

            <button
              type="button"
              onClick={status === "idle" || status === "error" ? startSession : stopSession}
              disabled={status === "connecting"}
              aria-label={isLive ? "Arrêter l'appel" : "Démarrer l'appel"}
              className={`group relative inline-flex h-36 w-36 items-center justify-center rounded-full text-white shadow-[0_12px_48px_-8px_rgba(14,116,144,0.65)] transition-transform duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80 ${
                status === "connecting"
                  ? "bg-gradient-to-br from-[#f59e0b] to-[#b45309]"
                  : status === "connected"
                    ? "bg-gradient-to-br from-[#dc2626] to-[#991b1b] hover:scale-[1.06] active:scale-95"
                    : "bg-gradient-to-br from-[#06b6d4] to-[#0e7490] hover:scale-[1.06] active:scale-95"
              }`}
            >
              <span className="sr-only">
                {isLive ? "Arrêter l'appel" : "Démarrer l'appel"}
              </span>
              {/* Halo cyan/rouge selon état — toujours présent */}
              <span
                aria-hidden
                className={`absolute inset-0 -z-10 rounded-full blur-2xl motion-safe:animate-pulse ${
                  status === "connected"
                    ? "bg-[#dc2626] opacity-40"
                    : "bg-[#22d3ee] opacity-45"
                }`}
              />
              {/* Halo rose en décalé — double respiration */}
              <span
                aria-hidden
                className="absolute inset-0 -z-10 rounded-full bg-[#ec4899] opacity-25 blur-3xl motion-safe:animate-pulse"
                style={{ animationDelay: "700ms" }}
              />
              {/* Inner subtle glow on hover */}
              <span
                aria-hidden
                className="absolute inset-2 rounded-full bg-gradient-to-br from-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />

              {status === "connecting" ? (
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-12 w-12 motion-safe:animate-spin"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : isLive ? (
                <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-12 w-12">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-14 w-14">
                  <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
                  <path
                    d="M5 11a7 7 0 0 0 14 0M12 18v3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          </div>

          <p className="max-w-[180px] text-center text-xs font-medium leading-relaxed text-[#475569]">
            {isLive
              ? "Parlez, ou cliquez pour arrêter"
              : "Clique et parle pour tester Tamara"}
          </p>

          {/* Badge bas — switche entre "40s gratuit" et le timer live */}
          {secondsLeft != null && secondsLeft > 0 ? (
            <span
              role="timer"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold tabular-nums ring-1 ring-inset transition-colors ${
                secondsLeft <= 10
                  ? "bg-[#fee2e2] text-[#991b1b] ring-[#dc2626]/40"
                  : "bg-white/70 text-[#0e7490] ring-[#22d3ee]/40"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="font-mono">
                00:{String(secondsLeft).padStart(2, "0")}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[10px] font-medium text-[#475569] ring-1 ring-inset ring-[#e2e8f0]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Session de 40s · gratuit
            </span>
          )}

          {/* Bouton mute — uniquement quand live */}
          {status === "connected" && (
            <button
              type="button"
              onClick={toggleMute}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                isMuted
                  ? "bg-[#18181b] text-white"
                  : "bg-white/80 text-[#475569] ring-1 ring-inset ring-[#e2e8f0] hover:bg-white"
              }`}
            >
              {isMuted ? "Micro coupé" : "Couper le micro"}
            </button>
          )}
        </div>

        {/* ─── COLONNE TRANSCRIPT ────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Aperçu de conversation
          </p>
          <div
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-label="Transcript"
            className="scroll-visible flex max-h-80 min-h-[200px] flex-col gap-2.5 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white/80 p-4 backdrop-blur"
          >
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-[#dc2626]/30 bg-[#fee2e2] px-3 py-2 text-xs text-[#991b1b]"
              >
                {error}
              </p>
            )}

            {demoEnded && (
              <p
                role="status"
                className="rounded-lg border border-[#f59e0b]/40 bg-[#fef3c7] px-3 py-2 text-[11px] leading-snug text-[#92400e]"
              >
                Session de démo terminée ({DEMO_SESSION_SECONDS}s).{" "}
                <a href="/signup" className="font-semibold underline hover:no-underline">
                  Crée un compte
                </a>{" "}
                pour passer/recevoir des appels sans limite.
              </p>
            )}

            {transcript.length === 0 && !error && !demoEnded ? (
              <p className="m-auto text-center text-xs leading-snug text-[#94a3b8]">
                {isLive
                  ? "En écoute… Parlez à Tamara."
                  : "Cliquez sur le mic pour démarrer un appel de démo."}
              </p>
            ) : (
              transcript.map((entry, i) => (
                <BubbleV2
                  key={i}
                  who={entry.role}
                  text={entry.text}
                  time={nowHHMM()}
                />
              ))
            )}

            {/* Typing indicator — 3 dots qui bouncent en stagger */}
            {(status === "connecting" || awaitingResponse) && (
              <div className="flex items-center gap-2 pt-1">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0891b2] to-[#0e7490] text-[10px] font-bold text-white ring-2 ring-white"
                >
                  T
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-3 py-1.5">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * AmbientDemo — fake conversation qui se joue toute seule en boucle quand
 * la session WebRTC est idle. Donne envie de cliquer "Démarrer". Reset
 * toutes les ~12s. Désactivé en prefers-reduced-motion (affiche juste un
 * snapshot statique du dernier état).
 */
const AMBIENT_SCRIPT = [
  { who: "user" as const, text: "Bonjour, je voudrais prendre rendez-vous." },
  { who: "assistant" as const, text: "Bien sûr ! Pour quel jour ?" },
  { who: "user" as const, text: "Demain matin si possible." },
  { who: "assistant" as const, text: "10h30 avec Sarah ? Ça vous convient ?" },
];

function AmbientDemo() {
  const [shown, setShown] = useState<number>(0);

  useEffect(() => {
    let idx = 0;
    const tick = () => {
      idx += 1;
      if (idx > AMBIENT_SCRIPT.length) {
        idx = 0;
      }
      setShown(idx);
    };
    setShown(0);
    const interval = setInterval(tick, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Hint badge en haut — donne le contexte "demo" */}
      <div className="mb-1 flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]/70">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-[#22d3ee] opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
        </span>
        Exemple de conversation
      </div>
      {AMBIENT_SCRIPT.slice(0, shown).map((entry, i) => (
        <motion.div
          key={`${shown}-${i}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <BubbleV2 who={entry.who} text={entry.text} time={ambientTime(i)} />
        </motion.div>
      ))}
      {shown < AMBIENT_SCRIPT.length && (
        <div className="flex items-center gap-2 pt-1">
          <span
            aria-hidden
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white ${
              AMBIENT_SCRIPT[shown]?.who === "user"
                ? "bg-gradient-to-br from-[#be185d] to-[#9d174d]"
                : "bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
            }`}
          >
            {AMBIENT_SCRIPT[shown]?.who === "user" ? "M" : "T"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-[#0e7490] motion-safe:animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
        </div>
      )}
    </div>
  );
}

// Génère un timestamp pseudo (incrément 1min) pour la fake demo.
function ambientTime(i: number): string {
  const base = new Date();
  base.setMinutes(base.getMinutes() - (AMBIENT_SCRIPT.length - i));
  return `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`;
}

/**
 * Bubble v2 — avatar circulaire + timestamp + bulle gradient.
 * Burgundy pour le user (M = Moi), cyan/teal pour l'assistante (T = Tamara).
 * Hérité du visuel LiveTestPanel pour cohérence cross-app.
 */
function BubbleV2({
  who,
  text,
  time,
}: {
  who: "user" | "assistant";
  text: string;
  time: string;
}) {
  const isUser = who === "user";
  return (
    <div
      className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-white ${
          isUser
            ? "bg-gradient-to-br from-[#be185d] to-[#9d174d]"
            : "bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
        }`}
        aria-hidden
      >
        {isUser ? "M" : "T"}
      </span>

      <div
        className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}
      >
        <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-[#94a3b8]">
          {isUser ? "Vous" : "Tamara"} · {time}
        </span>
        <div
          className={`mt-0.5 rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${
            isUser
              ? "rounded-br-md bg-gradient-to-br from-[#be185d] to-[#9d174d] text-white"
              : "rounded-bl-md bg-gradient-to-br from-[#ecfeff] to-white text-[#18181b] ring-1 ring-inset ring-[#22d3ee]/30"
          }`}
        >
          <span className="sr-only">{isUser ? "Vous : " : "Tamara : "}</span>
          {text}
        </div>
      </div>
    </div>
  );
}
