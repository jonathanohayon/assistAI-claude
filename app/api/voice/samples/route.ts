import { NextResponse } from "next/server";

import { requireSession, sessionIsAdmin } from "@/lib/api/auth-guards";
import { sampleVisible, versionedSampleUrl } from "@/lib/voice/samples";
import { sampleEngineStatus } from "@/lib/voice/sample-engines";
import { availableSampleKeys } from "@/lib/voice/samples-store";

// GET /api/voice/samples → { samples: [{ voiceId, style, language, url }] }
// `url` is versioned (?v=…) so a re-rendered sample bypasses the 24 h cache.
// Only samples that exist (the Listen button renders only for those).
// Tenants see the styles they can pick (just "warm" until V6 is heard).
// No supplier name in the tenant JSON or the URLs. Admins also get
// `admin.engines.{openai,gemini,xai}: { keySet, env, ready, total }`.
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const isAdmin = await sessionIsAdmin();
  const all = await availableSampleKeys();
  const samples = all
    .filter((k) => sampleVisible(k, isAdmin))
    .map((k) => ({ voiceId: k.voiceId, style: k.style, language: k.language, url: versionedSampleUrl(k, k.createdAt) }));
  // Admins only: per engine, is the renderer's key set (the env var NAME to
  // set — never a value) and how many samples are ready (V8c).
  return NextResponse.json({ samples, ...(isAdmin ? { admin: { engines: sampleEngineStatus(all) } } : {}) });
}
