#!/usr/bin/env node
// Proof that a TENANT's browser never receives supplier names (Voice brick
// rule). Run against a PRODUCTION build (`next build && next start`) backed
// by a throwaway database with a mock tenant — never against production.
//
//   node scripts/check-tenant-bundle.mjs http://localhost:3997 tenant@example.test <password>
//
// For each tenant page: fetch the HTML (signed in as the tenant), collect
// every /_next/static JS chunk the page loads (script tags + chunk paths in
// the HTML/RSC payload), fetch them, then follow chunk paths found inside
// those chunks (dynamic imports) and report them SEPARATELY: those are only
// downloaded on demand (e.g. admin-only code) and say which ones contain a
// match. Exit 1 if the page or any statically loaded chunk matches.

import { hits } from "./tenant-bundle-match.mjs";

const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
  console.error("usage: check-tenant-bundle.mjs <baseUrl> <tenantEmail> <password>");
  process.exit(2);
}

// NextAuth basePath (auth.ts).
const AUTH = "/api/admin/auth";
// Every tenant page under /dashboard, in the three languages.
const TENANT_PATHS = ["/dashboard", "/dashboard/settings", "/dashboard/billing", "/dashboard/calendar", "/dashboard/contacts", "/dashboard/crm", "/dashboard/logs", "/dashboard/forwarding", "/dashboard/campaigns"];
const PAGES = ["fr", "en", "he"].flatMap((l) => TENANT_PATHS.map((p) => `/${l}${p}`));

let cookie = "";
const remember = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    const name = kv.split("=")[0];
    cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${name}=`)), kv].join("; ");
  }
};
async function get(path, opts = {}) {
  const res = await fetch(new URL(path, base), { redirect: "manual", ...opts, headers: { cookie, ...(opts.headers ?? {}) } });
  remember(res);
  return res;
}

// Sign in (NextAuth credentials).
{
  const csrf = await (await get(`${AUTH}/csrf`)).json();
  const res = await get(`${AUTH}/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, json: "true" }),
  });
  if (!/session-token=/.test(cookie)) {
    console.error(`sign-in failed (HTTP ${res.status})`);
    process.exit(2);
  }
}

const chunkPaths = (text) => new Set([...text.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./~]+?\.js/g)].map((m) => m[0]));
const show = (label, h) => {
  for (const [word, ctx] of h) console.log(`  ✗ ${label}: "${word}" e.g. …${ctx[0]}…`);
};

const cache = new Map();
async function chunk(path) {
  if (!cache.has(path)) cache.set(path, await (await get(path)).text());
  return cache.get(path);
}

let failed = false;
for (const page of PAGES) {
  const res = await get(page);
  if (res.status !== 200) {
    console.log(`${page}: HTTP ${res.status} (not a tenant page here, skipped)`);
    continue;
  }
  const html = await res.text();
  const loaded = chunkPaths(html);
  console.log(`${page}: HTML ${html.length} B, ${loaded.size} chunks loaded with the page`);
  const pageHits = hits(html);
  show(`${page} HTML`, pageHits);
  if (pageHits.size) failed = true;

  const onDemand = new Set();
  for (const p of loaded) {
    const code = await chunk(p);
    const h = hits(code);
    show(p, h);
    if (h.size) failed = true;
    for (const q of chunkPaths(code)) if (!loaded.has(q)) onDemand.add(q);
  }
  // Chunks only fetched on demand (dynamic import): reported, not a failure
  // by themselves — the question is which ones a tenant could ever trigger.
  for (const q of onDemand) {
    const h = hits(await chunk(q));
    if (h.size) console.log(`  · on demand ${q}: ${[...h.keys()].join(", ")}`);
  }
}

console.log(failed ? "FAIL: supplier names reach a tenant page" : "PASS: 0 matches in tenant HTML and loaded chunks");
process.exit(failed ? 1 : 0);
