// Tenant Calls page (J2, levels 1–2): words for every outcome and action in
// fr / en / he, no engineering words, duration and called number only when
// known, the raw-transcript fallback, and the "Show more" cursor wiring.
// Renders the REAL row / detail / load-more components to static HTML.
// Mock data only.
// Run with:  npx tsx scripts/tests/calls-page.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CallAction, CallDetailResponse, CallLine, CallOutcome } from "../../lib/calls/contract";
import {
  ACTION_KEYS,
  OUTCOMES,
  actionMessage,
  contactLabel,
  conversationView,
  detailUrl,
  durationMessage,
  formatCallTime,
  listUrl,
  outcomeKey,
} from "../../lib/calls/view";
import { CallDetailBody, CallRow, LoadMore } from "../../app/[locale]/dashboard/logs/calls-view";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const line = (over: Partial<CallLine> = {}): CallLine => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-11-10T09:30:00.000Z",
  fromNumber: "+972500000001",
  toNumber: "",
  contactName: null,
  outcome: "conversation",
  durationSeconds: null,
  hasTranscript: false,
  hasSummary: false,
  direction: "ltr",
  ...over,
});

const detail = (over: Partial<CallDetailResponse> = {}): CallDetailResponse => ({
  ...line(),
  summary: null,
  transcript: [],
  transcriptRaw: null,
  actions: [],
  ...over,
});

/** Renders `make(t)` inside the provider, with the Calls `t`. */
function render(locale: string, make: (t: ReturnType<typeof useTranslations<"Calls">>) => ReturnType<typeof createElement>) {
  function Harness() {
    const t = useTranslations("Calls");
    return make(t);
  }
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(Harness),
    ),
  );
}

const ALL_ACTIONS: CallAction[] = [
  { at: "2026-11-10T09:29:00Z", kind: "booked", date: "2026-11-12", time: "14:30" },
  { at: "2026-11-10T09:29:00Z", kind: "booked", date: "2026-11-12", time: null },
  { at: "2026-11-10T09:29:00Z", kind: "booked", date: null, time: null },
  { at: "2026-11-10T09:29:00Z", kind: "rescheduled", date: "2026-11-13", time: "10:00" },
  { at: "2026-11-10T09:29:00Z", kind: "rescheduled", date: "2026-11-13", time: null },
  { at: "2026-11-10T09:29:00Z", kind: "rescheduled", date: null, time: null },
  { at: "2026-11-10T09:29:00Z", kind: "cancelled" },
  { at: "2026-11-10T09:29:00Z", kind: "transferred", ok: true },
  { at: "2026-11-10T09:29:00Z", kind: "transferred", ok: false },
  ...(["caller", "owner"] as const).flatMap((recipient) =>
    (["sent", "undelivered", "failed"] as const).map(
      (status): CallAction => ({ at: "2026-11-10T09:31:00Z", kind: "whatsapp_recap", recipient, status }),
    ),
  ),
];

console.log("calls-page");

test("every outcome has words in fr / en / he", () => {
  for (const l of LOCALES) {
    const m = messages(l).Calls;
    for (const o of OUTCOMES) {
      const v = m[outcomeKey(o)];
      assert.ok(typeof v === "string" && v.trim(), `${l}: ${o}`);
    }
  }
  assert.equal(messages("fr").Calls.outcome_booked, "Rendez-vous pris");
  assert.equal(messages("fr").Calls.outcome_cancelled, "Rendez-vous annulé");
  assert.equal(messages("fr").Calls.outcome_rescheduled, "Rendez-vous déplacé");
  assert.equal(messages("fr").Calls.outcome_transferred, "Transféré");
  assert.equal(messages("fr").Calls.outcome_conversation, "Conversation");
  // An unknown value never leaks as a raw key.
  assert.equal(outcomeKey("weird" as CallOutcome), "outcome_conversation");
});

test("every action kind × variant has a sentence in fr / en / he", () => {
  const used = new Set(ALL_ACTIONS.map((a) => actionMessage(a, "fr").key));
  assert.deepEqual([...used].sort(), [...ACTION_KEYS].sort(), "every key is reachable");
  for (const l of LOCALES) {
    const m = messages(l).Calls;
    for (const k of ACTION_KEYS) assert.ok(typeof m[k] === "string" && m[k].trim(), `${l}: ${k}`);
  }
  for (const l of LOCALES) {
    const html = render(l, (t) =>
      createElement(CallDetailBody, {
        line: line(),
        detail: { status: "ready", data: detail({ actions: ALL_ACTIONS }) },
        onRetry: () => {},
        t,
        locale: l,
      }),
    );
    assert.ok(!/action_|\{date\}|\{time\}/.test(html), `${l}: no raw key / placeholder`);
  }
  const fr = render("fr", (t) =>
    createElement(CallDetailBody, {
      line: line(),
      detail: { status: "ready", data: detail({ actions: [ALL_ACTIONS[0], ALL_ACTIONS[8], ALL_ACTIONS[9]] }) },
      onRetry: () => {},
      t,
      locale: "fr",
    }),
  );
  assert.match(fr, /Rendez-vous pris pour le jeudi 12 novembre à 14:30/);
  assert.match(fr, /Transfert échoué/);
  assert.match(fr, /Récapitulatif WhatsApp envoyé au client/);
});

test("the three locales share the same Calls keys", () => {
  const keys = (l: string) => Object.keys(messages(l).Calls).sort();
  assert.deepEqual(keys("en"), keys("fr"));
  assert.deepEqual(keys("he"), keys("fr"));
});

test("no engineering words in the Calls namespace", () => {
  const banned =
    /\b(TTFA|TTFT|STT|TTS|LLM|SIP|tokens?|cost|coût|latenc\w*|webhook|API|uuid|id|call_?id|metadata|book_success|cancel_success|reschedule_success|call_transfer|whatsapp_(sent|failed|undelivered)\w*|event)\b/i;
  for (const l of LOCALES) {
    for (const [k, v] of Object.entries(messages(l).Calls as Record<string, string>)) {
      assert.ok(!banned.test(v), `${l}.${k}: "${v}"`);
    }
  }
});

test("a null duration is not rendered; a known one is", () => {
  assert.equal(durationMessage(null), null);
  assert.equal(durationMessage(0), null);
  assert.deepEqual(durationMessage(192), { key: "durationMinutesSeconds", values: { minutes: 3, seconds: 12 } });
  const row = (d: number | null) =>
    render("fr", (t) => createElement(CallRow, { line: line({ durationSeconds: d }), open: false, onToggle: () => {}, onRetry: () => {}, t, locale: "fr" }));
  assert.ok(!row(null).includes(" · "), "no duration on the line");
  assert.match(row(192), /3 min 12 s/);
  const body = (d: number | null, toNumber = "") =>
    render("fr", (t) =>
      createElement(CallDetailBody, {
        line: line(),
        detail: { status: "ready", data: detail({ durationSeconds: d, toNumber }) },
        onRetry: () => {},
        t,
        locale: "fr",
        moreOpen: true,
      }),
    );
  assert.ok(!body(null).includes("data-duration"));
  assert.ok(!body(null).includes("Plus de détails"), "nothing to disclose → no level 2");
  assert.ok(body(45).includes("data-duration"));
  assert.match(body(45), /45 s/);
});

test("the called number is rendered only when present, LTR-isolated", () => {
  const body = (toNumber: string) =>
    render("he", (t) =>
      createElement(CallDetailBody, {
        line: line(),
        detail: { status: "ready", data: detail({ toNumber, durationSeconds: 60 }) },
        onRetry: () => {},
        t,
        locale: "he",
        moreOpen: true,
      }),
    );
  assert.ok(!body("").includes("data-called-number"));
  assert.ok(!body("   ").includes("data-called-number"));
  const html = body("+97230000000");
  assert.match(html, /data-called-number="true"><bdi dir="ltr">\+972 3-000-0000<\/bdi>/);
  assert.match(html, /פרטים נוספים/);
});

test("the transcriptRaw fallback, and the bubbles", () => {
  assert.deepEqual(conversationView({ transcript: [], transcriptRaw: '{"x":1}' }), { kind: "raw", text: '{"x":1}' });
  assert.deepEqual(conversationView({ transcript: [], transcriptRaw: null }), { kind: "none" });
  assert.deepEqual(conversationView({ transcript: [{ role: "caller", text: "a" }], transcriptRaw: "x" }), { kind: "bubbles" });
  const raw = render("fr", (t) =>
    createElement(CallDetailBody, {
      line: line(),
      detail: { status: "ready", data: detail({ transcriptRaw: '{"garbled":true}' }) },
      onRetry: () => {},
      t,
      locale: "fr",
    }),
  );
  assert.ok(raw.includes("data-transcript-raw"));
  assert.ok(raw.includes("{&quot;garbled&quot;:true}"));
  const he = render("he", (t) =>
    createElement(CallDetailBody, {
      line: line({ direction: "rtl" }),
      detail: {
        status: "ready",
        data: detail({
          direction: "rtl",
          hasSummary: true,
          summary: "הלקוחה ביקשה תור",
          transcript: [
            { role: "agent", text: "שלום, כאן תמרה" },
            { role: "caller", text: "אני רוצה לקבוע תור" },
          ],
        }),
      },
      onRetry: () => {},
      t,
      locale: "he",
    }),
  );
  assert.ok(!he.includes("data-transcript-raw"));
  assert.match(he, /<div dir="rtl" class="flex flex-col gap-1\.5">/);
  assert.match(he, /<span class="sr-only">תמרה: <\/span>שלום, כאן תמרה/);
});

test("summary pending when there is no summary", () => {
  const html = render("fr", (t) =>
    createElement(CallDetailBody, { line: line(), detail: { status: "ready", data: detail() }, onRetry: () => {}, t, locale: "fr" }),
  );
  assert.match(html, /Résumé en cours…/);
  assert.match(html, /Aucune action pendant cet appel\./);
});

test("contact label: name, else LTR number, else hidden", () => {
  assert.deepEqual(contactLabel({ contactName: "Mock Dana", fromNumber: "+972500000001" }), { kind: "name", text: "Mock Dana" });
  assert.deepEqual(contactLabel({ contactName: "  ", fromNumber: "+33600000000" }), { kind: "number", text: "+33 6 00 00 00 00" });
  assert.deepEqual(contactLabel({ contactName: null, fromNumber: "" }), { kind: "hidden", key: "hiddenNumber" });
  const row = (l: CallLine, loc = "he") =>
    render(loc, (t) => createElement(CallRow, { line: l, open: false, onToggle: () => {}, onRetry: () => {}, t, locale: loc }));
  assert.match(row(line()), /<bdi dir="ltr">\+972 50-000-0001<\/bdi>/);
  assert.match(row(line({ fromNumber: "" }), "fr"), /Numéro masqué/);
  // The row is a button with aria-expanded, inside a list item.
  assert.match(row(line()), /^<li><button type="button" aria-expanded="false" aria-controls="call-/);
  assert.match(row(line({ outcome: "booked" }), "fr"), /Rendez-vous pris/);
});

test("time: today → time only; another day → date + time", () => {
  const now = new Date("2026-11-10T18:00:00Z");
  assert.equal(formatCallTime("2026-11-10T09:30:00Z", "fr", now, "UTC"), "09:30");
  const other = formatCallTime("2026-11-08T09:30:00Z", "fr", now, "UTC");
  assert.match(other, /8 nov\.?/);
  assert.match(other, /09:30/);
  assert.match(formatCallTime("2026-11-08T09:30:00Z", "he", now, "UTC"), /09:30/);
});

test('"Show more" cursor wiring', () => {
  // First page: default period, no cursor. Next pages: ONLY the cursor (+ asUserId).
  assert.equal(listUrl(null), "/api/dashboard/calls");
  assert.equal(listUrl("abc_-1"), "/api/dashboard/calls?cursor=abc_-1");
  assert.equal(listUrl("abc", "u-1"), "/api/dashboard/calls?cursor=abc&asUserId=u-1");
  assert.equal(listUrl(null, "u-1"), "/api/dashboard/calls?asUserId=u-1");
  assert.equal(detailUrl("id-1", "u-1"), "/api/dashboard/calls/id-1?asUserId=u-1");
  const more = (c: string | null, status: "idle" | "loading" | "error" = "idle") =>
    render("fr", (t) => createElement(LoadMore, { nextCursor: c, status, onMore: () => {}, t }));
  assert.equal(more(null), "", "no cursor → no button");
  assert.match(more("next"), /<button[^>]*>Voir plus<\/button>/);
  assert.match(more("next", "loading"), /disabled=""[^>]*>Chargement…/);
  // The view requests the next page with the API's nextCursor, through listUrl.
  const src = read("app/[locale]/dashboard/logs/calls-view.tsx");
  assert.match(src, /fetch\(listUrl\(cursor, asUserId\)/);
  assert.match(src, /fetchPage\(nextCursor\)/);
  assert.match(src, /setNextCursor\(page\.nextCursor\)/);
  assert.ok(!/IntersectionObserver|onScroll/.test(src), "no infinite scroll");
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("all passed");
