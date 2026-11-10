import { NextRequest, NextResponse } from "next/server";

import { requireSession, sessionIsAdmin } from "@/lib/api/auth-guards";
import { parseSampleKey, pcmToWav, sampleVisible } from "@/lib/voice/samples";
import { getSample } from "@/lib/voice/samples-store";

interface Ctx {
  params: Promise<{ voiceId: string; style: string; language: string }>;
}

// GET /api/voice/samples/:voiceId/:style/:language → audio/wav (404 if not rendered).
export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const { voiceId, style, language } = await ctx.params;
  const key = parseSampleKey(voiceId, style, language);
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!sampleVisible(key, await sessionIsAdmin())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await getSample(key);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(pcmToWav(row.audioPcm, row.sampleRate)), {
    headers: { "content-type": "audio/wav", "cache-control": "private, max-age=86400" },
  });
}
