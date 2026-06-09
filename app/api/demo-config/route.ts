import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { renderBusinessPromptBlock, sanitizeBusinessConfig } from "@/lib/business";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { getDemoUserId } from "@/lib/settings";

// GET /api/demo-config — PUBLIC. Renvoie la config de l'agent démo de la page
// d'accueil = celle du compte déclaré "démo" dans /admin. L'admin personnalise
// ce compte via son dashboard normal (persona, voix, accueil, langue, business).
// Aucune donnée sensible : seulement persona/voix/accueil/langue + bloc business
// (horaires/prestations) — pas d'accès aux vraies données privées du tenant.
export const dynamic = "force-dynamic";

const langLabel: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais (US)",
};

export async function GET() {
  const demoUserId = await getDemoUserId();
  if (!demoUserId) return NextResponse.json({ configured: false });

  const [cfg] = await db
    .select({
      instructions: agentConfigs.instructions,
      greetingInstructions: agentConfigs.greetingInstructions,
      voice: agentConfigs.voice,
      model: agentConfigs.model,
      speed: agentConfigs.speed,
      primaryLanguage: agentConfigs.primaryLanguage,
      business: agentConfigs.business,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, demoUserId))
    .limit(1);
  if (!cfg) return NextResponse.json({ configured: false });

  const primary = cfg.primaryLanguage ?? "fr";

  // Bloc business (horaires / prestations) — marketing-safe.
  let businessBlock = "";
  try {
    if (cfg.business && typeof cfg.business === "object") {
      businessBlock = renderBusinessPromptBlock(
        sanitizeBusinessConfig(cfg.business),
      );
    }
  } catch {
    /* business mal formé → on ignore le bloc */
  }

  const languageDirective = `LANGUE PAR DÉFAUT : ${langLabel[primary] ?? "français"} (code: ${primary}).
- Utilise cette langue pour le tout premier message d'accueil.
- Dès que ton interlocuteur parle, détecte sa langue et réponds dans la sienne.`;

  const instructions = [cfg.instructions ?? "", businessBlock, languageDirective]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  return NextResponse.json({
    configured: true,
    instructions,
    voice: cfg.voice ?? null,
    model: cfg.model ?? null,
    speed: typeof cfg.speed === "number" ? cfg.speed : null,
    greeting: cfg.greetingInstructions ?? "",
    primaryLanguage: primary,
  });
}
