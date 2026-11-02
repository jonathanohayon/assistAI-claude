import { NextRequest, NextResponse } from "next/server";

import { loadDemoAgent } from "@/lib/demo-agent";

// GET /api/demo-config — PUBLIC. Renvoie la config de l'agent démo de la page
// d'accueil = celle du compte déclaré "démo" dans /admin. L'admin personnalise
// ce compte via son dashboard normal (persona, voix, accueil, langue, business).
// Aucune donnée sensible : seulement persona/voix/accueil/langue + bloc business
// (horaires/prestations) — pas d'accès aux vraies données privées du tenant.
// Built by lib/demo-agent.ts, also used by /api/session for anonymous callers.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const demo = await loadDemoAgent(req.nextUrl.searchParams.get("lang"));
  if (!demo) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, ...demo });
}
