// Tools brick (T2): how each capability state is shown. Mock data only.
// Run with:  npx tsx scripts/tests/tools-brick.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS, toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, type CapabilityState } from "../../lib/tools/contract";
import { activeCount, capabilityList, capabilityView, inSentence, localPhone, toolsPatch, waitingForGoogle } from "../../components/bricks/tools/tools-ui";
import { TOOL_NAMES } from "../tenant-bundle-match.mjs";

const S = (over: Partial<CapabilityState> & { met?: boolean; missing?: CapabilityState["prerequisite"]["missing"] } = {}): CapabilityState => ({
  requested: over.requested ?? true,
  planIncluded: over.planIncluded ?? true,
  prerequisite: { met: over.met ?? true, missing: over.missing ?? null },
  active: over.active ?? true,
});

// 1. Words for each state; a missing prerequisite always shows, even when the call is "active"
{
  assert.deepEqual(capabilityView("booking", S()), { key: "booking", status: "on", missing: null, action: null });
  assert.equal(capabilityView("booking", S({ requested: false, active: false })).status, "off");
  // T1 today: Google missing does NOT turn booking off on the call → active true, screen still says "not active yet".
  assert.deepEqual(capabilityView("booking", S({ met: false, missing: "google_not_connected", active: true })), {
    key: "booking",
    status: "pending",
    missing: "google_not_connected",
    action: "connectGoogle",
  });
  assert.equal(capabilityView("transfer", S({ met: false, missing: "no_transfer_number", active: false })).action, "addNumber");
  assert.equal(capabilityView("booking", S({ met: false, missing: "not_available_outbound", active: false })).action, null);
}

// 2. Not in the plan → never a switch, gathered for the bottom line
{
  const account = { transferNumber: "", googleConnected: false };
  const tools = toolsFromTileToggles({ calendar: true, customers: true, orders: true });
  const caps = effectiveCapabilities({ recipe: "receptionist", tools }, account, DEFAULT_MATRIX.whatsapp);
  const { switches, notInPlan } = capabilityList(caps);
  assert.deepEqual(notInPlan, ["booking", "contacts", "orders"]);
  assert.deepEqual(switches.map((s) => [s.key, s.status, s.action]), [["transfer", "pending", "addNumber"]]);
}

// 3. Same input → the screen's states are the call's (no client-side recomputation)
{
  const tools = toolsFromTileToggles({ calendar: true, customers: false, orders: false });
  const caps = effectiveCapabilities({ recipe: "receptionist", tools }, { transferNumber: "+000", googleConnected: true }, DEFAULT_MATRIX.premium);
  const { switches } = capabilityList(caps);
  for (const v of switches) {
    const s = caps[v.key];
    // "on" exactly when the call gets it and nothing is missing.
    assert.equal(v.status === "on", s.active && s.prerequisite.met, v.key);
    assert.equal(v.status === "off", !s.requested, v.key);
  }
  const out = capabilityList(effectiveCapabilities({ recipe: "outbound", tools: OUTBOUND_TOOLS }, { transferNumber: "+000", googleConnected: true }, DEFAULT_MATRIX.premium));
  assert.ok(out.switches.every((v) => v.status === "off"), "outbound: everything off while OUTBOUND_TOOLS is off");
  assert.ok(out.switches.every((v) => v.missing === "not_available_outbound"));
  // T4b: the outbound screen never lists a capability the call can't use.
  const outCaps = effectiveCapabilities({ recipe: "outbound", tools: OUTBOUND_TOOLS }, { transferNumber: "+000", googleConnected: true }, DEFAULT_MATRIX.premium);
  assert.deepEqual(capabilityList(outCaps, "outbound"), { switches: [], notInPlan: [] });
  const outOn = effectiveCapabilities({ recipe: "outbound", tools: OUTBOUND_TOOLS }, { transferNumber: "+000", googleConnected: true, outboundToolsEnabled: true }, DEFAULT_MATRIX.premium);
  assert.deepEqual(capabilityList(outOn, "outbound").switches.map((v) => v.key), ["booking", "transfer"]);
}

// 4. Save patch: only what changed, key by key
{
  const base = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  assert.deepEqual(toolsPatch(base, structuredClone(base)), {});
  assert.deepEqual(toolsPatch(base, { ...base, orders: { ...base.orders, enabled: true } }), { orders: { enabled: true } });
}

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 5. One module on both screens; the tenant-facing tool-names box is gone
{
  for (const f of ["app/[locale]/dashboard/config-form.tsx", "app/[locale]/dashboard/campaigns/agents/agent-editor.tsx"]) {
    const src = read(f);
    assert.match(src, /import \{ ToolsBrick \} from "@\/components\/bricks\/tools\/ToolsBrick"/, f);
    assert.match(src, /<ToolsBrick\b/, f);
  }
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /kind="inbound"[\s\S]*served=\{toolsServed\}/);
  assert.match(read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx"), /kind="outbound"[\s\S]*served=\{toolsServed\}/);
  assert.ok(!existsSync(join(ROOT, "app/[locale]/dashboard/config/tools-available-hint.tsx")));
  assert.doesNotMatch(read("app/[locale]/dashboard/config/persona-panel.tsx"), /ToolsAvailableHint/);
}

// 6. No technical tool name in tenant code; no level 2 until the call reads it; level 3 only from the admin response
{
  const names = new RegExp(`\\b(?:${(TOOL_NAMES as string[]).join("|")})\\b`);
  for (const f of [
    "components/bricks/tools/ToolsBrick.tsx",
    "components/bricks/tools/tools-ui.ts",
    "app/[locale]/dashboard/config-form.tsx",
    "app/[locale]/dashboard/config/persona-panel.tsx",
    "app/[locale]/dashboard/campaigns/agents/agent-editor.tsx",
    "app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx",
  ])
    assert.doesNotMatch(read(f), names, `${f}: technical tool name`);
  for (const l of ["fr", "en", "he"]) assert.doesNotMatch(JSON.stringify(JSON.parse(read(`messages/${l}.json`)).ToolsBrick), names, l);
  const brick = read("components/bricks/tools/ToolsBrick.tsx");
  // No level 2: no "More settings" disclosure (level 3 is <MoreSettings level={3}>) and none of its fields.
  assert.doesNotMatch(brick, /<MoreSettings(?![^>]*level=\{3\})|defaultDurationMinutes|minNoticeMinutes|\.when\b|orders\.ask/, "no level 2 in T2");
  assert.match(brick, /\{served\.admin && \(/, "level 3 renders only what the server sent");
  // Tenant code imports only the contract from lib/tools.
  assert.doesNotMatch(brick + read("components/bricks/tools/tools-ui.ts"), /from "@\/lib\/tools\/(?!contract")/);
}

// 7. Copy: same keys in fr/en/he; every capability has name, what, on; every missing code has words
{
  const keys = (o: Record<string, unknown>, pre = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${pre}${k}.`) : [`${pre}${k}`]));
  const [fr, en, he] = ["fr", "en", "he"].map((l) => keys(JSON.parse(read(`messages/${l}.json`)).ToolsBrick).sort());
  assert.deepEqual(en, fr);
  assert.deepEqual(he, fr);
  for (const c of ["booking", "contacts", "transfer", "orders"]) for (const f of ["name", "what", "on"]) assert.ok(fr.includes(`cap.${c}.${f}`), `${c}.${f}`);
  for (const m of ["google_not_connected", "no_transfer_number", "not_available_outbound"]) assert.ok(fr.includes(`missing.${m}`), m);
}

// 8. No row promises in the browser test what only a phone call does: transfer says so, in every language
{
  const t = (l: string) => JSON.parse(read(`messages/${l}.json`)).ToolsBrick.cap.transfer.what as string;
  assert.match(t("fr"), /test dans le navigateur ne transfère pas/);
  assert.match(t("en"), /browser test does not transfer/);
  assert.match(t("he"), /הבדיקה בדפדפן לא מעבירה/);
  // "Test it" wording is never attached to a capability's active state.
  for (const l of ["fr", "en", "he"]) {
    const cap = JSON.parse(read(`messages/${l}.json`)).ToolsBrick.cap as Record<string, { on: string }>;
    for (const [k, v] of Object.entries(cap)) assert.doesNotMatch(v.on, /test|בדק|בדיק/i, `${l} ${k}.on`);
  }
}

// 9. The tile counts what the screen calls active, not what T1 lets the call have
{
  const tools = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  const caps = effectiveCapabilities({ recipe: "receptionist", tools }, { transferNumber: "+000", googleConnected: false }, DEFAULT_MATRIX.premium);
  assert.equal(caps.booking.active, true, "T1: Google not enforced on the call");
  assert.equal(activeCount(caps), 1, "only transfer is honestly active");
}

// 11. Design review: one Google notice, the transfer number shown, the plan line as a sentence
{
  const tools = toolsFromTileToggles({ calendar: true, customers: true, orders: true });
  const caps = effectiveCapabilities({ recipe: "receptionist", tools }, { transferNumber: "+000", googleConnected: false }, DEFAULT_MATRIX.premium);
  assert.deepEqual(waitingForGoogle(capabilityList(caps).switches), ["booking", "contacts"]);
  const off = effectiveCapabilities({ recipe: "receptionist", tools: { ...tools, contacts: { enabled: false } } }, { transferNumber: "+000", googleConnected: false }, DEFAULT_MATRIX.premium);
  assert.deepEqual(waitingForGoogle(capabilityList(off).switches), ["booking"], "a switched-off capability isn't waiting");
  assert.equal(localPhone("+972500000000"), "050 000 0000");
  assert.equal(localPhone("+97221234567"), "02 123 4567");
  assert.equal(localPhone("+33612345678"), "06 12 34 56 78");
  assert.equal(localPhone("+15555550100"), "+15555550100");
  assert.equal(inSentence("Prendre des rendez-vous", "fr"), "prendre des rendez-vous");
  assert.equal(inSentence("קביעת פגישות", "he"), "קביעת פגישות");
}

console.log("ALL TOOLS-BRICK TESTS PASSED");
