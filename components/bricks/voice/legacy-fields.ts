// Legacy voice fields a screen must NOT send next to `voiceConfig`
// (400 voice_config_conflict). Browser-safe copy of the lists in
// lib/voice/store.ts (server code, which also imports the engine mapping);
// scripts/tests/voice-brick.test.ts fails if the two ever differ.

export const LEGACY_INBOUND_VOICE_FIELDS = [
  "voice",
  "speed",
  "temperature",
  "model",
  "realtimeProvider",
  "voiceProfile",
  "noiseReductionLevel",
] as const;

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
