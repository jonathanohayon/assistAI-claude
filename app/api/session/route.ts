import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_REALTIME_MODEL,
  REALTIME_INSTRUCTIONS,
  REALTIME_MODELS,
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
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SessionBody;

  const modelIds = REALTIME_MODELS.map((m) => m.id);
  const model = modelIds.includes(body.model ?? "")
    ? (body.model as string)
    : DEFAULT_REALTIME_MODEL;

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

  const sessionPayload: Record<string, unknown> = {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: { transcription: { model: REALTIME_TRANSCRIPTION_MODEL } },
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
  if (!res.ok) {
    const errText = await res.text();
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
    // When non-null, OpenAI rejected this field and we retried without it.
    // Surface to the client so the dashboard can render a "code drift" badge.
    stripped_field: stripped,
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
