// No first-customer names in shared copy (15/11): the first customer's
// business name and its receptionist persona's name never reach a tenant or
// a visitor. Probes the matcher (scripts/first-customer-names.mjs), then
// scans every e-mail's copy (the Email.* namespaces in fr/en/he and the
// e-mail builders under lib/) and the whole of the three message files. The
// rendered half is scripts/check-tenant-words.mjs (tenant and public passes),
// which spreads the same rules in.
// Run with:  npx tsx scripts/tests/first-customer-names.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { FIRST_CUSTOMER_NAME_RULES } from "../first-customer-names.mjs";
import { publicWordRules, wordHits, wordRules } from "../tenant-words-match.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
const RULES = FIRST_CUSTOMER_NAME_RULES as Array<[string, RegExp]>;
const hits = (text: string) =>
  RULES.flatMap(([label, re]) => [...text.matchAll(re)].map((m) => `${label}: "${m[0]}"`));
const matches = (text: string) => hits(text).length > 0;

// --- The matcher ---------------------------------------------------------
for (const s of [
  "Bonjour, c'est Tamara du centre Prestige",
  "Hello from Prestige Salon",
  "PRESTIGE COIFFURE",
  "Prestige's new salon",
  "salon prestigé",
  "salon Prestigé",
  "שלום, מדברת תמרה ממכון פרסטיז'",
  "סלון פרסטיז׳",
  "סלון פרסטיז",
  "בפרסטיג'",
  "c'est Johana",
  "this is Johanna",
  "YOHANA",
  "Yohanna",
  "מדברת יוחנה",
  "שרה, יוהנה, מארי",
  "ג'והנה",
  "ג׳והנה",
])
  assert.ok(matches(s), `matches: ${s}`);
for (const s of [
  "Un salon prestigieux",
  "A prestigious salon",
  "Prestigiously done",
  "Johannesburg",
  "Johan, Joanna, Hanna",
  "יוחנן",
  "הסלון שלנו במרכז העיר",
  "פרסונה",
  "Bonjour, c'est Tamara du salon du centre-ville",
])
  assert.ok(!matches(s), `does not match: ${s}`);
// Spread into both words rule sets, every locale.
for (const l of LOCALES) {
  assert.ok(wordHits("salon Prestige", l, wordRules(l)).size > 0, `${l}: tenant rules carry the names`);
  assert.ok(wordHits("מדברת יוחנה", l, publicWordRules(l)).size > 0, `${l}: public rules carry the names`);
}

// --- The e-mails' copy -----------------------------------------------------
const offenders: string[] = [];
function walk(value: unknown, path: string, out: Array<[string, string]>) {
  if (typeof value === "string") out.push([path, value]);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out);
}
let emailStrings = 0;
for (const l of LOCALES) {
  const m = JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8")) as Record<string, unknown>;
  const emailNamespaces = Object.keys(m).filter((ns) => /^Email/.test(ns));
  assert.ok(emailNamespaces.includes("Email"), `${l}: the Email namespace exists`);
  const all: Array<[string, string]> = [];
  walk(m, "", all);
  for (const [path, text] of all) {
    if (emailNamespaces.some((ns) => path === ns || path.startsWith(`${ns}.`))) emailStrings++;
    for (const h of hits(text)) offenders.push(`messages/${l}.json ${path}: ${h}`);
  }
}
assert.ok(emailStrings > 30, `scanned ${emailStrings} e-mail strings`);

// The e-mail builders: lib/email*.ts, lib/*-email*.ts and the e-mail folders.
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}
const emailSources: string[] = [];
for (const name of readdirSync(join(ROOT, "lib"))) {
  if (!/email/i.test(name)) continue;
  const p = join(ROOT, "lib", name);
  if (statSync(p).isDirectory()) emailSources.push(...files(p));
  else if (/\.tsx?$/.test(name)) emailSources.push(p);
}
assert.ok(emailSources.some((p) => p.endsWith("lib/email.ts")), "lib/email.ts is scanned");
for (const p of emailSources)
  for (const h of hits(readFileSync(p, "utf8"))) offenders.push(`${relative(ROOT, p)}: ${h}`);

assert.deepEqual(offenders, [], `first-customer names in shared copy:\n${offenders.join("\n")}`);
console.log(`first-customer-names: matcher ok, ${emailStrings} e-mail strings + ${emailSources.length} e-mail sources + 3 message files clean`);
