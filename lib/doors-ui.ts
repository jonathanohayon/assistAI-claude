// What the account's door changes in the dashboard: ONE table, client-safe.
// It imports lib/door-values.ts only (the tenant bundle check reads what a
// client component pulls in).
//
// The door ONLY orders and highlights. It never adds or removes a tab, a
// tile or a step: gating (plan features, admin) is applied by the screens
// exactly as before, after the ordering. scripts/tests/doors-ui.test.ts pins
// that every door yields the same sets for every plan.

import { DEFAULT_DOOR, DOORS, type Door } from "./door-values";

/** Logical ids of the dashboard menu entries (tenant nav and the admin mirror). */
export type DoorTabId = "home" | "calls" | "campaigns" | "crm" | "calendar" | "billing";

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
  | "agentUrl";

/** Message keys (Dashboard namespace) of the dashboard title per door. */
export type DoorHeaderKey = "doorTitleReception" | "doorTitleSales" | "doorTitleConnect";

export interface DoorUi {
  headerKey: DoorHeaderKey;
  tabOrder: readonly DoorTabId[];
  tileOrder: readonly DoorTileId[];
  /** The tile to highlight: the first of these the screen actually shows. */
  highlightTiles: readonly DoorTileId[];
  /** The step offered first (moved to the top of the checklist when shown). */
  firstStepId: DoorStepId;
}

export const DOOR_UI: Readonly<Record<Door, DoorUi>> = {
  // Calls come in: the number and the received calls first.
  reception: {
    headerKey: "doorTitleReception",
    tabOrder: ["home", "calls", "crm", "calendar", "campaigns", "billing"],
    tileOrder: ["channels", "voice", "business", "persona", "tools", "notifs", "campaigns"],
    highlightTiles: ["channels"],
    firstStepId: "testCall",
  },
  // Calls go out: the campaigns and their results first.
  sales: {
    headerKey: "doorTitleSales",
    tabOrder: ["campaigns", "calls", "home", "crm", "calendar", "billing"],
    tileOrder: ["campaigns", "channels", "voice", "persona", "business", "tools", "notifs"],
    highlightTiles: ["campaigns"],
    firstStepId: "contacts",
  },
  // The customer's own agent answers: its address and the voice first.
  connect: {
    headerKey: "doorTitleConnect",
    tabOrder: ["home", "calls", "crm", "calendar", "campaigns", "billing"],
    tileOrder: ["tools", "voice", "channels", "persona", "business", "notifs", "campaigns"],
    highlightTiles: ["tools"],
    firstStepId: "agentUrl",
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

/** The tile to highlight among those shown, or null when none of the door's is shown. */
export function highlightedTile(door: unknown, shownIds: readonly string[]): string | null {
  return doorUi(door).highlightTiles.find((id) => shownIds.includes(id)) ?? null;
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
 * The checklist with the door's first step moved to the top (no step added
 * or dropped). While one of that step's prerequisites is still to do, the
 * prerequisite goes first and the door's step right after it.
 */
export function withFirstStep<T extends { id: string; done?: boolean }>(items: readonly T[], door: unknown): T[] {
  const first = doorUi(door).firstStepId;
  if (!items.some((x) => x.id === first)) return [...items];
  const pending = (STEP_PREREQUISITES[first] ?? []).filter((p) => items.some((x) => x.id === p && !x.done));
  const lead = [...pending, first];
  const head = lead.map((id) => items.find((x) => x.id === id)!);
  return [...head, ...items.filter((x) => !lead.includes(x.id as DoorStepId))];
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

/**
 * Whether picking `next` must save: only a DIFFERENT door. The same door
 * sends no PUT and keeps the saved tile order.
 */
export function doorChangeNeeded(current: Door, next: unknown): next is Door {
  return typeof next === "string" && (DOORS as readonly string[]).includes(next) && next !== current;
}

/** The PUT the "main use" selector sends (?asUserId= in the admin tenant view). */
export function doorPutRequest(door: Door, asUserId?: string | null): { url: string; init: RequestInit } {
  return {
    url: `/api/dashboard/account${asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : ""}`,
    init: {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ door }),
    },
  };
}
