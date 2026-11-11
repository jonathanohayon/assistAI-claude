"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { VOICE_ORDER } from "@/lib/voice/public";
import { VOICE_GENDER } from "@/lib/voice-tuning";

// Customer-facing voice names: the stable numbers live in lib/voice/public.ts
// (VOICE_ORDER, append only), shared with the server's voice choice (V8c).
export { VOICE_ORDER } from "@/lib/voice/public";

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
