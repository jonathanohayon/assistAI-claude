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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    voice?: string;
  };

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

  const res = await fetch(clientSecretsUrl(provider), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions: REALTIME_INSTRUCTIONS,
        audio: {
          input: { transcription: { model: REALTIME_TRANSCRIPTION_MODEL } },
          output: { voice },
        },
        tools: REALTIME_TOOLS,
        tool_choice: "auto",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = await res.json();
  return NextResponse.json({
    ...data,
    // Echo model/provider explicitly — xAI's client_secrets response omits the
    // `session` block that OpenAI returns, so the client can't infer it.
    model,
    provider,
    webrtc_url: webrtcUrl(provider),
  });
}
