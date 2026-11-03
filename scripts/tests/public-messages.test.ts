// Public pages only ship i18n/public-namespaces to the browser. This test
// walks the client imports of every public route and fails if one of them
// reads a namespace that isn't in that list (it would render a raw key).
// Run : npx tsx scripts/tests/public-messages.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { ADMIN_ONLY_NAMESPACES, PUBLIC_NAMESPACES } from "../../i18n/public-namespaces";
import { clientNamespaces } from "./client-namespaces";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

const ROOT = resolve(__dirname, "../..");
const LOCALE_DIR = join(ROOT, "app/[locale]");
// Subtrees wrapped in FullMessagesProvider: they get every namespace.
const FULL_SUBTREES = ["dashboard", "dashboard-preview"];
const ROUTE_FILES = /^(page|layout|template|loading|error|not-found)\.tsx$/;

function publicRouteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (dir === LOCALE_DIR && FULL_SUBTREES.includes(name)) continue;
      publicRouteFiles(p, out);
    } else if (ROUTE_FILES.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}

const entries = publicRouteFiles(LOCALE_DIR);
const walk = clientNamespaces(entries);
const allowed = new Set<string>(PUBLIC_NAMESPACES);

group("public routes are discovered", () => {
  assert.ok(entries.some((e) => e.endsWith("[locale]/page.tsx")), "landing not found");
  assert.ok(entries.some((e) => e.includes("/login/")), "login not found");
});

group("every namespace read on a public page is shipped", () => {
  const missing = [...walk.namespaces].filter((ns) => !allowed.has(ns)).sort();
  assert.deepStrictEqual(missing, [], `add to i18n/public-namespaces.ts: ${missing.join(", ")}`);
});

group("no dynamic useTranslations() on public pages", () => {
  assert.deepStrictEqual(walk.unknown, [], "the walker can't check a namespace held in a variable");
});

for (const locale of ["fr", "en", "he"]) {
  group(`${locale}: every public namespace exists`, () => {
    const msgs = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
    const absent = PUBLIC_NAMESPACES.filter((ns) => !(ns in msgs));
    assert.deepStrictEqual(absent, []);
  });
}

group("admin-only namespaces are never public", () => {
  const leaked = ADMIN_ONLY_NAMESPACES.filter((ns) => allowed.has(ns) || walk.namespaces.has(ns));
  assert.deepStrictEqual(leaked, []);
});

group("the dashboard trees re-provide the full set", () => {
  for (const sub of FULL_SUBTREES) {
    const layout = readFileSync(join(LOCALE_DIR, sub, "layout.tsx"), "utf8");
    assert.ok(layout.includes("FullMessagesProvider"), `${sub}/layout.tsx must wrap in FullMessagesProvider`);
  }
});

console.log(
  `public-messages: ${passed} passed, ${failures.length} failed (${entries.length} public route files, ${walk.clientFiles.size} client modules, ${walk.namespaces.size} namespaces)`,
);
if (failures.length) {
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
