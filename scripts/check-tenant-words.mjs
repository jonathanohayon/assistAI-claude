#!/usr/bin/env node
// Proof that a TENANT reads plain words on their screens: no "Persona",
// "PSTN", "CRM", "Sheet" (outside the product name "Google Sheets"),
// "Live Test"/"LiveTest", "OAuth", "token" or "tenant" in the text of the
// RENDERED tenant pages, in fr/en/he (rules in tenant-words-match.mjs).
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

import { visibleText, wordHits } from "./tenant-words-match.mjs";

const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
  console.error("usage: check-tenant-words.mjs <baseUrl> <tenantEmail> <password>");
  process.exit(2);
}

// NextAuth basePath (auth.ts).
const AUTH = "/api/admin/auth";
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

let failed = false;
let scanned = 0;
for (const locale of LOCALES) {
  for (const p of TENANT_PATHS) {
    const page = `/${locale}${p}`;
    const res = await get(page);
    if (res.status !== 200) {
      console.log(`${page}: HTTP ${res.status} (not reachable for this tenant, skipped)`);
      continue;
    }
    const text = visibleText(await res.text());
    scanned++;
    const h = wordHits(text, locale);
    console.log(`${page}: ${text.length} chars of visible text${h.size ? "" : ", clean"}`);
    for (const [word, ctx] of h) {
      failed = true;
      for (const c of ctx) console.log(`  ✗ "${word}" …${c}…`);
    }
  }
}

if (scanned === 0) {
  console.log("FAIL: no tenant page was reachable");
  process.exit(1);
}
console.log(failed ? "FAIL: internal words on a tenant page" : `PASS: 0 internal words on ${scanned} tenant pages`);
process.exit(failed ? 1 : 0);
