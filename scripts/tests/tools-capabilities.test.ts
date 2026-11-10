// Unit tests for lib/tools (brick T1): effectiveCapabilities + adapters.
// Run with:  npx tsx scripts/tests/tools-capabilities.test.ts
import assert from "node:assert/strict";

import type { PlanFeatures } from "../../lib/plan-features";
import { OUTBOUND_TOOLS, outboundCallFeatures, receptionistCallFields, toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, PREREQUISITES_ENFORCED_ON_CALL } from "../../lib/tools/contract";

const plan = (calendar: boolean, crm: boolean): PlanFeatures => ({
  calendar, crm, whatsapp_confirm: true, whatsapp_recap: true, outbound_campaigns: false,
});
const rec = (t: { calendar: boolean; customers: boolean; orders: boolean }, transferNumber: string, googleConnected: boolean, p: PlanFeatures) =>
  effectiveCapabilities({ recipe: "receptionist", tools: toolsFromTileToggles(t) }, { transferNumber, googleConnected }, p);

assert.equal(PREREQUISITES_ENFORCED_ON_CALL, false, "T1 ships with prerequisites not enforced on the call");

// EXHAUSTIVE: the call fields equal today's formula (inbound.ts before T1)
// for every plan × toggles × Google × transfer combination.
const B = [false, true];
let n = 0;
for (const pc of B) for (const pcrm of B) for (const tc of B) for (const tcu of B) for (const to of B) for (const g of B) for (const tn of ["", "+97250000000"]) {
  const p = plan(pc, pcrm);
  const caps = rec({ calendar: tc, customers: tcu, orders: to }, tn, g, p);
  const got = receptionistCallFields(caps, p);
  const today = {
    features: { ...p, calendar: p.calendar && tc, crm: p.crm && tcu },
    ordersEnabled: Boolean(p.crm) && to,
  };
  assert.equal(JSON.stringify(got), JSON.stringify(today), `combo ${n}`); // key order too
  // transfer: the worker registers transfer_call iff the served string is non-empty
  assert.equal(caps.transfer.active, Boolean(tn));
  n++;
}
assert.equal(n, 128);

// A no-Google tenant: the call is UNCHANGED (active), the screen sees why it will fail.
{
  const caps = rec({ calendar: true, customers: true, orders: false }, "", false, plan(true, true));
  assert.deepEqual(caps.booking, {
    requested: true, planIncluded: true, prerequisite: { met: false, missing: "google_not_connected" }, active: true,
  });
  assert.deepEqual(caps.contacts.prerequisite, { met: false, missing: "google_not_connected" });
  assert.equal(caps.contacts.active, true);
  assert.deepEqual(caps.transfer, {
    requested: true, planIncluded: true, prerequisite: { met: false, missing: "no_transfer_number" }, active: false,
  });
  assert.deepEqual(caps.orders, { requested: false, planIncluded: true, prerequisite: { met: true, missing: null }, active: false });
}
// Google connected + number: all prerequisites met
{
  const caps = rec({ calendar: true, customers: false, orders: true }, "+97250000000", true, plan(true, false));
  assert.deepEqual(caps.booking.prerequisite, { met: true, missing: null });
  assert.equal(caps.contacts.active, false); // switched off by the customer
  assert.equal(caps.orders.planIncluded, false);
  assert.equal(caps.orders.active, false); // plan has no CRM
  assert.equal(caps.transfer.active, true);
}

// Outbound: nothing active whatever the plan (until T4), features unchanged
for (const p of [plan(true, true), plan(false, false)]) {
  const caps = effectiveCapabilities({ recipe: "outbound", tools: OUTBOUND_TOOLS }, { transferNumber: "", googleConnected: true }, p);
  for (const c of Object.values(caps)) {
    assert.equal(c.active, false);
    assert.deepEqual(c.prerequisite, { met: false, missing: "not_available_outbound" });
  }
  assert.equal(
    JSON.stringify(outboundCallFeatures(caps)),
    JSON.stringify({ calendar: false, crm: false, whatsapp_confirm: false, whatsapp_recap: false, outbound_campaigns: true }),
  );
}
// …even if outbound switches were on (T4 ships them off)
{
  const on = toolsFromTileToggles({ calendar: true, customers: true, orders: true });
  const caps = effectiveCapabilities({ recipe: "outbound", tools: on }, { transferNumber: "+97250000000", googleConnected: true }, plan(true, true));
  assert.ok(Object.values(caps).every((c) => !c.active));
}

console.log("ALL TOOLS-CAPABILITIES TESTS PASSED");
