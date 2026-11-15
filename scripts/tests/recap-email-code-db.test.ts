// Verified contacts N2 against a real Postgres (the "0052 writes no data"
// md5 proof runs before this, in scripts/recap-email-code-db.sh): the REAL
// wiring (lib/recap-email-code/deps.ts: table contact_confirmation_codes,
// the shared ledger, the N1 record) with only the session and the sender
// replaced, so nothing is ever sent.
//   1. send / confirm happy path, the N1 record { value, confirmed, at, by: "code" };
//   2. wrong ×5 → dead (also with parallel tries); expired; replaced by a new send;
//   3. a value change invalidates; the 4-case omission rule of the recap
//      address save (tenant + admin): omitted / same / changed / cleared;
//   4. limits: 3 per address per day (across accounts), 5 per account per
//      hour, the global hourly ceiling, each under concurrency;
//   5. admin ?asUserId scope; the real sender without a key (not_configured);
//   6. the code never in clear: the stored rows, every event, every
//      app_settings row, everything printed;
//   7. account deletion removes its code row.
// Mock data only (example.com). Run with:
//   npm run test:db -- --only recap-email-code   (see scripts/recap-email-code-db.sh)
// Runs only when RECAP_EMAIL_CODE_TEST_DB_URL points at a THROWAWAY, migrated,
// local database (it deletes users/events); otherwise it is skipped.

import assert from "node:assert/strict";

const url = process.env.RECAP_EMAIL_CODE_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED recap-email-code-db (set RECAP_EMAIL_CODE_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
for (const k of Object.keys(process.env)) if (/^(RESEND|EMAIL_|TWILIO|WHATSAPP|SMTP)/.test(k)) delete process.env[k];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`network refused in test: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

// Everything printed, to prove no code is ever logged.
const printed: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    printed.push(String(chunk));
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof stream.write;
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { resolveScopeUserId } = await import("../../lib/admin-impersonate");
  const { makeRecapEmailCodeDeps } = await import("../../lib/recap-email-code/deps");
  const { handleConfirmRecapEmailCode, handleSendRecapEmailCode } = await import("../../lib/recap-email-code/handler");
  const { RECAP_EMAIL_CODE_LIMITS, recapEmailConfirmationView } = await import("../../lib/recap-email-code/policy");
  const { loadContactForCode } = await import("../../lib/contact-code-store");
  const { saveOwnerRecapEmail } = await import("../../lib/owner-recap-email-store");
  type Deps = import("../../lib/recap-email-code/handler").RecapEmailCodeDeps;
  type Limits = import("../../lib/recap-email-code/policy").RecapEmailCodeLimits;

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const ADMIN = id(0xad);
  const addr = (n: number) => `tenant-${n}@example.com`;
  const KIND = "owner_recap_email";

  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
  await exec(sql`DELETE FROM users`); // cascades to agent_configs, contact_confirmation_codes
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@example.com', 'x', 'admin')`);
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_recap_email) VALUES (${ADMIN}, 'x', 'x', 'admin-recap@example.com')`);
  for (let n = 1; n <= 40; n++) {
    const locale = n === 13 ? "he" : n === 14 ? "en" : "fr";
    await exec(sql`INSERT INTO users (id, email, password_hash, role, locale) VALUES (${id(n)}, ${`login-${n}@example.com`}, 'x', 'user', ${locale})`);
    // Existing accounts: no record (grandfathered), a saved address.
    await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_recap_email) VALUES (${id(n)}, 'x', 'x', ${addr(n)})`);
  }
  const resetLedgers = () => exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:recap_email_code_%'`);
  const record = async (u: string) =>
    (await rows<{ c: Record<string, unknown> }>(sql`SELECT contact_confirmations AS c FROM agent_configs WHERE user_id = ${u}`))[0].c;
  const codeRow = async (u: string) =>
    (await rows<{ attempts: number; value_hash: string; code_hash: string; salt: string }>(
      sql`SELECT attempts, value_hash, code_hash, salt FROM contact_confirmation_codes WHERE user_id = ${u} AND kind = ${KIND}`,
    ))[0];

  // Every code that left the server (to the injected sender), for the scans.
  const allCodes: string[] = [];
  const sent: { to: string; code: string; locale?: string | null; user: string }[] = [];
  const depsFor = (session: string, limits: Limits = RECAP_EMAIL_CODE_LIMITS, over: Partial<Deps> = {}): Deps => {
    let scoped = session;
    const base = makeRecapEmailCodeDeps(limits);
    return {
      ...base,
      senderConfigured: () => true,
      resolveTarget: async (r) => {
        const s = await resolveScopeUserId({ sessionUserId: session, asUserId: r.nextUrl.searchParams.get("asUserId") });
        if ("forbidden" in s) return { forbidden: true as const };
        scoped = s.userId;
        return s;
      },
      send: async (to, o) => {
        sent.push({ to, code: o.code, locale: o.locale, user: scoped });
        allCodes.push(o.code);
        await new Promise((r) => setTimeout(r, 3));
        return { ok: true, id: `msg-${sent.length}` };
      },
      ...over,
    };
  };
  const call = async (kind: "code" | "confirm", deps: Deps, body?: unknown, query = "") => {
    const req = new NextRequest(`http://localhost/api/dashboard/notifications/email/${kind}${query}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await (kind === "code" ? handleSendRecapEmailCode : handleConfirmRecapEmailCode)(req, deps);
    return { status: res.status, json: (await res.json()) as Record<string, unknown>, retryAfter: res.headers.get("retry-after") };
  };
  const send = (session: string, opts: { query?: string; limits?: Limits; over?: Partial<Deps> } = {}) =>
    call("code", depsFor(session, opts.limits, opts.over), undefined, opts.query);
  const confirm = (session: string, code: unknown, query = "") => call("confirm", depsFor(session), { code }, query);
  const lastCode = (u: string) => [...sent].reverse().find((s) => s.user === u)!.code;
  const wrong = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

  // ── 1. Happy path ───────────────────────────────────────────────────────
  {
    const u = id(1);
    const before = (await rows<{ t: string }>(sql`SELECT updated_at::text AS t FROM agent_configs WHERE user_id = ${u}`))[0].t;
    assert.deepEqual(recapEmailConfirmationView((await loadContactForCode(u, KIND))!.value, await record(u)), { state: "confirmed" }, "grandfathered before");
    const r = await send(u);
    assert.deepEqual([r.status, r.json], [200, { ok: true, expiresInSec: 600 }]);
    assert.equal(sent.at(-1)!.to, addr(1));
    assert.equal(sent.at(-1)!.locale, "fr");
    const code = lastCode(u);
    assert.match(code, /^\d{6}$/);
    const row = await codeRow(u);
    assert.equal(row.attempts, 0);
    assert.match(row.code_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(row.code_hash, code);
    const ttl = (await rows<{ s: number }>(sql`SELECT extract(epoch from expires_at - created_at)::int AS s FROM contact_confirmation_codes WHERE user_id = ${u}`))[0].s;
    assert.equal(ttl, 600);
    assert.deepEqual((await confirm(u, wrong(code))).json, { error: "invalid_code" });
    assert.equal((await codeRow(u)).attempts, 1);
    const ok = await confirm(u, code);
    assert.equal(ok.status, 200);
    const at = (ok.json.recapEmailConfirmation as { at: string }).at;
    assert.deepEqual(ok.json, { ok: true, recapEmailConfirmation: { state: "confirmed", at } });
    assert.deepEqual((await record(u)).owner_recap_email, { value: addr(1), state: "confirmed", at, by: "code" });
    assert.equal(await codeRow(u), undefined, "a used code is deleted");
    assert.deepEqual((await confirm(u, code)).json, { error: "invalid_code" });
    const after = (await rows<{ t: string }>(sql`SELECT updated_at::text AS t FROM agent_configs WHERE user_id = ${u}`))[0].t;
    assert.equal(after, before, "updatedAt untouched: not a config change");
    assert.deepEqual(recapEmailConfirmationView((await loadContactForCode(u, KIND))!.value, await record(u)), { state: "confirmed", at });
    assert.deepEqual((await send(u)).json, { error: "already_confirmed" });
    console.log("happy path: ok");
  }

  // ── 2. Dead after 5 wrong tries; expired; replaced ─────────────────────
  {
    const u = id(2);
    await send(u);
    const code = lastCode(u);
    for (let i = 1; i < 5; i++) assert.deepEqual((await confirm(u, wrong(code))).json, { error: "invalid_code" });
    assert.deepEqual((await confirm(u, wrong(code))).json, { error: "too_many_attempts" });
    assert.deepEqual((await confirm(u, code)).json, { error: "too_many_attempts" }, "dead: even the right code");
    assert.equal((await codeRow(u)).attempts, 5);
    assert.equal((await record(u)).owner_recap_email, undefined, "nothing confirmed");

    // Parallel wrong tries: exactly 5 counted, then dead.
    const p = id(3);
    await send(p);
    const pc = lastCode(p);
    const burst = await Promise.all(Array.from({ length: 10 }, () => confirm(p, wrong(pc))));
    assert.equal(burst.filter((r) => r.json.error === "invalid_code").length, 4);
    assert.equal(burst.filter((r) => r.json.error === "too_many_attempts").length, 6);
    assert.equal((await codeRow(p)).attempts, 5);
    assert.deepEqual((await confirm(p, pc)).json, { error: "too_many_attempts" });

    // Expired (database clock): refused and removed.
    const e = id(4);
    await send(e);
    await exec(sql`UPDATE contact_confirmation_codes SET expires_at = now() - interval '1 second' WHERE user_id = ${e}`);
    assert.deepEqual((await confirm(e, lastCode(e))).json, { error: "code_expired" });
    assert.equal(await codeRow(e), undefined);
    assert.deepEqual((await confirm(e, lastCode(e))).json, { error: "invalid_code" });

    // Replaced: a new send makes the old code wrong; one live row.
    const r = id(5);
    await send(r);
    const first = lastCode(r);
    await send(r);
    const second = lastCode(r);
    if (second !== first) {
      assert.deepEqual((await confirm(r, first)).json, { error: "invalid_code" });
      assert.equal((await codeRow(r)).attempts, 1);
    }
    assert.equal((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM contact_confirmation_codes WHERE user_id = ${r}`))[0].n, 1);
    assert.equal((await confirm(r, second)).status, 200);
    console.log("dead / parallel tries / expired / replaced: ok");
  }

  // ── 3. Value change; the 4-case omission rule of the address save ───────
  {
    const sc = { senderConfigured: true };
    const asAdmin = async (u: string) => {
      const s = await resolveScopeUserId({ sessionUserId: ADMIN, asUserId: u });
      assert.ok(!("forbidden" in s));
      return s.userId;
    };
    for (const who of ["tenant", "admin"] as const) {
      const u = who === "tenant" ? id(6) : id(7);
      const target = who === "tenant" ? u : await asAdmin(u);
      // (1) Omitted: the switch alone → the code stays live, then confirms; a later omitted save keeps the record.
      await send(u);
      assert.equal((await saveOwnerRecapEmail(target, { ownerRecapEmailEnabled: true }, sc)).status, 200);
      assert.equal((await confirm(u, lastCode(u))).status, 200);
      const confirmed = (await record(u)).owner_recap_email;
      assert.equal((await saveOwnerRecapEmail(target, { ownerRecapEmailEnabled: false }, sc)).status, 200);
      assert.deepEqual((await record(u)).owner_recap_email, confirmed, `${who}: omitted keeps the record`);
      // (2) Same value (case / spaces): record kept.
      assert.equal((await saveOwnerRecapEmail(target, { ownerRecapEmail: ` ${addr(who === "tenant" ? 6 : 7).toUpperCase()} ` }, sc)).status, 200);
      assert.deepEqual((await record(u)).owner_recap_email, confirmed, `${who}: same value keeps the record`);
      // (3) Changed: unconfirmed, and a code sent to the old address is dead.
      const fresh = `changed-${who}@example.com`;
      await saveOwnerRecapEmail(target, { ownerRecapEmail: fresh }, sc);
      assert.equal(((await record(u)).owner_recap_email as { state: string }).state, "unconfirmed");
      await send(u);
      const toNew = lastCode(u);
      assert.equal(sent.at(-1)!.to, fresh, "the code goes to the NEW saved address");
      await saveOwnerRecapEmail(target, { ownerRecapEmail: `again-${who}@example.com` }, sc);
      assert.deepEqual((await confirm(u, toNew)).json, { error: "invalid_code" }, `${who}: a value change invalidates`);
      assert.equal(await codeRow(u), undefined, "the stale code is removed");
      assert.equal(((await record(u)).owner_recap_email as { state: string }).state, "unconfirmed");
      // (4) Cleared: nothing to send to, nothing to confirm.
      await send(u);
      await saveOwnerRecapEmail(target, { ownerRecapEmail: "" }, sc);
      assert.deepEqual([(await send(u)).status, (await send(u)).json], [409, { error: "no_saved_address" }]);
      assert.deepEqual((await confirm(u, lastCode(u))).json, { error: "no_saved_address" });
      assert.equal((await record(u)).owner_recap_email, undefined);
      assert.equal(recapEmailConfirmationView((await loadContactForCode(u, KIND))!.value, await record(u)), null);
    }
    console.log("value change + 4-case omission (tenant, admin): ok");
  }

  // ── 4. Limits ──────────────────────────────────────────────────────────
  {
    await resetLedgers();
    // 3 per address per day, across accounts.
    const a = id(8);
    for (let i = 0; i < 3; i++) assert.equal((await send(a)).status, 200);
    const fourth = await send(a);
    assert.deepEqual([fourth.status, fourth.json], [429, { error: "rate_limited", scope: "value" }]);
    assert.ok(Number(fourth.retryAfter) > 23 * 3600 && Number(fourth.retryAfter) <= 24 * 3600, `Retry-After ${fourth.retryAfter}`);
    await exec(sql`UPDATE agent_configs SET owner_recap_email = ${addr(8).toUpperCase()} WHERE user_id = ${id(9)}`);
    assert.deepEqual((await send(id(9))).json, { error: "rate_limited", scope: "value" }, "same address, other account");
    // The per-address ledger holds hashes, never the address.
    const ledgers = await rows<{ key: string; value: string }>(sql`SELECT key, value FROM app_settings WHERE key LIKE 'rate_limit:recap_email_code_%'`);
    assert.equal(ledgers.length, 2);
    for (const l of ledgers) assert.ok(!l.value.includes("@"), l.key);

    // 5 per account per hour (the address changes in between).
    await resetLedgers();
    const b = id(10);
    let n = 0;
    for (const v of ["b1", "b2"]) {
      await exec(sql`UPDATE agent_configs SET owner_recap_email = ${`${v}@example.com`} WHERE user_id = ${b}`);
      for (let i = 0; i < 3 && n < 5; i++, n++) assert.equal((await send(b)).status, 200);
    }
    await exec(sql`UPDATE agent_configs SET owner_recap_email = 'b3@example.com' WHERE user_id = ${b}`);
    const sixth = await send(b);
    assert.deepEqual([sixth.status, sixth.json], [429, { error: "rate_limited", scope: "account" }]);
    assert.ok(Number(sixth.retryAfter) > 0 && Number(sixth.retryAfter) <= 3600);

    // Concurrency, one address: 10 parallel → exactly 3 sent, one live code.
    await resetLedgers();
    const c = id(11);
    const before = sent.length;
    const burst = await Promise.all(Array.from({ length: 10 }, () => send(c)));
    assert.equal(burst.filter((r) => r.status === 200).length, 3);
    assert.equal(burst.filter((r) => r.status === 429).length, 7);
    assert.equal(sent.length - before, 3, "at most 3 emails under concurrency");
    const codes = sent.slice(before).map((s) => s.code);
    const tries = [];
    for (const code of codes) tries.push((await confirm(c, code)).status);
    assert.equal(tries.filter((s) => s === 200).length, 1, "exactly one live code");

    // Concurrency, one account (address limit lifted): exactly 5.
    await resetLedgers();
    const d = id(12);
    const before2 = sent.length;
    const lifted = { ...RECAP_EMAIL_CODE_LIMITS, perValueDaily: 100 };
    const burst2 = await Promise.all(Array.from({ length: 10 }, () => send(d, { limits: lifted })));
    assert.equal(burst2.filter((r) => r.status === 200).length, 5);
    assert.equal(burst2.filter((r) => r.json.scope === "account").length, 5);
    assert.equal(sent.length - before2, 5);

    // Concurrency, global hourly ceiling (7 here): 12 accounts × 2 in parallel → exactly 7.
    await resetLedgers();
    const before3 = sent.length;
    const ceiling = { ...RECAP_EMAIL_CODE_LIMITS, perValueDaily: 100, globalHourly: 7 };
    const many = await Promise.all(Array.from({ length: 24 }, (_, i) => send(id(20 + (i % 12)), { limits: ceiling })));
    assert.equal(many.filter((r) => r.status === 200).length, 7);
    assert.equal(many.filter((r) => r.json.scope === "global").length, 24 - 7);
    assert.equal(sent.length - before3, 7, "the global ceiling holds under concurrency");
    assert.deepEqual((await send(id(33), { limits: ceiling })).json, { error: "rate_limited", scope: "global" });
    // And the production ceiling is the one the real deps use.
    assert.equal(RECAP_EMAIL_CODE_LIMITS.globalHourly, 50);
    console.log("limits (value/day across accounts, account/hour, global, concurrency): ok");
  }

  // ── 5. Admin scope; the real sender without a key ──────────────────────
  {
    await resetLedgers();
    const t = id(13);
    const r = await send(ADMIN, { query: `?asUserId=${t}` });
    assert.equal(r.status, 200);
    assert.deepEqual([sent.at(-1)!.to, sent.at(-1)!.locale], [addr(13), "he"], "the tenant's address and language");
    assert.ok(await codeRow(t));
    assert.equal(await codeRow(ADMIN), undefined);
    assert.deepEqual((await send(id(14), { query: `?asUserId=${t}` })).json, { error: "forbidden" });
    assert.deepEqual((await confirm(id(14), lastCode(t), `?asUserId=${t}`)).json, { error: "forbidden" });
    assert.equal((await confirm(ADMIN, lastCode(t), `?asUserId=${t}`)).status, 200);
    assert.equal(((await record(t)).owner_recap_email as { by: string }).by, "code");
    assert.equal((await record(ADMIN)).owner_recap_email, undefined, "the admin's own record is untouched");

    // The real sender gate and the real sender function, no key: 503, nothing counted / live.
    const realGate = { over: { senderConfigured: makeRecapEmailCodeDeps().senderConfigured } };
    assert.deepEqual((await send(id(14), realGate)).json, { error: "not_configured" });
    assert.equal((await rows(sql`SELECT 1 FROM app_settings WHERE key = 'rate_limit:recap_email_code_account' AND value LIKE ${`%${id(14)}%`}`)).length, 0, "nothing counted");
    process.env.EMAIL_FROM = "Mock Sender <noreply@example.com>";
    try {
      const real = makeRecapEmailCodeDeps();
      const res = await send(id(14), {
        over: {
          send: real.send,
          generateCode: () => {
            const c = real.generateCode();
            allCodes.push(c);
            return c;
          },
        },
      });
      assert.deepEqual([res.status, res.json], [503, { error: "not_configured" }]);
      assert.equal(await codeRow(id(14)), undefined, "a code that was not sent is not live");
    } finally {
      delete process.env.EMAIL_FROM;
    }
    console.log("admin scope + real sender without a key: ok");
  }

  // ── 6. The code is never in clear ──────────────────────────────────────
  {
    assert.ok(allCodes.length > 30, `${allCodes.length} codes`);
    const stored = (await rows<{ t: string }>(sql`SELECT row_to_json(c)::text AS t FROM contact_confirmation_codes c`)).map((r) => r.t);
    const events = (await rows<{ t: string }>(sql`SELECT row_to_json(e)::text AS t FROM events e`)).map((r) => r.t);
    const settings = (await rows<{ t: string }>(sql`SELECT row_to_json(s)::text AS t FROM app_settings s`)).map((r) => r.t);
    assert.ok(stored.length > 0 && events.length > 0);
    const haystacks = { stored, events, settings, printed };
    for (const [name, list] of Object.entries(haystacks)) {
      for (const code of allCodes) {
        const hit = list.find((t) => t.includes(code));
        assert.equal(hit, undefined, `${name} carries a code in clear`);
      }
    }
    // No address in the code rows or the code events either.
    for (const t of [...stored, ...events.filter((e) => e.includes("recap_email_code") || e.includes("recap_email_confirmed"))]) {
      assert.doesNotMatch(t, /@example\.com/, t);
    }
    const kinds = new Set(events.map((e) => (JSON.parse(e) as { event: string }).event));
    for (const ev of ["recap_email_code_sent", "recap_email_confirmed", "recap_email_code_refused", "recap_email_code_not_configured"]) {
      assert.ok(kinds.has(ev), `event ${ev} logged`);
    }
    console.log(`no code in clear: ${allCodes.length} codes × ${stored.length + events.length + settings.length} rows + ${printed.length} printed lines`);
  }

  // ── 7. Account deletion removes its code ───────────────────────────────
  {
    const u = id(15);
    await send(u);
    assert.ok(await codeRow(u));
    await exec(sql`DELETE FROM users WHERE id = ${u}`);
    assert.equal(await codeRow(u), undefined);
  }

  console.log("ALL RECAP-EMAIL-CODE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
