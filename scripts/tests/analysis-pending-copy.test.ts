// The "still being analysed" banner promises no timing it can't keep (the
// background analysis can wait for a cron tick) and speaks like the rest of
// the dashboard ("vous", HE plural/neutral). Run with: npx tsx scripts/tests/analysis-pending-copy.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

const ROOT = new URL("../../", import.meta.url).pathname;
const msg = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8")).DashboardCampaigns.analyticsPending as string;
const fmt = (l: string, count: number) => String(new IntlMessageFormat(msg(l), l).format({ count }));

assert.equal(fmt("fr", 1), "1 discussion sera analysée dans les prochaines minutes. Rouvrez cette page pour voir les résultats.");
assert.equal(fmt("fr", 3), "3 discussions seront analysées dans les prochaines minutes. Rouvrez cette page pour voir les résultats.");
assert.equal(fmt("en", 2), "2 conversations will be analyzed in the next few minutes. Reopen this page to see the results.");
for (const l of ["fr", "en", "he"]) {
  assert.doesNotMatch(msg(l), /instant|shortly|rouvre |עוד רגע|פתחי/, `${l}: no seconds promise, no tu/feminine`);
}
console.log("analysis-pending-copy: ok");
