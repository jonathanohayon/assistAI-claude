// App-wide singleton settings (key/value). Currently used for the global
// system prompt that every tenant inherits in front of their own persona.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

export const SETTING_KEYS = {
  GLOBAL_INSTRUCTIONS: "global_instructions",
  // Default persona seeded into a new tenant's agent_config at signup time.
  // Empty → fall back to the hard-coded INITIAL_INSTRUCTIONS in lib/initial-config.
  ONBOARDING_TEMPLATE: "onboarding_persona_template",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getGlobalInstructions(): Promise<string> {
  return (await getSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS)) ?? "";
}

export async function getOnboardingTemplate(): Promise<string> {
  return (await getSetting(SETTING_KEYS.ONBOARDING_TEMPLATE)) ?? "";
}
