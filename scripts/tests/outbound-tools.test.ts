// Unit tests for T4 (tools on outbound calls): the OUTBOUND_TOOLS switch, the
// outbound capabilities (= the receptionist's rules once enabled), the
// payload fields, the server write gate and the outbound call identity.
// Run with:  npx tsx scripts/tests/outbound-tools.test.ts
import assert from "node:assert/strict";

import { CALL_DIRECTION_HEADER, isOutboundCall, outboundCallerUserId } from "../../lib/call-direction";
import type { PlanFeatures } from "../../lib/plan-features";
import { OUTBOUND_TOOLS, outboundCallFeatures, outboundToolFields, receptionistCallFields } from "../../lib/tools/adapters";
import { CAPABILITY_KEYS, effectiveCapabilities, type Tools } from "../../lib/tools/contract";
import { outboundToolsEnabled, outboundToolsMode } from "../../lib/tools/outbound-switch";
import { outboundToolsRefused } from "../../lib/tools/store";

const plan = (calendar: boolean, crm: boolean): PlanFeatures => ({
  calendar, crm, whatsapp_confirm: true, whatsapp_recap: true, outbound_campaigns: true,
});
const tools = (on: Partial<Record<"booking" | "contacts" | "transfer" | "orders", boolean>>): Tools => ({
  ...OUTBOUND_TOOLS,
  booking: { ...OUTBOUND_TOOLS.booking, enabled: Boolean(on.booking) },
  contacts: { enabled: Boolean(on.contacts) },
  transfer: { ...OUTBOUND_TOOLS.transfer, enabled: Boolean(on.transfer) },
  orders: { ...OUTBOUND_TOOLS.orders, enabled: Boolean(on.orders) },
});
const B = [false, true];

// ── The site switch ─────────────────────────────────────────────────────
{
  const cases: Array<[string | undefined, string]> = [
    [undefined, "off"], ["", "off"], ["off", "off"], ["on", "off"], ["true", "off"], ["1", "off"],
    ["admin", "admin"], [" Admin ", "admin"], ["all", "all"], ["ALL", "all"],
  ];
  for (const [v, want] of cases) assert.equal(outboundToolsMode({ OUTBOUND_TOOLS: v }), want, `OUTBOUND_TOOLS=${v}`);
  assert.equal(outboundToolsMode({}), "off", "unset = off");
  assert.equal(outboundToolsEnabled("off", true), false);
  assert.equal(outboundToolsEnabled("off", false), false);
  assert.equal(outboundToolsEnabled("admin", true), true, "admin mode: admin owner enabled");
  assert.equal(outboundToolsEnabled("admin", false), false, "admin mode: non-admin owner disabled");
  assert.equal(outboundToolsEnabled("all", false), true);
  assert.equal(outboundToolsEnabled("all", true), true);
}

// ── Switch OFF: today's outbound behaviour, whatever the agent's toggles ──
{
  let n = 0;
  for (const pc of B) for (const pcrm of B) for (const g of B) for (const tn of ["", "+97250000000"])
    for (const bk of B) for (const ct of B) for (const tr of B) for (const od of B) {
      const t = tools({ booking: bk, contacts: ct, transfer: tr, orders: od });
      const off = effectiveCapabilities({ recipe: "outbound", tools: t }, { transferNumber: tn, googleConnected: g, outboundToolsEnabled: false }, plan(pc, pcrm));
      const absent = effectiveCapabilities({ recipe: "outbound", tools: t }, { transferNumber: tn, googleConnected: g }, plan(pc, pcrm));
      assert.deepEqual(off, absent, "false = absent");
      for (const k of CAPABILITY_KEYS) {
        assert.equal(off[k].active, false);
        assert.deepEqual(off[k].prerequisite, { met: false, missing: "not_available_outbound" });
      }
      assert.equal(
        JSON.stringify(outboundCallFeatures(off)),
        JSON.stringify({ calendar: false, crm: false, whatsapp_confirm: false, whatsapp_recap: false, outbound_campaigns: true }),
      );
      assert.equal(JSON.stringify(outboundToolFields(off, "acct", tn)), "{}", "no field added when off");
      n++;
    }
  assert.equal(n, 256);
}

// ── Switch ON: booking / transfer exactly as the receptionist's ─────────
{
  let n = 0;
  for (const pc of B) for (const pcrm of B) for (const g of B) for (const tn of ["", "+97250000000"])
    for (const bk of B) for (const ct of B) for (const tr of B) for (const od of B) {
      const t = tools({ booking: bk, contacts: ct, transfer: tr, orders: od });
      const p = plan(pc, pcrm);
      const account = { transferNumber: tn, googleConnected: g };
      const out = effectiveCapabilities({ recipe: "outbound", tools: t }, { ...account, outboundToolsEnabled: true }, p);
      const rec = effectiveCapabilities({ recipe: "receptionist", tools: t }, account, p);
      assert.deepEqual(out.booking, rec.booking, "booking = receptionist");
      assert.deepEqual(out.transfer, rec.transfer, "transfer = receptionist");
      assert.equal(outboundCallFeatures(out).calendar, receptionistCallFields(rec, p).features.calendar, "served calendar = receptionist");
      assert.equal(out.transfer.active, tr && Boolean(tn), "transfer active ⇔ toggled and a number");
      // Contacts and orders never on an outbound call.
      for (const k of ["contacts", "orders"] as const) {
        assert.equal(out[k].active, false);
        assert.equal(out[k].prerequisite.missing, "not_available_outbound");
      }
      assert.equal(outboundCallFeatures(out).crm, false);
      const fields = outboundToolFields(out, "acct", tn);
      const any = out.booking.active || out.transfer.active;
      assert.deepEqual(fields, any ? { accountId: "acct", ...(out.transfer.active ? { transferNumber: tn } : {}) } : {});
      n++;
    }
  assert.equal(n, 256);
}

// The reference case: booking + transfer on, Google, plan with calendar, number set.
{
  const t = tools({ booking: true, transfer: true });
  const p = plan(true, true);
  const out = effectiveCapabilities({ recipe: "outbound", tools: t }, { transferNumber: "+97250000000", googleConnected: true, outboundToolsEnabled: true }, p);
  assert.equal(out.booking.active, true);
  assert.equal(out.transfer.active, true);
  assert.equal(outboundCallFeatures(out).calendar, true);
  assert.deepEqual(outboundToolFields(out, "acct", "+97250000000"), { accountId: "acct", transferNumber: "+97250000000" });
}

// ── Server write gate (outbound PUT) ────────────────────────────────────
{
  const none = tools({});
  const withBooking = tools({ booking: true });
  // switch off → turning booking on is refused, naming the field
  assert.deepEqual(outboundToolsRefused(none, withBooking, false), ["tools.booking.enabled"]);
  assert.deepEqual(outboundToolsRefused(none, tools({ booking: true, transfer: true }), false), ["tools.booking.enabled", "tools.transfer.enabled"]);
  // an unchanged re-send passes (even with a capability already on)
  assert.deepEqual(outboundToolsRefused(none, none, false), []);
  assert.deepEqual(outboundToolsRefused(withBooking, withBooking, false), []);
  // another field passes
  const dur: Tools = { ...none, booking: { ...none.booking, defaultDurationMinutes: 45 } };
  assert.deepEqual(outboundToolsRefused(none, dur, false), []);
  // turning one OFF passes
  assert.deepEqual(outboundToolsRefused(withBooking, none, false), []);
  // switch on → booking / transfer may be turned on
  assert.deepEqual(outboundToolsRefused(none, tools({ booking: true, transfer: true }), true), []);
  // contacts / orders can't be turned on outbound, even with the switch on
  assert.deepEqual(outboundToolsRefused(none, tools({ contacts: true, orders: true }), true), ["tools.contacts.enabled", "tools.orders.enabled"]);
  assert.deepEqual(outboundToolsRefused(none, tools({ contacts: true }), false), ["tools.contacts.enabled"]);
}

// ── Outbound call identity ──────────────────────────────────────────────
{
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(CALL_DIRECTION_HEADER, "x-call-direction");
  // no marker / another value → inbound rules (null)
  assert.equal(outboundCallerUserId(h({ "x-tenant-phone": "+97220000000" })), null);
  assert.equal(outboundCallerUserId(h({ "x-tenant-user-id": "u1" })), null);
  assert.equal(outboundCallerUserId(h({ "x-call-direction": "inbound", "x-tenant-user-id": "u1" })), null);
  assert.equal(isOutboundCall(h({})), false);
  // marker → the account id only; the phone is ignored
  assert.equal(outboundCallerUserId(h({ "x-call-direction": "outbound", "x-tenant-user-id": "u1", "x-tenant-phone": "+97220000000" })), "u1");
  assert.equal(outboundCallerUserId(h({ "x-call-direction": " Outbound ", "x-tenant-user-id": " u1 " })), "u1");
  // marker without an account id → "" = refuse (a phone alone never counts)
  assert.equal(outboundCallerUserId(h({ "x-call-direction": "outbound", "x-tenant-phone": "+97220000000" })), "");
  assert.equal(outboundCallerUserId(h({ "x-call-direction": "outbound", "x-tenant-user-id": "  " })), "");
}

console.log("ALL OUTBOUND-TOOLS TESTS PASSED");
