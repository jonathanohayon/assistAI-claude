// Client WhatsApp confirm after a call (lib/client-confirm/*): sent ONLY after a
// proven book / cancel / reschedule tool event, text built from the event,
// one per destination per call, at most 3 per number per day. Every side
// effect is injected: nothing is ever sent, no database, no network.
// Mock data only (+1555…, "Demo Salon"). Run with:
//   npx tsx scripts/tests/client-confirm.test.ts

import assert from "node:assert/strict";

import type { JoinCall, JoinEvent } from "../../lib/calls/core";
import {
  CLIENT_CONFIRM_BUCKET,
  CLIENT_CONFIRM_CALL_BUCKET,
  CLIENT_CONFIRM_PER_NUMBER,
  clientConfirmText,
  destinationKey,
  lastProvenEvent,
  redactNumbers,
} from "../../lib/client-confirm/core";
import { sendClientConfirm, type ClientConfirmDeps, type ClientConfirmInput } from "../../lib/client-confirm/run";
import { decideRateLimit, type RateLimitLedger } from "../../lib/rate-limit-db-core";
import { callUsLine } from "../../lib/whatsapp-call-line";
import { normalizeE164 } from "../../lib/phone-utils";
import type { WhatsAppOptions } from "../../lib/whatsapp";
import type { LogEvent } from "../../lib/logger";

const CALLER = "+15555550101";
const OTHER = "+15555550102";
const LINE = "+15555550199";
const USER = "00000000-0000-4000-8000-000000000001";
const RECAP = "Bonjour ! Votre RDV est pris pour demain 18h, vous me devez 500 € — Demo Salon";
const t0 = new Date("2026-11-12T10:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);

let evSeq = 0;
const ev = (event: string, metadata: Record<string, unknown>, s = 0): JoinEvent => ({
  id: `ev-${++evSeq}`,
  userId: USER,
  event,
  createdAt: at(s),
  metadata: { callId: "room-hash-1", ...metadata },
});
const BOOK = ev("book_success", { eventId: "gcal-1", name: "Dana", phone: CALLER, date: "2026-11-19", time: "10:30", location: "Demo Salon Centre" }, -60);
const RESCHED = ev("reschedule_success", { eventId: "gcal-1", newDate: "2026-11-20", newTime: "14:00" }, -30);
const CANCEL = ev("cancel_success", { eventId: "gcal-1" }, -10);

function harness(opts: { events?: JoinEvent[]; appointment?: JoinEvent | null; limiterThrows?: boolean; sendOk?: boolean } = {}) {
  const ledgers = new Map<string, RateLimitLedger>();
  const sent: WhatsAppOptions[] = [];
  const logs: LogEvent[] = [];
  const limiterCalls: Array<{ bucket: string; accountId: string; perAccount: number }> = [];
  let now = t0.getTime();
  const deps: ClientConfirmDeps = {
    loadToolEvents: async () => opts.events ?? [],
    lastEventOfAppointment: async () => opts.appointment ?? null,
    // The real decision (lib/rate-limit-db-core.ts) over an in-memory ledger.
    consumeRateLimit: async ({ bucket, accountId, windowMs, perAccount, global }) => {
      if (opts.limiterThrows) throw new Error("db down");
      limiterCalls.push({ bucket, accountId, perAccount });
      const { result, next } = decideRateLimit(ledgers.get(bucket) ?? {}, accountId, now++, { windowMs, perAccount, global });
      ledgers.set(bucket, next);
      return result;
    },
    sendWhatsApp: async (o) => {
      sent.push(o);
      return opts.sendOk === false ? { ok: false, error: `Twilio 400: The 'To' number ${o.to} is not valid` } : { ok: true, sid: `SM${sent.length}` };
    },
    logEvent: async (e) => {
      logs.push(e);
    },
    normalizeE164,
  };
  const input = (over: Partial<ClientConfirmInput> = {}): ClientConfirmInput => ({
    userId: USER,
    call: { id: "11111111-1111-4111-8111-111111111111", userId: USER, callId: "room-hash-1", createdAt: t0, durationSeconds: 120 } satisfies JoinCall,
    fromNumber: CALLER,
    enabled: true,
    channel: "pstn",
    lang: "fr",
    signature: "Demo Salon",
    callNumber: async () => LINE,
    templateSid: "HXfr000000000000000000000000000000",
    ...over,
  });
  return { deps, input, sent, logs, ledgers, limiterCalls, advance: (ms: number) => (now += ms) };
}

const assertNoNumberNoText = (logs: LogEvent[], text?: string) => {
  for (const l of logs) {
    const blob = `${l.message} ${JSON.stringify(l.metadata ?? {})}`;
    assert.doesNotMatch(blob, /5555550/, `no number in ${l.event}`);
    if (text) assert.ok(!blob.includes(text.split("\n")[0]), `no message text in ${l.event}`);
    assert.ok(!blob.includes("Demo Salon Centre"), `no place text in ${l.event}`);
  }
};

async function main() {
  // ── Texts per language (date/time/place from the EVENT, never the recap) ──
  const callFr = callUsLine("fr", LINE);
  assert.equal(
    clientConfirmText(lastProvenEvent([BOOK])!, { lang: "fr", signature: "Demo Salon", callNumber: LINE }),
    `Votre rendez-vous du jeudi 19 novembre à 10:30 est confirmé.\nLieu : Demo Salon Centre\n\n— Demo Salon\n\n${callFr}`,
  );
  assert.equal(
    clientConfirmText(lastProvenEvent([BOOK])!, { lang: "en", signature: "Demo Salon", callNumber: LINE }),
    `Your appointment on Thursday, November 19 at 10:30 is confirmed.\nLocation: Demo Salon Centre\n\n— Demo Salon\n\n${callUsLine("en", LINE)}`,
  );
  assert.equal(
    clientConfirmText(lastProvenEvent([BOOK])!, { lang: "he", signature: "Demo Salon", callNumber: LINE }),
    `התור שלך ביום חמישי, 19 בנובמבר בשעה 10:30 אושר.\nמיקום: Demo Salon Centre\n\n— Demo Salon\n\n${callUsLine("he", LINE)}`,
  );
  assert.equal(
    clientConfirmText(lastProvenEvent([RESCHED])!, { lang: "fr", signature: "", callNumber: null }),
    "Votre rendez-vous a été déplacé au vendredi 20 novembre à 14:00.",
    "no signature when the tenant has no name, no call line without a number",
  );
  assert.equal(
    clientConfirmText(lastProvenEvent([CANCEL])!, { lang: "en", signature: "Demo Salon", callNumber: null }),
    "Your appointment is cancelled.\n\n— Demo Salon",
    "a cancel whose appointment is unknown states no date",
  );
  assert.equal(clientConfirmText(lastProvenEvent([BOOK])!, { lang: "xx", signature: "", callNumber: null }).startsWith("Votre rendez-vous"), true, "unknown language → French");

  // Last proven event decides; transfer / malformed events prove nothing.
  assert.equal(lastProvenEvent([BOOK, RESCHED])!.kind, "rescheduled");
  assert.equal(lastProvenEvent([RESCHED, BOOK].reverse())!.kind, "rescheduled", "order by createdAt, not by list order");
  assert.equal(lastProvenEvent([BOOK, RESCHED, CANCEL])!.kind, "cancelled");
  assert.equal(lastProvenEvent([ev("call_transfer", { ok: true })]), null);
  assert.equal(lastProvenEvent([ev("book_success", { date: "demain", time: "18h" })]), null, "a booking without a valid date/time is not usable");
  assert.equal(lastProvenEvent([]), null);
  assert.equal(redactNumbers(`The 'To' number ${CALLER} is not valid`), "The 'To' number [number] is not valid");

  // ── 1. A booking → exactly one confirm with the event text ──
  {
    const h = harness({ events: [BOOK] });
    const out = await sendClientConfirm(h.input(), h.deps);
    assert.deepEqual(out, { sent: true, sid: "SM1", kind: "booked" });
    assert.equal(h.sent.length, 1);
    const text = clientConfirmText(lastProvenEvent([BOOK])!, { lang: "fr", signature: "Demo Salon", callNumber: LINE });
    assert.deepEqual(h.sent[0], {
      to: CALLER,
      body: text,
      templateSid: "HXfr000000000000000000000000000000",
      templateVariables: { "1": text },
    });
    assert.ok(!h.sent[0].body.includes("500 €") && !h.sent[0].body.includes(RECAP), "nothing from the model's recap");
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].event, "whatsapp_sent_client");
    assert.deepEqual(h.logs[0].metadata, { callId: "11111111-1111-4111-8111-111111111111", sid: "SM1", channel: "pstn", mode: "template", kind: "booked" });
    assertNoNumberNoText(h.logs, text);
    // The per-number account id is sha256(E.164): no number in the ledgers.
    assert.deepEqual(h.limiterCalls.map((c) => [c.bucket, c.perAccount]), [[CLIENT_CONFIRM_CALL_BUCKET, 1], [CLIENT_CONFIRM_BUCKET, CLIENT_CONFIRM_PER_NUMBER]]);
    assert.equal(h.limiterCalls[1].accountId, destinationKey(CALLER));
    assert.match(h.limiterCalls[1].accountId, /^[0-9a-f]{64}$/);
    for (const l of h.ledgers.values()) assert.doesNotMatch(JSON.stringify(l), /5555550/);
  }

  // ── 2. Cancel → its text (date of the cancelled appointment from its own event) ──
  {
    const h = harness({ events: [CANCEL], appointment: BOOK });
    await sendClientConfirm(h.input(), h.deps);
    assert.equal(h.sent[0].body.split("\n")[0], "Votre rendez-vous du jeudi 19 novembre à 10:30 est annulé.");
    const h2 = harness({ events: [CANCEL], appointment: RESCHED });
    await sendClientConfirm(h2.input({ lang: "en" }), h2.deps);
    assert.equal(h2.sent[0].body.split("\n")[0], "Your appointment on Friday, November 20 at 14:00 is cancelled.");
    const h3 = harness({ events: [CANCEL], appointment: null });
    await sendClientConfirm(h3.input({ lang: "he" }), h3.deps);
    assert.equal(h3.sent[0].body.split("\n")[0], "התור שלך בוטל.");
  }

  // ── 3. Reschedule → its text ──
  {
    const h = harness({ events: [RESCHED] });
    await sendClientConfirm(h.input(), h.deps);
    assert.equal(h.sent[0].body.split("\n")[0], "Votre rendez-vous a été déplacé au vendredi 20 novembre à 14:00.");
  }

  // ── 4. A call with NO proven tool event → NO client message (counts-only log) ──
  {
    const h = harness({ events: [ev("call_transfer", { ok: true })] });
    const out = await sendClientConfirm(h.input(), h.deps);
    assert.deepEqual(out, { sent: false, reason: "no_proven_event" });
    assert.equal(h.sent.length, 0);
    assert.equal(h.limiterCalls.length, 0, "nothing consumed");
    assert.deepEqual(h.logs.map((l) => [l.event, l.metadata]), [
      ["whatsapp_skipped_client", { callId: "11111111-1111-4111-8111-111111111111", reason: "no_proven_event", toolEvents: 1 }],
    ]);
    assertNoNumberNoText(h.logs);
    const none = harness({ events: [] });
    assert.equal((await sendClientConfirm(none.input(), none.deps)).sent, false);
    assert.equal(none.sent.length, 0);
  }

  // ── 5. The 4th confirm to one number in a day → skipped silently ──
  {
    const h = harness({ events: [BOOK] });
    for (let i = 1; i <= 4; i++) {
      const out = await sendClientConfirm(h.input({ call: { id: `call-${i}`, userId: USER, callId: `room-${i}`, createdAt: t0, durationSeconds: 60 } }), h.deps);
      if (i <= CLIENT_CONFIRM_PER_NUMBER) assert.equal(out.sent, true, `confirm ${i}`);
      else assert.deepEqual(out, { sent: false, reason: "rate_limited" }, "4th → skipped");
    }
    assert.equal(h.sent.length, 3);
    const skip = h.logs.at(-1)!;
    assert.equal(skip.event, "whatsapp_skipped_client");
    assert.deepEqual(skip.metadata, { callId: "call-4", reason: "rate_limited", scope: "account" });
    assertNoNumberNoText(h.logs);
    // Another number is unaffected; the same number passes again after 24 h.
    assert.equal((await sendClientConfirm(h.input({ fromNumber: OTHER, call: { id: "call-5", userId: USER, callId: "room-5", createdAt: t0, durationSeconds: 60 } }), h.deps)).sent, true);
    h.advance(24 * 3600 * 1000 + 1);
    assert.equal((await sendClientConfirm(h.input({ call: { id: "call-6", userId: USER, callId: "room-6", createdAt: t0, durationSeconds: 60 } }), h.deps)).sent, true);
  }

  // ── 6. One confirm per destination per call (a retried /api/calls/end) ──
  {
    const h = harness({ events: [BOOK] });
    // Same worker call id, two rows (a retry inserts a new calls row).
    assert.equal((await sendClientConfirm(h.input(), h.deps)).sent, true);
    const again = await sendClientConfirm(h.input({ call: { id: "22222222-2222-4222-8222-222222222222", userId: USER, callId: "room-hash-1", createdAt: t0, durationSeconds: 120 } }), h.deps);
    assert.deepEqual(again, { sent: false, reason: "duplicate" });
    assert.equal(h.sent.length, 1);
    // Formatting variants of the same number are the same destination.
    assert.deepEqual(await sendClientConfirm(h.input({ fromNumber: "+1 (555) 555-0101" }), h.deps), { sent: false, reason: "duplicate" });
    assert.equal(h.limiterCalls.filter((c) => c.bucket === CLIENT_CONFIRM_BUCKET).length, 1, "a duplicate never uses up the daily cap");
    // A call without a worker id falls back to calls.id.
    const h2 = harness({ events: [BOOK] });
    const legacy = h2.input({ call: { id: "33333333-3333-4333-8333-333333333333", userId: USER, callId: "", createdAt: t0, durationSeconds: 60 } });
    assert.equal((await sendClientConfirm(legacy, h2.deps)).sent, true);
    assert.equal((await sendClientConfirm(legacy, h2.deps)).sent, false);
  }

  // ── 7. Template path: only the {{1}} value is ours, the SID is passed through ──
  {
    for (const [lang, sid] of [["fr", "HXfr"], ["he", "HXhe"], ["en", "HXen"]] as const) {
      const h = harness({ events: [BOOK] });
      await sendClientConfirm(h.input({ lang, templateSid: sid }), h.deps);
      assert.equal(h.sent[0].templateSid, sid, lang);
      assert.deepEqual(Object.keys(h.sent[0].templateVariables!), ["1"]);
      assert.equal(h.sent[0].templateVariables!["1"], h.sent[0].body);
      assert.ok(h.sent[0].body.length <= 1000);
    }
    // WhatsApp channel: free-form, same text as Body, no template.
    const h = harness({ events: [BOOK] });
    await sendClientConfirm(h.input({ channel: "whatsapp", templateSid: undefined }), h.deps);
    assert.deepEqual(h.sent[0], {
      to: CALLER,
      body: clientConfirmText(lastProvenEvent([BOOK])!, { lang: "fr", signature: "Demo Salon", callNumber: LINE }),
      templateSid: undefined,
      templateVariables: undefined,
    });
    assert.equal(h.logs[0].metadata!.mode, "free_form");
  }

  // ── 8. whatsapp_confirm=false / web live test (no fromNumber) → nothing, as before ──
  {
    for (const over of [{ enabled: false }, { fromNumber: "" }]) {
      const h = harness({ events: [BOOK] });
      let loaded = false;
      h.deps.loadToolEvents = async () => {
        loaded = true;
        return [BOOK];
      };
      assert.deepEqual(await sendClientConfirm(h.input(over), h.deps), { sent: false, reason: "not_applicable" });
      assert.equal(h.sent.length + h.logs.length + h.limiterCalls.length, 0);
      assert.equal(loaded, false);
    }
  }

  // ── 9. Limiter down → fail closed; provider error → logged without the number ──
  {
    const h = harness({ events: [BOOK], limiterThrows: true });
    assert.deepEqual(await sendClientConfirm(h.input(), h.deps), { sent: false, reason: "limiter_error" });
    assert.equal(h.sent.length, 0);
    const f = harness({ events: [BOOK], sendOk: false });
    const out = await sendClientConfirm(f.input(), f.deps);
    assert.equal(out.sent, false);
    assert.equal(f.logs[0].event, "whatsapp_failed_client");
    assertNoNumberNoText(f.logs);
    assert.ok(out.sent === false && !(out.error ?? "").includes("5555550"));
  }

  console.log("ALL CLIENT-CONFIRM TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
