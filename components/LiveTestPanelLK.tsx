"use client";

// LiveTestPanelLK — version Phase 2 (visuel = ancien LiveTestPanel).
//
// Au lieu d'ouvrir un peer connection direct vers OpenAI Realtime,
// le panel rejoint une LiveKit room. Le worker (qui répond aussi aux
// appels Twilio) est auto-dispatché, applique Quail Voice Focus 2.1 L
// (ai-coustics) sur le track entrant, puis forwarde à OpenAI Realtime.
// Worker publie les transcripts sur le data channel reliable → bulles
// utilisateur/agent en temps réel à droite.

import {
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected" | "ending" | "error";

type TranscriptEntry = { role: "user" | "assistant"; text: string };

type WebTokenResponse = {
  url: string;
  token: string;
  roomName: string;
  identity: string;
};

interface Props {
  /** True si le form a des modifs non sauvegardées — affiche un warning
   *  car le worker fetch la config depuis la DB (pas les valeurs UI). */
  dirty: boolean;
  /** Si fourni : admin teste en tant que ce tenant cible. L'endpoint
   *  /api/livekit/web-token vérifie le rôle admin et scope la room
   *  + metadata participant sur le bon userId. */
  asUserId?: string;
  /** Si fourni : teste un AGENT SORTANT précis (sa voix/persona/connaissance)
   *  au lieu de la config entrante. Passé à /api/livekit/web-token. */
  agentId?: string;
}

export function LiveTestPanelLK({ dirty, asUserId, agentId }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll bottom on new turn
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const teardown = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    roomRef.current = null;
    try {
      await room.disconnect();
    } catch {
      // best-effort
    }
    if (audioElRef.current) audioElRef.current.srcObject = null;
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setStatus("connecting");
    try {
      const res = await fetch("/api/livekit/web-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(asUserId ? { asUserId } : {}),
          ...(agentId ? { agentId } : {}),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Token endpoint ${res.status}: ${t || "no body"}`);
      }
      const { url, token } = (await res.json()) as WebTokenResponse;

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      room.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          _p: RemoteParticipant,
        ) => {
          if (track.kind !== Track.Kind.Audio) return;
          const audioTrack = track as RemoteAudioTrack;
          const el = audioElRef.current;
          if (!el) return;
          audioTrack.attach(el);
          void el.play().catch(() => {
            // autoplay may be silently blocked
          });
        },
      );

      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const text = new TextDecoder().decode(payload);
          const msg = JSON.parse(text) as {
            type?: string;
            role?: "user" | "assistant";
            text?: string;
          };
          if (
            msg.type === "transcript" &&
            (msg.role === "user" || msg.role === "assistant") &&
            typeof msg.text === "string" &&
            msg.text.trim()
          ) {
            setTranscript((prev) => [
              ...prev,
              { role: msg.role!, text: msg.text!.trim() },
            ]);
          }
        } catch {
          // non-JSON payload
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("connected");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
      void teardown();
    }
  }, [teardown, asUserId, agentId]);

  const stopSession = useCallback(async () => {
    setStatus("ending");
    await teardown();
    setStatus("idle");
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isMuted;
    void room.localParticipant.setMicrophoneEnabled(!next);
    setIsMuted(next);
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => () => void teardown(), [teardown]);

  const isLive = status === "connected";
  const isConnecting = status === "connecting";
  const statusLabel: Record<Status, string> = {
    idle: "Prêt",
    connecting: "Connexion…",
    connected: "En ligne — parlez",
    ending: "Fermeture…",
    error: "Erreur",
  };
  const statusDotClass: Record<Status, string> = {
    idle: "bg-[#22d3ee]",
    connecting: "bg-[#f59e0b] motion-safe:animate-pulse",
    connected: "bg-[#22d3ee] motion-safe:animate-pulse",
    ending: "bg-[#94a3b8]",
    error: "bg-[#dc2626]",
  };
  const pillTone: Record<Status, { bg: string; text: string; ring: string }> = {
    idle: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    connecting: { bg: "bg-[#fef3c7]", text: "text-[#92400e]", ring: "ring-[#f59e0b]/40" },
    connected: { bg: "bg-[#ecfeff]", text: "text-[#0e7490]", ring: "ring-[#22d3ee]/40" },
    ending: { bg: "bg-[#f1f5f9]", text: "text-[#475569]", ring: "ring-[#94a3b8]/40" },
    error: { bg: "bg-[#fee2e2]", text: "text-[#991b1b]", ring: "ring-[#dc2626]/40" },
  };

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] border border-white/50 p-5 shadow-[0_8px_40px_-12px_rgba(14,116,144,0.25)] backdrop-blur-xl sm:p-6"
      style={{
        backgroundColor: "#ffffff",
        backgroundImage: `
          radial-gradient(at 12% 100%, rgba(34, 211, 238, 0.18) 0px, transparent 50%),
          radial-gradient(at 90% 10%, rgba(236, 72, 153, 0.15) 0px, transparent 55%),
          radial-gradient(at 50% 50%, rgba(255, 255, 255, 0.6) 0px, transparent 60%)
        `,
      }}
    >
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

      {/* Header */}
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#0e7490]">
            Live Test
          </p>
          <h3 className="mt-1 font-display text-xl tracking-tight text-[#18181b]">
            Tester en direct
          </h3>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${pillTone[status].bg} ${pillTone[status].text} ${pillTone[status].ring}`}
        >
          <span className={`h-2 w-2 rounded-full ${statusDotClass[status]}`} />
          {statusLabel[status]}
        </span>
      </header>

      {dirty && (
        <div className="mb-4 rounded-2xl border border-[#fde68a] bg-[#fef3c7]/60 px-3 py-2 text-[11px] leading-snug text-[#92400e]">
          Sauvegardez avant de tester — le worker lit la config en base.
        </div>
      )}

      {/* Layout vertical (mic au-dessus, transcript en dessous) — fonctionne
       *  aussi bien en pleine largeur que dans une sidebar étroite (cf.
       *  config-form.tsx qui passe le panel en fixed-right sur xl+). */}
      <div className="relative flex flex-col gap-5">
        {/* ─── BLOC MIC ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-32 w-32 items-center justify-center">
            {/* Ripple rings cyan */}
            <span aria-hidden className="ltp-ripple-ring" />
            <span aria-hidden className="ltp-ripple-ring ltp-ripple-ring--2" />
            <span aria-hidden className="ltp-ripple-ring ltp-ripple-ring--3" />

            <button
              type="button"
              onClick={isLive ? stopSession : startSession}
              disabled={isConnecting || status === "ending"}
              aria-label={
                isLive ? "Arrêter le test" : "Démarrer le test vocal"
              }
              className={`group relative inline-flex h-24 w-24 items-center justify-center rounded-full text-white shadow-[0_12px_48px_-8px_rgba(14,116,144,0.65)] transition-transform duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80 ${
                isConnecting || status === "ending"
                  ? "bg-gradient-to-br from-[#f59e0b] to-[#b45309]"
                  : isLive
                    ? "bg-gradient-to-br from-[#dc2626] to-[#991b1b] hover:scale-[1.06] active:scale-95"
                    : "bg-gradient-to-br from-[#06b6d4] to-[#0e7490] hover:scale-[1.06] active:scale-95"
              }`}
            >
              {/* Halo cyan voice-tech */}
              <span
                aria-hidden
                className={`absolute inset-0 -z-10 rounded-full blur-2xl motion-safe:animate-pulse ${
                  isLive
                    ? "bg-[#dc2626] opacity-40"
                    : "bg-[#22d3ee] opacity-45"
                }`}
              />
              {/* Halo rose décalé */}
              <span
                aria-hidden
                className="absolute inset-0 -z-10 rounded-full bg-[#ec4899] opacity-25 blur-3xl motion-safe:animate-pulse"
                style={{ animationDelay: "700ms" }}
              />
              {/* Inner glow hover */}
              <span
                aria-hidden
                className="absolute inset-2 rounded-full bg-gradient-to-br from-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />

              {isConnecting || status === "ending" ? (
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-9 w-9 motion-safe:animate-spin"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    opacity="0.25"
                  />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              ) : isLive ? (
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-9 w-9"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-10 w-10"
                >
                  <rect
                    x="9"
                    y="3"
                    width="6"
                    height="12"
                    rx="3"
                    fill="currentColor"
                  />
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

          <p className="max-w-[200px] text-center text-xs font-medium leading-relaxed text-[#475569]">
            {isLive
              ? "Parlez, ou cliquez pour arrêter"
              : "Cliquez et parlez pour tester"}
          </p>

          {isLive && (
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

        {/* ─── BLOC TRANSCRIPT ───────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Conversation
          </p>
          <div
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-label="Transcript"
            className="flex max-h-[280px] min-h-[180px] flex-col gap-2 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white/80 p-3 backdrop-blur"
          >
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-[#dc2626]/30 bg-[#fee2e2] px-3 py-2 text-xs text-[#991b1b]"
              >
                {error}
              </p>
            )}

            {transcript.length === 0 && !error ? (
              <p className="m-auto text-center text-xs leading-snug text-[#94a3b8]">
                {isLive
                  ? "En écoute… parlez à votre agent."
                  : "Cliquez sur le mic pour démarrer un test."}
              </p>
            ) : (
              transcript.map((t, i) => {
                // Detect RTL script (Hebrew ֐-׿ + presentation
                // forms יִ-ﭏ, Arabic ؀-ۿ) → set dir
                // sur la bulle pour que ponctuation, chiffres et alignement
                // soient corrects. `unicode-bidi: plaintext` laisse le
                // navigateur décider par paragraph based on first strong
                // character (couvre les mixes FR/HE dans un même message).
                const hasRTL = /[֐-׿؀-ۿיִ-ﭏ]/.test(
                  t.text,
                );
                return (
                  <div
                    key={i}
                    className={`flex ${
                      t.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span
                      dir={hasRTL ? "rtl" : "ltr"}
                      lang={hasRTL ? "he" : undefined}
                      style={{ unicodeBidi: "plaintext" }}
                      className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                        t.role === "user"
                          ? "bg-gradient-to-br from-[#22d3ee] to-[#0e7490] text-white"
                          : "border border-[#e2e8f0] bg-white text-[#18181b]"
                      }`}
                    >
                      {t.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Hidden audio sink for the agent's voice */}
      <audio
        ref={audioElRef}
        autoPlay
        playsInline
        className="hidden"
        aria-hidden
      />
    </section>
  );
}
