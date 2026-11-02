import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/request-parsing";
import { alertAdmins } from "@/lib/alerts";
import { logEvent, type LogLevel, type LogSource } from "@/lib/logger";

// Internal POST endpoint for the LiveKit agent worker (or any other service)
// to push events into the centralized log. Gated by INTERNAL_SECRET.
//
// Body: { source, event, message, level?, userId?, metadata? }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = await parseJsonBody<{
    source?: string;
    event?: string;
    message?: string;
    level?: string;
    userId?: string | null;
    metadata?: Record<string, unknown>;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.source || !body.event || !body.message) {
    return NextResponse.json(
      { error: "source + event + message requis" },
      { status: 400 },
    );
  }

  await logEvent({
    source: body.source as LogSource,
    event: body.event,
    message: body.message,
    level: (body.level as LogLevel) ?? "info",
    userId: body.userId ?? null,
    metadata: body.metadata,
  });

  // A non-retryable OpenAI error (dead key, no quota) means no call can be
  // answered: alert now, once per code per 6 h, instead of waiting for the
  // hourly error-rate check.
  if (body.event === "realtime_fatal_error") {
    const code = String(body.metadata?.["code"] ?? "unknown");
    await alertAdmins({
      key: `realtime_fatal:${code}`,
      subject: `Voice agent fatal OpenAI error (${code})`,
      body:
        `The worker ended a call on a non-retryable OpenAI Realtime error.

` +
        `Code: ${code}
Message: ${body.message}

` +
        `Every call fails the same way until this is fixed (invalid_api_key → rotate OPENAI_API_KEY on the worker).`,
      dedupMs: 6 * 60 * 60 * 1000,
    });
  }

  return NextResponse.json({ ok: true });
}
