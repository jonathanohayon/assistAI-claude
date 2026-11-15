// Copy keys removed with the plain-words pass (15/11): the Live Test panel's
// kicker (LiveTest.kicker) and two keys no component ever read
// (DashboardConfig.pageSubtitle, DashboardConfig.instructionsLabel). Proves
// they are gone from fr/en/he AND that no source file still reads them, so
// next-intl can't render a raw key on a tenant screen.
// Run with:  npx tsx scripts/tests/removed-copy-keys.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const REMOVED: Array<[namespace: string, key: string]> = [
  ["LiveTest", "kicker"],
  ["DashboardConfig", "pageSubtitle"],
  ["DashboardConfig", "instructionsLabel"],
];

// 1. Gone from the three message files.
for (const l of ["fr", "en", "he"]) {
  const m = JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
  for (const [ns, key] of REMOVED) assert.equal(m[ns]?.[key], undefined, `${l}: ${ns}.${key} removed`);
}

// 2. No source file reads them. A key is read either as a dotted literal
// ("LiveTest.kicker") or through a translator bound to its namespace
// (const tl = useTranslations("LiveTest"); tl("kicker")). Other namespaces
// keep their own "kicker" / "instructionsLabel" keys, which is fine.
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|mjs|js)$/.test(name)) yield p;
  }
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const offenders: string[] = [];
let scanned = 0;
for (const dir of ["app", "components", "lib", "hooks", "i18n"]) {
  let exists = true;
  try {
    statSync(join(ROOT, dir));
  } catch {
    exists = false;
  }
  if (!exists) continue;
  for (const file of sources(join(ROOT, dir))) {
    scanned++;
    const src = readFileSync(file, "utf8");
    for (const [ns, key] of REMOVED) {
      if (src.includes(`${ns}.${key}`)) offenders.push(`${relative(ROOT, file)}: "${ns}.${key}"`);
      const binding = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*(?:await\\s+)?(?:useTranslations|getTranslations)\\(\\s*(?:["'\`]${ns}["'\`]|\\{[^}]*namespace:\\s*["'\`]${ns}["'\`][^}]*\\})`, "g");
      for (const [, t] of src.matchAll(binding)) {
        if (new RegExp(`\\b${escape(t)}\\(\\s*["'\`]${key}["'\`]`).test(src)) offenders.push(`${relative(ROOT, file)}: ${t}("${key}") on ${ns}`);
      }
    }
  }
}
assert.ok(scanned > 100, `source files scanned (${scanned})`);
assert.deepEqual(offenders, [], `removed keys still read:\n${offenders.join("\n")}`);

// 3. The probe itself catches a read (mock source).
{
  const mock = `const tl = useTranslations("LiveTest");\nreturn <p>{tl("kicker")}</p>;`;
  const [, t] = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?useTranslations\(\s*["'`]LiveTest["'`]/.exec(mock)!;
  assert.match(mock, new RegExp(`\\b${t}\\(\\s*["'\`]kicker["'\`]`));
}

console.log("removed-copy-keys: ok");
