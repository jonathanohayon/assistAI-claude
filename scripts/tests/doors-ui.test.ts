// The account's door in the dashboard (lib/doors-ui.ts). For every plan (and
// admin), every door yields the same SET of menu entries (lib/dashboard-nav,
// pinned in dashboard-nav.test.ts) and tiles. Reception (every account
// without a door) keeps the tile and checklist order of the dashboard before
// doors, pinned against fixtures copied from main before #370. Sales and
// connect only reorder tiles and their first checklist steps.
// Plus: one plan name, the selector is gone, ?door forwarding, wiring guards.
// Run with:  npx tsx scripts/tests/doors-ui.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { gridTiles } from "../../app/[locale]/dashboard/config/tile-grid";
import { checklistSteps, nextStep } from "../../components/dashboard/setup-checklist-ui";
import { DEFAULT_DOOR, DOORS, type Door } from "../../lib/door-values";
import {
  DOOR_UI,
  doorOf,
  doorUi,
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
import { navBlocks } from "../../lib/dashboard-nav";
import { entitledProducts } from "../../lib/product-entitlement";
import { productMenu } from "../../lib/product-menu";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sorted = (xs: readonly string[]) => [...xs].sort();
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const ALL_DOORS: (Door | null | undefined | string)[] = [...DOORS, null, undefined, "junk"];

// ── Fixtures: main BEFORE #370 (copied from origin/main 3bee1e5) ────────────
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
  // No "start here" badge on any door (VP): the setup checklist is the guide.
  assert.deepEqual(Object.keys(u).sort(), ["firstSteps", "tileOrder"], `${d}: no highlight field`);
}
assert.ok(!("headerKey" in DOOR_UI.reception), "the door no longer names a home tab (the menu has no home tab)");

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

// ── 1. Menu: the same SET of entries for every door (the door only orders) ──
{
  const menu = productMenu({ entitlement: entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null }), gates: { sales: false, connect: false }, isAdmin: false });
  const sets = ALL_DOORS.map((d) => sorted(navBlocks(d, menu).flatMap((b) => b.items.map((i) => i.href))));
  for (const x of sets) assert.deepEqual(x, sets[0], "same menu entries for every door");
  for (const d of ALL_DOORS) assert.equal(navBlocks(d, menu)[0].items[0].id, doorOf(d), `${String(d)}: its own product first`);
}

// ── "No right changes": the same SET of tiles for every door, every viewer ─
for (const v of viewers) {
  const enabled = canUseOutboundCampaigns(v.isAdmin, v.features);
  for (const withPrompt of [false, true]) {
    for (const saved of [null, [], ["notifs", "voice"], ["campaigns"]]) {
      const tileSets = ALL_DOORS.map((d) => sorted(ids(gridTiles(tiles(withPrompt), saved, d, enabled).tiles)));
      for (const s of tileSets) assert.deepEqual(s, tileSets[0], `${v.name}: same tiles for every door`);
      // The gate is today's: campaigns tile only when outbound is NOT usable (it is the upsell).
      assert.equal(tileSets[0].includes("campaigns"), !enabled, `${v.name}: campaigns tile = upsell iff locked`);
      assert.equal(tileSets[0].length, PRE_PR_TILE_IDS.length - (enabled ? 1 : 0) + (withPrompt ? 1 : 0));
    }
  }
}

// ── 2. Reception = EXACTLY today's tile grid ────────────────────────────────
assert.deepEqual([...TODAY_TILE_ORDER], PRE_PR_TILE_IDS);
for (const d of [DEFAULT_DOOR, null, undefined, "junk"]) {
  for (const enabled of [false, true]) {
    // Same as main's applyTileOrder(TILES, null).filter(campaigns gate).
    const expected = PRE_PR_TILE_IDS.filter((id) => id !== "campaigns" || !enabled);
    assert.deepEqual(ids(gridTiles(tiles(false), null, d, enabled).tiles), expected, `reception tiles (${String(d)})`);
  }
}

// Sales and connect keep their door orders.
const firstTile = (d: Door, enabled: boolean) => gridTiles(tiles(false), null, d, enabled);
assert.deepEqual(ids(firstTile("sales", false).tiles), ["campaigns", "channels", "voice", "persona", "business", "tools", "notifs"]);
assert.deepEqual(ids(firstTile("connect", false).tiles), ["tools", "voice", "channels", "persona", "business", "notifs", "campaigns"]);
// Sales on a plan WITHOUT outbound: the locked campaigns tile is first (the upsell never disappears).
assert.equal(firstTile("sales", false).tiles[0].id, "campaigns");
// Sales with outbound (admin): the tile leaves the grid (menu tab instead).
assert.equal(firstTile("sales", true).tiles.some((t) => t.id === "campaigns"), false);
// No highlight on any door: the grid returns its tiles only, and no tile carries a badge.
for (const d of ALL_DOORS) for (const enabled of [false, true]) assert.deepEqual(Object.keys(gridTiles(tiles(false), null, d, enabled)), ["tiles"]);
{
  const ui = code("app/[locale]/dashboard/config/shared-ui.tsx") + code("app/[locale]/dashboard/config-form.tsx");
  assert.doesNotMatch(ui, /highlightLabel|highlightId|tileStartHere|border-\[#be185d\] bg-white shadow-\[0_8px_28px/, "no start-here badge or ring");
}

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
const connectSteps = [{ id: "clientAgent", done: false }, ...base(false)];
assert.deepEqual(ids(withFirstStep(connectSteps, "connect")), ["clientAgent", ...PRE_PR_STEP_IDS]);
assert.deepEqual(ids(withFirstStep(base(false), "connect")), PRE_PR_STEP_IDS);
// No step added or dropped, for any door; number, forwarding and test call always there.
const every = [...salesSteps, { id: "clientAgent", done: false }];
for (const d of ALL_DOORS) {
  assert.deepEqual(sorted(ids(withFirstStep(every, d))), sorted(ids(every)), "no step added or dropped");
  for (const must of ["number", "forwarding", "testCall"]) assert.ok(ids(withFirstStep(every, d)).includes(must));
}
// Wiring: the live test step opens the dashboard's live test panel, sales only.
{
  const checklist = code("components/dashboard/SetupChecklist.tsx");
  assert.match(checklist, /href: "\/dashboard\/reception#live-test"/);
  assert.match(code("app/[locale]/dashboard/config-form.tsx"), /id="live-test"/, "the anchor exists");
  assert.match(code("app/[locale]/dashboard/config/config-page.tsx"), /liveTest=\{door === "sales" \? \{ done: Boolean\(anyCall\) \} : undefined\}/);
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

// ── The "main use" selector is gone (the door still orders the menu) ──────
{
  assert.equal(existsSync("components/dashboard/DoorSelect.tsx"), false, "DoorSelect deleted");
  for (const f of ["app/[locale]/dashboard/settings/page.tsx", "app/admin/users/[userId]/layout.tsx", "app/[locale]/dashboard/layout.tsx", "lib/doors-ui.ts"]) {
    assert.doesNotMatch(code(f), /DoorSelect|doorPutRequest|doorChangeNeeded/, `${f}: no door selector`);
  }
  for (const locale of ["fr", "en", "he"]) {
    const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
    assert.deepEqual(Object.keys(m.DashboardSettings).filter((k) => /^door/.test(k)), [], `${locale}: the selector's words are gone`);
  }
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
for (const f of ["components/dashboard/DashboardSidebar.tsx", "lib/dashboard-nav.ts", "lib/product-menu.ts", "app/[locale]/dashboard/config-form.tsx", "components/dashboard/SetupChecklist.tsx"]) {
  assert.doesNotMatch(code(f), /from "@\/lib\/door"/, `${f}: client code never imports the server lib/door`);
}
assert.match(code("app/admin/users/[userId]/layout.tsx"), /<DashboardSidebar blocks=\{menuBlocks\} asUserId=\{target\.id\} \/>/);
assert.match(readFileSync("app/admin/users/[userId]/layout.tsx", "utf8"), /navBlocks\(\s*door,/);
assert.match(code("app/[locale]/dashboard/layout.tsx"), /navBlocks\(resolveDoor\(me\?\.door \?\? null\)/);
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
assert.match(code("app/[locale]/dashboard/config-form.tsx"), /gridTiles\(TILES, tileOrder, door, campaignsEnabled\)/);
assert.doesNotMatch(code("app/[locale]/dashboard/config-form.tsx"), /applyTileOrder/);

// Every message key the door uses exists in the three locales.
for (const locale of ["fr", "en", "he"]) {
  const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  for (const k of ["contactsTitle", "contactsDesc", "contactsCta", "contactsLockedDesc", "contactsLockedCta", "clientAgentTitle", "clientAgentDesc", "clientAgentCta", "liveTestTitle", "liveTestDesc", "liveTestCta"]) {
    assert.equal(typeof m.DashboardSetup[k], "string", `${locale}: DashboardSetup.${k}`);
  }
}

// ── Tiles in a row share one height (the row stretches to its tallest tile) ─
{
  const form = code("app/[locale]/dashboard/config-form.tsx");
  // The grid and its sizing are per section (config/sections.ts): the default
  // grid below; Mon agent's two-column grid is pinned in dashboard-nav.test.ts.
  assert.match(form, /<div className=\{sectionGridClass\(section\)\}>\s*\{orderedTiles\.map/);
  assert.match(form, /sizeClass=\{sectionTileSize\(section\)\}/, "config tiles use the row sizing");
  const sections = readFileSync("app/[locale]/dashboard/config/sections.ts", "utf8");
  const grid = sections.match(/export const GRID_DEFAULT = "(@container grid [^"]+)"/);
  assert.ok(grid, "the tile grid is a size container");
  const sizeSrc = readFileSync("app/[locale]/dashboard/config/tile-size.ts", "utf8");
  const size = sizeSrc.match(/export const TILE_ROW_SIZE =\s*"([^"]+)"/)![1];
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
