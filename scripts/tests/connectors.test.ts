// Connectors B1, the pure parts: the limits parser (hard ceiling 10), the
// catalogue row additive key + the admin write gate cases (omitted =
// unchanged), the entitlement table (trial 1, paid 5, clamp, orders_closed),
// the legacy card derivation, the row view (no secret), the page assembly,
// the number-exclusivity rule, and source guards (client-safe types, no
// secret selected, no call path reads connectors yet). C1b: the
// extra-connector price key (parser, absent = identical bytes, admin gate
// cases), canAdd.price per case, the deletable rule. Mock data only.
// Run with:  npx tsx scripts/tests/connectors.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { canAddConnector, maxConnectors } from "../../lib/connectors/entitlement";
import { connectorRowView, legacyConnectorView } from "../../lib/connectors/legacy";
import {
  DEFAULT_CONNECTOR_LIMITS,
  HARD_MAX_CONNECTORS,
  parseConnectorLimits,
} from "../../lib/connectors/limits";
import { connectProductActive, connectorDeletable, withDeletable } from "../../lib/connectors/deletable";
import {
  DEFAULT_CONNECTOR_EXTRA_MONTHLY,
  connectorExtraMonthlyWrite,
  nextConnectorPrice,
  parseConnectorExtraMonthly,
} from "../../lib/connectors/price";
import { numberConflict } from "../../lib/connectors/number-exclusivity";
import { connectorsPageView } from "../../lib/connectors/page";
import { defaultProductCatalogue } from "../../lib/product-catalogue";
import { catalogueRowWrite, parseCatalogueRow, serializeCatalogueRow, type CatalogueRow } from "../../lib/product-catalogue-row";
import { noEngineOverrides } from "../../lib/engine-override";
import { catalogueFromStored } from "../../lib/products";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ── Limits: defaults, strict parser, hard ceiling ───────────────────────
assert.equal(HARD_MAX_CONNECTORS, 10);
assert.deepEqual({ ...DEFAULT_CONNECTOR_LIMITS }, { trial: 1, paid: 5 });
assert.deepEqual(parseConnectorLimits({ trial: 1, paid: 5 }), { trial: 1, paid: 5 });
assert.deepEqual(parseConnectorLimits({ trial: 0, paid: 10 }), { trial: 0, paid: 10 });
for (const bad of [
  { trial: 1, paid: 11 },
  { trial: 11, paid: 5 },
  { trial: 1, paid: 5.5 },
  { trial: -1, paid: 5 },
  { trial: 1 },
  { trial: 1, paid: 5, extra: 2 },
  { trial: "1", paid: 5 },
  null,
  [],
  5,
]) assert.equal(parseConnectorLimits(bad), null, `refused: ${JSON.stringify(bad)}`);
console.log("ok: connector limits parser (defaults 1/5, > 10 refused)");

// ── Catalogue row: additive key, pre-B1 bytes unchanged ─────────────────
const cat = defaultProductCatalogue();
const none = noEngineOverrides();
assert.equal(serializeCatalogueRow(cat, none), JSON.stringify(cat), "no limits → the pre-B1 bytes");
assert.equal(serializeCatalogueRow(cat, none, undefined), JSON.stringify(cat));
const withLimits = serializeCatalogueRow(cat, none, { trial: 1, paid: 7 });
assert.deepEqual(parseCatalogueRow(JSON.parse(withLimits))?.connectorLimits, { trial: 1, paid: 7 }, "round trip");
assert.equal(parseCatalogueRow(JSON.parse(JSON.stringify(cat)))?.connectorLimits, undefined, "absent → not stored");
assert.equal(parseCatalogueRow({ ...cat, connectorLimits: { trial: 1, paid: 11 } }), null, "a stored 11 fails the whole row");
assert.equal(catalogueFromStored(JSON.stringify({ ...cat, connectorLimits: { trial: 1, paid: 11 } })).source, "invalid");
assert.deepEqual(catalogueFromStored(withLimits).connectorLimits, { trial: 1, paid: 7 });
assert.equal(catalogueFromStored(null).connectorLimits, undefined, "no row → defaults apply (nothing stored)");
console.log("ok: catalogue row carries connectorLimits additively; absent = pre-B1 bytes");

// ── Admin write: the four gate cases + refusals ─────────────────────────
const storedNone: CatalogueRow = { catalogue: cat, engineOverrides: none };
const storedSet: CatalogueRow = { catalogue: cat, engineOverrides: none, connectorLimits: { trial: 2, paid: 6 } };
// 1. omitted → unchanged (both when stored and when not stored)
for (const stored of [storedNone, storedSet]) {
  for (const body of [{}, { catalogue: {} }, { catalogue: { connect: { EUR: { monthly: 49 } } } }]) {
    const w = catalogueRowWrite(stored, body);
    assert.ok(w.ok);
    assert.deepEqual(w.connectorLimits, stored.connectorLimits, "omitted keeps the stored limits");
    assert.equal(w.changed, false);
  }
}
// 2. a valid value is written
const w2 = catalogueRowWrite(storedNone, { connectorLimits: { trial: 1, paid: 8 } });
assert.ok(w2.ok && w2.changed);
assert.deepEqual(w2.connectorLimits, { trial: 1, paid: 8 });
// 3. a partial patch keeps the omitted field
const w3 = catalogueRowWrite(storedSet, { connectorLimits: { paid: 9 } });
assert.ok(w3.ok);
assert.deepEqual(w3.connectorLimits, { trial: 2, paid: 9 });
const w3b = catalogueRowWrite(storedNone, { connectorLimits: { trial: 0 } });
assert.ok(w3b.ok);
assert.deepEqual(w3b.connectorLimits, { trial: 0, paid: 5 }, "omitted paid = the default");
// 4. refused, nothing written, every path named (> 10 refused, never clamped)
for (const [body, fields] of [
  [{ connectorLimits: { paid: 11 } }, ["connectorLimits.paid"]],
  [{ connectorLimits: { trial: 1.5, paid: 99 } }, ["connectorLimits.trial", "connectorLimits.paid"]],
  [{ connectorLimits: { extra: 1 } }, ["connectorLimits.extra"]],
  [{ connectorLimits: null }, ["connectorLimits"]],
  [{ connectorLimits: { paid: 11 }, catalogue: { connect: { EUR: { monthly: -1 } } } }, ["catalogue.connect.EUR.monthly", "connectorLimits.paid"]],
] as const) {
  const w = catalogueRowWrite(storedSet, body);
  assert.equal(w.ok, false, JSON.stringify(body));
  if (!w.ok) assert.deepEqual([...w.fields].sort(), [...fields].sort(), JSON.stringify(body));
}
// The price write is unchanged when limits ride along.
const w5 = catalogueRowWrite(storedSet, { catalogue: { connect: { EUR: { monthly: 59 } } }, connectorLimits: { paid: 4 } });
assert.ok(w5.ok);
assert.equal(w5.value.connect.EUR.monthly, 59);
assert.deepEqual(w5.connectorLimits, { trial: 2, paid: 4 });
// The admin route passes the limits to storage and returns them.
const routeSrc = src("app/api/admin/product-catalogue/route.ts");
assert.match(routeSrc, /setProductCatalogue\(w\.value, w\.engineOverrides, w\.connectorLimits, w\.connectorExtraMonthly\)/);
assert.match(routeSrc, /\.\.\.\(row\.connectorLimits \? \{ connectorLimits: row\.connectorLimits \} : \{\}\)/, "GET: only when stored");
assert.match(routeSrc, /\.\.\.\(w\.connectorLimits \? \{ connectorLimits: w\.connectorLimits \} : \{\}\)/, "PUT: only when stored");
console.log("ok: admin catalogue write — omitted unchanged, valid written, partial, refused (> 10)");

// ── Entitlement table ───────────────────────────────────────────────────
const TRIAL = { subscriptionStatus: "trialing", role: "user" };
const PAUSED = { subscriptionStatus: "trial_paused", role: "user" };
const PAID = { subscriptionStatus: "active", role: "user" };
const ADMIN = { subscriptionStatus: "trialing", role: "admin" };
const L = { trial: 1, paid: 5 };
const ON = { PRODUCT_ORDERS: "on" };
const OFF = {};
assert.equal(maxConnectors(TRIAL, L), 1);
assert.equal(maxConnectors(PAUSED, L), 1);
assert.equal(maxConnectors(PAID, L), 5);
assert.equal(maxConnectors(ADMIN, L), 5, "an admin is never in the trial gate");
assert.equal(maxConnectors(PAID, { trial: 1, paid: 50 }), 10, "clamped to the hard ceiling");
assert.equal(maxConnectors(TRIAL, { trial: 40, paid: 5 }), 10);
const table: Array<[string, typeof PAID, number, Record<string, string>, { ok: boolean; reason?: string }]> = [
  ["trial, none", TRIAL, 0, OFF, { ok: true }],
  ["trial, one", TRIAL, 1, ON, { ok: false, reason: "trial_limit" }],
  ["paused, one", PAUSED, 1, ON, { ok: false, reason: "trial_limit" }],
  ["paid, none, orders off (the included one)", PAID, 0, OFF, { ok: true }],
  ["paid, one, orders off", PAID, 1, OFF, { ok: false, reason: "orders_closed" }],
  ["paid, one, orders admin (tenant)", PAID, 1, { PRODUCT_ORDERS: "admin" }, { ok: false, reason: "orders_closed" }],
  ["paid, one, orders on", PAID, 1, ON, { ok: true }],
  ["paid, four, orders on", PAID, 4, ON, { ok: true }],
  ["paid, five, orders on", PAID, 5, ON, { ok: false, reason: "max_reached" }],
  ["paid, five, orders off", PAID, 5, OFF, { ok: false, reason: "max_reached" }],
  ["admin, one, orders admin", ADMIN, 1, { PRODUCT_ORDERS: "admin" }, { ok: true }],
];
for (const [label, acc, n, env, want] of table) assert.deepEqual(canAddConnector(acc, n, L, env), want, label);
assert.deepEqual(canAddConnector(PAID, 10, { trial: 1, paid: 99 }, ON), { ok: false, reason: "max_reached" }, "never an 11th");
console.log(`ok: entitlement table (${table.length} rows + clamps)`);

// ── Legacy derivation ───────────────────────────────────────────────────
const tools = (clientAgent: unknown) => ({
  version: 1,
  booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
  contacts: { enabled: true },
  transfer: { enabled: false, when: "always" },
  orders: { enabled: false, ask: "" },
  clientAgent,
});
const MAIN = { phoneNumber: "+15550000101", label: "Main line" };
const on = tools({ enabled: true, url: "https://agent.example.com/hook", mode: "voice", secret: "mock-secret-value" });
const legacy = legacyConnectorView({ connectorRowCount: 0, toolsConfig: on, mainNumber: MAIN });
assert.deepEqual(legacy, {
  id: "legacy",
  name: "",
  numberE164: "+15550000101",
  numberLabel: "Main line",
  mode: "voice",
  enabled: true,
  derived: true,
  state: "online",
  lastCallAt: null,
  lastTestAt: null,
  lastTestOk: null,
  secretSet: true,
}, "zero rows + enabled legacy → one derived card on the main number");
assert.ok(!JSON.stringify(legacy).includes("mock-secret-value"), "no secret in the card");
assert.equal(legacyConnectorView({ connectorRowCount: 0, toolsConfig: on, mainNumber: null })?.numberE164, null, "no number yet");
assert.equal(legacyConnectorView({ connectorRowCount: 1, toolsConfig: on, mainNumber: MAIN }), null, ">= 1 row → no derived card");
for (const [label, cfg] of [
  ["off", tools({ enabled: false, url: "https://agent.example.com/hook", mode: "lead", secret: null })],
  ["enabled without a url", tools({ enabled: true, url: "  ", mode: "lead", secret: null })],
  ["never written (NULL)", null],
  ["stored before T5 (no clientAgent)", { ...tools(undefined), clientAgent: undefined }],
  ["invalid", { nope: true }],
] as const) assert.equal(legacyConnectorView({ connectorRowCount: 0, toolsConfig: cfg, mainNumber: MAIN }), null, `zero rows + ${label} → none`);
console.log("ok: legacy derivation (one card / none / none with rows)");

// ── Row view + page assembly ────────────────────────────────────────────
const row = {
  id: "00000000-0000-4000-8000-000000000c01",
  name: "Sales bot",
  mode: "lead",
  enabled: false,
  secretSet: false,
  lastTestAt: new Date("2026-11-20T10:00:00Z"),
  lastTestOk: true,
  phoneNumber: "+15550000102",
  phoneLabel: "",
};
const rv = connectorRowView(row, new Date("2026-11-21T10:00:00Z"));
assert.deepEqual(rv, {
  id: row.id,
  name: "Sales bot",
  numberE164: "+15550000102",
  mode: "lead",
  enabled: false,
  derived: false,
  state: "off",
  lastCallAt: "2026-11-21T10:00:00.000Z",
  lastTestAt: "2026-11-20T10:00:00.000Z",
  lastTestOk: true,
  secretSet: false,
});
assert.equal(connectorRowView({ ...row, enabled: true }, null).state, "online");
const pTrial = connectorsPageView({ connectors: [legacy!], account: TRIAL, limits: L, productActive: true, currency: "EUR", env: ON });
assert.deepEqual(pTrial.limits, { max: 1, used: 1, inTrial: true }, "the derived card counts as used");
assert.deepEqual(pTrial.canAdd, { ok: false, reason: "trial_limit", price: null });
assert.equal(pTrial.connectors[0].deletable, false, "the derived card is never deletable");
const pEmpty = connectorsPageView({ connectors: [], account: PAID, limits: L, productActive: true, currency: "EUR", env: OFF });
assert.deepEqual(pEmpty, { connectors: [], limits: { max: 5, used: 0, inTrial: false }, canAdd: { ok: true, price: null }, legacyConversion: { willConvert: false, numberE164: null } });
console.log("ok: row view + page assembly");

// ── C1b: extra-connector price (parser, row bytes, admin gate cases) ────
assert.deepEqual({ ...DEFAULT_CONNECTOR_EXTRA_MONTHLY }, { EUR: 19, ILS: 79 });
assert.notEqual(cat.connect.EUR.addonMonthly, 19, "not the connect add-on price (a different thing)");
assert.deepEqual(parseConnectorExtraMonthly({ EUR: 19, ILS: 79 }), { EUR: 19, ILS: 79 });
assert.deepEqual(parseConnectorExtraMonthly({ ILS: 0, EUR: 24.5 }), { EUR: 24.5, ILS: 0 });
for (const bad of [
  { EUR: 19 },
  { EUR: 19, ILS: 79, USD: 20 },
  { EUR: -1, ILS: 79 },
  { EUR: "19", ILS: 79 },
  { EUR: 19, ILS: null },
  { EUR: 19, ILS: Number.POSITIVE_INFINITY },
  null,
  [],
  19,
]) assert.equal(parseConnectorExtraMonthly(bad), null, `price refused: ${String(JSON.stringify(bad))}`);
// Row bytes: absent → identical bytes; present → round trip; malformed → whole row invalid.
assert.equal(serializeCatalogueRow(cat, none, undefined, undefined), JSON.stringify(cat), "no price → the pre-C1b bytes");
assert.equal(serializeCatalogueRow(cat, none, { trial: 1, paid: 7 }, undefined), withLimits, "limits only → the B1 bytes");
const withPrice = serializeCatalogueRow(cat, none, undefined, { EUR: 21, ILS: 85 });
assert.deepEqual(parseCatalogueRow(JSON.parse(withPrice))?.connectorExtraMonthly, { EUR: 21, ILS: 85 }, "price round trip");
assert.equal(parseCatalogueRow(JSON.parse(withPrice))?.connectorLimits, undefined, "price only → limits still not stored");
assert.equal(parseCatalogueRow(JSON.parse(JSON.stringify(cat)))?.connectorExtraMonthly, undefined, "absent → not stored");
assert.ok(!("connectorExtraMonthly" in parseCatalogueRow(JSON.parse(withLimits))!), "a B1 row parses without the key");
assert.equal(parseCatalogueRow({ ...cat, connectorExtraMonthly: { EUR: 19 } }), null, "a malformed stored price fails the whole row");
assert.equal(catalogueFromStored(JSON.stringify({ ...cat, connectorExtraMonthly: { EUR: -1, ILS: 79 } })).source, "invalid");
assert.deepEqual(catalogueFromStored(withPrice).connectorExtraMonthly, { EUR: 21, ILS: 85 });
// connectorExtraMonthlyWrite: partial, unknown key, bad value.
assert.deepEqual(connectorExtraMonthlyWrite({ EUR: 19, ILS: 79 }, { ILS: 99 }), { ok: true, value: { EUR: 19, ILS: 99 } });
assert.deepEqual(connectorExtraMonthlyWrite({ EUR: 19, ILS: 79 }, {}), { ok: true, value: { EUR: 19, ILS: 79 } });
// Admin write gate cases: 1. omitted → unchanged (stored and not stored).
const storedPrice: CatalogueRow = { catalogue: cat, engineOverrides: none, connectorLimits: { trial: 2, paid: 6 }, connectorExtraMonthly: { EUR: 25, ILS: 99 } };
for (const stored of [storedNone, storedSet, storedPrice]) {
  for (const body of [{}, { catalogue: { connect: { EUR: { monthly: 49 } } } }, { connectorLimits: { paid: 6 } }]) {
    const w = catalogueRowWrite(stored, body);
    assert.ok(w.ok, JSON.stringify(body));
    assert.deepEqual(w.connectorExtraMonthly, stored.connectorExtraMonthly, "omitted keeps the stored price");
    if (!stored.connectorExtraMonthly) assert.ok(!("connectorExtraMonthly" in w), "still not stored");
  }
}
// 2. a valid value is written.
const wp2 = catalogueRowWrite(storedNone, { connectorExtraMonthly: { EUR: 19, ILS: 79 } });
assert.ok(wp2.ok && wp2.changed, "writing the defaults explicitly stores them");
assert.deepEqual(wp2.connectorExtraMonthly, { EUR: 19, ILS: 79 });
assert.equal(wp2.connectorLimits, undefined, "the limits stay unstored");
// 3. a partial patch keeps the omitted currency (from the defaults when not stored).
const wp3 = catalogueRowWrite(storedNone, { connectorExtraMonthly: { ILS: 89 } });
assert.ok(wp3.ok);
assert.deepEqual(wp3.connectorExtraMonthly, { EUR: 19, ILS: 89 });
const wp3b = catalogueRowWrite(storedPrice, { connectorExtraMonthly: { EUR: 29 }, connectorLimits: { paid: 8 } });
assert.ok(wp3b.ok);
assert.deepEqual([wp3b.connectorExtraMonthly, wp3b.connectorLimits], [{ EUR: 29, ILS: 99 }, { trial: 2, paid: 8 }]);
// 4. refused, nothing written, every path named.
for (const [body, fields] of [
  [{ connectorExtraMonthly: { EUR: -1 } }, ["connectorExtraMonthly.EUR"]],
  [{ connectorExtraMonthly: { EUR: "19", USD: 20 } }, ["connectorExtraMonthly.EUR", "connectorExtraMonthly.USD"]],
  [{ connectorExtraMonthly: null }, ["connectorExtraMonthly"]],
  [{ connectorExtraMonthly: { ILS: -5 }, connectorLimits: { paid: 11 } }, ["connectorExtraMonthly.ILS", "connectorLimits.paid"]],
  [{ connectorExtraMonthly: { ILS: -5 }, catalogue: { connect: { EUR: { monthly: -1 } } } }, ["catalogue.connect.EUR.monthly", "connectorExtraMonthly.ILS"]],
] as const) {
  const w = catalogueRowWrite(storedPrice, body);
  assert.equal(w.ok, false, JSON.stringify(body));
  if (!w.ok) assert.deepEqual([...w.fields].sort(), [...fields].sort(), JSON.stringify(body));
}
assert.match(routeSrc, /\.\.\.\(row\.connectorExtraMonthly \? \{ connectorExtraMonthly: row\.connectorExtraMonthly \} : \{\}\)/, "GET: price only when stored");
assert.match(routeSrc, /\.\.\.\(w\.connectorExtraMonthly \? \{ connectorExtraMonthly: w\.connectorExtraMonthly \} : \{\}\)/, "PUT: price only when stored");
console.log("ok: extra-connector price — parser, absent = identical bytes, admin gate cases");

// ── C1b: canAdd.price per case ──────────────────────────────────────────
const P = { EUR: 19, ILS: 79 };
assert.equal(nextConnectorPrice({ inTrial: true, used: 0, currency: "EUR", prices: P }), null, "trial, none");
assert.equal(nextConnectorPrice({ inTrial: true, used: 1, currency: "ILS", prices: P }), null, "trial, one");
assert.equal(nextConnectorPrice({ inTrial: false, used: 0, currency: "EUR", prices: P }), null, "paid, none → included");
assert.deepEqual(nextConnectorPrice({ inTrial: false, used: 1, currency: "EUR", prices: P }), { monthly: 19, currency: "EUR" });
assert.deepEqual(nextConnectorPrice({ inTrial: false, used: 3, currency: "ILS", prices: P }), { monthly: 79, currency: "ILS" });
const rowCard = connectorRowView(row, null);
const page = (account: typeof PAID, cards: typeof rowCard[], currency: "EUR" | "ILS", env: Record<string, string> = ON, prices?: typeof P) =>
  connectorsPageView({ connectors: cards, account, limits: L, productActive: true, currency, prices, env }).canAdd;
assert.deepEqual(page(TRIAL, [], "EUR"), { ok: true, price: null }, "trial → null");
assert.deepEqual(page(PAID, [], "EUR"), { ok: true, price: null }, "paid with 0 → null (included)");
assert.deepEqual(page(PAID, [rowCard], "EUR"), { ok: true, price: { monthly: 19, currency: "EUR" } }, "paid with 1 → 19 EUR");
assert.deepEqual(page(PAID, [rowCard], "ILS"), { ok: true, price: { monthly: 79, currency: "ILS" } }, "ILS account → 79 ILS");
assert.deepEqual(page(PAID, [legacy!], "EUR"), { ok: true, price: { monthly: 19, currency: "EUR" } }, "the derived legacy card counts as the included one");
assert.deepEqual(page(PAID, [rowCard], "EUR", OFF), { ok: false, reason: "orders_closed", price: { monthly: 19, currency: "EUR" } }, "orders closed still shows the price");
assert.deepEqual(page(PAID, [rowCard], "EUR", ON, { EUR: 25, ILS: 99 }), { ok: true, price: { monthly: 25, currency: "EUR" } }, "the stored price wins");
assert.deepEqual(page(ADMIN, [rowCard], "ILS"), { ok: true, price: { monthly: 79, currency: "ILS" } }, "an admin is never in the trial gate");
console.log("ok: canAdd.price (trial null, included null, 19 EUR, 79 ILS, legacy counts, stored price)");

// ── C1b: deletable ──────────────────────────────────────────────────────
const dTable: Array<[string, boolean, number, boolean, boolean]> = [
  ["first row, product active", false, 0, true, false],
  ["first row, product inactive", false, 0, false, true],
  ["second row, product active", false, 1, true, true],
  ["third row, product inactive", false, 2, false, true],
  ["derived legacy card, active", true, 0, true, false],
  ["derived legacy card, inactive", true, 0, false, false],
];
for (const [label, derived, index, productActive, want] of dTable) assert.equal(connectorDeletable({ derived, index, productActive }), want, label);
const second = { ...rowCard, id: "00000000-0000-4000-8000-000000000c02" };
assert.deepEqual(withDeletable([rowCard, second], true).map((c) => c.deletable), [false, true], "oldest first: only the first is kept");
assert.deepEqual(withDeletable([rowCard, second], false).map((c) => c.deletable), [true, true]);
assert.deepEqual(withDeletable([legacy!], false).map((c) => c.deletable), [false]);
const ent = (subscriptionStatus: string | null, products: unknown = null, activeTrials: ("connect" | "sales")[] = []) => ({
  subscriptionPlan: "premium",
  subscriptionStatus,
  products,
  activeTrials,
});
const aTable: Array<[string, ReturnType<typeof ent>, boolean]> = [
  ["paid, grandfathered", ent("active"), true],
  ["trialing, grandfathered", ent("trialing"), true],
  ["trial paused, grandfathered", ent("trial_paused"), true],
  ["expired", ent("expired"), false],
  ["canceled", ent("canceled"), false],
  ["no status", ent(null), false],
  ["paid, products with connect base", ent("active", { base: "connect", addons: [] }), true],
  ["paid, products with connect add-on", ent("active", { base: "reception", addons: ["connect"] }), true],
  ["paid, products without connect", ent("active", { base: "reception", addons: ["sales"] }), false],
  ["paid, products without connect + active connect trial", ent("active", { base: "reception", addons: [] }, ["connect"]), true],
  ["expired, products with connect", ent("expired", { base: "connect", addons: [] }), false],
];
for (const [label, input, want] of aTable) assert.equal(connectProductActive(input), want, label);
console.log(`ok: deletable (${dTable.length} rule rows, ${aTable.length} product-active rows)`);

// ── Number exclusivity (pure rule; hooked in B4/B5) ─────────────────────
assert.equal(numberConflict({ e164: "+15550000103", connectorNumbers: [], tamaravoxNumbers: [] }), null);
assert.equal(numberConflict({ e164: "+1 555 000 0103", connectorNumbers: ["+15550000103"], tamaravoxNumbers: [] }), "connector_number");
assert.equal(numberConflict({ e164: "+15550000103", connectorNumbers: [], tamaravoxNumbers: ["+1-555-000-0103"] }), "tamaravox_number");
console.log("ok: number exclusivity");

// ── Source guards ───────────────────────────────────────────────────────
const typesSrc = src("lib/connectors/types.ts");
assert.doesNotMatch(typesSrc, /^\s*import\s/m, "lib/connectors/types.ts has zero imports (client-safe)");
assert.doesNotMatch(src("lib/connectors/limits.ts"), /^\s*import\s/m, "lib/connectors/limits.ts has zero imports (client-safe)");
assert.doesNotMatch(src("lib/connectors/price.ts"), /^\s*import\s/m, "lib/connectors/price.ts has zero imports (client-safe)");
const pageSrc = src("lib/connectors/page.ts");
assert.doesNotMatch(pageSrc, /\.select\(\)/, "explicit picks only");
assert.doesNotMatch(pageSrc.replace(/\$\{connectors\.secret\} IS NOT NULL/g, ""), /connectors\.secret/, "the secret is only ever tested for IS NOT NULL");
// Nothing outside the connectors page / schema / the B2 call-path reader
// (lib/connectors/route-load.ts, its picks pinned in connector-route.test.ts)
// reads the table or the new calls columns.
const files = ["app", "lib"].flatMap((d) =>
  readdirSync(join(ROOT, d), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath ?? e.path, e.name))),
);
// B2: the call-path reader (route-load). B4: the write path (create / edit /
// delete / test) is not a call path.
const allowed = new Set(["lib/db/schema.ts", "lib/connectors/page.ts", "lib/connectors/route-load.ts", "lib/connectors/write.ts"]);
assert.doesNotMatch(src("lib/connectors/route-load.ts"), /\.select\(\)/, "the call-path reader: explicit picks only");
for (const f of files) {
  if (allowed.has(f)) continue;
  const s = src(f);
  assert.doesNotMatch(s, /\bconnectors\b\s*[,}]\s*from\s*"@\/lib\/db\/schema"|\{[^}]*\bconnectors\b[^}]*\}\s*from\s*"@\/lib\/db\/schema"/, `${f} does not import the connectors table`);
  assert.doesNotMatch(s, /calls\.connectorId|calls\.clientAgentReached|connector_id|client_agent_reached/, `${f} does not read the new calls columns`);
}
console.log(`ok: source guards (${files.length} files scanned)`);

console.log("\nALL CONNECTORS TESTS PASSED");
