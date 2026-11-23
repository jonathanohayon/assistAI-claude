// "Essayer gratuitement" (F4): lib/trial-cta.ts (what the header shows),
// lib/trial-start.ts (the POST and its outcome per status, one request at a
// time), and what components/dashboard/ProductPreviewHeader.tsx renders for
// each case. Mock fetch only: no network, no database.
// Run with:  npx tsx scripts/tests/trial-cta.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { IntlMessageFormat } from "intl-messageformat";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ProductPreviewHeader,
  TrialStartView,
  type TrialStartPhase,
} from "../../components/dashboard/ProductPreviewHeader";
import { ProductTrialNote } from "../../components/dashboard/ProductTrialNote";
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "../../lib/product-trials";
import type { ProductEntryState } from "../../lib/product-menu";
import { DashboardSidebar } from "../../components/dashboard/DashboardSidebar";
import { navBlocks } from "../../lib/dashboard-nav";
import { navBadge, trialCta, type TrialCtaTrial, type TrialCtaView } from "../../lib/trial-cta";
import {
  postTrialStart,
  trialStartOutcome,
  trialStartSubmitter,
  trialStartUrl,
  type TrialFetch,
} from "../../lib/trial-start";

const END = "2026-12-01T10:30:00.000Z";
const ROUTER = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const TERMS = { days: PRODUCT_TRIAL_DAYS, minutes: PRODUCT_TRIAL_MINUTES };

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function mockFetch(status: number | "throw", body: unknown, calls: Call[]): TrialFetch {
  return async (url, init) => {
    calls.push({ url, ...init });
    if (status === "throw") throw new TypeError("network down");
    return { status, json: async () => body };
  };
}

async function main() {
  // ── 1. The table: every menu state × every trial state × startable ─────
  {
    const entries: Array<[string, ProductEntryState]> = [
      ["owned", { state: "owned" }],
      ["soon", { state: "preview", cta: "soon" }],
      ["try", { state: "preview", cta: "try" }],
    ];
    const trials: Array<[string, TrialCtaTrial]> = [];
    for (const state of ["available", "used", "active"] as const)
      for (const startable of [true, false, undefined]) {
        const t: NonNullable<TrialCtaTrial> = { state };
        if (state !== "available") t.endsAt = END;
        if (startable !== undefined) t.startable = startable;
        trials.push([`${state}/startable=${String(startable)}`, t]);
      }
    trials.push(["missing", undefined], ["null", null], ["empty", {}]);
    trials.push(["active without endsAt", { state: "active", startable: true }]);
    trials.push(["active with a bad date", { state: "active", endsAt: "soon", startable: true }]);

    const expected = (entry: string, trial: string): TrialCtaView => {
      const validActive = trial.startsWith("active/");
      if (entry === "owned") return validActive ? { kind: "active", endsAt: END } : { kind: "owned" };
      if (entry === "soon") return { kind: "soon" };
      if (validActive) return { kind: "active", endsAt: END };
      if (trial.startsWith("used/")) return { kind: "used" };
      if (trial === "available/startable=true") return { kind: "start" };
      return { kind: "offer" };
    };
    let n = 0;
    for (const [en, e] of entries)
      for (const [tn, t] of trials) {
        assert.deepEqual(trialCta(e, t), expected(en, tn), `${en} × ${tn}`);
        n++;
      }
    assert.equal(n, 3 * 14);
    // "Bientôt" wins: a soon entry never shows the trial, even startable.
    assert.deepEqual(trialCta({ state: "preview", cta: "soon" }, { state: "available", startable: true }), { kind: "soon" });
    assert.equal(navBadge({ state: "preview", cta: "soon" }, { state: "available", startable: true }), "soon");

    // The sidebar badge and the header can't disagree: navBadge is "try"
    // exactly where the header shows the trial button, "soon" exactly where
    // it shows soon, nothing anywhere else.
    for (const [en, e] of entries)
      for (const [tn, t] of trials) {
        const kind = trialCta(e, t).kind;
        const badge = navBadge(e, t);
        assert.equal(badge === "try", kind === "start", `${en} × ${tn}: "Essai gratuit" iff the header's button`);
        assert.equal(badge === "soon", kind === "soon", `${en} × ${tn}: "Bientôt" iff the header's soon`);
        if (kind !== "start" && kind !== "soon") assert.equal(badge, null, `${en} × ${tn}: no badge`);
      }
    // "start" needs startable === true exactly (not truthy).
    assert.deepEqual(
      trialCta({ state: "preview", cta: "try" }, { state: "available", startable: "yes" as unknown as boolean }),
      { kind: "offer" },
    );
  }

  // ── 1b. The sidebar badge per state (navBlocks + the rendered menu) ─────
  {
    const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
    const menu = {
      reception: { state: "owned" },
      sales: { state: "preview", cta: "soon" },
      connect: { state: "preview", cta: "try" },
    } as const;
    const cases: Array<[string, TrialCtaTrial, "try" | null]> = [
      ["startable", { state: "available", startable: true }, "try"],
      ["not startable", { state: "available", startable: false }, null],
      ["startable absent (main today)", { state: "available" }, null],
      ["no trials passed", undefined, null],
      ["active", { state: "active", endsAt: END, startable: false }, null],
      ["used", { state: "used", endsAt: END, startable: true }, null],
    ];
    for (const [name, trial, badge] of cases) {
      for (const asUserId of [null, "u-1"]) {
        const blocks = navBlocks("reception", menu, asUserId, { connect: trial, sales: { state: "available", startable: true } });
        const items = Object.fromEntries(blocks[0].items.map((i) => [i.id, i]));
        assert.equal(items.connect.badge, badge ?? undefined, `${name}: connect badge`);
        assert.equal(items.connect.preview, "try", `${name}: still a preview`);
        assert.equal(items.sales.badge, "soon", `${name}: soon wins over a startable trial`);
        assert.equal(items.reception.badge, undefined, `${name}: owned = no badge`);
      }
      for (const locale of ["fr", "en", "he"]) {
        const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
        const m = messages.DashboardNav;
        const html = renderToStaticMarkup(
          createElement(Intl, { locale, messages, timeZone: "UTC" },
            createElement(DashboardSidebar, { blocks: navBlocks("reception", menu, null, { connect: trial }) })),
        );
        const tryShown = html.includes(`>${m.stateTry.replace(/'/g, "&#x27;")}</span>`);
        assert.equal(tryShown, badge === "try", `${locale} ${name}: "${m.stateTry}" shown = ${badge === "try"}`);
        assert.ok(html.includes(`>${m.stateSoon}</span>`), `${locale} ${name}: "${m.stateSoon}" on the soon entry`);
      }
    }
    // The sidebar renders the badge, never the raw call to action.
    const sidebar = readFileSync("components/dashboard/DashboardSidebar.tsx", "utf8");
    assert.match(sidebar, /\{item\.badge && \(/);
    assert.match(sidebar, /t\(item\.badge === "try" \? "stateTry" : "stateSoon"\)/);
    assert.doesNotMatch(sidebar, /item\.preview === "try"|\{item\.preview && \(/, "no badge from the cta alone");
    assert.match(readFileSync("lib/dashboard-nav.ts", "utf8"), /const badge = navBadge\(s, trials\?\.\[e\]\);/, "navBlocks uses the header's decision");
  }

  // ── 2. POST: URL and body (tenant, admin ?asUserId) ─────────────────────
  {
    assert.equal(trialStartUrl(), "/api/dashboard/products/trial");
    assert.equal(trialStartUrl(null), "/api/dashboard/products/trial");
    assert.equal(trialStartUrl("u-1&x=2"), "/api/dashboard/products/trial?asUserId=u-1%26x%3D2", "asUserId is encoded");
    const calls: Call[] = [];
    assert.equal(await postTrialStart("sales", undefined, mockFetch(201, { trial: {} }, calls)), "started");
    assert.deepEqual(calls, [
      { url: "/api/dashboard/products/trial", method: "POST", headers: { "Content-Type": "application/json" }, body: '{"product":"sales"}' },
    ]);
    const admin: Call[] = [];
    await postTrialStart("connect", "00000000-0000-4000-8000-000000000abc", mockFetch(201, {}, admin));
    assert.equal(admin[0].url, "/api/dashboard/products/trial?asUserId=00000000-0000-4000-8000-000000000abc");
    assert.equal(admin[0].body, '{"product":"connect"}');
  }

  // ── 3. The outcome of each status (the route's exact statuses and bodies) ─
  {
    const out = (s: number | "throw", body: unknown = null) => postTrialStart("sales", null, mockFetch(s, body, []));
    assert.equal(await out(201, { trial: {} }), "started");
    assert.equal(await out(409, { error: "product_owned" }), "refresh", "owned: refresh shows it");
    assert.equal(await out(409, { error: "trial_used" }), "used");
    assert.equal(await out(409, { error: "product_unavailable" }), "unavailable");
    assert.equal(await out(409, { error: "something_else" }), "error");
    assert.equal(await out(409, null), "error");
    assert.equal(await out(400, { error: "invalid_product" }), "error");
    assert.equal(await out(400, { error: "trial_used" }), "error", "only 409 carries the product codes");
    assert.equal(await out(401, { error: "Unauthorized" }), "error");
    assert.equal(await out(403, { error: "Forbidden" }), "error");
    assert.equal(await out(404, { error: "Not found" }), "error");
    assert.equal(await out(500), "error");
    assert.equal(await out("throw"), "error", "network error");
    const badJson: TrialFetch = async () => ({ status: 409, json: async () => { throw new SyntaxError("bad"); } });
    assert.equal(await postTrialStart("sales", null, badJson), "error", "unreadable body");
    assert.equal(trialStartOutcome(200, null), "error", "only 201 starts");
  }

  // ── 4. No double submit ─────────────────────────────────────────────────
  {
    const calls: Call[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: TrialFetch = async (url, init) => {
      calls.push({ url, ...init });
      await gate;
      return { status: 201, json: async () => ({}) };
    };
    const submit = trialStartSubmitter(() => postTrialStart("sales", null, slow));
    const first = submit();
    const second = submit();
    const third = submit();
    assert.equal(calls.length, 1, "one POST for three clicks");
    release();
    assert.equal(await second, null);
    assert.equal(await third, null);
    assert.equal(await first, "started");
    assert.equal(calls.length, 1);
    const errCalls: Call[] = [];
    const retry = trialStartSubmitter(() => postTrialStart("sales", null, mockFetch(500, null, errCalls)));
    assert.equal(await retry(), "error");
    assert.equal(await retry(), "error");
    assert.equal(errCalls.length, 2, "settled: the next click is a new request");
  }

  // ── 5. What each case renders, in every locale ──────────────────────────
  {
    const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
    const q = (x: string) => x.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
    const buttons = (h: string) => (h.match(/<(button|a)\b/g) ?? []).length;
    for (const locale of ["fr", "en", "he"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      const m = messages.DashboardNav;
      const termsLine = q(String(new IntlMessageFormat(m.previewTrialTerms, locale).format(TERMS)));
      const wrap = (el: ReturnType<typeof createElement>) =>
        renderToStaticMarkup(
          createElement(AppRouterContext.Provider, { value: ROUTER as never }, createElement(Intl, { locale, messages, timeZone: "UTC" }, el)),
        );
      for (const entry of ["reception", "sales", "connect"] as const) {
        const header = (trial: TrialCtaTrial, cta: "soon" | "try" = "try", terms: typeof TERMS | null = TERMS) =>
          wrap(createElement(ProductPreviewHeader, { entry, cta, trial, trialTerms: terms ?? undefined }));
        const tag = `${locale}/${entry}`;

        // Not startable (false, absent, no trial at all, no terms): NEVER the
        // trial button, only the offer link.
        const notStartable: Array<[TrialCtaTrial, typeof TERMS | null]> = [
          [{ state: "available", startable: false }, TERMS],
          [{ state: "available" }, TERMS],
          [undefined, TERMS],
          [{ state: "available", startable: true }, null],
        ];
        for (const [trial, terms] of notStartable) {
          const h = header(trial, "try", terms);
          assert.ok(!h.includes(q(m.previewTry)), `${tag}: not startable → no "Essayer gratuitement" (${JSON.stringify(trial)})`);
          assert.ok(!h.includes(termsLine), `${tag}: no terms line`);
          assert.match(h, /data-trial="offer"/);
          assert.equal(buttons(h), 1, `${tag}: one offer link`);
          assert.ok(h.includes(q(m.previewOffer)), `${tag}: "Voir l'offre"`);
          if (entry !== "sales") assert.match(h, /href="[^"]*dashboard\/billing"/, `${tag}: offer → the subscription page`);
        }

        // available & startable: the button + the terms line from the source.
        const start = header({ state: "available", startable: true });
        assert.match(start, /data-trial="start"/);
        assert.equal(buttons(start), 1, `${tag}: one button`);
        assert.ok(start.includes(`${q(m.previewTry)}</button>`), `${tag}: the button is "Essayer gratuitement"`);
        assert.ok(start.includes(termsLine), `${tag}: the terms line, from the source values`);
        assert.doesNotMatch(start, / disabled=""| aria-busy=|role="alert"/, `${tag}: idle`);
        assert.ok(!start.includes(q(m.previewOffer)));

        // active: the date, no button.
        const active = header({ state: "active", endsAt: END, startable: false });
        assert.match(active, /data-trial="active"/);
        assert.equal(buttons(active), 0, `${tag}: active = no button`);
        assert.match(active, /role="status"/);
        assert.match(active, /2026/, `${tag}: the localized date`);
        assert.ok(!active.includes(q(m.previewTry)));

        // used: the line + the offer link, no trial button (even if startable).
        const used = header({ state: "used", endsAt: END, startable: true });
        assert.match(used, /data-trial="used"/);
        assert.ok(used.includes(q(m.previewTrialUsed)), `${tag}: "Votre essai est terminé."`);
        assert.ok(used.includes(q(m.previewOffer)));
        assert.ok(!used.includes(q(m.previewTry)), `${tag}: used = no trial button`);
        assert.equal(buttons(used), 1);

        // soon: unchanged, whatever the trial says.
        const soon = header({ state: "available", startable: true }, "soon");
        assert.match(soon, /data-trial="soon"/);
        assert.ok(soon.includes(`${q(m.previewNotify)}</button>`));
        assert.ok(!soon.includes(q(m.previewTry)) && !soon.includes(q(m.previewOffer)));

        // The start block by phase.
        const view = (phase: TrialStartPhase) => wrap(createElement(TrialStartView, { entry, phase, terms: TERMS }));
        const pending = view("pending");
        assert.match(pending, /<button[^>]* disabled=""[^>]* aria-busy="true"/, `${tag}: pending = disabled + aria-busy`);
        assert.match(view("refreshing"), /<button[^>]* disabled=""[^>]* aria-busy="true"/, `${tag}: refreshing = still disabled`);
        const name = q(m[entry]);
        for (const [phase, key, keepsButton] of [
          ["used", "previewTrialErrorUsed", false],
          ["unavailable", "previewTrialErrorUnavailable", false],
          ["error", "previewTrialError", true],
        ] as const) {
          const h = view(phase);
          assert.match(h, /role="alert"/, `${tag}: ${phase} = inline alert`);
          const msg = q(m[key].replace("{product}", m[entry]));
          assert.ok(h.includes(msg), `${tag}: ${phase} message in the product's words (${name})`);
          assert.equal(buttons(h), keepsButton ? 1 : 0, `${tag}: ${phase} button ${keepsButton ? "stays" : "goes"}`);
          if (keepsButton) assert.doesNotMatch(h, / disabled=""/, `${tag}: retry possible`);
        }
      }

      // Owned pages: the running-trial line only while active.
      const note = (trial: TrialCtaTrial) => wrap(createElement(ProductTrialNote, { trial }));
      assert.match(note({ state: "active", endsAt: END }), /role="status"[^>]*>[^<]*2026/);
      assert.equal(note({ state: "used", endsAt: END }), "");
      assert.equal(note({ state: "available", startable: true }), "");
      assert.equal(note(undefined), "");
    }
    // The FR date reads "1 décembre 2026".
    const fr = JSON.parse(readFileSync("messages/fr.json", "utf8"));
    const h = renderToStaticMarkup(
      createElement(Intl, { locale: "fr", messages: fr, timeZone: "UTC" },
        createElement(ProductPreviewHeader, { entry: "sales", cta: "try", trial: { state: "active", endsAt: END } })),
    );
    assert.ok(h.includes("Essai en cours jusqu&#x27;au 1 décembre 2026."), h);
  }

  // ── 6. Wiring: the pages pass the BE's trials and the source terms ──────
  {
    const read = (p: string) => readFileSync(p, "utf8");
    for (const [page, entry] of [["sales", "sales"], ["agent", "connect"], ["reception", "reception"]]) {
      const src = read(`app/[locale]/dashboard/${page}/page.tsx`);
      assert.match(src, /const \{ menu, notifyRequested, trials, trialTerms \} = await loadProductPage\(session\.user\.id\);/, page);
      assert.match(src, new RegExp(`trial=\\{trials\\.${entry}\\}\\s*trialTerms=\\{trialTerms\\}`), `${page}: header gets trials.${entry}`);
      assert.match(src, new RegExp(`<ProductTrialNote trial=\\{trials\\.${entry}\\}`), `${page}: owned page shows a running trial`);
    }
    const gates = read("lib/product-gates.ts");
    assert.match(gates, /days: PRODUCT_TRIAL_DAYS,\s*minutes: PRODUCT_TRIAL_MINUTES,/, "terms from lib/product-trials.ts");
    assert.match(gates, /trials: products\.trials,/, "trials from accountProducts");
    // Startable is the BE's: never derived on the FE from flags or caps.
    for (const f of ["lib/trial-cta.ts", "lib/trial-start.ts", "components/dashboard/ProductPreviewHeader.tsx", "components/dashboard/ProductTrialNote.tsx", "lib/product-gates.ts"]) {
      const code = read(f).replace(/^\s*(\/\/|\*).*$/gm, "");
      assert.doesNotMatch(code, /productTrialStartable|TRIAL_CAPS_ENFORCED|SALES_TRIAL_CAP_ENFORCED/, `${f}: startable is read, not derived`);
    }
    // The client helpers stay client-safe.
    for (const f of ["lib/trial-cta.ts", "lib/trial-start.ts"]) {
      const lib = read(f);
      assert.doesNotMatch(lib, /@\/lib\/db|from "\.\/db|process\.env/);
      assert.doesNotMatch(lib.replace(/^import type .*$/gm, ""), /^import /m, `${f}: type-only imports`);
    }
    assert.doesNotMatch(read("components/dashboard/ProductPreviewHeader.tsx"), /from "@\/lib\/product-trials"|from "@\/lib\/product-gates"/, "the header imports no server module");
    const hdr = read("components/dashboard/ProductPreviewHeader.tsx");
    assert.match(hdr, /useState\(\(\) => trialStartSubmitter\(\(\) => postTrialStart\(entry, asUserId\)\)\)/, "one guarded submitter per header");
    assert.match(hdr, /startRefresh\(\(\) => router\.refresh\(\)\)/, "201 / owned: refresh");
  }

  console.log("trial-cta: OK");
  finished = true;
}

let finished = false;
process.on("exit", (code) => {
  if (code === 0 && !finished) {
    console.error("trial-cta: did not run to the end");
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
