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
  "showcase",
  "demo",
  "how",
  "features",
  "modules",
  "useCases",
  "proof",
  "pricing",
  "talk",
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

// ── Copy carried by a content object (landing pages) ─────────────────
// The home reads its copy from the messages files (next-intl). A landing
// page carries already-resolved strings for ONE locale instead, built by its
// own content module (lib/marketing/landings/*). Every field below is plain
// text, so a test can scan a whole page's copy at once.

export type LinkCopy = { label: string; href: string };

/** Hero copy. `title` may hold `{emphasis}`, replaced by the highlighted
 *  `emphasis` phrase (same treatment as the home headline). */
export type HeroCopy = {
  badge: string;
  title: string;
  emphasis?: string;
  subtitle: string;
  primary: LinkCopy;
  secondary: LinkCopy;
};

/** Heading block shared by the landing sections. */
export type SectionHeading = { kicker: string; title: string; subtitle?: string };

export type ItemCopy = { title: string; body: string };
export type FaqItem = { id: string; question: string; answer: string };

/** The six modules an agent is built from, one line each. */
export const MODULE_IDS = ["voice", "persona", "knowledge", "tools", "channels", "mission"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type ModulesCopy = SectionHeading & {
  items: readonly ({ id: ModuleId } & ItemCopy)[];
};

/** "Let's talk" block: replaces the pricing shell on landing pages. Its
 *  button opens the support conversation (SupportFab's path). */
export type TalkCopy = SectionHeading & { button: string };

export type CtaCopy = SectionHeading & { primary: LinkCopy; secondary: LinkCopy };

/** Nav of a landing page (in-page anchors + the sign-up door). */
export type NavCopy = { links: readonly LinkCopy[]; signupHref: string };

/** What the hero shows beside its copy. `video`: the home's full-bleed
 *  video hero (centred copy, stats). The other kinds are a landing page's
 *  own door: copy on the start side, the visual on the end side (below it on
 *  phones). `panel`: the live campaign card on the dark command-centre
 *  background (/sales). */
export const HERO_MEDIA_KINDS = ["video", "panel"] as const;
export type HeroMediaKind = (typeof HERO_MEDIA_KINDS)[number];

export type VideoHeroSlot = { media: "video"; stats: readonly HeroStat[]; copy?: HeroCopy };
export type PanelHeroSlot = { media: "panel"; copy: HeroCopy };
/** A landing page's hero: its own copy and visual, no video, no stats. */
export type DoorHeroSlot = PanelHeroSlot;
export type HeroSlot = VideoHeroSlot | DoorHeroSlot;

/** Every media kind has a hero shape, and every shape names a kind. */
type _MediaKindsMatch = [HeroSlot["media"]] extends [HeroMediaKind]
  ? [HeroMediaKind] extends [HeroSlot["media"]]
    ? true
    : never
  : never;
const _mediaKindsMatch: _MediaKindsMatch = true;
void _mediaKindsMatch;

export type HomeContent = {
  hero?: HeroSlot;
  proofStrip?: { baked: "IntegrationsStrip" } | { label: string; facts: readonly string[] };
  /** The page's visual right under the proof strip (landing pages). */
  showcase?: { baked: "OutboundCalling"; copy: SectionHeading };
  demo?: { demo: DemoId };
  how?: { baked: "Journey" } | (SectionHeading & { steps: readonly ItemCopy[] });
  features?: { baked: "FeatureBento" };
  modules?: ModulesCopy;
  useCases?: { baked: "Industries" } | (SectionHeading & { items: readonly ItemCopy[] });
  proof?: { baked: "Proof" };
  /** Plans and prices come from the page's pricing fetch, not from here. */
  pricing?: Record<string, never>;
  talk?: TalkCopy;
  trust?: { baked: "TrustStrip" };
  faq?: { keys: readonly string[] } | (SectionHeading & { items: readonly FaqItem[] });
  cta?: Record<string, never> | { copy: CtaCopy };
  /** Page chrome, not a slot: the nav's links. Omitted = the home's nav. */
  nav?: NavCopy;
  /** Page chrome, not a slot: the footer's one-line description. Omitted = the home's own (Footer.tagline). */
  footerTagline?: string;
};

/** Slot keys of HomeContent (`nav` and `footerTagline` are chrome, rendered outside the slots). */
type ContentSlotKey = Exclude<keyof HomeContent, "nav" | "footerTagline">;

/** Every slot id must be a slot key of HomeContent and vice versa. */
type _SlotsMatchContent = [HomeSlotId] extends [ContentSlotKey]
  ? [ContentSlotKey] extends [HomeSlotId]
    ? true
    : never
  : never;
const _slotsMatchContent: _SlotsMatchContent = true;
void _slotsMatchContent;

/** The receptionist home (salons and clinics): today's public page. */
export const RECEPTIONIST_HOME = {
  hero: { media: "video", stats: DEFAULT_HERO_STATS },
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
} satisfies HomeContent;
