// Home page slots (L1): the public home is one HomePage fed by a content object.
// Pins the slot order, the anchor ids the sections carry, the defaults of the
// three props (hero stats, FAQ keys, demo), and that page.tsx renders through
// the content object.
// Run with:  npx tsx scripts/tests/home-slots.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_DEMO,
  DEFAULT_FAQ_KEYS,
  DEFAULT_HERO_STATS,
  HOME_SLOT_ORDER,
  RECEPTIONIST_HOME,
} from "../../lib/marketing/home-content";

const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const marketing = (name: string) => src(`components/marketing/${name}.tsx`);

// 1. Slot order = the page's section order before L1.
assert.deepEqual(
  [...HOME_SLOT_ORDER],
  ["hero", "proofStrip", "demo", "how", "features", "useCases", "proof", "pricing", "trust", "faq", "cta"],
);

// The receptionist home fills every slot, with the component it had before.
assert.deepEqual(Object.keys(RECEPTIONIST_HOME).sort(), [...HOME_SLOT_ORDER].sort());
assert.equal(RECEPTIONIST_HOME.proofStrip?.baked, "IntegrationsStrip");
assert.equal(RECEPTIONIST_HOME.how?.baked, "Journey");
assert.equal(RECEPTIONIST_HOME.features?.baked, "FeatureBento");
assert.equal(RECEPTIONIST_HOME.useCases?.baked, "Industries");
assert.equal(RECEPTIONIST_HOME.proof?.baked, "Proof");
assert.equal(RECEPTIONIST_HOME.trust?.baked, "TrustStrip");
// No outbound section on the public page.
assert.equal("outbound" in RECEPTIONIST_HOME, false);

// HomePage renders Nav, the slots in HOME_SLOT_ORDER, Footer, SupportFab,
// inside the same wrapper as before.
const homePage = src("components/marketing/HomePage.tsx");
assert.match(homePage, /<RespectReducedMotion>\s*<main className="noise-grain relative flex flex-col overflow-x-hidden">\s*<Nav \/>\s*\{HOME_SLOT_ORDER\.map\(/);
assert.match(homePage, /\)\}\s*<Footer \/>\s*<SupportFab \/>\s*<\/main>\s*<\/RespectReducedMotion>/);
assert.doesNotMatch(homePage, /OutboundCalling/);
const renderers: Record<string, RegExp> = {
  hero: /hero: \(slot\) => <Hero stats=\{slot\.stats\} \/>/,
  proofStrip: /proofStrip: \(\) => <IntegrationsStrip \/>/,
  demo: /demo: \(slot\) => <TryDemo demo=\{slot\.demo\} \/>/,
  how: /how: \(\) => <Journey \/>/,
  features: /features: \(\) => <FeatureBento \/>/,
  useCases: /useCases: \(\) => <Industries \/>/,
  proof: /proof: \(\) => <Proof \/>/,
  pricing: /pricing: \(\) => <Pricing \/>/,
  trust: /trust: \(\) => <TrustStrip \/>/,
  faq: /faq: \(slot\) => <FAQ faqKeys=\{slot\.keys\} \/>/,
  cta: /cta: \(\) => <CTA \/>/,
};
for (const id of HOME_SLOT_ORDER) assert.match(homePage, renderers[id], `renderer for ${id}`);

// 2. Anchor ids carried by the section components (nav links and #demo CTA).
const anchors: Array<[string, string]> = [
  ["TryDemo", 'id="demo"'],
  ["Journey", 'id="how"'],
  ["FeatureBento", 'id="features"'],
  ["Industries", 'id="industries"'],
  ["Proof", 'id="performance"'],
  ["Pricing", 'id="pricing"'],
  ["TrustStrip", 'id="security"'],
  ["FAQ", 'id="faq"'],
];
for (const [component, id] of anchors) assert.ok(marketing(component).includes(id), `${component} keeps ${id}`);

// 3. Prop defaults = the values the components had hard-coded.
assert.deepEqual(DEFAULT_HERO_STATS, [
  { value: "24/7", labelKey: "availability", delay: 0.85 },
  { value: "3", labelKey: "languages", delay: 1.01 },
  { value: "∞", labelKey: "calls", delay: 1.09 },
]);
assert.deepEqual(DEFAULT_FAQ_KEYS, ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
assert.equal(DEFAULT_DEMO, "voiceAgent");
assert.equal(RECEPTIONIST_HOME.hero?.stats, DEFAULT_HERO_STATS);
assert.equal(RECEPTIONIST_HOME.faq?.keys, DEFAULT_FAQ_KEYS);
assert.equal(RECEPTIONIST_HOME.demo?.demo, DEFAULT_DEMO);
assert.match(marketing("Hero"), /stats = DEFAULT_HERO_STATS/);
assert.match(marketing("FAQ"), /faqKeys = DEFAULT_FAQ_KEYS/);
assert.match(marketing("TryDemo"), /demo = DEFAULT_DEMO/);
// VoiceAgent is still imported by the client TryDemo, not by the server page.
assert.match(marketing("TryDemo"), /^"use client";/);
assert.match(marketing("TryDemo"), /import VoiceAgent from "@\/components\/VoiceAgent";/);
assert.doesNotMatch(homePage, /VoiceAgent/);

// 4. page.tsx renders through the content object and reads no data: it is
//    prerendered, and the prices are fetched on the client.
const page = src("app/[locale]/page.tsx");
assert.match(page, /return <HomePage content=\{RECEPTIONIST_HOME\} \/>;/);
assert.doesNotMatch(page, /getPlanPricingMap|DEFAULT_PLAN_PRICING|revalidate/);
assert.match(page, /setRequestLocale\(locale\);/);
assert.doesNotMatch(page, /<(Hero|FAQ|TryDemo|Journey|Pricing|Nav|Footer)\b/);

console.log("ALL HOME-SLOTS TESTS PASSED");
