// Storing the sales mission on the outbound agent (M2a): lib/mission/store.ts
// and the PATCH body→stored helper (lib/outbound-agents/patch.ts).
// Mock data only. Run with:  npx tsx scripts/tests/mission-store.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { outboundAgents, type OutboundAgent } from "../../lib/db/schema";
import { agentMissionUpdates, currentAgentMission, parseAgentMission, withoutMissionStore } from "../../lib/mission/store";
import { SALES_MISSIONS } from "../../lib/mission/contract";
import { planOutboundAgentPatch } from "../../lib/outbound-agents/patch";
import { currentOutboundPersona } from "../../lib/persona/store";
import { withoutToolsStore } from "../../lib/tools/store";
import { LEGACY_OUTBOUND_VOICE_FIELDS, withVoiceConfig } from "../../components/bricks/voice/legacy-fields";
import { withPersonaConfig } from "../../components/bricks/persona/persona-ui";
import { LEGACY_OUTBOUND_PERSONA_FIELDS } from "../../lib/persona/store";
import { currentOutboundVoice, voiceForViewer } from "../../lib/voice/store";

// ── Migration: idempotent, nullable, sorts last in the journal ──────────
const sql = readFileSync(new URL("../../drizzle/0049_outbound_agents_mission.sql", import.meta.url), "utf8");
assert.equal(sql.trim(), 'ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "mission" jsonb;');
assert.equal(outboundAgents.mission.notNull, false);
{
  const j = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries as Array<{ idx: number; when: number; tag: string }>;
  const mine = j.findIndex((e) => e.tag === "0049_outbound_agents_mission");
  assert.ok(mine >= 0, "journal entry present");
  // Every EARLIER migration sorts before it (later ones, e.g. 0050, sort after).
  for (const e of j.slice(0, mine)) assert.ok(e.when < j[mine].when, `journal: ${e.tag} sorts before 0049`);
}

// ── The value ────────────────────────────────────────────────────────────
for (const kind of SALES_MISSIONS) {
  assert.deepEqual(parseAgentMission({ kind }), { ok: true, value: { version: 1, kind, cold: false } });
}
assert.deepEqual(parseAgentMission({ version: 1, kind: "qualify_lead", cold: true }), { ok: true, value: { version: 1, kind: "qualify_lead", cold: true } });
const errs = (v: unknown) => {
  const p = parseAgentMission(v);
  assert.equal(p.ok, false, JSON.stringify(v));
  return p.ok ? [] : p.errors;
};
assert.match(errs({ kind: "cold" })[0], /^mission\.kind: one of qualify_lead, book_for_seller, announce_offer, follow_up, other$/);
assert.match(errs({})[0], /^mission\.kind:/);
assert.match(errs({ kind: "announce_offer", cold: true })[0], /^mission\.cold: only with kind qualify_lead$/);
assert.match(errs({ kind: "qualify_lead", cold: "yes" })[0], /^mission\.cold:/);
assert.match(errs({ kind: "other", version: 2 })[0], /^mission\.version:/);
assert.match(errs({ kind: "other", objective: "x" })[0], /^mission\.objective: unknown field$/);
assert.match(errs("qualify_lead")[0], /^mission:/);
assert.match(errs(["other"])[0], /^mission:/);
assert.equal(currentAgentMission(null), null);
assert.equal(currentAgentMission(undefined), null);
assert.equal(currentAgentMission({ kind: "nope" }), null, "an unreadable stored value reads as unset");
assert.deepEqual(currentAgentMission({ version: 1, kind: "follow_up", cold: false }), { version: 1, kind: "follow_up", cold: false });
// absent = keep, null = clear
assert.equal(agentMissionUpdates({}), null);
assert.equal(agentMissionUpdates({ mission: undefined }), null);
assert.deepEqual(agentMissionUpdates({ mission: null }), { updates: { mission: null } });

// ── The four gate cases, for a tenant AND an admin (?asUserId), through
//    the SAME body→stored helper the PATCH handler runs ─────────────────
const STORED = { version: 1, kind: "book_for_seller", cold: false } as const;
const row = (mission: unknown): OutboundAgent => ({
  id: "00000000-0000-0000-0000-0000000000c3",
  userId: "00000000-0000-0000-0000-00000000000a",
  name: "Noam",
  agentName: "Noam",
  voice: "marin",
  language: "fr",
  instructions: "Consignes mock.",
  greeting: "",
  knowledge: "Offre mock.",
  knowledgeSources: [],
  notifications: {},
  channels: { phone: true },
  personality: {},
  noiseReductionLevel: 8,
  voiceConfig: null,
  personaConfig: null,
  toolsConfig: null,
  mission,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-01T00:00:00Z"),
});
// The agent GET's JSON, built as app/api/dashboard/outbound-agents/[id]/route.ts builds it.
const getJson = (a: OutboundAgent, isAdmin: boolean) =>
  JSON.parse(
    JSON.stringify({
      ...withoutMissionStore(withoutToolsStore(a)),
      voiceConfig: voiceForViewer(currentOutboundVoice(a.voiceConfig, a), isAdmin),
      personaConfig: currentOutboundPersona(a.personaConfig, a),
      mission: currentAgentMission(a.mission),
      campaignCount: 2,
    }),
  ) as Record<string, unknown>;
const stored = (a: OutboundAgent, set: Record<string, unknown>) => ({ ...a, ...set }) as OutboundAgent;

for (const [actor, isAdmin] of [["tenant", false], ["admin ?asUserId", true]] as const) {
  const a = row(STORED);
  // 1. other fields pass (and write no mission key)
  {
    const p = planOutboundAgentPatch({ agentName: "Dana", instructions: "Nouvelles consignes." }, a, isAdmin);
    assert.ok("set" in p, `${actor} case 1: ${JSON.stringify(p)}`);
    assert.equal(p.set.agentName, "Dana");
    assert.equal(p.set.instructions, "Nouvelles consignes.");
    assert.equal("mission" in p.set, false, `${actor} case 1: no mission key written`);
    assert.deepEqual(stored(a, p.set).mission, STORED);
  }
  // 2. an unchanged re-send passes: the agent GET's JSON sent back the way
  //    the screen builds its save body (agents-workspace.tsx: withVoiceConfig
  //    + withPersonaConfig) — (a) nothing changed (null patches), (b) the
  //    full served voice + persona sent back as patches.
  {
    const got = getJson(a, isAdmin);
    assert.deepEqual(got.mission, STORED);
    const bodies = {
      "screen, nothing changed": withPersonaConfig(withVoiceConfig(got, LEGACY_OUTBOUND_VOICE_FIELDS, null), LEGACY_OUTBOUND_PERSONA_FIELDS, null),
      "screen, served voice + persona sent back": withPersonaConfig(
        withVoiceConfig(got, LEGACY_OUTBOUND_VOICE_FIELDS, got.voiceConfig as Record<string, unknown>),
        LEGACY_OUTBOUND_PERSONA_FIELDS,
        got.personaConfig as Record<string, unknown>,
      ),
    };
    for (const [variant, body] of Object.entries(bodies)) {
      assert.deepEqual(body.mission, STORED);
      const p = planOutboundAgentPatch(body, a, isAdmin);
      assert.ok("set" in p, `${actor} case 2 (${variant}): ${JSON.stringify(p)}`);
      assert.deepEqual(p.set.mission, STORED);
      const after = stored(a, p.set);
      for (const k of ["name", "agentName", "voice", "language", "instructions", "greeting", "knowledge", "noiseReductionLevel", "mission"] as const) {
        assert.deepEqual(after[k], a[k], `${actor} case 2 (${variant}): ${k} unchanged`);
      }
      // the GET after the re-send serves the same mission
      assert.deepEqual(getJson(after, isAdmin).mission, got.mission);
    }
  }
  // 3. an invalid change → 400 naming the field
  for (const [mission, field] of [
    [{ kind: "cold" }, "mission.kind"],
    [{ kind: "announce_offer", cold: true }, "mission.cold"],
    [{ kind: "other", objective: "x" }, "mission.objective"],
    ["qualify_lead", "mission"],
  ] as const) {
    const p = planOutboundAgentPatch({ agentName: "Dana", mission }, a, isAdmin);
    assert.ok("error" in p, `${actor} case 3: ${JSON.stringify(mission)} refused`);
    assert.equal(p.error.status, 400);
    const body = p.error.body as { error: string; fields: string[] };
    assert.equal(body.error, "invalid_mission");
    assert.ok(body.fields.some((f) => f.startsWith(`${field}:`)), `${actor} case 3: names ${field} (${body.fields})`);
  }
  // 4. a save that OMITS mission keeps the stored value (also with no stored value)
  for (const m of [STORED, null]) {
    const b = row(m);
    const p = planOutboundAgentPatch({ greeting: "Bonjour {{name}}", knowledge: "Offre mock 2." }, b, isAdmin);
    assert.ok("set" in p);
    assert.deepEqual(stored(b, p.set).mission, m, `${actor} case 4: stored ${JSON.stringify(m)} kept`);
  }
  // explicit null clears; a valid change is stored normalised
  {
    const p = planOutboundAgentPatch({ mission: null }, a, isAdmin);
    assert.ok("set" in p);
    assert.equal(p.set.mission, null);
    const q = planOutboundAgentPatch({ mission: { kind: "qualify_lead", cold: true } }, a, isAdmin);
    assert.ok("set" in q);
    assert.deepEqual(q.set.mission, { version: 1, kind: "qualify_lead", cold: true });
  }
}

// ── Every route spreading the row strips the column; only the agent GET and PATCH add it back ──
{
  const r = row(STORED);
  assert.equal("mission" in withoutMissionStore(withoutToolsStore(r)), false);
  assert.equal("toolsConfig" in withoutMissionStore(withoutToolsStore(r)), false);
  assert.deepEqual(Object.keys(getJson(r, false)).filter((k) => k === "mission"), ["mission"]);
}

// ── The PATCH response returns the stored mission in the GET's shape ─────
// Source-level: read the route files and check what each handler returns.
{
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const handler = (file: string, name: string) => {
    const s = src(file);
    const start = s.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${file}: ${name} handler found`);
    const next = s.indexOf("export async function ", start + 1);
    return s.slice(start, next < 0 ? undefined : next);
  };
  const ONE = "app/api/dashboard/outbound-agents/[id]/route.ts";
  const get = handler(ONE, "GET");
  const patch = handler(ONE, "PATCH");
  assert.match(get, /mission: currentAgentMission\(agent\.mission\),/, "GET returns the stored mission");
  assert.match(patch, /mission: currentAgentMission\(updated\.mission\),/, "PATCH returns the stored (updated) mission, same helper as GET");
  // both spread the row without the raw column, then add the normalised key back
  for (const [name, body, v] of [["GET", get, "agent"], ["PATCH", patch, "updated"]] as const) {
    assert.ok(body.includes(`...withoutMissionStore(withoutToolsStore(${v}))`), `${name} strips the raw column before adding it back`);
  }
  assert.equal(handler(ONE, "DELETE").includes("mission"), false, "DELETE returns no mission");
  // the other routes keep stripping it
  const LIST = "app/api/dashboard/outbound-agents/route.ts";
  for (const name of ["GET", "POST"]) {
    const body = handler(LIST, name);
    assert.ok(body.includes("withoutMissionStore(withoutToolsStore("), `list ${name} strips mission`);
    assert.equal(body.includes("currentAgentMission"), false, `list ${name} does not add mission back`);
  }
  const CAMP = src("app/api/dashboard/campaigns/[id]/route.ts");
  assert.ok(CAMP.includes("agent: agent ? withoutMissionStore(withoutToolsStore(agent)) : null"), "campaigns/[id] strips the agent's mission");
  assert.equal(CAMP.includes("currentAgentMission"), false, "campaigns/[id] does not add mission back");
  // worker routes: nothing reads or serves the mission
  const walk = (dir: string): string[] =>
    readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [],
    );
  const workerFiles = walk("app/api/agent");
  assert.ok(workerFiles.length > 0);
  for (const f of workerFiles) {
    const s = src(f);
    assert.equal(/currentAgentMission|mission\/store|\.mission\b/.test(s), false, `${f}: no mission served to the worker`);
  }
}
// Pure: the PATCH JSON, built as the route builds it from the `returning()`
// row, carries the same mission as the GET that follows (set, changed, cleared).
{
  const patchJson = (u: OutboundAgent, isAdmin: boolean) =>
    JSON.parse(
      JSON.stringify({
        ...withoutMissionStore(withoutToolsStore(u)),
        voiceConfig: voiceForViewer(currentOutboundVoice(u.voiceConfig, u), isAdmin),
        personaConfig: currentOutboundPersona(u.personaConfig, u),
        mission: currentAgentMission(u.mission),
        campaignCount: 2,
      }),
    ) as Record<string, unknown>;
  for (const isAdmin of [false, true]) {
    for (const [start, body, want] of [
      [STORED, { mission: { kind: "qualify_lead", cold: true } }, { version: 1, kind: "qualify_lead", cold: true }],
      [STORED, { agentName: "Dana" }, STORED],
      [STORED, { mission: null }, null],
      [null, { greeting: "Bonjour" }, null],
      [null, { mission: { kind: "other" } }, { version: 1, kind: "other", cold: false }],
    ] as const) {
      const a = row(start);
      const p = planOutboundAgentPatch(body as Record<string, unknown>, a, isAdmin);
      assert.ok("set" in p);
      const updated = stored(a, p.set);
      const res = patchJson(updated, isAdmin);
      assert.deepEqual(res.mission, want, `PATCH ${JSON.stringify(body)} returns ${JSON.stringify(want)}`);
      assert.deepEqual(res.mission, getJson(updated, isAdmin).mission, "PATCH mission === following GET mission");
      assert.deepEqual(Object.keys(res).sort(), Object.keys(getJson(updated, isAdmin)).sort(), "PATCH and GET return the same keys");
    }
  }
}

console.log("ALL MISSION STORE TESTS PASSED");
