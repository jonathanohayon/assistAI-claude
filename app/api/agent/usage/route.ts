import { NextRequest, NextResponse } from "next/server";

import { logEvent } from "@/lib/logger";

// POST /api/agent/usage — ingestion de l'usage OpenAI Realtime réel depuis le
// worker (repo séparé). INTERNAL_SECRET-gated. Persiste un event
// `openai_usage` dont le moteur Finance (lib/finance/cost.ts) somme les
// tokens. Tant que le worker n'appelle pas cet endpoint, le coût OpenAI est
// estimé depuis les minutes d'appel (rate card).
//
// Body JSON: { userId?, callId?, inputTokens, outputTokens, cachedTokens?, model? }

interface UsageBody {
  userId?: string;
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  model?: string;
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as UsageBody;
  const inputTokens = toInt(body.inputTokens);
  const outputTokens = toInt(body.outputTokens);
  const cachedTokens = toInt(body.cachedTokens);

  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
    return NextResponse.json(
      { error: "no_token_usage" },
      { status: 400 },
    );
  }

  await logEvent({
    source: "agent",
    event: "openai_usage",
    level: "info",
    message: `OpenAI usage : ${inputTokens} in / ${outputTokens} out${
      body.model ? ` (${body.model})` : ""
    }`,
    userId: body.userId,
    metadata: {
      callId: body.callId ?? null,
      inputTokens,
      outputTokens,
      cachedTokens,
      model: body.model ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
