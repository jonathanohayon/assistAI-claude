// Verified contacts N2: the owner recap email confirmation code, without a
// database (lib/contact-code.ts, lib/recap-email-code/*, the email renderer).
// Every I/O is injected: nothing is ever sent. The real table, ledger and
// concurrency: scripts/tests/recap-email-code-db.test.ts.
// Mock data only (example.com).
// Run with:  npx tsx scripts/tests/recap-email-code.test.ts

import assert from "node:assert/strict";
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";

import type { ContactKind } from "../../lib/contact-confirmation";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  decideConfirm,
  generateCode,
  generateSalt,
  hashCode,
  parseCodeInput,
  valueKey,
  type StoredCode,
} from "../../lib/contact-code";
import type { ConfirmCodeResult } from "../../lib/contact-code-store";
import { renderContactCodeEmail, type CodeEmailKey } from "../../lib/contact-code-email";
import type { LogEvent } from "../../lib/logger";
import {
  handleConfirmRecapEmailCode,
  handleSendRecapEmailCode,
  type CodeClaim,
  type CodeSendResult,
  type RecapEmailCodeDeps,
} from "../../lib/recap-email-code/handler";
import { RECAP_EMAIL_CODE_ERRORS, recapEmailConfirmationView } from "../../lib/recap-email-code/policy";
import { setKeyProblemReporter } from "../../lib/crypto/secret-box";
import { PATTERN } from "../tenant-bundle-match.mjs";

// No real admin alert from a unit test; and no key from the environment.
setKeyProblemReporter(() => {});
for (const v of ["SECRETS_KEY", "SECRETS_KEY_ID", "SECRETS_KEY_PREVIOUS", "SECRETS_KEY_PREVIOUS_ID", "CONTACT_CODE_HASH_KEY"]) delete process.env[v];
// Mock master key only (32 bytes of 0x5a), never a real one.
const MOCK_MASTER = Buffer.alloc(32, 0x5a);
const MOCK_ENV = { SECRETS_KEY: MOCK_MASTER.toString("base64"), SECRETS_KEY_ID: "mock" };
const setMasterKey = (on: boolean) => {
  for (const [k, v] of Object.entries(MOCK_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const LEAK = /resend|[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|FROM|SECRET|TOKEN|URL)\b/;
const TENANT = "00000000-0000-4000-8000-0000000000a1";
const KIND: ContactKind = "owner_recap_email";
const ADDRESS = "recap@example.com";

// ── The code ────────────────────────────────────────────────────────────
{
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = generateCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 1990, "codes are random");
  assert.notEqual(generateSalt(), generateSalt());
  assert.match(generateSalt(), /^[0-9a-f]{32}$/);
  assert.equal(parseCodeInput("123456"), "123456");
  assert.equal(parseCodeInput(" 123 456 "), "123456");
  for (const bad of ["12345", "1234567", "12a456", "", null, 123456, undefined, {}]) assert.equal(parseCodeInput(bad), null);
  assert.equal(CODE_TTL_MS, 600_000);
  assert.equal(MAX_ATTEMPTS, 5);
}

// The hash is bound to the account, the kind, the (normalised) value and the salt; never the code itself.
{
  const base = { userId: TENANT, kind: KIND, value: ADDRESS, salt: "aa", code: "123456" };
  const h = hashCode(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("123456"));
  assert.equal(hashCode({ ...base, value: " RECAP@example.com " }), h, "normalised value");
  for (const other of [
    { ...base, userId: "00000000-0000-4000-8000-0000000000b2" },
    { ...base, kind: "owner_whatsapp" as ContactKind },
    { ...base, value: "other@example.com" },
    { ...base, salt: "ab" },
    { ...base, code: "123457" },
  ]) {
    assert.notEqual(hashCode(other), h);
  }
  // No key: byte for byte N2's salted sha256 (frozen copy of the pre-pepper hashCode).
  const n2 = (i: typeof base) =>
    createHash("sha256")
      .update(["contact-code:v1", i.userId, i.kind, i.value.trim().toLowerCase(), i.salt, i.code].join("\u0000"), "utf8")
      .digest("hex");
  assert.equal(h, n2(base), "no key: N2's salted sha256");
  // A key: HMAC-SHA256 over the same material, under HKDF(SECRETS_KEY, info "contact-code-hash").
  setMasterKey(true);
  try {
    const pepper = Buffer.from(hkdfSync("sha256", MOCK_MASTER, Buffer.alloc(0), "contact-code-hash", 32));
    const material = ["contact-code:v1", TENANT, KIND, ADDRESS, "aa", "123456"].join("\u0000");
    assert.equal(hashCode(base), createHmac("sha256", pepper).update(material, "utf8").digest("hex"), "key: HMAC of the same material");
    assert.notEqual(hashCode(base), h, "key: differs from the unkeyed hash");
    assert.match(hashCode(base), /^[0-9a-f]{64}$/);
  } finally {
    setMasterKey(false);
  }
  assert.equal(valueKey(KIND, " Recap@Example.com "), valueKey(KIND, ADDRESS));
  assert.match(valueKey(KIND, ADDRESS), /^[0-9a-f]{64}$/);
}

// decideConfirm: every branch.
{
  const salt = "5a17";
  const row = (over: Partial<StoredCode> = {}): StoredCode => ({
    valueHash: valueKey(KIND, ADDRESS),
    salt,
    codeHash: hashCode({ userId: TENANT, kind: KIND, value: ADDRESS, salt, code: "424242" }),
    attempts: 0,
    expired: false,
    ...over,
  });
  const input = (code: string, currentValue = ADDRESS) => ({ userId: TENANT, kind: KIND, currentValue, code });
  assert.deepEqual(decideConfirm(row(), input("424242")), { outcome: "confirmed" });
  assert.deepEqual(decideConfirm(row(), input("424242", " RECAP@Example.com")), { outcome: "confirmed" });
  assert.deepEqual(decideConfirm(null, input("424242")), { outcome: "refused", error: "invalid_code", write: "none" });
  assert.deepEqual(decideConfirm(row(), input("424242", "new@example.com")), { outcome: "refused", error: "invalid_code", write: "delete" }, "value changed");
  assert.deepEqual(decideConfirm(row({ expired: true }), input("424242")), { outcome: "refused", error: "code_expired", write: "delete" });
  assert.deepEqual(decideConfirm(row(), input("000000")), { outcome: "refused", error: "invalid_code", write: { attempts: 1 } });
  assert.deepEqual(decideConfirm(row({ attempts: 3 }), input("000000")), { outcome: "refused", error: "invalid_code", write: { attempts: 4 } });
  assert.deepEqual(decideConfirm(row({ attempts: 4 }), input("000000")), { outcome: "refused", error: "too_many_attempts", write: { attempts: 5 } });
  // Dead: even the right code is refused.
  assert.deepEqual(decideConfirm(row({ attempts: 5 }), input("424242")), { outcome: "refused", error: "too_many_attempts", write: "none" });
  assert.deepEqual(decideConfirm(row({ attempts: 5, expired: true }), input("424242")), { outcome: "refused", error: "too_many_attempts", write: "none" });
}

// ── The dashboard view of the saved address ─────────────────────────────
{
  const at = "2026-11-15T10:00:00.000Z";
  assert.equal(recapEmailConfirmationView("", {}), null);
  assert.deepEqual(recapEmailConfirmationView(ADDRESS, {}), { state: "confirmed" }, "grandfathered");
  assert.deepEqual(
    recapEmailConfirmationView(ADDRESS, { owner_recap_email: { value: ADDRESS, state: "confirmed", at, by: "code" } }),
    { state: "confirmed", at },
  );
  assert.deepEqual(
    recapEmailConfirmationView(ADDRESS, { owner_recap_email: { value: ADDRESS, state: "unconfirmed", at } }),
    { state: "unconfirmed", at },
  );
  assert.deepEqual(
    recapEmailConfirmationView("new@example.com", { owner_recap_email: { value: ADDRESS, state: "confirmed", at, by: "code" } }),
    { state: "unconfirmed" },
    "value changed",
  );
}

// ── The email ───────────────────────────────────────────────────────────
{
  const messages = (loc: string) => JSON.parse(readFileSync(`messages/${loc}.json`, "utf8")).Email.contactCode as Record<CodeEmailKey, string>;
  const keys: CodeEmailKey[] = ["subject", "heading", "intro", "expires", "ignore"];
  for (const locale of ["fr", "en", "he"] as const) {
    const m = messages(locale);
    assert.deepEqual(Object.keys(m).sort(), [...keys].sort(), `${locale} keys`);
    const mail = renderContactCodeEmail({ locale, code: "731946" }, (k) => m[k]);
    assert.ok(mail.text.includes("731946") && mail.html.includes("731946"), `${locale} carries the code`);
    assert.ok(!mail.subject.includes("731946"), "the subject carries no code");
    for (const part of [mail.subject, mail.text, mail.html]) {
      assert.doesNotMatch(part, SUPPLIER, `${locale} names a supplier`);
      assert.doesNotMatch(part, /resend/i, `${locale} names the email supplier`);
      assert.doesNotMatch(part, /tamara/i, `${locale} stays neutral`);
    }
    assert.match(mail.html, locale === "he" ? /dir="rtl"/ : /dir="ltr"/);
    assert.match(m.expires, /10/);
  }
}

// ── The handlers (fakes for every I/O) ──────────────────────────────────
type Account = { value: string; record: unknown; locale: string | null };

function makeWorld(opts: {
  session?: string | null;
  account?: Account | null;
  senderConfigured?: boolean;
  claim?: CodeClaim | Error;
  sendResult?: CodeSendResult | Error;
}) {
  const account = opts.account === undefined ? { value: ADDRESS, record: {}, locale: "he" } : opts.account;
  const rows = new Map<string, StoredCode & { code?: never }>();
  const sent: { to: string; code: string; locale?: string | null }[] = [];
  const logs: LogEvent[] = [];
  const calls = { claim: 0, confirm: 0, issue: 0, drop: 0 };
  let nextCode = "731946";
  const deps: RecapEmailCodeDeps = {
    resolveTarget: async (req) => {
      if (opts.session === null) return { unauthorized: true };
      const as = req.nextUrl.searchParams.get("asUserId");
      if (as && as !== (opts.session ?? TENANT) && opts.session !== "admin") return { forbidden: true };
      return { userId: as ?? opts.session ?? TENANT };
    },
    senderConfigured: () => opts.senderConfigured ?? true,
    loadContact: async () => account,
    claim: async (userId, key) => {
      calls.claim++;
      assert.equal(key, valueKey(KIND, ADDRESS), "the limiter gets the sha256 of the normalised address");
      assert.ok(!key.includes("@"));
      if (opts.claim instanceof Error) throw opts.claim;
      return opts.claim ?? { ok: true };
    },
    generateCode: () => nextCode,
    generateSalt: () => `salt-${calls.issue}`,
    issue: async (i) => {
      calls.issue++;
      rows.set(`${i.userId}:${i.kind}`, {
        valueHash: valueKey(i.kind, i.value),
        salt: i.salt,
        codeHash: hashCode(i),
        attempts: 0,
        expired: false,
      });
    },
    drop: async (userId, kind, salt) => {
      calls.drop++;
      if (rows.get(`${userId}:${kind}`)?.salt === salt) rows.delete(`${userId}:${kind}`);
    },
    send: async (to, o) => {
      if (opts.sendResult instanceof Error) throw opts.sendResult;
      sent.push({ to, code: o.code, locale: o.locale });
      return opts.sendResult ?? { ok: true, id: "msg-1" };
    },
    confirm: async (userId, kind, code): Promise<ConfirmCodeResult> => {
      calls.confirm++;
      if (!account) return { ok: false, error: "no_config" };
      if (!account.value) return { ok: false, error: "no_value" };
      const key = `${userId}:${kind}`;
      const d = decideConfirm(rows.get(key) ?? null, { userId, kind, currentValue: account.value, code });
      if (d.outcome === "confirmed") {
        rows.delete(key);
        return { ok: true, at: "2026-11-15T10:00:00.000Z" };
      }
      if (d.write === "delete") rows.delete(key);
      else if (d.write !== "none") rows.set(key, { ...rows.get(key)!, attempts: d.write.attempts });
      return { ok: false, error: d.error };
    },
    log: async (ev) => {
      logs.push(ev);
    },
    secrets: () => ["re_FAKE_secret_0123456789"],
  };
  const call = async (handler: typeof handleSendRecapEmailCode, path: string, body?: unknown, query = "") => {
    const req = new NextRequest(`http://localhost/api/dashboard/notifications/email/${path}${query}`, {
      method: "POST",
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const res = await handler(req, deps);
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown>, retryAfter: res.headers.get("retry-after") };
  };
  return {
    deps,
    rows,
    sent,
    logs,
    calls,
    setNextCode: (c: string) => (nextCode = c),
    sendCode: (body?: unknown, query = "") => call(handleSendRecapEmailCode, "code", body, query),
    confirm: (body?: unknown, query = "") => call(handleConfirmRecapEmailCode, "confirm", body, query),
  };
}

const responses: string[] = [];
const neutral = <R extends { text: string; json: Record<string, unknown> }>(r: R): R => {
  responses.push(r.text);
  if (typeof r.json.error === "string") assert.ok((RECAP_EMAIL_CODE_ERRORS as readonly string[]).includes(r.json.error), `non-neutral ${r.json.error}`);
  return r;
};

async function main() {
  // Happy path: the code goes to the SAVED address in the tenant's locale; the response carries no code.
  {
    const w = makeWorld({});
    const r = neutral(await w.sendCode({ to: "attacker@example.com" }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, expiresInSec: 600 });
    assert.deepEqual(w.sent, [{ to: ADDRESS, code: "731946", locale: "he" }], "never a body-supplied address");
    assert.ok(!r.text.includes("731946"));
    assert.equal(w.logs.at(-1)?.event, "recap_email_code_sent");
    const ok = neutral(await w.confirm({ code: "731 946" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true, recapEmailConfirmation: { state: "confirmed", at: "2026-11-15T10:00:00.000Z" } });
    assert.equal(w.logs.at(-1)?.event, "recap_email_confirmed");
    // Used: the same code again is refused.
    assert.deepEqual(neutral(await w.confirm({ code: "731946" })).json, { error: "invalid_code" });
    assert.ok(!JSON.stringify(w.logs).includes("731946"), "the code is never logged");
  }

  // not_configured: nothing counted, nothing stored, nothing sent.
  {
    const w = makeWorld({ senderConfigured: false });
    const r = neutral(await w.sendCode());
    assert.deepEqual([r.status, r.json], [503, { error: "not_configured" }]);
    assert.deepEqual([w.calls.claim, w.calls.issue, w.sent.length], [0, 0, 0]);
  }

  // Session / scope.
  {
    assert.equal(neutral(await makeWorld({ session: null }).sendCode()).status, 401);
    assert.equal(neutral(await makeWorld({ session: null }).confirm({ code: "123456" })).status, 401);
    const other = "00000000-0000-4000-8000-0000000000b2";
    assert.deepEqual(neutral(await makeWorld({}).sendCode(undefined, `?asUserId=${other}`)).json, { error: "forbidden" });
    const admin = makeWorld({ session: "admin" });
    assert.equal(neutral(await admin.sendCode(undefined, `?asUserId=${TENANT}`)).status, 200);
    assert.ok(admin.rows.has(`${TENANT}:${KIND}`), "the code is the tenant's");
  }

  // No config / no saved address / already confirmed by record; grandfathered may confirm.
  {
    assert.deepEqual(neutral(await makeWorld({ account: null }).sendCode()).json, { error: "no_config" });
    assert.equal((await makeWorld({ account: null }).sendCode()).status, 404);
    const empty = makeWorld({ account: { value: "", record: {}, locale: "fr" } });
    assert.deepEqual([(await empty.sendCode()).status, empty.calls.claim], [409, 0]);
    assert.deepEqual(neutral(await empty.confirm({ code: "123456" })).json, { error: "no_saved_address" });
    const confirmed = makeWorld({
      account: { value: ADDRESS, record: { owner_recap_email: { value: ADDRESS, state: "confirmed", at: "2026-11-01T00:00:00.000Z", by: "code" } }, locale: "fr" },
    });
    assert.deepEqual(neutral(await confirmed.sendCode()).json, { error: "already_confirmed" });
    assert.equal(confirmed.calls.claim, 0);
    const admin = makeWorld({
      account: { value: ADDRESS, record: { owner_recap_email: { value: "old@example.com", state: "confirmed", at: "2026-11-01T00:00:00.000Z", by: "admin" } }, locale: "fr" },
    });
    assert.equal((await admin.sendCode()).status, 200, "a confirmed OTHER value does not count");
  }

  // Rate limited: scope + Retry-After, nothing stored or sent.
  for (const scope of ["value", "account", "global"] as const) {
    const w = makeWorld({ claim: { ok: false, scope, retryAfterSec: 1234 } });
    const r = neutral(await w.sendCode());
    assert.deepEqual([r.status, r.json, r.retryAfter], [429, { error: "rate_limited", scope }, "1234"]);
    assert.deepEqual([w.calls.issue, w.sent.length], [0, 0]);
  }
  {
    const w = makeWorld({ claim: new Error("db down") });
    assert.deepEqual(neutral(await w.sendCode()).json, { error: "send_failed" });
    assert.equal(w.calls.issue, 0);
  }

  // Send failure / no key: the code is dropped, neutral answers, the provider error
  // (address, secret, and the code) redacted from the log.
  {
    const raw = "Resend: domain not verified for recap@example.com key re_FAKE_secret_0123456789 code 731946";
    for (const sendResult of [{ ok: false, error: raw }, new Error(raw)] as const) {
      const w = makeWorld({ sendResult });
      const r = neutral(await w.sendCode());
      assert.deepEqual([r.status, r.json], [500, { error: "send_failed" }]);
      assert.equal(w.rows.size, 0, "a code that was not sent is not live");
      const logged = JSON.stringify(w.logs);
      assert.ok(!logged.includes("recap@example.com") && !logged.includes("re_FAKE") && !logged.includes("731946"), logged);
      assert.doesNotMatch(r.text, LEAK);
    }
    const fallback = makeWorld({ sendResult: { ok: true, fallback: "console_log" } });
    assert.deepEqual(neutral(await fallback.sendCode()).json, { error: "not_configured" });
    assert.equal((await fallback.sendCode()).status, 503);
    assert.equal(fallback.rows.size, 0);
  }

  // Wrong code ×5 → dead (even the right one); a new send replaces it.
  {
    const w = makeWorld({});
    await w.sendCode();
    for (let i = 1; i < MAX_ATTEMPTS; i++) assert.deepEqual(neutral(await w.confirm({ code: "000000" })).json, { error: "invalid_code" });
    assert.deepEqual(neutral(await w.confirm({ code: "000000" })).json, { error: "too_many_attempts" });
    assert.deepEqual(neutral(await w.confirm({ code: "731946" })).json, { error: "too_many_attempts" }, "dead");
    assert.equal(w.logs.filter((l) => l.event === "recap_email_code_refused").length, 2);
    w.setNextCode("318275");
    await w.sendCode();
    assert.deepEqual(neutral(await w.confirm({ code: "731946" })).json, { error: "invalid_code" }, "the old code is replaced");
    assert.equal(neutral(await w.confirm({ code: "318275" })).status, 200);
  }

  // Malformed body or code: invalid_code, no try counted.
  {
    const w = makeWorld({});
    await w.sendCode();
    for (const body of ["not json", {}, { code: 731946 }, { code: "73194" }, [], { code: "abcdef" }]) {
      assert.deepEqual(neutral(await w.confirm(body)).json, { error: "invalid_code" });
    }
    assert.equal(w.calls.confirm, 0);
    assert.equal(w.rows.get(`${TENANT}:${KIND}`)?.attempts, 0);
  }

  // Expired, and the value changed since the send.
  {
    const w = makeWorld({});
    await w.sendCode();
    w.rows.set(`${TENANT}:${KIND}`, { ...w.rows.get(`${TENANT}:${KIND}`)!, expired: true });
    assert.deepEqual(neutral(await w.confirm({ code: "731946" })).json, { error: "code_expired" });
    const acc: Account = { value: ADDRESS, record: {}, locale: "fr" };
    const v = makeWorld({ account: acc });
    await v.sendCode();
    acc.value = "new@example.com";
    assert.deepEqual(neutral(await v.confirm({ code: "731946" })).json, { error: "invalid_code" }, "a value change invalidates");
  }

  // SECRETS_KEY set: the whole send → confirm path works under the pepper.
  // A code issued BEFORE the key appeared no longer verifies (documented in
  // lib/contact-code.ts: codes in flight are invalidated, 10 min TTL).
  {
    const before = makeWorld({});
    await before.sendCode();
    setMasterKey(true);
    try {
      assert.deepEqual(neutral(await before.confirm({ code: "731946" })).json, { error: "invalid_code" }, "issued without a key, verified with one");
      const w = makeWorld({});
      neutral(await w.sendCode());
      const ok = neutral(await w.confirm({ code: "731946" }));
      assert.equal(ok.status, 200, "issued and verified under the same key");
      // No key material in any response or logged event.
      const pepper = Buffer.from(hkdfSync("sha256", MOCK_MASTER, Buffer.alloc(0), "contact-code-hash", 32));
      const out = JSON.stringify([responses, before.logs, w.logs]);
      for (const m of [MOCK_ENV.SECRETS_KEY, MOCK_MASTER.toString("hex"), MOCK_MASTER.toString("base64url"), pepper.toString("hex"), pepper.toString("base64")]) {
        assert.ok(!out.includes(m), "key material in a response or a log");
      }
    } finally {
      setMasterKey(false);
    }
  }

  // Every response: neutral, no supplier, no env var name, no code.
  for (const t of responses) {
    assert.doesNotMatch(t, SUPPLIER);
    assert.doesNotMatch(t, LEAK);
    assert.ok(!t.includes("731946") && !t.includes("318275"), `code in response: ${t}`);
  }
  console.log(`recap-email-code: ${responses.length} responses checked, all passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
