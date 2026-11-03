import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { logEvent } from "@/lib/logger";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";

// POST /api/agent/usage — ingestion de l'usage OpenAI Realtime réel depuis le
// worker (repo séparé). INTERNAL_SECRET-gated. Persiste un event
// `openai_usage` dont le moteur Finance (lib/finance/cost.ts) somme les
// tokens. Tant que le worker n'appelle pas cet endpoint, le coût OpenAI est
// estimé depuis les minutes d'appel (rate card).
//
// Body JSON: { userId?, toNumber?, callId?, inputTokens, outputTokens,
//              cachedTokens?, model?, costUsd?, durationSeconds? }
// `inputTokens` is the UNCACHED input: lib/finance/cost.ts bills it and
// `cachedTokens` separately. `toNumber` (dialed number) lets lib/logger
// resolve the tenant on SIP calls, where the worker has no userId.
// `durationSeconds` is the call time these tokens cover: lib/finance prices it
// by token and only estimates the call time left uncovered.

interface UsageBody {
  userId?: string;
  toNumber?: string;
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  model?: string;
  /** Engine that took the call: openai (default) | gemini | xai. */
  provider?: string;
  costUsd?: number;
  durationSeconds?: number;
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<UsageBody>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const inputTokens = toInt(body.inputTokens);
  const outputTokens = toInt(body.outputTokens);
  const cachedTokens = toInt(body.cachedTokens);

  const costUsd =
    typeof body.costUsd === "number" && Number.isFinite(body.costUsd) && body.costUsd >= 0
      ? body.costUsd
      : null;
  const provider = effectiveRealtimeProvider(body.provider);
  // Grok is billed per minute and reports no tokens: a row with a cost but
  // no tokens is valid. Nothing to bill at all is still refused.
  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0 && !(costUsd && costUsd > 0)) {
    return NextResponse.json(
      { error: "no_token_usage" },
      { status: 400 },
    );
  }

  await logEvent({
    source: "agent",
    event: "openai_usage",
    level: "info",
    message: `Usage ${provider} : ${inputTokens} in / ${outputTokens} out${
      body.model ? ` (${body.model})` : ""
    }${costUsd != null ? ` · $${costUsd.toFixed(4)}` : ""}`,
    userId: body.userId,
    metadata: {
      callId: body.callId ?? null,
      inputTokens,
      outputTokens,
      cachedTokens,
      model: body.model ?? null,
      provider,
      durationSeconds: toInt(body.durationSeconds),
      // Worker-side exact cost, kept for reconciliation with the rate card.
      costUsd:
        typeof body.costUsd === "number" && Number.isFinite(body.costUsd)
          ? body.costUsd
          : null,
      ...(typeof body.toNumber === "string" && body.toNumber
        ? { toNumber: body.toNumber }
        : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
