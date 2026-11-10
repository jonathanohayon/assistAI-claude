import { NextResponse } from "next/server";

import { requireSession, sessionIsAdmin } from "@/lib/api/auth-guards";
import { sampleVisible, versionedSampleUrl } from "@/lib/voice/samples";
import { availableSampleKeys } from "@/lib/voice/samples-store";

// GET /api/voice/samples → { samples: [{ voiceId, style, language, url }] }
// `url` is versioned (?v=…) so a re-rendered sample bypasses the 24 h cache.
// Only samples that exist (the Listen button renders only for those).
// Tenants see the styles they can pick (just "warm" until V6 is heard).
// No supplier name anywhere in the JSON or the URLs.
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const isAdmin = await sessionIsAdmin();
  const samples = (await availableSampleKeys())
    .filter((k) => sampleVisible(k, isAdmin))
    .map((k) => ({ voiceId: k.voiceId, style: k.style, language: k.language, url: versionedSampleUrl(k, k.createdAt) }));
  return NextResponse.json({ samples });
}
