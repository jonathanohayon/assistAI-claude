import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/request-parsing";
import { alertAdmins } from "@/lib/alerts";
import { EVENT_ALERTS } from "@/lib/monitoring-rules";
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

  // Worker events that mean calls are failing (lib/monitoring-rules EVENT_ALERTS):
  // alert at once, deduped per event + code, quiet hours for warnings.
  const rule = EVENT_ALERTS[body.event];
  if (rule) {
    const code = String(body.metadata?.["code"] ?? body.metadata?.["missingKey"] ?? body.metadata?.["requested"] ?? "");
    await alertAdmins({
      key: `${body.event}:${code || "-"}`,
      subject: rule.subject(code || "unknown"),
      body: `${body.message}\n\n${rule.hint}`,
      dedupMs: rule.dedupMs,
      severity: rule.severity,
    });
  }

  return NextResponse.json({ ok: true });
}
