// Monitoring's SIP call label after #332 (no PII in events): call_received
// now carries { callId, toNumber, fromHash, fromLast4, transcriptEntries }.
// Groups REAL events with the real groupEventsByCall, renders the real
// <SipCallLabel> to static HTML in fr/en/he. Mock numbers only.
// Run with:  npx tsx scripts/tests/monitoring-sip-label.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { groupEventsByCall, type EventRow } from "../../app/[locale]/dashboard/logs/logs-view";
import { SipCallLabel } from "../../app/[locale]/dashboard/logs/sip-call-label";
import { callReceivedEvent } from "../../lib/call-received-event";
import { eventForStorage } from "../../lib/event-pii";
import {
  callerLast4,
  messageForDisplay,
  metadataForDisplay,
  sipLabelFromReceived,
  type SipLabel,
} from "../../lib/monitoring-label";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;
const ROOT = new URL("../../", import.meta.url).pathname;
const messages = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
const LOCALES = ["fr", "en", "he"] as const;

function html(el: ReactElement, locale = "fr") {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, el),
  );
}
const label = (sip: SipLabel, locale = "fr") => html(createElement(SipCallLabel, { label: sip }), locale);
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const TENANT_LINE = "+972500000000";
const CALLER = "+972500001234";

let n = 0;
const ev = (event: string, metadata: Record<string, unknown> | null, message = ""): EventRow => ({
  id: `e${++n}`,
  level: "info",
  source: "agent",
  event,
  message,
  metadata,
  createdAt: new Date(Date.UTC(2026, 10, 15, 10, 0, n)).toISOString(),
});
const sipStarted = () =>
  ev("call_started", { roomName: `room-${n}`, origin: { kind: "sip", calledNumber: TENANT_LINE, channel: "pstn" } });
const webStarted = () => ev("call_started", { roomName: `livetest-${n}`, origin: { kind: "web", userId: "u1" } });
const received = (metadata: Record<string, unknown>) => ev("call_received", metadata);
const onlyCall = (events: EventRow[]) => {
  const calls = groupEventsByCall(events, null).filter((g) => g.kind === "call");
  assert.equal(calls.length, 1);
  return calls[0];
};

// The metadata exactly as /api/calls/end stores it since #332.
const NEW_META = eventForStorage(
  callReceivedEvent({ fromNumber: CALLER, toNumber: TENANT_LINE, callId: "c1", transcriptEntries: 4 }),
).metadata;

// 1. New metadata → "SIP …1234 → +972 50-000-0000", both numbers LTR-isolated
{
  assert.ok(NEW_META["fromHash"], "fixture carries a fromHash");
  assert.equal(NEW_META["fromNumber"], undefined);
  const g = onlyCall([sipStarted(), received(NEW_META)]);
  assert.equal(g.origin, "sip");
  assert.deepEqual(g.sip, { last4: "1234", to: "+972 50-000-0000" });
  const out = label(g.sip!);
  assert.equal(text(out), "SIP …1234 → +972 50-000-0000");
  assert.match(out, /<bdi dir="ltr">…1234<\/bdi>/);
  assert.match(out, /<bdi dir="ltr">\+972 50-000-0000<\/bdi>/);
}

// 2. Missing fromLast4 → the "caller" wording, in every locale
{
  const g = onlyCall([sipStarted(), received({ callId: "c2", toNumber: TENANT_LINE, transcriptEntries: 0 })]);
  assert.deepEqual(g.sip, { last4: null, to: "+972 50-000-0000" });
  assert.equal(text(label(g.sip!, "fr")), "SIP appelant → +972 50-000-0000");
  assert.equal(text(label(g.sip!, "en")), "SIP caller → +972 50-000-0000");
  assert.equal(text(label(g.sip!, "he")), "SIP מתקשר ← +972 50-000-0000");
  // Before call_received arrives, the call_started line already reads that way.
  const early = onlyCall([sipStarted()]);
  assert.deepEqual(early.sip, { last4: null, to: "+972 50-000-0000" });
  // A malformed fromLast4 is not shown.
  assert.equal(callerLast4({ fromLast4: "12a4" }), null);
}

// 3. An old event with fromNumber in clear → its last 4 only, anywhere on screen
{
  const OLD = { fromNumber: CALLER, toNumber: TENANT_LINE, callId: "c3" };
  const g = onlyCall([sipStarted(), received(OLD)]);
  assert.deepEqual(g.sip, { last4: "1234", to: "+972 50-000-0000" });
  const out = label(g.sip!);
  assert.equal(text(out), "SIP …1234 → +972 50-000-0000");
  assert.ok(!out.includes("500001234") && !out.includes("50-000-1234"), "no full caller number in the label");
  // The expanded detail and the message of old events are masked too.
  const shown = JSON.stringify(metadataForDisplay({ ...OLD, nested: { callerPhone: CALLER, note: `call ${CALLER} ana@example.com` } }));
  assert.ok(!shown.includes(CALLER) && !shown.includes("ana@example.com"), shown);
  assert.ok(shown.includes('"fromNumber":"…1234"'), shown);
  assert.ok(shown.includes(`"toNumber":"${TENANT_LINE}"`), "the tenant's own line stays in clear");
  assert.equal(messageForDisplay(`Appel reçu de ${CALLER} pour ana@example.com`), "Appel reçu de …1234 pour [email]");
}

// 4. fromHash never appears in the markup (label nor detail)
{
  const hash = NEW_META["fromHash"] as string;
  for (const l of LOCALES) {
    const out = label(sipLabelFromReceived(NEW_META)!, l);
    assert.ok(!out.includes(hash) && !out.includes("fromHash"), `${l}: no fromHash in the label`);
  }
  const shown = JSON.stringify(metadataForDisplay({ ...NEW_META, origin: { callerHash: "abc123abc123" } }));
  assert.ok(!shown.includes(hash) && !/Hash/.test(shown), shown);
  assert.ok(shown.includes('"fromLast4":"1234"'), shown);
  const view = readFileSync(join(ROOT, "app/[locale]/dashboard/logs/logs-view.tsx"), "utf8");
  assert.ok(!/fromHash|fromNumber/.test(view.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "logs-view reads neither fromHash nor fromNumber");
}

// 5. Web sessions keep today's label
{
  const g = onlyCall([webStarted(), received({ callId: "c5", toNumber: "", transcriptEntries: 2 })]);
  assert.equal(g.origin, "web");
  assert.equal(g.label, "Web LiveTest");
  assert.equal(g.sip, undefined);
  assert.equal(sipLabelFromReceived({ callId: "c5", toNumber: "" }), null);
}

// 6. fr/en/he keys exist, carry the placeholders, HE points the arrow RTL
{
  for (const l of LOCALES) {
    const m = messages(l).DashboardLogs;
    assert.match(m.sipCallFrom, /^SIP <num>…\{last4\}<\/num> [→←] <to>\{number\}<\/to>$/, `${l}.sipCallFrom`);
    assert.match(m.sipCallUnknownCaller, /^SIP .+ [→←] <to>\{number\}<\/to>$/, `${l}.sipCallUnknownCaller`);
    const arrow = l === "he" ? "←" : "→";
    assert.ok(m.sipCallFrom.includes(arrow) && m.sipCallUnknownCaller.includes(arrow), `${l}: arrow ${arrow}`);
  }
}

console.log("monitoring-sip-label: all assertions passed");
