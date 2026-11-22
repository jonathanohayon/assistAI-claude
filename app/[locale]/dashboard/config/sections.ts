// Which part of the configuration screen each menu page shows (pure,
// unit-tested). The SAME ConfigForm renders on every page, with the same
// bricks, deep links (?tile=) and admin mode (asUserId); a section only picks
// its tiles and whether the home overview (number, stats) and the live test show.
//
//   reception: the home overview + the live test + what is specific to
//              reception (notifications, channels);
//   agent:     "Mon agent", the shared bricks (voice, persona, what the agent
//              knows, what it can do) + the admin-only prompt tile + the live
//              test;
//   sales:     the campaigns tile (today's locked state, i.e. the upsell);
//   connect:   "Votre agent": the tools tile, whose "Ask your agent" row
//              holds the customer's agent address and its test.
// No section (undefined) = every tile and the overview, as before the menu.

export type ConfigSection = "reception" | "agent" | "sales" | "connect";

export const SECTION_TILES: Readonly<Record<ConfigSection, readonly string[]>> = {
  reception: ["notifs", "channels"],
  agent: ["voice", "persona", "business", "tools", "prompt"],
  sales: ["campaigns"],
  connect: ["tools"],
};

/** Whether a tile shows in a section (no section = every tile). */
export function tileInSection(id: string, section: ConfigSection | undefined): boolean {
  return section === undefined || SECTION_TILES[section].includes(id);
}

/** The home overview (hero: number, stats) shows on reception only. */
export function sectionShowsHero(section: ConfigSection | undefined): boolean {
  return section === undefined || section === "reception";
}

/**
 * The live test: on reception (today's home) and on "Mon agent", where the
 * voice, persona and knowledge are edited (the voice brick links to it).
 */
export function sectionShowsLiveTest(section: ConfigSection | undefined): boolean {
  return section === undefined || section === "reception" || section === "agent";
}

/** The save dock: not on a page whose only tile is a locked one (sales). */
export function sectionShowsSaveDock(section: ConfigSection | undefined): boolean {
  return section !== "sales";
}

/** The tile a section opens on arrival when no ?tile= is given (connect: tools). */
export function sectionDefaultTile(section: ConfigSection | undefined): string | null {
  return section === "connect" ? "tools" : null;
}

/**
 * The saved tile order after a drag inside one section: the section's tiles
 * take the dragged order, in the slots they occupied in the FULL order; the
 * other sections' tiles keep their place. `full` is the current full order.
 */
export function mergeSectionOrder(full: readonly string[], sectionOrder: readonly string[]): string[] {
  const inSection = new Set(sectionOrder);
  const queue = [...sectionOrder];
  const merged = full.map((id) => (inSection.has(id) ? (queue.shift() as string) : id));
  // Section tiles missing from `full` (never saved) go at the end.
  return [...merged, ...queue];
}
