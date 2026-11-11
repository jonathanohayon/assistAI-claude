// The 4th case of every gated / admin-only write path (tamaraVP's standing
// rule): a save that OMITS the gated field leaves the stored value unchanged,
// for a tenant AND for an admin. Cases 1–3 (other fields pass, an unchanged
// re-send passes, a tenant change → 403 naming the field) live in the files
// named in each section; they are not repeated here.
//
// Why this file exists: #253 shipped a route that parsed an ABSENT `url` as
// "" — the unit tests passed because they always passed the gated value
// explicitly. So every case below goes through the SAME helpers the route
// calls with the raw parsed body (body → helper → the updates written →
// applied to the row), never a hand-built decision input.
//
// Where an empty / null value is an INTENDED clear, it is asserted as such
// and says so.
//
// Mock data only. Run with:  npx tsx scripts/tests/gate-omission.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inheritAdminGlobalsWrite } from "../../lib/admin-gates";
import { nextBrainSecret } from "../../lib/agent-brain";
import { agentBrainSaveDecision, enabledToSave, urlToSave } from "../../lib/agent-brain-guard";
import type { Resolver } from "../../lib/net/safe-url";
import type { Persona } from "../../lib/persona/contract";
import {
  inboundPersonaAfterLegacy,
  inboundPersonaUpdates,
  outboundPersonaAfterLegacy,
  outboundPersonaUpdates,
} from "../../lib/persona/store";
import { voicesFor } from "../../lib/realtime";
import { adminOnlyProviderUpdate } from "../../lib/realtime-provider";
import { DEFAULT_TILE_TOGGLES } from "../../lib/tile-toggles";
import {
  clientAgentRefused,
  currentOutboundTools,
  currentReceptionistTools,
  outboundToolsRefused,
  planOutboundToolsWrite,
  planReceptionistToolsWrite,
  type ReceptionistToolSettings,
} from "../../lib/tools/store";
import { OUTBOUND_TOOLS } from "../../lib/tools/adapters";
import { clientAgentUrlRefusal } from "../../lib/tools/write";
import { catalogueIdFor } from "../../lib/voice/catalogue";
import { effectiveEngineVoiceName } from "../../lib/voice/choice";
import type { Voice } from "../../lib/voice/contract";
import {
  inboundLegacyVoiceUpdates,
  inboundVoiceConfigUpdates,
  outboundVoiceConfigAfterLegacy,
  outboundVoiceConfigUpdates,
} from "../../lib/voice/route-writes";
import { currentInboundVoice, currentOutboundVoice, VOICE_ADMIN_ONLY_PATHS, voiceForViewer } from "../../lib/voice/store";
import { mergeVoiceProfile } from "../../lib/voice-profile";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const TENANT_AND_ADMIN = [false, true] as const;
const who = (isAdmin: boolean) => (isAdmin ? "admin" : "tenant");
const pending: Promise<void>[] = [];
const SAFE = "https://agent.example.com/hook";
const check = { resolver: (async () => [{ address: "93.184.215.14", family: 4 }]) as Resolver };

// ════════════════════════════════════════════════════════════════════════
// Voice (receptionist): lib/voice/route-writes.ts inboundVoiceConfigUpdates
// + inboundLegacyVoiceUpdates, as app/api/dashboard/config and
// app/api/admin/configs/[userId] call them. Cases 1–3: voice-gates.test.ts,
// voice-store.test.ts, voice-choice.test.ts (V8b), voice-engine-switch.test.ts (V8e).
// ════════════════════════════════════════════════════════════════════════

type InRow = {
  voice: string; model: string; speed: number; realtimeProvider: string | null;
  voiceProfile: unknown; noiseReductionLevel: number; voiceConfig: unknown;
};
const baseRow: InRow = {
  voice: "ash", model: "gpt-realtime-2", speed: 1, realtimeProvider: null,
  voiceProfile: null, noiseReductionLevel: 8, voiceConfig: null,
};
const applyRow = (row: InRow, updates: Record<string, unknown>): InRow => ({ ...row, ...updates }) as InRow;

/** A voiceConfig save, as both config routes run it; the row after the write. */
function voiceSave(row: InRow, body: Record<string, unknown>, isAdmin: boolean): InRow {
  const r = inboundVoiceConfigUpdates(body, row, isAdmin, voicesFor);
  assert.ok(r && "updates" in r, `${who(isAdmin)} voiceConfig save ${JSON.stringify(body)} → ${JSON.stringify(r)}`);
  return applyRow(row, r.updates);
}
/** A save WITHOUT voiceConfig (legacy fields only), as both config routes run it. */
function legacySave(row: InRow, legacyUpdates: Record<string, unknown>): InRow {
  assert.equal(inboundVoiceConfigUpdates(legacyUpdates, row, false, voicesFor), null, "no voiceConfig → legacy path");
  const merged = { ...legacyUpdates };
  Object.assign(merged, inboundLegacyVoiceUpdates(row, merged as never));
  return applyRow(row, merged);
}

// An admin sets every gated voice value on an xai account, through the route
// path: the engine switch first, then the rest (an override in the switch's
// own save is covered by V8E-OVERRIDE below).
const adminVoiceRow = voiceSave(
  voiceSave(baseRow, { voiceConfig: { engine: "xai" } }, true),
  {
    voiceConfig: {
      style: "calm",
      advanced: {
        model: "gpt-realtime-2.1",
        voiceOverrides: { xai: "rex", gemini: "Kore" },
        openaiTurnMode: "semantic_vad",
        openaiEagerness: "low",
        openaiNoiseReduction: "far_field",
        openaiReasoning: "medium",
        grokReasoning: "none",
      },
    },
  },
  true,
);
const adminVoice = currentInboundVoice(adminVoiceRow.voiceConfig, adminVoiceRow);
assert.equal(adminVoice.engine, "xai");
assert.equal(adminVoiceRow.realtimeProvider, "xai");

const gatedSnapshot = (v: Voice) => ({
  style: v.style,
  ...Object.fromEntries(VOICE_ADMIN_ONLY_PATHS.map((p) => [p, p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], v)])),
});
const assertGatedKept = (row: InRow, label: string) => {
  const v = currentInboundVoice(row.voiceConfig, row);
  assert.deepEqual(gatedSnapshot(v), gatedSnapshot(adminVoice), label);
  assert.equal(row.realtimeProvider, "xai", `${label}: realtimeProvider column`);
  assert.equal(row.model, "gpt-realtime-2.1", `${label}: model column`);
  assert.deepEqual(
    (row.voiceProfile as { voiceOverrides?: unknown }).voiceOverrides,
    { xai: "rex", gemini: "Kore" },
    `${label}: voiceOverrides in the voice_profile column`,
  );
};

// omitting `engine`, `advanced.model`, `advanced.voiceOverrides`, the provider
// settings and `style` keeps every stored value (tenant and admin)
for (const isAdmin of TENANT_AND_ADMIN) {
  for (const voiceConfig of [{}, { patience: 4 }, { noiseReduction: 6, keyTerms: ["Mock"] }, { advanced: { idleHangupSec: 45 } }, { advanced: {} }]) {
    const after = voiceSave(adminVoiceRow, { voiceConfig }, isAdmin);
    assertGatedKept(after, `${who(isAdmin)}: voiceConfig ${JSON.stringify(voiceConfig)} omits the gated paths`);
  }
}
// the tenant screen re-sending its GET view (admin-only paths stripped by
// voiceForViewer) omits them all → every one is kept
{
  const view = voiceForViewer(adminVoice, false) as Record<string, unknown>;
  assert.ok(!("engine" in view));
  const after = voiceSave(adminVoiceRow, { voiceConfig: { ...view, style: adminVoice.style } }, false);
  assertGatedKept(after, "tenant: re-sending the tenant view keeps every admin-only path");
}
// omitting `voiceId` (V8b) keeps the chosen voice: the per-engine override and the voice column
for (const isAdmin of TENANT_AND_ADMIN) {
  const chosenRow = voiceSave(baseRow, { voiceConfig: { engine: "xai" } }, true);
  const chose = voiceSave(chosenRow, { voiceConfig: { voiceId: catalogueIdFor("xai", "orion") } }, false);
  const before = currentInboundVoice(chose.voiceConfig, chose);
  assert.equal(effectiveEngineVoiceName(before, "xai"), "orion");
  const after = voiceSave(chose, { voiceConfig: { patience: 2 } }, isAdmin);
  const v = currentInboundVoice(after.voiceConfig, after);
  assert.equal(effectiveEngineVoiceName(v, "xai"), "orion", `${who(isAdmin)}: omitting voiceId keeps the chosen voice`);
  assert.equal(after.voice, chose.voice, `${who(isAdmin)}: voice column kept`);
  assert.deepEqual(v.advanced.voiceOverrides, before.advanced.voiceOverrides);
}
// omitting `engine` makes no V8e engine switch: the voice doesn't move
for (const isAdmin of TENANT_AND_ADMIN) {
  const after = voiceSave(adminVoiceRow, { voiceConfig: { pace: "slow" } }, isAdmin);
  const v = currentInboundVoice(after.voiceConfig, after);
  assert.equal(v.voiceId, adminVoice.voiceId, `${who(isAdmin)}: no switch, voiceId kept`);
  assert.deepEqual(v.advanced.voiceOverrides, adminVoice.advanced.voiceOverrides);
}
// a save with NO voiceConfig at all (another field, e.g. reminderEnabled /
// agentName: the legacy path, no voice column in the updates) keeps every
// admin-set voice value — the route refreshes voice_config from the columns
{
  const after = legacySave(adminVoiceRow, {});
  assertGatedKept(after, "legacy save without voice fields keeps every admin-only voice value");
  assert.equal(currentInboundVoice(after.voiceConfig, after).style, "calm");
}
// a legacy admin save omitting `realtimeProvider` (e.g. only `voice` or `speed`) keeps the engine
{
  const after = legacySave(adminVoiceRow, { speed: 1.1 });
  assert.equal(after.realtimeProvider, "xai");
  assert.equal(currentInboundVoice(after.voiceConfig, after).engine, "xai");
  assert.deepEqual(currentInboundVoice(after.voiceConfig, after).advanced.voiceOverrides, { xai: "rex", gemini: "Kore" });
}
// V8E-OVERRIDE (fixed): an admin's explicit per-engine override sent in the
// SAME save as an engine switch is stored as written; without one, the switch
// still carries the voice to its equivalent (V8e, voice-engine-switch.test.ts).
// On an OpenAI row (voice "ash"), through the route helper.
{
  const overridesOf = (row: InRow) => (row.voiceProfile as { voiceOverrides: Record<string, string> }).voiceOverrides;
  // explicit override for the target engine → it wins over the switch
  const explicit = voiceSave(baseRow, { voiceConfig: { engine: "xai", advanced: { voiceOverrides: { xai: "rex" } } } }, true);
  assert.equal(overridesOf(explicit).xai, "rex", "V8E-OVERRIDE: the explicit override is stored");
  assert.equal(explicit.realtimeProvider, "xai");
  assert.equal(effectiveEngineVoiceName(currentInboundVoice(explicit.voiceConfig, explicit), "xai"), "rex");
  // no override in the patch → the switch writes the equivalent
  const switched = voiceSave(baseRow, { voiceConfig: { engine: "xai" } }, true);
  assert.equal(overridesOf(switched).xai, "orion", "V8E: without an explicit override the switch writes the equivalent");
  // an explicit override for ANOTHER engine doesn't stop the target's switch
  const other = voiceSave(baseRow, { voiceConfig: { engine: "xai", advanced: { voiceOverrides: { gemini: "Kore" } } } }, true);
  assert.deepEqual(overridesOf(other), { gemini: "Kore", xai: "orion" }, "V8E: an override for another engine keeps the target's switch");
  // without the switch, the same override is stored as written
  const same = voiceSave({ ...baseRow, realtimeProvider: "xai" }, { voiceConfig: { advanced: { voiceOverrides: { xai: "rex" } } } }, true);
  assert.equal(overridesOf(same).xai, "rex");
  // the 4-case set for the switch + override (engine and overrides are admin-only)
  for (const isAdmin of TENANT_AND_ADMIN) {
    // other fields pass, the explicit override and engine kept
    const kept = voiceSave(explicit, { voiceConfig: { patience: 3 } }, isAdmin);
    assert.equal(overridesOf(kept).xai, "rex", `${who(isAdmin)}: other fields keep the explicit override`);
    assert.equal(kept.realtimeProvider, "xai");
    // an unchanged re-send passes and moves nothing
    const v = currentInboundVoice(explicit.voiceConfig, explicit);
    const resend = voiceSave(explicit, { voiceConfig: { engine: v.engine, advanced: { voiceOverrides: v.advanced.voiceOverrides } } }, isAdmin);
    assert.equal(overridesOf(resend).xai, "rex", `${who(isAdmin)}: unchanged re-send keeps the override`);
  }
  // a tenant's switch + override → 403
  const refused = inboundVoiceConfigUpdates({ voiceConfig: { engine: "xai", advanced: { voiceOverrides: { xai: "rex" } } } }, baseRow, false, voicesFor);
  assert.ok(refused && "error" in refused && refused.error.status === 403, `tenant switch + override → 403: ${JSON.stringify(refused)}`);
}
// realtimeProvider (admin legacy field, adminOnlyProviderUpdate): omitted → no update, tenant and admin.
// INTENDED clear: an admin's explicit `null` = back to "auto" (served as OpenAI).
for (const isAdmin of TENANT_AND_ADMIN) {
  assert.deepEqual(adminOnlyProviderUpdate({ agentName: "Mock" }, isAdmin), { update: {} }, `${who(isAdmin)}: omitted realtimeProvider`);
}
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: "xai" }, false), { update: {} }, "tenant: ignored (case 3 for this silent gate)");
assert.deepEqual(adminOnlyProviderUpdate({ realtimeProvider: null }, true), { update: { realtimeProvider: null } }, "admin null = auto (intended)");
// voiceProfile (admin legacy field, mergeVoiceProfile): omitted keys keep their stored value.
// INTENDED clear: `voiceProfile: null` resets the profile to the defaults.
{
  const stored = { voiceOverrides: { xai: "rex" }, grokReasoning: "none", pace: "slow" };
  const r = mergeVoiceProfile(stored, { fillers: false });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { ...stored, fillers: false }, "admin: omitted voiceProfile keys kept");
  assert.deepEqual(mergeVoiceProfile(stored, null), { ok: true, value: null }, "null resets (intended)");
}
// the routes call the helpers above only when the field is IN the body
{
  const tenant = src("app/api/dashboard/config/route.ts");
  const admin = src("app/api/admin/configs/[userId]/route.ts");
  assert.match(tenant, /adminOnlyProviderUpdate\(body as Record<string, unknown>, isAdmin\)/);
  assert.match(tenant, /if \(isAdmin && "voiceProfile" in \(body as Record<string, unknown>\)\)/);
  assert.match(tenant, /if \(isAdmin && body\.model\) \{/, "tenant route: model only from an admin, only when sent");
  assert.match(admin, /if \("voiceProfile" in body\) \{/);
  assert.match(admin, /if \("realtimeProvider" in body\) \{/);
  assert.match(admin, /if \(body\.model != null\) updates\.model = body\.model;/);
  for (const r of [tenant, admin]) {
    assert.match(r, /inboundVoiceConfigUpdates\(body as Record<string, unknown>, (current|currentRow), (isAdmin|true), voicesFor\)/);
    assert.match(r, /else Object\.assign\(updates, inboundLegacyVoiceUpdates\((current|currentRow), updates\)\)/);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Voice (outbound agent): outboundVoiceConfigUpdates / outboundVoiceConfigAfterLegacy,
// as app/api/dashboard/outbound-agents/[id] PATCH calls them. Cases 1–3: voice-store.test.ts.
// ════════════════════════════════════════════════════════════════════════
{
  const row0 = { voice: "echo", personality: { vitesse: 7 }, noiseReductionLevel: 5, voiceConfig: null as unknown };
  const set = outboundVoiceConfigUpdates(
    { voiceConfig: { engine: "xai", advanced: { model: "gpt-realtime-2.1", voiceOverrides: { xai: "rex" }, grokReasoning: "none" } } },
    row0,
    true,
  );
  assert.ok(set && "updates" in set);
  const row = { ...row0, ...set.updates } as typeof row0;
  const stored = currentOutboundVoice(row.voiceConfig, row);
  for (const isAdmin of TENANT_AND_ADMIN) {
    const r = outboundVoiceConfigUpdates({ voiceConfig: { patience: 3 } }, row, isAdmin);
    assert.ok(r && "updates" in r, JSON.stringify(r));
    assert.deepEqual(gatedSnapshot(r.voice), gatedSnapshot(stored), `${who(isAdmin)} outbound: omitting the gated paths keeps them`);
    // the PATCH without voiceConfig (legacy fields only) keeps them too
    const legacy = outboundVoiceConfigAfterLegacy(row, { ...row, voice: "coral" });
    assert.deepEqual(gatedSnapshot(legacy), gatedSnapshot(stored), "outbound legacy PATCH keeps the gated paths");
  }
}

// ════════════════════════════════════════════════════════════════════════
// Persona: lib/persona/store.ts — languages (P4), outbound aiDisclosure (P5).
// Cases 1–3: persona-languages.test.ts, persona-outbound-disclosure.test.ts.
// ════════════════════════════════════════════════════════════════════════
const inRow = {
  agentName: "Tamara", primaryLanguage: "fr", greetingInstructions: "Bonjour, salon Mock !",
  aiDisclosureEnabled: true, aiDisclosureText: "", personaConfig: null as unknown,
};
const outRow = { agentName: "Dana", language: "fr", greeting: "Bonjour {{name}} !", personaConfig: null as unknown };
{
  // admin sets languages (inbound + outbound) and the outbound disclosure, through the route helpers
  const a1 = inboundPersonaUpdates({ personaConfig: { languages: ["he", "en"] } }, inRow, true);
  assert.ok(a1 && "updates" in a1);
  const inSet = { ...inRow, ...a1.updates } as typeof inRow;
  const a2 = outboundPersonaUpdates(
    { personaConfig: { languages: ["en"], aiDisclosure: { enabled: true, text: "Je suis une IA." } } },
    outRow,
    true,
  );
  assert.ok(a2 && "updates" in a2);
  const outSet = { ...outRow, ...a2.updates } as typeof outRow;

  for (const isAdmin of TENANT_AND_ADMIN) {
    // omitting `languages` keeps the stored list (tenant and admin)
    for (const personaConfig of [{}, { name: "Noa" }, { greeting: { mode: "custom", text: "Shalom Mock" } }, { aiDisclosure: { enabled: false } }]) {
      const r = inboundPersonaUpdates({ personaConfig }, inSet, isAdmin);
      assert.ok(r && "updates" in r, `${who(isAdmin)} inbound ${JSON.stringify(personaConfig)} → ${JSON.stringify(r)}`);
      assert.deepEqual(r.persona.languages, ["he", "en"], `${who(isAdmin)}: omitting languages keeps them (inbound)`);
      assert.deepEqual((r.updates.personaConfig as Persona).languages, ["he", "en"]);
    }
    // omitting `aiDisclosure` keeps the admin-set outbound disclosure (and languages)
    for (const personaConfig of [{}, { name: "Noa" }, { greeting: { mode: "auto" } }]) {
      const r = outboundPersonaUpdates({ personaConfig }, outSet, isAdmin);
      assert.ok(r && "updates" in r, `${who(isAdmin)} outbound ${JSON.stringify(personaConfig)} → ${JSON.stringify(r)}`);
      assert.deepEqual(r.persona.aiDisclosure, { enabled: true, text: "Je suis une IA." }, `${who(isAdmin)}: omitting aiDisclosure keeps it`);
      assert.deepEqual(r.persona.languages, ["en"], `${who(isAdmin)}: omitting languages keeps them (outbound)`);
    }
    // a partial aiDisclosure omitting `text` keeps the line (admin; a tenant can't re-enable — case 3)
    if (isAdmin) {
      const r = outboundPersonaUpdates({ personaConfig: { aiDisclosure: { enabled: true } } }, outSet, true);
      assert.ok(r && "updates" in r);
      assert.equal(r.persona.aiDisclosure.text, "Je suis une IA.");
    }
  }
  // a save with NO personaConfig (legacy fields, either role) keeps both
  assert.deepEqual(inboundPersonaAfterLegacy(inSet, { agentName: "Noa" }).languages, ["he", "en"], "inbound legacy save keeps languages");
  const outLegacy = outboundPersonaAfterLegacy(outSet, { agentName: "Noa" });
  assert.deepEqual(outLegacy.aiDisclosure, { enabled: true, text: "Je suis une IA." }, "outbound legacy PATCH keeps the disclosure");
  assert.deepEqual(outLegacy.languages, ["en"]);
  // PERSONA-PRIMARY-IN-LANGUAGES (fixed): a new primaryLanguage that is in the
  // admin-set list, with `languages` omitted, passes and leaves the list
  // (["he","en"] + primary he → ["en"]), as the legacy path does. The
  // automatic removal is not a tenant languages change (no 403).
  for (const isAdmin of TENANT_AND_ADMIN) {
    const r = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "he" } }, inSet, isAdmin);
    assert.ok(r && "updates" in r, `${who(isAdmin)}: primary → a listed language passes: ${JSON.stringify(r)}`);
    assert.equal(r.persona.primaryLanguage, "he");
    assert.deepEqual(r.persona.languages, ["en"], `${who(isAdmin)}: the list keeps the others`);
    assert.deepEqual((r.updates.personaConfig as Persona).languages, ["en"]);
    // outbound, same rule (["en"] + primary en → [])
    const o = outboundPersonaUpdates({ personaConfig: { primaryLanguage: "en" } }, outSet, isAdmin);
    assert.ok(o && "updates" in o, `${who(isAdmin)} outbound: ${JSON.stringify(o)}`);
    assert.deepEqual(o.persona.languages, [], `${who(isAdmin)} outbound: the new primary leaves the list`);
    // a primary NOT in the list keeps the list whole
    const enOnly = inboundPersonaUpdates({ personaConfig: { languages: ["en"] } }, inRow, true);
    assert.ok(enOnly && "updates" in enOnly);
    const he = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "he" } }, { ...inRow, ...enOnly.updates } as typeof inRow, isAdmin);
    assert.ok(he && "updates" in he, JSON.stringify(he));
    assert.deepEqual(he.persona.languages, ["en"], `${who(isAdmin)}: a primary outside the list keeps it`);
    // an unchanged re-send of primary + list passes
    const same = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "fr", languages: ["he", "en"] } }, inSet, isAdmin);
    assert.ok(same && "updates" in same, JSON.stringify(same));
  }
  // an explicit `languages` in the patch follows today's rules:
  //   repeating the primary → 400 (tenant and admin)
  for (const isAdmin of TENANT_AND_ADMIN) {
    const r = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "he", languages: ["he", "en"] } }, inSet, isAdmin);
    assert.ok(r && "error" in r && r.error.status === 400, `${who(isAdmin)}: explicit list repeating the primary → 400`);
    assert.match(String(r.error.body.fields?.[0]), /must not repeat the primary/);
  }
  //   a tenant's explicit changed list → 403 even with the primary change; an admin's passes
  {
    const t = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "he", languages: ["en"] } }, inSet, false);
    assert.ok(t && "error" in t && t.error.status === 403, `tenant explicit changed list → 403: ${JSON.stringify(t)}`);
    assert.deepEqual(t.error.body.fields, ["languages"]);
    const a = inboundPersonaUpdates({ personaConfig: { primaryLanguage: "he", languages: ["en"] } }, inSet, true);
    assert.ok(a && "updates" in a && JSON.stringify(a.persona.languages) === '["en"]');
  }
  assert.deepEqual(inboundPersonaAfterLegacy(inSet, { primaryLanguage: "he" }).languages, ["en"], "the legacy path drops the new primary");
  // INTENDED clear: `languages: []` empties the list, for a tenant too (persona-languages.test.ts)
  const clear = inboundPersonaUpdates({ personaConfig: { languages: [] } }, inSet, false);
  assert.ok(clear && "updates" in clear && clear.persona.languages.length === 0);
}

// ════════════════════════════════════════════════════════════════════════
// Tools: lib/tools/store.ts as lib/tools/write.ts writeTools calls it —
// receptionist toggles + the transfer number keep/park, outbound refusal.
// Cases 1–3: tools-store.test.ts, outbound-tools.test.ts.
// ════════════════════════════════════════════════════════════════════════
{
  const T = DEFAULT_TILE_TOGGLES;
  const NUM = "+97250000000";
  const write = (row: ReceptionistToolSettings, toggles: typeof T, patch: unknown) => {
    const w = planReceptionistToolsWrite(row, toggles, patch);
    assert.ok(w.ok, JSON.stringify(w));
    return { row: { ...row, ...w.columns } as ReceptionistToolSettings, toggles: w.toggles };
  };
  // level-2 settings + transfer ON with a served number
  const on = write({ toolsConfig: null, transferNumber: NUM, transferNumberParked: null }, T, {
    booking: { defaultDurationMinutes: 45, minNoticeMinutes: 60 },
    transfer: { when: "business_hours" },
    orders: { ask: "size" },
  });
  // and the same with transfer OFF (number parked)
  const off = write(on.row, on.toggles, { transfer: { enabled: false } });
  assert.equal(off.row.transferNumberParked, NUM);

  for (const s of [on, off]) {
    const before = currentReceptionistTools(s.row, s.toggles);
    // omitting `transfer` keeps the served / parked number and the switch
    for (const patch of [{}, { booking: { enabled: !before.booking.enabled } }, { orders: { ask: "colour" } }, { contacts: { enabled: false } }]) {
      const w = write(s.row, s.toggles, patch);
      assert.equal(w.row.transferNumber, s.row.transferNumber, `omitting transfer keeps transferNumber (${JSON.stringify(patch)})`);
      assert.equal(w.row.transferNumberParked, s.row.transferNumberParked, "…and the parked number");
      const after = currentReceptionistTools(w.row, w.toggles);
      assert.deepEqual(after.transfer, before.transfer);
      // omitted capabilities / level-2 settings keep their stored value
      if (!("booking" in patch)) assert.deepEqual(after.booking, before.booking);
      if (!("orders" in patch)) assert.deepEqual(after.orders, before.orders);
      if (!("contacts" in patch)) assert.equal(w.toggles.customers, s.toggles.customers);
    }
    // a partial capability object (only `enabled`) keeps its level-2 settings
    const w = write(s.row, s.toggles, { booking: { enabled: false } });
    assert.equal(currentReceptionistTools(w.row, w.toggles).booking.defaultDurationMinutes, 45);
    assert.equal(currentReceptionistTools(w.row, w.toggles).transfer.when, before.transfer.when);
  }
  // the legacy transferNumber field: only written when IN the body (both config routes);
  // INTENDED clear: an explicit null / "" clears it (lib/transfer-number.ts).
  for (const r of [src("app/api/dashboard/config/route.ts"), src("app/api/admin/configs/[userId]/route.ts")]) {
    assert.match(r, /if \("transferNumber" in body\) \{/);
  }
  // Outbound: an already-on capability (set while OUTBOUND_TOOLS was on) is
  // kept when a later save omits it, and is not refused once the switch is off.
  const stored = planOutboundToolsWrite(null, { booking: { enabled: true, defaultDurationMinutes: 30 }, transfer: { enabled: true } });
  assert.ok(stored.ok);
  for (const enabled of [false, true]) {
    for (const patch of [{}, { booking: { minNoticeMinutes: 120 } }, { transfer: { when: "business_hours" } }]) {
      const plan = planOutboundToolsWrite(stored.value, patch);
      assert.ok(plan.ok);
      assert.deepEqual(outboundToolsRefused(currentOutboundTools(stored.value), plan.value, enabled), [], `switch ${enabled}: ${JSON.stringify(patch)}`);
      assert.equal(plan.value.booking.enabled, true, "omitted booking.enabled kept");
      assert.equal(plan.value.transfer.enabled, true, "omitted transfer.enabled kept");
      assert.equal(plan.value.booking.defaultDurationMinutes, 30);
    }
  }
  assert.deepEqual(currentOutboundTools(null), OUTBOUND_TOOLS);
  // writeTools runs exactly these helpers on the raw `tools` patch
  const w = src("lib/tools/write.ts");
  assert.match(w, /planOutboundToolsWrite\(row\.toolsConfig, patch\)/);
  assert.match(w, /outboundToolsRefused\(currentOutboundTools\(row\.toolsConfig\), plan\.value, outboundToolsEnabled\)/);
  assert.match(w, /planReceptionistToolsWrite\(row, toggles, patch\)/);
  assert.match(w, /clientAgentRefused\(currentReceptionistTools\(row, toggles\), plan\.tools, clientAgentEnabled\)/);
  assert.match(w, /const unsafe = await clientAgentUrlRefusal\(patch\);/);
}

// ════════════════════════════════════════════════════════════════════════
// Tools — client agent (T5, #255): the CLIENT_AGENT switch gate
// (clientAgentRefused) and the url safety check (clientAgentUrlRefusal), as
// writeTools runs them. Cases 1–3: client-agent-tool.test.ts.
// ════════════════════════════════════════════════════════════════════════
pending.push(
  (async () => {
    const T = DEFAULT_TILE_TOGGLES;
    const CA = { enabled: true, url: SAFE, mode: "voice", secret: "mock-secret" };
    // the agent set while the switch was on
    const set = planReceptionistToolsWrite({ toolsConfig: null, transferNumber: "", transferNumberParked: null }, T, { clientAgent: CA });
    assert.ok(set.ok);
    const row: ReceptionistToolSettings = { toolsConfig: set.columns.toolsConfig, transferNumber: "", transferNumberParked: null };
    for (const switchOn of [false, true]) {
      for (const patch of [{}, { booking: { enabled: false } }, { clientAgent: {} }, { clientAgent: { mode: "lead" } }, { clientAgent: { secretSet: true } }]) {
        // omitted url → no safety check to fail
        assert.equal(await clientAgentUrlRefusal(patch, check), null, JSON.stringify(patch));
        const w = planReceptionistToolsWrite(row, T, patch);
        assert.ok(w.ok, JSON.stringify(w));
        assert.deepEqual(clientAgentRefused(currentReceptionistTools(row, T), w.tools, switchOn), [], `switch ${switchOn}: ${JSON.stringify(patch)}`);
        const ca = w.columns.toolsConfig.clientAgent;
        assert.equal(ca.enabled, true, "omitting clientAgent.enabled keeps it");
        assert.equal(ca.url, SAFE, "omitting clientAgent.url keeps it");
        assert.equal(ca.secret, "mock-secret", "omitting clientAgent.secret keeps it");
        if (!("clientAgent" in patch && "mode" in (patch.clientAgent as object))) assert.equal(ca.mode, "voice");
      }
    }
    // INTENDED clears: `secret: null` clears the secret, `url: ""` clears the url
    const clear = planReceptionistToolsWrite(row, T, { clientAgent: { secret: null, url: "" } });
    assert.ok(clear.ok && clear.columns.toolsConfig.clientAgent.secret === null && clear.columns.toolsConfig.clientAgent.url === "");
    assert.equal(await clientAgentUrlRefusal({ clientAgent: { url: "" } }, check), null);
  })(),
);

// ════════════════════════════════════════════════════════════════════════
// Agent brain: lib/agent-brain-guard.ts urlToSave + enabledToSave + agentBrainSaveDecision
// (#253/#254) and lib/agent-brain.ts nextBrainSecret, composed EXACTLY as
// PUT /api/dashboard/agent-brain does (source asserted below).
// Cases 1–3: safe-url.test.ts, agent-brain-secret.test.ts.
// ════════════════════════════════════════════════════════════════════════
type Stored = { enabled: boolean; url: string; secret?: string };

/** The route's PUT, I/O removed: body + stored brain → what setAgentBrain stores (or the refusal). */
async function brainPut(body: Record<string, unknown>, current: Stored, isAdmin: boolean) {
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  const url = urlToSave(body.url, current.url, isAdmin);
  const decision = await agentBrainSaveDecision({ currentUrl: current.url, url, wantsEnabled, isAdmin, check });
  if (!decision.ok) return decision;
  // setAgentBrain(userId, { enabled: wantsEnabled, url, ...(typeof body.secret === "string" ? { secret } : {}) })
  const u = url.trim();
  const enabled = wantsEnabled && u.startsWith("http");
  const secret = nextBrainSecret({ existing: current.secret, provided: typeof body.secret === "string" ? body.secret : undefined, enabled });
  return { ok: true as const, stored: { enabled, url: u, ...(secret ? { secret } : {}) } };
}
{
  const route = src("app/api/dashboard/agent-brain/route.ts");
  assert.match(route, /const wantsEnabled = enabledToSave\(body\.enabled, current\.enabled\);/);
  assert.doesNotMatch(route, /body\.enabled === true/);
  assert.match(route, /const url = urlToSave\(body\.url, current\.url, isAdmin\);/);
  assert.match(route, /agentBrainSaveDecision\(\{ currentUrl: current\.url, url, wantsEnabled, isAdmin \}\)/);
  assert.match(route, /enabled: wantsEnabled,\s*url,\s*\.\.\.\(typeof body\.secret === "string" \? \{ secret: body\.secret \} : \{\}\),/);
  const lib = src("lib/agent-brain.ts");
  assert.match(lib, /const enabled = next\.enabled && url\.startsWith\("http"\);/);
  assert.match(lib, /provided: next\.secret,/);
}
pending.push(
  (async () => {
    const current: Stored = { enabled: true, url: SAFE, secret: "mock-secret" };
    for (const isAdmin of TENANT_AND_ADMIN) {
      // omitting `url` keeps the stored url (the #253 bug), and omitting `secret` keeps the secret
      const r = await brainPut({ enabled: true }, current, isAdmin);
      assert.deepEqual(r, { ok: true, stored: current }, `${who(isAdmin)}: omitting url and secret keeps both`);
      const off = await brainPut({ enabled: false }, current, isAdmin);
      assert.deepEqual(off, { ok: true, stored: { ...current, enabled: false } }, `${who(isAdmin)}: turning off keeps url and secret`);
      // a tenant's "" (its screen never holds the url) keeps it too
      if (!isAdmin) assert.deepEqual(await brainPut({ enabled: true, url: "" }, current, false), { ok: true, stored: current });
      // an empty secret is NOT a clear: the stored one is kept
      assert.deepEqual(await brainPut({ enabled: true, secret: "  " }, current, isAdmin), { ok: true, stored: current });
    }
    // INTENDED clear: an admin's explicit url "" clears the url (and so disables the webhook)
    assert.deepEqual(await brainPut({ enabled: true, url: "" }, current, true), {
      ok: false, status: 400, body: { error: "unsafe_url", message: (await agentBrainSaveDecision({ currentUrl: "", url: "", wantsEnabled: true, isAdmin: true, check }) as { body: { message: string } }).body.message },
    }, "admin: enabling with url \"\" is refused");
    assert.deepEqual(await brainPut({ enabled: false, url: "" }, current, true), { ok: true, stored: { enabled: false, url: "", secret: "mock-secret" } });

    // BRAIN-ENABLED-OMITTED (fixed): a PUT without `enabled` (an API caller's
    // `{ secret }`, an admin's url-only save) keeps the stored enabled value.
    for (const isAdmin of TENANT_AND_ADMIN) {
      const r = await brainPut({ secret: "x" }, current, isAdmin);
      assert.deepEqual(r, { ok: true, stored: { ...current, secret: "x" } }, `${who(isAdmin)}: { secret } keeps enabled:true`);
      // other fields pass with enabled kept OFF too (absent never turns it on)
      const offRow: Stored = { ...current, enabled: false };
      assert.deepEqual(await brainPut({ secret: "x" }, offRow, isAdmin), { ok: true, stored: { ...offRow, secret: "x" } }, `${who(isAdmin)}: absent keeps enabled:false`);
      // an unchanged re-send passes
      assert.deepEqual(await brainPut({ enabled: true, secret: "mock-secret" }, current, isAdmin), { ok: true, stored: current });
      // an explicit enabled:false still turns it off
      assert.deepEqual(await brainPut({ enabled: false, secret: "x" }, current, isAdmin), { ok: true, stored: { ...current, enabled: false, secret: "x" } });
      // a non-boolean enabled is not a change
      assert.deepEqual(await brainPut({ enabled: "false" }, current, isAdmin), { ok: true, stored: current }, `${who(isAdmin)}: non-boolean enabled keeps it`);
      // tenant: a changed url → 403 (gated), enabled omitted or not
      if (!isAdmin) {
        assert.deepEqual(await brainPut({ url: "https://other.example.com/hook" }, current, false), {
          ok: false, status: 403, body: { error: "admin_only", fields: ["url"] },
        });
      }
    }
    // an admin's url-only save keeps enabled:true
    const NEW = "https://agent2.example.com/hook";
    assert.deepEqual(await brainPut({ url: NEW }, current, true), { ok: true, stored: { ...current, url: NEW } }, "admin url-only save keeps enabled:true");
    // the save decision uses the RESULTING enabled: a partial save on an
    // enabled webhook still needs a safe url, and turning ON via enabled:true
    // with an unsafe stored url is still refused
    const unsafe: Stored = { enabled: false, url: "http://127.0.0.1/hook", secret: "mock-secret" };
    for (const isAdmin of TENANT_AND_ADMIN) {
      const on = await brainPut({ enabled: true }, unsafe, isAdmin);
      assert.ok(!on.ok && on.status === 400 && on.body.error === "unsafe_url", `${who(isAdmin)}: turning ON with an unsafe stored url → 400`);
      // absent enabled on a disabled unsafe row stays off and passes
      assert.deepEqual(await brainPut({ secret: "x" }, unsafe, isAdmin), { ok: true, stored: { ...unsafe, secret: "x" } });
      const stillOn = await brainPut({ secret: "x" }, { ...unsafe, enabled: true }, isAdmin);
      assert.ok(!stillOn.ok && stillOn.status === 400, `${who(isAdmin)}: a partial save keeping an unsafe webhook ON → 400`);
    }
    assert.equal(enabledToSave(undefined, true), true);
    assert.equal(enabledToSave(null, true), true);
    assert.equal(enabledToSave(false, true), false);
    assert.equal(enabledToSave(true, false), true);
  })(),
);

// ════════════════════════════════════════════════════════════════════════
// Config: inheritAdminGlobals (lib/admin-gates.ts inheritAdminGlobalsWrite,
// tenant route) and the admin route's inline `!= null` write.
// Cases 1–3: admin-gates.test.ts.
// ════════════════════════════════════════════════════════════════════════
for (const current of [true, false]) {
  for (const isAdmin of TENANT_AND_ADMIN) {
    // omitting inheritAdminGlobals (or sending null) writes nothing: the stored value stays
    for (const body of [{}, { agentName: "Mock" }, { inheritAdminGlobals: null }, { inheritAdminGlobals: undefined }]) {
      assert.deepEqual(inheritAdminGlobalsWrite(body, current, isAdmin), { ok: true, value: undefined }, `${who(isAdmin)} ${JSON.stringify(body)}`);
    }
  }
}
{
  const tenant = src("app/api/dashboard/config/route.ts");
  assert.match(tenant, /if \(inherit\.value !== undefined\) updates\.inheritAdminGlobals = inherit\.value;/);
  const admin = src("app/api/admin/configs/[userId]/route.ts");
  assert.match(admin, /if \(body\.inheritAdminGlobals != null\) \{\s*updates\.inheritAdminGlobals = Boolean\(body\.inheritAdminGlobals\);/);
}

Promise.all(pending).then(
  () => console.log("ALL GATE-OMISSION TESTS PASSED"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
