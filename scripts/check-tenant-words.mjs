#!/usr/bin/env node
// Proof that people read plain words, on the RENDERED pages, in fr/en/he
// (rules in tenant-words-match.mjs):
//   1. public pages (home, landings, login, signup…; signed out): no
//      "Persona", "CRM", "Sheet" (outside the product name "Google Sheets")
//      or latency jargon ("Latence vocale"). Internal-words audit section D.
//   2. tenant pages (signed in as the mock tenant): no "Persona", "PSTN",
//      "CRM", "Sheet", "Live Test"/"LiveTest", "OAuth", "token" or "tenant".
//      Audit sections A and B.
// Same harness as check-tenant-bundle.mjs: a PRODUCTION build backed by a
// throwaway database with a mock tenant — never production.
//
//   node scripts/check-tenant-words.mjs http://localhost:3997 tenant@example.test <password>
//
// What it scans: the server HTML's visible text (text nodes + title,
// aria-label, placeholder, alt, value), not scripts: the RSC payload carries
// every client namespace's messages, admin-only ones included, which a
// tenant never sees. Developer-mode and admin-only areas are not rendered
// for the mock tenant (developer mode off, role "user"), so they are out of
// the scan by construction. Exit 1 on any match.
//
// Not scanned: e-mail addresses (the tenant's own data:
// tenant@example.test). The plan cards' feature lines (Plans.*) are scanned
// on both sides: they are shared by the public pricing and /dashboard/billing.

import { publicWordRules, visibleText, wordHits } from "./tenant-words-match.mjs";

const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
  console.error("usage: check-tenant-words.mjs <baseUrl> <tenantEmail> <password>");
  process.exit(2);
}

// NextAuth basePath (auth.ts).
const AUTH = "/api/admin/auth";
// The public pages of the harness's public-pages-check.mjs ("" = the home).
const PUBLIC_PATHS = ["", "/login", "/signup", "/verify-email", "/forgot-password", "/sales", "/connect"];
// The tenant pages of check-tenant-bundle.mjs, plus onboarding.
const TENANT_PATHS = [
  "/dashboard",
  "/dashboard/settings",
  "/dashboard/billing",
  "/dashboard/calendar",
  "/dashboard/contacts",
  "/dashboard/crm",
  "/dashboard/logs",
  "/dashboard/forwarding",
  "/dashboard/campaigns",
  "/onboarding",
];
const LOCALES = ["fr", "en", "he"];

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

let failed = false;

/** Scans one page; returns false when it was not reachable (not 200). */
async function scan(page, rulesFor) {
  const res = await get(page);
  if (res.status !== 200) {
    console.log(`${page}: HTTP ${res.status} (not reachable, skipped)`);
    return false;
  }
  const text = visibleText(await res.text());
  const locale = page.split("/")[1];
  // A near-empty page (a loading shell) would pass without proving anything.
  if (text.trim().length < 200) {
    failed = true;
    console.log(`  ✗ ${page}: only ${text.trim().length} chars of visible text: nothing to scan`);
  }
  const h = wordHits(text, locale, rulesFor(locale));
  console.log(`${page}: ${text.length} chars of visible text${h.size ? "" : ", clean"}`);
  for (const [word, ctx] of h) {
    failed = true;
    for (const c of ctx) console.log(`  ✗ "${word}" …${c}…`);
  }
  return true;
}

// 1. Public pages, signed out (no cookie yet).
let publicScanned = 0;
for (const locale of LOCALES) {
  for (const p of PUBLIC_PATHS) if (await scan(`/${locale}${p}`, publicWordRules)) publicScanned++;
}

// 2. Sign in (NextAuth credentials), then the tenant pages.
{
  cookie = "";
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
let tenantScanned = 0;
for (const locale of LOCALES) {
  for (const p of TENANT_PATHS) if (await scan(`/${locale}${p}`, () => undefined)) tenantScanned++;
}

if (publicScanned === 0 || tenantScanned === 0) {
  console.log(`FAIL: no ${publicScanned === 0 ? "public" : "tenant"} page was reachable`);
  process.exit(1);
}
console.log(
  failed
    ? "FAIL: internal words on a rendered page"
    : `PASS: 0 internal words on ${tenantScanned} tenant pages and ${publicScanned} public pages`,
);
process.exit(failed ? 1 : 0);
