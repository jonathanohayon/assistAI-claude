import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { generateMissingEngineSamples, generateMissingSamples } from "@/lib/voice/samples-store";

export const maxDuration = 300;

// POST /api/admin/voice-samples/generate?limit=6[&engine=gemini|xai] (admin)
// — renders up to `limit` missing samples. Idempotent: call again until
// `remaining` is 0. Default engine: 72 samples (6 voices × 4 styles × 3
// languages). engine=gemini: 18 (6 voices × warm × fr/he/en); engine=xai:
// 12 (6 voices × warm × fr/en — xAI has no Hebrew). Calls the provider's
// paid TTS API.
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 6, 1), 12);
  const engine = req.nextUrl.searchParams.get("engine");
  if (engine === "gemini" || engine === "xai") return NextResponse.json(await generateMissingEngineSamples(engine, limit));
  if (engine) return NextResponse.json({ error: "unknown_engine" }, { status: 400 });
  return NextResponse.json(await generateMissingSamples(limit));
}
