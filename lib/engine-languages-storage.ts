// Engine language table, server side: app_settings "engine_languages_v1"
// (lib/engine-languages.ts holds the types, defaults and the strict parser).
// SERVER-ONLY (lib/db). Same pattern as lib/products.ts (product catalogue).

import { alertAdmins } from "@/lib/alerts";
import {
  engineLanguagesFromStored,
  parseEngineLanguages,
  type EngineLanguageChange,
  type EngineLanguages,
} from "@/lib/engine-languages";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

export type EngineLanguagesDeps = {
  read: (key: string) => Promise<string | null>;
  onInvalid: () => void;
};

const defaultDeps: EngineLanguagesDeps = {
  read: getSetting,
  onInvalid: () => {
    console.warn(`[engine-languages] app_settings.${SETTING_KEYS.ENGINE_LANGUAGES} is invalid; serving the defaults`);
    // Never throws (alertAdmins catches); deduplicated to one alert a day.
    void alertAdmins({
      key: "engine_languages_invalid",
      subject: "Engine language table is invalid",
      body: `app_settings.${SETTING_KEYS.ENGINE_LANGUAGES} failed the strict parse; the default language table is served until it is fixed from /admin.`,
      dedupMs: 24 * 60 * 60 * 1000,
      severity: "warning",
    });
  },
};

/** The table in force (stored, else the defaults; invalid → defaults + alert). */
export async function getEngineLanguages(deps: EngineLanguagesDeps = defaultDeps): Promise<EngineLanguages> {
  const r = engineLanguagesFromStored(await deps.read(SETTING_KEYS.ENGINE_LANGUAGES));
  if (r.source === "invalid") deps.onInvalid();
  return r.languages;
}

/** Writes a table that already passed the strict parse. */
export async function setEngineLanguages(t: EngineLanguages): Promise<void> {
  if (!parseEngineLanguages(t)) throw new Error("refusing to store an invalid engine language table");
  await setSetting(SETTING_KEYS.ENGINE_LANGUAGES, JSON.stringify(t));
}

/**
 * The edit-log event for a successful write: who (the admin id) and what
 * changed (engine, model, before/after language lists). No PII: no email,
 * no name, no phone number, only ids and language codes.
 */
export function engineLanguagesEditEvent(adminId: string, changes: EngineLanguageChange[]) {
  return {
    source: "web" as const,
    event: "admin_engine_languages_updated",
    message: `Admin ${adminId} edited engine_languages (${changes.length} ${changes.length === 1 ? "entry" : "entries"})`,
    userId: adminId,
    metadata: { keys: ["engine_languages"], adminId, changes },
  };
}
