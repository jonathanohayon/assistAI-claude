// `voice` → the engine settings the worker consumes today. Pure.
//
// These are exactly the fields the worker reads to build the voice engine
// (config-fetcher → agent.ts): realtimeProvider, model, voice, speed (the
// BASE speed: the worker multiplies it by the pace factor itself),
// noiseReductionLevel and the full voiceProfile. Until worker V2 lands, the
// web keeps serving these legacy fields; they must stay byte-identical.

import { VOICE_STYLE_PRESETS, type Voice } from "@/lib/voice/contract";
import type { RealtimeProvider } from "@/lib/realtime-provider";
import { DEFAULT_VOICE_PROFILE, type VoiceProfile } from "@/lib/voice-profile";

export interface EngineSettings {
  realtimeProvider: RealtimeProvider;
  model: string;
  voice: string;
  speed: number;
  noiseReductionLevel: number;
  voiceProfile: VoiceProfile;
}

export interface EngineContext {
  /** Model used when the voice doesn't name one (inbound column default / outbound env). */
  defaultModel: string;
  /**
   * false = the voice's own values, without the style preset. Used to write
   * the legacy columns (which hold base values): applying the style there
   * would apply it twice once it is served. Default true.
   */
  applyStyle?: boolean;
}

/** Base speed × style factor, rounded like the stored speeds (3 decimals). */
function styledSpeed(base: number, factor: number): number {
  return factor === 1 ? base : Math.round(base * factor * 1000) / 1000;
}

export function toEngineSettings(v: Voice, ctx: EngineContext): EngineSettings {
  const a = v.advanced;
  const provider: RealtimeProvider = v.engine === "auto" ? "openai" : v.engine;
  // Style preset (V6). "warm" is empty on every engine = today, unchanged.
  const preset =
    ctx.applyStyle === false ? VOICE_STYLE_PRESETS.warm[provider] : VOICE_STYLE_PRESETS[v.style][provider];
  // No preset text → the tenant's line verbatim (byte-identical to today).
  const speakingStyle = preset.instruction
    ? [preset.instruction, a.speakingStyle.trim()].filter(Boolean).join(" ")
    : a.speakingStyle;
  return {
    realtimeProvider: provider,
    model: a.model ?? ctx.defaultModel,
    voice: v.voiceId,
    speed: styledSpeed(a.speed ?? 1, preset.speedFactor),
    noiseReductionLevel: v.noiseReduction,
    voiceProfile: {
      ...DEFAULT_VOICE_PROFILE,
      turnSensitivity: v.patience,
      bargeIn: v.bargeIn,
      keyTerms: v.keyTerms,
      languageHint: a.languageHint,
      voiceOverrides: a.voiceOverrides,
      minInterruptionMs: a.minInterruptionMs,
      idleHangupSec: a.idleHangupSec,
      maxDurationMin: a.maxDurationMin,
      pace: v.pace,
      pronunciations: v.pronunciations,
      fillers: a.fillers,
      speakingStyle,
      languageLock: v.languageLock,
      openaiTurnMode: a.openaiTurnMode,
      openaiEagerness: a.openaiEagerness,
      openaiNoiseReduction: a.openaiNoiseReduction,
      openaiReasoning: a.openaiReasoning,
      grokReasoning: a.grokReasoning,
    },
  };
}
