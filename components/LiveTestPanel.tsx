"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

interface LiveTestPanelProps {
  model: string;
  voice: string;
  instructions: string;
  greetingInstructions: string;
  temperature: number;
  speed: number;
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
  dirty,
}: LiveTestPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingCalls = useRef<Map<string, string>>(new Map());

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
        setError(`Realtime: ${JSON.stringify(event.error ?? event)}`);
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
      if (type === "response.audio_transcript.done") {
        const text = event.transcript as string;
        if (text) setTranscript((p) => [...p, { role: "assistant", text }]);
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = event.transcript as string;
        if (text) setTranscript((p) => [...p, { role: "user", text }]);
      }
    },
    [executeTool],
  );

  const startSession = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setStatus("connecting");

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
        }),
      });
      if (!tokenRes.ok) throw new Error("Impossible d'obtenir le token de session");
      const tokenData = await tokenRes.json();
      const ephemeralKey = tokenData.value;
      const sessionModel = tokenData.model ?? tokenData.session?.model;
      const webrtcUrl = tokenData.webrtc_url;
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

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        // Fire the configured greeting so the test mirrors a real call.
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: { instructions: greetingInstructions },
          }),
        );
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
  }, []);

  const toggleMute = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.enabled = isMuted;
    });
    setIsMuted((m) => !m);
  }, [isMuted]);

  useEffect(() => () => stopSession(), [stopSession]);

  const isLive = status === "connecting" || status === "connected";

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

  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl tracking-tight text-[var(--color-foreground)]">
            Tester en direct
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Lance un appel vocal avec les paramètres ci-dessus — y compris ceux non sauvegardés.
          </p>
        </div>
        {dirty && (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Brouillon
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: control */}
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-gradient-to-br from-[#fdf2f8] to-[#f5f3ff] p-8">
          <button
            onClick={isLive ? stopSession : startSession}
            disabled={status === "connecting"}
            aria-label={isLive ? "Arrêter le test" : "Démarrer le test"}
            className={`relative inline-flex h-24 w-24 items-center justify-center rounded-full text-white shadow-md transition-all duration-200 disabled:cursor-not-allowed
              ${
                status === "connecting"
                  ? "bg-[var(--color-warning)]/80"
                  : status === "connected"
                  ? "bg-gradient-to-br from-[var(--color-destructive)] to-[#a21717] hover:scale-[1.03] active:scale-95"
                  : "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] hover:scale-[1.04] hover:shadow-lg active:scale-95"
              }`}
          >
            {status === "connecting" ? (
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : isLive ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
                <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
            {status === "connected" && (
              <span className="absolute inset-0 -z-10 rounded-full bg-[var(--color-primary)] opacity-30 motion-safe:animate-ping" />
            )}
          </button>

          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur">
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

          <p className="max-w-xs text-center text-xs text-[var(--color-muted-foreground)]">
            <span className="font-mono">{model}</span> · voix{" "}
            <span className="font-mono">{voice}</span> · t°{" "}
            <span className="font-mono">{temperature.toFixed(2)}</span> · vitesse{" "}
            <span className="font-mono">{speed.toFixed(2)}×</span>
          </p>
        </div>

        {/* Right: transcript / errors */}
        <div className="flex flex-col gap-3">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {error}
            </p>
          )}

          <div className="flex max-h-72 min-h-[200px] flex-col gap-2 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            {transcript.length === 0 ? (
              <p className="m-auto text-center text-xs text-[var(--color-muted-foreground)]">
                {isLive
                  ? "En écoute… Parlez à la secrétaire."
                  : "Le transcript apparaîtra ici une fois l'appel démarré."}
              </p>
            ) : (
              transcript.map((entry, i) => (
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
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
