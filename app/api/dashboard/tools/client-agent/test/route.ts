import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { openStoredSecret } from "@/lib/crypto/unreadable-secret";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";
import { runClientAgentTest } from "@/lib/tools/client-agent-test";
import { CLIENT_AGENT_OFF } from "@/lib/tools/contract";
import { parseTools } from "@/lib/tools/store";

export const dynamic = "force-dynamic";

// "Ask your agent" (T5) — test the customer's agent with one mock question.
// Session scope; ?asUserId= for admins (like /api/dashboard/tools).
//   POST { url?, secret?, language? } — url/secret: the not-yet-saved values
//     (default: the stored ones; the stored secret signs only the stored
//     url). → 200 { ok: true, ms } | { ok: false, reason } — NEVER the remote
//     body, headers or resolved address (lib/tools/client-agent-test.ts).
//   403 client_agent_disabled (CLIENT_AGENT off for this account),
//   429 rate_limited (5 tests per account per 10 min), 400 invalid_body.

const tests = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });
const LANGUAGES = ["fr", "he", "en"];

export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = r.userId;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> | null;
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (
    !b ||
    (b.url !== undefined && typeof b.url !== "string") ||
    (b.secret !== undefined && b.secret !== null && typeof b.secret !== "string") ||
    (b.language !== undefined && typeof b.language !== "string")
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [[user], [cfg]] = await Promise.all([
    db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ toolsConfig: agentConfigs.toolsConfig, primaryLanguage: agentConfigs.primaryLanguage })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .limit(1),
  ]);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!clientAgentEnabled(clientAgentMode(), user.role === "admin")) {
    return NextResponse.json({ error: "client_agent_disabled" }, { status: 403 });
  }
  if (!tests.hit(userId)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = cfg ? parseTools(cfg.toolsConfig) : null;
  const stored = parsed?.ok ? parsed.value.clientAgent : CLIENT_AGENT_OFF;
  const url = typeof b.url === "string" ? b.url.trim() : stored.url;
  const secret =
    typeof b.secret === "string" ? b.secret || null : b.secret === null ? null : url === stored.url
          ? // E1: the stored secret opened; unreadable = absent (reported).
            openStoredSecret("client_agent", stored.secret)
          : null;
  const language =
    typeof b.language === "string" && LANGUAGES.includes(b.language)
      ? b.language
      : LANGUAGES.includes(cfg?.primaryLanguage ?? "")
        ? cfg!.primaryLanguage
        : "fr";

  const result = await runClientAgentTest({ url, secret, language });
  await logEvent({
    source: "tenant",
    event: "client_agent_test",
    // The outcome only: never the url, the answer or an address.
    message: result.ok ? `Test agent du client OK (${result.ms} ms)` : `Test agent du client échoué (${result.reason})`,
    userId,
    metadata: result.ok ? { ok: true, ms: result.ms } : { ok: false, reason: result.reason },
  });
  return NextResponse.json(result);
}
