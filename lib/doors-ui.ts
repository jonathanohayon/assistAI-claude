// What the account's door changes in the dashboard: ONE table, client-safe.
// It imports lib/door-values.ts only (the tenant bundle check reads what a
// client component pulls in).
//
// The door orders the left menu's products (lib/dashboard-nav.ts: its own
// product first, opened by /dashboard) and, for sales and connect, the tiles
// and the first checklist steps. It never adds or removes an entry or a tile:
// gating (plan features, admin) is applied by the screens exactly as before.
// Reception (every account without a door) keeps the tile and checklist order
// of the dashboard before doors.
// scripts/tests/doors-ui.test.ts pins all of it.

import { DEFAULT_DOOR, DOORS, type Door } from "./door-values";

/** Ids of the configuration tiles (app/[locale]/dashboard/config-form.tsx). */
export type DoorTileId = "voice" | "business" | "tools" | "persona" | "notifs" | "channels" | "campaigns";

/** Ids of the setup checklist steps (components/dashboard/SetupChecklist.tsx). */
export type DoorStepId =
  | "number"
  | "testCall"
  | "forwarding"
  | "scan"
  | "calendar"
  | "whatsapp"
  | "contacts"
  | "liveTest"
  | "clientAgent";

export interface DoorUi {
  tileOrder: readonly DoorTileId[];
  /** Steps moved to the top of the checklist, in this order (when shown). */
  firstSteps: readonly DoorStepId[];
}

/** The tile order before doors existed (main before #370): reception keeps it. */
export const TODAY_TILE_ORDER: readonly DoorTileId[] = ["voice", "business", "tools", "persona", "notifs", "channels", "campaigns"];

export const DOOR_UI: Readonly<Record<Door, DoorUi>> = {
  // Today's dashboard, unchanged. No tile is highlighted on any door: the
  // setup checklist is the guide.
  reception: {
    tileOrder: TODAY_TILE_ORDER,
    firstSteps: [],
  },
  // Calls go out: the campaigns first; the free live test right after the import.
  sales: {
    tileOrder: ["campaigns", "channels", "voice", "persona", "business", "tools", "notifs"],
    firstSteps: ["contacts", "liveTest"],
  },
  // The customer's own agent answers: its address and the voice first.
  connect: {
    tileOrder: ["tools", "voice", "channels", "persona", "business", "notifs", "campaigns"],
    firstSteps: ["clientAgent"],
  },
};

/** The door named by `x`, else the default (null, unknown, junk → reception). */
export function doorOf(x: unknown): Door {
  if (typeof x !== "string") return DEFAULT_DOOR;
  const v = x.trim().toLowerCase();
  return (DOORS as readonly string[]).includes(v) ? (v as Door) : DEFAULT_DOOR;
}

export function doorUi(door: unknown): DoorUi {
  return DOOR_UI[doorOf(door)];
}

/**
 * `items` sorted by `order` (stable). Ids missing from `order` keep their
 * relative place after the listed ones. Nothing is added or dropped.
 */
export function orderBy<T>(items: readonly T[], idOf: (item: T) => string, order: readonly string[]): T[] {
  const rank = (item: T) => {
    const i = order.indexOf(idOf(item));
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * The tile order the grid starts from: the customer's own saved order
 * (dragged in this browser) wins; otherwise the door's.
 */
export function initialTileOrder(saved: readonly string[] | null, door: unknown): readonly string[] {
  return saved && saved.length > 0 ? saved : doorUi(door).tileOrder;
}

/**
 * Steps that can't be done before others: a test call or the forwarding
 * check needs the number first (both are done only once a number exists).
 */
export const STEP_PREREQUISITES: Readonly<Partial<Record<DoorStepId, readonly DoorStepId[]>>> = {
  testCall: ["number"],
  forwarding: ["number"],
};

/**
 * The checklist with the door's first steps moved to the top, in order (no
 * step added or dropped). While one of those steps' prerequisites is still to
 * do, the prerequisite goes right before it. Reception moves nothing.
 */
export function withFirstStep<T extends { id: string; done?: boolean }>(items: readonly T[], door: unknown): T[] {
  const lead: string[] = [];
  for (const step of doorUi(door).firstSteps) {
    if (!items.some((x) => x.id === step)) continue;
    const pending = (STEP_PREREQUISITES[step] ?? []).filter((p) => items.some((x) => x.id === p && !x.done));
    for (const id of [...pending, step]) if (!lead.includes(id)) lead.push(id);
  }
  const head = lead.map((id) => items.find((x) => x.id === id)!);
  return [...head, ...items.filter((x) => !lead.includes(x.id))];
}


/**
 * `path` with `door=<door>` when `raw` names a door other than the default
 * (reception needs no parameter). Anything else is dropped, so a junk value
 * is never carried from page to page.
 */
export function withDoorParam(path: string, raw: unknown): string {
  if (typeof raw !== "string") return path;
  const v = raw.trim().toLowerCase();
  if (!(DOORS as readonly string[]).includes(v) || v === DEFAULT_DOOR) return path;
  return `${path}${path.includes("?") ? "&" : "?"}door=${v}`;
}

/** localStorage key of the customer's own tile order (config-form.tsx). */
export const TILE_ORDER_KEY = "tamara.config.tileOrder";
