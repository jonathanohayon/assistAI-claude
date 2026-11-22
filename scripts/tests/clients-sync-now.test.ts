// The Clients page (/dashboard/clients) keeps the "sync now" button of the
// old /dashboard/calendar page: same component (SyncNowButton), shown in the
// calendar section whenever Google is connected (expired token included),
// absent when it is not. The admin view keeps its own (Clients → calendar
// section, scoped with asUserId). Also: AgentBrain's line points to Mon agent.
// Mock data only.
// Run with:  npx tsx scripts/tests/clients-sync-now.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CrmClient } from "../../app/[locale]/dashboard/crm/crm-client";

const read = (p: string) => readFileSync(p, "utf8");
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

const render = (locale: string, googleConnected: boolean, tokenExpired = false) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(
        Intl,
        { locale, messages: JSON.parse(read(`messages/${locale}.json`)), timeZone: "UTC" },
        createElement(CrmClient, {
          events: [],
          contacts: [],
          googleConnected,
          tokenExpired,
          selectedCalendarId: "primary",
          hasCalendar: true,
          hasCrm: true,
          isAdmin: false,
        }),
      ),
    ),
  );

for (const locale of ["fr", "en", "he"]) {
  const label = JSON.parse(read(`messages/${locale}.json`)).DashboardCalendar;
  const syncWords = Object.entries(label as Record<string, string>).filter(([k]) => /^sync(Now|Button)?$/i.test(k)).map(([, v]) => v);
  assert.ok(syncWords.length > 0, `${locale}: the button's label key exists`);
  const on = render(locale, true);
  assert.ok(syncWords.some((w) => on.includes(w)), `${locale}: Clients shows "sync now" (connected)`);
  assert.ok(syncWords.some((w) => render(locale, true, true).includes(w)), `${locale}: shown with an expired token too (as before)`);
  assert.ok(!syncWords.some((w) => render(locale, false).includes(w)), `${locale}: not shown before Google is connected`);
}

// Same component, tenant (no asUserId) and admin (asUserId) views.
assert.match(read("app/[locale]/dashboard/crm/crm-client.tsx"), /import \{ SyncNowButton \} from "\.\.\/calendar\/sync-button";[\s\S]*<SyncNowButton \/>/);
assert.match(read("app/admin/users/[userId]/clients/calendar-section.tsx"), /\{!notConnected && <SyncNowButton asUserId=\{target\.id\} \/>\}/);
assert.match(read("app/admin/users/[userId]/clients/page.tsx"), /<AdminTenantCalendarSection userId=\{userId\} \/>/);

// AgentBrain's line now lives on "Votre agent": it points to Mon agent (a
// link to the menu's own URL, admin-aware), not "above".
const desc = (l: string) => JSON.parse(read(`messages/${l}.json`)).AgentBrain.desc as string;
assert.match(desc("fr"), /avec la personnalité réglée dans <link>Mon agent<\/link>\./);
assert.match(desc("en"), /<link>My agent<\/link>/);
assert.match(desc("he"), /<link>הסוכן שלי<\/link>/);
{
  const page = read("app/[locale]/dashboard/agent/page.tsx");
  assert.match(page, /tBrain\.rich\("desc", \{ link: myAgentLink\(\) \}\)/);
  assert.match(page, /const href = entryHref\("myAgent", asUserId\)!;/, "the menu's URL: /dashboard/my-agent, or /admin/users/<id>/my-agent");
  assert.match(page, /asUserId \? \(\s*<NextLink href=\{href\}/);
}
for (const l of ["fr", "en", "he"]) assert.doesNotMatch(desc(l), /ci-dessus|above|למעלה/, `${l}: no "above"`);

console.log("clients-sync-now: OK");
