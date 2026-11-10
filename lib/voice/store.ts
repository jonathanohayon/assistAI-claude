// Storing `voice` with the agent (V5, write-alongside). Pure.
//
// - agent_configs.voice_config / outbound_agents.voice_config hold the Voice
//   contract (NULL = never written: derived from the legacy columns).
// - EVERY reader still uses the legacy columns (switching readers is a
//   separate PR, released with worker V2). So:
//     · a `voiceConfig` write ALSO writes the legacy columns it maps to;
//     · a legacy write ALSO refreshes the stored voice.
// - A request carrying both `voiceConfig` and legacy voice fields is refused
//   (ambiguous): 400 voice_config_conflict.
// - Admin-only paths (engine, model, provider-specific settings — their names
//   expose a provider) can't be changed by a tenant: 403 admin_only.

import {
  fromInboundColumns,
  fromOutboundColumns,
  type InboundVoiceColumns,
  type OutboundVoiceColumns,
} from "@/lib/voice/adapters";
import { mergeVoice, parseVoice, type Voice } from "@/lib/voice/contract";
import { toEngineSettings } from "@/lib/voice/engine";
import type { RealtimeProvider } from "@/lib/realtime-provider";
import type { VoiceProfile } from "@/lib/voice-profile";
import { clamp10, uiFromSpeed, type AgentPersonality } from "@/lib/voice-tuning";

/** Legacy body fields that conflict with a `voiceConfig` in the same request. */
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

/** Paths only an admin may change (provider names / engine choice). */
export const VOICE_ADMIN_ONLY_PATHS = [
  "engine",
  "advanced.model",
  "advanced.voiceOverrides",
  "advanced.openaiTurnMode",
  "advanced.openaiEagerness",
  "advanced.openaiNoiseReduction",
  "advanced.openaiReasoning",
  "advanced.grokReasoning",
] as const;

const get = (v: Voice, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function conflictingFields(body: Record<string, unknown>, legacy: readonly string[]): string[] {
  return "voiceConfig" in body ? legacy.filter((f) => f in body) : [];
}

export type VoiceWrite =
  | { ok: true; voice: Voice }
  | { ok: false; status: 400 | 403; error: string; fields?: string[] };

/** Partial `voiceConfig` patch onto the current voice, with the admin gate. */
export function planVoiceWrite(current: Voice, patch: unknown, isAdmin: boolean): VoiceWrite {
  const merged = mergeVoice(current, patch);
  if (!merged.ok) return { ok: false, status: 400, error: "invalid_voice_config", fields: [merged.error] };
  if (!isAdmin) {
    const changed = VOICE_ADMIN_ONLY_PATHS.filter((p) => !same(get(current, p), get(merged.value, p)));
    if (changed.length) return { ok: false, status: 403, error: "admin_only", fields: changed };
  }
  return { ok: true, voice: merged.value };
}

/** The stored voice if valid, else derived from the legacy columns. */
export function currentInboundVoice(stored: unknown, row: InboundVoiceColumns): Voice {
  const s = parseVoice(stored);
  return s.ok ? s.value : fromInboundColumns(row);
}
export function currentOutboundVoice(stored: unknown, row: OutboundVoiceColumns): Voice {
  const s = parseVoice(stored);
  return s.ok ? s.value : fromOutboundColumns(row);
}

// ── voice → legacy columns (a voiceConfig write) ───────────────────────

export interface InboundLegacyColumns {
  voice: string;
  model: string;
  speed: number;
  realtimeProvider: RealtimeProvider | null;
  voiceProfile: VoiceProfile;
  noiseReductionLevel: number;
}

/**
 * Inbound columns are a full image of the voice except `style` (not stored
 * in legacy columns): fromInboundColumns(result) gives the voice back.
 */
export function inboundColumnsFromVoice(v: Voice, currentModel: string): InboundLegacyColumns {
  // Base values only: the style is applied when serving, never stored twice.
  const e = toEngineSettings(v, { defaultModel: currentModel, applyStyle: false });
  return {
    voice: e.voice,
    model: e.model,
    speed: e.speed,
    realtimeProvider: v.engine === "auto" ? null : v.engine,
    voiceProfile: e.voiceProfile,
    noiseReductionLevel: e.noiseReductionLevel,
  };
}

export interface OutboundLegacyColumns {
  voice: string;
  personality: AgentPersonality;
  noiseReductionLevel: number;
}

/**
 * Outbound legacy columns only hold voice, a 1–10 speed slider and the noise
 * level. Engine, profile and style live in voice_config only (served once
 * readers switch); the speed is rounded to the nearest slider step.
 */
export function outboundColumnsFromVoice(
  v: Voice,
  currentPersonality: AgentPersonality | null | undefined,
): OutboundLegacyColumns {
  return {
    voice: v.voiceId,
    personality: { ...(currentPersonality ?? {}), vitesse: clamp10(uiFromSpeed(v.advanced.speed ?? 1)) },
    noiseReductionLevel: v.noiseReduction,
  };
}

// ── legacy columns → stored voice (a legacy write) ─────────────────────

/** After a legacy inbound write: the voice re-derived, the stored style kept. */
export function inboundVoiceAfterLegacyWrite(stored: unknown, row: InboundVoiceColumns): Voice {
  const derived = fromInboundColumns(row);
  const s = parseVoice(stored);
  return s.ok ? { ...derived, style: s.value.style } : derived;
}

/**
 * After a legacy outbound write: only what the columns hold is refreshed
 * (voice, speed, noise); engine, profile and style stored in voice_config stay.
 */
export function outboundVoiceAfterLegacyWrite(stored: unknown, row: OutboundVoiceColumns): Voice {
  const derived = fromOutboundColumns(row);
  const s = parseVoice(stored);
  if (!s.ok) return derived;
  return {
    ...s.value,
    voiceId: derived.voiceId,
    noiseReduction: derived.noiseReduction,
    advanced: { ...s.value.advanced, speed: derived.advanced.speed },
  };
}

// ── What a viewer may see ───────────────────────────────────────────────

/** Voice as returned to a tenant: admin-only paths removed (no provider trace). */
export type VoiceForTenant = Omit<Voice, "engine" | "advanced"> & {
  advanced: Omit<
    Voice["advanced"],
    "model" | "voiceOverrides" | "openaiTurnMode" | "openaiEagerness" | "openaiNoiseReduction" | "openaiReasoning" | "grokReasoning"
  >;
};

export function voiceForViewer(v: Voice, isAdmin: boolean): Voice | VoiceForTenant {
  if (isAdmin) return v;
  const { engine: _e, advanced, ...rest } = v;
  void _e;
  const {
    model: _m,
    voiceOverrides: _vo,
    openaiTurnMode: _t,
    openaiEagerness: _ea,
    openaiNoiseReduction: _n,
    openaiReasoning: _r,
    grokReasoning: _g,
    ...adv
  } = advanced;
  void [_m, _vo, _t, _ea, _n, _r, _g];
  return { ...rest, advanced: adv };
}
