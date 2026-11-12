// Owner post-call recap by email: the card in the Notifications panel.
// Renders the REAL NotifsPanel (and its OwnerEmailCard) to static HTML in
// fr/en/he and drives the pure rules in config/owner-email.ts. Mock data
// only (owner@example.test), no network.
// Run with:  npx tsx scripts/tests/owner-email-card.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotifsPanel } from "../../app/[locale]/dashboard/config/notifs-panel";
import {
  OWNER_EMAIL_DEFAULTS,
  ownerEmailSaveBody,
  ownerEmailSaveError,
  ownerEmailStateKey,
  ownerEmailTestBlock,
  ownerEmailTestResult,
  ownerEmailTestUrl,
  ownerEmailUrl,
  setOwnerEmailAddress,
  toggleOwnerEmail,
  type OwnerEmailErrorKey,
  type OwnerEmailSettings,
} from "../../app/[locale]/dashboard/config/owner-email";
import type { FormState } from "../../app/[locale]/dashboard/config/types";
import { hits } from "../tenant-bundle-match.mjs";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const ADDR = "owner@example.test";
const form = {
  ownerWhatsapp: "+972500000000",
  transferNumber: "",
  reminderEnabled: true,
  ownerDigestEnabled: true,
  ownerDigestHour: 20,
} as unknown as FormState;

const S = (ownerRecapEmail: string, ownerRecapEmailEnabled: boolean): OwnerEmailSettings => ({
  ownerRecapEmail,
  ownerRecapEmailEnabled,
});

function Panel(props: { value: OwnerEmailSettings; base: OwnerEmailSettings; error: OwnerEmailErrorKey | null; locale: string }) {
  const t = useTranslations("DashboardConfig");
  return createElement(NotifsPanel, {
    form,
    update: () => {},
    t,
    ownerEmail: { ...props, onChange: () => {}, recapFeatureOn: true },
  });
}

function render(locale: string, value: OwnerEmailSettings, base = value, error: OwnerEmailErrorKey | null = null) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: messages(locale),
        timeZone: "UTC",
        onError: (e: Error) => {
          throw e;
        },
      } as unknown as ProviderProps,
      createElement(Panel, { value, base, error, locale }),
    ),
  );
}
const card = (html: string) => {
  const start = html.indexOf('data-card="owner-email"');
  assert.ok(start > 0, "owner email card rendered");
  // The card ends where the next sibling card (transfer number) starts.
  return html.slice(start);
};
const switchOf = (html: string) => card(html).match(/<button[^>]*role="switch"[^>]*>/)![0];

// 1. The card renders in fr/en/he, with a visible label, an LTR email input.
for (const l of LOCALES) {
  const dc = messages(l).DashboardConfig;
  const html = render(l, S(ADDR, true));
  const c = card(html);
  assert.ok(c.includes(`>${esc(dc.ownerEmailTitle)}<`), `${l}: title`);
  const label = c.match(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/);
  assert.ok(label && label[2] === esc(dc.ownerEmailLabel), `${l}: visible label`);
  const input = c.match(/<input[^>]*>/)![0];
  assert.ok(input.includes(`id="${label![1]}"`), `${l}: label bound to the input`);
  for (const attr of ['type="email"', 'autoComplete="email"', 'dir="ltr"', `value="${ADDR}"`])
    assert.ok(input.includes(attr), `${l}: input ${attr}`);
  assert.ok(c.includes(`>${esc(dc.wowTestButton)}<`), `${l}: Test button`);
  // WhatsApp is still there, before the email card.
  assert.ok(html.indexOf(">WhatsApp<") > 0 && html.indexOf(">WhatsApp<") < html.indexOf('data-card="owner-email"'), `${l}: after WhatsApp`);
  // Touch targets: switch, input and Test button are at least 44px.
  assert.match(switchOf(html), /h-11 min-w-11/, `${l}: 44px switch`);
  assert.match(input, /min-h-11/, `${l}: 44px input`);
  assert.match(c.match(/<button(?![^>]*role="switch")[^>]*>/)![0], /min-h-11/, `${l}: 44px Test`);
  if (l === "he") {
    assert.match(c, /[֐-׿]/, "he: Hebrew copy");
    assert.ok(!c.includes(esc(messages("fr").DashboardConfig.ownerEmailTitle)), "he: no French title");
  }
}

// 2. SMS is still hidden; the card is absent until its settings are loaded.
for (const l of LOCALES) {
  const html = render(l, S(ADDR, true));
  assert.doesNotMatch(html, /\bSMS\b/, `${l}: no SMS card`);
  assert.doesNotMatch(html, /type="tel"[^>]*sms/i, `${l}: no SMS input`);
  const notLoaded = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: l, messages: messages(l), timeZone: "UTC" } as ProviderProps,
      createElement(function P() {
        const t = useTranslations("DashboardConfig");
        return createElement(NotifsPanel, { form, update: () => {}, t, ownerEmail: null });
      }),
    ),
  );
  assert.doesNotMatch(notLoaded, /owner-email|type="email"/, `${l}: no card before load`);
}

// 3. The switch is independent of the address.
{
  // On with no address: on. Off with an address: off, address kept on screen.
  assert.match(switchOf(render("fr", S("", true))), /aria-checked="true"/);
  const offWith = render("fr", S(ADDR, false));
  assert.match(switchOf(offWith), /aria-checked="false"/);
  assert.ok(card(offWith).match(/<input[^>]*>/)![0].includes(`value="${ADDR}"`), "off keeps the address");
  // The input is never disabled by the switch.
  assert.doesNotMatch(card(offWith).match(/<input[^>]*>/)![0], / disabled=""/, "input usable when off");
  // Handlers: toggling keeps the address; clearing the address keeps the switch.
  assert.deepEqual(toggleOwnerEmail(S(ADDR, true)), S(ADDR, false));
  assert.deepEqual(toggleOwnerEmail(S("", false)), S("", true));
  assert.deepEqual(setOwnerEmailAddress(S(ADDR, true), ""), S("", true));
  assert.deepEqual(setOwnerEmailAddress(S("", false), ADDR), S(ADDR, false));
  // The card source uses them, never a value-derived "on".
  const src = read("app/[locale]/dashboard/config/owner-email-card.tsx");
  assert.match(src, /const on = value\.ownerRecapEmailEnabled;/);
  assert.match(src, /onChange\(toggleOwnerEmail\(value\)\)/);
  assert.match(src, /onChange\(setOwnerEmailAddress\(value, e\.target\.value\)\)/);
}

// 4. The PUT body carries only changed fields.
{
  const base = S(ADDR, false);
  assert.deepEqual(ownerEmailSaveBody(base, base), {}, "nothing changed");
  assert.deepEqual(ownerEmailSaveBody(base, S(ADDR, true)), { ownerRecapEmailEnabled: true }, "switch only");
  assert.deepEqual(ownerEmailSaveBody(base, S("new@example.test", false)), { ownerRecapEmail: "new@example.test" }, "address only");
  assert.deepEqual(ownerEmailSaveBody(base, S("", false)), { ownerRecapEmail: "" }, "clearing sends an empty string");
  assert.deepEqual(ownerEmailSaveBody(base, S("x@example.test", true)), { ownerRecapEmail: "x@example.test", ownerRecapEmailEnabled: true });
  // Same address once normalised (case, spaces): unchanged, stays absent.
  assert.deepEqual(ownerEmailSaveBody(base, S("  Owner@Example.TEST ", false)), {});
  // A changed address is sent trimmed.
  assert.deepEqual(ownerEmailSaveBody(S("", true), S("  a@example.test ", true)), { ownerRecapEmail: "a@example.test" });
  assert.deepEqual(ownerEmailSaveBody(OWNER_EMAIL_DEFAULTS, OWNER_EMAIL_DEFAULTS), {});
  // config-form sends exactly that body, and only when it is not empty.
  const cf = read("app/[locale]/dashboard/config-form.tsx");
  assert.match(cf, /const echanges = ownerEmailSaveBody\(ownerEmailBase, ownerEmail\);\s+if \(Object\.keys\(echanges\)\.length > 0\)/);
  assert.match(cf, /body: JSON\.stringify\(echanges\)/);
}

// 5. Each refusal maps to our line; the server's text is never shown.
{
  assert.equal(ownerEmailSaveError(400, { error: "invalid_email", fields: ["ownerRecapEmail"] }), "ownerEmailErrInvalid");
  assert.equal(ownerEmailSaveError(400, { error: "invalid_boolean", fields: ["ownerRecapEmailEnabled"] }), "ownerEmailErrSave");
  assert.equal(ownerEmailSaveError(400, { error: "invalid_json" }), "ownerEmailErrSave");
  assert.equal(ownerEmailSaveError(400, null), "ownerEmailErrSave");
  assert.equal(ownerEmailSaveError(403, { error: "forbidden" }), "ownerEmailErrForbidden");
  assert.equal(ownerEmailSaveError(404, { error: "no_config" }), "ownerEmailErrNoConfig");
  assert.equal(ownerEmailSaveError(500, { error: "Some server text" }), "ownerEmailErrSave");
  assert.equal(ownerEmailSaveError(0, null), "ownerEmailErrSave", "network failure");
  for (const l of LOCALES) {
    const dc = messages(l).DashboardConfig;
    for (const key of ["ownerEmailErrInvalid", "ownerEmailErrSave", "ownerEmailErrForbidden", "ownerEmailErrNoConfig"] as const) {
      const c = card(render(l, S("not-an-email", true), S("", false), key));
      const alert = c.match(/<p id="([^"]+)" role="alert"[^>]*>([^<]*)<\/p>/);
      assert.ok(alert && alert[2] === esc(dc[key]), `${l}/${key}: our line in role=alert`);
      // Linked to the field for screen readers; invalid only for invalid_email.
      const input = c.match(/<input[^>]*>/)![0];
      assert.ok(input.includes(alert![1]), `${l}/${key}: aria-describedby the alert`);
      assert.equal(/aria-invalid="true"/.test(input), key === "ownerEmailErrInvalid", `${l}/${key}: aria-invalid`);
      assert.doesNotMatch(c, /invalid_email|invalid_boolean|invalid_json|no_config|forbidden/, `${l}/${key}: no server code`);
    }
    assert.doesNotMatch(card(render(l, S(ADDR, true))), /role="alert"/, `${l}: no alert without an error`);
  }
}

// 6. The state line, for the 3 states (plus unsaved edits and a plan without the recap).
{
  assert.equal(ownerEmailStateKey(S(ADDR, true), S(ADDR, true)), "ownerEmailStateOn");
  assert.equal(ownerEmailStateKey(S("", true), S("", true)), "ownerEmailStateNeedsAddress");
  assert.equal(ownerEmailStateKey(S(ADDR, false), S(ADDR, false)), "ownerEmailStateOff");
  assert.equal(ownerEmailStateKey(S("", false), S("", false)), "ownerEmailStateOff");
  // Never "an email goes out" before it is saved, or when the plan has no recap.
  assert.equal(ownerEmailStateKey(S("", false), S(ADDR, true)), "ownerEmailStateUnsaved");
  assert.equal(ownerEmailStateKey(S(ADDR, true), S(ADDR, false)), "ownerEmailStateUnsaved");
  assert.equal(ownerEmailStateKey(S(ADDR, true), S(ADDR, true), false), "ownerEmailStatePlanOff");
  for (const l of LOCALES) {
    const dc = messages(l).DashboardConfig;
    const cases: [OwnerEmailSettings, string][] = [
      [S(ADDR, true), "ownerEmailStateOn"],
      [S("", true), "ownerEmailStateNeedsAddress"],
      [S(ADDR, false), "ownerEmailStateOff"],
    ];
    for (const [v, key] of cases) {
      const c = card(render(l, v));
      const line = c.match(/<p id="[^"]+" data-state="([^"]+)"[^>]*>([^<]*)<\/p>/);
      assert.ok(line && line[1] === key && line[2] === esc(dc[key]), `${l}: state ${key}`);
    }
  }
  // The "on" copy promises an email; the other states never do.
  assert.match(messages("fr").DashboardConfig.ownerEmailStateNeedsAddress, /Ajoutez une adresse/);
}

// 7. The Test button: disabled with a reason without a saved address, and it
//    never reports "sent" when the route only logged the email.
{
  assert.equal(ownerEmailTestBlock(S("", true), S("", true)), "ownerEmailTestNeedsSaved");
  assert.equal(ownerEmailTestBlock(S("", true), S(ADDR, true)), "ownerEmailTestNeedsSaved", "typed but not saved");
  assert.equal(ownerEmailTestBlock(S(ADDR, true), S("b@example.test", true)), "ownerEmailTestSaveFirst");
  assert.equal(ownerEmailTestBlock(S(ADDR, false), S(ADDR, false)), null, "a saved address can be tested even when off");
  assert.equal(ownerEmailTestResult(200, { ok: true, id: "x" }), "ownerEmailTestSent");
  assert.equal(ownerEmailTestResult(200, { ok: true, fallback: "console_log" }), "ownerEmailTestNotConfigured");
  assert.equal(ownerEmailTestResult(500, { error: "x", hint: "y" }), "ownerEmailTestFailed");
  assert.equal(ownerEmailTestResult(400, { error: "Format email invalide" }), "ownerEmailTestFailed");
  assert.equal(ownerEmailTestResult(200, null), "ownerEmailTestFailed");
  assert.equal(ownerEmailTestUrl("he"), "/api/dashboard/notifications/email-test?locale=he");
  for (const l of LOCALES) {
    const dc = messages(l).DashboardConfig;
    const none = card(render(l, S("", true)));
    const btn = none.match(/<button(?![^>]*role="switch")[^>]*>/)![0];
    assert.match(btn, /disabled=""/, `${l}: Test disabled without a saved address`);
    const noteId = btn.match(/aria-describedby="([^"]+)"/)![1];
    assert.ok(none.includes(`<p id="${noteId}"`) && none.includes(esc(dc.ownerEmailTestNeedsSaved)), `${l}: reason shown and linked`);
    const ok = card(render(l, S(ADDR, true)));
    assert.doesNotMatch(ok.match(/<button(?![^>]*role="switch")[^>]*>/)![0], / disabled=""/, `${l}: Test enabled with a saved address`);
  }
  // The card posts { to: saved address } to the test route; no server text shown.
  const src = read("app/[locale]/dashboard/config/owner-email-card.tsx");
  assert.match(src, /JSON\.stringify\(\{ to: base\.ownerRecapEmail \}\)/);
  assert.doesNotMatch(src, /data\.error|\.hint/, "never renders the route's error or hint");
}

// 8. asUserId is passed through (GET and PUT go through ownerEmailUrl(asUserId)).
{
  assert.equal(ownerEmailUrl(), "/api/dashboard/notifications/email");
  assert.equal(ownerEmailUrl(null), "/api/dashboard/notifications/email");
  assert.equal(ownerEmailUrl("11111111-2222-3333-4444-555555555555"), "/api/dashboard/notifications/email?asUserId=11111111-2222-3333-4444-555555555555");
  assert.equal(ownerEmailUrl("a b&c"), "/api/dashboard/notifications/email?asUserId=a%20b%26c");
  const cf = read("app/[locale]/dashboard/config-form.tsx");
  assert.equal((cf.match(/ownerEmailUrl\(asUserId\)/g) ?? []).length, 2, "GET and PUT scoped by asUserId");
  assert.match(cf, /\}, \[asUserId\]\);/);
}

// 9. Same keys in all 3 locales, none empty, no supplier name, same placeholders.
{
  const keysOf = (l: string) =>
    Object.keys(messages(l).DashboardConfig).filter((k) => k.startsWith("ownerEmail")).sort();
  const fr = keysOf("fr");
  assert.ok(fr.length >= 15, "the card's keys exist");
  for (const l of LOCALES) {
    assert.deepEqual(keysOf(l), fr, `${l}: same ownerEmail* keys as fr`);
    const dc = messages(l).DashboardConfig;
    for (const k of fr) {
      assert.ok(typeof dc[k] === "string" && dc[k].trim(), `${l}.${k} not empty`);
      assert.equal(hits(dc[k]).size, 0, `${l}.${k}: no supplier or tool name`);
      assert.doesNotMatch(dc[k], /resend/i, `${l}.${k}: no email supplier name`);
      assert.deepEqual(dc[k].match(/\{\w+\}/g) ?? [], messages("fr").DashboardConfig[k].match(/\{\w+\}/g) ?? [], `${l}.${k}: placeholders`);
    }
  }
  // Every key the card can show is in the catalogue.
  const src = read("app/[locale]/dashboard/config/owner-email.ts");
  for (const k of new Set(src.match(/"ownerEmail[A-Za-z]+"/g)!.map((s) => s.slice(1, -1))))
    assert.ok(fr.includes(k), `catalogue has ${k}`);
}

console.log("owner-email-card: ok");
