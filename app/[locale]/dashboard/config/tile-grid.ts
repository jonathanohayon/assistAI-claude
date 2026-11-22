// The configuration tile grid (pure, unit-tested): which tiles show, in
// which order, and which one is highlighted.
//
// Order: the customer's own drag order (saved in this browser) wins; without
// one, the account's door order (lib/doors-ui.ts). Ids missing from the order
// (e.g. the admin-only "prompt" tile) fall at the end in their default place.
//
// Gate, applied AFTER the order and the same for every door: when outbound
// calls are usable (admin), the campaigns tile leaves the grid (the feature
// has its own menu tab); otherwise it stays, locked, and opens the upsell.

import { highlightedTile, initialTileOrder, orderBy } from "@/lib/doors-ui";

export function gridTiles<T extends { id: string }>(
  tiles: readonly T[],
  savedOrder: readonly string[] | null,
  door: unknown,
  campaignsEnabled: boolean,
  hasNumber = false,
): { tiles: T[]; highlightId: string | null } {
  const shown = orderBy(tiles, (t) => t.id, initialTileOrder(savedOrder, door)).filter(
    (t) => t.id !== "campaigns" || !campaignsEnabled,
  );
  return { tiles: shown, highlightId: highlightedTile(door, shown.map((t) => t.id), hasNumber) };
}
