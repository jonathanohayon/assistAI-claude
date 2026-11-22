// Unit tests for PRODUCT_ORDERS (lib/product-orders-switch.ts): the parser,
// the 3 modes x tenant/admin table, and where the create-payment route
// applies it (before any catalogue / overage computation or DB write).
// The real route, end to end: scripts/tests/hyp-orders-db.test.ts.
// Run with:  npx tsx scripts/tests/product-orders-switch.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { productOrdersAllowed, productOrdersMode } from "../../lib/product-orders-switch";

// 1. Parser: off unless explicitly "admin" or "on".
const parse: Array<[string | undefined, string]> = [
  [undefined, "off"],
  ["", "off"],
  ["off", "off"],
  ["yes", "off"],
  ["true", "off"],
  ["1", "off"],
  ["all", "off"],
  ["admins", "off"],
  ["admin", "admin"],
  [" Admin ", "admin"],
  ["on", "on"],
  [" ON ", "on"],
];
for (const [v, want] of parse) assert.equal(productOrdersMode({ PRODUCT_ORDERS: v }), want, String(v));
assert.equal(productOrdersMode({}), "off");
assert.equal(productOrdersMode({ CLIENT_AGENT: "all", CAMPAIGN_DISPATCH: "on" }), "off", "other flags never turn it on");

// 2. Modes x account.
const table: Array<[ReturnType<typeof productOrdersMode>, boolean, boolean]> = [
  ["off", false, false],
  ["off", true, false],
  ["admin", false, false],
  ["admin", true, true],
  ["on", false, true],
  ["on", true, true],
];
for (const [mode, admin, want] of table) assert.equal(productOrdersAllowed(mode, admin), want, `${mode}/${admin ? "admin" : "tenant"}`);

// 3. The route: the gate is the first thing on the products path, and the
// callback never reads the switch (it activates whatever the mode).
const route = readFileSync(new URL("../../app/api/dashboard/hyp/create-payment/route.ts", import.meta.url), "utf8");
const gate = route.indexOf("productOrdersAllowed(mode, isAdmin)");
const branch = route.indexOf('Object.prototype.hasOwnProperty.call(raw, "products")');
assert.ok(branch > 0 && gate > branch, "the gate is inside the products branch");
for (const after of ['"ambiguous_body"', "createProductsOrder(guard.userId", "getPlanPricingMap()", "db\n      .insert(paymentOrders)"]) {
  const i = route.indexOf(after);
  assert.ok(i > gate, `${after} comes after the gate`);
}
assert.match(route, /\{ error: "product_orders_disabled" \}, \{ status: 400 \}/);
const callback = readFileSync(new URL("../../app/api/dashboard/hyp/callback/route.ts", import.meta.url), "utf8");
const activation = readFileSync(new URL("../../lib/order-activation.ts", import.meta.url), "utf8");
for (const src of [callback, activation]) assert.doesNotMatch(src, /PRODUCT_ORDERS|product-orders-switch|productOrders(Mode|Allowed)/);

console.log("product-orders-switch: all passed");
