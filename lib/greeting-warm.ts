// Génération PROACTIVE de l'audio d'accueil : à appeler en fire-and-forget
// après qu'un tenant a sauvé sa config (greeting / voix / langue), pour que le
// 1er appel soit déjà instantané. Relit l'état post-update → toujours cohérent.
// Best-effort : ne throw jamais (le lazy de l'endpoint reste le filet).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import {
  getGreetingAudio,
  putGreetingAudio,
} from "@/lib/greeting-audio-storage";
import { renderOpenerAudio } from "@/lib/greeting-render";
import { buildOpenerText, openerHash } from "@/lib/opener";

export async function warmGreetingAudioForUser(userId: string): Promise<void> {
  try {
    const [cfg] = await db
      .select({
        greeting: agentConfigs.greetingInstructions,
        voice: agentConfigs.voice,
        language: agentConfigs.primaryLanguage,
        model: agentConfigs.model,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .limit(1);
    if (!cfg) return;

    const language = cfg.language ?? "fr";
    const text = buildOpenerText(cfg.greeting ?? "", language);
    if (!text) return;

    const key = {
      userId,
      textHash: openerHash(text),
      voice: cfg.voice,
      language,
    };
    if (await getGreetingAudio(key)) return; // déjà en cache

    const r = await renderOpenerAudio({
      text,
      voice: cfg.voice,
      model: cfg.model,
    });
    await putGreetingAudio(key, r.pcm, r.sampleRate);
  } catch {
    /* best-effort */
  }
}
