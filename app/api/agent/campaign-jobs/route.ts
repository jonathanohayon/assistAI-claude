import { NextRequest, NextResponse } from "next/server";

import { claimCampaignJobs } from "@/lib/campaigns/claim";

export const dynamic = "force-dynamic";

// GET ?limit=N — réservé au worker (x-internal-secret). Réclame de façon
// atomique jusqu'à N contacts à appeler (status running, fenêtre d'appel,
// concurrence par campagne, anti-double-dial). Chaque job est enrichi de la
// persona/objectif/schéma d'extraction. Voir lib/campaigns/claim.ts.
//
// NB : à n'utiliser QUE si le worker pilote le dialing (architecture
// worker-poll). Si le dispatcher web cron (/api/cron/campaign-dispatch) est
// actif, ne PAS activer ce poll côté worker — sinon double-claim.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 5;
  const jobs = await claimCampaignJobs(limit);
  return NextResponse.json({ jobs });
}
