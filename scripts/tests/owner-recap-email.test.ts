// Owner recap by email (lib/owner-recap-email*.ts): address validation, the
// save body → stored values (absent ≠ empty), default OFF, the rendered email
// (content, signature, no supplier name, RTL for Hebrew) and the best-effort
// send with the sender INJECTED (no email provider is ever reached).
// Mock data only (example.com, +1555, "Demo Salon").
// Run with:  npx tsx scripts/tests/owner-recap-email.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyOwnerRecapEmailWrite,
  ownerRecapEmailTarget,
  ownerRecapEmailWrite,
  parseRecapEmail,
  redactEmailError,
  renderOwnerRecapEmail,
  type RecapLocale,
  type RecapStrings,
} from "../../lib/owner-recap-email";
import { SUPPLIERS } from "../tenant-bundle-match.mjs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// The email's own list: the bundle guard's suppliers, plus the email provider
// (left out of the bundle guard only because "resend" is an English word).
const EMAIL_SUPPLIERS = [...(SUPPLIERS as string[]), "resend", "postgres", "neon", "vercel", "supabase"];
const SUPPLIER_RE = new RegExp(EMAIL_SUPPLIERS.map((s) => s.replace(/[-]/g, "\\-")).join("|"), "i");

/** next-intl-like `t` over messages/<locale>.json → Email.ownerRecap. */
const stringsFor = (locale: RecapLocale): RecapStrings => {
  const ns = (JSON.parse(read(`messages/${locale}.json`)) as { Email: { ownerRecap: Record<string, string> } }).Email.ownerRecap;
  return (key, vars) => {
    const s = ns[key];
    assert.ok(typeof s === "string", `${locale}: Email.ownerRecap.${key} exists`);
    return s.replace(/\{(\w+)\}/g, (_, k: string) => vars?.[k] ?? `{${k}}`);
  };
};

async function main() {
  // ── 0. Migration: idempotent, defaults OFF / '', sorts last ──────────
  assert.equal(
    read("drizzle/0050_owner_recap_email.sql").trim(),
    `ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "owner_recap_email" text DEFAULT '' NOT NULL;--> statement-breakpoint\nALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "owner_recap_email_enabled" boolean DEFAULT false NOT NULL;`,
  );
  {
    const j = (JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ when: number; tag: string }> }).entries;
    const mine = j.findIndex((e) => e.tag === "0050_owner_recap_email");
    assert.ok(mine >= 0, "journal entry present");
    for (const e of j.slice(0, mine)) assert.ok(e.when < j[mine].when, `journal: ${e.tag} sorts before 0050`);
  }

  // ── 1. Address validation + normalisation ─────────────────────────────
  assert.deepEqual(parseRecapEmail("  Owner@Example.COM "), { ok: true, value: "owner@example.com" });
  assert.deepEqual(parseRecapEmail(""), { ok: true, value: "" }, "'' clears");
  assert.deepEqual(parseRecapEmail("   "), { ok: true, value: "" }, "blank clears");
  assert.deepEqual(parseRecapEmail(null), { ok: true, value: "" }, "null clears");
  for (const bad of ["owner", "owner@", "@example.com", "owner@example", "a b@example.com", "owner@@example.com", 42, true, {}]) {
    assert.equal(parseRecapEmail(bad).ok, false, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(parseRecapEmail(`${"a".repeat(250)}@example.com`).ok, false, "rejects > 254 chars");

  // 400 naming the field.
  assert.deepEqual(ownerRecapEmailWrite({ ownerRecapEmail: "not-an-address" }), {
    ok: false,
    status: 400,
    body: { error: "invalid_email", fields: ["ownerRecapEmail"] },
  });
  assert.deepEqual(ownerRecapEmailWrite({ ownerRecapEmailEnabled: "yes" }), {
    ok: false,
    status: 400,
    body: { error: "invalid_boolean", fields: ["ownerRecapEmailEnabled"] },
  });
  assert.deepEqual(ownerRecapEmailWrite({ ownerRecapEmail: " Owner@Example.com ", ownerRecapEmailEnabled: true }), {
    ok: true,
    updates: { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true },
  });

  // ── 2. Absent ≠ empty, both fields (nothing is admin-only: the tenant and
  //       an admin via ?asUserId go through this same helper) ─────────────
  const stored = { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true };
  const after = (body: unknown) => {
    const w = ownerRecapEmailWrite(body);
    assert.ok(w.ok);
    return applyOwnerRecapEmailWrite(stored, w.updates);
  };
  assert.deepEqual(after({}), stored, "empty body keeps both");
  assert.deepEqual(after({ unrelated: 1 }), stored, "other fields only keep both");
  assert.deepEqual(after({ ownerRecapEmailEnabled: false }), { ...stored, ownerRecapEmailEnabled: false }, "absent address kept");
  assert.deepEqual(after({ ownerRecapEmail: "new@example.com" }), { ...stored, ownerRecapEmail: "new@example.com" }, "absent switch kept");
  assert.deepEqual(after({ ownerRecapEmail: "" }), { ...stored, ownerRecapEmail: "" }, "'' is an intended clear");
  assert.deepEqual(after({ ownerRecapEmail: null }), { ...stored, ownerRecapEmail: "" }, "null is an intended clear");
  assert.deepEqual(after(stored), stored, "unchanged re-send");
  for (const junk of [null, undefined, "x", [1]]) assert.deepEqual(after(junk), stored, `non-object body ${JSON.stringify(junk)} keeps both`);

  // ── 3. Default OFF: the target needs BOTH ─────────────────────────────
  assert.equal(ownerRecapEmailTarget({}), null, "existing account (defaults)");
  assert.equal(ownerRecapEmailTarget({ ownerRecapEmail: "", ownerRecapEmailEnabled: false }), null);
  assert.equal(ownerRecapEmailTarget({ ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: false }), null, "address but OFF");
  assert.equal(ownerRecapEmailTarget({ ownerRecapEmail: "", ownerRecapEmailEnabled: true }), null, "ON but no address");
  assert.equal(ownerRecapEmailTarget({ ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true }), "owner@example.com");

  // ── 4. Rendering ──────────────────────────────────────────────────────
  const forOwner = {
    fr: "Prénom : Dana\nMotif : coupe\nRDV : mardi 10:00",
    en: "Name: Dana\nReason: haircut\nBooking: Tuesday 10:00",
    he: "שם: דנה\nסיבה: תספורת\nתור: יום שלישי 10:00",
  } as const;
  for (const locale of ["fr", "en", "he"] as const) {
    const t = stringsFor(locale);
    const signed = renderOwnerRecapEmail({ locale, forOwner: forOwner[locale], fromNumber: "+15550100001", businessName: "Demo Salon" }, t);
    assert.ok(signed.subject.length > 0);
    assert.ok(signed.text.includes(forOwner[locale]), `${locale}: text carries the owner recap`);
    assert.ok(signed.text.includes("+15550100001"), `${locale}: text carries the caller`);
    assert.ok(signed.text.trimEnd().endsWith("— Demo Salon"), `${locale}: text signed with the tenant's own name`);
    assert.ok(signed.html.includes("— Demo Salon"), `${locale}: html signed`);
    for (const line of forOwner[locale].split("\n")) assert.ok(signed.html.includes(line), `${locale}: html carries "${line}"`);
    for (const [part, s] of Object.entries(signed)) {
      assert.doesNotMatch(s, SUPPLIER_RE, `${locale}: ${part} names no supplier`);
    }
    assert.match(signed.html, new RegExp(`<div dir="${locale === "he" ? "rtl" : "ltr"}"`), `${locale}: html direction`);

    const unsigned = renderOwnerRecapEmail({ locale, forOwner: forOwner[locale], fromNumber: "", businessName: "" }, t);
    assert.ok(!unsigned.text.includes("— "), `${locale}: unsigned when the tenant has no name`);
    assert.ok(!unsigned.html.includes("— "), `${locale}: html unsigned`);
    assert.ok(unsigned.text.includes(t("unknownNumber")), `${locale}: unknown caller`);
  }
  // Hebrew: RTL root, the number isolated LTR (text: LRI…PDI, html: dir=ltr).
  const he = renderOwnerRecapEmail({ locale: "he", forOwner: forOwner.he, fromNumber: "+15550100001", businessName: "Demo Salon" }, stringsFor("he"));
  assert.ok(he.html.startsWith('<div dir="rtl" lang="he"'), "he: rtl root");
  assert.ok(he.html.includes('<span dir="ltr" style="unicode-bidi:isolate;">+15550100001</span>'), "he: number isolated LTR");
  assert.ok(he.text.includes("⁦+15550100001⁩"), "he: text number isolated LTR");
  // Summary text is escaped (it comes from a model).
  const esc = renderOwnerRecapEmail({ locale: "en", forOwner: "<script>x</script> & co", fromNumber: "+15550100001", businessName: "Demo <b>Salon</b>" }, stringsFor("en"));
  assert.ok(!esc.html.includes("<script>") && esc.html.includes("&lt;script&gt;") && esc.html.includes("Demo &lt;b&gt;Salon&lt;/b&gt;"), "html escaped");

  // The sender itself: from-name and the recap send path name no supplier.
  const emailSrc = read("lib/email.ts");
  const fromDefault = /const FROM_DEFAULT = "([^"]*)"/.exec(emailSrc)?.[1] ?? "";
  const displayName = fromDefault.replace(/<[^>]*>/, "").trim();
  assert.ok(displayName.length > 0, "default from has a display name");
  assert.doesNotMatch(displayName, SUPPLIER_RE, "default from display name names no supplier");
  const recapFn = emailSrc.slice(emailSrc.indexOf("export async function sendOwnerRecapEmail"), emailSrc.indexOf("export async function sendAdminAlertEmail"));
  assert.ok(recapFn.length > 0);
  assert.doesNotMatch(recapFn.replace(/\/\/.*$/gm, "").replace(/getResend|client\.emails/g, ""), /resend/i, "recap send path: no supplier in its strings");
  for (const locale of ["fr", "en", "he"]) {
    const ns = (JSON.parse(read(`messages/${locale}.json`)) as { Email: { ownerRecap: unknown } }).Email.ownerRecap;
    assert.doesNotMatch(JSON.stringify(ns), SUPPLIER_RE, `${locale}: Email.ownerRecap names no supplier`);
  }

  assert.equal(redactEmailError("Invalid `to` field: owner@example.com rejected"), "Invalid `to` field: [redacted] rejected");

  // ── 5. Best-effort send, sender injected ──────────────────────────────
  // No email provider key may be in this process: nothing can leave.
  delete process.env.RESEND_API_KEY;
  const { ownerRecapEmailDeps, sendOwnerRecapEmailBestEffort } = await import("../../lib/owner-recap-email-send");
  type SendArgs = Parameters<typeof ownerRecapEmailDeps.send>;
  type LogArg = Parameters<typeof ownerRecapEmailDeps.log>[0];
  let sends: SendArgs[] = [];
  let logs: LogArg[] = [];
  let recentQueries = 0;
  let recent = false;
  let sendImpl: (...a: SendArgs) => ReturnType<typeof ownerRecapEmailDeps.send> = async () => ({ ok: true, id: "mock-id-1" });
  ownerRecapEmailDeps.send = async (...a) => {
    sends.push(a);
    return sendImpl(...a);
  };
  ownerRecapEmailDeps.log = async (ev) => {
    logs.push(ev);
  };
  ownerRecapEmailDeps.recentSent = async () => {
    recentQueries++;
    return recent;
  };
  const reset = () => {
    sends = [];
    logs = [];
    recentQueries = 0;
    recent = false;
    sendImpl = async () => ({ ok: true, id: "mock-id-1" });
  };
  const business = { identity: { name: "Demo Salon" } };
  const base = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    callId: "10000000-0000-4000-8000-000000000001",
    forOwner: forOwner.en,
    fromNumber: "+15550100001",
    recapFeatureOn: true,
    transcriptEntries: 4,
  };

  // OFF / empty → never called, no query, no event.
  for (const cfg of [
    {},
    { ownerRecapEmail: "", ownerRecapEmailEnabled: false },
    { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: false },
    { ownerRecapEmail: "", ownerRecapEmailEnabled: true },
  ]) {
    reset();
    assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: { ...cfg, business, primaryLanguage: "en" } }), "off");
    assert.equal(sends.length, 0, `off ${JSON.stringify(cfg)}: sender never called`);
    assert.equal(recentQueries, 0, "off: not even a query");
    assert.equal(logs.length, 0, "off: no event");
  }

  const on = { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true, business, primaryLanguage: "en" };

  // Same conditions as the WhatsApp recap.
  reset();
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on, transcriptEntries: 1 }), "transcript_too_short");
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on, transcriptEntries: 0 }), "transcript_too_short");
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on, recapFeatureOn: false }), "feature_off");
  recent = true;
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on }), "dedup_recent_owner_email");
  assert.equal(sends.length, 0, "skips: sender never called");

  // ON → called once, with the recap content + the tenant's signature.
  reset();
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on }), "sent");
  assert.equal(sends.length, 1, "on: called once");
  assert.deepEqual(sends[0], ["owner@example.com", { forOwner: forOwner.en, fromNumber: "+15550100001", businessName: "Demo Salon", locale: "en" }]);
  const sentRender = renderOwnerRecapEmail({ ...sends[0][1], locale: "en" }, stringsFor("en"));
  assert.ok(sentRender.text.includes(forOwner.en) && sentRender.text.trimEnd().endsWith("— Demo Salon"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "email_sent_owner");
  assert.deepEqual(logs[0].metadata, { callId: base.callId, id: "mock-id-1" });

  // No business name → unsigned.
  reset();
  await sendOwnerRecapEmailBestEffort({ ...base, cfg: { ...on, business: {} } });
  assert.equal(sends[0][1].businessName, "", "no name → unsigned");

  // Sender failure (returned or thrown) → resolves, one error event, no
  // address and no body in the event.
  for (const fail of [
    async () => ({ ok: false, error: "validation_error: owner@example.com is not allowed" }),
    async () => {
      throw new Error("socket hang up for owner@example.com");
    },
  ] as const) {
    reset();
    sendImpl = fail as typeof sendImpl;
    assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on }), "failed");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].event, "email_failed_owner");
    assert.equal(logs[0].level, "error");
    const dump = JSON.stringify(logs[0]);
    assert.ok(!dump.includes("owner@example.com"), "no recipient address in the event");
    assert.ok(!dump.includes("haircut") && !dump.includes("Dana"), "no recap body in the event");
  }
  // Even a throwing logger can't reject.
  reset();
  sendImpl = async () => ({ ok: false, error: "x" });
  ownerRecapEmailDeps.log = async () => {
    throw new Error("db down");
  };
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: on }), "failed");

  console.log("ALL OWNER-RECAP-EMAIL TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
