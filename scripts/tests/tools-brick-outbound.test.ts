// Tools brick on outbound agents (T4b): hidden unless the server says
// visible; when visible, booking and transfer only; a refused save in words.
// Renders the REAL ToolsBrick to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/tools-brick-outbound.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS, toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, type CapabilityKey, type Tools } from "../../lib/tools/contract";
import { ToolsBrick } from "../../components/bricks/tools/ToolsBrick";
import {
  activeCount,
  capabilityList,
  refusedCapabilities,
  toolsBrickVisible,
  type ToolsKind,
  type ToolsResponse,
} from "../../components/bricks/tools/tools-ui";

// children go as the third argument; the props type still requires them.
type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));

// Every capability switched on, so a hidden row can't hide behind "off".
const ALL_ON: Tools = {
  ...OUTBOUND_TOOLS,
  booking: { ...OUTBOUND_TOOLS.booking, enabled: true },
  contacts: { enabled: true },
  transfer: { ...OUTBOUND_TOOLS.transfer, enabled: true },
  orders: { ...OUTBOUND_TOOLS.orders, enabled: true },
};
const OFF: Tools = OUTBOUND_TOOLS;

/** A server answer for an outbound agent, as GET ?agentId= returns it (#246). */
function outboundServed(visible: boolean | undefined, tools: Tools, transferNumber = ""): ToolsResponse {
  const capabilities = effectiveCapabilities(
    { recipe: "outbound", tools },
    { transferNumber, googleConnected: false, outboundToolsEnabled: visible === true },
    DEFAULT_MATRIX.premium,
  );
  return {
    tools,
    capabilities,
    account: { googleConnected: false, transferNumberSet: !!transferNumber, transferNumber: transferNumber || null },
    upgrade: {},
    ...(visible === undefined ? {} : { outboundTools: { visible } }),
  };
}

function render(kind: ToolsKind, served: ToolsResponse, tools: Tools, locale = "en", refused: CapabilityKey[] | null = null) {
  const brick = createElement(ToolsBrick, { kind, served, tools, onChange: () => {}, returnTo: "/dashboard/campaigns", refused });
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, brick));
}

const en = messages("en").ToolsBrick;

// 1. visible=false (OUTBOUND_TOOLS unset in production: the default path) → nothing rendered
{
  const served = outboundServed(false, ALL_ON);
  assert.equal(toolsBrickVisible("outbound", served), false);
  assert.equal(render("outbound", served, ALL_ON), "", "visible=false renders nothing");
  // No answer at all (older server, error) is also no.
  assert.equal(toolsBrickVisible("outbound", outboundServed(undefined, ALL_ON)), false);
  assert.equal(render("outbound", outboundServed(undefined, ALL_ON), ALL_ON), "");
  assert.equal(toolsBrickVisible("outbound", null), false, "new agent / loading: no tile");
  // …and nothing that would make an empty tile: the editor gates the tile on the same helper.
  const editor = read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx");
  assert.match(editor, /const showTools = toolsBrickVisible\("outbound", toolsServed\)/);
  assert.match(editor, /\.\.\.\(showTools && toolsServed\s*\?\s*\[\s*\{\s*id: "tools"/, "tools tile only when visible");
  assert.doesNotMatch(editor, /saveAgentFirst/, "no placeholder tile body for a new agent");
}

// 2. visible=true → booking and transfer only, switches off by default, the "why" line
{
  const served = outboundServed(true, OFF);
  assert.equal(toolsBrickVisible("outbound", served), true);
  assert.deepEqual(capabilityList(served.capabilities, "outbound").switches.map((v) => [v.key, v.status]), [
    ["booking", "off"],
    ["transfer", "off"],
  ]);
  const html = render("outbound", served, OFF);
  assert.ok(html.includes(en.cap.booking.name) && html.includes(en.cap.transfer.name));
  for (const k of ["contacts", "orders"]) {
    assert.ok(!html.includes(en.cap[k].name), `${k}: no row`);
    assert.ok(!html.includes(`tools-${k}-label`), `${k}: no switch`);
  }
  assert.ok(!html.includes(en.missing.not_available_outbound), "no 'not available' line");
  assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-checked="false"/g) ?? []).length, 2, "off by default");
  // Design review: on an outbound call nobody is "the caller" (we called them).
  for (const l of ["fr", "en", "he"]) {
    const out = render("outbound", served, OFF, l);
    const msgs = messages(l) as { ToolsBrick: { cap: { transfer: { what: string; whatOutbound: string } } } };
    assert.ok(out.includes(msgs.ToolsBrick.cap.transfer.whatOutbound.replace(/'/g, "&#x27;")), `${l}: outbound transfer line`);
    assert.doesNotMatch(out, /appelant|caller|המתקשר/i, `${l}: no "caller" on outbound`);
    assert.match(msgs.ToolsBrick.cap.transfer.whatOutbound, /navigateur ne transfère pas|browser test does not transfer|הבדיקה בדפדפן לא מעבירה/, `${l}: keeps the browser-test sentence`);
  }

  // Switched on (unsaved): each says why it isn't active yet.
  const on = render("outbound", served, ALL_ON);
  assert.ok(on.includes(en.statusPending), "Not active yet");
  assert.ok(on.includes(en.missing.no_transfer_number));
  assert.ok(on.includes(en.googleNotice.split(":")[0]), "Google notice for booking");
  assert.ok(!on.includes(en.cap.contacts.name) && !on.includes(en.cap.orders.name), "hidden even when stored on");
  // The tile count follows the shown rows (contacts/orders stored on never count).
  const allOn = outboundServed(true, ALL_ON, "+15555550100");
  assert.equal(activeCount(allOn.capabilities, "outbound"), 1, "transfer only (booking waits for Google)");
  // Hebrew renders the same two rows.
  const he = render("outbound", served, OFF, "he");
  assert.equal((he.match(/role="switch"/g) ?? []).length, 2);
}

// 3. A 403 outbound_tools_disabled maps to plain words, never the code
{
  assert.deepEqual(refusedCapabilities(403, { error: "outbound_tools_disabled", fields: ["tools.booking.enabled"] }), ["booking"]);
  assert.deepEqual(refusedCapabilities(403, { error: "outbound_tools_disabled", fields: ["tools.transfer.enabled", "tools.booking.enabled"] }), ["booking", "transfer"]);
  assert.deepEqual(refusedCapabilities(403, { error: "outbound_tools_disabled" }), []);
  assert.equal(refusedCapabilities(403, { error: "Forbidden" }), null, "another 403 stays the generic error");
  assert.equal(refusedCapabilities(400, { error: "invalid_tools", fields: [] }), null);
  assert.equal(refusedCapabilities(200, null), null);
  for (const l of ["fr", "en", "he"]) {
    const m = messages(l).ToolsBrick;
    const served = outboundServed(true, OFF);
    const html = render("outbound", served, OFF, l, ["booking"]);
    assert.match(html, /role="alert"/, l);
    assert.ok(html.includes(m.refusedOutbound.split("{list}")[0]), `${l}: words`);
    assert.ok(!html.includes("outbound_tools_disabled") && !html.includes("tools.booking.enabled"), `${l}: never the code`);
    const any = render("outbound", served, OFF, l, []);
    assert.ok(any.includes(m.refusedOutboundAny.slice(-20)), `${l}: words without fields`);
  }
  const ws = read("app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx");
  assert.match(ws, /refusedCapabilities\(tres\.status, tdata\)/, "the outbound save reads the 403");
  assert.match(ws, /\/api\/dashboard\/tools\?\$\{new URLSearchParams\([^`]*agentId \}\)\}`/, "the outbound save uses the agentId route");
}

// 4. The receptionist is unchanged: all four rows, no visibility gate
{
  const tools = toolsFromTileToggles({ calendar: true, customers: true, orders: true });
  const capabilities = effectiveCapabilities({ recipe: "receptionist", tools }, { transferNumber: "+15555550100", googleConnected: true }, DEFAULT_MATRIX.premium);
  const served: ToolsResponse = { tools, capabilities, account: { googleConnected: true, transferNumberSet: true, transferNumber: "+15555550100" }, upgrade: {} };
  assert.equal(toolsBrickVisible("inbound", served), true, "no outboundTools field needed");
  assert.deepEqual(capabilityList(capabilities).switches.map((v) => v.key), ["booking", "contacts", "transfer", "orders"]);
  assert.deepEqual(capabilityList(capabilities, "inbound"), capabilityList(capabilities));
  const html = render("inbound", served, tools);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 4);
  for (const k of ["booking", "contacts", "transfer", "orders"]) assert.ok(html.includes(en.cap[k].name), k);
  assert.ok(html.includes(en.cap.transfer.what), "receptionist keeps its 'caller' sentence");
  assert.ok(html.includes(en.intro));
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /tTools\("tileTagline"\)/, "receptionist tile tagline unchanged");
}

console.log("ALL TOOLS-BRICK OUTBOUND TESTS PASSED");
