// Concurrency tests for the admin alert ledger claim (lib/alert-ledger.ts,
// lib/alerts.ts). They need a THROWAWAY Postgres, so in a plain `npm test`
// they skip. Run them with:
//   bash scripts/alert-ledger-claim-db.sh
// which starts a local Postgres on 127.0.0.1:55436, migrates it, and sets
// ALERT_LEDGER_TEST_DATABASE_URL. Only a 127.0.0.1/localhost URL is accepted,
// and DATABASE_URL is never read: this can't touch a real database.
// Email/WhatsApp senders are injected mocks — nothing is ever sent.

import assert from "node:assert/strict";

const url = process.env.ALERT_LEDGER_TEST_DATABASE_URL;
if (!url) {
  console.log("skip: alert-ledger-claim (no ALERT_LEDGER_TEST_DATABASE_URL — see scripts/alert-ledger-claim-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`refusing to run against non-local database host ${host}`);
}
process.env.DATABASE_URL = url;
// Belt and braces: no real provider credentials in this process.
for (const k of Object.keys(process.env)) {
  if (/^(RESEND|TWILIO|WHATSAPP|ADMIN_ALERT)/.test(k)) delete process.env[k];
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { alertAdmins } = await import("../../lib/alerts");
  const { LEDGER_SETTING } = await import("../../lib/alert-ledger");
  const { getSetting, setSetting } = await import("../../lib/settings");
  const { recordAlert, shouldSendAlert } = await import("../../lib/alert-dedup");

  const H = 3_600_000;
  const KEEP = 7 * 24 * H;
  const T0 = 1_800_000_000_000;

  let sends = 0;
  const mockDeps = (now: number) => ({
    emailRecipients: async () => ["admin@example.test"],
    whatsappRecipients: async () => [],
    sendEmail: async () => {
      sends++;
      return { ok: true };
    },
    sendWhatsApp: async () => false,
    now: () => now,
  });
  const fire = (key: string, now: number) =>
    alertAdmins({ key, subject: "mock alert", body: "mock body", dedupMs: H }, mockDeps(now));

  const resetLedger = () => db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
  const ledger = async () => JSON.parse((await getSetting(LEDGER_SETTING)) ?? "{}") as Record<string, number>;

  /** The pre-fix logic (origin/main lib/alerts.ts): read → check → write. */
  async function legacyAlert(key: string, now: number): Promise<boolean> {
    const raw = await getSetting(LEDGER_SETTING);
    const l = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    if (!shouldSendAlert(l, key, now, H)) return false;
    await setSetting(LEDGER_SETTING, JSON.stringify(recordAlert(l, key, now, KEEP)));
    sends++;
    return true;
  }

  async function test(name: string, fn: () => Promise<void>) {
    await resetLedger();
    sends = 0;
    await fn();
    console.log(`ok   ${name}`);
  }

  let legacySameKey = -1;
  let legacyLostKeys = -1;

  await test("baseline: the pre-fix logic sends more than once under 20 parallel calls", async () => {
    await Promise.all(Array.from({ length: 20 }, () => legacyAlert("same", T0)));
    legacySameKey = sends;
    // Record the count rather than assert it strictly: the race is timing-based.
    console.log(`     pre-fix logic: ${sends} sends for 20 parallel calls, same key`);
  });

  await test("baseline: the pre-fix logic can lose a key under parallel calls", async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    await Promise.all(keys.map((k) => legacyAlert(k, T0)));
    legacyLostKeys = keys.length - Object.keys(await ledger()).length;
    console.log(`     pre-fix logic: ${legacyLostKeys} of 10 keys lost from the ledger`);
  });

  await test("20 parallel calls with the same key send exactly once", async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => fire("same", T0)));
    assert.equal(sends, 1);
    assert.equal(r.filter(Boolean).length, 1);
    assert.deepEqual(await ledger(), { same: T0 });
  });

  await test("20 parallel calls with the same key on an empty table (no row yet) send once", async () => {
    // resetLedger removed the row: the first claim is the INSERT path.
    await Promise.all(Array.from({ length: 20 }, () => fire("fresh", T0)));
    assert.equal(sends, 1);
  });

  await test("2 parallel calls with different keys both send and both keys stay", async () => {
    await fire("seed", T0); // the row exists, so both go through ON CONFLICT
    sends = 0;
    await Promise.all([fire("a", T0 + 1), fire("b", T0 + 1)]);
    assert.equal(sends, 2);
    const l = await ledger();
    assert.equal(l.a, T0 + 1);
    assert.equal(l.b, T0 + 1);
    assert.equal(l.seed, T0);
  });

  await test("10 parallel calls with 10 different keys: 10 sends, none lost", async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    await Promise.all(keys.map((k) => fire(k, T0)));
    assert.equal(sends, 10);
    assert.deepEqual(Object.keys(await ledger()).sort(), keys.sort());
  });

  await test("a call within dedupMs is dropped, a call after dedupMs sends again", async () => {
    assert.equal(await fire("x", T0), true);
    assert.equal(await fire("x", T0 + H - 1), false);
    assert.equal(await fire("x", T0 + H), true);
    assert.equal(sends, 2);
    assert.equal((await ledger()).x, T0 + H);
  });

  await test("after dedupMs, 20 parallel calls again send exactly once", async () => {
    await fire("y", T0);
    await Promise.all(Array.from({ length: 20 }, () => fire("y", T0 + 2 * H)));
    assert.equal(sends, 2);
  });

  await test("entries older than LEDGER_KEEP_MS and non-numeric ones are pruned on a claim", async () => {
    await setSetting(LEDGER_SETTING, JSON.stringify({ old: T0 - KEEP, recent: T0 - H, junk: "x" }));
    await fire("new", T0);
    assert.deepEqual(await ledger(), { recent: T0 - H, new: T0 });
  });

  await test("a non-numeric entry for the key itself counts as never sent", async () => {
    await setSetting(LEDGER_SETTING, JSON.stringify({ z: "not a number" }));
    assert.equal(await fire("z", T0), true);
  });

  await test("a corrupt (non-JSON) ledger is reset and the alert sends once", async () => {
    await setSetting(LEDGER_SETTING, "{not json");
    const r = await Promise.all(Array.from({ length: 5 }, () => fire("c", T0)));
    assert.equal(r.filter(Boolean).length, 1);
    assert.deepEqual(await ledger(), { c: T0 });
  });

  await test("a JSON non-object ledger is treated as empty", async () => {
    await setSetting(LEDGER_SETTING, "[1,2]");
    assert.equal(await fire("arr", T0), true);
    assert.deepEqual(await ledger(), { arr: T0 });
  });

  await resetLedger();
  console.log(`summary: pre-fix ${legacySameKey} sends / 20 same-key calls, ${legacyLostKeys}/10 keys lost; fixed: 1 send, 0 lost`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
