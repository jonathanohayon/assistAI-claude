// Unit tests for lib/tools/store.ts + upgrade.ts (brick T3).
// Run with:  npx tsx scripts/tests/tools-store.test.ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { PLANS } from "../../lib/plans";
import { DEFAULT_TILE_TOGGLES } from "../../lib/tile-toggles";
import { OUTBOUND_TOOLS, receptionistCallFields, toolsFromTileToggles } from "../../lib/tools/adapters";
import {
  accountTransferNumber,
  columnsAfterLegacyTransferWrite,
  currentReceptionistTools,
  mergeTools,
  parseTools,
  planOutboundToolsWrite,
  planReceptionistToolsWrite,
  receptionistCapabilities,
  type ReceptionistToolSettings,
} from "../../lib/tools/store";
import { upgradePlans } from "../../lib/tools/upgrade";

const T = DEFAULT_TILE_TOGGLES;
const NUM = "+97250000000";
const fresh: ReceptionistToolSettings = { toolsConfig: null, transferNumber: NUM, transferNumberParked: null };
const apply = (row: ReceptionistToolSettings, patch: unknown) => {
  const w = planReceptionistToolsWrite(row, T, patch);
  assert.ok(w.ok, JSON.stringify(w));
  return { row: { ...row, ...w.columns }, w };
};

// Never written = derived from today's settings (identical read-back).
assert.deepEqual(currentReceptionistTools(fresh, T), toolsFromTileToggles(T));
assert.deepEqual(parseTools(toolsFromTileToggles(T)), { ok: true, value: toolsFromTileToggles(T) });

// ── Transfer OFF keeps the number server-side, ON restores it ──────────
{
  const off = apply(fresh, { transfer: { enabled: false } });
  assert.equal(off.row.transferNumber, "", "OFF: nothing served (the worker registers no transfer_call)");
  assert.equal(off.row.transferNumberParked, NUM, "OFF: the number is kept");
  assert.equal(currentReceptionistTools(off.row, T).transfer.enabled, false);
  assert.equal(accountTransferNumber(off.row), NUM);
  // A legacy re-send of the served value ('') keeps it OFF and parked.
  assert.equal(columnsAfterLegacyTransferWrite(off.row, T, ""), null);
  const on = apply(off.row, { transfer: { enabled: true } });
  assert.equal(on.row.transferNumber, NUM, "ON: the number is restored");
  assert.equal(on.row.transferNumberParked, null);
  assert.equal(currentReceptionistTools(on.row, T).transfer.enabled, true);
  // A legacy NEW number while OFF: served, nothing parked → ON.
  const legacy = columnsAfterLegacyTransferWrite(off.row, T, "+97250000001");
  assert.ok(legacy);
  assert.equal(legacy.transferNumberParked, null);
  assert.equal(legacy.toolsConfig.transfer.enabled, true);
  // ON with no number at all: switch kept, prerequisite missing.
  const none = apply({ ...fresh, transferNumber: "" }, { transfer: { enabled: true } });
  assert.equal(none.row.transferNumber, "");
  assert.deepEqual(receptionistCapabilities(none.row, T, true, DEFAULT_MATRIX.premium).capabilities.transfer.prerequisite, {
    met: false, missing: "no_transfer_number",
  });
}

// ── The call's transfer = what is served, in every state ───────────────
for (const row of [
  fresh,
  { ...fresh, transferNumber: "" },
  { toolsConfig: null, transferNumber: "", transferNumberParked: NUM },
  apply(fresh, { transfer: { enabled: false } }).row,
  apply({ ...fresh, transferNumber: "" }, { transfer: { enabled: false } }).row,
]) {
  const { capabilities } = receptionistCapabilities(row, T, true, DEFAULT_MATRIX.premium);
  assert.equal(capabilities.transfer.active, Boolean(row.transferNumber), JSON.stringify(row));
}

// ── Switches always come from today's settings (no drift) ──────────────
{
  const stored = apply(fresh, { booking: { enabled: true, defaultDurationMinutes: 45 }, orders: { ask: "size" } }).row;
  const toggles = { calendar: false, customers: false, orders: true }; // changed by another path
  const t = currentReceptionistTools(stored, toggles);
  assert.equal(t.booking.enabled, false);
  assert.equal(t.contacts.enabled, false);
  assert.equal(t.orders.enabled, true);
  assert.equal(t.booking.defaultDurationMinutes, 45, "level-2 settings come from the store");
  assert.equal(t.orders.ask, "size");
}

// ── A tools write writes the toggles; call fields follow ───────────────
{
  const { w } = apply(fresh, { booking: { enabled: false }, orders: { enabled: true } });
  assert.ok(w.ok);
  assert.deepEqual(w.toggles, { calendar: false, customers: true, orders: true });
  const caps = receptionistCapabilities(w.ok ? { ...fresh, ...w.columns } : fresh, w.toggles, true, DEFAULT_MATRIX.premium);
  assert.equal(receptionistCallFields(caps.capabilities, DEFAULT_MATRIX.premium).features.calendar, false);
  assert.equal(receptionistCallFields(caps.capabilities, DEFAULT_MATRIX.premium).ordersEnabled, true);
}

// ── Strict validation; no admin-only or technical field can be written ─
const bad = (patch: unknown, needle: string) => {
  const r = planReceptionistToolsWrite(fresh, T, patch);
  assert.ok(!r.ok && r.error === "invalid_tools" && r.fields.some((f) => f.includes(needle)), `${JSON.stringify(patch)} → ${JSON.stringify(r)}`);
};
bad({ plan: { calendar: true } }, "tools.plan: unknown");
bad({ booking: { toolNames: ["book_appointment"] } }, "tools.booking.toolNames: unknown");
bad({ booking: { enabled: "yes" } }, "tools.booking.enabled");
bad({ booking: { defaultDurationMinutes: 2 } }, "defaultDurationMinutes");
bad({ booking: { minNoticeMinutes: 1.5 } }, "minNoticeMinutes");
bad({ transfer: { when: "sometimes" } }, "tools.transfer.when");
bad({ orders: { ask: "x".repeat(1001) } }, "tools.orders.ask");
bad("nope", "tools: must be an object");
assert.equal(mergeTools(toolsFromTileToggles(T), { version: 99 }).ok, true, "version is not writable");

// ── Outbound: stored only, never active ────────────────────────────────
{
  const w = planOutboundToolsWrite(null, { booking: { enabled: true }, transfer: { enabled: true } });
  assert.ok(w.ok);
  assert.equal(w.value.booking.enabled, true);
  assert.deepEqual(planOutboundToolsWrite(null, {}), { ok: true, value: OUTBOUND_TOOLS });
}

// ── Upgrade: the cheapest public plan that includes it ─────────────────
{
  const caps = receptionistCapabilities(fresh, T, true, DEFAULT_MATRIX.whatsapp).capabilities;
  const up = upgradePlans(caps, DEFAULT_MATRIX, PLANS);
  for (const [k, plan] of Object.entries(up)) {
    const f = k === "booking" ? "calendar" : "crm";
    const cheapest = PLANS.filter((p) => p.public && DEFAULT_MATRIX[p.key][f]).sort((a, b) => a.monthly - b.monthly)[0];
    assert.equal(plan, cheapest?.key, k);
  }
  assert.ok(!("transfer" in up));
  assert.deepEqual(upgradePlans(receptionistCapabilities(fresh, T, true, DEFAULT_MATRIX.premium).capabilities, DEFAULT_MATRIX, PLANS), {});
}

// ── Technical tool names: imported by the tools route only ─────────────
const importers = execSync(`grep -rl --include="*.ts" --include="*.tsx" "tools/admin-names" app components lib i18n || true`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
assert.deepEqual(importers, ["app/api/dashboard/tools/route.ts"]);

console.log("ALL TOOLS-STORE TESTS PASSED");
