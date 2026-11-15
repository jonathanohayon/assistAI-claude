// Public pages (no sign-in): the scan scripts/check-tenant-bundle.mjs runs on
// /dashboard*, run on the pages any visitor or signing-up tenant loads. They
// must carry no supplier name, model id, tool name or instruction text
// (scripts/tenant-bundle-match.mjs), e.g. the landing demo (VoiceAgent) gets
// its session fully set server-side (lib/demo-session.ts).
//
//   node scripts/check-public-bundle.mjs <baseUrl>
//
// Run against a production build (next build && next start). A page that
// isn't 200 (redirect, 404) is reported and skipped. Exit 1 on any match.
// Same pages as the gate-tools public-pages-check.mjs it was copied from.
import { hits } from "./tenant-bundle-match.mjs";

const [base] = process.argv.slice(2);
if (!base) {
  console.error("usage: node scripts/check-public-bundle.mjs <baseUrl>");
  process.exit(2);
}

const PUBLIC_PATHS = ["", "/login", "/signup", "/verify-email", "/forgot-password", "/sales", "/connect"];
const PAGES = ["fr", "en", "he"].flatMap((l) => PUBLIC_PATHS.map((p) => `/${l}${p}`));

const chunkPaths = (text) => new Set([...text.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./~]+?\.js/g)].map((m) => m[0]));
const cache = new Map();
const get = (p) => fetch(new URL(p, base), { redirect: "manual" });
async function chunk(p) {
  if (!cache.has(p)) cache.set(p, await (await get(p)).text());
  return cache.get(p);
}
const show = (label, h) => {
  for (const [word, ctx] of h) console.log(`  ✗ ${label}: "${word}" e.g. …${ctx[0]}…`);
};

let failed = false;
let scanned = 0;
for (const page of PAGES) {
  const res = await get(page);
  if (res.status !== 200) {
    console.log(`${page}: HTTP ${res.status} (skipped)`);
    continue;
  }
  scanned++;
  const html = await res.text();
  const loaded = chunkPaths(html);
  const h = hits(html);
  show(`${page} HTML`, h);
  if (h.size) failed = true;
  for (const p of loaded) {
    const hc = hits(await chunk(p));
    show(`${page} ${p}`, hc);
    if (hc.size) failed = true;
  }
}
if (scanned === 0) {
  console.log("FAIL: no public page answered 200");
  process.exit(1);
}
console.log(
  failed
    ? "FAIL: supplier, model, tool or instruction text reaches a public page"
    : `PASS: 0 matches in ${scanned} public pages and their loaded chunks`,
);
process.exit(failed ? 1 : 0);
