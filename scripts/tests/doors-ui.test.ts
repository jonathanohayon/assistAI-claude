// The account's door in the dashboard (lib/doors-ui.ts): it only ORDERS and
// highlights. For every plan (and admin), every door yields the same SET of
// menu tabs, tiles and checklist steps; only the order and the highlight
// differ. Plus: the selector's PUT, the ?door forwarding, wiring guards.
// Run with:  npx tsx scripts/tests/doors-ui.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { visibleTabs } from "../../app/[locale]/dashboard/nav-tabs";
import { gridTiles } from "../../app/[locale]/dashboard/config/tile-grid";
import { ADMIN_TABS, adminTenantTabs } from "../../app/admin/users/[userId]/nav-tabs";
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
  withDoorParam,
  withFirstStep,
} from "../../lib/doors-ui";
import { canUseOutboundCampaigns } from "../../lib/outbound-access";
import { DEFAULT_MATRIX, featuresForPlan, type PlanFeatures } from "../../lib/plan-features";
import { PLANS } from "../../lib/plans";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sorted = (xs: readonly string[]) => [...xs].sort();
const ALL_DOORS: (Door | null | undefined | string)[] = [...DOORS, null, undefined, "junk"];

// Every tile the config form can render (config-form.tsx TILES, + the admin-only "prompt").
const TILE_IDS = ["voice", "business", "tools", "persona", "notifs", "channels", "campaigns"];
const tiles = (withPrompt: boolean) => [...TILE_IDS, ...(withPrompt ? ["prompt"] : [])].map((id) => ({ id }));

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
  assert.deepEqual(sorted(u.tabOrder), sorted(DOOR_UI.reception.tabOrder), `${d}: tabOrder lists the same tabs`);
  assert.deepEqual(sorted(u.tileOrder), sorted(TILE_IDS), `${d}: tileOrder lists every tile once`);
  assert.equal(new Set(u.tabOrder).size, u.tabOrder.length, `${d}: no duplicate tab`);
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

// ── THE "no right changes" proof: same SET for every door, every viewer ────
for (const v of viewers) {
  const tabSets = ALL_DOORS.map((d) => sorted(visibleTabs(v.features, v.isAdmin, d as Door).map((t) => t.id)));
  for (const s of tabSets) assert.deepEqual(s, tabSets[0], `${v.name}: same tabs for every door`);
  // ...and the same set as the gate gives with no door at all (today's rule).
  const ungated = visibleTabs(v.features, v.isAdmin, null).map((t) => t.id);
  assert.deepEqual(sorted(ungated), tabSets[0]);

  const enabled = canUseOutboundCampaigns(v.isAdmin, v.features);
  for (const withPrompt of [false, true]) {
    for (const saved of [null, [], ["notifs", "voice"], ["campaigns"]]) {
      const tileSets = ALL_DOORS.map((d) => sorted(gridTiles(tiles(withPrompt), saved, d, enabled).tiles.map((t) => t.id)));
      for (const s of tileSets) assert.deepEqual(s, tileSets[0], `${v.name}: same tiles for every door`);
      // The gate is today's: campaigns tile only when outbound is NOT usable (it is the upsell).
      assert.equal(tileSets[0].includes("campaigns"), !enabled, `${v.name}: campaigns tile = upsell iff locked`);
      assert.equal(tileSets[0].length, TILE_IDS.length - (enabled ? 1 : 0) + (withPrompt ? 1 : 0));
    }
  }
}
// Admin mirror: every tab, every door, only the order differs.
for (const d of ALL_DOORS) assert.deepEqual(sorted(adminTenantTabs(d as Door).map((t) => t.id)), sorted(ADMIN_TABS.map((t) => t.id)));

// ── The order per door ──────────────────────────────────────────────────────
const admin = viewers.find((v) => v.name === "admin")!;
const premium = viewers.find((v) => v.name === "tenant/premium")!;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
assert.deepEqual(ids(visibleTabs(admin.features, true, "reception")), ["home", "calls", "crm", "campaigns", "billing"]);
assert.deepEqual(ids(visibleTabs(admin.features, true, "sales")), ["campaigns", "calls", "home", "crm", "billing"]);
assert.deepEqual(ids(visibleTabs(admin.features, true, "connect")), ["home", "calls", "crm", "campaigns", "billing"]);
// A tenant (no plan grants outbound): no campaigns tab, results first for sales.
assert.deepEqual(ids(visibleTabs(premium.features, false, "sales")), ["calls", "home", "crm", "billing"]);
assert.deepEqual(ids(adminTenantTabs("sales")), ["calls", "home", "crm", "calendar", "billing"]);
assert.deepEqual(ids(adminTenantTabs("reception")), ["home", "calls", "crm", "calendar", "billing"]);

const firstTile = (d: Door, enabled: boolean) => gridTiles(tiles(false), null, d, enabled);
assert.equal(firstTile("reception", false).tiles[0].id, "channels");
assert.equal(firstTile("reception", false).highlightId, "channels");
assert.equal(firstTile("connect", false).tiles[0].id, "tools");
assert.equal(firstTile("connect", false).highlightId, "tools");
// Sales on a plan WITHOUT outbound: the locked campaigns tile is first and highlighted (the upsell never disappears).
assert.equal(firstTile("sales", false).tiles[0].id, "campaigns");
assert.equal(firstTile("sales", false).highlightId, "campaigns");
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

// ── Checklist: every step kept, the door's moved to the top ─────────────────
const steps = [
  { id: "contacts", done: false, locked: true },
  { id: "agentUrl", done: false },
  { id: "number", done: false },
  { id: "testCall", done: false },
  { id: "forwarding", done: false },
  { id: "scan", done: true },
  { id: "calendar", done: false },
  { id: "whatsapp", done: false },
];
for (const d of ALL_DOORS) assert.deepEqual(sorted(ids(withFirstStep(steps, d))), sorted(ids(steps)), "no step added or dropped");
// Reception with NO number: the number first (a call can't be tested without
// one), the test call right after it, the rest in its usual order.
assert.deepEqual(ids(withFirstStep(steps, "reception")).slice(0, 3), ["number", "testCall", "contacts"]);
assert.deepEqual(ids(withFirstStep(steps, null)).slice(0, 2), ["number", "testCall"]);
// Reception WITH a number: the test call first.
const withNumber = steps.map((s) => (s.id === "number" ? { ...s, done: true } : s));
assert.deepEqual(ids(withFirstStep(withNumber, "reception")).slice(0, 2), ["testCall", "contacts"]);
assert.deepEqual(sorted(ids(withFirstStep(withNumber, "reception"))), sorted(ids(steps)));
assert.deepEqual(STEP_PREREQUISITES, { testCall: ["number"], forwarding: ["number"] });
assert.equal(withFirstStep(steps, "sales")[0].id, "contacts");
assert.equal(withFirstStep(steps, "connect")[0].id, "agentUrl");
// The door's step absent (e.g. "Ask your agent" not open for the account): order unchanged.
const noAgent = steps.filter((s) => s.id !== "agentUrl");
assert.deepEqual(ids(withFirstStep(noAgent, "connect")), ids(noAgent));
// Sales and connect accounts still get number, forwarding and test call.
for (const d of DOORS) for (const must of ["number", "forwarding", "testCall"]) assert.ok(ids(withFirstStep(steps, d)).includes(must));
// A locked step is listed (upsell) but neither counted nor "next".
const sales = checklistSteps(steps, "sales");
assert.equal(sales.items[0].id, "contacts");
assert.equal(sales.total, steps.length - 1);
assert.equal(sales.done, 1);
assert.equal(nextStep(sales.items)?.id, "agentUrl");
assert.equal(nextStep([{ id: "contacts", done: false, locked: true }]), null);

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
assert.match(select, /<label\s+htmlFor=\{id\}/);
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
assert.match(code("app/[locale]/dashboard/config-form.tsx"), /gridTiles\(TILES, tileOrder, door, campaignsEnabled\)/);
assert.doesNotMatch(code("app/[locale]/dashboard/config-form.tsx"), /applyTileOrder/);

// Every message key the door uses exists in the three locales.
for (const locale of ["fr", "en", "he"]) {
  const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  for (const d of DOORS) assert.equal(typeof m.Dashboard[DOOR_UI[d].headerKey], "string", `${locale}: ${DOOR_UI[d].headerKey}`);
  assert.equal(typeof m.Dashboard.tabConfiguration, "string", "the existing key is kept");
  for (const k of ["doorLabel", "doorHint", "doorOptionReception", "doorOptionSales", "doorOptionConnect", "doorResetNote", "doorSaveError"]) {
    assert.equal(typeof m.DashboardSettings[k], "string", `${locale}: DashboardSettings.${k}`);
  }
  for (const k of ["contactsTitle", "contactsDesc", "contactsCta", "contactsLockedDesc", "contactsLockedCta", "agentUrlTitle", "agentUrlDesc", "agentUrlCta"]) {
    assert.equal(typeof m.DashboardSetup[k], "string", `${locale}: DashboardSetup.${k}`);
  }
  assert.equal(typeof m.DashboardConfig.tileStartHere, "string");
}
const fr = JSON.parse(readFileSync("messages/fr.json", "utf8"));
assert.deepEqual([fr.Dashboard.doorTitleReception, fr.Dashboard.doorTitleSales, fr.Dashboard.doorTitleConnect], ["Réceptionniste", "Ventes", "Votre agent"]);
assert.equal(fr.DashboardSettings.doorLabel, "Mon usage principal");

console.log("doors-ui: OK");
