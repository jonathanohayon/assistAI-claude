"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { VOICE_GENDER } from "@/lib/voice-tuning";

// Customer-facing voice names. Supplier voice ids ("marin", "cedar"…) never
// reach the UI: each voice gets a stable Tamara number from its position here.
// Append only — reordering would rename every customer's voice.
export const VOICE_ORDER = [
  "marin",
  "cedar",
  "coral",
  "sage",
  "shimmer",
  "nova",
  "ballad",
  "verse",
  "alloy",
  "echo",
  "ash",
  "fable",
  "onyx",
] as const;

/** Returns `(voiceId) => "Voice 1 · female"` in the active locale. */
export function useVoiceLabel() {
  const t = useTranslations("Voices");
  return useCallback(
    (id: string) => {
      const n = (VOICE_ORDER as readonly string[]).indexOf(id) + 1;
      if (n === 0) return t("custom");
      return t("display", { n, gender: VOICE_GENDER[id] ?? "other" });
    },
    [t],
  );
}
