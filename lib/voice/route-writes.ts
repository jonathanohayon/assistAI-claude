// Route-side glue for storing `voice` (V5). Pure: builds the column updates;
// the routes do the I/O. See lib/voice/store.ts for the rules.

import type { InboundVoiceColumns, OutboundVoiceColumns } from "@/lib/voice/adapters";
import {
  conflictingFields,
  currentInboundVoice,
  currentOutboundVoice,
  inboundColumnsFromVoice,
  inboundVoiceAfterLegacyWrite,
  LEGACY_INBOUND_VOICE_FIELDS,
  LEGACY_OUTBOUND_VOICE_FIELDS,
  outboundColumnsFromVoice,
  outboundVoiceAfterLegacyWrite,
  planVoiceWrite,
} from "@/lib/voice/store";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";
import { resolveVoiceChoice, voiceAfterEngineSwitch, voiceEngineOf } from "@/lib/voice/choice";
import type { Voice } from "@/lib/voice/contract";
import type { AgentPersonality } from "@/lib/voice-tuning";

export type RouteVoiceError = { status: 400 | 403; body: { error: string; fields?: string[] } };

/**
 * Inbound: a `voiceConfig` patch → the legacy columns + voiceConfig to write.
 * `null` when the body has no voiceConfig (the route's legacy path runs).
 */
export function inboundVoiceConfigUpdates(
  body: Record<string, unknown>,
  row: InboundVoiceColumns & { voiceConfig: unknown; model: string },
  isAdmin: boolean,
  allowedVoices: (model: string) => readonly string[],
): { error: RouteVoiceError } | { updates: Record<string, unknown>; voice: Voice } | null {
  // V8b: a voice CHOSEN by our catalogue id is resolved here, after the
  // admin gate saw the caller's own patch (lib/voice/choice.ts).
  if (!("voiceConfig" in body)) return null;
  const conflict = conflictingFields(body, LEGACY_INBOUND_VOICE_FIELDS);
  if (conflict.length) return { error: { status: 400, body: { error: "voice_config_conflict", fields: conflict } } };
  const current = currentInboundVoice(row.voiceConfig, row);
  const plan = planVoiceWrite(current, body.voiceConfig, isAdmin);
  if (!plan.ok) return { error: { status: plan.status, body: { error: plan.error, fields: plan.fields } } };
  // V8e: an engine switch (admin-only, gated above) carries the voice to its
  // equivalent on the new engine; a voice chosen in the same save wins.
  const from = effectiveRealtimeProvider(row.realtimeProvider);
  const to = voiceEngineOf(plan.voice);
  // An override for the target engine written in this same save wins over
  // the switch: the planned voice is kept as the admin wrote it.
  const voice = resolveVoiceChoice(
    voiceAfterEngineSwitch(current, from, to),
    patchSetsOverride(body.voiceConfig, to) ? plan.voice : voiceAfterEngineSwitch(plan.voice, from, to),
    body.voiceConfig,
    to,
  );
  const cols = inboundColumnsFromVoice(voice, row.model);
  if (!allowedVoices(cols.model).includes(cols.voice)) {
    return { error: { status: 400, body: { error: "invalid_voice_config", fields: ["voice.voiceId: not supported by this model"] } } };
  }
  return { updates: { ...cols, voiceConfig: voice }, voice };
}

/** Does a voiceConfig patch explicitly carry `advanced.voiceOverrides[engine]`? */
function patchSetsOverride(patch: unknown, engine: string): boolean {
  const advanced = (patch as { advanced?: unknown } | null)?.advanced;
  const overrides = advanced && typeof advanced === "object" ? (advanced as { voiceOverrides?: unknown }).voiceOverrides : undefined;
  return !!overrides && typeof overrides === "object" && Object.prototype.hasOwnProperty.call(overrides, engine);
}

/** Inbound legacy write: the voice to store next to the merged row. */
export function inboundVoiceConfigAfterLegacy(
  row: InboundVoiceColumns & { voiceConfig: unknown },
  updates: Partial<InboundVoiceColumns>,
): Voice {
  return inboundVoiceAfterLegacyWrite(row.voiceConfig, { ...row, ...updates });
}

/**
 * Inbound legacy write (admin `realtimeProvider` field): the updates to
 * store, with V8e applied — when the engine changes, the voice follows to its
 * equivalent (voice column / per-engine override). Otherwise exactly the
 * legacy behaviour (voiceConfig refreshed from the merged columns).
 */
export function inboundLegacyVoiceUpdates(
  row: InboundVoiceColumns & { voiceConfig: unknown; model: string },
  updates: Partial<InboundVoiceColumns>,
): Record<string, unknown> {
  const stored = inboundVoiceAfterLegacyWrite(row.voiceConfig, { ...row, ...updates });
  const from = effectiveRealtimeProvider(row.realtimeProvider);
  const to = effectiveRealtimeProvider("realtimeProvider" in updates ? updates.realtimeProvider : row.realtimeProvider);
  if (from === to) return { voiceConfig: stored };
  const voice = voiceAfterEngineSwitch(stored, from, to);
  const cols = inboundColumnsFromVoice(voice, (updates.model as string | undefined) ?? row.model);
  return { voice: cols.voice, voiceProfile: cols.voiceProfile, voiceConfig: voice };
}

/** Outbound: a `voiceConfig` patch → legacy columns + voiceConfig; null if absent. */
export function outboundVoiceConfigUpdates(
  body: Record<string, unknown>,
  row: OutboundVoiceColumns & { voiceConfig: unknown },
  isAdmin: boolean,
): { error: RouteVoiceError } | { updates: Record<string, unknown>; voice: Voice } | null {
  if (!("voiceConfig" in body)) return null;
  const conflict = conflictingFields(body, LEGACY_OUTBOUND_VOICE_FIELDS);
  if (conflict.length) return { error: { status: 400, body: { error: "voice_config_conflict", fields: conflict } } };
  const current = currentOutboundVoice(row.voiceConfig, row);
  const plan = planVoiceWrite(current, body.voiceConfig, isAdmin);
  if (!plan.ok) return { error: { status: plan.status, body: { error: plan.error, fields: plan.fields } } };
  // The agent's speed (the 1–10 "vitesse" slider) is written ONLY by an
  // explicit `advanced.speed`. A pace write used to clear the speed, which
  // reset vitesse to step 6 — "Fast" could make an agent SLOWER. Outbound
  // calls don't use pace (no voice profile served), so it never clears it here.
  const patch = (body.voiceConfig ?? {}) as { advanced?: Record<string, unknown> };
  const speedWritten = !!patch.advanced && typeof patch.advanced === "object" && "speed" in patch.advanced;
  const personality = row.personality as AgentPersonality | null;
  const voice = speedWritten ? plan.voice : { ...plan.voice, advanced: { ...plan.voice.advanced, speed: current.advanced.speed } };
  const cols = outboundColumnsFromVoice(voice, personality);
  if (!speedWritten && personality?.vitesse !== undefined) cols.personality = { ...cols.personality, vitesse: personality.vitesse };
  return { updates: { ...cols, voiceConfig: voice }, voice };
}

/** Outbound legacy write: the voice to store next to the merged row. */
export function outboundVoiceConfigAfterLegacy(
  row: OutboundVoiceColumns & { voiceConfig: unknown },
  updates: Partial<OutboundVoiceColumns>,
): Voice {
  return outboundVoiceAfterLegacyWrite(row.voiceConfig, { ...row, ...updates });
}
