// Legacy columns → `voice`. Pure. Two sources today:
//   - inbound: agent_configs (voice, model, speed, realtime_provider,
//     voice_profile, noise_reduction_level)
//   - outbound: outbound_agents (voice, personality sliders,
//     noise_reduction_level; engine and model are not stored)
// Proof: toEngineSettings(fromX(row)) === what the web sends today, field for
// field (scripts/tests/voice-contract.test.ts).

import {
  DEFAULT_VOICE,
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_STYLE,
  VOICE_CONTRACT_VERSION,
  type Voice,
  type VoiceEngine,
} from "@/lib/voice/contract";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";
import { effectiveVoiceProfile, type VoiceProfile } from "@/lib/voice-profile";
import { personalityToRealtime, type AgentPersonality } from "@/lib/voice-tuning";

function fromProfile(
  profile: VoiceProfile,
  parts: { voiceId: string; speed: number; model: string | null; noiseReduction: number; engine: VoiceEngine },
): Voice {
  return {
    version: VOICE_CONTRACT_VERSION,
    voiceId: parts.voiceId,
    style: DEFAULT_VOICE_STYLE,
    pace: profile.pace,
    patience: profile.turnSensitivity,
    bargeIn: profile.bargeIn,
    keyTerms: profile.keyTerms,
    pronunciations: profile.pronunciations,
    noiseReduction: parts.noiseReduction,
    languageLock: profile.languageLock,
    engine: parts.engine,
    advanced: {
      // 1.0 is the preset base; anything else is a kept custom speed.
      speed: parts.speed === 1 ? null : parts.speed,
      model: parts.model,
      languageHint: profile.languageHint,
      voiceOverrides: profile.voiceOverrides,
      minInterruptionMs: profile.minInterruptionMs,
      idleHangupSec: profile.idleHangupSec,
      maxDurationMin: profile.maxDurationMin,
      fillers: profile.fillers,
      speakingStyle: profile.speakingStyle,
      openaiTurnMode: profile.openaiTurnMode,
      openaiEagerness: profile.openaiEagerness,
      openaiNoiseReduction: profile.openaiNoiseReduction,
      openaiReasoning: profile.openaiReasoning,
      grokReasoning: profile.grokReasoning,
    },
  };
}

export interface InboundVoiceColumns {
  voice: string | null;
  model: string | null;
  speed: number | null;
  realtimeProvider: string | null;
  voiceProfile: unknown;
  noiseReductionLevel: number | null;
}

/** agent_configs row → voice. NULL provider = "auto" (served as openai, as today). */
export function fromInboundColumns(row: InboundVoiceColumns): Voice {
  const provider = row.realtimeProvider ? effectiveRealtimeProvider(row.realtimeProvider) : null;
  return fromProfile(effectiveVoiceProfile(row.voiceProfile), {
    voiceId: row.voice || DEFAULT_VOICE_ID,
    speed: row.speed ?? 1,
    model: row.model || null,
    noiseReduction: row.noiseReductionLevel ?? DEFAULT_VOICE.noiseReduction,
    engine: provider ?? "auto",
  });
}

export interface OutboundVoiceColumns {
  voice: string | null;
  personality: AgentPersonality | null | undefined;
  noiseReductionLevel: number | null;
}

/** outbound_agents row → voice. Engine auto, model from the env (not stored), default profile. */
export function fromOutboundColumns(row: OutboundVoiceColumns): Voice {
  const tuning = personalityToRealtime(row.personality, row.noiseReductionLevel);
  return fromProfile(effectiveVoiceProfile(null), {
    voiceId: row.voice || DEFAULT_VOICE_ID,
    speed: tuning.speed,
    model: null,
    noiseReduction: tuning.noiseReductionLevel,
    engine: "auto",
  });
}
