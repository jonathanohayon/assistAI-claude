import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/request-parsing";
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

  return NextResponse.json({ ok: true });
}
