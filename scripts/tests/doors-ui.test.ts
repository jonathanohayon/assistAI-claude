// The account's door in the dashboard (lib/doors-ui.ts). For every plan (and
// admin), every door yields the same SET of menu tabs and tiles in the same
// tab order (home first, named after the door). Reception (every account
// without a door) is EXACTLY the dashboard before doors: tab, tile and
// checklist order pinned against fixtures copied from main before #370.
// Sales and connect only reorder tiles and their first checklist steps.
// Plus: one plan name, the selector's PUT, ?door forwarding, wiring guards.
// Run with:  npx tsx scripts/tests/doors-ui.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TABS, visibleTabs } from "../../app/[locale]/dashboard/nav-tabs";
import { gridTiles } from "../../app/[locale]/dashboard/config/tile-grid";
import { ADMIN_TABS } from "../../app/admin/users/[userId]/nav-tabs";
import { checklistSteps, nextStep } from "../../components/dashboard/setup-checklist-ui";
import { DEFAULT_DOOR, DOORS, type Door } from "../../lib/door-values";
import {
  DOOR_UI,
  doorChangeNeeded,
  doorOf,
  doorPutRequest,
  doorUi,
  highlightedTile,
  initialTileOrder,
  orderBy,
  STEP_PREREQUISITES,
  TODAY_TILE_ORDER,
  withDoorParam,
  withFirstStep,
} from "../../lib/doors-ui";
import { canUseOutboundCampaigns } from "../../lib/outbound-access";
import { OUTBOUND_UPSELL_PLAN_KEY, outboundPlanName } from "../../lib/outbound-plan";
import { DEFAULT_MATRIX, featuresForPlan, type PlanFeatures } from "../../lib/plan-features";
import { PLANS, planByKey } from "../../lib/plans";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sorted = (xs: readonly string[]) => [...xs].sort();
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const ALL_DOORS: (Door | null | undefined | string)[] = [...DOORS, null, undefined, "junk"];

// ── Fixtures: main BEFORE #370 (copied from origin/main 3bee1e5) ────────────
// app/[locale]/dashboard/_nav.tsx TABS (hrefs, in order).
const PRE_PR_TAB_HREFS = ["/dashboard", "/dashboard/campaigns", "/dashboard/crm", "/dashboard/billing", "/dashboard/logs"];
// app/admin/users/[userId]/_nav.tsx TABS (suffixes, in order).
const PRE_PR_ADMIN_SUFFIXES = ["", "/calendar", "/contacts", "/logs", "/finance"];
// app/[locale]/dashboard/config-form.tsx TILES (ids, in order).
const PRE_PR_TILE_IDS = ["voice", "business", "tools", "persona", "notifs", "channels", "campaigns"];
// components/dashboard/SetupChecklist.tsx items (ids, in order).
const PRE_PR_STEP_IDS = ["number", "testCall", "forwarding", "scan", "calendar", "whatsapp"];

const tiles = (withPrompt: boolean) => [...PRE_PR_TILE_IDS, ...(withPrompt ? ["prompt"] : [])].map((id) => ({ id }));

// Viewers: each plan as a tenant, plus an admin; and a stored matrix that
// turns everything on (outbound stays admin-only whatever is stored).
const allOn: PlanFeatures = { calendar: true, crm: true, whatsapp_confirm: true, whatsapp_recap: true, outbound_campaigns: true };
const viewers: { name: string; features: PlanFeatures; isAdmin: boolean }[] = [
  ...PLANS.map((p) => ({ name: `tenant/${p.key}`, features: featuresForPlan(DEFAULT_MATRIX, p.key), isAdmin: false })),
  { name: "tenant/unknown-plan", features: featuresForPlan(DEFAULT_MATRIX, "essential"), isAdmin: false },
  { name: "tenant/raw-all-on", features: allOn, isAdmin: false },
  { name: "tenant/none", features: { calendar: false, crm: false, whatsapp_confirm: false, whatsapp_recap: false, outbound_campaigns: false }, isAdmin: false },
  { name: "admin", features: featuresForPlan(DEFAULT_MATRIX, null), isAdmin: true },
];

// ── The config table ────────────────────────────────────────────────────────
assert.deepEqual(Object.keys(DOOR_UI).sort(), [...DOORS].sort(), "one entry per door");
for (const d of DOORS) {
  const u = DOOR_UI[d];
  assert.deepEqual(sorted(u.tileOrder), sorted(PRE_PR_TILE_IDS), `${d}: tileOrder lists every tile once`);
  for (const h of u.highlightTiles) assert.ok(u.tileOrder.includes(h), `${d}: highlight ${h} is a tile`);
}
assert.equal(DOOR_UI.reception.headerKey, "doorTitleReception");
assert.equal(DOOR_UI.sales.headerKey, "doorTitleSales");
assert.equal(DOOR_UI.connect.headerKey, "doorTitleConnect");

// ── Default: null, unknown, junk → reception ───────────────────────────────
assert.equal(DEFAULT_DOOR, "reception");
for (const bad of [null, undefined, "", "  ", "sale", "SALES!", 1, {}, ["sales"]]) {
  assert.equal(doorOf(bad), "reception", `doorOf(${JSON.stringify(bad)})`);
  assert.equal(doorUi(bad), DOOR_UI.reception);
}
assert.equal(doorOf(" Sales "), "sales");
assert.equal(doorOf("connect"), "connect");

// ── orderBy: stable, nothing added or dropped, unknown ids keep their place at the end ──
assert.deepEqual(orderBy(["a", "x", "b", "y"], (s) => s, ["b", "a"]), ["b", "a", "x", "y"]);
assert.deepEqual(orderBy([], (s: string) => s, ["a"]), []);

// ── 1. Tabs: today's order for every door, home first ───────────────────────
assert.deepEqual(TABS.map((t) => t.href), PRE_PR_TAB_HREFS, "tenant tabs = main before #370");
assert.deepEqual(ADMIN_TABS.map((t) => t.hrefSuffix), PRE_PR_ADMIN_SUFFIXES, "admin tabs = main before #370");
assert.equal(TABS[0].id, "home");
assert.equal(ADMIN_TABS[0].id, "home");
for (const v of viewers) {
  // The tabs never depend on the door: visibleTabs doesn't even take it.
  const shown = visibleTabs(v.features, v.isAdmin);
  assert.equal(shown[0].id, "home", `${v.name}: home first`);
  assert.deepEqual(
    shown.map((t) => t.href),
    PRE_PR_TAB_HREFS.filter((h) => shown.some((t) => t.href === h)),
    `${v.name}: today's relative order`,
  );
}
assert.equal(visibleTabs.length, 2, "visibleTabs(features, isAdmin): no door parameter");

// ── "No right changes": the same SET of tiles for every door, every viewer ─
for (const v of viewers) {
  const enabled = canUseOutboundCampaigns(v.isAdmin, v.features);
  for (const withPrompt of [false, true]) {
    for (const saved of [null, [], ["notifs", "voice"], ["campaigns"]]) {
      for (const hasNumber of [false, true]) {
        const tileSets = ALL_DOORS.map((d) => sorted(ids(gridTiles(tiles(withPrompt), saved, d, enabled, hasNumber).tiles)));
        for (const s of tileSets) assert.deepEqual(s, tileSets[0], `${v.name}: same tiles for every door`);
        // The gate is today's: campaigns tile only when outbound is NOT usable (it is the upsell).
        assert.equal(tileSets[0].includes("campaigns"), !enabled, `${v.name}: campaigns tile = upsell iff locked`);
        assert.equal(tileSets[0].length, PRE_PR_TILE_IDS.length - (enabled ? 1 : 0) + (withPrompt ? 1 : 0));
      }
    }
  }
}

// ── 2. Reception = EXACTLY today's tile grid ────────────────────────────────
assert.deepEqual([...TODAY_TILE_ORDER], PRE_PR_TILE_IDS);
for (const d of [DEFAULT_DOOR, null, undefined, "junk"]) {
  for (const enabled of [false, true]) {
    for (const hasNumber of [false, true]) {
      // Same as main's applyTileOrder(TILES, null).filter(campaigns gate).
      const expected = PRE_PR_TILE_IDS.filter((id) => id !== "campaigns" || !enabled);
      assert.deepEqual(ids(gridTiles(tiles(false), null, d, enabled, hasNumber).tiles), expected, `reception tiles (${String(d)})`);
    }
  }
}
// "Start here" on the number tile only while there is no number; the tile stays in place.
const recNoNumber = gridTiles(tiles(false), null, "reception", false, false);
assert.equal(recNoNumber.highlightId, "channels");
assert.equal(ids(recNoNumber.tiles).indexOf("channels"), PRE_PR_TILE_IDS.indexOf("channels"));
assert.equal(gridTiles(tiles(false), null, "reception", false, true).highlightId, null);
assert.equal(highlightedTile(null, ["channels"], true), null);

// Sales and connect keep their door orders.
const firstTile = (d: Door, enabled: boolean, hasNumber = false) => gridTiles(tiles(false), null, d, enabled, hasNumber);
assert.deepEqual(ids(firstTile("sales", false).tiles), ["campaigns", "channels", "voice", "persona", "business", "tools", "notifs"]);
assert.deepEqual(ids(firstTile("connect", false).tiles), ["tools", "voice", "channels", "persona", "business", "notifs", "campaigns"]);
assert.equal(firstTile("connect", false).highlightId, "tools");
assert.equal(firstTile("connect", false, true).highlightId, "tools", "connect highlight doesn't depend on the number");
// Sales on a plan WITHOUT outbound: the locked campaigns tile is first and highlighted (the upsell never disappears).
assert.equal(firstTile("sales", false).tiles[0].id, "campaigns");
assert.equal(firstTile("sales", false, true).highlightId, "campaigns");
// Sales with outbound (admin): the tile leaves the grid (menu tab instead); no tile highlighted.
assert.equal(firstTile("sales", true).tiles.some((t) => t.id === "campaigns"), false);
assert.equal(firstTile("sales", true).highlightId, null);
assert.equal(highlightedTile("connect", ["voice"]), null);

// The customer's own drag order beats the door's; an empty one does not count.
assert.deepEqual(initialTileOrder(["notifs", "voice"], "sales"), ["notifs", "voice"]);
assert.deepEqual(initialTileOrder([], "sales"), DOOR_UI.sales.tileOrder);
assert.deepEqual(initialTileOrder(null, "connect"), DOOR_UI.connect.tileOrder);
assert.deepEqual(ids(gridTiles(tiles(false), ["notifs", "voice"], "connect", false).tiles).slice(0, 2), ["notifs", "voice"]);
// The admin-only prompt tile (not in any door order) stays at the end.
assert.equal(ids(gridTiles(tiles(true), null, "sales", true).tiles).at(-1), "prompt");

// ── Checklist ───────────────────────────────────────────────────────────────
const base = (numberDone: boolean) => PRE_PR_STEP_IDS.map((id) => ({ id, done: id === "scan" || (numberDone && id === "number") }));
// 2. Reception: exactly today's order, with or without a number (the number is first).
for (const d of [DEFAULT_DOOR, null, "junk"]) {
  for (const numberDone of [false, true]) {
    assert.deepEqual(ids(withFirstStep(base(numberDone), d)), PRE_PR_STEP_IDS, `reception checklist (${String(d)}, number ${numberDone})`);
  }
}
assert.deepEqual(STEP_PREREQUISITES, { testCall: ["number"], forwarding: ["number"] });
// 6. Sales: the locked import, then the free live test, then today's order.
const salesSteps = [
  { id: "contacts", done: false, locked: true },
  { id: "liveTest", done: false },
  ...base(false),
];
assert.deepEqual(DOOR_UI.sales.firstSteps, ["contacts", "liveTest"]);
assert.deepEqual(ids(withFirstStep(salesSteps, "sales")), ["contacts", "liveTest", ...PRE_PR_STEP_IDS]);
// The live test is offered for sales only, and the step order holds even if passed in another order.
assert.deepEqual(ids(withFirstStep([...base(false), salesSteps[1], salesSteps[0]], "sales")).slice(0, 2), ["contacts", "liveTest"]);
for (const d of ["reception", "connect"] as const) assert.ok(!DOOR_UI[d].firstSteps.includes("liveTest"));
const sales = checklistSteps(salesSteps, "sales");
assert.equal(sales.total, salesSteps.length - 1, "the locked import isn't counted");
assert.equal(sales.done, 1);
assert.equal(nextStep(sales.items)?.id, "liveTest", "a new sales account has something to do before paying");
assert.equal(nextStep([{ id: "contacts", done: false, locked: true }]), null);
// Connect: the agent address first; absent (not open for the account) → today's order.
const connectSteps = [{ id: "agentUrl", done: false }, ...base(false)];
assert.deepEqual(ids(withFirstStep(connectSteps, "connect")), ["agentUrl", ...PRE_PR_STEP_IDS]);
assert.deepEqual(ids(withFirstStep(base(false), "connect")), PRE_PR_STEP_IDS);
// No step added or dropped, for any door; number, forwarding and test call always there.
const every = [...salesSteps, { id: "agentUrl", done: false }];
for (const d of ALL_DOORS) {
  assert.deepEqual(sorted(ids(withFirstStep(every, d))), sorted(ids(every)), "no step added or dropped");
  for (const must of ["number", "forwarding", "testCall"]) assert.ok(ids(withFirstStep(every, d)).includes(must));
}
// Wiring: the live test step opens the dashboard's live test panel, sales only.
{
  const checklist = code("components/dashboard/SetupChecklist.tsx");
  assert.match(checklist, /href: "\/dashboard#live-test"/);
  assert.match(code("app/[locale]/dashboard/config-form.tsx"), /id="live-test"/, "the anchor exists");
  assert.match(code("app/[locale]/dashboard/page.tsx"), /liveTest=\{door === "sales" \? \{ done: Boolean\(anyCall\) \} : undefined\}/);
}

// ── 5. One plan name (the upsell's plan) on the tile, the step and the upsell ─
assert.equal(OUTBOUND_UPSELL_PLAN_KEY, "premium");
assert.equal(outboundPlanName(() => null), planByKey("premium").name, "falls back to the plan data");
assert.equal(outboundPlanName((k) => (k === "premium.name" ? "Clinic / Multi-site" : null)), "Clinic / Multi-site");
for (const locale of ["fr", "en", "he"]) {
  const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  for (const s of [m.DashboardConfig.campaignsTileLocked, m.DashboardSetup.contactsLockedDesc]) {
    assert.match(s, /\{plan\}/, `${locale}: the plan name comes from the plan data`);
    assert.doesNotMatch(s, /\bPro\b/, `${locale}: no hard-coded "Pro" plan`);
  }
  assert.equal(m.DashboardConfig.campaignsTileLocked, m.DashboardSetup.contactsLockedDesc, `${locale}: same line on the tile and the step`);
  assert.equal(typeof m.Plans.premium.name, "string");
}
assert.match(code("app/[locale]/dashboard/config-form.tsx"), /t\("campaignsTileLocked", \{ plan: outboundPlanName\(/);
assert.match(code("components/dashboard/SetupChecklist.tsx"), /t\("contactsLockedDesc", \{ plan: outboundPlanName\(/);
assert.match(code("app/[locale]/dashboard/campaigns/upsell-modal.tsx"), /outboundPlanName\(/);
assert.doesNotMatch(code("app/[locale]/dashboard/campaigns/upsell-modal.tsx"), /planByKey\("premium"\)/);

// ── The selector's PUT ───────────────────────────────────────────────────────
for (const d of DOORS) {
  const own = doorPutRequest(d);
  assert.equal(own.url, "/api/dashboard/account");
  assert.equal(own.init.method, "PUT");
  assert.deepEqual(JSON.parse(String(own.init.body)), { door: d }, "only the door: developerMode untouched (partial PUT)");
  assert.deepEqual(own.init.headers, { "Content-Type": "application/json" });
}
const forTenant = doorPutRequest("connect", "0000-tenant id&x=1");
assert.equal(forTenant.url, "/api/dashboard/account?asUserId=0000-tenant%20id%26x%3D1");
assert.deepEqual(JSON.parse(String(forTenant.init.body)), { door: "connect" });
assert.equal(doorPutRequest("sales", null).url, "/api/dashboard/account");
assert.equal(doorPutRequest("sales", "").url, "/api/dashboard/account");

// The same door does nothing: no PUT and no reset of the saved tile order.
for (const d of DOORS) {
  assert.equal(doorChangeNeeded(d, d), false, `${d} → ${d}: no save`);
  for (const other of DOORS.filter((x) => x !== d)) assert.equal(doorChangeNeeded(d, other), true);
}
for (const bad of ["", "junk", null, undefined, 1]) assert.equal(doorChangeNeeded("sales", bad), false);
{
  // The guard sits BEFORE the fetch and the localStorage reset in choose().
  const selectSrc = code("components/dashboard/DoorSelect.tsx");
  const body = selectSrc.slice(selectSrc.indexOf("const choose"));
  const guard = body.indexOf("if (!doorChangeNeeded(door, next)) return;");
  assert.ok(guard > 0, "choose() starts with the same-door guard");
  assert.ok(guard < body.indexOf("fetch(url"), "no PUT for the same door");
  assert.ok(guard < body.indexOf("localStorage.removeItem"), "no order reset for the same door");
  assert.match(selectSrc, /t\("doorResetNote"\)/, "the selector says a change resets the tile order");
}

// ── ?door forwarding (signup ↔ login) ───────────────────────────────────────
assert.equal(withDoorParam("/signup", "sales"), "/signup?door=sales");
assert.equal(withDoorParam("/login", "connect"), "/login?door=connect");
assert.equal(withDoorParam("/signup", " SALES "), "/signup?door=sales");
assert.equal(withDoorParam("/signup?plan=x", "sales"), "/signup?plan=x&door=sales");
assert.equal(withDoorParam("/signup", "reception"), "/signup", "the default needs no parameter");
for (const bad of [undefined, null, "", "sale", "sales&admin=1", "<script>", 1, ["sales"]]) {
  assert.equal(withDoorParam("/signup", bad), "/signup", `dropped: ${JSON.stringify(bad)}`);
}

// ── Wiring guards ────────────────────────────────────────────────────────────
const doorsUi = code("lib/doors-ui.ts");
assert.deepEqual([...doorsUi.matchAll(/from "([^"]+)"/g)].map((m) => m[1]), ["./door-values"], "doors-ui imports door-values only");
for (const f of ["app/[locale]/dashboard/_nav.tsx", "app/admin/users/[userId]/_nav.tsx", "components/dashboard/DoorSelect.tsx", "app/[locale]/dashboard/config-form.tsx", "components/dashboard/SetupChecklist.tsx"]) {
  assert.doesNotMatch(code(f), /from "@\/lib\/door"/, `${f}: client code never imports the server lib/door`);
}
const select = code("components/dashboard/DoorSelect.tsx");
assert.match(select, /doorPutRequest\(next, asUserId\)/);
assert.match(select, /localStorage\.removeItem\(TILE_ORDER_KEY\)/, "a door change clears the saved tile order");
assert.match(select, /router\.refresh\(\)/);
assert.match(select, /role="alert"/, "errors inline");
assert.match(select, /<label htmlFor=\{id\}/, "the admin banner keeps a labelled native select");
// 3. Settings: the bricks' choice chips (radio group, arrows, focus ring, RTL), not a listbox.
assert.match(select, /<ChipGroup\s/);
assert.match(select, /from "@\/components\/bricks\/controls"/);
assert.match(select, /if \(compact\) \{[\s\S]*<select[\s\S]*\}\s*\n\s*return \(/, "the native select is the compact (admin) branch only");
{
  const controls = readFileSync("components/bricks/controls.tsx", "utf8");
  const chip = controls.slice(controls.indexOf("export function ChipGroup"), controls.indexOf("export function ToggleRow"));
  assert.match(chip, /role="radiogroup"/);
  assert.match(chip, /role="radio"/);
  assert.match(chip, /onKeyDown=\{radioKeys\(/, "arrow keys");
  assert.match(chip, /\$\{FOCUS\}/, "visible focus ring");
  assert.match(chip, /active \? SELECTED/, "selected = brand magenta");
  assert.match(controls, /direction === "rtl"/, "RTL-aware arrows");
}
assert.match(code("app/[locale]/dashboard/settings/page.tsx"), /<DoorSelect initialDoor=\{resolveDoor\(me\.door\)\} \/>/);
assert.match(code("app/admin/users/[userId]/layout.tsx"), /<DoorSelect initialDoor=\{door\} asUserId=\{target\.id\} compact \/>/);
assert.match(code("app/admin/users/[userId]/layout.tsx"), /<AdminTenantTabs userId=\{target\.id\} door=\{door\} \/>/);
assert.match(code("app/[locale]/dashboard/layout.tsx"), /door=\{resolveDoor\(me\?\.door \?\? null\)\}/);
assert.match(code("app/[locale]/login/page.tsx"), /href=\{withDoorParam\("\/signup", door\)\}/, "login → signup keeps ?door");
{
  // The login page reads ?door ONLY to forward it to /signup: it never reaches
  // the sign-in actions, a cookie, a redirect or the database (an existing
  // account's door is never changed by a link). The DB side of sign-in is
  // pinned in account-door-db.test.ts (googleSignIn keeps an existing door).
  const login = code("app/[locale]/login/page.tsx");
  const uses = [...login.matchAll(/\bdoor\b/g)].length;
  assert.equal(uses, 3, "door: the searchParams type, the destructure, the /signup link; nothing else");
  assert.doesNotMatch(login, /signup_door|cookies\(/, "login sets no door cookie");
  assert.doesNotMatch(login, /lib\/door"|parseDoor|users\.door/, "login never parses or writes a door");
}
assert.match(code("app/[locale]/signup/signup-content.tsx"), /href=\{withDoorParam\("\/login", door\)\}/, "signup → login keeps ?door");
assert.match(code("app/[locale]/dashboard/config-form.tsx"), /gridTiles\(TILES, tileOrder, door, campaignsEnabled, Boolean\(primaryPhone\)\)/);
assert.doesNotMatch(code("app/[locale]/dashboard/config-form.tsx"), /applyTileOrder/);

// Every message key the door uses exists in the three locales.
for (const locale of ["fr", "en", "he"]) {
  const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  for (const d of DOORS) assert.equal(typeof m.Dashboard[DOOR_UI[d].headerKey], "string", `${locale}: ${DOOR_UI[d].headerKey}`);
  assert.equal(typeof m.Dashboard.tabConfiguration, "string", "the existing key is kept");
  for (const k of ["doorLabel", "doorHint", "doorOptionReception", "doorOptionSales", "doorOptionConnect", "doorResetNote", "doorSaveError"]) {
    assert.equal(typeof m.DashboardSettings[k], "string", `${locale}: DashboardSettings.${k}`);
  }
  for (const k of ["contactsTitle", "contactsDesc", "contactsCta", "contactsLockedDesc", "contactsLockedCta", "agentUrlTitle", "agentUrlDesc", "agentUrlCta", "liveTestTitle", "liveTestDesc", "liveTestCta"]) {
    assert.equal(typeof m.DashboardSetup[k], "string", `${locale}: DashboardSetup.${k}`);
  }
  assert.equal(typeof m.DashboardConfig.tileStartHere, "string");
}
const fr = JSON.parse(readFileSync("messages/fr.json", "utf8"));
assert.deepEqual([fr.Dashboard.doorTitleReception, fr.Dashboard.doorTitleSales, fr.Dashboard.doorTitleConnect], ["Réceptionniste", "Ventes", "Votre agent"]);
assert.equal(fr.DashboardSettings.doorLabel, "Mon usage principal");

// ── Tiles in a row share one height (the row stretches to its tallest tile) ─
{
  const form = code("app/[locale]/dashboard/config-form.tsx");
  const grid = form.match(/<div className="(@container grid [^"]+)">\s*\{orderedTiles\.map/);
  assert.ok(grid, "the tile grid is a size container");
  assert.match(form, /sizeClass=\{TILE_ROW_SIZE\}/, "config tiles use the row sizing");
  const shared = readFileSync("app/[locale]/dashboard/config/shared-ui.tsx", "utf8");
  const size = shared.match(/export const TILE_ROW_SIZE =\s*"([^"]+)"/)![1];
  assert.doesNotMatch(size, /aspect-|h-full/, "aspect-ratio (or a fixed height) would stop the row stretch");
  // One square minimum per breakpoint, matching the grid's columns and gap-3.
  const cols: Record<string, number> = {};
  for (const m of grid![1].matchAll(/(?:(\w+):)?grid-cols-(\d)/g)) cols[m[1] ?? ""] = Number(m[2]);
  assert.match(grid![1], /\bgap-3\b/);
  for (const [bp, n] of Object.entries(cols)) {
    const gaps = `${((n - 1) * 0.75).toString()}rem`;
    const cls = `${bp ? `${bp}:` : ""}min-h-[calc((100cqw_-_${gaps})/${n})]`;
    assert.ok(size.split(" ").includes(cls), `${bp || "base"}: ${cls}`);
  }
}

console.log("doors-ui: OK");
