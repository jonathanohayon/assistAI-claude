// Tools brick (T2): how each capability state is shown. Mock data only.
// Run with:  npx tsx scripts/tests/tools-brick.test.ts

import assert from "node:assert/strict";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS, toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, type CapabilityState } from "../../lib/tools/contract";
import { capabilityList, capabilityView, toolsPatch } from "../../components/bricks/tools/tools-ui";

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
  assert.ok(out.switches.every((v) => v.status === "off"), "outbound: everything off until T4");
}

// 4. Save patch: only what changed, key by key
{
  const base = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  assert.deepEqual(toolsPatch(base, structuredClone(base)), {});
  assert.deepEqual(toolsPatch(base, { ...base, orders: { enabled: true } }), { orders: { enabled: true } });
}

console.log("ALL TOOLS-BRICK TESTS PASSED");
