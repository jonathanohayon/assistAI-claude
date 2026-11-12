// Owner WhatsApp card, Test button, against the hardened route (PR #301):
// every answer maps to one of our lines (never the server's text), the
// Retry-After header becomes minutes, Test is disabled with a reason until
// the typed number is saved, ?asUserId scopes the admin view, the campaign
// agent editor no longer calls the route, and fr/en/he carry the same keys.
// Renders the REAL NotifsPanel. Mock data only (+972500000000).
// Run with:  npx tsx scripts/tests/whatsapp-test-codes.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotifsPanel } from "../../app/[locale]/dashboard/config/notifs-panel";
import type { FormState } from "../../app/[locale]/dashboard/config/types";
import {
  WHATSAPP_TEST_KEYS,
  sameWhatsappNumber,
  whatsappTestBlock,
  whatsappTestResult,
  whatsappTestUrl,
} from "../../app/[locale]/dashboard/config/whatsapp-test";
import { runWhatsAppTest, type WhatsAppTestDeps } from "../../lib/notifications/whatsapp-test";
import { retryAfterMinutes } from "../../lib/retry-after";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const MOCK = "+972500000000";

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

async function main() {
// ─── 1. Each code → our line ─────────────────────────────────────────────

await test("every route answer maps to its own line", () => {
  const cases: [number, unknown, string | null, string, number?][] = [
    [200, { ok: true }, null, "whatsappTestSent"],
    [400, { error: "invalid_number" }, null, "whatsappTestInvalidNumber"],
    [401, { error: "Unauthorized" }, null, "whatsappTestUnauthorized"],
    [403, { error: "Forbidden" }, null, "whatsappTestForbidden"],
    [403, { error: "recipient_not_allowed" }, null, "whatsappTestRecipientNotAllowed"],
    [409, { error: "no_saved_number" }, null, "whatsappTestNoSavedNumber"],
    [429, { error: "rate_limited", scope: "account" }, "3600", "whatsappTestRateLimited", 60],
    [429, { error: "rate_limited", scope: "global" }, "61", "whatsappTestRateLimited", 2],
    [429, { error: "rate_limited", scope: "account" }, null, "whatsappTestRateLimitedNoTime"],
    [502, { error: "send_failed" }, null, "whatsappTestSendFailed"],
    [503, { error: "not_configured" }, null, "whatsappTestNotConfigured"],
  ];
  for (const [status, body, ra, key, minutes] of cases) {
    const r = whatsappTestResult(status, body, ra);
    assert.equal(r.key, key, `${status} ${JSON.stringify(body)}`);
    assert.equal(r.minutes, minutes, `${status} minutes`);
  }
});

await test("unknown answers, missing bodies and 200 without ok fall back to the generic line", () => {
  for (const [status, body] of [
    [500, { error: "boom" }],
    [200, {}],
    [200, null],
    [502, null],
    [503, { error: "something else" }],
    [418, "text"],
    [0, null],
  ] as const) {
    assert.equal(whatsappTestResult(status, body).key, "whatsappTestFailed", `${status} ${JSON.stringify(body)}`);
  }
});

await test("the route's real answers (driven with fake deps) map to the expected lines", async () => {
  const deps = (over: Partial<WhatsAppTestDeps> = {}): WhatsAppTestDeps => ({
    loadSavedNumber: async () => MOCK,
    consumeRateLimit: async () => ({ ok: true }) as never,
    isConfigured: () => true,
    templateSid: () => undefined,
    send: async () => ({ ok: true }) as never,
    logFailure: () => {},
    ...over,
  });
  const run = async (d: WhatsAppTestDeps, body: unknown = { to: MOCK }) => {
    const out = await runWhatsAppTest({ userId: "u_mock", displayName: null, body }, d);
    return whatsappTestResult(out.status, out.body, out.headers?.["Retry-After"] ?? null);
  };
  assert.equal((await run(deps())).key, "whatsappTestSent");
  assert.equal((await run(deps({ loadSavedNumber: async () => "" }))).key, "whatsappTestNoSavedNumber");
  assert.equal((await run(deps(), { to: "+972500000001" })).key, "whatsappTestRecipientNotAllowed");
  assert.equal((await run(deps(), { to: "abc" })).key, "whatsappTestInvalidNumber");
  assert.equal((await run(deps({ isConfigured: () => false }))).key, "whatsappTestNotConfigured");
  assert.equal((await run(deps({ send: async () => ({ ok: false, error: "x" }) as never }))).key, "whatsappTestSendFailed");
  const limited = await run(deps({ consumeRateLimit: async () => ({ ok: false, scope: "account", retryAfterSec: 1500 }) as never }));
  assert.deepEqual(limited, { key: "whatsappTestRateLimited", minutes: 25 });
});

// ─── 2. Retry-After ──────────────────────────────────────────────────────

await test("Retry-After seconds become whole minutes, rounded up, at least 1", () => {
  assert.equal(retryAfterMinutes("1"), 1);
  assert.equal(retryAfterMinutes("59"), 1);
  assert.equal(retryAfterMinutes("60"), 1);
  assert.equal(retryAfterMinutes("61"), 2);
  assert.equal(retryAfterMinutes(" 3600 "), 60);
  for (const bad of [null, undefined, "", "0", "-5", "1.5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
    assert.equal(retryAfterMinutes(bad), null, `bad header ${String(bad)}`);
  }
});

// ─── 3. Disabled with a reason ───────────────────────────────────────────

await test("block rules: nothing saved, typed differs, same number in another spelling", () => {
  assert.equal(whatsappTestBlock("", ""), "whatsappTestNeedsSaved");
  assert.equal(whatsappTestBlock("   ", "  "), "whatsappTestNeedsSaved");
  assert.equal(whatsappTestBlock("", MOCK), "whatsappTestSaveFirst", "typed, never saved");
  assert.equal(whatsappTestBlock("   ", MOCK), "whatsappTestSaveFirst");
  assert.equal(whatsappTestBlock("+12", "+12"), "whatsappTestNeedsSaved", "too short for the route");
  assert.equal(whatsappTestBlock(MOCK, "+972500000001"), "whatsappTestSaveFirst");
  assert.equal(whatsappTestBlock(MOCK, ""), "whatsappTestSaveFirst", "switched off = number cleared, not saved yet");
  assert.equal(whatsappTestBlock(MOCK, MOCK), null);
  assert.equal(whatsappTestBlock(MOCK, "972 50-000-0000"), null, "same number, other spelling");
  assert.equal(whatsappTestBlock(MOCK, "whatsapp:+972 (50) 000 0000"), null);
  assert.ok(sameWhatsappNumber("+972500000000", "972500000000"));
  assert.ok(!sameWhatsappNumber("", ""));
});

const formWith = (ownerWhatsapp: string) =>
  ({
    ownerWhatsapp,
    transferNumber: "",
    reminderEnabled: false,
    ownerDigestEnabled: false,
    ownerDigestHour: 20,
  }) as unknown as FormState;

function render(locale: string, props: { form: FormState; ownerWhatsappSaved?: string; asUserId?: string | null }) {
  function Panel() {
    const t = useTranslations("DashboardConfig");
    return createElement(NotifsPanel, { update: () => {}, t, ...props });
  }
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(Panel),
    ),
  );
}

const escape = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** The WhatsApp card's Test button tag. */
const testButton = (html: string) => {
  const m = html.match(/<button[^>]*aria-describedby="[^"]*-test"[^>]*>/);
  assert.ok(m, "Test button rendered");
  return m[0];
};

await test("rendered card: Test disabled with the reason, enabled once saved", () => {
  for (const locale of LOCALES) {
    const dc = messages(locale).DashboardConfig;
    // Nothing saved yet.
    {
      const html = render(locale, { form: formWith(""), ownerWhatsappSaved: "" });
      const btn = testButton(html);
      assert.match(btn, /disabled=""/, `${locale}: disabled when nothing saved`);
      assert.match(btn, /data-test-block="whatsappTestNeedsSaved"/);
      assert.ok(html.includes(escape(dc.whatsappTestNeedsSaved)), `${locale}: needs-saved reason shown`);
    }
    // Typed number differs from the saved one.
    {
      const html = render(locale, { form: formWith("+972500000001"), ownerWhatsappSaved: MOCK });
      const btn = testButton(html);
      assert.match(btn, /disabled=""/, `${locale}: disabled when typed differs`);
      assert.ok(html.includes(escape(dc.whatsappTestSaveFirst)), `${locale}: save-first reason shown`);
    }
    // Typed but never saved (the panel default for a missing prop is "nothing saved").
    {
      const html = render(locale, { form: formWith(MOCK) });
      assert.match(testButton(html), /disabled=""/, `${locale}: no saved prop = disabled`);
      assert.ok(html.includes(escape(dc.whatsappTestSaveFirst)), `${locale}: typed-not-saved reason shown`);
    }
    // Saved and unchanged: enabled, no reason line.
    {
      const html = render(locale, { form: formWith(MOCK), ownerWhatsappSaved: MOCK });
      const btn = testButton(html);
      assert.doesNotMatch(btn, / disabled=""/, `${locale}: enabled when saved`);
      assert.ok(!html.includes(escape(dc.whatsappTestSaveFirst)) && !html.includes(escape(dc.whatsappTestNeedsSaved)));
    }
  }
});

await test("the card never renders the server's text or a hard-coded failure word", () => {
  const card = read("app/[locale]/dashboard/config/notif-channel-card.tsx");
  assert.doesNotMatch(card, /data\.error|\.hint\b|e\.message|HTTP \$\{/, "no server text or raw status shown");
  assert.doesNotMatch(card, /Échec/, "no hard-coded French word");
  assert.match(card, /whatsappTestResult\(res\.status, await res\.json\(\)\.catch\(\(\) => null\), res\.headers\.get\("Retry-After"\)\)/);
  // The body only ever carries the saved number.
  assert.match(card, /JSON\.stringify\(\{ to: test\.saved \}\)/);
});

// ─── 4. ?asUserId ────────────────────────────────────────────────────────

await test("?asUserId on the test URL for the admin tenant view", () => {
  assert.equal(whatsappTestUrl(), "/api/dashboard/notifications/whatsapp-test");
  assert.equal(whatsappTestUrl(null), "/api/dashboard/notifications/whatsapp-test");
  assert.equal(whatsappTestUrl(""), "/api/dashboard/notifications/whatsapp-test");
  assert.equal(whatsappTestUrl("u_mock 1&x"), "/api/dashboard/notifications/whatsapp-test?asUserId=u_mock%201%26x");
  const card = read("app/[locale]/dashboard/config/notif-channel-card.tsx");
  assert.match(card, /fetch\(whatsappTestUrl\(test\.asUserId\)/, "the card fetches the scoped URL");
  const panel = read("app/[locale]/dashboard/config/notifs-panel.tsx");
  assert.match(panel, /test=\{\{ saved: ownerWhatsappSaved, asUserId \}\}/, "the panel passes asUserId to the card");
  const form = read("app/[locale]/dashboard/config-form.tsx");
  assert.match(form, /<NotifsPanel[^>]*ownerWhatsappSaved=\{ownerWhatsappBase\}[^>]*asUserId=\{asUserId \?\? null\}/, "config-form passes the saved number and asUserId");
  assert.match(form, /setOwnerWhatsappBase\(rest\.ownerWhatsapp\)/, "the saved number follows a successful save");
});

// ─── 5. Campaign agent editor ────────────────────────────────────────────

await test("the campaign agent editor no longer calls whatsapp-test and keeps its field", () => {
  const editor = read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx");
  assert.doesNotMatch(editor, /whatsapp-test/, "no call to the test route");
  assert.doesNotMatch(editor, /testEndpoint/, "no test endpoint prop left");
  assert.doesNotMatch(editor, /wowTestButton|wowTestSending|wowTestSent/, "no Test button left");
  assert.match(editor, /label=\{t\("notifsWhatsappLabel"\)\}/, "the WhatsApp field stays");
  // Its help texts promise no test.
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    for (const k of ["notifsHint", "notifsWhatsappLabel"]) {
      assert.ok(dc[k], `${l}: ${k} exists`);
      assert.doesNotMatch(dc[k], /test|בדיק/i, `${l}: ${k} promises no test`);
    }
  }
});

// ─── 5b. The WhatsApp switch (RTL knob + 44 px hit area) ─────────────────

await test("the WhatsApp switch: 44 px hit area, knob mirrored in RTL, same aria", () => {
  for (const [locale, on] of [["he", true], ["he", false], ["fr", true]] as const) {
    const html = render(locale, { form: formWith(on ? MOCK : ""), ownerWhatsappSaved: MOCK });
    // The WhatsApp switch is the first switch of the panel.
    const sw = html.match(/<button[^>]*role="switch"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(sw, `${locale}: switch rendered`);
    const [tag] = sw[0].match(/<button[^>]*>/)!;
    assert.match(tag, /\bh-11\b/, `${locale}: 44 px tall hit area`);
    assert.match(tag, /\bmin-w-11\b/, `${locale}: at least 44 px wide`);
    assert.match(tag, /focus-visible:ring-2/, `${locale}: visible focus`);
    assert.match(tag, new RegExp(`aria-checked="${on}"`), `${locale}: aria-checked follows the state`);
    const knob = sw[1].match(/<span[^>]*data-switch-knob[^>]*>/)?.[0] ?? "";
    assert.ok(knob, `${locale}: knob rendered`);
    // No physical inline transform (the old knob slid out of the track in RTL).
    assert.doesNotMatch(knob, /style="[^"]*translateX/, `${locale}: no physical translateX`);
    if (on) assert.match(knob, /translate-x-5 rtl:-translate-x-5/, `${locale}: knob mirrored in RTL`);
    else assert.match(knob, /translate-x-0/, `${locale}: knob at the start when off`);
    // The 28 px track is still the visual.
    assert.match(sw[1], /data-switch-track[^>]*class="[^"]*\bh-7 w-12\b/, `${locale}: 28 px track kept`);
  }
  // Behaviour unchanged: the switch still calls onToggle(!on), and turning
  // WhatsApp off still clears the number in the panel.
  const card = read("app/[locale]/dashboard/config/notif-channel-card.tsx");
  assert.match(card, /onClick=\{\(\) => onToggle\(!on\)\}/);
  const panel = read("app/[locale]/dashboard/config/notifs-panel.tsx");
  assert.match(panel, /if \(!v\) update\("ownerWhatsapp", ""\)/);
});

// ─── 6. Same keys in fr/en/he ────────────────────────────────────────────

await test("fr/en/he carry every key, non-empty, with the same placeholders", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of WHATSAPP_TEST_KEYS) {
    const vals = LOCALES.map((l) => messages(l).DashboardConfig[k] as string | undefined);
    vals.forEach((v, i) => assert.ok(typeof v === "string" && v.trim(), `${LOCALES[i]}: ${k} present`));
    const ph = vals.map((v) => placeholders(v!));
    assert.ok(ph.every((p) => p === ph[0]), `${k}: same placeholders ${ph.join(" | ")}`);
    // Our own words: no provider name, no env var, no raw code.
    for (const v of vals) assert.doesNotMatch(v!, /twilio|TWILIO_|_SID|\b[a-z]+_[a-z_]+\b/i, `${k}: no provider or code`);
  }
  assert.match(messages("fr").DashboardConfig.whatsappTestSaveFirst, /Enregistrez le numéro avant de le tester/);
  assert.match(messages("en").DashboardConfig.whatsappTestRateLimited, /\{minutes\}/);
  assert.match(messages("en").DashboardConfig.whatsappTestSent, /\{number\}/);
});

console.log(`whatsapp-test-codes: ${passed} ok`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
