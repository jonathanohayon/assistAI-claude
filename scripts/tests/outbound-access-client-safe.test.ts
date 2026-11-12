// Client components never value-import lib/plan-features.ts: its FEATURE_DEFS
// descriptions name agent tools, and the tenant bundle check fails on them.
// Run with:  npx tsx scripts/tests/outbound-access-client-safe.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { canUseOutboundCampaigns } from "../../lib/outbound-access";
import { canUseOutboundCampaigns as viaFeatures } from "../../lib/plan-features";

const ROOT = new URL("../../", import.meta.url).pathname;

// 1. Same rule from both paths.
assert.equal(viaFeatures, canUseOutboundCampaigns);
assert.equal(canUseOutboundCampaigns(true, null), true);
assert.equal(canUseOutboundCampaigns(false, { outbound_campaigns: true }), true);
assert.equal(canUseOutboundCampaigns(false, { outbound_campaigns: false }), false);
assert.equal(canUseOutboundCampaigns(false, undefined), false);

// 2. The rule module only type-imports plan-features.
const rule = readFileSync(join(ROOT, "lib/outbound-access.ts"), "utf8");
assert.doesNotMatch(rule, /^import (?!type )[^;]*from "@\/lib\/plan-features"/m);

// 3. No "use client" file under app/[locale]/dashboard or components value-imports lib/plan-features.
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const offenders = [join(ROOT, "app/[locale]/dashboard"), join(ROOT, "components")]
  .flatMap(walk)
  .filter((p) => {
    const s = readFileSync(p, "utf8");
    return /^["']use client["']/m.test(s) && /^import (?!type )[^;]*from "@\/lib\/plan-features"/m.test(s);
  })
  .map((p) => p.slice(ROOT.length));
assert.deepEqual(offenders, [], "client files value-importing lib/plan-features");

console.log("outbound-access-client-safe: ok");
