// The connect product is named by what the customer does: "Connecter vos
// agents" / "Connect your agents" / "חיבור הסוכנים שלכם" (VP, 24/11, C1b: the
// plural, since an account can plug in several agents; was "Connecter votre
// agent", 22/11), so it can't be confused with the shared entry "Mon agent"
// right below it. ONE message key names it everywhere: DashboardNav.connect.
//   0. C1b: no message and no source string keeps the SINGULAR product name
//      or the doors' singular sentences (sign-up, welcome, preview pitch).
//   1. The three locales carry the new name; the old product label ("Votre
//      agent" / "Your agent" / "הסוכן שלכם" as a whole string) is gone from
//      every message file, and so is the email's own copy of it
//      (Email.usageWarning.entryConnect).
//   2. Every site that names the product reads DashboardNav.connect: the
//      sidebar entry, the product page title (owned and preview header), the
//      admin tenant view, the usage-warning email.
//   3. No source file hard-codes the old name as a string, except the /connect
//      landing's diagram, where "Votre agent" is the customer's agent (an
//      actor next to "L'appelant" and "Tamara"), not the product.
//   4. The sidebar never truncates a name: the badge wraps under it.
// Run with:  npx tsx scripts/tests/connect-product-name.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ENTRY_LABEL_KEY } from "../../lib/dashboard-nav";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NAME = { fr: "Connecter vos agents", en: "Connect your agents", he: "חיבור הסוכנים שלכם" } as const;
const OLD = ["Votre agent", "Your agent", "הסוכן שלכם"];
// C1b: the singular name (22/11) and the doors' singular sentences, anywhere in a string.
const SINGULAR: RegExp[] = [
  /Connecter votre agent/,
  /Connect your agent(?!s)/,
  /חיבור הסוכן שלכם/,
  /branchement de votre agent/,
  /Connecting your agent(?!s)/,
  /voix et un numéro à votre agent/,
  /Give your agent a voice/,
  /תנו לסוכן שלכם קול/,
  /Branchez l'agent IA que vous avez déjà/,
  /Plug in the AI agent you already have/,
  /Branchez votre propre agent/,
  /Connect your own agent(?!s)/,
];

// ── 1. Messages ────────────────────────────────────────────────────────────
function* strings(o: unknown, path = ""): Generator<[string, string]> {
  if (typeof o === "string") yield [path, o];
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) yield* strings(v, path ? `${path}.${k}` : k);
}
for (const l of ["fr", "en", "he"] as const) {
  const m = JSON.parse(read(`messages/${l}.json`));
  assert.equal(m.DashboardNav.connect, NAME[l], `${l}: DashboardNav.connect is the product name`);
  assert.equal(m.DashboardNav.myAgent, { fr: "Mon agent", en: "My agent", he: "הסוכן שלי" }[l], `${l}: "Mon agent" unchanged`);
  assert.equal(m.Email.usageWarning.entryConnect, undefined, `${l}: the email has no copy of the name`);
  // ConnectorsList.defaultName (VP, 24/11) is the name of the customer's
  // AGENT on a card whose name is blank, not the product: same words, another actor.
  assert.equal(m.Pricing.grid.products.connect.name, NAME[l], `${l}: the pricing card names it the same`);
  for (const [path, s] of strings(m)) {
    if (path === "ConnectorsList.defaultName") continue;
    assert.ok(!OLD.includes(s.trim()), `${l}: ${path} still reads the old product name "${s}"`);
    // "Votre agent IA" (the editor's own name) and "Votre agent" (the default
    // agent name) are not the product: none of the patterns matches them.
    for (const re of SINGULAR) assert.doesNotMatch(s, re, `${l}: ${path} still reads the singular "${s}"`);
  }
  assert.equal(m.ClientAgentBrick.title, { fr: "Votre agent IA", en: "Your AI agent", he: "סוכן ה-AI שלכם" }[l], `${l}: the editor keeps its name`);
  assert.equal(m.ConnectorsList.defaultName, { fr: "Votre agent", en: "Your agent", he: "הסוכן שלכם" }[l], `${l}: the default agent name kept`);
}
// The singular guard catches what it must (mutation proof, in memory).
assert.ok(SINGULAR.some((re) => re.test("Connecter votre agent")) && SINGULAR.some((re) => re.test("Connect your agent")));
assert.ok(!SINGULAR.some((re) => re.test("Connect your agents")) && !SINGULAR.some((re) => re.test("Votre agent IA")));
console.log("ok: the plural name in fr/en/he, the old labels gone"); 

// ── 2. Every product-name site reads DashboardNav.connect ─────────────────
assert.equal(ENTRY_LABEL_KEY.connect, "connect", "sidebar: the connect entry's label is DashboardNav.connect");
{
  const sidebar = read("components/dashboard/DashboardSidebar.tsx");
  assert.match(sidebar, /useTranslations\("DashboardNav"\)/);
  assert.match(sidebar, /\{t\(item\.labelKey\)\}/, "sidebar: the entry label through its key");
  assert.match(sidebar, /\{t\(activeItem\.labelKey\)\}/, "drawer button: the active entry through its key");

  const header = read("components/dashboard/ProductPreviewHeader.tsx");
  assert.match(header, /useTranslations\("DashboardNav"\)/);
  assert.match(header, /<h1[^>]*>\{t\(entry\)\}<\/h1>/, "preview header: the title is DashboardNav.<entry>");
  // Both Connect pages render through ConnectPageContent (lib/connect-page-view.ts).
  const view = read("app/[locale]/dashboard/agent/connect-view.tsx");
  assert.match(view, /<ProductPreviewHeader\s+entry="connect"/);
  assert.match(view, /<ConnectOwnedView title=\{title\}/, "owned view: the page's title");

  const page = read("app/[locale]/dashboard/agent/page.tsx");
  assert.match(page, /getTranslations\(\{ locale, namespace: "DashboardNav" \}\)/);
  assert.match(page, /<ConnectPageContent[\s\S]*?title=\{t\("connect"\)\}/, "owned page: the title is DashboardNav.connect");
  assert.match(read("app/[locale]/dashboard/agent/connect-owned.tsx"), /<h1[^>]*>\{title\}<\/h1>/, "owned view: the page's title as the h1");

  const admin = read("app/admin/users/[userId]/agent/page.tsx");
  assert.match(admin, /getTranslations\(\{ locale: "fr", namespace: "DashboardNav" \}\)/);
  assert.match(admin, /<ConnectPageContent\s[^>]*title=\{t\("connect"\)\}/, "admin tenant view: the title is DashboardNav.connect");

  const email = read("lib/email.ts");
  const fn = email.slice(email.indexOf("export async function sendUsageWarningEmail"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /namespace: "DashboardNav"[\s\S]*nav\("connect"\)/, "usage email: the name from DashboardNav.connect");
  assert.doesNotMatch(read("lib/usage-warnings.ts"), /entryConnect/, "usage email: no key of its own");
}
console.log("ok: every site reads DashboardNav.connect");

// ── 3. No hard-coded old name in the sources ──────────────────────────────
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|mjs|js)$/.test(name)) yield p;
  }
}
// Comments may still mention the old name; strings and JSX text may not.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const ALLOWED = new Set([
  // The diagram's actor: the customer's agent, not the product's name.
  'lib/marketing/landings/connect.ts: agent: t({ fr: "Votre agent", en: "Your agent", he: "הסוכן שלכם" }),',
]);
const offenders: string[] = [];
for (const dir of ["app", "components", "lib"]) {
  for (const file of sources(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    for (const line of stripComments(readFileSync(file, "utf8")).split("\n")) {
      const hit =
        OLD.some((n) => line.includes(`"${n}"`) || line.includes(`'${n}'`) || line.includes(`>${n}<`) || new RegExp(`>\\s*${n}\\s*$`).test(line) || line.trim() === n) ||
        SINGULAR.some((re) => re.test(line));
      if (hit && !ALLOWED.has(`${rel}: ${line.trim()}`)) offenders.push(`${rel}: ${line.trim()}`);
    }
  }
}
assert.deepEqual(offenders, [], "old product name hard-coded");
console.log("ok: no hard-coded old name");

// ── 4. The sidebar wraps, never truncates ──────────────────────────────────
{
  const sidebar = read("components/dashboard/DashboardSidebar.tsx");
  const list = sidebar.slice(sidebar.indexOf("{ICON_PATHS[item.id]}"), sidebar.indexOf("const common = {"));
  assert.doesNotMatch(list, /\btruncate\b|text-ellipsis|whitespace-nowrap/, "the entry name is never truncated");
  assert.match(list, /className="flex min-w-0 flex-1 flex-wrap[^"]*"/, "name + badge wrap: the badge goes under the name");
  assert.match(list, /data-nav-label=""/);
}
console.log("ALL CONNECT PRODUCT NAME TESTS PASSED");
