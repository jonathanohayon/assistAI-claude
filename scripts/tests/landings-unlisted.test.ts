// The landing previews (/sales, /connect) are UNLISTED:
//   1. no link to them anywhere in app/, components/, lib/ or messages/,
//      outside their own files;
//   2. no sitemap lists them;
//   3. each page sets robots noindex/nofollow in its metadata.
// Run with:  npx tsx scripts/tests/landings-unlisted.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(__dirname, "..", "..");
const ROUTES = ["sales", "connect"] as const;

/** A landing route's own files: its page and its content object. */
const OWN_FILES: Record<(typeof ROUTES)[number], RegExp> = {
  sales: /^(app\/\[locale\]\/sales\/|lib\/marketing\/landings\/sales\.ts$)/,
  connect: /^(app\/\[locale\]\/connect\/|lib\/marketing\/landings\/connect\.ts$)/,
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs|json|md|xml|txt)$/.test(name)) out.push(p);
  }
  return out;
}

// A path to the route: "/sales", "/fr/sales", "/[locale]/sales", "${locale}/sales",
// with or without a query or hash, as a string literal or in a template.
const linkTo = (route: string) =>
  new RegExp(`(?:["'\`(}]|["'\`(}/](?:fr|en|he|\\[locale\\]))/${route}(?=["'\`?#/)\\s]|$)`, "m");

// Sanity: the pattern sees the forms a link can take and spares other words.
for (const s of ['href="/sales"', "href={`/${locale}/sales?door=x`}", "'/fr/connect#contract'", 'redirect("/connect")', '"/[locale]/sales"'])
  assert.ok(linkTo("sales").test(s) || linkTo("connect").test(s), `pattern catches ${s}`);
for (const s of ['"/api/google/connect-sheet"', '"/dashboard/salesforce"', "wholesales/", '"/dashboard/sales"', '"/api/x/connect"'])
  assert.ok(!linkTo("sales").test(s) && !linkTo("connect").test(s), `pattern spares ${s}`);

// 1. No link outside the routes' own files.
const files = ["app", "components", "lib", "messages", "i18n"].flatMap((d) => walk(join(root, d)));
assert.ok(files.length > 100, "walked the source tree");
for (const route of ROUTES) {
  const re = linkTo(route);
  const offenders = files
    .map((f) => relative(root, f).split("\\").join("/"))
    .filter((rel) => !OWN_FILES[route].test(rel))
    .filter((rel) => {
      const src = readFileSync(join(root, rel), "utf8");
      // API routes may legitimately contain "/connect" segments under /api/…;
      // only a path that STARTS with the route (or a locale prefix) counts.
      return src.split("\n").some((line) => re.test(line) && !/\/api\/[^"'`]*\/(sales|connect)/.test(line));
    });
  assert.deepEqual(offenders, [], `no link to /${route} outside its own files`);
}

// 2. Sitemap: none lists the landing routes (today there is no sitemap at all;
// if one is added, it must not list them).
const sitemapSources = [
  ...["app", "app/[locale]", "public"].flatMap((d) =>
    existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((n) => /^sitemap|^robots/.test(n)).map((n) => join(d, n)) : [],
  ),
  "next-sitemap.config.js",
  "next-sitemap.config.mjs",
].filter((p) => existsSync(join(root, p)));
for (const p of sitemapSources) {
  const src = statSync(join(root, p)).isDirectory()
    ? walk(join(root, p)).map((f) => readFileSync(f, "utf8")).join("\n")
    : readFileSync(join(root, p), "utf8");
  for (const route of ROUTES) assert.doesNotMatch(src, new RegExp(`/${route}\\b`), `${p} must not list /${route}`);
}

// 3. noindex in each existing landing page's metadata.
for (const route of ROUTES) {
  const page = join(root, "app", "[locale]", route, "page.tsx");
  if (!existsSync(page)) continue;
  const src = readFileSync(page, "utf8");
  assert.match(src, /export async function generateMetadata|export const metadata/, `/${route} has metadata`);
  assert.match(src, /robots: \{ index: false, follow: false \}/, `/${route} is noindex, nofollow`);
}
for (const route of ROUTES) assert.ok(existsSync(join(root, "app", "[locale]", route, "page.tsx")), `the /${route} page exists`);

console.log("landings-unlisted: ok");
