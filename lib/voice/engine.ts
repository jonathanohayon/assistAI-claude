// `voice` → the engine settings the worker consumes today. Pure.
//
// These are exactly the fields the worker reads to build the voice engine
// (config-fetcher → agent.ts): realtimeProvider, model, voice, speed (the
// BASE speed: the worker multiplies it by the pace factor itself),
// noiseReductionLevel and the full voiceProfile. Until worker V2 lands, the
// web keeps serving these legacy fields; they must stay byte-identical.

import { VOICE_STYLE_PRESETS, type Voice } from "@/lib/voice/contract";
import type { RealtimeProvider } from "@/lib/realtime-provider";
import { PACE_SPEED } from "@/lib/voice/public";
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
type EndPace = "very_slow" | "very_fast";
const isEndPace = (p: string): p is EndPace => p === "very_slow" || p === "very_fast";
/** Gemini / Grok: stronger than the worker's slow / fast sentences. Provisional until heard. */
export const END_PACE_WORDS: Record<EndPace, string> = {
  very_slow: "Speak very slowly and clearly, with a short pause between sentences.",
  very_fast: "Speak fast and keep every sentence short, without rushing the words.",
};

function styledSpeed(base: number, factor: number): number {
  return factor === 1 ? base : Math.round(base * factor * 1000) / 1000;
}

export function toEngineSettings(v: Voice, ctx: EngineContext): EngineSettings {
  const a = v.advanced;
  const provider: RealtimeProvider = v.engine === "auto" ? "openai" : v.engine;
  // Style preset (V6). "warm" is empty on every engine = today, unchanged.
  const preset =
    ctx.applyStyle === false ? VOICE_STYLE_PRESETS.warm[provider] : VOICE_STYLE_PRESETS[v.style][provider];
  // V9a: the two new pace ends are FOLDED into fields the live worker reads
  // (it knows only slow / normal / fast): served pace "normal" + the factor in
  // the OpenAI speed, or a stronger sentence for Gemini / Grok. Only when
  // serving — the legacy columns keep the real pace (applyStyle: false).
  const folded = ctx.applyStyle !== false && isEndPace(v.pace);
  const paceWords = folded && provider !== "openai" ? END_PACE_WORDS[v.pace as EndPace] : "";
  // No preset text → the tenant's line verbatim (byte-identical to today).
  const styleLine = preset.instruction
    ? [preset.instruction, a.speakingStyle.trim()].filter(Boolean).join(" ")
    : a.speakingStyle;
  const speakingStyle = paceWords ? [paceWords, styleLine.trim()].filter(Boolean).join(" ") : styleLine;
  const baseSpeed = styledSpeed(a.speed ?? 1, preset.speedFactor);
  return {
    realtimeProvider: provider,
    model: a.model ?? ctx.defaultModel,
    voice: v.voiceId,
    speed: folded && provider === "openai" ? styledSpeed(baseSpeed, PACE_SPEED[v.pace]) : baseSpeed,
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
      pace: folded ? "normal" : v.pace,
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
