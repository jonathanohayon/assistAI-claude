// Public landing demo agent, built server-side from the demo account's
// config, for /api/session (what a demo session runs): a demo caller can't
// supply its own instructions. Never sent to the browser: the public
// /api/demo-config route that returned it was removed (the demo page no
// longer needs it, see lib/demo-session.ts).

import { eq } from "drizzle-orm";

import { renderBusinessPromptBlock, sanitizeBusinessConfig } from "@/lib/business";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { demoRegisterDirective } from "@/lib/demo-register";
import { getDemoUserId } from "@/lib/settings";

const langLabel: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais (US)",
};

// Re-exported for callers that imported it from here.
export { DEMO_SESSION_OPENING } from "@/lib/demo-instructions";

export interface DemoAgent {
  instructions: string;
  voice: string | null;
  model: string | null;
  speed: number | null;
  greeting: string;
  primaryLanguage: string;
}

export async function loadDemoAgent(
  langParam: string | null,
): Promise<DemoAgent | null> {
  const demoUserId = await getDemoUserId();
  if (!demoUserId) return null;

  // Langue forcée par la page d'accueil (?lang=fr|he|en). L'agent démo parle
  // CETTE langue, indépendamment de la langue configurée sur le compte démo.
  const forcedLang =
    langParam && ["fr", "he", "en"].includes(langParam) ? langParam : null;
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
  if (!cfg) return null;

  // Langue de l'agent : celle forcée par la page si fournie, sinon celle du compte.
  const primary = forcedLang ?? cfg.primaryLanguage ?? "fr";

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

  const langName = langLabel[primary] ?? "français";
  const languageDirective = `LANGUE : parle EXCLUSIVEMENT en ${langName} (code: ${primary}) pendant tout l'appel — accueil ET réponses. Ne réponds JAMAIS dans une autre langue, même en cas d'hésitation.`;

  const instructions = [
    cfg.instructions ?? "",
    businessBlock,
    languageDirective,
    demoRegisterDirective(primary),
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  return {
    instructions,
    voice: cfg.voice ?? null,
    model: cfg.model ?? null,
    speed: typeof cfg.speed === "number" ? cfg.speed : null,
    greeting: cfg.greetingInstructions ?? "",
    primaryLanguage: primary,
  };
}
