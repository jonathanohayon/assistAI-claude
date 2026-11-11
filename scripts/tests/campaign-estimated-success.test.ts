// Campaign analytics: the success figures come from an LLM reading the
// transcript (lib/campaigns/analyze.ts), not from a recorded action, so every
// one of them is labelled as an estimate in fr/en/he, with one explainer.
// Run with:  npx tsx scripts/tests/campaign-estimated-success.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntlMessageFormat } from "intl-messageformat";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ESTIMATED_KEYS = [
  "kpiEstimatedSuccessRate",
  "chartEstimatedSuccess",
  "estimatedSuccessOnConnected",
  "estimatedSuccess_success",
  "estimatedSuccess_partial",
  "estimatedSuccess_fail",
] as const;
const RETIRED_KEYS = [
  "kpiSuccessRate",
  "chartSuccess",
  "successOnConnected",
  "success_success",
  "success_partial",
  "success_fail",
];
// The word that makes each label an estimate, per locale.
const ESTIMATE_WORD: Record<string, RegExp> = {
  fr: /estimé/i,
  en: /estimated/i,
  he: /משוער/,
};

// 1. The verdict really is an AI judgment (guards the premise of the labels)
{
  const analyze = read("lib/campaigns/analyze.ts");
  assert.match(analyze, /chat\/completions/, "success is judged by an LLM");
  assert.match(analyze, /Critères de succès/, "against the campaign's success criteria");
  const route = read("app/api/dashboard/campaigns/[id]/results/route.ts");
  assert.match(route, /disposition: a\.success/, "the stored disposition is the LLM verdict");
  assert.match(route, /if \(c\.disposition === "success"\) success\+\+/, "the rate counts LLM verdicts");
}

// 2. Copy: every AI-judged label says "estimated" in fr/en/he; the explainer exists; old keys are gone
{
  for (const l of ["fr", "en", "he"]) {
    const m = JSON.parse(read(`messages/${l}.json`)).DashboardCampaigns;
    for (const k of ESTIMATED_KEYS) {
      assert.equal(typeof m[k], "string", `${l} ${k} exists`);
      assert.match(m[k], ESTIMATE_WORD[l], `${l} ${k} reads as an estimate`);
      assert.ok(new IntlMessageFormat(m[k], l).format({ n: 3, total: 4 }), `${l} ${k} formats`);
    }
    const hint = m.estimatedSuccessHint;
    assert.equal(typeof hint, "string", `${l} explainer exists`);
    assert.ok(hint.trim().length > 10, `${l} explainer is not empty`);
    for (const k of RETIRED_KEYS) assert.equal(m[k], undefined, `${l} ${k} retired`);
  }
  const fr = JSON.parse(read("messages/fr.json")).DashboardCampaigns;
  assert.equal(fr.kpiEstimatedSuccessRate, "Taux de succès estimé");
  assert.equal(fr.estimatedSuccessHint, "Estimé par l'IA à partir de la conversation, pas une action enregistrée.");
  assert.equal(
    JSON.parse(read("messages/en.json")).DashboardCampaigns.chartEstimatedSuccess,
    "Estimated success",
  );
}

// 3. Wiring: the analytics view uses only the estimated keys, and the explainer is linked to the KPI
{
  const src = read("app/[locale]/dashboard/campaigns/campaign-analytics.tsx");
  assert.match(src, /t\("kpiEstimatedSuccessRate"\)/);
  assert.match(src, /t\("chartEstimatedSuccess"\)/);
  assert.match(src, /t\("estimatedSuccessOnConnected", /);
  assert.match(src, /t\(`estimatedSuccess_\$\{call\.success\}`/);
  assert.match(src, /t\("estimatedSuccessHint"\)/);
  assert.match(src, /id=\{ESTIMATED_HINT_ID\}/);
  assert.match(src, /describedBy=\{ESTIMATED_HINT_ID\}/);
  for (const k of RETIRED_KEYS)
    assert.doesNotMatch(src, new RegExp(`t\\(["\`]${k}`), `no unlabelled ${k}`);
}

// 4. Nowhere else in the campaigns UI shows an AI success figure under a plain label
{
  for (const f of [
    "campaign-live-console.tsx",
    "campaign-list.tsx",
    "outbound-home.tsx",
    "campaign-contacts-list.tsx",
    "campaigns-workspace.tsx",
  ]) {
    const src = read(`app/[locale]/dashboard/campaigns/${f}`);
    assert.doesNotMatch(src, /successRate|disposition|kpiSuccess|success_(success|partial|fail)/, f);
  }
}

console.log("campaign-estimated-success: ok");
