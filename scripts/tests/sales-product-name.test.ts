// The sales product is named "Centre d'appels" / "Call center" / "מוקד שיחות"
// (VP, 22/11, after Jonathan's feedback; HE to confirm). Names only: the route
// stays /dashboard/sales and the product id stays "sales". ONE message key
// names it everywhere: DashboardNav.sales (same method as
// connect-product-name.test.ts).
//   1. The three locales carry the new name; the old product label ("Ventes"
//      / "Sales" / "מכירות" as a whole string) is gone from every message
//      file except the ordinary uses listed in ALLOWED_MESSAGES (a campaign
//      GOAL and a marketing use case, not the product). The email's own copy
//      (Email.usageWarning.entrySales) and the campaigns header eyebrow
//      (DashboardCampaigns.kicker, a second copy of the name) are gone.
//   2. Every site that names the product reads DashboardNav.sales: the
//      sidebar, the preview header (the product page title), the admin
//      tenant view, the admin banner line, the catalogue (prices and engine
//      lines), the admin tile's tagline, the usage-warning email.
//   3. No source file hard-codes the old name as a string.
//   4. The campaigns list header has no eyebrow: "Campagnes sortantes" only.
// Run with:  npx tsx scripts/tests/sales-product-name.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ENTRY_LABEL_KEY } from "../../lib/dashboard-nav";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NAME = { fr: "Centre d'appels", en: "Call center", he: "מוקד שיחות" } as const;
const OLD = ["Ventes", "Sales", "מכירות"];

// Message strings equal to an old label that are NOT the product's name.
const ALLOWED_MESSAGES = new Set([
  // A campaign's goal ("sales" among cold / lead_gen / marketing), not the product.
  "fr:DashboardCampaigns.goal_sales",
  "en:DashboardCampaigns.goal_sales",
  "he:DashboardCampaigns.goal_sales",
  // The outbound marketing section's use case ("Sales", next to "Lead generation" and "Marketing").
  "en:OutboundCalling.use_sales_title",
  "he:OutboundCalling.use_sales_title",
]);

// ── 1. Messages ────────────────────────────────────────────────────────────
function* strings(o: unknown, path = ""): Generator<[string, string]> {
  if (typeof o === "string") yield [path, o];
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) yield* strings(v, path ? `${path}.${k}` : k);
}
for (const l of ["fr", "en", "he"] as const) {
  const m = JSON.parse(read(`messages/${l}.json`));
  assert.equal(m.DashboardNav.sales, NAME[l], `${l}: DashboardNav.sales is the product name`);
  assert.equal(m.Email.usageWarning.entrySales, undefined, `${l}: the email has no copy of the name`);
  assert.equal(m.DashboardCampaigns.kicker, undefined, `${l}: the campaigns header has no copy of the name`);
  assert.equal(m.DashboardCampaigns.title, { fr: "Campagnes sortantes", en: "Outbound campaigns", he: "קמפיינים יוצאים" }[l]);
  for (const [path, s] of strings(m))
    if (OLD.includes(s.trim())) assert.ok(ALLOWED_MESSAGES.has(`${l}:${path}`), `${l}: ${path} still reads the old product name "${s}"`);
}
console.log("ok: the name in fr/en/he, the old label gone");

// ── 2. Every product-name site reads DashboardNav.sales ───────────────────
assert.equal(ENTRY_LABEL_KEY.sales, "sales", "sidebar: the sales entry's label is DashboardNav.sales");
{
  const sidebar = read("components/dashboard/DashboardSidebar.tsx");
  assert.match(sidebar, /useTranslations\("DashboardNav"\)/);
  assert.match(sidebar, /\{t\(item\.labelKey\)\}/, "sidebar: the entry label through its key");

  const header = read("components/dashboard/ProductPreviewHeader.tsx");
  assert.match(header, /<h1[^>]*>\{t\(entry\)\}<\/h1>/, "preview header: the title is DashboardNav.<entry>");
  assert.match(read("app/[locale]/dashboard/sales/page.tsx"), /<ProductPreviewHeader entry="sales"/);

  const admin = read("app/admin/users/[userId]/sales/page.tsx");
  assert.match(admin, /getTranslations\(\{ locale: "fr", namespace: "DashboardNav" \}\)/);
  assert.match(admin, /<h1[^>]*>\{t\("sales"\)\}<\/h1>/, "admin tenant view: the title is DashboardNav.sales");
  assert.match(admin, /Dans son menu, \{t\("sales"\)\} apparaît/);

  // The server helper every admin client screen gets its names from.
  const names = read("lib/product-names.ts");
  assert.match(names, /getTranslations\(\{ locale, namespace: "DashboardNav" \}\)/);
  assert.match(names, /t\(ENTRY_LABEL_KEY\[e\]\)/);
  assert.match(read("app/admin/users/[userId]/layout.tsx"), /const names = await productNames\("fr"\);[\s\S]*<EngineOverrideLine userId=\{target\.id\} names=\{names\} \/>/);
  assert.match(read("app/admin/page.tsx"), /productNames=\{await productNames\("fr"\)\}/);

  const banner = read("app/admin/users/[userId]/EngineOverrideLine.tsx");
  assert.match(banner, /\{names\[p\.entry\]\}/, "banner rows: the product's name from names");
  assert.match(banner, /label=\{`\$\{names\.sales\} : imposé pour ce client`\}/);
  assert.match(banner, /`Enregistrer \$\{names\.sales\}`/);

  const shell = read("app/admin/admin-shell.tsx");
  assert.match(shell, /\$\{props\.productNames\.sales\}/, "admin tile tagline: the name from the key");
  assert.match(shell, /<ProductPricesAdmin names=\{props\.productNames\} \/>/);
  assert.match(shell, /<ProductCatalogueAdmin names=\{props\.productNames\} \/>/);
  assert.match(read("app/admin/engine-override/ProductCatalogueForm.tsx"), /label=\{names\[line\.entry\]\}/, "engine lines");
  assert.match(read("app/admin/engine-override/catalogue-prices-ui.ts"), /sales: names\.sales,/, "price editor");
  assert.doesNotMatch(read("app/admin/engine-override/engine-ui.ts"), /ENTRY_LABEL\b/, "no admin copy of the names");

  const email = read("lib/email.ts");
  const fn = email.slice(email.indexOf("export async function sendUsageWarningEmail"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /namespace: "DashboardNav"[\s\S]*sales: nav\("sales"\)/, "usage email: the name from DashboardNav.sales");
  assert.doesNotMatch(read("lib/usage-warnings.ts"), /entrySales/, "usage email: no key of its own");
}
console.log("ok: every site reads DashboardNav.sales");

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
// A word on its own (not "vente" / "Salesforce" / "אנשי המכירות"): the product label.
const OLD_RE = new RegExp(`(^|[^\\p{L}])(${OLD.join("|")})(?=$|[^\\p{L}])`, "u");
const ALLOWED_SOURCES = new Set<string>([]);
const offenders: string[] = [];
for (const dir of ["app", "components", "lib"]) {
  for (const file of sources(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    for (const line of stripComments(readFileSync(file, "utf8")).split("\n")) {
      // Strings, template text and JSX text only (identifiers like SALES_SIGNUP_HREF are not copy).
      const copy = [...line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
      if (copy.some((s) => OLD_RE.test(s)) && !ALLOWED_SOURCES.has(`${rel}: ${line.trim()}`)) offenders.push(`${rel}: ${line.trim()}`);
    }
  }
}
assert.deepEqual(offenders, [], "old product name hard-coded");
console.log("ok: no hard-coded old name");

// ── 4. The campaigns list header: no eyebrow above "Campagnes sortantes" ──
{
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.doesNotMatch(ws, /t\("kicker"\)/, "the campaigns header no longer reads its eyebrow key");
  assert.match(ws, /\{view === "editor" && \(\s*<div data-campaigns-eyebrow=""/, "the eyebrow is the editor's step only");
}
console.log("ALL SALES PRODUCT NAME TESTS PASSED");
