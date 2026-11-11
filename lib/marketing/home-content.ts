// Content model of the public home page (L1).
//
// The page is a fixed sequence of slots; a content object fills or omits
// each one. This file is pure data (no React), so tests and future variants
// (e.g. an outbound home) can import it without pulling in components.
//
// "Baked" slots name an existing component whose lists still live inside the
// component itself (Journey, FeatureBento, Industries, IntegrationsStrip,
// Proof). Moving those lists into the content object is a later task.

/** Render order of the home slots. Adding a slot (e.g. `outbound`) means
 *  adding it here, to `HomeContent`, and to the renderer map in HomePage. */
export const HOME_SLOT_ORDER = [
  "hero",
  "proofStrip",
  "demo",
  "how",
  "features",
  "useCases",
  "proof",
  "pricing",
  "trust",
  "faq",
  "cta",
] as const;

export type HomeSlotId = (typeof HOME_SLOT_ORDER)[number];

/** One stat under the hero subtitle: the shown value, its label key in the
 *  `Hero.stats` namespace, and its entrance delay in seconds. */
export type HeroStat = {
  value: string;
  labelKey: string;
  delay: number;
};

/** Today's hero stats (24/7 availability, 3 languages, unlimited calls). */
export const DEFAULT_HERO_STATS: readonly HeroStat[] = [
  { value: "24/7", labelKey: "availability", delay: 0.85 },
  { value: "3", labelKey: "languages", delay: 1.01 },
  { value: "∞", labelKey: "calls", delay: 1.09 },
];

/** Today's FAQ entries, as keys in the `FAQ` namespace. */
export const DEFAULT_FAQ_KEYS: readonly string[] = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
];

/** Demos TryDemo knows how to mount. The component imports stay inside
 *  TryDemo (a client component), so the page loads exactly what it did. */
export const DEMO_IDS = ["voiceAgent"] as const;
export type DemoId = (typeof DEMO_IDS)[number];
export const DEFAULT_DEMO: DemoId = "voiceAgent";

export type HomeContent = {
  hero?: { stats: readonly HeroStat[] };
  proofStrip?: { baked: "IntegrationsStrip" };
  demo?: { demo: DemoId };
  how?: { baked: "Journey" };
  features?: { baked: "FeatureBento" };
  useCases?: { baked: "Industries" };
  proof?: { baked: "Proof" };
  /** Plans and prices come from the page's pricing fetch, not from here. */
  pricing?: Record<string, never>;
  trust?: { baked: "TrustStrip" };
  faq?: { keys: readonly string[] };
  cta?: Record<string, never>;
};

/** Every slot id must be a key of HomeContent and vice versa. */
type _SlotsMatchContent = [HomeSlotId] extends [keyof HomeContent]
  ? [keyof HomeContent] extends [HomeSlotId]
    ? true
    : never
  : never;
const _slotsMatchContent: _SlotsMatchContent = true;
void _slotsMatchContent;

/** The receptionist home (salons and clinics): today's public page. */
export const RECEPTIONIST_HOME: HomeContent = {
  hero: { stats: DEFAULT_HERO_STATS },
  proofStrip: { baked: "IntegrationsStrip" },
  demo: { demo: DEFAULT_DEMO },
  how: { baked: "Journey" },
  features: { baked: "FeatureBento" },
  useCases: { baked: "Industries" },
  proof: { baked: "Proof" },
  pricing: {},
  trust: { baked: "TrustStrip" },
  faq: { keys: DEFAULT_FAQ_KEYS },
  cta: {},
};
