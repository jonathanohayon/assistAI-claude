import { NextRequest, NextResponse } from "next/server";

import {
  DEMO_TOOLS_BUCKET,
  DEMO_TOOLS_GLOBAL,
  DEMO_TOOLS_PER_IP,
  DEMO_TOOLS_WINDOW_MS,
  demoEndpointText,
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

// `error` stays the machine code; `message` is in the visitor's language.
const rateLimited = (lang: string | null) => ({
  error: "rate_limited",
  message: demoEndpointText(lang).rateLimited,
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  // The language the session wrote into the route table (lib/demo-session.ts).
  const lang = req.nextUrl.searchParams.get("lang");
  if (!isDemoToolName(tool)) {
    return NextResponse.json({ error: demoEndpointText(lang).unknownTool(tool) }, { status: 404 });
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
      return NextResponse.json(rateLimited(lang), {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      });
    }
    allowed = true;
  } catch (e) {
    console.error("[demo-tools] rate limiter unavailable", e);
  }
  if (!allowed) return NextResponse.json(rateLimited(lang), { status: 429 });

  const args: unknown = await req.json().catch(() => ({}));
  const { status, body } = runDemoTool(tool, args, Date.now(), lang);
  return NextResponse.json(body, { status });
}
