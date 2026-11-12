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
  OUTCOME_FILTERS,
  PERIOD_CHOICES,
  actionMessage,
  emptyState,
  listHeading,
  periodKey,
  periodRange,
  contactLabel,
  conversationView,
  detailUrl,
  durationMessage,
  formatCallTime,
  listUrl,
  outcomeKey,
} from "../../lib/calls/view";
import {
  CallDetailBody,
  CallRow,
  CallsEmpty,
  CallsFigures,
  ListHeading,
  LoadMore,
  OutcomeFilterChips,
} from "../../app/[locale]/dashboard/logs/calls-view";

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
  // Level 2 never repeats the duration (it's on the line); without a called number there is no level 2.
  assert.ok(!body(null).includes("data-duration") && !body(45).includes("data-duration"));
  assert.ok(!body(45).includes("Plus de détails"), "nothing to disclose → no level 2");
  assert.ok(body(45, "+972300000000").includes("Plus de détails"));
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
  // No filter / period given: bare URL. Next pages: ONLY the cursor (+ asUserId).
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
  assert.match(src, /fetch\(listUrl\(cursor, asUserId, filter, range\)/);
  assert.match(src, /fetchPage\(nextCursor\)/);
  assert.match(src, /setNextCursor\(page\.nextCursor\)/);
  assert.ok(!/IntersectionObserver|onScroll/.test(src), "no infinite scroll");
});

test("list URL: filter + period on page 1, cursor only after", () => {
  const range = { since: "2026-11-01T00:00:00.000Z", until: "2026-11-12T10:00:00.000Z" };
  const first = new URL(listUrl(null, undefined, "booked", range), "http://x");
  assert.equal(first.pathname, "/api/dashboard/calls");
  assert.equal(first.searchParams.get("outcome"), "booked");
  assert.equal(first.searchParams.get("since"), range.since);
  assert.equal(first.searchParams.get("until"), range.until);
  assert.equal(first.searchParams.get("cursor"), null);
  // "All" sends no outcome at all (the API rejects an empty one).
  assert.ok(!listUrl(null, undefined, "all", range).includes("outcome"));
  // Later pages: the cursor carries the filter and the period.
  assert.equal(listUrl("cur", undefined, "booked", range), "/api/dashboard/calls?cursor=cur");
  assert.equal(listUrl("cur", "u-1", "cancelled", range), "/api/dashboard/calls?cursor=cur&asUserId=u-1");
  // The view: page 1 with filter + period; "Show more" with only the cursor.
  const src = read("app/[locale]/dashboard/logs/calls-view.tsx");
  assert.match(src, /fetchPage\(null, outcome, periodChoice\)/);
  assert.match(src, /fetchPage\(nextCursor\);/);
  // A change resets the list and closes the detail.
  const restart = src.slice(src.indexOf("const restart"), src.indexOf("const pickOutcome"));
  assert.match(restart, /setItems\(\[\]\)/);
  assert.match(restart, /setOpenId\(null\)/);
  assert.match(restart, /setNextCursor\(null\)/);
});

test("period: 7 / 30 days rolling, this month from the 1st 00:00 local", () => {
  const now = new Date("2026-11-12T10:00:00.000Z");
  assert.deepEqual(periodRange("7d", now), { since: "2026-11-05T10:00:00.000Z", until: now.toISOString() });
  assert.deepEqual(periodRange("30d", now), { since: "2026-10-13T10:00:00.000Z", until: now.toISOString() });
  // Jerusalem in November = UTC+2: the 1st at 00:00 local = Oct 31 22:00 UTC.
  assert.equal(periodRange("month", now, "Asia/Jerusalem").since, "2026-10-31T22:00:00.000Z");
  assert.equal(periodRange("month", now, "UTC").since, "2026-11-01T00:00:00.000Z");
  // On the 1st itself (local), the month starts that day.
  const first = new Date("2026-11-01T05:00:00.000Z");
  assert.equal(periodRange("month", first, "Asia/Jerusalem").since, "2026-10-31T22:00:00.000Z");
  // Month change by time zone: Nov 30 23:30 UTC is already Dec 1 in Jerusalem.
  const edge = new Date("2026-11-30T23:30:00.000Z");
  assert.equal(periodRange("month", edge, "Asia/Jerusalem").since, "2026-11-30T22:00:00.000Z");
  assert.equal(periodRange("month", edge, "UTC").since, "2026-11-01T00:00:00.000Z");
  // A month starting in summer time (Jerusalem UTC+3 on Oct 1).
  assert.equal(periodRange("month", new Date("2026-10-15T12:00:00Z"), "Asia/Jerusalem").since, "2026-09-30T21:00:00.000Z");
  // New York, March (DST starts Mar 8): Mar 1 00:00 EST = 05:00 UTC.
  assert.equal(periodRange("month", new Date("2026-03-20T12:00:00Z"), "America/New_York").since, "2026-03-01T05:00:00.000Z");
  // Without a zone: the runtime's local midnight of the 1st.
  const local = new Date(periodRange("month", now).since);
  assert.equal(local.getDate(), 1);
  assert.equal(local.getHours(), 0);
  assert.equal(local.getMinutes(), 0);
  // Every period word exists.
  for (const l of LOCALES) for (const c of PERIOD_CHOICES) assert.ok(messages(l).Calls[periodKey(c)]?.trim(), `${l}: ${c}`);
  assert.deepEqual(PERIOD_CHOICES.map((c) => messages("fr").Calls[periodKey(c)]), ["7 jours", "30 jours", "Ce mois-ci"]);
});

test("the filter's words are the badges' words in fr / en / he", () => {
  assert.deepEqual(OUTCOME_FILTERS.map((o) => o.id), ["all", ...OUTCOMES]);
  for (const l of LOCALES) {
    const chips = render(l, (t) => createElement(OutcomeFilterChips, { selected: "booked", onPick: () => {}, t }));
    const words = [...chips.matchAll(/role="radio"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    const badge = (o: CallOutcome) => {
      const row = render(l, (t) =>
        createElement(CallRow, { line: line({ outcome: o }), open: false, onToggle: () => {}, onRetry: () => {}, t, locale: l }),
      );
      return row.match(/rounded-full px-2\.5 py-1[^"]*">([^<]*)</)![1];
    };
    assert.deepEqual(words, [messages(l).Calls.filterAll, ...OUTCOMES.map(badge)], l);
    // Radio semantics: one checked, roving tabindex; the chips wrap.
    assert.match(chips, /role="radiogroup"/);
    assert.equal((chips.match(/aria-checked="true"/g) ?? []).length, 1);
    assert.match(chips, /aria-checked="true" data-id="booked" tabindex="0"/);
    assert.match(chips, /flex-wrap/);
  }
  assert.ok(render("fr", (t) => createElement(OutcomeFilterChips, { selected: "all", onPick: () => {}, t })).includes(">Tous<"));
});

test("empty state with a filter names it and offers all calls", () => {
  assert.deepEqual(emptyState("all"), { kind: "plain" });
  assert.deepEqual(emptyState("booked"), { kind: "filtered", outcomeKey: "outcome_booked" });
  const fr = render("fr", (t) => createElement(CallsEmpty, { outcome: "booked", onShowAll: () => {}, t }));
  assert.match(fr, /Aucun appel « Rendez-vous pris » sur cette période/);
  assert.match(fr, /data-show-all="true"[^>]*>Voir tous les appels</);
  const plain = render("fr", (t) => createElement(CallsEmpty, { outcome: "all", onShowAll: () => {}, t }));
  assert.match(plain, /Aucun appel sur cette période/);
  assert.ok(!plain.includes("data-show-all"));
  for (const l of LOCALES) {
    for (const o of OUTCOMES) {
      const html = render(l, (t) => createElement(CallsEmpty, { outcome: o, onShowAll: () => {}, t }));
      assert.ok(html.includes(messages(l).Calls[outcomeKey(o)]), `${l}: ${o} named`);
      assert.ok(!/\{outcome\}|outcome_/.test(html), `${l}: no raw key`);
    }
  }
});

test("figures are labelled period-wide; the list heading states the filter", () => {
  const figures = { callsReceived: 40, booked: 12, transferred: 3 };
  const unfiltered = render("fr", (t) => createElement(CallsFigures, { figures, filtered: false, t }));
  assert.match(unfiltered, /role="group" aria-labelledby="([^"]+)"[\s\S]*id="\1"[^>]*>Sur la période</);
  assert.ok(!unfiltered.includes("data-figures-note"));
  const filtered = render("fr", (t) => createElement(CallsFigures, { figures, filtered: true, t }));
  assert.match(filtered, /Tous les appels de la période, quel que soit le filtre/);
  // The tiles show the API's period figures as given, whatever the filter.
  assert.ok(filtered.includes(">40<") && filtered.includes(">12<") && filtered.includes(">3<"));
  for (const l of LOCALES) {
    assert.ok(messages(l).Calls.figuresLabel.trim() && messages(l).Calls.figuresAllCalls.trim(), l);
  }
  // Heading: the filter's name; the count only when every page is loaded.
  assert.deepEqual(listHeading("booked", 12, false), { labelKey: "outcome_booked", count: null });
  assert.deepEqual(listHeading("booked", 12, true), { labelKey: "outcome_booked", count: 12 });
  assert.deepEqual(listHeading("all", 0, true), { labelKey: "listHeadingAll", count: null });
  const h = (o: "all" | CallOutcome, n: number, complete: boolean, l = "fr") =>
    render(l, (t) => createElement(ListHeading, { level: "h2", outcome: o, shown: n, complete, t }));
  assert.match(h("booked", 12, true), /<h2[^>]*>Rendez-vous pris · 12 appels<\/h2>/);
  assert.match(h("booked", 1, true), /Rendez-vous pris · 1 appel</);
  assert.match(h("booked", 50, false), /<h2[^>]*>Rendez-vous pris<\/h2>/);
  assert.match(h("all", 50, false), />Tous les appels</);
  assert.match(h("transferred", 2, true, "he"), /השיחה הועברה · 2 שיחות/);
  // The view announces each refresh politely.
  const src = read("app/[locale]/dashboard/logs/calls-view.tsx");
  assert.match(src, /aria-live="polite"[\s\S]{0,200}t\("listShown"/);
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("all passed");
