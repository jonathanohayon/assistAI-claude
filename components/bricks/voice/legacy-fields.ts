// Legacy voice fields a screen must NOT send next to `voiceConfig`
// (400 voice_config_conflict). Outbound only: the receptionist form no
// longer holds any legacy voice field (its list names a supplier, so it
// must stay out of tenant code). Browser-safe copy of the list in
// lib/voice/store.ts; scripts/tests/voice-brick-single-screen.test.ts fails
// if the two ever differ.

export const LEGACY_OUTBOUND_VOICE_FIELDS = ["voice", "personality", "noiseReductionLevel"] as const;

/**
 * A screen's save body: its fields without the legacy voice fields, plus the
 * voice patch when something changed. Never both (voice_config_conflict).
 */
export function withVoiceConfig(
  body: Record<string, unknown>,
  legacy: readonly string[],
  patch: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  delete out.voiceConfig;
  for (const k of legacy) delete out[k];
  if (patch) out.voiceConfig = patch;
  return out;
}
