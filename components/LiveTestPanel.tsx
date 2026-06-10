"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildResponseCreate,
  type RealtimeErrorTriage,
  triageRealtimeError,
} from "@/lib/realtime-events";

// Same demo cap as the public landing page widget — both client-side
// realtime sessions are capped to keep API spend bounded for free/trial
// usage (paid users hit the SIP/Twilio path which is metered separately).
const DEMO_SESSION_SECONDS = 40;

type Status = "idle" | "connecting" | "connected" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  /** true tant qu'on reçoit des deltas (streaming en cours) ; absent ou
   *  false quand la bulle est finalisée (event .done/.completed reçu). */
  streaming?: boolean;
}

interface LiveTestPanelProps {
  model: string;
  voice: string;
  instructions: string;
  greetingInstructions: string;
  temperature: number;
  speed: number;
  /** Réactivité 1-10 (sera mappée VAD silence_duration_ms côté /api/session).
   *  Default 5 si non fourni. */
  reactivity?: number;
  /** "fr" | "he" | "en" — passé à Whisper comme hint pour éviter les
   *  détections incorrectes (hébreu transcrit en anglais notamment). */
  primaryLanguage?: string;
  /** Whether the form has unsaved changes — shown as a hint. */
  dirty: boolean;
}

// Compact version of the WebRTC voice client, scoped to dashboard live-test.
// Sends the in-progress form values to /api/session so the user can audition
// unsaved persona/voice/temp/speed changes before persisting.
export function LiveTestPanel({
  model,
  voice,
  instructions,
  greetingInstructions,
  temperature,
  speed,
  reactivity = 5,
  primaryLanguage,
  dirty,
}: LiveTestPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorTriage, setErrorTriage] = useState<RealtimeErrorTriage | null>(
    null,
  );
  const [isMuted, setIsMuted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [demoEnded, setDemoEnded] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingCalls = useRef<Map<string, string>>(new Map());

  // Auto-scroll bas du transcript à chaque nouveau message.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>, callId: string) => {
      let result: unknown;
      try {
        const endpoints: Record<string, string> = {
          check_availability: "/api/calendar/availability",
          book_appointment: "/api/calendar/book",
          save_contact: "/api/sheets/contact",
          find_appointment: "/api/calendar/find",
          cancel_appointment: "/api/calendar/cancel",
          reschedule_appointment: "/api/calendar/reschedule",
        };
        const endpoint = endpoints[name];
        if (!endpoint) {
          result = { error: `Outil inconnu: ${name}` };
        } else {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          result = await res.json();
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
        }),
      );
      dcRef.current.send(JSON.stringify({ type: "response.create" }));
    },
    [],
  );

  // Awaiting assistant response : true entre le moment où l'user a fini de
  // parler (transcription completed) et où l'assistant pousse son audio
  // transcript. Sert à montrer l'indicateur "typing" 3-dots.
  const [awaitingResponse, setAwaitingResponse] = useState(false);

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
        console.error("[realtime] error", event);
        const triage = triageRealtimeError(event);
        setErrorTriage(triage);
        setError(triage.summary);
        setAwaitingResponse(false);
        return;
      }
      if (type === "response.output_item.added") {
        const item = event.item as Record<string, unknown>;
        if (item?.type === "function_call") {
          pendingCalls.current.set(
            item.call_id as string,
            item.name as string,
          );
        }
      }
      if (type === "response.function_call_arguments.done") {
        const callId = event.call_id as string;
        const funcName = pendingCalls.current.get(callId) ?? "";
        const argsStr = event.arguments as string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsStr);
        } catch {}
        pendingCalls.current.delete(callId);
        executeTool(funcName, args, callId);
      }
      // ── Assistant transcript — streaming + final ─────────────────────
      // `.delta` envoie le texte au fur et à mesure (token par token).
      // `.done` finalise la phrase complète à la fin.
      // On agrège les deltas sur une bulle "en cours" pour donner le feel
      // "Sarah parle live", puis on remplace par le texte final quand .done
      // arrive (au cas où le streaming ait des typos ou trim).
      if (
        type === "response.audio_transcript.delta" ||
        type === "response.output_audio_transcript.delta"
      ) {
        const delta = (event.delta as string) ?? "";
        if (!delta) return;
        setTranscript((p) => {
          const last = p[p.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...p.slice(0, -1),
              { ...last, text: last.text + delta },
            ];
          }
          return [...p, { role: "assistant", text: delta, streaming: true }];
        });
        setAwaitingResponse(false);
      }
      if (
        type === "response.audio_transcript.done" ||
        type === "response.output_audio_transcript.done"
      ) {
        const text = (event.transcript as string) ?? "";
        if (text) {
          setTranscript((p) => {
            const last = p[p.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [
                ...p.slice(0, -1),
                { role: "assistant", text },
              ];
            }
            return [...p, { role: "assistant", text }];
          });
        }
        setAwaitingResponse(false);
      }

      // ── User transcript — streaming + final ──────────────────────────
      if (
        type === "conversation.item.input_audio_transcription.delta"
      ) {
        const delta = (event.delta as string) ?? "";
        if (!delta) return;
        setTranscript((p) => {
          const last = p[p.length - 1];
          if (last && last.role === "user" && last.streaming) {
            return [
              ...p.slice(0, -1),
              { ...last, text: last.text + delta },
            ];
          }
          return [...p, { role: "user", text: delta, streaming: true }];
        });
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = (event.transcript as string) ?? "";
        if (text) {
          setTranscript((p) => {
            const last = p[p.length - 1];
            if (last && last.role === "user" && last.streaming) {
              return [
                ...p.slice(0, -1),
                { role: "user", text },
              ];
            }
            return [...p, { role: "user", text }];
          });
        }
        setAwaitingResponse(true);
      }
    },
    [executeTool],
  );

  const startSession = useCallback(async () => {
    setError(null);
    setErrorTriage(null);
    setDemoEnded(false);
    setTranscript([]);
    setStatus("connecting");
    // Reset pending function-call ids carry-overs from a previous session.
    pendingCalls.current.clear();

    try {
      const tokenRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          voice,
          instructions,
          temperature,
          speed,
          reactivity,
          primaryLanguage,
        }),
      });
      if (!tokenRes.ok) throw new Error("Impossible d'obtenir le token de session");
      const tokenData = await tokenRes.json();
      const ephemeralKey = tokenData.value;
      const sessionModel = tokenData.model ?? tokenData.session?.model;
      const webrtcUrl = tokenData.webrtc_url;
      const requestedTemperature: number | null =
        tokenData.requested_temperature ?? null;
      if (!ephemeralKey) throw new Error("Token invalide");
      if (!sessionModel) throw new Error("Modèle absent de la session");
      if (!webrtcUrl) throw new Error("URL WebRTC absente");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Couche browser : echo cancellation + noise suppression + AGC.
          // Couche OpenAI : `noise_reduction: near_field` côté /api/session.
          // (Côté worker Twilio : ai-coustics QVF 2.1 L, pas concerné ici.)
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = handleDataChannelMessage;

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
        },
      );
      if (!sdpRes.ok) {
        const txt = await sdpRes.text();
        throw new Error(`OpenAI WebRTC: ${txt}`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      dc.onopen = () => {
        setStatus("connected");
        setSecondsLeft(DEMO_SESSION_SECONDS);
        // Centralized event builder — handles the OpenAI API contract drift
        // in one place (lib/realtime-events.ts). The dashboard temperature
        // slider used to be applied here but the param is no longer accepted
        // by OpenAI at any level (session.update or response.create both
        // return unknown_parameter since late 2025). Slider stays for visual
        // consistency, no longer plumbed.
        void requestedTemperature;
        dc.send(JSON.stringify(buildResponseCreate({
          instructions: greetingInstructions,
        })));
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          setStatus("error");
          setError("Connexion perdue");
        }
      };
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }, [
    model,
    voice,
    instructions,
    greetingInstructions,
    temperature,
    speed,
    reactivity,
    primaryLanguage,
    handleDataChannelMessage,
  ]);

  const stopSession = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    setStatus("idle");
    setIsMuted(false);
    setSecondsLeft(null);
    setAwaitingResponse(false);
  }, []);

  const toggleMute = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.enabled = isMuted;
    });
    setIsMuted((m) => !m);
  }, [isMuted]);

  // Countdown : décrémente secondsLeft à 1Hz, déclenche stopSession à 0.
  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fin de démo : il faut figer demoEnded AVANT stopSession() (qui reset secondsLeft à null), non dérivable au render
      setDemoEnded(true);
      stopSession();
      return;
    }
    const id = setInterval(() => {
      setSecondsLeft((s) => (s == null ? null : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft, stopSession]);

  useEffect(() => () => stopSession(), [stopSession]);

  const isLive = status === "connecting" || status === "connected";

  const statusLabel: Record<Status, string> = {
    idle: "Prêt",
    connecting: "Connexion…",
    connected: "En ligne — parlez",
    error: "Erreur",
  };

  const statusDotClass: Record<Status, string> = {
    idle: "bg-[#22d3ee]",
    connecting: "bg-[#f59e0b] motion-safe:animate-pulse",
    // Cyan voice-tech (signature marque) au lieu de vert success générique :
    // l'état "connected" = voix live = différenciateur Tamara.
    connected: "bg-[#22d3ee] motion-safe:animate-pulse",
    error: "bg-[#dc2626]",
  };

  // Pill du header — couleur dépend du status pour pas mentir au user
  // (afficher "Prêt" en cyan alors qu'on est en erreur serait trompeur).
  const pillTone: Record<Status, { bg: string; text: string; ring: string }> = {
    idle: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    connecting: { bg: "bg-[#fef3c7]", text: "text-[#92400e]", ring: "ring-[#f59e0b]/40" },
    connected: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    error: { bg: "bg-[#fee2e2]", text: "text-[#991b1b]", ring: "ring-[#dc2626]/40" },
  };

  // Renvoie l'heure courante (HH:MM) pour les bulles transcript. On la
  // calcule au render — pas critique d'être figée par message ici, vu que
  // c'est un live test 40s et le user voit la convo se construire.
  const nowHHMM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
      {/* Keyframes locaux — autonomes pour qu'on puisse réutiliser le panel
          ailleurs (pas seulement dans config-form qui les injecte aussi).
          jsx global = stylesheet partagée, donc no-op si déjà présent. */}
      <style>{`
        @keyframes ltp-ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .ltp-ripple-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 2px solid #22d3ee;
          pointer-events: none;
          animation: ltp-ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .ltp-ripple-ring--2 { animation-delay: 0.8s; }
        .ltp-ripple-ring--3 { animation-delay: 1.6s; }
        @media (prefers-reduced-motion: reduce) {
          .ltp-ripple-ring { animation: none; }
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
              Appel vocal avec les paramètres actuels — non-sauvegardés inclus.
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
          {dirty && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#92400e] ring-1 ring-inset ring-[#f59e0b]/40">
              <span className="h-1 w-1 rounded-full bg-[#f59e0b]" />
              Brouillon
            </span>
          )}
        </div>
      </div>

      <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[auto_1fr]">
        {/* ─── COLONNE MIC ────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-44 w-44 items-center justify-center">
            {/* Ripple rings cyan — toujours visibles (inviting at rest, plus
             *  intense quand session connected via re-render via key). */}
            <span aria-hidden className="ltp-ripple-ring" />
            <span aria-hidden className="ltp-ripple-ring ltp-ripple-ring--2" />
            <span aria-hidden className="ltp-ripple-ring ltp-ripple-ring--3" />

            <button
              type="button"
              onClick={isLive ? stopSession : startSession}
              disabled={status === "connecting"}
              aria-label={isLive ? "Arrêter le test" : "Démarrer le test vocal"}
              className={`group relative inline-flex h-36 w-36 items-center justify-center rounded-full text-white shadow-[0_12px_48px_-8px_rgba(14,116,144,0.65)] transition-transform duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80 ${
                status === "connecting"
                  ? "bg-gradient-to-br from-[#f59e0b] to-[#b45309]"
                  : status === "connected"
                    ? "bg-gradient-to-br from-[#dc2626] to-[#991b1b] hover:scale-[1.06] active:scale-95"
                    : "bg-gradient-to-br from-[#06b6d4] to-[#0e7490] hover:scale-[1.06] active:scale-95"
              }`}
            >
              {/* Halo cyan voice tech — toujours présent, plus marqué en idle */}
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
              : "Clique et parle pour tester ta secrétaire"}
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
            {/* Error blocks — gardés en haut du transcript pour visibilité */}
            {error && !errorTriage && (
              <p
                role="alert"
                className="rounded-lg border border-[#dc2626]/30 bg-[#fee2e2] px-3 py-2 text-xs text-[#991b1b]"
              >
                {error}
              </p>
            )}
            {errorTriage && (
              <div
                role="alert"
                className="flex flex-col gap-1.5 rounded-lg border border-[#dc2626]/30 bg-[#fee2e2] px-3 py-2.5 text-xs text-[#991b1b]"
              >
                <p className="font-semibold">{errorTriage.summary}</p>
                <p className="opacity-90">{errorTriage.hint}</p>
                {errorTriage.eventId && (
                  <p className="font-mono text-[10px] opacity-70">
                    event_id: {errorTriage.eventId}
                  </p>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] opacity-60 hover:opacity-100">
                    Voir le JSON brut
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-white/60 p-2 text-[10px] leading-tight">
                    {JSON.stringify(errorTriage.raw, null, 2)}
                  </pre>
                </details>
              </div>
            )}

            {demoEnded && (
              <p
                role="status"
                className="rounded-lg border border-[#f59e0b]/40 bg-[#fef3c7] px-3 py-2 text-[11px] leading-snug text-[#92400e]"
              >
                Session de test terminée ({DEMO_SESSION_SECONDS}s). Les appels
                via ton numéro Twilio ne sont pas limités.
              </p>
            )}

            {transcript.length === 0 && !error && !demoEnded ? (
              <p className="m-auto text-center text-xs leading-snug text-[#94a3b8]">
                {isLive
                  ? "En écoute… Parlez à la secrétaire."
                  : "Le transcript apparaîtra ici une fois l'appel démarré."}
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
                  S
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

          {/* Footer params — visuel de réassurance que le test prend bien
              les valeurs in-progress du form (pas la persistée). */}
          <p className="mt-3 text-center text-[11px] text-[#0e7490]/80">
            <span className="font-mono">{model}</span> ·{" "}
            <span className="font-mono">{voice}</span> · t°
            <span className="font-mono">{temperature.toFixed(2)}</span> ·{" "}
            <span className="font-mono">{speed.toFixed(2)}×</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Bubble v2 — avatar circulaire + timestamp + bulle gradient.
 * Burgundy pour le user (M = Moi), cyan/teal pour l'assistante (S = Sarah).
 * Hérité du visuel "Voice Studio wow" (cf. dashboard-preview/wow/client.tsx).
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
        {isUser ? "M" : "S"}
      </span>

      <div
        className={`flex max-w-[78%] flex-col ${isUser ? "items-end" : "items-start"}`}
      >
        <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-[#94a3b8]">
          {isUser ? "Vous" : "Sarah"} · {time}
        </span>
        <div
          className={`mt-0.5 rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${
            isUser
              ? "rounded-br-md bg-gradient-to-br from-[#be185d] to-[#9d174d] text-white"
              : "rounded-bl-md bg-gradient-to-br from-[#ecfeff] to-white text-[#18181b] ring-1 ring-inset ring-[#22d3ee]/30"
          }`}
        >
          <span className="sr-only">{isUser ? "Vous : " : "Sarah : "}</span>
          {text}
        </div>
      </div>
    </div>
  );
}
