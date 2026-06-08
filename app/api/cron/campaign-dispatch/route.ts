import { NextRequest, NextResponse } from "next/server";

import { dispatchDueJobs } from "@/lib/campaigns/dispatch";

export const dynamic = "force-dynamic";

// Cron dispatcher (architecture recommandée) : réclame les contacts dûs et
// origine les appels sortants via LiveKit (CreateSIPParticipant) en
// dispatchant l'agent worker dans chaque room. L'agent conduit l'appel puis
// poste le résultat sur /api/agent/campaign-result.
//
// Auth : x-internal-secret. À hooker sur le scheduler Railway (toutes les ~30s
// à 1 min). `?limit=N` borne le nombre d'appels initiés par tick (défaut 10).
//
// NB : ne PAS activer en même temps que le worker-poll (/api/agent/campaign-
// jobs) — un seul dialer doit tourner, sinon double-claim/double-dial.
export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1),
    50,
  );

  const result = await dispatchDueJobs(limit);
  return NextResponse.json({ ok: true, ...result });
}
