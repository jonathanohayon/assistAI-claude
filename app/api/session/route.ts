import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadDemoAgent } from "@/lib/demo-agent";
import { anonymousDemoInstructions } from "@/lib/demo-instructions";
import {
  DEMO_SESSION_BUCKET,
  DEMO_SESSION_GLOBAL,
  DEMO_SESSION_PER_IP,
  DEMO_SESSION_WINDOW_MS,
  demoSessionResponse,
  demoSessionVoice,
} from "@/lib/demo-session";
import { clamp } from "@/lib/numbers";
import { clientIp } from "@/lib/rate-limit";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import {
  DEFAULT_REALTIME_MODEL,
  PROVIDERS,
  REALTIME_INSTRUCTIONS,
  REALTIME_TOOLS,
  REALTIME_TRANSCRIPTION_MODEL,
  clientSecretsUrl,
  configFor,
  defaultVoiceFor,
  providerFor,
  transportFor,
  voicesFor,
  webrtcUrl,
} from "@/lib/realtime";
import { limiterKey } from "@/lib/verification-limits/policy";

interface SessionBody {
  /**
   * The public landing demo (components/VoiceAgent.tsx), signed in or not.
   * It sends only this flag and primaryLanguage: the server picks the demo
   * model, voice, instructions and tools, and answers with the token and the
   * SDP URL only (lib/demo-session.ts). Anonymous callers always get the demo.
   */
  demo?: boolean;
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

const RATE_LIMITED = {
  error: "rate_limited",
  message: "Too many demo sessions, try again later.",
} as const;

export async function POST(req: NextRequest) {
  // body optionnel : tous les champs ont des défauts (model, voice, etc.).
  const body = (await req.json().catch(() => ({}))) as SessionBody;

  // Anonymous = landing demo. It gets the demo agent built server-side
  // (instructions and model), never what the body asks for: otherwise this
  // route is an open OpenAI Realtime proxy billed to us.
  const session = await auth();
  const anonymous = !session?.user?.id;
  // Anonymous callers (the public landing demo) mint client secrets on our
  // account: bounded per IP and route-wide in the shared DB limiter (fails
  // closed). Logged-in users are not limited.
  if (anonymous) {
    let allowed = false;
    try {
      const rl = await consumeRateLimit({
        bucket: DEMO_SESSION_BUCKET,
        accountId: limiterKey(clientIp(req.headers)),
        windowMs: DEMO_SESSION_WINDOW_MS,
        perAccount: DEMO_SESSION_PER_IP,
        global: DEMO_SESSION_GLOBAL,
      });
      if (!rl.ok) {
        return NextResponse.json(RATE_LIMITED, {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        });
      }
      allowed = true;
    } catch (e) {
      console.error("[session] demo rate limiter unavailable", e);
    }
    if (!allowed) return NextResponse.json(RATE_LIMITED, { status: 429 });
  }
  const isDemo = anonymous || body.demo === true;
  const demo = isDemo
    ? await loadDemoAgent(body.primaryLanguage ?? null)
    : null;

  // Trust the model id from the client — it was picked from the live OpenAI
  // catalog (/api/realtime/catalog). The previous hardcoded REALTIME_MODELS
  // allowlist silently rewrote unknown ids to DEFAULT, which broke gpt-realtime-2
  // and any new alias OpenAI ships. If OpenAI rejects, the resilient fetch
  // below surfaces the error to the client triage panel.
  // Demo sessions are pinned to the demo account's model.
  const requestedModel = isDemo
    ? (demo?.model ?? "").trim()
    : (body.model ?? "").trim();
  const model = requestedModel || DEFAULT_REALTIME_MODEL;

  // Voices : on garde la validation locale parce qu'OpenAI n'expose pas la
  // liste par modèle. La liste PROVIDERS est centralisée dans lib/realtime.ts
  // et facile à mettre à jour quand OpenAI ajoute une voix.
  const allowedVoices = voicesFor(model);
  const provider = providerFor(model);
  const config = configFor(model);
  const voice = isDemo
    ? demoSessionVoice({
        demoVoice: demo?.voice,
        allowed: allowedVoices,
        // The demo browser used to send the OpenAI catalogue default.
        catalogueDefault: PROVIDERS.openai.defaultVoice,
        routeDefault: defaultVoiceFor(model),
      })
    : allowedVoices.includes(body.voice ?? "")
      ? (body.voice as string)
      : defaultVoiceFor(model);

  if (!config.apiKey) {
    if (isDemo) return sessionError(true, `no API key for provider ${provider}`);
    return NextResponse.json(
      { error: `Clé API manquante pour le provider ${provider}` },
      { status: 500 },
    );
  }

  const instructions = isDemo
    ? anonymousDemoInstructions(demo?.instructions ?? null, body.primaryLanguage ?? null)
    : typeof body.instructions === "string" &&
        body.instructions.trim().length > 0
      ? body.instructions
      : REALTIME_INSTRUCTIONS;

  // OpenAI's client_secrets endpoint doesn't accept temperature at the top
  // level — it must be applied via a `session.update` event after the
  // WebRTC data channel opens. We strip it here and echo the requested
  // value back so the browser can send the update itself.
  // The demo takes none of the tuning fields from the body.
  const requestedTemperature =
    !isDemo && typeof body.temperature === "number"
      ? clamp(body.temperature, 0, 2)
      : null;
  const requestedSpeed =
    !isDemo && typeof body.speed === "number" ? clamp(body.speed, 0.25, 2) : null;

  // Réactivité 1-10 → silence_duration_ms 1200..200 (linéaire). 1 = posée,
  // 10 = ultra-réactive. Default 5 (~755 ms) si absent.
  const reactivity =
    !isDemo && typeof body.reactivity === "number" ? clamp(body.reactivity, 1, 10) : 5;
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
        return sessionError(isDemo, errText);
      }
    }
  }
  if (!res.ok) {
    return sessionError(isDemo, await res.text());
  }

  const data = await res.json();
  if (isDemo) {
    // Token + SDP URL + tool routes only: the provider's echo of the session
    // (instructions, tools, model) stays here (lib/demo-session.ts).
    const out = demoSessionResponse(data, {
      webrtcUrl: webrtcUrl(provider),
      model,
      transport: transportFor(model),
      lang: body.primaryLanguage,
    });
    if (!out) return sessionError(true, "client secret missing from the provider answer");
    return NextResponse.json(out);
  }
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

/**
 * A failed mint. The dashboard (LiveTestPanel) gets the provider's text for
 * its triage panel; the public demo gets a neutral code (that text names the
 * provider and the model), and the details go to the server log.
 */
function sessionError(isDemo: boolean, providerText: string) {
  if (!isDemo) return NextResponse.json({ error: providerText }, { status: 500 });
  console.error("[session] demo session mint failed:", providerText.slice(0, 500));
  return NextResponse.json({ error: "session_failed" }, { status: 502 });
}
