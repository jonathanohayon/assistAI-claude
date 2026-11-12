// Mission brick, M2d front end: the two admin-only campaign presets
// (book_for_seller, follow_up) on the campaign editor's mission cards, the
// campaign list and the admin framings form. Renders the REAL components to
// static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/mission-m2d-ui.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GOAL_PRESETS } from "../../lib/campaigns/constants";
import { ADMIN_ONLY_PRESETS } from "../../lib/campaigns/preset-gate";
import { missionForPreset } from "../../lib/mission/adapters";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS } from "../../lib/tools/adapters";
import { effectiveCapabilities } from "../../lib/tools/contract";
import { MissionCards } from "../../components/bricks/mission/MissionBrick";
import {
  ADMIN_MISSION_CARDS,
  MISSION_CARDS,
  cardsFor,
  lockedCard,
  missionNeeds,
  presetForPick,
  presetOnAgentPick,
  presetRefusal,
  provableFor,
  shownCardFor,
} from "../../components/bricks/mission/mission-ui";
import { GOAL_EMOJI } from "../../app/[locale]/dashboard/campaigns/campaign-list";
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
const served = (tools = OUTBOUND_TOOLS, outboundToolsEnabled = true, googleConnected = true) =>
  effectiveCapabilities({ recipe: "outbound", tools }, { transferNumber: "", googleConnected, outboundToolsEnabled }, DEFAULT_MATRIX.premium);
const cards = (preset: string, opts: { isAdmin?: boolean; locale?: string; caps?: ReturnType<typeof served> | null } = {}) =>
  html(
    createElement(MissionCards, { preset, onPresetChange: () => {}, isAdmin: opts.isAdmin ?? false, capabilities: opts.caps ?? null }),
    opts.locale ?? "fr",
  );
const radios = (out: string) => out.match(/role="radio"/g)?.length ?? 0;
const ids = (out: string) => [...out.matchAll(/data-id="([a-z_]+)"/g)].map((m) => m[1]);

// 1. Admins see 5 cards, tenants 3 (in every locale)
{
  assert.deepEqual([...ADMIN_MISSION_CARDS], [...ADMIN_ONLY_PRESETS], "the cards are the server's admin-only presets");
  assert.deepEqual(cardsFor(true, "lead_gen"), ["qualify_lead", "announce_offer", "book_for_seller", "follow_up", "other"]);
  assert.deepEqual(cardsFor(false, "lead_gen"), [...MISSION_CARDS]);
  for (const l of LOCALES) {
    const admin = cards("lead_gen", { isAdmin: true, locale: l });
    assert.equal(radios(admin), 5, `${l}: admin, five cards`);
    assert.deepEqual(ids(admin), ["qualify_lead", "announce_offer", "book_for_seller", "follow_up", "other"], `${l}: "Other" stays last`);
    assert.match(admin, /role="radiogroup"/, `${l}: still a radio group`);
    assert.equal(admin.match(/aria-checked="true"/g)?.length, 1, `${l}: one selected`);
    assert.doesNotMatch(admin, /aria-disabled/, `${l}: nothing read-only for an admin`);
    const tenant = cards("lead_gen", { locale: l });
    assert.equal(radios(tenant), 3, `${l}: tenant, three cards`);
    assert.doesNotMatch(tenant, /book_for_seller|follow_up/, `${l}: tenant, admin-only cards hidden`);
  }
  // The keyboard walks the cards shown (the same ids the radio group passes to radioKeys).
  assert.match(read("components/bricks/mission/MissionBrick.tsx"), /radioKeys\(ids, shown\.kind/);
}

// 2. Identity: an admin pick writes the preset of the same name, which reads back as itself
{
  for (const kind of ADMIN_MISSION_CARDS) {
    for (const from of ["lead_gen", "cold", "sales", "marketing", "custom", "book_for_seller", "follow_up"]) {
      const next = presetForPick(from, kind, { isAdmin: true });
      assert.equal(next, kind, `${from} → ${kind}`);
      assert.ok((GOAL_PRESETS as readonly string[]).includes(next), "a real preset");
    }
    assert.deepEqual(shownCardFor(kind), { kind, cold: false }, `${kind} reads back as itself`);
    assert.equal(missionForPreset(kind).kind, kind, "the server's mapping agrees");
    const out = cards(kind, { isAdmin: true });
    assert.match(out, new RegExp(`aria-checked="true"[^>]*data-id="${kind}"`), `${kind} selected`);
  }
  // Leaving an admin-only preset: the card's own preset (never kept as "Other").
  assert.equal(presetForPick("follow_up", "other", { isAdmin: true }), "custom");
  assert.equal(presetForPick("book_for_seller", "qualify_lead", { isAdmin: true }), "lead_gen");
  assert.equal(presetForPick("book_for_seller", "qualify_lead", { isAdmin: true, cold: true }), "cold");
  assert.equal(presetForPick("follow_up", "announce_offer", { isAdmin: false }), "sales");
  // The 3 cards behave exactly as before (presetForCard), e.g. an untouched pick keeps the preset.
  assert.equal(presetForPick("marketing", "announce_offer", { isAdmin: true }), "marketing");
  assert.equal(presetForPick("unknown_x", "other", { isAdmin: false }), "unknown_x");
  // The agent-pick prefill still ignores the admin-only kinds (#289, unchanged).
  for (const kind of ADMIN_MISSION_CARDS) {
    assert.equal(presetOnAgentPick({ isNew: true, cardPicked: false, current: "cold", agentMission: { version: 1, kind, cold: false } }), "cold");
  }
}

// 3. A tenant whose campaign an admin stored on an admin-only preset: read-only, selected, no write
{
  for (const kind of ADMIN_MISSION_CARDS) {
    assert.equal(lockedCard(false, kind), kind);
    assert.equal(lockedCard(true, kind), null, "never locked for an admin");
    assert.equal(lockedCard(false, "lead_gen"), null);
    assert.deepEqual(cardsFor(false, kind), ["qualify_lead", "announce_offer", kind, "other"]);
    // Clicking it (or reaching it with the arrows) never writes.
    assert.equal(presetForPick(kind, kind, { isAdmin: false }), kind);
    // A tenant can't switch TO an admin-only card from another preset either.
    for (const other of ADMIN_MISSION_CARDS) assert.equal(presetForPick("lead_gen", other, { isAdmin: false }), "lead_gen");
    for (const l of LOCALES) {
      const out = cards(kind, { locale: l });
      assert.equal(radios(out), 4, `${l}: the 3 cards + the stored one`);
      assert.match(out, new RegExp(`aria-checked="true" aria-disabled="true"[^>]*data-id="${kind}"`), `${l}: selected and read-only`);
      assert.equal(out.match(/aria-disabled="true"/g)?.length, 1, `${l}: only that card`);
      assert.ok(out.includes(esc(messages(l).MissionBrick.lockedByTeam)), `${l}: says the team set it`);
    }
  }
  // Rendering never calls onPresetChange (an untouched campaign is not written).
  let writes = 0;
  html(createElement(MissionCards, { preset: "follow_up", onPresetChange: () => writes++ }));
  assert.equal(writes, 0);
}

// 4. "Not active yet" for book_for_seller when booking is off (the agent's real capabilities)
{
  const bookingOn = { ...OUTBOUND_TOOLS, booking: { ...OUTBOUND_TOOLS.booking, enabled: true } };
  assert.deepEqual(missionNeeds("book_for_seller", served()), [{ key: "booking", missing: null }]);
  for (const l of LOCALES) {
    const tb = messages(l).ToolsBrick;
    const off = cards("book_for_seller", { isAdmin: true, locale: l, caps: served() });
    assert.ok(off.includes(esc(tb.statusPending)), `${l}: "Not active yet" shown`);
    const mbl = messages(l).MissionBrick;
    const sentence = (reason: string, cap: string) => mbl.needSentence[reason].replace("{cap}", mbl.capNoun[cap]).replace("{tools}", tb.tileLabel);
    assert.ok(off.includes(esc(sentence("off", "booking"))), `${l}: one sentence naming booking`);
    const blocked = cards("book_for_seller", { isAdmin: true, locale: l, caps: served(bookingOn, false) });
    assert.ok(blocked.includes(esc(sentence("not_available_outbound", "booking"))), `${l}: one sentence, no dash`);
    assert.ok(!blocked.includes(" — "), `${l}: no status-code dash`);
    // Tenants never see the line (they can't act on it), even on a stored admin preset.
    for (const preset of ["book_for_seller", "follow_up"]) {
      const tenant = html(createElement(MissionCards, { preset, onPresetChange: () => {}, capabilities: served() }), l);
      assert.ok(!tenant.includes(esc(tb.statusPending)), `${l}: tenant on ${preset} → no "Not active yet"`);
    }
    const unknown = cards("book_for_seller", { isAdmin: true, locale: l, caps: null });
    assert.ok(!unknown.includes(esc(tb.statusPending)), `${l}: no agent / loading → no line`);
    // The proof: "judged from the conversation" until booking is effective, then the booking.
    const mb = messages(l).MissionBrick;
    for (const out of [off, blocked, unknown]) {
      assert.ok(out.includes(esc(mb.proof.estimated)) && !out.includes(esc(mb.proof.booking_created)), `${l}: no booking claim while off`);
    }
    const on = cards("book_for_seller", { isAdmin: true, locale: l, caps: served(bookingOn) });
    assert.ok(!on.includes(esc(tb.statusPending)), `${l}: booking on → no line`);
    assert.ok(on.includes(esc(mb.proof.booking_created)), `${l}: booking on → the booking proof`);
    assert.ok(on.includes(esc(mb.proof.booking_or_transfer)), `${l}: follow_up gated the same way (booking is one of its anyOf)`);
    assert.ok(!off.includes(esc(mb.proof.booking_or_transfer)), `${l}: follow_up, nothing on → estimated`);
    // No card text promises a filled record, a call-back, a transfer or a booking.
    for (const k of ADMIN_MISSION_CARDS) {
      assert.doesNotMatch(mb.kind[k].what, /fiche|rappel|passe l|réserve|lead sheet|call ?back|on the line|books|transfer|כרטיס|שיחה חוזרת|מעבירים|קובעים/i, `${l}: ${k} promises nothing`);
    }
  }
  assert.deepEqual(provableFor("book_for_seller", served()), []);
  assert.deepEqual(provableFor("book_for_seller", served(bookingOn)), ["booking_created"]);
  assert.deepEqual(provableFor("book_for_seller", null), []);
  assert.deepEqual(provableFor("qualify_lead", served(bookingOn)), [], "the 3 cards stay unwired");
  // The editor feeds the picked agent's capabilities from the Tools brick's GET.
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /\/api\/dashboard\/tools\?/);
  assert.match(ws, /capabilities=\{capabilities\}/);
  assert.match(read("app/[locale]/dashboard/campaigns/campaign-setup-step.tsx"), /isAdmin=\{isAdmin\}\s+capabilities=\{capabilities\}/);
  assert.match(read("app/[locale]/dashboard/campaigns/outbound-home.tsx"), /isAdmin=\{isAdmin\}\s+onClose/);
}

// 5. Labels in all 3 locales (cards, campaign list, admin framings), same keys everywhere
{
  for (const l of LOCALES) {
    const m = messages(l);
    for (const kind of ADMIN_MISSION_CARDS) {
      assert.ok(m.MissionBrick.kind[kind].name && m.MissionBrick.kind[kind].what, `${l}: card ${kind}`);
      assert.ok(m.DashboardCampaigns[`goal_${kind}`], `${l}: list label ${kind}`);
      const out = cards("lead_gen", { isAdmin: true, locale: l });
      assert.ok(out.includes(esc(m.MissionBrick.kind[kind].name)), `${l}: ${kind} name rendered`);
    }
    for (const k of ["lockedByTeam", "presetAdminOnly", "presetNeedsBooking"]) assert.ok(m.MissionBrick[k], `${l}: ${k}`);
    // Tenant-facing words: no supplier or technical tool names.
    const words = JSON.stringify([m.MissionBrick, ...ADMIN_MISSION_CARDS.map((k) => m.DashboardCampaigns[`goal_${k}`])]).toLowerCase();
    for (const s of [...SUPPLIERS, ...TOOL_NAMES]) assert.ok(!words.includes(s), `${l}: no "${s}"`);
  }
  const keys = (o: unknown, p = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}${k}.`)) : [p];
  const fr = keys(messages("fr").MissionBrick).sort();
  for (const l of ["en", "he"]) assert.deepEqual(keys(messages(l).MissionBrick).sort(), fr, `${l}: same MissionBrick keys`);
  assert.equal(messages("fr").MissionBrick.kind.book_for_seller.name, "Prendre un rendez-vous pour un vendeur");
  assert.equal(messages("fr").MissionBrick.kind.follow_up.name, "Relancer un client");
  assert.equal(messages("en").MissionBrick.kind.book_for_seller.name, "Book a meeting for a salesperson");
  assert.equal(messages("en").MissionBrick.kind.follow_up.name, "Follow up with a customer");
  // Every capability a mission can need, and every reason, has its sentence.
  for (const l of LOCALES) {
    const mb = messages(l).MissionBrick;
    for (const c of ["booking", "transfer"]) assert.ok(mb.capNoun[c], `${l} capNoun.${c}`);
    for (const r of ["not_available_outbound", "google_not_connected", "no_transfer_number", "off"]) assert.match(mb.needSentence[r], /\{cap\}/, `${l} ${r}`);
  }
  // Campaign list: an icon for every preset (no ✨ fallback for the two), same emoji style.
  for (const p of GOAL_PRESETS) assert.ok(GOAL_EMOJI[p], `icon for ${p}`);
  assert.notEqual(GOAL_EMOJI.book_for_seller, "✨");
  assert.notEqual(GOAL_EMOJI.follow_up, "✨");
  // No TODO placeholders left in the files M2d touched.
  for (const f of ["app/admin/campaign-framings-form.tsx", "app/[locale]/dashboard/campaigns/campaign-setup-step.tsx"]) {
    assert.doesNotMatch(read(f), /TODO\(tamaraHenry\)/, f);
  }
  assert.match(read("app/admin/campaign-framings-form.tsx"), /book_for_seller: "Prendre un rendez-vous pour un vendeur/);
}

// 6. A 403 from a save: one line in our words, never the server's reasons
{
  assert.equal(presetRefusal(403, { error: "preset_admin_only", field: "goalPreset" }), "admin_only");
  assert.equal(presetRefusal(403, { error: "capability_missing", field: "goalPreset", capability: "booking" }), "needs_booking");
  assert.equal(presetRefusal(403, { error: "something_else" }), null, "other 403s are not ours");
  assert.equal(presetRefusal(403, null), null);
  assert.equal(presetRefusal(400, { error: "preset_admin_only" }), null);
  for (const l of LOCALES) {
    const m = messages(l).MissionBrick;
    for (const k of ["presetAdminOnly", "presetNeedsBooking"]) {
      assert.doesNotMatch(m[k], /preset_admin_only|capability_missing|goalPreset|booking_|403/, `${l}: ${k} is our words`);
    }
  }
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /presetRefusal\(res\.status/);
  assert.match(ws, /tMission\(refusal === "admin_only" \? "presetAdminOnly" : "presetNeedsBooking"\)/);
}

// 7. The refusal line is announced and never cut to one line
{
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /<span role="alert" className="text-\[#dc2626\]">\{saveError\}<\/span>/);
  assert.doesNotMatch(ws.slice(ws.indexOf("{saveError ? (") - 200, ws.indexOf("{saveError ? (")), /\btruncate\b/);
}

console.log("mission-m2d-ui: OK");
