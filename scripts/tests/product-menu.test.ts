// The product menu (lib/product-menu.ts): for each account, each product
// entry is OWNED or a PREVIEW with its call to action. tamaraVP's table test:
// plan × status × gates, written out cell by cell below (84 rows), plus the
// admin rule, the server gates (lib/product-gates.ts) and client safety.
// Mock data only.
// Run with:  npx tsx scripts/tests/product-menu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { entitledProducts, type EntitlementInput } from "../../lib/product-entitlement";
import { productMenu, shownAsOwned, type ProductGates } from "../../lib/product-menu";
import { PRODUCT_ENTRIES } from "../../lib/product-values";
import { menuFor, productGates } from "../../lib/product-gates";

// The server does accountProducts(userId) = entitledProducts(the row): the
// same pure call here, from mock rows.
const menuOf = (row: EntitlementInput, gates: ProductGates, isAdmin: boolean) =>
  productMenu({ entitlement: entitledProducts(row), gates, isAdmin });
import { DEFAULT_MATRIX, featuresForPlan } from "../../lib/plan-features";

// "plan | status | gates => R:<state> S:<state> C:<state>"
//   plan:   a subscription plan ("null" = none), or "record:<base>+<addon>" =
//           a VALID users.products record (plan premium underneath);
//   gates:  "S" = the sales gate on, "C" = the connect gate on, "-" = off;
//   R/S/C:  reception / sales / connect: owned, soon ("Bientôt, prévenez-moi")
//           or try ("Essayer gratuitement").
const TABLE = [
  "global | active | -- => R:owned S:soon C:soon",
  "global | active | S- => R:owned S:try C:soon",
  "global | active | -C => R:owned S:soon C:try",
  "global | active | SC => R:owned S:try C:try",
  "global | trialing | -- => R:owned S:soon C:soon",
  "global | trialing | S- => R:owned S:try C:soon",
  "global | trialing | -C => R:owned S:soon C:try",
  "global | trialing | SC => R:owned S:try C:try",
  "global | trial_paused | -- => R:owned S:soon C:soon",
  "global | trial_paused | S- => R:owned S:try C:soon",
  "global | trial_paused | -C => R:owned S:soon C:try",
  "global | trial_paused | SC => R:owned S:try C:try",
  "whatsapp | active | -- => R:owned S:soon C:soon",
  "whatsapp | active | S- => R:owned S:try C:soon",
  "whatsapp | active | -C => R:owned S:soon C:try",
  "whatsapp | active | SC => R:owned S:try C:try",
  "whatsapp | trialing | -- => R:owned S:soon C:soon",
  "whatsapp | trialing | S- => R:owned S:try C:soon",
  "whatsapp | trialing | -C => R:owned S:soon C:try",
  "whatsapp | trialing | SC => R:owned S:try C:try",
  "whatsapp | trial_paused | -- => R:owned S:soon C:soon",
  "whatsapp | trial_paused | S- => R:owned S:try C:soon",
  "whatsapp | trial_paused | -C => R:owned S:soon C:try",
  "whatsapp | trial_paused | SC => R:owned S:try C:try",
  "premium | active | -- => R:owned S:soon C:soon",
  "premium | active | S- => R:owned S:owned C:soon",
  "premium | active | -C => R:owned S:soon C:try",
  "premium | active | SC => R:owned S:owned C:try",
  "premium | trialing | -- => R:owned S:soon C:soon",
  "premium | trialing | S- => R:owned S:try C:soon",
  "premium | trialing | -C => R:owned S:soon C:try",
  "premium | trialing | SC => R:owned S:try C:try",
  "premium | trial_paused | -- => R:owned S:soon C:soon",
  "premium | trial_paused | S- => R:owned S:try C:soon",
  "premium | trial_paused | -C => R:owned S:soon C:try",
  "premium | trial_paused | SC => R:owned S:try C:try",
  "essential | active | -- => R:owned S:soon C:soon",
  "essential | active | S- => R:owned S:owned C:soon",
  "essential | active | -C => R:owned S:soon C:try",
  "essential | active | SC => R:owned S:owned C:try",
  "essential | trialing | -- => R:owned S:soon C:soon",
  "essential | trialing | S- => R:owned S:try C:soon",
  "essential | trialing | -C => R:owned S:soon C:try",
  "essential | trialing | SC => R:owned S:try C:try",
  "essential | trial_paused | -- => R:owned S:soon C:soon",
  "essential | trial_paused | S- => R:owned S:try C:soon",
  "essential | trial_paused | -C => R:owned S:soon C:try",
  "essential | trial_paused | SC => R:owned S:try C:try",
  "null | active | -- => R:owned S:soon C:soon",
  "null | active | S- => R:owned S:owned C:soon",
  "null | active | -C => R:owned S:soon C:try",
  "null | active | SC => R:owned S:owned C:try",
  "null | trialing | -- => R:owned S:soon C:soon",
  "null | trialing | S- => R:owned S:try C:soon",
  "null | trialing | -C => R:owned S:soon C:try",
  "null | trialing | SC => R:owned S:try C:try",
  "null | trial_paused | -- => R:owned S:soon C:soon",
  "null | trial_paused | S- => R:owned S:try C:soon",
  "null | trial_paused | -C => R:owned S:soon C:try",
  "null | trial_paused | SC => R:owned S:try C:try",
  "record:connect+sales | active | -- => R:try S:soon C:soon",
  "record:connect+sales | active | S- => R:try S:owned C:soon",
  "record:connect+sales | active | -C => R:try S:soon C:owned",
  "record:connect+sales | active | SC => R:try S:owned C:owned",
  "record:connect+sales | trialing | -- => R:try S:soon C:soon",
  "record:connect+sales | trialing | S- => R:try S:owned C:soon",
  "record:connect+sales | trialing | -C => R:try S:soon C:owned",
  "record:connect+sales | trialing | SC => R:try S:owned C:owned",
  "record:connect+sales | trial_paused | -- => R:try S:soon C:soon",
  "record:connect+sales | trial_paused | S- => R:try S:owned C:soon",
  "record:connect+sales | trial_paused | -C => R:try S:soon C:owned",
  "record:connect+sales | trial_paused | SC => R:try S:owned C:owned",
  "record:reception_multi+connect | active | -- => R:owned S:soon C:soon",
  "record:reception_multi+connect | active | S- => R:owned S:try C:soon",
  "record:reception_multi+connect | active | -C => R:owned S:soon C:owned",
  "record:reception_multi+connect | active | SC => R:owned S:try C:owned",
  "record:reception_multi+connect | trialing | -- => R:owned S:soon C:soon",
  "record:reception_multi+connect | trialing | S- => R:owned S:try C:soon",
  "record:reception_multi+connect | trialing | -C => R:owned S:soon C:owned",
  "record:reception_multi+connect | trialing | SC => R:owned S:try C:owned",
  "record:reception_multi+connect | trial_paused | -- => R:owned S:soon C:soon",
  "record:reception_multi+connect | trial_paused | S- => R:owned S:try C:soon",
  "record:reception_multi+connect | trial_paused | -C => R:owned S:soon C:owned",
  "record:reception_multi+connect | trial_paused | SC => R:owned S:try C:owned",
];

const RECORDS: Record<string, unknown> = {
  "record:connect+sales": { base: "connect", addons: ["sales"] },
  "record:reception_multi+connect": { base: "reception_multi", addons: ["connect"] },
};

const short = (s: { state: "owned" } | { state: "preview"; cta: string }) => (s.state === "owned" ? "owned" : s.cta);
const render = (m: ReturnType<typeof productMenu>) => `R:${short(m.reception)} S:${short(m.sales)} C:${short(m.connect)}`;

const plans = new Set<string>();
const statuses = new Set<string>();
for (const row of TABLE) {
  const [lhs, expected] = row.split(" => ");
  const [plan, status, g] = lhs.split(" | ");
  plans.add(plan);
  statuses.add(status);
  const gates: ProductGates = { sales: g[0] === "S", connect: g[1] === "C" };
  const record = RECORDS[plan];
  const input: EntitlementInput = {
    subscriptionPlan: record ? "premium" : plan === "null" ? null : plan,
    subscriptionStatus: status,
    products: record ?? null,
  };
  assert.equal(render(menuOf(input, gates, false)), expected, row);
  // Admins (their own dashboard): everything owned, whatever the rest.
  assert.equal(render(menuOf(input, gates, true)), "R:owned S:owned C:owned", `admin: ${row}`);
}
// The table covers every plan, status and gate combination asked for.
assert.deepEqual([...plans].sort(), ["essential", "global", "null", "premium", "record:connect+sales", "record:reception_multi+connect", "whatsapp"]);
assert.deepEqual([...statuses].sort(), ["active", "trial_paused", "trialing"]);
assert.equal(TABLE.length, plans.size * statuses.size * 4);

// An existing premium account: entitled to sales → "Bientôt" until the gate
// opens, then owned at no charge (no record needed).
{
  const premium = (sales: boolean) =>
    menuOf({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null }, { sales, connect: false }, false).sales;
  assert.deepEqual(premium(false), { state: "preview", cta: "soon" });
  assert.deepEqual(premium(true), { state: "owned" });
}
// An invalid record is ignored (grandfathered rules), never trusted.
assert.equal(
  render(menuOf({ subscriptionPlan: "global", subscriptionStatus: "active", products: { base: "connect" } }, { sales: true, connect: true }, false)),
  "R:owned S:try C:try",
);

// ── The server gates (env read on the server only) ─────────────────────────
{
  const tenant = featuresForPlan(DEFAULT_MATRIX, "premium");
  // sales: CAMPAIGN_DISPATCH must be "on" AND the account may use outbound (admin, or the plan feature).
  assert.equal(productGates(false, tenant, {}).sales, false, "dispatch unset → off");
  assert.equal(productGates(true, tenant, { CAMPAIGN_DISPATCH: "dry" }).sales, false, "dry is not on");
  assert.equal(productGates(true, tenant, { CAMPAIGN_DISPATCH: "on" }).sales, true, "admin + on");
  assert.equal(productGates(false, tenant, { CAMPAIGN_DISPATCH: "on" }).sales, false, "tenant: no plan grants outbound since the 2026-11 grid");
  assert.equal(productGates(false, { ...tenant, outbound_campaigns: true }, { CAMPAIGN_DISPATCH: " ON " }).sales, true, "plan feature + on");
  // connect: CLIENT_AGENT "all" (everyone) or "admin" (admins only).
  assert.equal(productGates(false, tenant, {}).connect, false);
  assert.equal(productGates(false, tenant, { CLIENT_AGENT: "admin" }).connect, false);
  assert.equal(productGates(true, tenant, { CLIENT_AGENT: "admin" }).connect, true);
  assert.equal(productGates(false, tenant, { CLIENT_AGENT: "all" }).connect, true);
  // menuFor: the loaded entitlement + the account's OWN role and features.
  const premium = entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null });
  assert.equal(render(menuFor(premium, "user", tenant, { CLIENT_AGENT: "all" })), "R:owned S:soon C:try");
  assert.equal(render(menuFor(premium, "admin", tenant, {})), "R:owned S:owned C:owned");
  assert.equal(render(menuFor({ entries: [] }, null, null, {})), "R:try S:soon C:soon", "unknown account (accountProducts: nothing entitled)");
  // The layouts load the entitlement with accountProducts(userId) (users.products
  // included) for the signed-in user, and for the TARGET in the admin view.
  // ONE accountProducts read gives the menu and the trials (the sidebar badge).
  assert.match(
    readFileSync("lib/product-gates.ts", "utf8"),
    /const products = await accountProducts\(userId\);\s*return \{ menu: menuFor\(products, role, features\), trials: products\.trials \};/,
  );
  assert.match(readFileSync("lib/product-gates.ts", "utf8"), /return \(await accountProductNav\(userId, role, features\)\)\.menu;/);
  assert.match(readFileSync("app/[locale]/dashboard/layout.tsx", "utf8"), /const nav = await accountProductNav\(session\.user\.id, me\?\.role, features\);\s*const menuBlocks = navBlocks\(resolveDoor\(me\?\.door \?\? null\), nav\.menu, null, nav\.trials\);/);
  assert.match(readFileSync("app/admin/users/[userId]/layout.tsx", "utf8"), /const nav = await accountProductNav\(target\.id, target\.role, [^\n]*\);\s*const menuBlocks = navBlocks\(door, nav\.menu, target\.id, nav\.trials\);/);
}

// ── "Prévenez-moi" refuses only what the menu shows as owned ──────────────
{
  // Every entry × (entitled, gate) for a non-admin account: refused (409)
  // exactly when entitled AND the gate is on. Reception has no gate (always on).
  for (const entry of PRODUCT_ENTRIES) {
    for (const entitled of [false, true]) {
      for (const gate of [false, true]) {
        if (entry === "reception" && !gate) continue;
        const gates: ProductGates = { sales: false, connect: false };
        if (entry !== "reception") gates[entry] = gate;
        const menu = productMenu({ entitlement: { entries: entitled ? [entry] : [] }, gates, isAdmin: false });
        assert.equal(shownAsOwned(menu, entry), entitled && gate, `notify refuses ${entry} entitled=${entitled} gate=${gate}`);
        assert.equal(shownAsOwned(menu, entry), menu[entry].state === "owned", `${entry}: the route and the menu agree`);
      }
    }
  }
  // The same through menuFor (the env-driven gates the route uses), every env.
  const tenant = featuresForPlan(DEFAULT_MATRIX, "premium");
  const envs = [{}, { CAMPAIGN_DISPATCH: "on" }, { CLIENT_AGENT: "admin" }, { CLIENT_AGENT: "all" }, { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }];
  const subsets: Array<(typeof PRODUCT_ENTRIES)[number][]> = [];
  for (let m = 0; m < 1 << PRODUCT_ENTRIES.length; m++) subsets.push(PRODUCT_ENTRIES.filter((_, j) => (m >> j) & 1));
  for (const env of envs) {
    for (const role of ["user", "admin"]) {
      for (const entries of subsets) {
        const menu = menuFor({ entries }, role, tenant, env);
        const gates = productGates(role === "admin", tenant, env);
        for (const entry of PRODUCT_ENTRIES) {
          const gate = entry === "reception" ? true : gates[entry];
          const want = role === "admin" || (entries.includes(entry) && gate);
          assert.equal(shownAsOwned(menu, entry), want, `menuFor ${role} ${JSON.stringify(env)} ${entries.join("+") || "none"} → ${entry}`);
        }
      }
    }
  }
  // The regression: a grandfathered premium is entitled to sales with dispatch
  // off → "soon", so notify-me is accepted (it used to answer 409).
  const premium = entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null });
  assert.ok(premium.entries.includes("sales"));
  assert.equal(shownAsOwned(menuFor(premium, "user", tenant, {}), "sales"), false);
  // The route decides with the layouts' menu, not the bare entitlement.
  const route = readFileSync("app/api/dashboard/products/notify/route.ts", "utf8");
  assert.match(route, /shownAsOwned\(await menuForAccount\(r\.userId, owned\), product\)/);
  assert.doesNotMatch(route, /entries\.includes/);
  assert.match(readFileSync("lib/product-gates.ts", "utf8"), /return menuFor\(entitlement, u\?\.role, features, env\);/);
}

// ── Client safety: the menu modules read no env and pull no server module ──
{
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const menu = code("lib/product-menu.ts");
  assert.deepEqual([...menu.matchAll(/from "([^"]+)"/g)].map((m) => m[1]), ["./product-entitlement", "./product-values"]);
  assert.match(menu, /import type \{ Entitlement \} from "\.\/product-entitlement";/, "types only from the entitlement");
  for (const f of ["lib/product-menu.ts", "lib/dashboard-nav.ts", "components/dashboard/DashboardSidebar.tsx"]) {
    const src = code(f);
    assert.doesNotMatch(src, /process\.env|CAMPAIGN_DISPATCH|CLIENT_AGENT/, `${f}: no env`);
    assert.doesNotMatch(src, /product-gates|dispatch-mode|client-agent-switch|@\/lib\/db|@\/lib\/door"|plan-features"/, `${f}: no server module`);
  }
  assert.match(code("lib/product-gates.ts"), /dispatchMode\(env\) === "on"/);
}

console.log("product-menu: OK");
