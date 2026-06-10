"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
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

// Public landing demo : capped session duration so anonymous visitors can
// try the agent but can't burn unlimited Realtime API budget. After this
// many seconds the session auto-disconnects with a "demo terminée" UX.
const DEMO_SESSION_SECONDS = 80;

// Modèle/voix figés pour la démo publique : plus de sélecteur exposé au
// visiteur (UX épurée). On utilise toujours le modèle le plus avancé ; la
// voix vient du compte démo (admin) sinon du défaut catalog.
const DEMO_DEFAULT_MODEL = "gpt-realtime-2";

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais",
};

export default function VoiceAgent() {
  // Langue choisie sur la page d'accueil (sélecteur de langue) → l'agent démo
  // parle dans CETTE langue, quelle que soit la langue du compte démo.
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const catalog = useRealtimeCatalog();
  // Modèle figé (plus de picker) ; la voix reste dynamique (compte démo ou
  // défaut catalog), mais n'est plus choisie par le visiteur.
  const model = DEMO_DEFAULT_MODEL;
  const [voice, setVoice] = useState<string>(
    defaultVoiceForCatalog(catalog, DEMO_DEFAULT_MODEL),
  );
  // null = pas de timer en cours, sinon secondes restantes (décrémente à 1Hz).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [demoEnded, setDemoEnded] = useState(false);
  // Awaiting assistant response : true entre la fin transcription user et
  // l'arrivée du transcript assistant. Drive l'indicateur typing 3-dots.
  const [awaitingResponse, setAwaitingResponse] = useState(false);

  // Config du compte "démo" déclaré dans /admin : si présent, l'agent de la
  // home reprend sa persona / voix / accueil / langue (personnalisable via le
  // dashboard de ce compte). Null = démo anonyme par défaut.
  const demoConfigRef = useRef<{
    instructions?: string;
    voice?: string | null;
    greeting?: string;
    primaryLanguage?: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // On passe la langue de la page → le serveur cale la directive de langue
    // de la persona sur celle-ci (l'agent démo parle la langue du visiteur).
    fetch(`/api/demo-config?lang=${encodeURIComponent(locale)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.configured) return;
        demoConfigRef.current = d;
        if (d.voice) setVoice(d.voice);
      })
      .catch(() => {
        /* pas de compte démo → on garde l'agent anonyme par défaut */
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const transport = useMemo(() => transportFor(model), [model]);
  const isUnsupported = transport !== "webrtc";

  // Une fois le catalog chargé, cale la voix sur le défaut du modèle si elle
  // n'est pas encore valide (le compte démo peut la surcharger plus tard).
  /* eslint-disable react-hooks/set-state-in-effect -- sync async catalog → state */
  useEffect(() => {
    const allowed = voicesForCatalog(catalog, DEMO_DEFAULT_MODEL);
    setVoice((cur) =>
      cur && allowed.includes(cur)
        ? cur
        : defaultVoiceForCatalog(catalog, DEMO_DEFAULT_MODEL),
    );
  }, [catalog]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pcRef       = useRef<RTCPeerConnection | null>(null);
  const dcRef       = useRef<RTCDataChannel | null>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingCalls = useRef<Map<string, string>>(new Map()); // call_id → function_name
  const stopSessionRef = useRef<() => void>(() => {});
  // True pendant la fenêtre d'accueil : le micro est coupé pour empêcher le
  // VAD serveur de créer une réponse auto (depuis le bruit/écho initial) qui
  // entre en conflit avec notre accueil explicite → "conversation already has
  // an active response" + l'agent se coupe et reprend. Réactivé à la fin de
  // l'accueil (response.done) ou après un filet de sécurité.
  const greetingActiveRef = useRef(false);

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
        const errObj = (event.error ?? event) as Record<string, unknown>;
        // Bénin : une réponse était déjà active quand on a (re)demandé un
        // accueil. On l'ignore (l'accueil en cours suffit) au lieu d'afficher
        // une erreur effrayante au visiteur.
        if (errObj?.code === "conversation_already_has_active_response") {
          console.warn("[realtime] accueil: réponse déjà active, ignoré");
          return;
        }
        console.error("[realtime] error event", event);
        setError(`Realtime: ${JSON.stringify(errObj)}`);
        setAwaitingResponse(false);
        return;
      }

      // Fin d'une réponse : si c'était l'accueil, on réactive le micro (coupé
      // pendant l'accueil pour éviter l'auto-réponse VAD qui le tronquait).
      if (type === "response.done" && greetingActiveRef.current) {
        greetingActiveRef.current = false;
        streamRef.current?.getTracks().forEach((t) => (t.enabled = true));
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
      // 1. Get ephemeral token (model/voice picked client-side, validated server-side).
      //    Si un compte démo est déclaré, on injecte sa persona + voix + langue.
      //    On RECHARGE la config démo juste avant de connecter : garantit la
      //    persona/voix à jour même si le compte démo a été modifié depuis le
      //    chargement de la page, et élimine la course (clic avant la fin du
      //    fetch initial → sinon fallback sur la persona générique).
      let demo = demoConfigRef.current;
      try {
        const r = await fetch(
          `/api/demo-config?lang=${encodeURIComponent(locale)}`,
        );
        if (r.ok) {
          const d = await r.json();
          if (d?.configured) {
            demo = d;
            demoConfigRef.current = d;
          }
        }
      } catch {
        /* réseau KO → on garde le ref existant (ou agent anonyme) */
      }
      // Voix du compte démo prioritaire sur la voix locale (qui peut ne pas
      // encore être synchronisée si le clic précède le fetch initial).
      const sessionVoice = demo?.voice || voice;
      // Persona + consigne d'accueil placées dans les instructions de SESSION.
      // La persona (avec sa directive de langue calée sur la page) reste donc
      // active PENDANT l'accueil. On n'écrase plus la persona via
      // response.instructions (qui rendait l'accueil générique puis basculait
      // sur la persona = "autres configurations").
      const sessionInstructions = demo?.instructions
        ? `${demo.instructions}\n\nDÉBUT D'APPEL : dès le début, accueille proactivement l'appelant — présente-toi brièvement selon ta persona puis demande comment tu peux aider.`
        : undefined;
      const tokenRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          voice: sessionVoice,
          ...(sessionInstructions ? { instructions: sessionInstructions } : {}),
          // STT calé sur la langue de la page (pas celle du compte démo) → le
          // visiteur est compris et l'agent répond dans sa langue.
          primaryLanguage: locale,
        }),
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
      // Micro coupé pendant l'accueil : aucun audio (bruit/écho) n'atteint
      // OpenAI → pas d'auto-réponse VAD qui collisionne avec notre accueil.
      // Réactivé sur response.done de l'accueil (cf. handleDataChannelMessage).
      greetingActiveRef.current = true;
      stream.getTracks().forEach((t) => (t.enabled = false));

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
        // Un SEUL response.create d'accueil. Micro coupé (cf. plus haut) → pas
        // d'auto-réponse VAD concurrente.
        if (demo?.instructions) {
          // Persona + consigne d'accueil + langue déjà dans les instructions de
          // session → response.create nu : accueil cohérent avec la persona.
          dc.send(JSON.stringify({ type: "response.create" }));
        } else {
          // Fallback agent anonyme : pas de persona en session → on force la
          // langue de la page + l'accueil via les instructions du response.
          const label = LANG_LABEL[locale] ?? "français";
          const greetInstruction = `Parle EXCLUSIVEMENT en ${label} pendant tout l'appel. Accueille l'appelant en ${label} : présente-toi brièvement puis demande comment tu peux l'aider. Ne réponds JAMAIS dans une autre langue, même si tu hésites.`;
          dc.send(
            JSON.stringify({
              type: "response.create",
              response: { instructions: greetInstruction },
            }),
          );
        }
        // Filet de sécurité : si response.done de l'accueil n'arrive pas (ex.
        // accueil vide/erreur), on réactive le micro après 8 s pour ne pas
        // laisser le visiteur muet.
        setTimeout(() => {
          if (greetingActiveRef.current) {
            greetingActiveRef.current = false;
            streamRef.current?.getTracks().forEach((t) => (t.enabled = true));
          }
        }, 8000);
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
  }, [handleDataChannelMessage, model, voice, transport, locale]);

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
    greetingActiveRef.current = false;
    setStatus("idle");
    setIsMuted(false);
    setSecondsLeft(null);
    setAwaitingResponse(false);
  }, []);

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
  // c'est un live test court et le user voit la convo se construire.
  const nowHHMM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/60 p-5 shadow-[0_8px_36px_-14px_rgba(14,116,144,0.22)] backdrop-blur-xl sm:p-7"
      style={{
        backgroundColor: "#ffffff",
        backgroundImage: `
          radial-gradient(at 12% 100%, rgba(34, 211, 238, 0.16) 0px, transparent 50%),
          radial-gradient(at 90% 10%, rgba(236, 72, 153, 0.13) 0px, transparent 55%),
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
        className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-gradient-to-br from-[#22d3ee]/18 to-transparent blur-3xl"
      />

      {/* Header : titre compact + pill statut */}
      <div className="relative mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-[#22d3ee] to-[#0e7490]" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-[#18181b] sm:text-xl">
              Tester en direct
            </h2>
            <p className="mt-0.5 text-xs text-[#64748b]">
              Parlez à Tamara — démo gratuite 80s.
            </p>
          </div>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${pillTone[status].bg} ${pillTone[status].text} ${pillTone[status].ring}`}
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

      {isUnsupported && (
        <p
          className="relative mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
          role="alert"
        >
          Transport {transport.toUpperCase()} non implémenté côté client. La connexion échouera.
        </p>
      )}

      <div className="relative grid grid-cols-1 items-center gap-6 sm:gap-8 lg:grid-cols-[auto_1fr]">
        {/* ─── COLONNE MIC ────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3.5">
          <div className="relative flex h-36 w-36 items-center justify-center">
            {/* Ripple rings cyan concentriques stagger 0/0.8/1.6s */}
            <span aria-hidden className="va-ripple-ring" />
            <span aria-hidden className="va-ripple-ring va-ripple-ring--2" />
            <span aria-hidden className="va-ripple-ring va-ripple-ring--3" />

            <button
              type="button"
              onClick={status === "idle" || status === "error" ? startSession : stopSession}
              disabled={status === "connecting"}
              aria-label={isLive ? "Arrêter l'appel" : "Démarrer l'appel"}
              className={`group relative inline-flex h-28 w-28 items-center justify-center rounded-full text-white shadow-[0_12px_40px_-8px_rgba(14,116,144,0.6)] transition-transform duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#22d3ee]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80 ${
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
                  className="h-9 w-9 motion-safe:animate-spin"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : isLive ? (
                <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-11 w-11">
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
                {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[10px] font-medium text-[#475569] ring-1 ring-inset ring-[#e2e8f0]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Session de 80s · gratuit
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
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Aperçu de conversation
          </p>
          <div
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-label="Transcript"
            className="scroll-visible flex max-h-64 min-h-[160px] flex-col gap-2.5 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white/80 p-3.5 backdrop-blur"
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
                <Link href="/signup" className="font-semibold underline hover:no-underline">
                  Crée un compte
                </Link>{" "}
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
