// Verified numbers N1 (lib/contact-confirmation.ts): the confirmation state
// per contact value, the ONE decision maySendTo(), and the record a save
// leaves. Enforcement is OFF in N1: `allowed` is always true.
// The DB side (migration, real writes, admin confirm): contact-confirmation-db.test.ts.
// Mock data only (+1555…, example.com). Run with:
//   npx tsx scripts/tests/contact-confirmation.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTACT_CONFIRMATION_ENFORCED,
  CONTACT_KINDS,
  confirmationsAfterConfirm,
  confirmationsAfterSave,
  contactState,
  contactValuesOf,
  maySendTo,
  normaliseContactValue,
  parseContactConfirmations,
  savedContactValues,
  withoutContactConfirmations,
  type ContactKind,
} from "../../lib/contact-confirmation";
import { contactConfirmationsWrite } from "../../lib/contact-confirmation-store";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const AT = "2026-11-01T08:00:00.000Z";
const NOW = new Date("2026-11-15T10:00:00.000Z");
const VALUE: Record<ContactKind, string> = {
  owner_whatsapp: "+15550000001",
  transfer_number: "+15550000002",
  owner_recap_email: "owner@example.com",
};
const OTHER: Record<ContactKind, string> = {
  owner_whatsapp: "+15550000011",
  transfer_number: "+15550000012",
  owner_recap_email: "other@example.com",
};

// ── Enforcement is off in N1 ────────────────────────────────────────────
assert.equal(CONTACT_CONFIRMATION_ENFORCED, false, "N1 ships with enforcement OFF");
assert.deepEqual([...CONTACT_KINDS], ["owner_whatsapp", "transfer_number", "owner_recap_email"]);

// ── maySendTo: every kind × every state ─────────────────────────────────
for (const kind of CONTACT_KINDS) {
  const v = VALUE[kind];
  const cases: Array<[string, unknown, unknown, Record<string, unknown>]> = [
    ["grandfathered", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "grandfathered" } }, { state: "confirmed", by: "grandfathered", at: AT }],
    ["confirmed by code", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "confirmed", by: "code", at: AT }],
    ["confirmed by admin", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "admin" } }, { state: "confirmed", by: "admin", at: AT }],
    ["saved, never confirmed", v, { [kind]: { value: v, state: "unconfirmed", at: AT } }, { state: "unconfirmed", reason: "not_confirmed", at: AT }],
    ["no record", v, {}, { state: "unconfirmed", reason: "no_record" }],
    ["NULL column", v, null, { state: "unconfirmed", reason: "no_record" }],
    ["record of another kind only", v, { [kind === "owner_whatsapp" ? "transfer_number" : "owner_whatsapp"]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "unconfirmed", reason: "no_record" }],
    ["value changed since confirmation", OTHER[kind], { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "unconfirmed", reason: "value_changed" }],
    ["value changed since a grandfathered record", OTHER[kind], { [kind]: { value: v, state: "confirmed", at: AT, by: "grandfathered" } }, { state: "unconfirmed", reason: "value_changed" }],
    ["no value", "", { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "unconfirmed", reason: "no_value" }],
    ["malformed entry (unknown by)", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "someone" } }, { state: "unconfirmed", reason: "no_record" }],
    ["malformed entry (no at)", v, { [kind]: { value: v, state: "confirmed", by: "code" } }, { state: "unconfirmed", reason: "no_record" }],
    ["malformed entry (unknown state)", v, { [kind]: { value: v, state: "maybe", at: AT } }, { state: "unconfirmed", reason: "no_record" }],
    ["malformed column (array)", v, [1, 2], { state: "unconfirmed", reason: "no_record" }],
    ["malformed column (string)", v, "confirmed", { state: "unconfirmed", reason: "no_record" }],
  ];
  for (const [name, value, record, state] of cases) {
    assert.deepEqual(contactState(kind, value, record), state, `${kind} ${name}: state`);
    // Enforcement OFF (the default): always allowed, state still reported.
    assert.deepEqual(maySendTo(kind, value, record), { allowed: true, ...state }, `${kind} ${name}: enforcement off → allowed`);
    // N4 semantics, for the record: only a confirmed value passes.
    assert.equal(maySendTo(kind, value, record, { enforced: true }).allowed, state.state === "confirmed", `${kind} ${name}: enforced`);
  }
}

// The record is bound to the NORMALISED value: formatting differences match.
assert.equal(contactState("owner_whatsapp", "+1 (555) 000-0001", { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
assert.equal(contactState("transfer_number", "15550000002", { transfer_number: { value: "+1 555 000 0002", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
assert.equal(contactState("owner_recap_email", "  Owner@Example.COM ", { owner_recap_email: { value: "owner@example.com", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
// …but one digit is another value.
assert.equal(contactState("owner_whatsapp", "+15550000009", { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code" } }).state, "unconfirmed");
// A phone confirmation never confirms an email and vice versa (keyed by kind).
assert.equal(contactState("owner_recap_email", "owner@example.com", { owner_whatsapp: { value: "owner@example.com", state: "confirmed", at: AT, by: "code" } }).state, "unconfirmed");
assert.equal(normaliseContactValue("owner_whatsapp", null), "");
assert.equal(normaliseContactValue("owner_whatsapp", " "), "");
assert.equal(normaliseContactValue("transfer_number", "+1.555.000.0002"), "+15550000002");

// parse keeps only known kinds and valid entries.
assert.deepEqual(
  parseContactConfirmations({
    owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "grandfathered", extra: 1 },
    seller_phone: { value: "+15550000003", state: "confirmed", at: AT, by: "code" },
    owner_recap_email: { value: "", state: "unconfirmed", at: AT },
  }),
  { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "grandfathered" } },
);

// ── The record after a save ─────────────────────────────────────────────
const grand = {
  owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: AT, by: "grandfathered" },
  transfer_number: { value: VALUE.transfer_number, state: "confirmed", at: AT, by: "grandfathered" },
  owner_recap_email: { value: VALUE.owner_recap_email, state: "confirmed", at: AT, by: "grandfathered" },
};
for (const kind of CONTACT_KINDS) {
  // A NEW value → unconfirmed for that new value, at = now; others untouched.
  const changed = confirmationsAfterSave(grand, { [kind]: OTHER[kind] }, NOW);
  assert.deepEqual(changed, { ...grand, [kind]: { value: OTHER[kind], state: "unconfirmed", at: NOW.toISOString() } }, `${kind}: new value → unconfirmed`);
  assert.deepEqual(contactState(kind, OTHER[kind], changed), { state: "unconfirmed", reason: "not_confirmed", at: NOW.toISOString() });
  // The SAME value (even formatted differently) → kept: no write at all.
  const same = kind === "owner_recap_email" ? " OWNER@example.com" : VALUE[kind].replace("+1", "+1 ");
  assert.equal(confirmationsAfterSave(grand, { [kind]: same }, NOW), null, `${kind}: same value → record kept`);
  // EMPTY → the entry is removed.
  const cleared = confirmationsAfterSave(grand, { [kind]: "" }, NOW);
  const { [kind]: _gone, ...rest } = grand;
  void _gone;
  assert.deepEqual(cleared, rest, `${kind}: empty → cleared`);
  assert.equal(confirmationsAfterSave({}, { [kind]: "" }, NOW), null, `${kind}: empty with no record → nothing to write`);
  // OMITTED → value and state kept (nothing to write).
  assert.equal(confirmationsAfterSave(grand, {}, NOW), null, `${kind}: omitted → kept`);
  // Changing back to the old value after a change: unconfirmed (no history kept).
  assert.equal(contactState(kind, VALUE[kind], confirmationsAfterSave(changed, { [kind]: VALUE[kind] }, NOW)).state, "unconfirmed");
  // First value ever (no record) → unconfirmed.
  assert.deepEqual(confirmationsAfterSave(null, { [kind]: VALUE[kind] }, NOW), { [kind]: { value: VALUE[kind], state: "unconfirmed", at: NOW.toISOString() } });
}
// A new value replacing an UNCONFIRMED one restarts its `at`.
assert.deepEqual(
  confirmationsAfterSave({ owner_whatsapp: { value: VALUE.owner_whatsapp, state: "unconfirmed", at: AT } }, { owner_whatsapp: OTHER.owner_whatsapp }, NOW),
  { owner_whatsapp: { value: OTHER.owner_whatsapp, state: "unconfirmed", at: NOW.toISOString() } },
);
// Grandfathered records stay identifiable, with their timestamp, through
// unrelated saves.
const afterEmail = confirmationsAfterSave(grand, { owner_recap_email: OTHER.owner_recap_email }, NOW)!;
assert.deepEqual(afterEmail.owner_whatsapp, grand.owner_whatsapp);
assert.deepEqual(contactState("owner_whatsapp", VALUE.owner_whatsapp, afterEmail), { state: "confirmed", by: "grandfathered", at: AT });

// Confirm (admin / code): bound to the normalised value; no code stored.
const confirmed = confirmationsAfterConfirm({ owner_whatsapp: { value: VALUE.owner_whatsapp, state: "unconfirmed", at: AT } }, "owner_whatsapp", "+1 555 000 0001", "admin", NOW);
assert.deepEqual(confirmed, { owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: NOW.toISOString(), by: "admin" } });
assert.ok(!/code"\s*:/.test(JSON.stringify(confirmed)), "no code field");

// ── Which kinds a write touches (route `updates` → values after) ────────
const row = { ownerWhatsapp: VALUE.owner_whatsapp, transferNumber: VALUE.transfer_number, transferNumberParked: null, ownerRecapEmail: VALUE.owner_recap_email };
assert.deepEqual(contactValuesOf(row), VALUE);
assert.deepEqual(contactValuesOf({ ...row, transferNumber: "", transferNumberParked: VALUE.transfer_number }).transfer_number, VALUE.transfer_number, "parked = kept number");
assert.deepEqual(savedContactValues(row, { updatedAt: NOW, instructions: "x" } as never), {}, "a save of other fields touches no kind");
assert.deepEqual(savedContactValues(row, { ownerWhatsapp: undefined }), {}, "undefined = not written");
assert.deepEqual(savedContactValues(row, { ownerWhatsapp: OTHER.owner_whatsapp }), { owner_whatsapp: OTHER.owner_whatsapp });
assert.deepEqual(savedContactValues(row, { ownerRecapEmail: "" }), { owner_recap_email: "" });
assert.deepEqual(savedContactValues(row, { ownerRecapEmailEnabled: true } as never), {}, "the recap switch alone touches no kind");
// Tools switch OFF parks the number: kept number unchanged → record kept.
const parked = { transferNumber: "", transferNumberParked: VALUE.transfer_number };
assert.deepEqual(savedContactValues(row, parked), { transfer_number: VALUE.transfer_number });
assert.equal(confirmationsAfterSave(grand, savedContactValues(row, parked), NOW), null, "parking keeps the transfer record");
// …and back ON restores it: same number, still kept.
const restored = { transferNumber: VALUE.transfer_number, transferNumberParked: null };
assert.equal(confirmationsAfterSave(grand, savedContactValues({ ...row, ...parked }, restored), NOW), null, "restoring keeps the transfer record");
// Transfer OFF with no number: cleared.
assert.deepEqual(savedContactValues(row, { transferNumber: "", transferNumberParked: null }), { transfer_number: "" });
// The legacy route: transferNumber only (parked untouched, legacy-sync gave {}).
assert.deepEqual(savedContactValues({ ...row, ...parked }, { transferNumber: "" }), { transfer_number: VALUE.transfer_number }, "legacy '' while parked keeps the kept number");

// contactConfirmationsWrite: the column write, or {} (nothing written).
assert.deepEqual(contactConfirmationsWrite({ ...row, contactConfirmations: grand }, { instructions: "x" } as never, NOW), {});
assert.deepEqual(contactConfirmationsWrite({ ...row, contactConfirmations: grand }, { ownerWhatsapp: VALUE.owner_whatsapp }, NOW), {}, "same value → no write");
assert.ok("contactConfirmations" in contactConfirmationsWrite({ ...row, contactConfirmations: grand }, { ownerWhatsapp: OTHER.owner_whatsapp }, NOW));

// ── The record is never returned by the config routes ───────────────────
assert.deepEqual(withoutContactConfirmations({ a: 1, contactConfirmations: grand }), { a: 1 });
for (const p of ["app/api/dashboard/config/route.ts", "app/api/admin/configs/[userId]/route.ts"]) {
  const s = src(p).replace(/\/\/.*$/gm, "");
  const spreads: string[] = s.match(/\.\.\.[A-Za-z]+\(/g) ?? [];
  assert.equal(
    (s.match(/\.\.\.withoutContactConfirmations\(withoutToolsStore\((config|cfg|updated)\)\)/g) ?? []).length,
    2,
    `${p}: GET and PUT bodies exclude the record`,
  );
  assert.ok(!spreads.includes("...withoutToolsStore("), `${p}: no row spread keeps the record`);
  // The route records the save, kept out of `updates` (the event is unchanged).
  assert.match(s, /const confirmations = contactConfirmationsWrite\((current|currentRow), updates\);/);
  assert.match(s, /\.set\(\{ \.\.\.updates, \.\.\.confirmations \}\)/);
  assert.doesNotMatch(s, /updates\.contactConfirmations|Object\.assign\(updates, confirmations\)/);
}
// The other write paths of the three values.
assert.match(src("lib/tools/write.ts"), /\.\.\.contactConfirmationsWrite\(row, plan\.columns\),/);
assert.match(src("lib/owner-recap-email-store.ts"), /\.set\(\{ \.\.\.write\.updates, \.\.\.confirmations, updatedAt: new Date\(\) \}\)/);
// The email route's bodies are built from loadOwnerRecapEmail (2 columns):
// the record is never selected there.
assert.doesNotMatch(
  src("lib/owner-recap-email-store.ts").split("export async function loadOwnerRecapEmail")[1].split("export type SaveResult")[0],
  /contactConfirmations/,
);

// ── N1 wires no sender: the decision is not called by any send site ─────
for (const p of [
  "lib/notifications/whatsapp-test.ts",
  "app/api/dashboard/notifications/whatsapp-test/route.ts",
  "app/api/calls/end/route.ts",
  "lib/owner-recap-email-send.ts",
  "lib/owner-recap-whatsapp.ts",
  "lib/owner-digest-run.ts",
  "lib/call-me.ts",
  "app/api/dashboard/call-me/route.ts",
  "app/api/whatsapp/notify/route.ts",
  "lib/appointment-reminders-run.ts",
  "lib/alerts.ts",
  "lib/email-test/handler.ts",
]) {
  assert.doesNotMatch(src(p), /contact-confirmation|contactConfirmations|maySendTo/, `${p}: untouched in N1`);
}

console.log("ALL CONTACT-CONFIRMATION TESTS PASSED");
