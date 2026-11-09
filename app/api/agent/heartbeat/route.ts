import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { recordHeartbeat } from "@/lib/monitoring";

// POST /api/agent/heartbeat: the worker reports it's alive (every few min) and
// the result of its read-only model-key checks. Worker-only (INTERNAL_SECRET):
// if the secrets drift apart, heartbeats stop and the monitor cron alerts.
const KEY_STATES = new Set(["ok", "invalid", "unreachable", "missing"]);

export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{ agentName?: string; version?: string; keys?: Record<string, string> }>(req);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  const keys: Record<string, string> = {};
  for (const k of ["openai", "gemini", "xai"]) {
    const v = b.keys?.[k];
    if (typeof v === "string" && KEY_STATES.has(v)) keys[k] = v;
  }
  await recordHeartbeat({
    agentName: String(b.agentName ?? "").slice(0, 80),
    version: String(b.version ?? "").slice(0, 40),
    keys,
  });
  return NextResponse.json({ ok: true });
}
