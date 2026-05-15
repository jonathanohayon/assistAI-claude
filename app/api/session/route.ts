import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_REALTIME_MODEL,
  REALTIME_INSTRUCTIONS,
  REALTIME_TOOLS,
  REALTIME_TRANSCRIPTION_MODEL,
  clientSecretsUrl,
  configFor,
  defaultVoiceFor,
  providerFor,
  voicesFor,
  webrtcUrl,
} from "@/lib/realtime";

interface SessionBody {
  model?: string;
  voice?: string;
  // Optional full overrides for live testing from the dashboard. Lets the
  // user try unsaved form values without persisting them to DB.
  instructions?: string;
  temperature?: number;
  speed?: number;
  /**
   * "Réactivité" slider 1-10 (1 = posée, 10 = ultra-réactive). Mapped to
   * `silence_duration_ms` for server VAD. Default 5 when absent.
   */
  reactivity?: number;
  /**
   * Code ISO-639-1 ("fr" | "he" | "en") de la langue principale attendue
   * côté user audio input. Passé à Whisper comme hint pour éviter les
   * détections incorrectes (typiquement hébreu transcrit en anglais quand
   * l'audio est court ou ambigu). Si absent, Whisper auto-detect.
   */
  primaryLanguage?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SessionBody;

  // Trust the model id from the client — it was picked from the live OpenAI
  // catalog (/api/realtime/catalog). The previous hardcoded REALTIME_MODELS
  // allowlist silently rewrote unknown ids to DEFAULT, which broke gpt-realtime-2
  // and any new alias OpenAI ships. If OpenAI rejects, the resilient fetch
  // below surfaces the error to the client triage panel.
  const requestedModel = (body.model ?? "").trim();
  const model = requestedModel || DEFAULT_REALTIME_MODEL;

  // Voices : on garde la validation locale parce qu'OpenAI n'expose pas la
  // liste par modèle. La liste PROVIDERS est centralisée dans lib/realtime.ts
  // et facile à mettre à jour quand OpenAI ajoute une voix.
  const allowedVoices = voicesFor(model);
  const voice = allowedVoices.includes(body.voice ?? "")
    ? (body.voice as string)
    : defaultVoiceFor(model);

  const provider = providerFor(model);
  const config = configFor(model);

  if (!config.apiKey) {
    return NextResponse.json(
      { error: `Clé API manquante pour le provider ${provider}` },
      { status: 500 },
    );
  }

  const instructions =
    typeof body.instructions === "string" && body.instructions.trim().length > 0
      ? body.instructions
      : REALTIME_INSTRUCTIONS;

  // OpenAI's client_secrets endpoint doesn't accept temperature at the top
  // level — it must be applied via a `session.update` event after the
  // WebRTC data channel opens. We strip it here and echo the requested
  // value back so the browser can send the update itself.
  const requestedTemperature =
    typeof body.temperature === "number"
      ? clamp(body.temperature, 0, 2)
      : null;
  const requestedSpeed =
    typeof body.speed === "number" ? clamp(body.speed, 0.25, 2) : null;

  // Réactivité 1-10 → silence_duration_ms 1200..200 (linéaire). 1 = posée,
  // 10 = ultra-réactive. Default 5 (~755 ms) si absent.
  const reactivity =
    typeof body.reactivity === "number" ? clamp(body.reactivity, 1, 10) : 5;
  const silenceMs = Math.round(1200 - ((reactivity - 1) / 9) * 1000);

  const turnDetection = {
    type: "server_vad" as const,
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: silenceMs,
    create_response: true,
    interrupt_response: true,
  };

  const sessionPayload: Record<string, unknown> = {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: {
        transcription: {
          model: REALTIME_TRANSCRIPTION_MODEL,
          // Hint langue à Whisper : évite que l'hébreu soit transcrit en
          // anglais (problème récurrent quand l'auto-detect se trompe sur
          // des phrases courtes). Whitelist [fr, he, en] alignée avec
          // primary_language du tenant.
          ...(body.primaryLanguage &&
          ["fr", "he", "en"].includes(body.primaryLanguage)
            ? { language: body.primaryLanguage }
            : {}),
        },
        turn_detection: turnDetection,
        // Noise reduction OpenAI — `near_field` optimisé pour micro browser
        // (user parle directement dedans, casque/headset). Réduit le bruit
        // de fond + auto-gain. Free, layered avec les défauts du navigateur
        // (echoCancellation, noiseSuppression côté Chrome/Safari).
        // Pour Twilio (haut-parleur), le worker tourne ai-coustics QVF 2.1 L
        // (isolation primary speaker temps réel) AVANT que l'audio atteigne
        // OpenAI Realtime — d'où `near_field` ici suffit aussi côté tel.
        noise_reduction: { type: "near_field" as const },
      },
      output: requestedSpeed != null
        ? { voice, speed: requestedSpeed }
        : { voice },
    },
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
  };

  // Resilient fetch: if OpenAI rejects with `unknown_parameter`, strip the
  // offending field from the payload and retry once. Surfaces a structured
  // warning in the response so the client knows the API contract drifted
  // and the code should be patched (lib/realtime-events.ts on data-channel
  // side, this route on REST side).
  const sentPayload = { session: { ...sessionPayload } };
  let res = await fetch(clientSecretsUrl(provider), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sentPayload),
  });
  let stripped: string | null = null;
  let turnDetectionFallback: "top_level" | null = null;
  if (!res.ok) {
    const errText = await res.text();
    // Caveat : OpenAI Realtime a deux shapes pour turn_detection :
    //   - GA (Q4 2025+) : `session.audio.input.turn_detection`
    //   - pré-GA legacy : `session.turn_detection` au top-level
    // Si le modèle visé est encore sur l'ancienne shape, on déplace au
    // top-level et on retry. Quand OpenAI uniformise, ce fallback peut
    // disparaître (et le commentaire ci-dessus aussi).
    const tdRejected = /Unknown parameter:\s*'?session\.audio\.input\.turn_detection'?/i.test(
      errText,
    );
    if (tdRejected) {
      turnDetectionFallback = "top_level";
      const audio = sentPayload.session.audio as
        | { input?: Record<string, unknown>; output?: unknown }
        | undefined;
      if (audio?.input && "turn_detection" in audio.input) {
        delete audio.input.turn_detection;
      }
      (sentPayload.session as Record<string, unknown>).turn_detection =
        turnDetection;
      console.warn(
        "[session] OpenAI a refusé audio.input.turn_detection ; fallback top-level session.turn_detection (shape pré-GA).",
      );
      res = await fetch(clientSecretsUrl(provider), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sentPayload),
      });
    } else {
      const m = errText.match(/Unknown parameter: '?session\.([^'"\s.]+)'?/i);
      if (m && m[1] && m[1] in sentPayload.session) {
        stripped = m[1];
        delete (sentPayload.session as Record<string, unknown>)[m[1]];
        console.warn(
          `[session] OpenAI rejected session.${m[1]}; retrying without it. Patch app/api/session/route.ts to drop this field permanently.`,
        );
        res = await fetch(clientSecretsUrl(provider), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sentPayload),
        });
      } else {
        return NextResponse.json({ error: errText }, { status: 500 });
      }
    }
  }
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = await res.json();
  return NextResponse.json({
    ...data,
    model,
    provider,
    webrtc_url: webrtcUrl(provider),
    requested_temperature: requestedTemperature,
    requested_speed: requestedSpeed,
    silence_duration_ms_applied: silenceMs,
    // When "top_level", OpenAI a refusé audio.input.turn_detection et on a
    // basculé sur la shape pré-GA `session.turn_detection`. Null si pas
    // de fallback (shape GA acceptée nominalement).
    turn_detection_fallback: turnDetectionFallback,
    // When non-null, OpenAI rejected this field and we retried without it.
    // Surface to the client so the dashboard can render a "code drift" badge.
    stripped_field: stripped,
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
