// /[locale]/dashboard-preview/** is a mock dashboard: admins only.
//   - signed out          → 404 (notFound)
//   - signed-in tenant    → 404 (notFound), same answer as signed out
//   - signed-in admin     → renders, with robots noindex/nofollow
// The decision is the one requireAdminPage() uses for app/admin/** (same
// session → users.role lookup), answered with notFound() instead of a redirect.
// The layout gates the whole segment; each page gates again before building
// anything, since layouts and pages render in parallel and layouts don't
// re-run on client navigation. next.config.ts adds X-Robots-Tag on every
// response under the segment. Mock data only.
// Run with:  npx tsx scripts/tests/dashboard-preview-gate.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { adminOnlyOr404, isAdminViewer, SIGNED_OUT, type PageViewer } from "../../lib/auth/admin-viewer";
import nextConfig from "../../next.config";
import { REPO_ROOT, assertScanRead, scanSources } from "./helpers/source-scan";

const SEGMENT = "app/[locale]/dashboard-preview";
const LAYOUT = `${SEGMENT}/layout.tsx`;
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

const TENANT: PageViewer = { userId: "00000000-0000-4000-8000-000000000001", role: "user" };
const ADMIN: PageViewer = { userId: "00000000-0000-4000-8000-000000000002", role: "admin" };
const DELETED_ROW: PageViewer = { userId: "00000000-0000-4000-8000-000000000003", role: null };

/** "404" when the gate called notFound(), "render" when it let the page through. */
async function outcome(viewer: PageViewer): Promise<"404" | "render"> {
  try {
    await adminOnlyOr404(async () => viewer);
    return "render";
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.endsWith(";404")) return "404";
    throw e;
  }
}

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("dashboard-preview admin gate");

  await test("signed out → 404", async () => {
    assert.equal(await outcome(SIGNED_OUT), "404");
  });

  await test("signed-in tenant → 404 (not a redirect, not the page)", async () => {
    assert.equal(await outcome(TENANT), "404");
  });

  await test("session whose users row is gone → 404", async () => {
    assert.equal(await outcome(DELETED_ROW), "404");
  });

  await test("a role without a session never counts as admin", async () => {
    assert.equal(isAdminViewer({ userId: null, role: "admin" }), false);
    assert.equal(await outcome({ userId: null, role: "admin" }), "404");
  });

  await test("signed-in admin → renders", async () => {
    assert.equal(await outcome(ADMIN), "render");
  });

  // Each route of the segment, by name: its page and the layout above it both
  // run this same gate first (checked by source below), so its outcome per
  // viewer is the gate's outcome.
  const ROUTES = [
    { route: "/{locale}/dashboard-preview", page: `${SEGMENT}/page.tsx` },
    { route: "/{locale}/dashboard-preview/wow", page: `${SEGMENT}/wow/page.tsx` },
  ];
  for (const { route, page } of ROUTES) {
    await test(`${route} → 404 for anonymous (signed out)`, async () => {
      assert.match(read(page), /await requireAdminOr404\(\);/);
      assert.equal(await outcome(SIGNED_OUT), "404");
    });
    await test(`${route} → 404 for a tenant`, async () => {
      assert.match(read(page), /await requireAdminOr404\(\);/);
      assert.equal(await outcome(TENANT), "404");
    });
    await test(`${route} → renders for an admin`, async () => {
      assert.equal(await outcome(ADMIN), "render");
    });
  }

  await test("requireAdminPage and requireAdminOr404 share the same loader and decision", () => {
    const src = read("lib/auth/require-admin-page.ts");
    assert.match(src, /export function requireAdminOr404\(\)[^{]*\{\s*return adminOnlyOr404\(loadPageViewer\);/);
    assert.match(src, /isAdminViewer\(\{ userId, role: me\.role \}\)/, "requireAdminPage uses isAdminViewer");
  });

  await test("the layout gates the segment before rendering children, with robots noindex/nofollow", () => {
    const src = read(LAYOUT);
    assert.match(src, /import \{ requireAdminOr404 \} from "@\/lib\/auth\/require-admin-page";/);
    const body = src.slice(src.indexOf("export default async function"));
    assert.ok(body.length > 0, "layout is an async server component");
    assert.match(body, /^export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdminOr404\(\);/);
    assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    assert.doesNotMatch(src, /^"use client"/m, "layout must stay a server component");
  });

  await test("every page under the segment gates first, before any other statement", () => {
    const scan = scanSources([SEGMENT], { ext: /\.tsx?$/ });
    assertScanRead(scan, SEGMENT, {
      minFiles: 5,
      sentinels: [LAYOUT, `${SEGMENT}/page.tsx`, `${SEGMENT}/wow/page.tsx`, `${SEGMENT}/wow/client.tsx`],
    });
    const pages = scan.files.filter((f) => /\/page\.tsx$/.test(f));
    assert.ok(pages.includes(`${SEGMENT}/page.tsx`) && pages.includes(`${SEGMENT}/wow/page.tsx`), `pages found: ${pages}`);
    assert.ok(scan.files.includes(LAYOUT), "the segment layout exists");
    for (const p of pages) {
      const src = scan.text.get(p)!;
      assert.doesNotMatch(src, /^"use client"/m, `${p} must stay a server component`);
      assert.match(
        src,
        /export default async function \w+\([^)]*(?:\{[^}]*\}[^)]*)?\)[^{]*\{\s*await requireAdminOr404\(\);/,
        `${p}: first statement is await requireAdminOr404()`,
      );
    }
    // Client modules of the segment hold only static constants at top level:
    // they run only when a gated page renders them.
    for (const f of scan.files.filter((f) => /^"use client"/m.test(scan.text.get(f)!))) {
      const src = scan.text.get(f)!;
      assert.doesNotMatch(src, /^(?:await |fetch\(|void )/m, `${f}: no top-level side effects`);
    }
  });

  await test("next.config sends X-Robots-Tag: noindex, nofollow under the segment, prefixed or not", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const sources = rules
      .filter((r) => r.headers.some((h) => h.key === "X-Robots-Tag" && h.value === "noindex, nofollow"))
      .map((r) => r.source);
    assert.ok(sources.includes("/dashboard-preview/:path*"), `sources: ${sources}`);
    assert.ok(sources.includes("/:locale(fr|en|he)/dashboard-preview/:path*"), `sources: ${sources}`);
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
