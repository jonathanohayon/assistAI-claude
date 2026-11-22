// The onboarding welcome screen (sales / connect door, product not usable)
// and the Réception wizard it leaves unchanged.
//   1. Reception: the wizard card renders exactly the markup the page had
//      before doors (the old JSX, copied here verbatim).
//   2. Welcome, server-rendered in fr/en/he for connect and sales: the title
//      reads the ONE product-name key (DashboardNav.<door>); the "recorded"
//      sentence only when the notify row exists; no use-case grid; both
//      buttons disabled until both fields are filled; never "en ligne".
//   3. The actions, with a recording fetch: the notify row is recorded only
//      on 200/201; the profile is saved before either button acts; "Voir
//      l'aperçu" goes to the product's page; "Essayer la Réception" opens the
//      wizard; nothing happens when a field is missing or the save fails; no
//      number search or purchase is ever called.
//   4. The wizard's "en ligne" ending only after a successful purchase.
// Run with:  npx tsx scripts/tests/onboarding-welcome.test.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DoorWelcome } from "../../app/[locale]/onboarding/door-welcome";
import { NOTIFY_PATH, PROFILE_PATH, continueFromWelcome, recordNotify, saveWelcomeProfile } from "../../app/[locale]/onboarding/welcome-actions";
import { OnboardingWizard } from "../../app/[locale]/onboarding/wizard";
import { WizardCard } from "../../app/[locale]/onboarding/wizard-card";
import { previewHref } from "../../lib/onboarding-route";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LOCALES = ["fr", "en", "he"] as const;
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));

const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const render = (locale: string, el: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(Intl, { locale, messages: messages(locale), timeZone: "UTC" }, el),
    ),
  );
// Text as the browser shows it (entities decoded) for message comparisons.
const text = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// ── 1. Reception: the card is the pre-door markup ─────────────────────────
// The page's JSX before doors (origin/main f74f6a5d), verbatim.
function MainCard(p: { sectionHeader: string; title: string; subtitle: string; initialLanguage: "fr" | "he" | "en"; initialCompanyName: string; defaultCountry: "FR" | "IL" }) {
  return createElement(
    "div",
    { className: "rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur sm:p-10" },
    createElement("p", { className: "text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]" }, p.sectionHeader),
    createElement("h1", { className: "mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl" }, p.title),
    createElement("p", { className: "mt-3 text-sm text-[var(--color-muted-foreground)]" }, p.subtitle),
    createElement(
      "div",
      { className: "mt-8" },
      createElement(OnboardingWizard, { initialLanguage: p.initialLanguage, initialCompanyName: p.initialCompanyName, defaultCountry: p.defaultCountry }),
    ),
  );
}
for (const l of LOCALES) {
  const o = messages(l).Onboarding;
  const props = { sectionHeader: o.sectionHeader, title: o.title, subtitle: o.subtitle, initialLanguage: l, initialCompanyName: "Salon Mock", defaultCountry: l === "he" ? "IL" : "FR" } as const;
  const now = render(l, createElement(WizardCard, props));
  assert.equal(now, render(l, createElement(MainCard, props)), `${l}: the reception card is byte-identical to main`);
  assert.ok(text(now).includes(o.useCaseTitle), `${l}: the wizard's first step (use-case grid) is there`);
}
console.log("ok: reception card identical to main (fr/en/he)");

// ── 2. The welcome screen, server-rendered ────────────────────────────────
type WProps = Parameters<typeof DoorWelcome>[0];
const welcome = (l: string, p: Partial<WProps> & Pick<WProps, "door">) =>
  text(
    render(
      l,
      createElement(DoorWelcome, {
        productName: messages(l).DashboardNav[p.door],
        previewHref: previewHref(p.door),
        notifyRecorded: true,
        initialCompanyName: "Salon Mock",
        initialLanguage: l as "fr",
        defaultCountry: "FR",
        ...p,
      }),
    ),
  );
const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-welcome="(preview|reception)"[^>]*>/g)].map((m) => ({ which: m[1], disabled: /\sdisabled=""/.test(m[0]) }));

for (const l of LOCALES) {
  const m = messages(l);
  const o = m.Onboarding;
  for (const door of ["connect", "sales"] as const) {
    const name = m.DashboardNav[door];
    const html = welcome(l, { door });
    // Title: the product-name key, through {product}.
    assert.ok(o.welcomeTitle.includes("{product}"), `${l}: the title takes the product name`);
    assert.ok(html.includes(`>${o.welcomeTitle.replace("{product}", name)}</h1>`), `${l}/${door}: title reads DashboardNav.${door}`);
    // Notify row present → the sentence.
    assert.ok(html.includes(o.welcomeRecorded), `${l}/${door}: recorded sentence when the row exists`);
    assert.ok(!html.includes(o.welcomeRecording));
    // Notify row missing → NOT the sentence (it is being recorded first).
    const missing = welcome(l, { door, notifyRecorded: false });
    assert.ok(!missing.includes(o.welcomeRecorded), `${l}/${door}: never "recorded" before the row exists`);
    assert.ok(missing.includes(o.welcomeRecording), `${l}/${door}: "recording" while it is written`);
    // The form: the wizard's two fields, not the use-case grid.
    assert.ok(html.includes(o.companyNameLabel) && html.includes(o.langTitle), `${l}/${door}: company name + language`);
    assert.ok(!html.includes(o.useCaseTitle) && !html.includes(o.useCaseReceptionTitle), `${l}/${door}: no use-case grid`);
    // The two buttons, enabled with both fields filled.
    assert.ok(html.includes(o.welcomePreview) && html.includes(o.welcomeTryReception));
    assert.deepEqual(buttons(html), [{ which: "preview", disabled: false }, { which: "reception", disabled: false }]);
    // Either field missing → both disabled, and the hint says why.
    for (const p of [{ initialCompanyName: "" }, { initialCompanyName: "   " }, { initialLanguage: null }]) {
      const h = welcome(l, { door, ...p });
      assert.deepEqual(buttons(h), [{ which: "preview", disabled: true }, { which: "reception", disabled: true }], `${l}/${door} ${JSON.stringify(p)}: both disabled`);
      assert.ok(h.includes(o.welcomeRequired));
    }
    // Never the "en ligne" ending, never a number step.
    for (const k of ["doneTitle", "doneDesc", "callButton", "stepNumberHeader", "confirmButton"]) assert.ok(!html.includes(o[k]), `${l}/${door}: no ${k}`);
  }
  // The secondary button names the Réception product as the menu does.
  assert.ok(o.welcomeTryReception.toLowerCase().includes(m.DashboardNav.reception.toLowerCase()), `${l}: "Essayer la Réception" names DashboardNav.reception`);
}
// FR: "tableau de bord", never "dashboard", in the new copy.
for (const k of Object.keys(messages("fr").Onboarding).filter((k) => k.startsWith("welcome"))) {
  assert.doesNotMatch(messages("fr").Onboarding[k], /dashboard/i, `fr: ${k} says "tableau de bord"`);
}
console.log("ok: welcome screen fr/en/he × connect/sales");

// ── 3. The actions, with a recording fetch ────────────────────────────────
type Call = { url: string; body: unknown };
function recorder(status: number | "throw") {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (status === "throw") throw new Error("network");
    return { ok: status >= 200 && status < 300, status };
  };
  return { calls, fn };
}
const FORBIDDEN = /\/api\/onboarding\/(search|provision)/;

(async () => {
  // recordNotify: stored only on 201 (created) / 200 (already there).
  for (const [status, ok] of [[201, true], [200, true], [409, false], [404, false], [400, false], [401, false], [500, false], ["throw", false]] as const) {
    const r = recorder(status);
    assert.equal(await recordNotify("connect", r.fn), ok, `notify ${status} → ${ok}`);
    assert.deepEqual(r.calls, [{ url: NOTIFY_PATH, body: { product: "connect" } }]);
  }
  assert.equal(NOTIFY_PATH, "/api/dashboard/products/notify");
  assert.equal(PROFILE_PATH, "/api/onboarding/profile");

  // Profile: required fields, the wizard's body.
  for (const form of [{ companyName: "", language: "fr" as const }, { companyName: "Salon Mock", language: null }]) {
    const r = recorder(200);
    assert.equal(await saveWelcomeProfile(form, r.fn), "invalid");
    assert.equal(r.calls.length, 0, "a missing field sends nothing");
  }
  {
    const r = recorder(200);
    assert.equal(await saveWelcomeProfile({ companyName: "  Salon Mock ", language: "he" }, r.fn), "saved");
    assert.deepEqual(r.calls, [{ url: PROFILE_PATH, body: { displayName: "Salon Mock", primaryLanguage: "he" } }]);
  }

  // Both buttons: profile first, then the action; nothing on failure.
  for (const door of ["connect", "sales"] as const) {
    for (const choice of ["preview", "reception"] as const) {
      for (const status of [200, 500, "throw"] as const) {
        const r = recorder(status);
        const went: string[] = [];
        let opened = 0;
        const out = await continueFromWelcome(choice, { companyName: "Salon Mock", language: "fr" }, {
          fetch: r.fn,
          navigate: (h) => went.push(h),
          openWizard: () => opened++,
          previewHref: previewHref(door),
        });
        assert.deepEqual(r.calls.map((c) => c.url), [PROFILE_PATH], `${door}/${choice}/${status}: only the profile is called`);
        if (status === 200) {
          assert.equal(out, "saved");
          assert.deepEqual(went, choice === "preview" ? [door === "connect" ? "/dashboard/agent" : "/dashboard/sales"] : []);
          assert.equal(opened, choice === "reception" ? 1 : 0);
        } else {
          assert.equal(out, "failed");
          assert.deepEqual(went, []);
          assert.equal(opened, 0, "the wizard does not open when the save failed");
        }
      }
      // A missing field: no call, no action.
      const r = recorder(200);
      const went: string[] = [];
      let opened = 0;
      assert.equal(await continueFromWelcome(choice, { companyName: "", language: "fr" }, { fetch: r.fn, navigate: (h) => went.push(h), openWizard: () => opened++, previewHref: previewHref(door) }), "invalid");
      assert.deepEqual([r.calls.length, went.length, opened], [0, 0, 0]);
    }
  }
  console.log("ok: notify recorded only on 200/201; profile before either button; routes");

  // No number search / purchase from the welcome screen's code.
  for (const f of ["app/[locale]/onboarding/door-welcome.tsx", "app/[locale]/onboarding/welcome-actions.ts", "lib/onboarding-route.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, FORBIDDEN, `${f}: no number search / purchase`);
    assert.doesNotMatch(src, /\bprovision\b/i, `${f}: no provision`);
  }
  const dw = read("app/[locale]/onboarding/door-welcome.tsx");
  const fetches = [...dw.matchAll(/\bfetch\b/g)].length;
  assert.equal([...dw.matchAll(/\bfetch\(/g)].length, 0, "door-welcome calls fetch only through welcome-actions");
  assert.ok(fetches > 0);
  // "Essayer la Réception": the same wizard card, with what was typed.
  assert.match(dw, /if \(mode === "wizard"\) \{\s*return \(\s*<WizardCard\s+sectionHeader=\{t\("sectionHeader"\)\}\s+title=\{t\("title"\)\}\s+subtitle=\{t\("subtitle"\)\}\s+initialLanguage=\{language \?\? "fr"\}\s+initialCompanyName=\{companyName\}/);
  assert.match(dw, /openWizard: \(\) => setMode\("wizard"\)/);
  console.log("ok: no search / provision from the welcome screen; the reception choice opens the wizard card");

  // ── 4. "En ligne" only after a successful purchase ──────────────────────
  const wz = read("app/[locale]/onboarding/wizard.tsx");
  assert.match(wz, /if \(stage === "done" && provisioned\) \{/, "the done branch needs a provisioned number");
  assert.equal([...wz.matchAll(/setStage\("done"\)/g)].length, 1, "one way into the done stage");
  assert.equal([...wz.matchAll(/setProvisioned\(/g)].length, 1, "one place sets the number");
  const purchase = wz.slice(wz.indexOf("const purchase = () => {"), wz.indexOf("const copyNumber"));
  assert.match(
    purchase,
    /fetch\("\/api\/onboarding\/provision"[\s\S]*if \(!res\.ok\) \{[\s\S]*?return;\s*\}\s*const data = \(await res\.json\(\)\) as \{ phoneNumber: string \};\s*setProvisioned\(\{ phoneNumber: data\.phoneNumber \}\);\s*setStage\("done"\);/,
    "done only after the provision route answered ok",
  );
  // The skip goes to the dashboard, never to the done stage.
  assert.match(wz, /onClick=\{\(\) => router\.push\("\/dashboard"\)\}\s+disabled=\{isPending\}[\s\S]{0,400}\{t\("skipPhone"\)\}/);
  // The ending's copy (Onboarding namespace) is used by the wizard's done branch only.
  const doneKeys = /t\("(doneTitle|doneDesc|callButton)"\)/;
  const readsOnboarding = (src: string) => /Translations\(\s*(?:\{[^}]*namespace:\s*)?"Onboarding"/.test(src);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      if (n === "node_modules" || n.startsWith(".")) return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
    });
  const users = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter((p) => {
    const src = readFileSync(p, "utf8");
    return readsOnboarding(src) && doneKeys.test(src);
  }).map((p) => relative(ROOT, p));
  assert.deepEqual(users, ["app/[locale]/onboarding/wizard.tsx"]);
  const doneBranch = wz.slice(wz.indexOf('if (stage === "done" && provisioned)'), wz.indexOf("// ============================ ÉTAPE NUMBER"));
  for (const k of ["doneTitle", "doneDesc", "callButton"]) {
    assert.equal([...wz.matchAll(new RegExp(`t\\("${k}"\\)`, "g"))].length, 1);
    assert.ok(doneBranch.includes(`t("${k}")`), `${k} only inside the done branch`);
  }
  // The wizard's first render (no number): never the ending.
  for (const l of LOCALES) {
    const o = messages(l).Onboarding;
    const h = text(render(l, createElement(OnboardingWizard, { initialLanguage: l, initialCompanyName: "", defaultCountry: "FR" })));
    for (const k of ["doneTitle", "doneDesc", "callButton"]) assert.ok(!h.includes(o[k]), `${l}: no ${k} without a number`);
  }
  console.log('ok: "en ligne" only after a successful provision');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
