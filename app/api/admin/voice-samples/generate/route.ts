import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { generateMissingSamples } from "@/lib/voice/samples-store";

export const maxDuration = 300;

// POST /api/admin/voice-samples/generate?limit=6 (admin) — renders up to
// `limit` missing samples on the default engine. Idempotent: call again
// until `remaining` is 0 (36 samples = 3 voices × 4 styles × 3 languages).
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 6, 1), 12);
  return NextResponse.json(await generateMissingSamples(limit));
}
