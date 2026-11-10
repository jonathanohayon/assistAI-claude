// Voice brick — ADMIN-ONLY engine mapping. Imported only by
// VoiceAdminFields (loaded with next/dynamic for admins), so supplier names
// never reach a tenant's bundle.

import { ADMIN_ENGINE_OPTIONS, type AdminEngineOptionId } from "@/lib/realtime-provider";
import type { Voice } from "@/lib/voice/contract";

export { ADMIN_ENGINE_OPTIONS };

/** Which admin engine option a voice is on ("custom" = a model outside the list). */
export function engineOptionOf(v: Pick<Voice, "engine" | "advanced">): AdminEngineOptionId | "custom" {
  if (v.engine === "gemini") return "gemini";
  if (v.engine === "xai") return "xai";
  const model = v.advanced.model;
  if (model === null || model === "gpt-realtime-2") return "openai-2";
  if (model === "gpt-realtime-2.1") return "openai-2.1";
  return "custom";
}

/** Patch for picking an admin engine option. OpenAI default = engine "auto". */
export function engineOptionPatch(id: AdminEngineOptionId): Partial<Pick<Voice, "engine">> & {
  advanced: { model: string | null };
} {
  switch (id) {
    case "openai-2":
      return { engine: "auto", advanced: { model: null } };
    case "openai-2.1":
      return { engine: "openai", advanced: { model: "gpt-realtime-2.1" } };
    case "gemini":
      return { engine: "gemini", advanced: { model: null } };
    case "xai":
      return { engine: "xai", advanced: { model: null } };
  }
}
