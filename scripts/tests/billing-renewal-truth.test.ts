// Billing page renewal truth (F3a): while nothing can charge the account by
// itself (`autoRenew` false, decided server side), the page never says
// "Renews on", shows ONE "Renew" button on an active account, and hides
// cancel / resume. With `autoRenew` true the page is what it was before.
// Renders the REAL CurrentPlanCard / RenewalControl to static HTML.
// Mock data only.
// Run with:  npx tsx scripts/tests/billing-renewal-truth.test.ts

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, Fragment, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CurrentPlanCard, RenewalControl } from "../../app/[locale]/dashboard/billing/client";
import {
  renewTarget,
  renewalView,
  type RenewalStats,
  type RenewalStatus,
  type RenewalView,
} from "../../app/[locale]/dashboard/billing/renewal-view";

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

const PAID_UNTIL = "2026-12-15T10:00:00.000Z";
const stats = (over: Partial<RenewalStats> = {}): RenewalStats => ({
  status: "active",
  period: "monthly",
  paidUntil: PAID_UNTIL,
  trialEndsAt: null,
  autoRenew: true,
  cancelledAt: null,
  ...over,
});

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** The card + the danger zone control, as the page renders them. */
function render(locale: string, s: RenewalStats, autoRenew: boolean) {
  const view = renewalView(s, autoRenew);
  function Harness() {
    const t = useTranslations("DashboardBilling");
    return createElement(
      Fragment,
      null,
      createElement(CurrentPlanCard, {
        stats: { status: s.status, paidUntil: s.paidUntil, scheduledPlanAt: null },
        view,
        statusLabel: "status",
        planName: "Plan",
        scheduledPlanName: null,
        fmtDate,
        busy: false,
        onResume: () => {},
        onRenew: () => {},
        renewPending: false,
        onClearSchedule: () => {},
        t,
      }),
      createElement(RenewalControl, {
        control: view.control,
        busy: false,
        onCancel: () => {},
        onResume: () => {},
        t,
      }),
    );
  }
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(Harness),
    ),
  );
}

const fill = (tpl: string, date: string) => tpl.replace("{date}", date);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

console.log("billing-renewal-truth");

// ─── the copy ────────────────────────────────────────────────────────────────
test("the new copy, fr / en / he (he: plural address)", () => {
  const fr = messages("fr").DashboardBilling;
  const en = messages("en").DashboardBilling;
  const he = messages("he").DashboardBilling;
  assert.equal(fr.activeUntilRenewBefore, "Actif jusqu'au {date}. Pour continuer, renouvelez avant cette date.");
  assert.equal(fr.renewButton, "Renouveler");
  assert.equal(en.activeUntilRenewBefore, "Active until {date}. To continue, renew before that date.");
  assert.equal(en.renewButton, "Renew");
  // HE, plural imperative (חדשו), to be checked by a native speaker.
  assert.equal(he.activeUntilRenewBefore, "פעיל עד {date}. כדי להמשיך, חדשו לפני תאריך זה.");
  assert.equal(he.renewButton, "חדשו");
  for (const m of [fr, en, he]) assert.ok(m.dangerSubtitleDeleteOnly?.trim());
});

// ─── the table ───────────────────────────────────────────────────────────────
type Row = [RenewalStatus, boolean, boolean, boolean, RenewalView];
const D = PAID_UNTIL;
const T = "2026-11-30T00:00:00.000Z";
const line = (key: NonNullable<RenewalView["dateLine"]>["key"], date = D) => ({ key, date });
//   status          stats.autoRenew  cancelled  autoRenew(prop)  →  view
const TABLE: Row[] = [
  // nothing can charge the account by itself
  ["active",       true,  false, false, { dateLine: line("activeUntilRenewBefore"), renewButton: true,  control: null, cancelledBanner: false }],
  ["active",       false, true,  false, { dateLine: line("activeUntilRenewBefore"), renewButton: true,  control: null, cancelledBanner: false }],
  ["active",       false, false, false, { dateLine: line("activeUntilRenewBefore"), renewButton: true,  control: null, cancelledBanner: false }],
  ["trialing",     true,  false, false, { dateLine: line("trialEndsOn", T),         renewButton: false, control: null, cancelledBanner: false }],
  ["trial_paused", true,  false, false, { dateLine: line("pausedSince", T),         renewButton: false, control: null, cancelledBanner: false }],
  ["cancelled",    false, true,  false, { dateLine: line("accessUntil"),            renewButton: false, control: null, cancelledBanner: false }],
  ["expired",      true,  false, false, { dateLine: line("expiredOn"),              renewButton: false, control: null, cancelledBanner: false }],
  // the account really renews by itself: today's page
  ["active",       true,  false, true,  { dateLine: line("renewsOn"),               renewButton: false, control: "cancel", cancelledBanner: false }],
  ["active",       false, true,  true,  { dateLine: line("accessUntil"),            renewButton: false, control: "resume", cancelledBanner: true }],
  ["active",       false, false, true,  { dateLine: line("accessUntil"),            renewButton: false, control: "resume", cancelledBanner: false }],
  ["trialing",     true,  false, true,  { dateLine: line("trialEndsOn", T),         renewButton: false, control: "cancel", cancelledBanner: false }],
  ["trial_paused", true,  false, true,  { dateLine: line("pausedSince", T),         renewButton: false, control: null, cancelledBanner: false }],
  ["cancelled",    false, true,  true,  { dateLine: line("accessUntil"),            renewButton: false, control: null, cancelledBanner: false }],
  ["expired",      true,  false, true,  { dateLine: line("expiredOn"),              renewButton: false, control: null, cancelledBanner: false }],
];

test("renewalView: status × customer choice × cancelled × autoRenew", () => {
  for (const [status, choice, cancelled, autoRenew, want] of TABLE) {
    const s = stats({
      status,
      autoRenew: choice,
      cancelledAt: cancelled ? "2026-11-20T00:00:00.000Z" : null,
      trialEndsAt: status === "trialing" || status === "trial_paused" ? T : null,
    });
    assert.deepEqual(renewalView(s, autoRenew), want, `${status}/${choice}/${cancelled}/${autoRenew}`);
  }
});

test("no date, no line (both modes)", () => {
  for (const autoRenew of [false, true]) {
    assert.equal(renewalView(stats({ paidUntil: null }), autoRenew).dateLine, null);
    assert.equal(renewalView(stats({ status: "trialing", paidUntil: null }), autoRenew).dateLine, null);
  }
});

test("never 'renewsOn' while autoRenew is false, whatever the row", () => {
  for (const status of ["trialing", "trial_paused", "active", "cancelled", "expired"] as const)
    for (const choice of [true, false])
      for (const cancelledAt of [null, "2026-11-20T00:00:00.000Z"]) {
        const v = renewalView(stats({ status, autoRenew: choice, cancelledAt, trialEndsAt: T }), false);
        assert.notEqual(v.dateLine?.key, "renewsOn");
        assert.equal(v.control, null);
        assert.equal(v.cancelledBanner, false);
      }
});

// ─── the Renew target ────────────────────────────────────────────────────────
test("'Renew' pays the current plan for the current period", () => {
  assert.deepEqual(renewTarget("premium", { period: "annual" }, "monthly"), { plan: "premium", period: "annual" });
  assert.deepEqual(renewTarget("global", { period: "monthly" }, "annual"), { plan: "global", period: "monthly" });
  // no period on record: the page's billing toggle
  assert.deepEqual(renewTarget("global", { period: null }, "annual"), { plan: "global", period: "annual" });
});

// ─── rendered, fr / en / he ──────────────────────────────────────────────────
test("autoRenew false: the new line + one Renew, no 'Renews on', no cancel / resume", () => {
  for (const l of LOCALES) {
    const m = messages(l).DashboardBilling;
    for (const s of [stats(), stats({ autoRenew: false, cancelledAt: "2026-11-20T00:00:00.000Z" })]) {
      const html = render(l, s, false);
      assert.ok(html.includes(esc(fill(m.activeUntilRenewBefore, "2026-12-15"))), `${l}: new line`);
      assert.equal(html.split(`>${esc(m.renewButton)}</button>`).length - 1, 1, `${l}: one Renew`);
      assert.ok(!html.includes(esc(fill(m.renewsOn, "2026-12-15"))), `${l}: no renewsOn`);
      assert.ok(!html.includes(esc(m.cancelSubscription)), `${l}: no cancel`);
      assert.ok(!html.includes(esc(m.resumeSubscription)), `${l}: no resume`);
      assert.ok(!html.includes(esc(fill(m.cancelledBanner, "2026-12-15"))), `${l}: no cancelled banner`);
    }
  }
});

test("autoRenew true: today's UI (renews on + cancel; cancelled → banner + resume)", () => {
  for (const l of LOCALES) {
    const m = messages(l).DashboardBilling;
    const on = render(l, stats(), true);
    assert.ok(on.includes(esc(fill(m.renewsOn, "2026-12-15"))), `${l}: renewsOn`);
    assert.ok(on.includes(esc(m.cancelSubscription)), `${l}: cancel`);
    assert.ok(!on.includes(`>${esc(m.renewButton)}</button>`), `${l}: no Renew`);
    assert.ok(!on.includes(esc(fill(m.activeUntilRenewBefore, "2026-12-15"))), `${l}: no new line`);

    const cancelled = render(l, stats({ autoRenew: false, cancelledAt: "2026-11-20T00:00:00.000Z" }), true);
    assert.ok(cancelled.includes(esc(fill(m.accessUntil, "2026-12-15"))), `${l}: accessUntil`);
    assert.ok(cancelled.includes(esc(fill(m.cancelledBanner, "2026-12-15"))), `${l}: banner`);
    // banner link + danger zone button
    assert.equal(cancelled.split(esc(m.resumeSubscription)).length - 1, 2, `${l}: resume twice`);
    assert.ok(!cancelled.includes(`>${esc(m.renewButton)}</button>`), `${l}: no Renew`);
  }
});

// ─── source guards ───────────────────────────────────────────────────────────
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const clientSrc = strip(read("app/[locale]/dashboard/billing/client.tsx"));
const viewSrc = strip(read("app/[locale]/dashboard/billing/renewal-view.ts"));

test("the client files read no env and no card token", () => {
  for (const [name, src] of [["client.tsx", clientSrc], ["renewal-view.ts", viewSrc]] as const) {
    assert.doesNotMatch(src, /process\.env/, `${name} reads env`);
    assert.doesNotMatch(src, /HYP_TOKENS|hypToken|hyp_token|card_token/i, `${name} touches the token`);
  }
});

test("the client decides from the prop, and renewsOn only through renewalView", () => {
  assert.match(clientSrc, /renewalView\(stats, autoRenew\)/);
  assert.match(clientSrc, /autoRenew: boolean;/);
  assert.doesNotMatch(clientSrc, /"renewsOn"/, "client must not pick renewsOn itself");
  assert.doesNotMatch(clientSrc, /stats\.autoRenew \?/, "client must not pick cancel/resume itself");
  // Renew opens the existing payment flow with the target
  assert.match(clientSrc, /renewTarget\(currentPlanKey, stats, billing\)/);
  assert.match(clientSrc, /openPayment\(target\.plan, target\.period\)/);
});

test("the page passes the lib/billing boolean, and only the boolean", () => {
  const page = strip(read("app/[locale]/dashboard/billing/page.tsx"));
  assert.match(page, /import \{ renewsAutomatically \} from "@\/lib\/billing\/auto-renew";/);
  assert.match(page, /const autoRenew = renewsAutomatically\(me\);/);
  assert.match(page, /autoRenew=\{autoRenew\}/);
  assert.doesNotMatch(page, /process\.env/, "page reads env");
  assert.doesNotMatch(page, /autoRenew=\{(true|false)\}/, "no local constant");
  // the row (with its token) never goes to the client
  assert.doesNotMatch(page, /<BillingClient[^>]*\bme\b/);
  assert.doesNotMatch(page, /hypToken=|hypToken\}/);
});

test("'Renews on' is not used anywhere else in the app", () => {
  const hits = execSync(
    `grep -rln --include=*.ts --include=*.tsx -e '"renewsOn"' -e "'renewsOn'" app components lib || true`,
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(hits, ["app/[locale]/dashboard/billing/renewal-view.ts"]);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("billing-renewal-truth: ok");
