// Regenerates lib/voice/contract.json from lib/voice/*.ts: the shared rules
// plus worked examples (voice → engine settings, computed by THE web mapping).
// The worker vendors this file byte-for-byte (src/voice/contract.json) and
// its tests check both its data and its mapping against it.
// Run with:  npx tsx scripts/voice-contract-json.ts
import { writeFileSync } from "node:fs";

import { fromInboundColumns, fromOutboundColumns } from "../lib/voice/adapters";
import { DEFAULT_VOICE, voiceContractRules, type Voice } from "../lib/voice/contract";
import { toEngineSettings } from "../lib/voice/engine";

const withModel = (v: Voice, model: string): Voice => ({ ...v, advanced: { ...v.advanced, model: v.advanced.model ?? model } });

// Mock rows only (public repos).
const voices: Voice[] = [
  withModel(DEFAULT_VOICE, "gpt-realtime-2"),
  withModel(
    fromInboundColumns({
      voice: "cedar", model: "gpt-realtime-2.1", speed: 1.13, realtimeProvider: "xai", noiseReductionLevel: 6,
      voiceProfile: { turnSensitivity: 2, pace: "fast", bargeIn: false, keyTerms: ["Mock"], grokReasoning: "none" },
    }),
    "gpt-realtime-2",
  ),
  withModel(
    fromInboundColumns({
      voice: "sage", model: "gpt-realtime-2", speed: 0.9, realtimeProvider: "gemini", noiseReductionLevel: 10,
      voiceProfile: {
        turnSensitivity: 5, languageHint: "he", voiceOverrides: { gemini: "Kore" }, minInterruptionMs: 800,
        idleHangupSec: 45, maxDurationMin: 20, pace: "slow", pronunciations: [{ term: "Mock", sayAs: "mok" }],
        fillers: false, speakingStyle: "brief", languageLock: true, openaiTurnMode: "semantic_vad",
        openaiEagerness: "low", openaiNoiseReduction: "far_field", openaiReasoning: "medium",
      },
    }),
    "gpt-realtime-2",
  ),
  withModel(fromOutboundColumns({ voice: "echo", personality: { vitesse: 7 }, noiseReductionLevel: 5 }), "gpt-realtime"),
];

const examples = voices.map((voice) => ({ voice, engine: toEngineSettings(voice, { defaultModel: "unused" }) }));

writeFileSync(
  new URL("../lib/voice/contract.json", import.meta.url),
  JSON.stringify({ ...voiceContractRules(), examples }, null, 2) + "\n",
);
console.log("lib/voice/contract.json written");
