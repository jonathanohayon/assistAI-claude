// Owner recap email, verified contacts N2: the confirmation row of the email
// card (owner-email-confirm-row.tsx) and its rules (owner-email-confirm.ts),
// against the API of PR #348. Renders the REAL card to static HTML in
// fr/en/he. Mock data only (owner@example.test), no network.
// Run with:  npx tsx scripts/tests/owner-email-confirm.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ownerEmailUrl, type OwnerEmailSettings } from "../../app/[locale]/dashboard/config/owner-email";
import { OwnerEmailCard } from "../../app/[locale]/dashboard/config/owner-email-card";
import {
  cleanCode,
  confirmBadge,
  confirmCodeOutcome,
  confirmSendBlock,
  confirmSubmitBlock,
  isCompleteCode,
  ownerEmailCodeUrl,
  ownerEmailConfirmUrl,
  parseRecapEmailConfirmation,
  sendCodeOutcome,
  type ConfirmErrorKey,
  type RecapEmailConfirmation,
} from "../../app/[locale]/dashboard/config/owner-email-confirm";
import { OwnerEmailConfirmRow } from "../../app/[locale]/dashboard/config/owner-email-confirm-row";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const ADDR = "owner@example.test";
const S = (ownerRecapEmail: string, ownerRecapEmailEnabled = true): OwnerEmailSettings => ({ ownerRecapEmail, ownerRecapEmailEnabled });
const AT = "2026-11-14T12:00:00.000Z";
const UNCONFIRMED: RecapEmailConfirmation = { state: "unconfirmed" };
const CONFIRMED_AT: RecapEmailConfirmation = { state: "confirmed", at: AT };
const GRANDFATHERED: RecapEmailConfirmation = { state: "confirmed" };

function wrap(locale: string, child: () => ReturnType<typeof createElement>) {
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
      createElement(function Inner() {
        return child();
      }),
    ),
  );
}

type RowProps = Partial<ComponentProps<typeof OwnerEmailConfirmRow>>;
function row(locale: string, props: RowProps = {}) {
  return wrap(locale, () => {
    const t = useTranslations("DashboardConfig");
    return createElement(OwnerEmailConfirmRow, {
      value: S(ADDR),
      base: S(ADDR),
      confirmation: UNCONFIRMED,
      onConfirmation: () => {},
      reloadConfirmation: () => {},
      locale,
      t,
      ...props,
    });
  });
}
function card(locale: string, props: Partial<ComponentProps<typeof OwnerEmailCard>> = {}) {
  return wrap(locale, () => {
    const t = useTranslations("DashboardConfig");
    return createElement(OwnerEmailCard, {
      value: S(ADDR),
      base: S(ADDR),
      onChange: () => {},
      error: null,
      locale,
      confirmation: UNCONFIRMED,
      t,
      ...props,
    });
  });
}
const dcOf = (l: string) => messages(l).DashboardConfig as Record<string, string>;
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

// 1. Every state renders, in fr/en/he.
for (const l of LOCALES) {
  const dc = dcOf(l);
  // To confirm: neutral colours, a Send button, no code field yet.
  const u = row(l);
  assert.ok(u.includes(`data-confirm-state="ownerEmailConfirmStateUnconfirmed"`), `${l}: unconfirmed state`);
  assert.ok(u.includes(`>${esc(dc.ownerEmailConfirmStateUnconfirmed)}<`) || u.includes(esc(dc.ownerEmailConfirmStateUnconfirmed)), `${l}: "to confirm" text`);
  const badge = u.match(/<span[^>]*data-confirm-state[^>]*>/)![0];
  assert.doesNotMatch(badge, /#dc2626|#991b1b|#fef2f2|#fecaca|#9d174d|#be185d/, `${l}: "to confirm" is not an error colour`);
  assert.ok(u.includes(`>${esc(dc.ownerEmailConfirmSend)}<`), `${l}: Send a code`);
  assert.match(u.match(/<button[^>]*data-action="send-code"[^>]*>/)![0], /min-h-11/, `${l}: 44px send`);
  assert.doesNotMatch(u, /autoComplete="one-time-code"/, `${l}: no code field before sending`);

  // Confirmed on {date}: the date in the page locale, no Send button.
  const c = row(l, { confirmation: CONFIRMED_AT });
  const date = new Intl.DateTimeFormat(l, { dateStyle: "long" }).format(new Date(AT));
  assert.ok(c.includes(esc(fill(dc.ownerEmailConfirmStateConfirmedOn, { date }))), `${l}: confirmed on ${date}`);
  assert.doesNotMatch(c, /data-action="send-code"/, `${l}: no send once confirmed`);

  // Grandfathered: just "Confirmed".
  const g = row(l, { confirmation: GRANDFATHERED });
  assert.ok(g.includes(`data-confirm-state="ownerEmailConfirmStateConfirmed"`), `${l}: grandfathered`);
  assert.ok(g.includes(`${esc(dc.ownerEmailConfirmStateConfirmed)}</span>`), `${l}: plain "confirmed"`);

  // Nothing saved (null): no row.
  assert.equal(row(l, { confirmation: null }), "", `${l}: no row without a saved address`);

  // Code sent: the where/how-long line, the code field and Confirm.
  const sent = row(l, { initialPhase: "sent" });
  assert.ok(sent.includes(esc(fill(dc.ownerEmailConfirmSentTo, { email: ADDR, minutes: 10 }))), `${l}: sent-to line`);
  assert.ok(sent.includes(`>${esc(dc.ownerEmailConfirmCodeLabel)}</label>`), `${l}: code label`);
  const label = sent.match(/<label for="([^"]+)"[^>]*>/)![1];
  const input = sent.match(/<input[^>]*>/)![0];
  for (const attr of [`id="${label}"`, 'inputMode="numeric"', 'autoComplete="one-time-code"', 'dir="ltr"', 'maxLength="7"', "min-h-11"])
    assert.ok(input.includes(attr), `${l}: code input ${attr}`);
  assert.ok(sent.includes(`>${esc(dc.ownerEmailConfirmSubmit)}<`), `${l}: Confirm`);
  assert.ok(sent.includes(`>${esc(dc.ownerEmailConfirmResend)}<`), `${l}: resend after a send`);
  assert.match(sent.match(/<button[^>]*data-action="confirm-code"[^>]*>/)![0], /min-h-11/, `${l}: 44px confirm`);
  assert.match(sent, /focus-visible:ring-2/, `${l}: visible focus`);
  if (l === "he") assert.match(sent, /[֐-׿]/, "he: Hebrew copy");

  // In the card: the row sits below the address input.
  const k = card(l);
  assert.ok(k.indexOf('type="email"') < k.indexOf("data-confirm-row"), `${l}: row below the address`);
  // Admin "no sender" mode: no code can be sent, no row.
  assert.doesNotMatch(card(l, { senderNotice: true }), /data-confirm-row/, `${l}: no row without a sender`);
}

// 2. Each error code → our line (role=alert), never the server's text.
const SERVER_TEXT = "SERVER_SAYS_SOMETHING";
const sendCases: Array<[number, unknown, string | null, ConfirmErrorKey | "sent" | "already", number?]> = [
  [200, { ok: true, expiresInSec: 600 }, null, "sent", 10],
  [404, { error: "no_config", message: SERVER_TEXT }, null, "ownerEmailErrNoConfig"],
  [409, { error: "no_saved_address" }, null, "ownerEmailConfirmErrNoSavedAddress"],
  [409, { error: "already_confirmed" }, null, "already"],
  [429, { error: "rate_limited", scope: "value" }, "3600", "ownerEmailConfirmErrRateLimited", 60],
  [429, { error: "rate_limited", scope: "account" }, "61", "ownerEmailConfirmErrRateLimited", 2],
  [429, { error: "rate_limited", scope: "global" }, null, "ownerEmailConfirmErrRateLimitedNoTime"],
  [429, { error: "rate_limited", scope: "global" }, "Wed, 21 Oct 2026 07:28:00 GMT", "ownerEmailConfirmErrRateLimitedNoTime"],
  [503, { error: "not_configured" }, null, "ownerEmailConfirmErrNotConfigured"],
  [500, { error: "send_failed", detail: SERVER_TEXT }, null, "ownerEmailConfirmErrSendFailed"],
  [403, { error: "forbidden" }, null, "ownerEmailErrForbidden"],
  [401, { error: "unauthorized" }, null, "ownerEmailConfirmErrSendFailed"],
  [0, null, null, "ownerEmailConfirmErrSendFailed"],
];
for (const [status, body, ra, want, minutes] of sendCases) {
  const o = sendCodeOutcome(status, body, ra);
  if (want === "sent") assert.deepEqual(o, { kind: "sent", minutes }, "send 200");
  else if (want === "already") assert.deepEqual(o, { kind: "alreadyConfirmed" }, "send already_confirmed");
  else {
    assert.equal(o.kind, "error", `send ${status}`);
    assert.equal((o as { key: string }).key, want, `send ${status} ${JSON.stringify(body)} → ${want}`);
    if (minutes !== undefined) assert.equal((o as { minutes?: number }).minutes, minutes, `Retry-After ${ra} → ${minutes} min`);
  }
}
const confirmCases: Array<[number, unknown, ConfirmErrorKey | "confirmed", boolean?]> = [
  [200, { ok: true, recapEmailConfirmation: { state: "confirmed", at: AT } }, "confirmed"],
  [400, { error: "invalid_code" }, "ownerEmailConfirmErrInvalidCode", false],
  [400, { error: "code_expired" }, "ownerEmailConfirmErrExpired", true],
  [400, { error: "too_many_attempts" }, "ownerEmailConfirmErrTooManyAttempts", true],
  [409, { error: "no_saved_address" }, "ownerEmailConfirmErrNoSavedAddress", false],
  [404, { error: "no_config" }, "ownerEmailErrNoConfig", false],
  [403, { error: "forbidden" }, "ownerEmailErrForbidden", false],
  [500, { error: SERVER_TEXT }, "ownerEmailConfirmErrConfirmFailed", false],
  [0, null, "ownerEmailConfirmErrConfirmFailed", false],
];
for (const [status, body, want, resend] of confirmCases) {
  const o = confirmCodeOutcome(status, body);
  if (want === "confirmed") assert.deepEqual(o, { kind: "confirmed", confirmation: { state: "confirmed", at: AT } });
  else assert.deepEqual(o, { kind: "error", key: want, resend }, `confirm ${status} ${JSON.stringify(body)}`);
}
// The error line renders with role=alert, our text, the resend offer when the code is dead.
for (const l of LOCALES) {
  const dc = dcOf(l);
  const keys: ConfirmErrorKey[] = [
    "ownerEmailConfirmErrInvalidCode", "ownerEmailConfirmErrExpired", "ownerEmailConfirmErrTooManyAttempts",
    "ownerEmailConfirmErrNotConfigured", "ownerEmailConfirmErrSendFailed", "ownerEmailConfirmErrNoSavedAddress",
    "ownerEmailConfirmErrRateLimited", "ownerEmailConfirmErrRateLimitedNoTime", "ownerEmailConfirmErrConfirmFailed",
    "ownerEmailErrForbidden", "ownerEmailErrNoConfig",
  ];
  for (const key of keys) {
    const resend = key === "ownerEmailConfirmErrExpired" || key === "ownerEmailConfirmErrTooManyAttempts";
    const html = row(l, { initialPhase: "sent", initialFeedback: { key, minutes: 7, resend } });
    const alert = html.match(/<p[^>]*role="alert"[^>]*>([^<]*)<\/p>/);
    assert.ok(alert, `${l} ${key}: role=alert`);
    assert.equal(alert![1], esc(fill(dc[key], { minutes: 7 })), `${l} ${key}: our line`);
    assert.doesNotMatch(html, new RegExp(SERVER_TEXT), `${l} ${key}: no server text`);
    if (resend) assert.ok(html.includes(`>${esc(dc.ownerEmailConfirmResend)}<`), `${l} ${key}: offers a new code`);
  }
  // The invalid code marks the field.
  const inv = row(l, { initialPhase: "sent", initialFeedback: { key: "ownerEmailConfirmErrInvalidCode" } });
  assert.match(inv.match(/<input[^>]*>/)![0], /aria-invalid="true"/, `${l}: invalid code marks the field`);
  // 429 wording, FR as briefed.
  if (l === "fr") assert.equal(fill(dc.ownerEmailConfirmErrRateLimited, { minutes: 5 }), "Trop de codes demandés. Réessayez dans 5 min.");
}

// 3. Disabled, with the reason in words.
assert.equal(confirmSendBlock(S(""), S("")), "ownerEmailConfirmNeedsSaved");
assert.equal(confirmSendBlock(S(ADDR), S("other@example.test")), "ownerEmailConfirmSaveFirst");
assert.equal(confirmSendBlock(S(ADDR), S("  OWNER@example.test ")), null, "same address, other case/spaces");
assert.equal(confirmSubmitBlock(""), "ownerEmailConfirmCodeIncomplete");
assert.equal(confirmSubmitBlock("12345"), "ownerEmailConfirmCodeIncomplete");
assert.equal(confirmSubmitBlock("12a456"), "ownerEmailConfirmCodeIncomplete");
assert.equal(confirmSubmitBlock("123 456"), null);
for (const l of LOCALES) {
  const dc = dcOf(l);
  const differs = row(l, { value: S("other@example.test") });
  assert.match(differs.match(/<button[^>]*data-action="send-code"[^>]*>/)![0], /disabled=""/, `${l}: send disabled while the typed address differs`);
  assert.ok(differs.includes(`data-block="ownerEmailConfirmSaveFirst">${esc(dc.ownerEmailConfirmSaveFirst)}<`), `${l}: save-first reason`);
  // The code field stays hidden while the typed address differs (the code went to the saved one).
  assert.doesNotMatch(row(l, { value: S("other@example.test"), initialPhase: "sent" }), /one-time-code/, `${l}: no code field for an unsaved address`);
  const empty = row(l, { initialPhase: "sent" });
  assert.match(empty.match(/<button[^>]*data-action="confirm-code"[^>]*>/)![0], /disabled=""/, `${l}: confirm disabled without 6 digits`);
  assert.ok(new RegExp(`data-block="ownerEmailConfirmCodeIncomplete"[^>]*>${esc(dc.ownerEmailConfirmCodeIncomplete)}<`).test(empty), `${l}: incomplete reason`);
}

// 4. The code stays a string (leading zeros kept), spaces stripped.
assert.equal(cleanCode("004 213"), "004213");
assert.equal(cleanCode(" 000000 "), "000000");
assert.ok(isCompleteCode("004213") && isCompleteCode("004 213"));
assert.ok(!isCompleteCode("4213") && !isCompleteCode("0042134"));
const rowSrc = read("app/[locale]/dashboard/config/owner-email-confirm-row.tsx");
assert.ok(rowSrc.includes("JSON.stringify({ code: cleanCode(code) })"), "the body sends the cleaned string");
assert.doesNotMatch(rowSrc + read("app/[locale]/dashboard/config/owner-email-confirm.ts"), /Number\(code|parseInt\(code|\+code\b/, "never a number");

// 5. ?asUserId on all three calls (GET, code, confirm).
const U = "00000000-0000-4000-8000-000000000001";
assert.equal(ownerEmailUrl(U), `/api/dashboard/notifications/email?asUserId=${U}`);
assert.equal(ownerEmailCodeUrl(U), `/api/dashboard/notifications/email/code?asUserId=${U}`);
assert.equal(ownerEmailConfirmUrl(U), `/api/dashboard/notifications/email/confirm?asUserId=${U}`);
assert.equal(ownerEmailCodeUrl(null), "/api/dashboard/notifications/email/code");
assert.equal(ownerEmailConfirmUrl(undefined), "/api/dashboard/notifications/email/confirm");
assert.ok(rowSrc.includes("fetch(ownerEmailCodeUrl(asUserId)"), "send uses the scoped URL");
assert.ok(rowSrc.includes("fetch(ownerEmailConfirmUrl(asUserId)"), "confirm uses the scoped URL");
const formSrc = read("app/[locale]/dashboard/config-form.tsx");
assert.match(formSrc, /reloadOwnerEmailConfirmation = useCallback\(\(\) => \{\s*fetch\(ownerEmailUrl\(asUserId\)/, "reload GET is scoped");
assert.match(formSrc, /if \("ownerRecapEmail" in echanges\) reloadOwnerEmailConfirmation\(\)/, "address change → state from the next GET");
// Admin view: the hint line (pending the design lead), absent for the tenant.
for (const l of LOCALES) {
  assert.ok(row(l, { asUserId: U }).includes(esc(dcOf(l).ownerEmailConfirmAdminHint)), `${l}: admin hint`);
  assert.doesNotMatch(row(l), /data-admin-hint/, `${l}: no admin hint for the tenant`);
}

// 6. Nothing claims that recaps stop until the address is confirmed (enforcement OFF).
const STOP = {
  fr: /(ne (part|partira|sera)|plus envoy|suspendu|bloqu|arrêt|tant que|jusqu'à)/i,
  en: /(won't be sent|will not be sent|stop|paused|blocked|until|no longer sent|suspended)/i,
  he: /(לא יישלח|יופסק|מושהה|חסום|עד ש)/,
};
for (const l of LOCALES) {
  const dc = dcOf(l);
  for (const [k, v] of Object.entries(dc)) {
    if (!k.startsWith("ownerEmailConfirm")) continue;
    assert.doesNotMatch(v, STOP[l], `${l}.${k} must not claim recaps stop: "${v}"`);
  }
}

// 7. Identical keys in fr/en/he, same placeholders.
const keysOf = (l: string) => Object.keys(dcOf(l)).filter((k) => k.startsWith("ownerEmailConfirm")).sort();
assert.ok(keysOf("fr").length >= 20, "confirm keys present");
for (const l of ["en", "he"]) assert.deepEqual(keysOf(l), keysOf("fr"), `${l}: same keys as fr`);
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
for (const k of keysOf("fr")) for (const l of ["en", "he"]) assert.equal(ph(dcOf(l)[k]), ph(dcOf("fr")[k]), `${l}.${k}: placeholders`);

// 8. GET field parsing.
assert.equal(parseRecapEmailConfirmation(null), null);
assert.equal(parseRecapEmailConfirmation({ state: "pending" }), null);
assert.deepEqual(parseRecapEmailConfirmation({ state: "confirmed" }), { state: "confirmed" });
assert.deepEqual(parseRecapEmailConfirmation({ state: "unconfirmed", at: 3 }), { state: "unconfirmed" });
assert.deepEqual(confirmBadge({ state: "confirmed", at: "not-a-date" }, "fr"), { key: "ownerEmailConfirmStateConfirmed" });

console.log("owner-email-confirm: all assertions passed");
