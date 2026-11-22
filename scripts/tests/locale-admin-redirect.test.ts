// /{fr,en,he}/admin and /{fr,en,he}/admin/** redirect (307) to /admin and
// /admin/**, keeping the query string; nothing else is redirected.
// The rules are read from next.config.ts and evaluated with Next's own route
// matcher and destination builder (the same calls its router makes for a
// next.config redirect: getPathMatch with strict + removeUnnamedParams, then
// prepareDestination with appendParamsToQuery: false). Mock paths only.
// Run with:  npx tsx scripts/tests/locale-admin-redirect.test.ts

import assert from "node:assert/strict";
import { stringify } from "node:querystring";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { getRedirectStatus } from "next/dist/lib/redirect-status";

import nextConfig from "../../next.config";

type Redirect = { source: string; destination: string; permanent?: boolean; statusCode?: number };

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** { status, location } when a next.config redirect applies to `url`, null otherwise. */
function resolve(rules: Redirect[], url: string): { status: number; location: string } | null {
  const u = new URL(url, "http://localhost");
  const query = Object.fromEntries(u.searchParams.entries());
  for (const rule of rules) {
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(u.pathname);
    if (!params) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params,
      query,
    });
    const search = stringify(parsedDestination.query);
    return {
      status: getRedirectStatus(rule as Parameters<typeof getRedirectStatus>[0]),
      location: `${parsedDestination.pathname}${search ? `?${search}` : ""}`,
    };
  }
  return null;
}

async function main() {
  console.log("locale-prefixed /admin redirect");
  const rules = ((await nextConfig.redirects?.()) ?? []) as Redirect[];

  const REDIRECTED: Array<[string, string]> = [
    ["/fr/admin", "/admin"],
    ["/en/admin", "/admin"],
    ["/he/admin", "/admin"],
    ["/he/admin/users", "/admin/users"],
    ["/fr/admin/users/00000000-0000-4000-8000-000000000001", "/admin/users/00000000-0000-4000-8000-000000000001"],
    ["/en/admin/users/00000000-0000-4000-8000-000000000001/calendar", "/admin/users/00000000-0000-4000-8000-000000000001/calendar"],
    ["/fr/admin/finance", "/admin/finance"],
    ["/en/admin?x=1", "/admin?x=1"],
    ["/fr/admin/finance?tab=costs&range=30d", "/admin/finance?tab=costs&range=30d"],
  ];
  for (const [from, to] of REDIRECTED) {
    await test(`${from} → 307 ${to}`, () => {
      assert.deepEqual(resolve(rules, from), { status: 307, location: to });
    });
  }

  const NOT_REDIRECTED = [
    "/fr/administration",
    "/fr/admins",
    "/fr/admin-foo",
    "/fr/admin-something/x",
    "/he/adminx",
    "/fr/dashboard/admin",
    "/fr/dashboard/admin/users",
    "/fr/sales/admin",
    "/de/admin", // not one of our locales
    "/admin", // already the target: no loop
    "/admin/users",
    "/fr",
    "/fr/dashboard",
    "/api/admin/users",
  ];
  for (const path of NOT_REDIRECTED) {
    await test(`${path} → not redirected`, () => {
      assert.equal(resolve(rules, path), null);
    });
  }

  await test("the redirect is temporary (307), never cached as permanent", () => {
    const admin = rules.filter((r) => r.destination.startsWith("/admin"));
    assert.ok(admin.length > 0, "no /admin redirect rule in next.config.ts");
    for (const r of admin) {
      assert.equal(r.permanent, false);
      assert.equal(r.statusCode, undefined);
    }
  });

  await test("no other redirect rule exists", () => {
    assert.deepEqual(
      rules.map((r) => r.destination),
      ["/admin/:path*"],
    );
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
