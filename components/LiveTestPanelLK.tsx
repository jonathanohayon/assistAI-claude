"use client";

// LiveTestPanelLK — version Phase 2 du panel de test live.
//
// Au lieu d'ouvrir un peer connection direct vers OpenAI Realtime
// (l'ancienne approche, qui short-circuitait ai-coustics), le panel rejoint
// une LiveKit room. Le worker (même qui répond aux appels Twilio) est
// auto-dispatché sur la room ; il applique Quail Voice Focus 2.1 L
// (ai-coustics) sur le track entrant AVANT de le forwarder à OpenAI.
//
// Bonus : le worker publie chaque turn (user/assistant) sur le data channel
// reliable de la room → on les rend ici en temps réel.
//
// Auth : requiert NextAuth (cf. /api/livekit/web-token). Pour la démo
// landing (anonymous) on reste sur le panel direct-OpenAI.

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

type Status = "idle" | "connecting" | "live" | "ending";

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
}

export function LiveTestPanelLK({ dirty }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll en bas quand un nouveau turn arrive
  useEffect(() => {
    const el = transcriptScrollRef.current;
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
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setStatus("connecting");
    try {
      // 1. Get LiveKit token from our backend
      const res = await fetch("/api/livekit/web-token", { method: "POST" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Token endpoint ${res.status}: ${t || "no body"}`);
      }
      const { url, token } = (await res.json()) as WebTokenResponse;

      // 2. Connect to the room (worker is auto-dispatched on join)
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Mic capture defaults (browser-side NR is also OK — QVF côté
        // worker fait l'essentiel, mais ces flags aident sur Safari).
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      // 3. Wire events BEFORE connect() so we don't miss the agent's track
      room.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          _p: RemoteParticipant,
        ) => {
          if (track.kind === Track.Kind.Audio) {
            const audioTrack = track as RemoteAudioTrack;
            const el = audioElRef.current;
            if (el) {
              audioTrack.attach(el);
              void el.play().catch(() => {
                // autoplay may be blocked silently on some browsers
              });
            }
          }
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
          // payload non-JSON → ignore
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
      });

      // 4. Connect + publish mic
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("live");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
      void teardown();
    }
  }, [teardown]);

  const stop = useCallback(async () => {
    setStatus("ending");
    await teardown();
    setStatus("idle");
  }, [teardown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  const isLive = status === "live";
  const isEnding = status === "ending";
  const showStopButton = isLive || isEnding;
  const isBusy = status === "connecting" || isEnding;

  return (
    <div className="rounded-3xl border border-white/50 bg-white/85 p-6 shadow-[0_8px_32px_-12px_rgba(190,24,93,0.15)] backdrop-blur-xl sm:p-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#0e7490]">
            Live Test · QVF 2.1 L
          </p>
          <h3 className="mt-1 font-display text-2xl tracking-tight text-[#18181b] sm:text-3xl">
            Tester en direct
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#475569]">
            Parlez directement à votre agent depuis le navigateur. La
            réduction de bruit ai-coustics tourne sur le worker — même
            pipeline que pour les vrais appels.
          </p>
        </div>
        {isLive && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#dcfce7] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#15803d]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-[#22c55e]/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
            </span>
            LIVE
          </span>
        )}
      </header>

      {dirty && (
        <div className="mb-4 rounded-2xl border border-[#fde68a] bg-[#fef3c7]/60 px-3.5 py-2.5 text-xs text-[#92400e]">
          <strong>Note :</strong> sauvegardez vos modifs avant de tester —
          le worker lit la config depuis la base, pas le formulaire.
        </div>
      )}

      {/* Transcript area */}
      <div
        ref={transcriptScrollRef}
        className="mb-5 max-h-72 min-h-32 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-[#f8fafc]/60 p-3 text-sm"
      >
        {transcript.length === 0 ? (
          <p className="m-auto py-6 text-center text-xs text-[#94a3b8]">
            {isLive
              ? "En écoute… parlez à votre agent."
              : "Cliquez sur Démarrer pour ouvrir une session live."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transcript.map((t, i) => (
              <li
                key={i}
                className={`flex ${
                  t.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <span
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                    t.role === "user"
                      ? "bg-gradient-to-br from-[#22d3ee] to-[#0e7490] text-white"
                      : "border border-[#e2e8f0] bg-white text-[#18181b]"
                  }`}
                >
                  {t.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-3.5 py-2.5 text-xs text-[#b91c1c]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {showStopButton ? (
          <button
            type="button"
            onClick={stop}
            disabled={isEnding}
            className="inline-flex items-center gap-2 rounded-full bg-[#18181b] px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-[#27272a] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            {isEnding ? "Fermeture…" : "Arrêter"}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={isBusy}
            className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#22d3ee] px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              boxShadow: "0 8px 20px -6px rgba(236,72,153,0.55)",
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
            {status === "connecting" ? "Connexion…" : "Démarrer"}
          </button>
        )}
        <span className="text-[11px] text-[#94a3b8]">
          Quail Voice Focus 2.1 L · Latence ~30 ms
        </span>
      </div>

      {/* Hidden audio sink for the agent's voice */}
      <audio
        ref={audioElRef}
        autoPlay
        playsInline
        className="hidden"
        aria-hidden
      />
    </div>
  );
}
