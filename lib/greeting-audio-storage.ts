// Cache persistant (Postgres) de l'audio d'accueil pré-généré. Server-only.
// Voir docs/superpowers/specs/2026-06-04-instant-greeting-design.md.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { greetingAudio } from "@/lib/db/schema";

// Bump quand on veut forcer un re-render (ex. OpenAI fait évoluer la voix).
export const GREETING_RENDER_VERSION = 1;

export type GreetingKey = {
  userId: string;
  textHash: string;
  voice: string;
  language: string;
};

export async function getGreetingAudio(k: GreetingKey) {
  const [row] = await db
    .select()
    .from(greetingAudio)
    .where(
      and(
        eq(greetingAudio.userId, k.userId),
        eq(greetingAudio.textHash, k.textHash),
        eq(greetingAudio.voice, k.voice),
        eq(greetingAudio.language, k.language),
        eq(greetingAudio.renderVersion, GREETING_RENDER_VERSION),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function putGreetingAudio(
  k: GreetingKey,
  audioPcm: Buffer,
  sampleRate: number,
): Promise<void> {
  await db
    .insert(greetingAudio)
    .values({
      ...k,
      renderVersion: GREETING_RENDER_VERSION,
      audioPcm,
      sampleRate,
    })
    .onConflictDoNothing();
}
