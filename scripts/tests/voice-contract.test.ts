// Voice contract v1 (lib/voice/*). PROOF: building `voice` from today's
// columns and mapping it to engine settings gives EXACTLY what the web sends
// the worker today, for inbound (default + with a profile) and outbound
// (default + sliders). Mock data only.
// Run with:  npx tsx scripts/tests/voice-contract.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fromInboundColumns, fromOutboundColumns } from "../../lib/voice/adapters";
import {
  DEFAULT_VOICE,
  mergeVoice,
  paceMode,
  parseVoice,
  STYLE_SELECTOR_TENANT_VISIBLE,
  VOICE_FIELD_LEVEL,
  VOICE_GENDER,
  VOICE_IDS,
  VOICE_STYLES,
  voiceContractRules,
} from "../../lib/voice/contract";
import { toEngineSettings } from "../../lib/voice/engine";
import { effectiveRealtimeProvider } from "../../lib/realtime-provider";
import { DEFAULT_VOICE_PROFILE, effectiveVoiceProfile } from "../../lib/voice-profile";
import { personalityToRealtime, VOICE_GENDER as LEGACY_GENDER } from "../../lib/voice-tuning";

// ── Today's payloads, written out from the current routes ───────────────
// /api/agent/config spreads the agent_configs row and resolves provider +
// profile; the worker then reads exactly these six fields.
function inboundToday(row: {
  voice: string; model: string; speed: number; realtimeProvider: string | null;
  voiceProfile: unknown; noiseReductionLevel: number;
}) {
  return {
    realtimeProvider: effectiveRealtimeProvider(row.realtimeProvider),
    model: row.model,
    voice: row.voice,
    speed: row.speed,
    noiseReductionLevel: row.noiseReductionLevel,
    voiceProfile: effectiveVoiceProfile(row.voiceProfile),
  };
}
// /api/agent/campaign-config and outbound-test-config: model from the env,
// no provider (worker → openai), no profile (worker → defaults).
const OUTBOUND_MODEL = "gpt-realtime";
function outboundToday(agent: { voice: string | null; personality: unknown; noiseReductionLevel: number }) {
  const tuning = personalityToRealtime(agent.personality as never, agent.noiseReductionLevel);
  return {
    realtimeProvider: "openai",
    model: OUTBOUND_MODEL,
    voice: agent.voice || "marin",
    speed: tuning.speed,
    noiseReductionLevel: tuning.noiseReductionLevel,
    voiceProfile: DEFAULT_VOICE_PROFILE,
  };
}

// ── Inbound ─────────────────────────────────────────────────────────────
const inboundRows = [
  // column defaults, nothing set
  { voice: "marin", model: "gpt-realtime-2", speed: 1, realtimeProvider: null, voiceProfile: null, noiseReductionLevel: 8 },
  // custom speed + Grok + a partial admin profile
  {
    voice: "cedar", model: "gpt-realtime-2", speed: 1.13, realtimeProvider: "xai", noiseReductionLevel: 6,
    voiceProfile: { turnSensitivity: 2, pace: "fast", bargeIn: false, keyTerms: ["Mock Salon"], grokReasoning: "none" },
  },
  // full profile, Gemini, every engine-specific field moved
  {
    voice: "sage", model: "gpt-realtime-2.1", speed: 0.9, realtimeProvider: "gemini", noiseReductionLevel: 10,
    voiceProfile: {
      ...DEFAULT_VOICE_PROFILE, turnSensitivity: 5, languageHint: "he", voiceOverrides: { gemini: "Kore" },
      minInterruptionMs: 800, idleHangupSec: 45, maxDurationMin: 20, pace: "slow",
      pronunciations: [{ term: "Mock", sayAs: "mok" }], fillers: false, speakingStyle: "brief",
      languageLock: true, openaiTurnMode: "semantic_vad", openaiEagerness: "low",
      openaiNoiseReduction: "far_field", openaiReasoning: "medium",
    },
  },
  // an explicit "openai" provider and an invalid stored profile
  { voice: "ash", model: "gpt-realtime-2", speed: 1, realtimeProvider: "openai", voiceProfile: { turnSensitivity: 99 }, noiseReductionLevel: 1 },
];
for (const [i, row] of inboundRows.entries()) {
  const voice = fromInboundColumns(row);
  assert.equal(parseVoice(voice).ok, true, `inbound ${i}: valid voice`);
  assert.deepEqual(toEngineSettings(voice, { defaultModel: "gpt-realtime-2" }), inboundToday(row), `inbound ${i}: identical`);
}
assert.equal(fromInboundColumns(inboundRows[0]).engine, "auto", "NULL provider = auto");
assert.equal(fromInboundColumns(inboundRows[0]).style, "warm");

// ── Outbound ────────────────────────────────────────────────────────────
const outboundRows = [
  { voice: "marin", personality: null, noiseReductionLevel: 8 }, // defaults
  { voice: "echo", personality: { vitesse: 7, creativite: 2, reactivite: 9 }, noiseReductionLevel: 5 }, // sliders
  { voice: null, personality: { vitesse: 1 }, noiseReductionLevel: 10 }, // slowest, voice missing
  { voice: "coral", personality: { vitesse: 5 }, noiseReductionLevel: 8 }, // 5 = 1.0x → preset
];
for (const [i, row] of outboundRows.entries()) {
  const voice = fromOutboundColumns(row);
  assert.equal(parseVoice(voice).ok, true, `outbound ${i}: valid voice`);
  assert.deepEqual(toEngineSettings(voice, { defaultModel: OUTBOUND_MODEL }), outboundToday(row), `outbound ${i}: identical`);
}
// the dead sliders (creativite, reactivite) don't reach the voice at all
assert.deepEqual(
  fromOutboundColumns({ voice: "echo", personality: { vitesse: 7, creativite: 1, reactivite: 1 }, noiseReductionLevel: 5 }),
  fromOutboundColumns({ voice: "echo", personality: { vitesse: 7, creativite: 10, reactivite: 10 }, noiseReductionLevel: 5 }),
);

// ── Defaults = today ────────────────────────────────────────────────────
assert.deepEqual(toEngineSettings(DEFAULT_VOICE, { defaultModel: "gpt-realtime-2" }), {
  realtimeProvider: "openai", model: "gpt-realtime-2", voice: "marin", speed: 1,
  noiseReductionLevel: 8, voiceProfile: DEFAULT_VOICE_PROFILE,
});
assert.deepEqual(fromInboundColumns(inboundRows[0]), { ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, model: "gpt-realtime-2" } });

// ── Pace: preset vs custom ──────────────────────────────────────────────
assert.equal(paceMode(fromInboundColumns(inboundRows[0])), "preset");
const custom = fromInboundColumns(inboundRows[1]);
assert.equal(paceMode(custom), "custom");
assert.equal(custom.advanced.speed, 1.13, "custom speed kept exactly");
{
  // picking a pace clears the custom speed…
  const r = mergeVoice(custom, { pace: "normal" });
  assert.ok(r.ok && r.value.advanced.speed === null && paceMode(r.value) === "preset");
  // …unless the same write sets one; other writes keep it
  const r2 = mergeVoice(custom, { pace: "slow", advanced: { speed: 1.2 } });
  assert.ok(r2.ok && r2.value.advanced.speed === 1.2);
  const r3 = mergeVoice(custom, { bargeIn: true });
  assert.ok(r3.ok && r3.value.advanced.speed === 1.13);
}

// ── Validation ──────────────────────────────────────────────────────────
assert.equal(parseVoice(DEFAULT_VOICE).ok, true);
assert.equal(parseVoice({ ...DEFAULT_VOICE, patience: 6 }).ok, false);
assert.equal(parseVoice({ ...DEFAULT_VOICE, style: "loud" }).ok, false);
assert.equal(parseVoice({ ...DEFAULT_VOICE, engine: "gpt" }).ok, false);
assert.equal(parseVoice({ ...DEFAULT_VOICE, version: 2 }).ok, false);
assert.equal(parseVoice({ ...DEFAULT_VOICE, extra: 1 }).ok, false, "strict: unknown key");
assert.equal(parseVoice({ ...DEFAULT_VOICE, noiseReduction: 0 }).ok, false);
assert.match((parseVoice({ ...DEFAULT_VOICE, patience: 0 }) as { error: string }).error, /^voice\.patience:/);
const merged = mergeVoice(DEFAULT_VOICE, { advanced: { idleHangupSec: 60 } });
assert.ok(merged.ok && merged.value.advanced.idleHangupSec === 60 && merged.value.advanced.fillers === true, "advanced merges key by key");
assert.equal(mergeVoice(DEFAULT_VOICE, { advanced: { idleHangupSec: 5 } }).ok, false);

// ── Tables ──────────────────────────────────────────────────────────────
assert.deepEqual([...VOICE_STYLES], ["warm", "professional", "dynamic", "calm"]);
assert.equal(DEFAULT_VOICE.style, "warm");
assert.equal(STYLE_SELECTOR_TENANT_VISIBLE, false, "styles stay hidden from tenants until V6 is heard");
assert.equal(VOICE_IDS.length, 13);
assert.equal(LEGACY_GENDER, VOICE_GENDER, "one gender table only");
assert.deepEqual(Object.keys(VOICE_FIELD_LEVEL).sort(), Object.keys(DEFAULT_VOICE).filter((k) => k !== "version").sort());
assert.equal(VOICE_FIELD_LEVEL.voiceId, 1);
assert.equal(VOICE_FIELD_LEVEL.patience, 2);
assert.equal(VOICE_FIELD_LEVEL.engine, 3);


// ── Shared rules: the committed JSON (vendored by the worker) = the TS ──
{
  const committed = readFileSync(new URL("../../lib/voice/contract.json", import.meta.url), "utf8");
  assert.equal(
    committed,
    JSON.stringify(voiceContractRules(), null, 2) + "\n",
    "lib/voice/contract.json is stale: run `npx tsx scripts/voice-contract-json.ts` and copy it to the worker",
  );
}

console.log("ALL VOICE-CONTRACT TESTS PASSED");
