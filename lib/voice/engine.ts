// `voice` → the engine settings the worker consumes today. Pure.
//
// These are exactly the fields the worker reads to build the voice engine
// (config-fetcher → agent.ts): realtimeProvider, model, voice, speed (the
// BASE speed: the worker multiplies it by the pace factor itself),
// noiseReductionLevel and the full voiceProfile. Until worker V2 lands, the
// web keeps serving these legacy fields; they must stay byte-identical.

import type { Voice } from "@/lib/voice/contract";
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
}

export function toEngineSettings(v: Voice, ctx: EngineContext): EngineSettings {
  const a = v.advanced;
  return {
    realtimeProvider: v.engine === "auto" ? "openai" : v.engine,
    model: a.model ?? ctx.defaultModel,
    voice: v.voiceId,
    speed: a.speed ?? 1,
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
      speakingStyle: a.speakingStyle,
      languageLock: v.languageLock,
      openaiTurnMode: a.openaiTurnMode,
      openaiEagerness: a.openaiEagerness,
      openaiNoiseReduction: a.openaiNoiseReduction,
      openaiReasoning: a.openaiReasoning,
      grokReasoning: a.grokReasoning,
    },
  };
}
