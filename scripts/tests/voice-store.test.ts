// Storing `voice` with the agent (V5, write-alongside): lib/voice/store.ts
// and lib/voice/route-writes.ts. Mock data only.
// Run with:  npx tsx scripts/tests/voice-store.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fromInboundColumns, fromOutboundColumns } from "../../lib/voice/adapters";
import { DEFAULT_VOICE, type Voice } from "../../lib/voice/contract";
import { toEngineSettings } from "../../lib/voice/engine";
import {
  inboundVoiceConfigAfterLegacy,
  inboundVoiceConfigUpdates,
  outboundVoiceConfigAfterLegacy,
  outboundVoiceConfigUpdates,
} from "../../lib/voice/route-writes";
import {
  conflictingFields,
  currentInboundVoice,
  inboundColumnsFromVoice,
  outboundColumnsFromVoice,
  planVoiceWrite,
  VOICE_ADMIN_ONLY_PATHS,
  voiceForViewer,
} from "../../lib/voice/store";
import { agentConfigs, outboundAgents } from "../../lib/db/schema";

const anyVoice = () => ["marin", "cedar", "coral", "ash", "sage", "echo"] as const;
const inboundRow = {
  voice: "marin", model: "gpt-realtime-2", speed: 1, realtimeProvider: null as string | null,
  voiceProfile: null as unknown, noiseReductionLevel: 8, voiceConfig: null as unknown,
};

// migration: nullable JSONB on both tables, idempotent
const sql = readFileSync(new URL("../../drizzle/0041_voice_config.sql", import.meta.url), "utf8");
assert.match(sql, /ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "voice_config" jsonb;/);
assert.match(sql, /ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "voice_config" jsonb;/);
assert.equal(agentConfigs.voiceConfig.notNull, false);
assert.equal(outboundAgents.voiceConfig.notNull, false);

// never written → derived from the columns (read-back unchanged)
assert.deepEqual(currentInboundVoice(null, inboundRow), fromInboundColumns(inboundRow));
assert.deepEqual(currentInboundVoice({ broken: true }, inboundRow), fromInboundColumns(inboundRow), "invalid stored → derived");

// ── inbound voiceConfig write → legacy columns are a full image ─────────
{
  const r = inboundVoiceConfigUpdates(
    { voiceConfig: { voiceId: "cedar", patience: 2, pace: "fast", bargeIn: false, keyTerms: ["Mock"], noiseReduction: 6, style: "calm" } },
    inboundRow, false, anyVoice,
  );
  assert.ok(r && !("error" in r));
  const { voiceConfig, ...cols } = r.updates as Record<string, unknown>;
  assert.equal((voiceConfig as Voice).style, "calm", "style stored in voice_config");
  assert.deepEqual(cols.voice, "cedar");
  assert.deepEqual(cols.realtimeProvider, null, "engine auto = NULL as today");
  // what today's readers will serve after the write = the stored voice's engine settings
  const readBack = fromInboundColumns(cols as never);
  assert.deepEqual(toEngineSettings(readBack, { defaultModel: "x" }), toEngineSettings(r.voice, { defaultModel: "x" }));
  assert.deepEqual({ ...readBack, style: "calm" }, r.voice, "columns hold everything but the style");
}
// a custom speed survives the round trip exactly
{
  const v: Voice = { ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, speed: 1.13, model: "gpt-realtime-2" } };
  assert.deepEqual(fromInboundColumns({ ...inboundColumnsFromVoice(v, "gpt-realtime-2") }), v);
}

// ── admin gate ──────────────────────────────────────────────────────────
{
  const cur = fromInboundColumns(inboundRow);
  for (const patch of [{ engine: "xai" }, { advanced: { model: "gpt-realtime-2.1" } }, { advanced: { grokReasoning: "none" } }, { advanced: { voiceOverrides: { openai: "ash" } } }]) {
    const t = planVoiceWrite(cur, patch, false);
    assert.equal(t.ok, false, JSON.stringify(patch));
    assert.equal(!t.ok && t.status, 403);
    assert.equal(!t.ok && t.error, "admin_only");
    assert.equal(planVoiceWrite(cur, patch, true).ok, true, "admin may");
  }
  // tenant may change level 1/2 fields and unchanged admin fields pass
  assert.equal(planVoiceWrite(cur, { patience: 4, pace: "slow", engine: cur.engine }, false).ok, true);
  // invalid values → 400
  const bad = planVoiceWrite(cur, { patience: 9 }, true);
  assert.ok(!bad.ok && bad.status === 400 && bad.error === "invalid_voice_config");
  assert.deepEqual([...VOICE_ADMIN_ONLY_PATHS].filter((p) => p.startsWith("advanced.")).length, 7);
}
// voice not allowed by the model → 400
{
  const r = inboundVoiceConfigUpdates({ voiceConfig: { voiceId: "unknown" } }, inboundRow, true, anyVoice);
  assert.ok(r && "error" in r && r.error.status === 400);
}

// ── conflicts: voiceConfig + legacy voice fields → refused ──────────────
assert.deepEqual(conflictingFields({ voiceConfig: {}, voice: "ash", speed: 1, instructions: "x" }, ["voice", "speed", "model"]), ["voice", "speed"]);
assert.deepEqual(conflictingFields({ voice: "ash" }, ["voice"]), [], "no voiceConfig = no conflict");
{
  const r = inboundVoiceConfigUpdates({ voiceConfig: { patience: 2 }, speed: 1.2 }, inboundRow, true, anyVoice);
  assert.ok(r && "error" in r);
  assert.deepEqual(r.error, { status: 400, body: { error: "voice_config_conflict", fields: ["speed"] } });
}
assert.equal(inboundVoiceConfigUpdates({ voice: "ash" }, inboundRow, true, anyVoice), null, "legacy-only body → legacy path");

// ── inbound legacy write → stored voice refreshed, style kept ───────────
{
  const stored: Voice = { ...fromInboundColumns(inboundRow), style: "professional" };
  const after = inboundVoiceConfigAfterLegacy({ ...inboundRow, voiceConfig: stored }, { voice: "sage", speed: 1.1 });
  assert.equal(after.voiceId, "sage");
  assert.equal(after.advanced.speed, 1.1);
  assert.equal(after.style, "professional");
  assert.deepEqual(inboundVoiceConfigAfterLegacy(inboundRow, {}), fromInboundColumns(inboundRow), "first write = derived");
}

// ── outbound ────────────────────────────────────────────────────────────
{
  const row = { voice: "echo", personality: { vitesse: 7, creativite: 2 }, noiseReductionLevel: 5, voiceConfig: null };
  // voiceConfig write: engine/profile kept in voice_config, legacy columns get voice/speed/noise
  const r = outboundVoiceConfigUpdates({ voiceConfig: { engine: "xai", patience: 2, noiseReduction: 9 } }, row, true);
  assert.ok(r && !("error" in r));
  const u = r.updates as { voice: string; personality: Record<string, number>; noiseReductionLevel: number; voiceConfig: Voice };
  assert.equal(u.voiceConfig.engine, "xai");
  assert.equal(u.voiceConfig.patience, 2);
  assert.equal(u.noiseReductionLevel, 9);
  assert.equal(u.personality.vitesse, 7, "speed unchanged → same slider");
  assert.equal(u.personality.creativite, 2, "other personality keys untouched");
  // today's outbound readers see exactly what they saw, except the changed noise level
  assert.deepEqual(fromOutboundColumns(u), { ...fromOutboundColumns(row), noiseReduction: 9 });
  // tenant may not pick the engine
  const t = outboundVoiceConfigUpdates({ voiceConfig: { engine: "xai" } }, row, false);
  assert.ok(t && "error" in t && t.error.status === 403);
  // conflict
  const c = outboundVoiceConfigUpdates({ voiceConfig: {}, personality: {} }, row, true);
  assert.ok(c && "error" in c && c.error.body.error === "voice_config_conflict");
  // legacy write keeps what only voice_config holds (engine, profile, style)
  const after = outboundVoiceConfigAfterLegacy({ ...row, voiceConfig: u.voiceConfig }, { voice: "coral", personality: { vitesse: 5 } });
  assert.equal(after.voiceId, "coral");
  assert.equal(after.advanced.speed, 0.944, "slider 5 = 0.944x (the 1–10 scale has no 1.0x step)");
  assert.equal(after.engine, "xai");
  assert.equal(after.patience, 2);
  // an off-grid speed is rounded to the nearest slider step in the legacy column
  assert.equal(outboundColumnsFromVoice({ ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, speed: 1.2 } }, {}).personality.vitesse, 7);
  // the preset (1.0x) isn't on the scale either: nearest step is 6 (1.056x)
  assert.equal(outboundColumnsFromVoice(DEFAULT_VOICE, {}).personality.vitesse, 6);
}

// ── viewer mask: no provider trace for tenants ──────────────────────────
{
  const v: Voice = { ...DEFAULT_VOICE, engine: "xai", advanced: { ...DEFAULT_VOICE.advanced, model: "gpt-realtime-2.1", voiceOverrides: { xai: "rex" } } };
  const t = voiceForViewer(v, false);
  const json = JSON.stringify(t);
  assert.ok(!("engine" in t));
  for (const k of ["model", "voiceOverrides", "openaiTurnMode", "openaiEagerness", "openaiNoiseReduction", "openaiReasoning", "grokReasoning"]) {
    assert.ok(!(k in t.advanced), k);
  }
  assert.doesNotMatch(json, /xai|grok|openai|gemini|gpt-realtime/i);
  assert.deepEqual(voiceForViewer(v, true), v, "admin sees everything");
}

console.log("ALL VOICE-STORE TESTS PASSED");
