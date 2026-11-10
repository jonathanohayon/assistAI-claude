import { NextResponse } from "next/server";

import { requireSession, sessionIsAdmin } from "@/lib/api/auth-guards";
import { sampleUrl, sampleVisible } from "@/lib/voice/samples";
import { availableSampleKeys } from "@/lib/voice/samples-store";

// GET /api/voice/samples → { samples: [{ voiceId, style, language, url }] }
// Only samples that exist (the Listen button renders only for those).
// Tenants see the styles they can pick (just "warm" until V6 is heard).
// No supplier name anywhere in the JSON or the URLs.
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const isAdmin = await sessionIsAdmin();
  const samples = (await availableSampleKeys())
    .filter((k) => sampleVisible(k, isAdmin))
    .map((k) => ({ voiceId: k.voiceId, style: k.style, language: k.language, url: sampleUrl(k) }));
  return NextResponse.json({ samples });
}
