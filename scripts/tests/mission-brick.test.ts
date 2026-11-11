// Mission brick (M2b): the campaign editor's three mission cards (they
// replace the goal-preset picker one for one), the agent's default mission
// for new campaigns, and a new draft's prefill from it. Renders the REAL
// components to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/mission-brick.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GOAL_PRESETS } from "../../lib/campaigns/constants";
import { isDraftDirty, snapshot } from "../../lib/campaigns/edit-guard";
import { SALES_MISSION_TABLE } from "../../lib/mission/contract";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS } from "../../lib/tools/adapters";
import { effectiveCapabilities } from "../../lib/tools/contract";
import { DefaultMissionControl, MissionCards } from "../../components/bricks/mission/MissionBrick";
import {
  MISSION_CARDS,
  cardForPreset,
  defaultMissionValue,
  missionForDefaultOption,
  missionFromServed,
  missionNeeds,
  missionRefused,
  missionSaveBody,
  presetForCard,
  presetOnAgentPick,
  type ScreenMission,
} from "../../components/bricks/mission/mission-ui";
import { SUPPLIERS, TOOL_NAMES } from "../tenant-bundle-match.mjs";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(el: ReactElement, locale = "fr") {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, el));
}
const cards = (preset: string, locale = "fr", onPresetChange: (p: string) => void = () => {}) =>
  html(createElement(MissionCards, { preset, onPresetChange }), locale);

// 1. Three cards (book_for_seller / follow_up hidden until M2d), their words in fr/en/he
{
  assert.deepEqual([...MISSION_CARDS], ["qualify_lead", "announce_offer", "other"]);
  for (const l of LOCALES) {
    const m = messages(l).MissionBrick;
    const out = cards("lead_gen", l);
    assert.equal((out.match(/role="radio"/g) ?? []).length, 3, `${l}: three cards`);
    assert.match(out, /role="radiogroup"/);
    assert.equal((out.match(/aria-checked="true"/g) ?? []).length, 1, `${l}: one selected`);
    for (const k of MISSION_CARDS) {
      assert.ok(out.includes(esc(m.kind[k].name)), `${l}: ${k} name`);
      assert.ok(out.includes(esc(m.kind[k].what)), `${l}: ${k} line`);
      // The success proof, read-only, labelled as an estimate.
      assert.ok(out.includes(esc(m.proof[SALES_MISSION_TABLE[k].provenBy])), `${l}: ${k} proof`);
    }
    assert.equal(out.split(esc(m.proofLabel)).length - 1, 3, `${l}: every proof says "estimated"`);
    assert.match(m.proofLabel, /estimée|estimated|הערכה/, l);
    assert.doesNotMatch(out, /<input|<textarea/, `${l}: the proof is text, not an input`);
    assert.doesNotMatch(out, /book_for_seller|follow_up/, `${l}: hidden missions`);
  }
  // Roving tabindex: only the selected card is in the tab order (arrow keys move it).
  const out = cards("sales");
  assert.equal((out.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(out, /aria-checked="true" aria-describedby="[^"]+" data-id="announce_offer" tabindex="0"/);
}

// 2. Cards ↔ goalPreset: reading back, and what a pick writes
{
  assert.deepEqual(cardForPreset("lead_gen"), { kind: "qualify_lead", cold: false });
  assert.deepEqual(cardForPreset("cold"), { kind: "qualify_lead", cold: true });
  assert.deepEqual(cardForPreset("sales"), { kind: "announce_offer", cold: false });
  assert.deepEqual(cardForPreset("marketing"), { kind: "announce_offer", cold: false });
  assert.deepEqual(cardForPreset("custom"), { kind: "other", cold: false });
  assert.deepEqual(cardForPreset("something_old"), { kind: "other", cold: false }, "unknown → Other");

  assert.equal(presetForCard("custom", "qualify_lead"), "lead_gen");
  assert.equal(presetForCard("custom", "qualify_lead", true), "cold");
  assert.equal(presetForCard("cold", "qualify_lead", false), "lead_gen", "cold off");
  assert.equal(presetForCard("lead_gen", "qualify_lead", true), "cold", "cold on");
  assert.equal(presetForCard("lead_gen", "announce_offer"), "sales");
  assert.equal(presetForCard("marketing", "announce_offer"), "marketing", "marketing stays marketing");
  assert.equal(presetForCard("sales", "other"), "custom");
  assert.equal(presetForCard("cold", "announce_offer", true), "sales", "cold only with qualify_lead");

  // The cold switch: only under "Qualify a lead", and it reflects the preset.
  for (const l of LOCALES) {
    const m = messages(l).MissionBrick;
    assert.ok(cards("cold", l).includes(esc(m.coldLabel)), `${l}: cold switch`);
    assert.match(cards("cold", l), /role="switch" aria-checked="true"/);
    assert.match(cards("lead_gen", l), /role="switch" aria-checked="false"/);
    assert.ok(!cards("sales", l).includes(esc(m.coldLabel)), `${l}: no cold switch on announce_offer`);
    assert.ok(!cards("custom", l).includes(esc(m.coldLabel)), `${l}: no cold switch on other`);
  }
}

// 3. An untouched campaign never changes its preset (byte-identical instructions)
{
  for (const p of [...GOAL_PRESETS, "something_old"]) {
    const shown = cardForPreset(p);
    assert.equal(presetForCard(p, shown.kind, shown.cold), p, `${p}: re-picking what is shown writes nothing`);
  }
  // The cards call onPresetChange only for a change; the editor's PATCH body is the draft itself.
  const loaded = { id: "c1", name: "Mock", goalPreset: "marketing", objective: "o", successCriteria: "s" };
  const saved = snapshot(loaded);
  assert.equal(isDraftDirty(loaded, saved), false, "untouched → no PATCH at all");
  const body = JSON.parse(JSON.stringify(loaded));
  assert.equal(body.goalPreset, "marketing", "and the body carries the stored preset as is");
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /body: JSON\.stringify\(draft\)/, "the campaign save still sends the draft as before");
  const step = read("app/[locale]/dashboard/campaigns/campaign-setup-step.tsx");
  assert.match(step, /<MissionCards\s+preset=\{draft\.goalPreset\}/);
  assert.match(step, /onPresetChange=\{\(goalPreset\) => onChange\(\{ goalPreset/);
}

// 4. The campaign editor: the old preset picker is gone; objective and success criteria stay
{
  const step = read("app/[locale]/dashboard/campaigns/campaign-setup-step.tsx");
  assert.doesNotMatch(step, /GOAL_PRESETS\.map|GOAL_EMOJI|goalDesc_/, "no old preset picker");
  assert.match(step, /onChange\(\{ objective: /, "objective stays");
  assert.match(step, /onChange\(\{ successCriteria: /, "success criteria stay");
  assert.match(step, /extractionSchema/, "fields to capture stay");
}

// 5. "Not active yet": the Tools brick's reading and words, display only
{
  const served = (tools = OUTBOUND_TOOLS, outboundToolsEnabled = true, transferNumber = "") =>
    effectiveCapabilities({ recipe: "outbound", tools }, { transferNumber, googleConnected: false, outboundToolsEnabled }, DEFAULT_MATRIX.premium);
  // The three offered cards need no capability: never a line.
  for (const k of MISSION_CARDS) assert.deepEqual(missionNeeds(k, served()), [], k);
  // Unknown capabilities (no agent, loading): never a guess.
  assert.deepEqual(missionNeeds("book_for_seller", null), []);
  // Booking required, switch off → listed with no missing code ("turn it on in …").
  assert.deepEqual(missionNeeds("book_for_seller", served()), [{ key: "booking", missing: null }]);
  // Booking on but the account isn't open to outbound tools → the Tools brick's code.
  const bookingOn = { ...OUTBOUND_TOOLS, booking: { ...OUTBOUND_TOOLS.booking, enabled: true } };
  assert.deepEqual(missionNeeds("book_for_seller", served(bookingOn, false)), [{ key: "booking", missing: "not_available_outbound" }]);
  // anyOf: one active is enough; none → both listed.
  const transferOn = { ...OUTBOUND_TOOLS, transfer: { ...OUTBOUND_TOOLS.transfer, enabled: true } };
  assert.deepEqual(missionNeeds("follow_up", served(transferOn, true, "+15555550100")), []);
  assert.deepEqual(missionNeeds("follow_up", served()).map((n) => n.key), ["booking", "transfer"]);
  // Rendered line: the Tools brick's words (statusPending + missing.*), in every language.
  for (const l of LOCALES) {
    const tb = messages(l).ToolsBrick;
    const caps = served(bookingOn, false);
    assert.ok(tb.statusPending && tb.missing.not_available_outbound, l);
    const out = html(createElement(MissionCards, { preset: "lead_gen", onPresetChange: () => {}, capabilities: caps }), l);
    assert.ok(!out.includes(esc(tb.statusPending)), `${l}: no line when the shown mission needs nothing`);
    assert.match(messages(l).MissionBrick.needsOff, /\{tools\}/, `${l}: names the tools screen`);
  }
  const brick = read("components/bricks/mission/MissionBrick.tsx");
  assert.match(brick, /tTools\("statusPending"\)/);
  assert.match(brick, /tTools\(`missing\.\$\{n\.missing\}`\)/, "reuses the missing-prerequisite words");
  assert.match(read("components/bricks/mission/mission-ui.ts"), /capabilityView\(key, s\)/, "reuses the Tools brick's reading");
}

// 6. The agent's default mission: same 3 + cold; a stored kind without a card shows unselected, and is never written unless picked
{
  const m = (kind: ScreenMission["kind"], cold = false): ScreenMission => ({ kind, cold });
  assert.equal(defaultMissionValue(null), "");
  assert.equal(defaultMissionValue(m("qualify_lead")), "qualify_lead");
  assert.equal(defaultMissionValue(m("qualify_lead", true)), "qualify_lead:cold");
  assert.equal(defaultMissionValue(m("announce_offer")), "announce_offer");
  assert.equal(defaultMissionValue(m("other")), "other");
  assert.equal(defaultMissionValue(m("book_for_seller")), "", "unselected, no error");
  assert.equal(defaultMissionValue(m("follow_up")), "");
  assert.deepEqual(missionForDefaultOption("qualify_lead:cold"), m("qualify_lead", true));
  assert.deepEqual(missionForDefaultOption("announce_offer"), m("announce_offer"));
  assert.deepEqual(missionFromServed({ version: 1, kind: "book_for_seller", cold: false }), m("book_for_seller"));
  assert.equal(missionFromServed(null), null);
  assert.equal(missionFromServed({ kind: "nope" }), null);

  // The save body: nothing unless the user picked another one.
  const stored = m("book_for_seller");
  assert.deepEqual(missionSaveBody(stored, stored), {}, "a save of other fields leaves an unoffered kind untouched");
  assert.deepEqual(missionSaveBody(null, null), {});
  assert.deepEqual(missionSaveBody(m("qualify_lead", true), m("qualify_lead", true)), {});
  assert.deepEqual(missionSaveBody(stored, m("announce_offer")), { mission: { version: 1, kind: "announce_offer", cold: false } });
  assert.deepEqual(missionSaveBody(null, m("qualify_lead", true)), { mission: { version: 1, kind: "qualify_lead", cold: true } });
  assert.deepEqual(missionSaveBody(m("qualify_lead"), m("qualify_lead", true)), { mission: { version: 1, kind: "qualify_lead", cold: true } });
  // A refusal → one generic line; the reasons are never shown.
  assert.equal(missionRefused(400, { error: "invalid_mission", fields: ["mission.kind: one of …"] }), true);
  assert.equal(missionRefused(400, { error: "other" }), false);
  assert.equal(missionRefused(500, null), false);
  const ws = read("app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx");
  assert.match(ws, /const missionBody = missionSaveBody\(missionBase, mission\)/);
  assert.match(ws, /\.\.\.\(editing \? missionBody : \{\}\)/, "the agent PATCH spreads only the mission diff");
  assert.match(ws, /setError\(tMission\("saveRefused"\)\)/);
  assert.doesNotMatch(ws, /fields\.join|\.fields\b.*setError/, "never the server's reasons");
  assert.match(ws, /servedMission = mdata\?\.agent\?\.mission|let servedMission: unknown = data\.agent\?\.mission/, "re-read from the PATCH answer");

  for (const l of LOCALES) {
    const mb = messages(l).MissionBrick;
    const ctl = (v: ScreenMission | null) => html(createElement(DefaultMissionControl, { value: v, onChange: () => {} }), l);
    const out = ctl(m("qualify_lead", true));
    assert.ok(out.includes(esc(mb.defaultLabel)), `${l}: the quiet line`);
    assert.equal((out.match(/<option/g) ?? []).length, 4, `${l}: 4 options (3 kinds, one with cold)`);
    assert.match(out, /<option value="qualify_lead:cold" selected="">/);
    assert.match(out, /<label for="([^"]+)"[^>]*>[\s\S]*<select id="\1"/, `${l}: labelled control`);
    const unoffered = ctl(stored);
    assert.match(unoffered, /<option value="" disabled="" selected="">/, `${l}: book_for_seller → none selected`);
    assert.doesNotMatch(unoffered, /role="alert"/, `${l}: no error`);
    assert.doesNotMatch(out + unoffered, /book_for_seller|follow_up/);
  }
  // The agent editor: no cards there, one quiet line.
  const editor = read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx");
  assert.match(editor, /<DefaultMissionControl value=\{mission\} onChange=\{onMissionChange\} \/>/);
  assert.doesNotMatch(editor, /<MissionCards/);
}

// 7. A NEW campaign starts from its agent's default (presetForMission, #282); nothing else changes
{
  const pick = (agentMission: unknown, o: { isNew?: boolean; cardPicked?: boolean; current?: string } = {}) =>
    presetOnAgentPick({ isNew: o.isNew ?? true, cardPicked: o.cardPicked ?? false, current: o.current ?? "cold", agentMission });
  assert.equal(pick({ version: 1, kind: "qualify_lead", cold: true }), "cold");
  assert.equal(pick({ version: 1, kind: "qualify_lead", cold: false }), "lead_gen");
  assert.equal(pick({ version: 1, kind: "announce_offer", cold: false }), "sales");
  assert.equal(pick({ version: 1, kind: "other", cold: false }), "custom");
  assert.equal(pick(null), "cold", "no mission → today's default");
  assert.equal(pick({ version: 1, kind: "book_for_seller", cold: false }), "cold", "no mapping → today's default");
  assert.equal(pick({ version: 1, kind: "follow_up", cold: false }), "cold");
  assert.equal(pick({ version: 1, kind: "other", cold: false }, { isNew: false, current: "marketing" }), "marketing", "existing campaign untouched");
  assert.equal(pick({ version: 1, kind: "other", cold: false }, { cardPicked: true, current: "lead_gen" }), "lead_gen", "a picked card wins");
  const ui = read("components/bricks/mission/mission-ui.ts");
  assert.match(ui, /import \{ missionForPreset, presetForMission \} from "@\/lib\/mission\/adapters"/, "the shared helper, not a copy");
  assert.doesNotMatch(ui, /function presetForMission/);
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /if \(!agentId \|\| draft\.id \|\| cardPicked\.current\) return;/, "new drafts only, until a card is picked");
  assert.match(ws, /if \("goalPreset" in patch\) cardPicked\.current = true;/);
}

// 8. Level 1 only; no supplier or technical tool name; same keys in fr/en/he
{
  const files = ["components/bricks/mission/MissionBrick.tsx", "components/bricks/mission/mission-ui.ts"];
  for (const f of files) {
    assert.doesNotMatch(read(f), /MoreSettings|showLevel3|useDeveloperMode/, `${f}: no level 2 / 3`);
  }
  const names = new RegExp(`\\b(?:${(TOOL_NAMES as string[]).join("|")})\\b|${(SUPPLIERS as string[]).join("|")}`, "i");
  for (const f of files) assert.doesNotMatch(read(f), names, f);
  const keys = (o: Record<string, unknown>, pre = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${pre}${k}.`) : [`${pre}${k}`]));
  const [fr, en, he] = LOCALES.map((l) => keys(messages(l).MissionBrick).sort());
  assert.deepEqual(en, fr);
  assert.deepEqual(he, fr);
  for (const l of LOCALES) assert.doesNotMatch(JSON.stringify(messages(l).MissionBrick), names, l);
  // Never a pink → cyan gradient.
  for (const f of files) assert.doesNotMatch(read(f), /from-\[#(?:be185d|db2777|ec4899)\][^"`]*to-\[#(?:06b6d4|22d3ee|67e8f9|0e7490)\]/, f);
}

console.log("mission-brick: ok");
