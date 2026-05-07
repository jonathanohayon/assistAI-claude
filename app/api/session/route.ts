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

  const sessionPayload: Record<string, unknown> = {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: { transcription: { model: REALTIME_TRANSCRIPTION_MODEL } },
      output: { voice },
    },
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
  };

  if (typeof body.temperature === "number") {
    sessionPayload.temperature = clamp(body.temperature, 0, 2);
  }
  if (typeof body.speed === "number") {
    // OpenAI realtime accepts speed in audio.output. xAI may ignore it.
    const audio = sessionPayload.audio as Record<string, Record<string, unknown>>;
    audio.output.speed = clamp(body.speed, 0.25, 2);
  }

  const res = await fetch(clientSecretsUrl(provider), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session: sessionPayload }),
  });

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
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
