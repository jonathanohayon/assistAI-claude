// "Set up your agent": the three defaults, the next step on the collapsed
// row, the remembered choice, and the shared disclosure. Mock data only.
// Run with:  npx tsx scripts/tests/setup-checklist.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SetupChecklist } from "../../components/dashboard/SetupChecklist";
import { defaultOpen, nextStep, resolveOpen } from "../../components/dashboard/setup-checklist-ui";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 1. Defaults: 0 done → open; some done → collapsed; the remembered choice wins either way.
assert.equal(defaultOpen(0), true);
assert.equal(defaultOpen(3), false);
assert.equal(resolveOpen(null, 0), true);
assert.equal(resolveOpen(null, 3), false);
assert.equal(resolveOpen("1", 3), true, "remembered open");
assert.equal(resolveOpen("0", 0), false, "remembered closed");
assert.equal(resolveOpen("garbage", 2), false, "unknown value → default");

// 2. The next step is the first one still to do, in order.
const steps = [
  { id: "number", done: true },
  { id: "testCall", done: true },
  { id: "forwarding", done: false },
  { id: "scan", done: true },
  { id: "calendar", done: false },
];
assert.equal(nextStep(steps)?.id, "forwarding");
assert.equal(nextStep(steps.map((s) => ({ ...s, done: true }))), null);

// 3. The block uses the shared disclosure; all done keeps today's congratulation + dismiss.
const src = read("components/dashboard/SetupChecklist.tsx");
assert.match(src, /import \{ MoreSettings \} from "@\/components\/bricks\/MoreSettings";/);
assert.match(src, /<MoreSettings\b/);
assert.doesNotMatch(src, /aria-expanded|<details\b|role="region"/, "no second disclosure");
assert.match(src, /if \(allDone\) \{\s*if \(dismissed\) return null;/, "all done: congratulation path unchanged");
assert.match(src, /localStorage\.setItem\(DISMISS_KEY, "1"\)/);
// The remembered choice is read and written safely.
assert.match(src, /try \{[^}]*localStorage\.getItem\(SETUP_OPEN_KEY\)/);
assert.match(src, /try \{[^}]*localStorage\.setItem\(SETUP_OPEN_KEY/);

// 4. The real component, server-rendered (what the page sends before the remembered choice is read).
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
type Props = { hasPhone: boolean; googleConnected: boolean; businessFilled: boolean; whatsappSet: boolean; forwardingVerified?: boolean };
const render = (locale: string, props: Props) =>
  renderToStaticMarkup(
    createElement(Intl, { locale, messages: JSON.parse(read(`messages/${locale}.json`)), timeZone: "UTC" }, createElement(SetupChecklist, props)),
  );
for (const locale of ["fr", "he"]) {
  const m = JSON.parse(read(`messages/${locale}.json`)).DashboardSetup;
  const next = (step: string) => m.nextStep.replace("{step}", step);

  // 0 done → open, every step listed, no "next" line.
  const none = render(locale, { hasPhone: false, googleConnected: false, businessFilled: false, whatsappSet: false });
  assert.match(none, /aria-expanded="true"/, `${locale}: 0 done → open`);
  assert.ok(!none.includes(next(m.numberTitle)), `${locale}: no next line when open`);
  assert.ok(none.includes(m.whatsappTitle), `${locale}: the six steps are there`);

  // Some done → collapsed, the next step named, with its action.
  const some = render(locale, { hasPhone: true, googleConnected: false, businessFilled: true, whatsappSet: false });
  assert.match(some, /aria-expanded="false"/, `${locale}: some done → collapsed`);
  assert.ok(some.includes(next(m.forwardingTitle)), `${locale}: next = forwarding`);
  assert.ok(some.includes(m.forwardingCta), `${locale}: its action is on the row`);
  assert.ok(some.includes(m.progress.replace("{done}", "3").replace("{total}", "6")), `${locale}: 3/6 on the row`);

  // All done → today's congratulation + dismiss, no disclosure.
  const all = render(locale, { hasPhone: true, googleConnected: true, businessFilled: true, whatsappSet: true, forwardingVerified: true });
  assert.ok(all.includes(m.congratsTitle) && all.includes(m.dismiss), `${locale}: congratulation`);
  assert.doesNotMatch(all, /aria-expanded/, `${locale}: no disclosure when all done`);
}

console.log("ALL SETUP-CHECKLIST TESTS PASSED");
