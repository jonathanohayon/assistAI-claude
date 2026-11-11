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
import { resolveVoiceChoice } from "@/lib/voice/choice";
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
  const voice = resolveVoiceChoice(current, plan.voice, body.voiceConfig, effectiveRealtimeProvider(row.realtimeProvider));
  const cols = inboundColumnsFromVoice(voice, row.model);
  if (!allowedVoices(cols.model).includes(cols.voice)) {
    return { error: { status: 400, body: { error: "invalid_voice_config", fields: ["voice.voiceId: not supported by this model"] } } };
  }
  return { updates: { ...cols, voiceConfig: voice }, voice };
}

/** Inbound legacy write: the voice to store next to the merged row. */
export function inboundVoiceConfigAfterLegacy(
  row: InboundVoiceColumns & { voiceConfig: unknown },
  updates: Partial<InboundVoiceColumns>,
): Voice {
  return inboundVoiceAfterLegacyWrite(row.voiceConfig, { ...row, ...updates });
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
  const plan = planVoiceWrite(currentOutboundVoice(row.voiceConfig, row), body.voiceConfig, isAdmin);
  if (!plan.ok) return { error: { status: plan.status, body: { error: plan.error, fields: plan.fields } } };
  return {
    updates: { ...outboundColumnsFromVoice(plan.voice, row.personality as AgentPersonality | null), voiceConfig: plan.voice },
    voice: plan.voice,
  };
}

/** Outbound legacy write: the voice to store next to the merged row. */
export function outboundVoiceConfigAfterLegacy(
  row: OutboundVoiceColumns & { voiceConfig: unknown },
  updates: Partial<OutboundVoiceColumns>,
): Voice {
  return outboundVoiceAfterLegacyWrite(row.voiceConfig, { ...row, ...updates });
}
