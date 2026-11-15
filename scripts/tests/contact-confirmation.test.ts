// Verified numbers N1 (lib/contact-confirmation.ts): the confirmation state
// per contact value, the ONE decision maySendTo(), the grandfather grace and
// the record a save leaves. Enforcement is OFF in N1: `allowed` is always true.
// Read rule: NO entry for a kind = grandfathered = confirmed.
// The DB side (migration writes no data, real writes, admin confirm, sends):
// contact-confirmation-db.test.ts. Mock data only (+1555…, example.com). Run with:
//   npx tsx scripts/tests/contact-confirmation.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import {
  CONTACT_CONFIRMATION_ENFORCED,
  CONTACT_CONFIRMATION_GRACE_DAYS,
  CONTACT_KINDS,
  confirmationsAfterConfirm,
  confirmationsAfterSave,
  contactState,
  contactValuesOf,
  graceFor,
  graceState,
  maySendTo,
  normaliseContactValue,
  parseContactConfirmations,
  savedContactValues,
  withoutContactConfirmations,
  type ContactKind,
} from "../../lib/contact-confirmation";
import { CONTACT_CONFIRMATION_ENFORCED_AT_KEY, contactConfirmationsWrite } from "../../lib/contact-confirmation-store";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const AT = "2026-11-01T08:00:00.000Z";
const NOW = new Date("2026-11-15T10:00:00.000Z");
const DAY = 24 * 3600_000;
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

// ── Migration 0051 writes no data ───────────────────────────────────────
{
  const files = readdirSync(new URL("../../drizzle/", import.meta.url)).filter((f) => f.startsWith("0051"));
  assert.deepEqual(files, ["0051_contact_confirmations.sql"]);
  const m = src(`drizzle/${files[0]}`);
  assert.doesNotMatch(m, /\b(UPDATE|INSERT|DELETE)\b/i, "0051 has no UPDATE / INSERT / DELETE");
  assert.equal(m.trim(), `ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "contact_confirmations" jsonb DEFAULT '{}'::jsonb NOT NULL;`);
  // `by: "grandfathered"` is retired: nothing writes it, and it is not a valid `by`.
  for (const p of ["lib/contact-confirmation.ts", "lib/contact-confirmation-store.ts"]) {
    assert.doesNotMatch(src(p), /by:\s*"grandfathered"|"grandfathered",\s*"code"/, `${p}: no grandfathered by`);
  }
  assert.match(src("lib/contact-confirmation.ts"), /const BY: readonly ConfirmedBy\[\] = \["code", "admin"\];/);
}

// ── Enforcement is off in N1; one grace constant; one setting key ───────
assert.equal(CONTACT_CONFIRMATION_ENFORCED, false, "N1 ships with enforcement OFF");
assert.equal(CONTACT_CONFIRMATION_GRACE_DAYS, 14);
assert.equal(CONTACT_CONFIRMATION_ENFORCED_AT_KEY, "contact_confirmation_enforced_at");
assert.deepEqual([...CONTACT_KINDS], ["owner_whatsapp", "transfer_number", "owner_recap_email"]);
// Nothing in N1 writes the enforcement date.
for (const p of ["lib/contact-confirmation-store.ts", "app/api/dashboard/config/route.ts", "app/api/admin/configs/[userId]/route.ts"]) {
  assert.doesNotMatch(src(p), /setSetting/, `${p}: never writes the enforcement date`);
}

// ── maySendTo: every kind × every state ─────────────────────────────────
const GF = { state: "confirmed", source: "grandfathered" };
for (const kind of CONTACT_KINDS) {
  const v = VALUE[kind];
  const another = kind === "owner_whatsapp" ? "transfer_number" : "owner_whatsapp";
  const cases: Array<[string, unknown, unknown, Record<string, unknown>]> = [
    ["no record at all (existing account)", v, {}, GF],
    ["record of another kind only", v, { [another]: { value: v, state: "unconfirmed", at: AT } }, GF],
    ["confirmed by code", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "confirmed", source: "record", by: "code", at: AT }],
    ["confirmed by admin", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "admin" } }, { state: "confirmed", source: "record", by: "admin", at: AT }],
    ["saved by the new code, never confirmed", v, { [kind]: { value: v, state: "unconfirmed", at: AT } }, { state: "unconfirmed", reason: "not_confirmed", at: AT }],
    ["value changed since confirmation", OTHER[kind], { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "unconfirmed", reason: "value_changed" }],
    ["value changed since an unconfirmed save", OTHER[kind], { [kind]: { value: v, state: "unconfirmed", at: AT } }, { state: "unconfirmed", reason: "value_changed" }],
    ["no value", "", { [kind]: { value: v, state: "confirmed", at: AT, by: "code" } }, { state: "unconfirmed", reason: "no_value" }],
    ["no value, no record", "", {}, { state: "unconfirmed", reason: "no_value" }],
    ["malformed entry (retired by grandfathered)", v, { [kind]: { value: v, state: "confirmed", at: AT, by: "grandfathered" } }, { state: "unconfirmed", reason: "malformed" }],
    ["malformed entry (no at)", v, { [kind]: { value: v, state: "confirmed", by: "code" } }, { state: "unconfirmed", reason: "malformed" }],
    ["malformed entry (unknown state)", v, { [kind]: { value: v, state: "maybe", at: AT } }, { state: "unconfirmed", reason: "malformed" }],
    ["malformed entry (null)", v, { [kind]: null }, { state: "unconfirmed", reason: "malformed" }],
    ["malformed column (array)", v, [1, 2], { state: "unconfirmed", reason: "malformed" }],
    ["malformed column (string)", v, "confirmed", { state: "unconfirmed", reason: "malformed" }],
    ["column not selected (undefined)", v, undefined, { state: "unconfirmed", reason: "malformed" }],
    ["NULL column", v, null, { state: "unconfirmed", reason: "malformed" }],
  ];
  for (const [name, value, record, state] of cases) {
    assert.deepEqual(contactState(kind, value, record), state, `${kind} ${name}: state`);
    const grace = state.source === "grandfathered" ? "grandfathered" : "not_grandfathered";
    // Enforcement OFF (the default): always allowed, state still reported.
    assert.deepEqual(maySendTo(kind, value, record), { allowed: true, grace, ...state }, `${kind} ${name}: enforcement off → allowed`);
    // Even with an enforcement date in the past: still allowed while OFF.
    assert.equal(maySendTo(kind, value, record, { enforcementStartedAt: new Date(NOW.getTime() - 30 * DAY), now: NOW }).allowed, true);
    // N4 semantics, for the record: only a confirmed value passes.
    assert.equal(maySendTo(kind, value, record, { enforced: true, now: NOW }).allowed, state.state === "confirmed", `${kind} ${name}: enforced`);
  }
  // No-record values: confirmed AND allowed.
  assert.deepEqual(maySendTo(kind, v, {}), { allowed: true, grace: "grandfathered", state: "confirmed", source: "grandfathered" });
}

// ── graceState: one date, the day enforcement is switched on ────────────
{
  const start = new Date("2026-12-01T00:00:00.000Z");
  const at = (ms: number) => new Date(start.getTime() + ms);
  const table: Array<[string, unknown, Date | null, Date, string]> = [
    ["no record, enforcement not started", {}, null, NOW, "grandfathered"],
    ["no record, invalid date", {}, new Date("nope"), NOW, "grandfathered"],
    ["no record, start in the future", {}, start, at(-DAY), "grandfathered"],
    ["no record, day 0", {}, start, at(0), "grace"],
    ["no record, day 13 + 23 h", {}, start, at(14 * DAY - 3600_000), "grace"],
    ["no record, 1 ms before day 14", {}, start, at(14 * DAY - 1), "grace"],
    ["no record, exactly 14 days", {}, start, at(14 * DAY), "expired"],
    ["no record, day 30", {}, start, at(30 * DAY), "expired"],
    ["confirmed by code, day 30", { owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: AT, by: "code" } }, start, at(30 * DAY), "not_grandfathered"],
    ["unconfirmed record, day 0", { owner_whatsapp: { value: VALUE.owner_whatsapp, state: "unconfirmed", at: AT } }, start, at(0), "not_grandfathered"],
    ["value changed, not started", { owner_whatsapp: { value: OTHER.owner_whatsapp, state: "confirmed", at: AT, by: "code" } }, null, NOW, "not_grandfathered"],
    ["malformed entry, not started", { owner_whatsapp: "x" }, null, NOW, "not_grandfathered"],
  ];
  for (const [name, record, started, now, want] of table) {
    assert.equal(graceState("owner_whatsapp", VALUE.owner_whatsapp, record, started, now), want, `graceState: ${name}`);
  }
  assert.equal(graceState("owner_whatsapp", "", {}, start, at(30 * DAY)), "not_grandfathered", "no value: grace does not apply");
  assert.equal(graceFor({ state: "confirmed", source: "grandfathered" }, start, at(CONTACT_CONFIRMATION_GRACE_DAYS * DAY)), "expired", "the constant is the cut-off");
  // Enforced (N5 semantics): grace sends, expired stops; a confirmed record always sends.
  const enf = (record: unknown, now: Date) => maySendTo("owner_whatsapp", VALUE.owner_whatsapp, record, { enforced: true, enforcementStartedAt: start, now }).allowed;
  assert.equal(enf({}, at(DAY)), true, "grace: still sends");
  assert.equal(enf({}, at(14 * DAY)), false, "expired: stops");
  assert.equal(enf({ owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: AT, by: "code" } }, at(30 * DAY)), true);
  // Off: allowed even when expired.
  assert.equal(maySendTo("owner_whatsapp", VALUE.owner_whatsapp, {}, { enforcementStartedAt: start, now: at(30 * DAY) }).allowed, true);
  assert.equal(maySendTo("owner_whatsapp", VALUE.owner_whatsapp, {}, { enforcementStartedAt: start, now: at(30 * DAY) }).grace, "expired");
}

// The entry is bound to the NORMALISED value: formatting differences match.
assert.equal(contactState("owner_whatsapp", "+1 (555) 000-0001", { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
assert.equal(contactState("transfer_number", "15550000002", { transfer_number: { value: "+1 555 000 0002", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
assert.equal(contactState("owner_recap_email", "  Owner@Example.COM ", { owner_recap_email: { value: "owner@example.com", state: "confirmed", at: AT, by: "code" } }).state, "confirmed");
assert.equal(contactState("owner_whatsapp", "+15550000009", { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code" } }).state, "unconfirmed", "one digit is another value");
assert.equal(normaliseContactValue("owner_whatsapp", null), "");
assert.equal(normaliseContactValue("owner_whatsapp", " "), "");
assert.equal(normaliseContactValue("transfer_number", "+1.555.000.0002"), "+15550000002");
assert.deepEqual(
  parseContactConfirmations({
    owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code", extra: 1 },
    seller_phone: { value: "+15550000003", state: "confirmed", at: AT, by: "code" },
    owner_recap_email: { value: "", state: "unconfirmed", at: AT },
  }),
  { owner_whatsapp: { value: "+15550000001", state: "confirmed", at: AT, by: "code" } },
);

// ── The record after a save (values after, values before) ───────────────
const confirmed = {
  owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: AT, by: "code" },
  transfer_number: { value: VALUE.transfer_number, state: "confirmed", at: AT, by: "admin" },
  owner_recap_email: { value: VALUE.owner_recap_email, state: "confirmed", at: AT, by: "code" },
};
const unc = (value: string) => ({ value, state: "unconfirmed", at: NOW.toISOString() });
for (const kind of CONTACT_KINDS) {
  const same = kind === "owner_recap_email" ? " OWNER@example.com" : VALUE[kind].replace("+1", "+1 ");
  // Grandfathered (no record):
  //   the SAME value re-saved → no record written (still grandfathered);
  assert.equal(confirmationsAfterSave({}, { [kind]: same }, { [kind]: VALUE[kind] }, NOW), null, `${kind}: grandfathered + same value → kept`);
  //   a NEW value → an unconfirmed record for it;
  const changed = confirmationsAfterSave({}, { [kind]: OTHER[kind] }, { [kind]: VALUE[kind] }, NOW)!;
  assert.deepEqual(changed, { [kind]: unc(OTHER[kind]) }, `${kind}: grandfathered + new value → unconfirmed`);
  assert.deepEqual(contactState(kind, OTHER[kind], changed), { state: "unconfirmed", reason: "not_confirmed", at: NOW.toISOString() });
  //   cleared → nothing to write; a first value after '' → unconfirmed.
  assert.equal(confirmationsAfterSave({}, { [kind]: "" }, { [kind]: VALUE[kind] }, NOW), null, `${kind}: grandfathered + '' → nothing to write`);
  assert.deepEqual(confirmationsAfterSave({}, { [kind]: VALUE[kind] }, { [kind]: "" }, NOW), { [kind]: unc(VALUE[kind]) }, `${kind}: first value → unconfirmed`);
  // With a record:
  //   same value → kept; new → unconfirmed; '' → removed; omitted → kept.
  assert.equal(confirmationsAfterSave(confirmed, { [kind]: same }, { [kind]: VALUE[kind] }, NOW), null, `${kind}: same value → record kept`);
  assert.deepEqual(confirmationsAfterSave(confirmed, { [kind]: OTHER[kind] }, { [kind]: VALUE[kind] }, NOW), { ...confirmed, [kind]: unc(OTHER[kind]) });
  const { [kind]: _gone, ...rest } = confirmed;
  void _gone;
  assert.deepEqual(confirmationsAfterSave(confirmed, { [kind]: "" }, { [kind]: VALUE[kind] }, NOW), rest, `${kind}: '' → cleared`);
  assert.equal(confirmationsAfterSave(confirmed, {}, {}, NOW), null, `${kind}: omitted → kept`);
  assert.equal(confirmationsAfterSave({}, {}, {}, NOW), null, `${kind}: omitted, grandfathered → kept`);
  //   back to the old value after a change: unconfirmed (no history kept).
  assert.equal(contactState(kind, VALUE[kind], confirmationsAfterSave(changed, { [kind]: VALUE[kind] }, { [kind]: OTHER[kind] }, NOW)).state, "unconfirmed");
  //   a stale entry (value changed by a path that doesn't record) + re-save of the stored value → unconfirmed record for it.
  const stale = { [kind]: { value: VALUE[kind], state: "confirmed", at: AT, by: "code" } };
  assert.deepEqual(confirmationsAfterSave(stale, { [kind]: OTHER[kind] }, { [kind]: OTHER[kind] }, NOW), { [kind]: unc(OTHER[kind]) });
  //   a malformed entry + save → replaced by an unconfirmed one (never grandfathered).
  assert.deepEqual(confirmationsAfterSave({ [kind]: "x" }, { [kind]: VALUE[kind] }, { [kind]: VALUE[kind] }, NOW), { [kind]: unc(VALUE[kind]) });
}
// Other kinds' entries — including malformed ones — survive a save untouched.
assert.deepEqual(
  confirmationsAfterSave({ owner_whatsapp: "x", transfer_number: confirmed.transfer_number }, { owner_recap_email: OTHER.owner_recap_email }, { owner_recap_email: VALUE.owner_recap_email }, NOW),
  { owner_whatsapp: "x", transfer_number: confirmed.transfer_number, owner_recap_email: unc(OTHER.owner_recap_email) },
);
// A column that is not an object is left as it is (reads unconfirmed).
assert.equal(confirmationsAfterSave([1], { owner_whatsapp: OTHER.owner_whatsapp }, {}, NOW), null);

// Confirm (admin / code): bound to the normalised value; no code stored.
const conf = confirmationsAfterConfirm({ owner_whatsapp: unc(VALUE.owner_whatsapp) }, "owner_whatsapp", "+1 555 000 0001", "admin", NOW);
assert.deepEqual(conf, { owner_whatsapp: { value: VALUE.owner_whatsapp, state: "confirmed", at: NOW.toISOString(), by: "admin" } });
assert.ok(!/code"\s*:/.test(JSON.stringify(conf)), "no code field");
// Confirming a grandfathered value: it gets a record (by admin).
assert.equal((contactState("owner_whatsapp", VALUE.owner_whatsapp, confirmationsAfterConfirm({}, "owner_whatsapp", VALUE.owner_whatsapp, "admin", NOW)) as { source: string }).source, "record");

// ── Which kinds a write touches (route `updates` → values after) ────────
const row = { ownerWhatsapp: VALUE.owner_whatsapp, transferNumber: VALUE.transfer_number, transferNumberParked: null, ownerRecapEmail: VALUE.owner_recap_email };
assert.deepEqual(contactValuesOf(row), VALUE);
assert.equal(contactValuesOf({ ...row, transferNumber: "", transferNumberParked: VALUE.transfer_number }).transfer_number, VALUE.transfer_number, "parked = kept number");
assert.deepEqual(savedContactValues(row, { updatedAt: NOW, instructions: "x" } as never), {}, "a save of other fields touches no kind");
assert.deepEqual(savedContactValues(row, { ownerWhatsapp: undefined }), {}, "undefined = not written");
assert.deepEqual(savedContactValues(row, { ownerWhatsapp: OTHER.owner_whatsapp }), { owner_whatsapp: OTHER.owner_whatsapp });
assert.deepEqual(savedContactValues(row, { ownerRecapEmail: "" }), { owner_recap_email: "" });
assert.deepEqual(savedContactValues(row, { ownerRecapEmailEnabled: true } as never), {}, "the recap switch alone touches no kind");
const parked = { transferNumber: "", transferNumberParked: VALUE.transfer_number };
assert.deepEqual(savedContactValues(row, parked), { transfer_number: VALUE.transfer_number });
assert.deepEqual(savedContactValues(row, { transferNumber: "", transferNumberParked: null }), { transfer_number: "" });
assert.deepEqual(savedContactValues({ ...row, ...parked }, { transferNumber: "" }), { transfer_number: VALUE.transfer_number }, "legacy '' while parked keeps the kept number");

// contactConfirmationsWrite (the column write the routes add, or {}):
// grandfathered account ({}), the switch parking / restoring, same / new values.
const gRow = { ...row, contactConfirmations: {} };
assert.deepEqual(contactConfirmationsWrite(gRow, { instructions: "x" } as never, NOW), {});
assert.deepEqual(contactConfirmationsWrite(gRow, { ownerWhatsapp: VALUE.owner_whatsapp }, NOW), {}, "grandfathered + same value → no write");
assert.deepEqual(contactConfirmationsWrite(gRow, parked, NOW), {}, "switch OFF (park) → no write");
assert.deepEqual(contactConfirmationsWrite({ ...gRow, ...parked }, { transferNumber: VALUE.transfer_number, transferNumberParked: null }, NOW), {}, "switch ON (restore) → no write");
assert.deepEqual(contactConfirmationsWrite({ ...gRow, ...parked }, { transferNumber: "" }, NOW), {}, "legacy '' while parked → no write");
assert.ok("contactConfirmations" in contactConfirmationsWrite(gRow, { ownerWhatsapp: OTHER.owner_whatsapp }, NOW), "new value → written");
assert.ok("contactConfirmations" in contactConfirmationsWrite({ ownerRecapEmail: VALUE.owner_recap_email, contactConfirmations: {} }, { ownerRecapEmail: OTHER.owner_recap_email }, NOW), "email store shape");

// ── The record is never returned by the config routes ───────────────────
assert.deepEqual(withoutContactConfirmations({ a: 1, contactConfirmations: confirmed }), { a: 1 });
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
