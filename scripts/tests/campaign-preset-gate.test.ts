// M2d: the campaign goal-preset gate (lib/campaigns/preset-gate.ts), the 4
// cases of every gated write, for a tenant AND an admin, through the SAME
// helpers the routes call with the raw body:
//   create — createGoalPreset(body) → presetGateRefusal (POST /api/dashboard/campaigns)
//   patch  — planCampaignPatch(row, body) → patchPresetGateInput → presetGateRefusal,
//            then plan.changes applied to the row (PATCH /api/dashboard/campaigns/[id])
// Plus the capability rule: book_for_seller needs booking EFFECTIVE, for
// admins too; follow_up needs no tool. Mock data only.
// Run with:  npx tsx scripts/tests/campaign-preset-gate.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planCampaignPatch } from "../../lib/campaigns/patch-plan";
import {
  ADMIN_ONLY_PRESETS,
  createGoalPreset,
  patchPresetGateInput,
  presetGateRefusal,
  type PresetRefusal,
} from "../../lib/campaigns/preset-gate";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { OUTBOUND_TOOLS } from "../../lib/tools/adapters";
import { outboundCapabilities } from "../../lib/tools/store";

const TENANT_AND_ADMIN = [false, true] as const;
const who = (isAdmin: boolean) => (isAdmin ? "admin" : "tenant");
const ADMIN_ONLY: PresetRefusal = { status: 403, body: { error: "preset_admin_only", field: "goalPreset" } };
const NO_BOOKING: PresetRefusal = { status: 403, body: { error: "capability_missing", field: "goalPreset", capability: "booking" } };
const AGENT_A = "00000000-0000-0000-0000-0000000000a1";
const AGENT_B = "00000000-0000-0000-0000-0000000000a2";

type Row = { status: string; goalPreset: string; objective: string; successCriteria: string; agentId: string | null; concurrency: number };
const baseRow: Row = { status: "draft", goalPreset: "sales", objective: "Mock objective", successCriteria: "", agentId: AGENT_A, concurrency: 2 };

/** A loader that records whether the route would have queried booking. */
function booking(active: boolean) {
  const l = { calls: 0, fn: async () => (l.calls++, active) };
  return l;
}

/** The PATCH route's preset path: body → plan → gate → the row after the write (or the refusal). */
async function patchSave(row: Row, body: Record<string, unknown>, isAdmin: boolean, bookingActive = true) {
  const plan = planCampaignPatch(row, body);
  assert.ok(plan.ok, `plan ${JSON.stringify(plan)}`);
  // The route writes an ownership-checked agent id; the mock agents are owned.
  const resolvedAgentId = "agentId" in plan.changes ? ((plan.changes.agentId as string | null) ?? null) : null;
  const gate = patchPresetGateInput(row, plan.changes, resolvedAgentId);
  const loader = booking(bookingActive);
  const refusal = await presetGateRefusal({ ...gate, isAdmin, bookingActive: loader.fn });
  return { refusal, row: refusal ? row : ({ ...row, ...plan.changes } as Row), bookingQueried: loader.calls > 0 };
}

/** The CREATE route's preset path: body → stored preset → gate. */
async function createSave(body: Record<string, unknown>, isAdmin: boolean, bookingActive = true) {
  const preset = createGoalPreset(body);
  const loader = booking(bookingActive);
  const refusal = await presetGateRefusal({ preset, presetChanged: true, agentChanged: false, isAdmin, bookingActive: loader.fn });
  return { refusal, preset, bookingQueried: loader.calls > 0 };
}

const run = async () => {
  assert.deepEqual([...ADMIN_ONLY_PRESETS], ["book_for_seller", "follow_up"]);

  for (const isAdmin of TENANT_AND_ADMIN) {
    const w = who(isAdmin);
    // An admin set each new preset earlier (the stored value case 2 and 4 start from).
    for (const stored of ["sales", "book_for_seller", "follow_up"]) {
      const row = { ...baseRow, goalPreset: stored };

      // (1) other fields pass
      {
        const r = await patchSave(row, { concurrency: 5, objective: "Other mock objective" }, isAdmin);
        assert.equal(r.refusal, null, `${w} (1) other fields, stored ${stored}`);
        assert.equal(r.row.concurrency, 5);
        assert.equal(r.row.goalPreset, stored, `${w} (1) preset kept`);
      }
      // (2) an unchanged re-send passes — the whole draft, preset included
      {
        const r = await patchSave(row, { ...row, concurrency: 4 }, isAdmin, false);
        assert.equal(r.refusal, null, `${w} (2) unchanged re-send of ${stored}`);
        assert.equal(r.row.goalPreset, stored);
        assert.equal(r.bookingQueried, false, `${w} (2) nothing to check: preset and agent unchanged`);
      }
      // (4) a save that OMITS goalPreset keeps the stored value
      for (const body of [{}, { objective: "x" }, { goalPreset: undefined, concurrency: 3 }]) {
        const r = await patchSave(row, body, isAdmin, false);
        assert.equal(r.refusal, null, `${w} (4) omit, stored ${stored}, body ${JSON.stringify(body)}`);
        assert.equal(r.row.goalPreset, stored, `${w} (4) stored ${stored} kept`);
      }
    }

    // (3) a change TO a new preset: tenant → 403 naming goalPreset; admin → passes
    for (const next of ADMIN_ONLY_PRESETS) {
      for (const stored of ["sales", "custom", ...ADMIN_ONLY_PRESETS.filter((p) => p !== next)]) {
        const r = await patchSave({ ...baseRow, goalPreset: stored }, { goalPreset: next }, isAdmin);
        if (isAdmin) {
          assert.equal(r.refusal, null, `admin (3) ${stored} → ${next}`);
          assert.equal(r.row.goalPreset, next);
        } else {
          assert.deepEqual(r.refusal, ADMIN_ONLY, `tenant (3) ${stored} → ${next}`);
          assert.equal(r.row.goalPreset, stored, "nothing applied");
        }
      }
    }
    // Changing AWAY from a new preset, to a public one, passes for both.
    {
      const r = await patchSave({ ...baseRow, goalPreset: "follow_up" }, { goalPreset: "lead_gen" }, isAdmin);
      assert.equal(r.refusal, null, `${w} follow_up → lead_gen`);
      assert.equal(r.row.goalPreset, "lead_gen");
    }

    // ── create ──
    // (1) other fields pass; (4) an ABSENT preset creates "custom" — absent ≠ a new preset
    for (const body of [{ name: "Mock" }, { name: "Mock", objective: "o", concurrency: 2 }, { name: "Mock", goalPreset: undefined }, { name: "Mock", goalPreset: "unknown_mock" }]) {
      const r = await createSave(body, isAdmin, false);
      assert.equal(r.refusal, null, `${w} create ${JSON.stringify(body)}`);
      assert.equal(r.preset, "custom");
      assert.equal(r.bookingQueried, false);
    }
    // (2)/(3) create with a new preset: tenant → 403; admin → passes (book_for_seller: booking checked)
    for (const next of ADMIN_ONLY_PRESETS) {
      const r = await createSave({ name: "Mock", goalPreset: next }, isAdmin);
      assert.deepEqual(r.refusal, isAdmin ? null : ADMIN_ONLY, `${w} create with ${next}`);
    }
    for (const p of ["cold", "sales", "lead_gen", "marketing", "custom"]) {
      assert.equal((await createSave({ name: "Mock", goalPreset: p }, isAdmin, false)).refusal, null, `${w} create ${p}`);
    }
  }

  // ── capability: book_for_seller needs booking effective (admins too) ──
  for (const isAdmin of TENANT_AND_ADMIN) {
    const w = who(isAdmin);
    if (isAdmin) {
      assert.deepEqual((await patchSave(baseRow, { goalPreset: "book_for_seller" }, true, false)).refusal, NO_BOOKING, "admin → book_for_seller without booking");
      assert.deepEqual((await createSave({ name: "Mock", goalPreset: "book_for_seller" }, true, false)).refusal, NO_BOOKING, "admin create without booking");
      // follow_up needs no tool
      assert.equal((await patchSave(baseRow, { goalPreset: "follow_up" }, true, false)).refusal, null, "admin → follow_up without booking");
      assert.equal((await createSave({ name: "Mock", goalPreset: "follow_up" }, true, false)).refusal, null);
    }
    // Stored book_for_seller + the agent changes (or is detached) → re-checked
    const bfs = { ...baseRow, goalPreset: "book_for_seller" };
    for (const agentId of [AGENT_B, null]) {
      const r = await patchSave(bfs, { agentId }, isAdmin, false);
      assert.deepEqual(r.refusal, NO_BOOKING, `${w}: agent → ${agentId} without booking`);
      assert.equal(r.row.agentId, AGENT_A, "nothing applied");
      const ok = await patchSave(bfs, { agentId }, isAdmin, true);
      assert.equal(ok.refusal, null, `${w}: agent → ${agentId} with booking`);
    }
    // Stored book_for_seller, other fields only → not re-checked (case 2 / 4)
    assert.equal((await patchSave(bfs, { concurrency: 7 }, isAdmin, false)).refusal, null, `${w}: book_for_seller kept, other field`);
    // The agent changes on a public preset → no booking check
    assert.equal((await patchSave(baseRow, { agentId: AGENT_B }, isAdmin, false)).bookingQueried, false);
  }

  // The admin-only check comes first: a tenant gets preset_admin_only, never a booking query.
  {
    const r = await patchSave(baseRow, { goalPreset: "book_for_seller" }, false, false);
    assert.deepEqual(r.refusal, ADMIN_ONLY);
    assert.equal(r.bookingQueried, false);
  }

  // "Effective" is the call's own value: OUTBOUND_TOOLS switch ∧ the agent's booking toggle ∧ plan.
  {
    const account = (on: boolean) => ({ googleConnected: true, transferNumber: "", outboundToolsEnabled: on });
    const on = { ...OUTBOUND_TOOLS, booking: { ...OUTBOUND_TOOLS.booking, enabled: true } };
    const active = (stored: unknown, sw: boolean, plan = DEFAULT_MATRIX.premium) => outboundCapabilities(stored, account(sw), plan).capabilities.booking.active;
    assert.equal(active(null, true), false, "no agent / default tools → booking off");
    assert.equal(active(on, false), false, "OUTBOUND_TOOLS off → booking off");
    assert.equal(active(on, true), DEFAULT_MATRIX.premium.calendar, "switch on + toggle on → the plan decides");
    // The loader computes exactly that, like the campaign session config.
    const load = readFileSync(new URL("../../lib/campaigns/preset-gate-load.ts", import.meta.url), "utf8");
    assert.match(load, /capabilityInputsFor\(userId\)/);
    assert.match(load, /outboundCapabilities\(agent\?\.toolsConfig \?\? null, inputs\.account, inputs\.plan\)\.capabilities\.booking\.active/);
    const cfg = readFileSync(new URL("../../lib/agent/session-config/campaign.ts", import.meta.url), "utf8");
    assert.match(cfg, /outboundCapabilities\(agent\?\.toolsConfig \?\? null, toolInputs\.account, toolInputs\.plan\)/);
  }

  // Both routes call the gate (source check: the handlers can't be run without a session).
  {
    const create = readFileSync(new URL("../../app/api/dashboard/campaigns/route.ts", import.meta.url), "utf8");
    assert.match(create, /const goalPreset = createGoalPreset\(body\)/);
    assert.match(create, /presetGateRefusal\(/);
    assert.match(create, /goalPreset,\n/);
    const patch = readFileSync(new URL("../../app/api/dashboard/campaigns/[id]/route.ts", import.meta.url), "utf8");
    assert.match(patch, /patchPresetGateInput\(campaign, plan\.changes,/);
    assert.match(patch, /presetGateRefusal\(/);
    // The gate runs before the write.
    assert.ok(patch.indexOf("presetGateRefusal(") < patch.indexOf(".update(campaigns)"));
    assert.ok(create.indexOf("presetGateRefusal(") < create.indexOf(".insert(campaigns)"));
  }

  console.log("ALL CAMPAIGN PRESET GATE TESTS PASSED");
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
