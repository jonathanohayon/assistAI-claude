import { NextRequest, NextResponse } from "next/server";

import {
  DEMO_TOOLS_BUCKET,
  DEMO_TOOLS_GLOBAL,
  DEMO_TOOLS_PER_IP,
  DEMO_TOOLS_WINDOW_MS,
  isDemoToolName,
  runDemoTool,
} from "@/lib/demo-tools";
import { clientIp } from "@/lib/rate-limit";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import { limiterKey } from "@/lib/verification-limits/policy";

// The public home demo's tools (lib/demo-session.ts DEMO_TOOL_ROUTES). Canned
// answers only (lib/demo-tools.ts): no Google client, no session lookup, so a
// signed-in visitor gets the same sandbox as an anonymous one. The only DB
// touch is the shared rate limiter, which fails closed like /api/session's.

const RATE_LIMITED = {
  error: "rate_limited",
  message: "Too many demo requests, try again later.",
} as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isDemoToolName(tool)) {
    return NextResponse.json({ error: `Outil inconnu: ${tool}` }, { status: 404 });
  }

  let allowed = false;
  try {
    const rl = await consumeRateLimit({
      bucket: DEMO_TOOLS_BUCKET,
      accountId: limiterKey(clientIp(req.headers)),
      windowMs: DEMO_TOOLS_WINDOW_MS,
      perAccount: DEMO_TOOLS_PER_IP,
      global: DEMO_TOOLS_GLOBAL,
    });
    if (!rl.ok) {
      return NextResponse.json(RATE_LIMITED, {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      });
    }
    allowed = true;
  } catch (e) {
    console.error("[demo-tools] rate limiter unavailable", e);
  }
  if (!allowed) return NextResponse.json(RATE_LIMITED, { status: 429 });

  const args: unknown = await req.json().catch(() => ({}));
  const { status, body } = runDemoTool(tool, args, Date.now());
  return NextResponse.json(body, { status });
}
