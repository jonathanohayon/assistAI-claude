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
//   sales:     the campaigns tile (today's locked state, i.e. the upsell).
// "Votre agent" has no section any more (F2): "Ask your agent" is its own
// brick there (components/bricks/client-agent/ClientAgentBrick.tsx).
// No section (undefined) = every tile and the overview, as before the menu.

import { TILE_ROW_SIZE } from "./tile-size";

export type ConfigSection = "reception" | "agent" | "sales";

export const SECTION_TILES: Readonly<Record<ConfigSection, readonly string[]>> = {
  reception: ["notifs", "channels"],
  agent: ["voice", "persona", "business", "tools", "prompt"],
  sales: ["campaigns"],
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

/** The configuration grid (#370): the default columns per breakpoint. */
export const GRID_DEFAULT = "@container grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-4";
/** "Mon agent" (next to the live test, beside the menu): two tiles per row at every width. */
export const GRID_TWO = "@container grid grid-cols-2 gap-3";
/** #370's row rule for two columns: at least a square, the row stretches to its tallest tile. */
export const TILE_ROW_SIZE_TWO = "min-h-[calc((100cqw_-_0.75rem)/2)]";

export function sectionGridClass(section: ConfigSection | undefined): string {
  return section === "agent" ? GRID_TWO : GRID_DEFAULT;
}

export function sectionTileSize(section: ConfigSection | undefined): string {
  return section === "agent" ? TILE_ROW_SIZE_TWO : TILE_ROW_SIZE;
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
