// A tenant never triggers an email from the supplier's default sender:
//   - lib/email-sender.ts: the ONE check (unset / blank → not configured);
//   - the owner recap (lib/owner-recap-email-send.ts) refuses: sender never
//     called, one event without the address or any configuration name/value;
//   - the email-test route (lib/email-test/handler.ts) answers 503 not_configured
//     (covered with the full fake world in email-test-hardening.test.ts; here
//     through the production deps' own sender check);
//   - GET /api/dashboard/notifications/email carries `senderConfigured`;
//   - PUT refuses a CHANGE of the switch to ON while unconfigured (409), the
//     4 gate cases for the tenant and for an admin (?asUserId) through the
//     route's own body → stored helpers (the real DB path: owner-recap-email-db).
// The sender and the env are injected: no email is ever sent.
// Mock data only (example.com).
// Run with:  npx tsx scripts/tests/email-sender-refusal.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { configuredEmailSender, emailSenderConfigured } from "../../lib/email-sender";
import {
  applyOwnerRecapEmailWrite,
  ownerRecapEmailSenderGate,
  ownerRecapEmailView,
  ownerRecapEmailWrite,
  type OwnerRecapEmailSettings,
} from "../../lib/owner-recap-email";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const MOCK_FROM = "Demo Salon <noreply@example.com>";
// Anything shaped like an env var name, the email supplier, or the mock sender.
const LEAK = /EMAIL_FROM|resend|[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|FROM|SECRET|TOKEN|URL)\b|noreply@example\.com/i;

async function main() {
  // Nothing can leave this process.
  delete process.env.RESEND_API_KEY;

  // ── 1. The one check ──────────────────────────────────────────────────
  assert.equal(emailSenderConfigured({}), false, "unset");
  assert.equal(emailSenderConfigured({ EMAIL_FROM: "" }), false, "empty");
  assert.equal(emailSenderConfigured({ EMAIL_FROM: "   \t" }), false, "blank");
  assert.equal(emailSenderConfigured({ EMAIL_FROM: MOCK_FROM }), true, "set");
  assert.equal(configuredEmailSender({ EMAIL_FROM: `  ${MOCK_FROM} ` }), MOCK_FROM, "trimmed");
  assert.equal(configuredEmailSender({ EMAIL_FROM: " " }), null);
  // Default: the process env.
  delete process.env.EMAIL_FROM;
  assert.equal(emailSenderConfigured(), false, "process env unset");
  process.env.EMAIL_FROM = " ";
  assert.equal(emailSenderConfigured(), false, "process env blank");
  process.env.EMAIL_FROM = MOCK_FROM;
  assert.equal(emailSenderConfigured(), true, "process env set");

  // The two tenant-triggered senders never fall back to the default sender.
  const emailSrc = code("lib/email.ts");
  for (const [fn, next] of [
    ["sendNotificationTestEmail", "export async function"],
    ["sendOwnerRecapEmail", "export async function sendAdminAlertEmail"],
  ] as const) {
    const start = emailSrc.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, fn);
    const end = emailSrc.indexOf(next, start + 10);
    const body = emailSrc.slice(start, end > start ? end : undefined);
    assert.doesNotMatch(body, /FROM_DEFAULT|process\.env/, `${fn}: no default sender, no direct env read`);
    assert.match(body, /const from = configuredEmailSender\(\);\s*if \(!from\) return \{ ok: false/, `${fn}: refuses without a sender`);
  }

  // ── 2. Owner recap: unset / blank sender → not sent, one event ──────
  const { ownerRecapEmailDeps, sendOwnerRecapEmailBestEffort } = await import("../../lib/owner-recap-email-send");
  type SendArgs = Parameters<typeof ownerRecapEmailDeps.send>;
  type LogArg = Parameters<typeof ownerRecapEmailDeps.log>[0];
  const realSenderConfigured = ownerRecapEmailDeps.senderConfigured;
  let sends: SendArgs[] = [];
  let logs: LogArg[] = [];
  let recentQueries = 0;
  ownerRecapEmailDeps.send = async (...a) => {
    sends.push(a);
    return { ok: true, id: "mock-id-1" };
  };
  ownerRecapEmailDeps.log = async (ev) => {
    logs.push(ev);
  };
  ownerRecapEmailDeps.recentSent = async () => {
    recentQueries++;
    return false;
  };
  const base = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    callId: "10000000-0000-4000-8000-000000000001",
    forOwner: "Name: Dana\nReason: haircut",
    fromNumber: "+15550100001",
    recapFeatureOn: true,
    transcriptEntries: 4,
    cfg: { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true, primaryLanguage: "en", business: {} },
  };
  const reset = () => {
    sends = [];
    logs = [];
    recentQueries = 0;
  };

  // Through the production check, with the env injected.
  ownerRecapEmailDeps.senderConfigured = realSenderConfigured;
  for (const env of [undefined, "", "   "]) {
    reset();
    if (env === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = env;
    assert.equal(await sendOwnerRecapEmailBestEffort(base), "sender_not_configured", `EMAIL_FROM=${JSON.stringify(env)}`);
    assert.equal(sends.length, 0, "unconfigured: sender never called");
    assert.equal(recentQueries, 0, "unconfigured: no dedup query either");
    assert.equal(logs.length, 1, "unconfigured: exactly one event");
    assert.equal(logs[0].event, "email_skipped_owner_not_configured");
    assert.equal(logs[0].source, "email");
    assert.equal(logs[0].userId, base.userId);
    assert.deepEqual(logs[0].metadata, { callId: base.callId, reason: "sender_not_configured" });
    const dump = JSON.stringify(logs[0]);
    assert.ok(!dump.includes("@"), "no address in the event");
    assert.doesNotMatch(dump, LEAK, "no configuration name or value in the event");
    assert.ok(!dump.includes("Dana") && !dump.includes("haircut"), "no recap body in the event");
  }
  // OFF / feature off / short transcript stay silent even when unconfigured.
  reset();
  delete process.env.EMAIL_FROM;
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, cfg: { ...base.cfg, ownerRecapEmailEnabled: false } }), "off");
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, recapFeatureOn: false }), "feature_off");
  assert.equal(await sendOwnerRecapEmailBestEffort({ ...base, transcriptEntries: 1 }), "transcript_too_short");
  assert.deepEqual([sends.length, logs.length], [0, 0], "skips before the sender check: no event");
  // Configured → sent as before.
  reset();
  process.env.EMAIL_FROM = MOCK_FROM;
  assert.equal(await sendOwnerRecapEmailBestEffort(base), "sent");
  assert.equal(sends.length, 1);
  assert.equal(logs[0].event, "email_sent_owner");
  delete process.env.EMAIL_FROM;

  // ── 3. Email-test route: production deps' sender check → 503 ─────────
  {
    const { handleEmailTest } = await import("../../lib/email-test/handler");
    const { NextRequest } = await import("next/server");
    // The production wiring's own check (lib/email-test/deps.ts) is the helper.
    assert.match(code("lib/email-test/deps.ts"), /senderConfigured: \(\) => emailSenderConfigured\(\)/);
    let sent = 0;
    let claimed = 0;
    for (const env of [undefined, "", "  "]) {
      if (env === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = env;
      const res = await handleEmailTest(
        new NextRequest("http://localhost/api/dashboard/notifications/email-test", {
          method: "POST",
          body: JSON.stringify({ to: "owner@example.com" }),
        }),
        {
          resolveTarget: async () => ({ userId: base.userId }),
          loadAccount: async () => ({ loginEmail: "owner@example.com", ownerRecapEmail: "", displayName: null }),
          claim: async () => {
            claimed++;
            return { ok: true };
          },
          send: async () => {
            sent++;
            return { ok: true, id: "mock" };
          },
          log: async () => {},
          secrets: () => [],
          senderConfigured: () => emailSenderConfigured(),
        },
      );
      const text = await res.text();
      assert.equal(res.status, 503, `email-test EMAIL_FROM=${JSON.stringify(env)}`);
      assert.deepEqual(JSON.parse(text), { error: "not_configured" });
      assert.doesNotMatch(text, LEAK);
    }
    assert.deepEqual([sent, claimed], [0, 0], "email-test: nothing sent, nothing counted");
  }

  // ── 4. GET senderConfigured ──────────────────────────────────────────
  const stored: OwnerRecapEmailSettings = { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: false };
  for (const [env, want] of [
    [{ EMAIL_FROM: MOCK_FROM }, true],
    [{}, false],
    [{ EMAIL_FROM: " " }, false],
  ] as const) {
    const view = ownerRecapEmailView(stored, emailSenderConfigured(env));
    assert.deepEqual(view, { ...stored, senderConfigured: want });
    assert.deepEqual(Object.keys(view).sort(), ["ownerRecapEmail", "ownerRecapEmailEnabled", "senderConfigured"], "no other key");
    assert.doesNotMatch(JSON.stringify(view), LEAK, "GET carries no configuration name or value");
  }
  const route = code("app/api/dashboard/notifications/email/route.ts");
  assert.match(route, /\.\.\.ownerRecapEmailView\(settings, emailSenderConfigured\(\)\),/, "GET uses the view + the one check");
  // N2: the GET adds the saved address's confirmation state (never a code), nothing else.
  assert.match(route, /NextResponse\.json\(\{\s*\.\.\.ownerRecapEmailView\(settings, emailSenderConfigured\(\)\),\s*recapEmailConfirmation: contact \? recapEmailConfirmationView\(contact\.value, contact\.record\) : null,\s*\}\)/);
  assert.match(
    route,
    /saveOwnerRecapEmail\(s\.userId, parsed\.data, \{ senderConfigured: emailSenderConfigured\(\) \}\)/,
    "PUT passes the one check to the save, for the scoped account (tenant or ?asUserId)",
  );
  assert.doesNotMatch(route, /process\.env|EMAIL_FROM|FROM_DEFAULT/, "the route never reads the configuration itself");
  const store = code("lib/owner-recap-email-store.ts");
  assert.match(store, /const refused = ownerRecapEmailSenderGate\(current, write\.updates, opts\.senderConfigured\);\s*if \(refused\) return \{ status: 409, body: refused \};/);
  assert.ok(store.indexOf("ownerRecapEmailSenderGate(current") < store.indexOf("db\n    .update"), "gate runs before the write");

  // ── 5. PUT gate: 4 cases, tenant AND admin (?asUserId) ───────────────
  // The route resolves the scope (the tenant's own id, or the ?asUserId
  // tenant for an admin) and calls the SAME save → same helpers; this
  // in-memory save mirrors saveOwnerRecapEmail step for step.
  const TENANT = "00000000-0000-4000-8000-0000000000a1";
  const ADMIN = "00000000-0000-4000-8000-0000000000ad";
  type Rows = Record<string, OwnerRecapEmailSettings>;
  const scopeOf = (session: string, asUserId: string | null) => (asUserId && session === ADMIN ? asUserId : session);
  const save = (rows: Rows, userId: string, body: unknown, senderConfigured: boolean) => {
    const w = ownerRecapEmailWrite(body);
    if (!w.ok) return { status: 400, body: w.body };
    const current = rows[userId];
    const refused = ownerRecapEmailSenderGate(current, w.updates, senderConfigured);
    if (refused) return { status: 409, body: refused };
    rows[userId] = applyOwnerRecapEmailWrite(current, w.updates);
    return { status: 200, body: { ...rows[userId], changedFields: Object.keys(w.updates) } };
  };
  const REFUSED = { status: 409, body: { error: "sender_not_configured", field: "ownerRecapEmailEnabled" } };
  for (const [who, session, asUserId] of [
    ["tenant", TENANT, null],
    ["admin", ADMIN, TENANT],
  ] as const) {
    const uid = scopeOf(session, asUserId);
    assert.equal(uid, TENANT, `${who}: scoped to the tenant`);
    const off: Rows = { [TENANT]: { ownerRecapEmail: "", ownerRecapEmailEnabled: false } };
    // (1) other fields pass while unconfigured: saving the address, turning OFF.
    assert.equal(save(off, uid, { ownerRecapEmail: "owner@example.com" }, false).status, 200, `${who}: (1) address passes`);
    assert.equal(save(off, uid, { ownerRecapEmailEnabled: false }, false).status, 200, `${who}: (1) OFF passes`);
    assert.equal(save(off, uid, { unrelated: true }, false).status, 200, `${who}: (1) unrelated passes`);
    assert.deepEqual(off[TENANT], { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: false });
    // (2) an unchanged re-send passes: OFF → OFF, and ON → ON for an account
    //     already ON (decision: only a CHANGE to ON is refused).
    assert.equal(save(off, uid, { ...off[TENANT] }, false).status, 200, `${who}: (2) unchanged OFF re-send`);
    const on: Rows = { [TENANT]: { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true } };
    assert.equal(save(on, uid, { ...on[TENANT] }, false).status, 200, `${who}: (2) unchanged ON re-send passes`);
    assert.equal(save(on, uid, { ownerRecapEmailEnabled: true }, false).status, 200, `${who}: (2) unchanged ON alone`);
    // (3) a change to ON while unconfigured → 409 naming the field, nothing written.
    for (const body of [{ ownerRecapEmailEnabled: true }, { ownerRecapEmail: "new@example.com", ownerRecapEmailEnabled: true }]) {
      const before = { ...off[TENANT] };
      const r = save(off, uid, body, false);
      assert.deepEqual(r, REFUSED, `${who}: (3) change to ON refused`);
      assert.deepEqual(off[TENANT], before, `${who}: (3) a 409 writes nothing`);
      assert.doesNotMatch(JSON.stringify(r), LEAK);
      assert.ok(!JSON.stringify(r).includes("@"), "no address in the 409");
    }
    // ... and passes once a sender is configured.
    const later: Rows = { [TENANT]: { ...off[TENANT] } };
    assert.equal(save(later, uid, { ownerRecapEmailEnabled: true }, true).status, 200, `${who}: configured → ON passes`);
    // (4) a save omitting the field keeps the stored value (OFF and ON).
    save(off, uid, { ownerRecapEmail: "other@example.com" }, false);
    assert.equal(off[TENANT].ownerRecapEmailEnabled, false, `${who}: (4) omitted switch kept OFF`);
    save(on, uid, { ownerRecapEmail: "other@example.com" }, false);
    assert.equal(on[TENANT].ownerRecapEmailEnabled, true, `${who}: (4) omitted switch kept ON`);
    // Turning an ON account OFF while unconfigured passes.
    assert.equal(save(on, uid, { ownerRecapEmailEnabled: false }, false).status, 200, `${who}: OFF from ON passes`);
  }
  // The pure gate itself.
  const OFF = { ownerRecapEmail: "", ownerRecapEmailEnabled: false };
  const ON = { ownerRecapEmail: "owner@example.com", ownerRecapEmailEnabled: true };
  assert.equal(ownerRecapEmailSenderGate(OFF, { ownerRecapEmailEnabled: true }, true), null);
  assert.deepEqual(ownerRecapEmailSenderGate(OFF, { ownerRecapEmailEnabled: true }, false), REFUSED.body);
  assert.equal(ownerRecapEmailSenderGate(ON, { ownerRecapEmailEnabled: true }, false), null);
  assert.equal(ownerRecapEmailSenderGate(OFF, { ownerRecapEmail: "owner@example.com" }, false), null);
  assert.equal(ownerRecapEmailSenderGate(OFF, {}, false), null);

  // ── 6. No configuration name in the new tenant-facing code paths ─────
  for (const f of ["lib/owner-recap-email-send.ts", "lib/owner-recap-email.ts", "lib/owner-recap-email-store.ts"]) {
    assert.doesNotMatch(code(f), /process\.env|EMAIL_FROM|FROM_DEFAULT/, `${f} reads no configuration`);
  }
  // Agent payloads: no agent_configs column was added for this.
  assert.doesNotMatch(read("lib/db/schema.ts"), /sender_configured|senderConfigured/, "no new column");

  console.log("ALL EMAIL-SENDER-REFUSAL TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
