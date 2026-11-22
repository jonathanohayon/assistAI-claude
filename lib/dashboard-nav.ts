// The dashboard's left menu and its routes: PURE and client-safe (imports
// only pure value modules). Used by the tenant dashboard AND the admin tenant
// view (same menu, URLs under /admin/users/<id>), by the old URLs' redirects,
// and pinned by scripts/tests/dashboard-nav.test.ts.
//
// Two blocks:
//   products: Réception · Ventes · Connecter votre agent, the account's own product
//             (its door) first;
//   shared:   Mon agent · Appels · Clients · Abonnement · Réglages.
// The door only ORDERS the products; the menu never adds or removes an entry.
// Owned/preview comes from lib/product-menu.ts (computed on the server).

import { doorOf } from "./doors-ui";
import type { ProductMenu, ProductCta } from "./product-menu";
import { PRODUCT_ENTRIES, type ProductEntry } from "./product-values";

export type SharedEntry = "myAgent" | "calls" | "clients" | "billing" | "settings";
export type NavEntryId = ProductEntry | SharedEntry;

export const SHARED_ENTRIES: readonly SharedEntry[] = ["myAgent", "calls", "clients", "billing", "settings"];

/** Route segment(s) of each entry, under /dashboard (tenant). */
export const ENTRY_SUFFIX: Readonly<Record<NavEntryId, string>> = {
  reception: "reception",
  sales: "sales",
  connect: "agent",
  myAgent: "my-agent",
  calls: "calls",
  clients: "clients",
  billing: "billing",
  settings: "settings",
};

/**
 * Route segment of each entry in the admin tenant view, under /admin/users/<id>.
 * null = no admin page for it (the tenant's own settings): not in the admin menu.
 */
export const ADMIN_ENTRY_SUFFIX: Readonly<Record<NavEntryId, string | null>> = {
  reception: "reception",
  sales: "sales",
  connect: "agent",
  myAgent: "my-agent",
  calls: "calls",
  clients: "clients",
  billing: "finance",
  settings: null,
};

/** Message key (namespace DashboardNav) of each entry's label. */
export const ENTRY_LABEL_KEY: Readonly<Record<NavEntryId, string>> = {
  reception: "reception",
  sales: "sales",
  connect: "connect",
  myAgent: "myAgent",
  calls: "calls",
  clients: "clients",
  billing: "billing",
  settings: "settings",
};

/** The product entry of a door (the three share their names). */
export function doorEntry(door: unknown): ProductEntry {
  return doorOf(door);
}

/** The products in menu order: the door's own first, then the catalogue order. */
export function productOrder(door: unknown): ProductEntry[] {
  const own = doorEntry(door);
  return [own, ...PRODUCT_ENTRIES.filter((e) => e !== own)];
}

export type NavItem = {
  id: NavEntryId;
  href: string;
  labelKey: string;
  /** Products only: preview entries carry their call to action. */
  preview?: ProductCta;
};

export type NavBlock = { id: "products" | "shared"; items: NavItem[] };

/** The base path of the menu: /dashboard, or /admin/users/<id> for an admin. */
export function navBase(asUserId?: string | null): string {
  return asUserId ? `/admin/users/${asUserId}` : "/dashboard";
}

export function entryHref(id: NavEntryId, asUserId?: string | null): string | null {
  const suffix = asUserId ? ADMIN_ENTRY_SUFFIX[id] : ENTRY_SUFFIX[id];
  return suffix === null ? null : `${navBase(asUserId)}/${suffix}`;
}

/** The two blocks of the menu for an account (its door and its product menu). */
export function navBlocks(door: unknown, menu: ProductMenu, asUserId?: string | null): NavBlock[] {
  const item = (id: NavEntryId): NavItem | null => {
    const href = entryHref(id, asUserId);
    return href === null ? null : { id, href, labelKey: ENTRY_LABEL_KEY[id] };
  };
  const products = productOrder(door).map((e) => {
    const it = item(e)!;
    const s = menu[e];
    return s.state === "preview" ? { ...it, preview: s.cta } : it;
  });
  const shared = SHARED_ENTRIES.map(item).filter((x): x is NavItem => x !== null);
  return [
    { id: "products", items: products },
    { id: "shared", items: shared },
  ];
}

/** Where /dashboard (or /admin/users/<id>) lands: the account's own product. */
export function homeHref(door: unknown, asUserId?: string | null): string {
  return entryHref(doorEntry(door), asUserId)!;
}

/** `/fr/dashboard/x` → `/dashboard/x` (the tenant menu matches without the locale). */
export function stripLocale(path: string): string {
  const m = path.match(/^\/(fr|he|en)(\/.*)?$/);
  return m ? m[2] || "/" : path;
}

/**
 * The active entry for a pathname (locale prefix allowed): the entry whose
 * route is the path or a parent of it (e.g. /dashboard/reception/forwarding
 * → reception). null when none (e.g. a redirecting old URL).
 */
export function activeEntry(pathname: string, asUserId?: string | null): NavEntryId | null {
  const p = stripLocale(pathname).replace(/\/+$/, "");
  const ids = [...PRODUCT_ENTRIES, ...SHARED_ENTRIES] as NavEntryId[];
  for (const id of ids) {
    const href = entryHref(id, asUserId);
    if (href && (p === href || p.startsWith(`${href}/`))) return id;
  }
  return null;
}

// ─── Old URLs → their new home ───────────────────────────────────────────

/** Where each configuration tile lives now (`?tile=` deep links). */
export const TILE_ENTRY: Readonly<Record<string, NavEntryId>> = {
  voice: "myAgent",
  persona: "myAgent",
  business: "myAgent",
  tools: "myAgent",
  prompt: "myAgent",
  notifs: "reception",
  channels: "reception",
  campaigns: "sales",
};

/** Old tenant paths (under /dashboard) → their new segments. "" (/dashboard itself) is handled by legacyTarget. */
export const LEGACY_TENANT_PATHS: Readonly<Record<string, string>> = {
  "/logs": "calls",
  "/crm": "clients",
  "/calendar": "clients",
  "/contacts": "clients",
  "/campaigns": "sales",
  "/forwarding": "reception/forwarding",
};

/** Old admin tenant-view paths (under /admin/users/<id>) → their new segments. */
export const LEGACY_ADMIN_PATHS: Readonly<Record<string, string>> = {
  "/logs": "calls",
  "/calendar": "clients",
  "/contacts": "clients",
};

export type SearchParams = Record<string, string | string[] | undefined>;

function queryOf(search: SearchParams | null | undefined): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search ?? {})) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * The new URL of an old one. `oldSuffix` is the path under the base ("" for
 * the base itself); the query string is kept as is. The base itself goes to
 * the page holding `?tile=` when it names a tile, else to the own product.
 * Returns null for a suffix that is not an old URL.
 */
export function legacyTarget(
  oldSuffix: string,
  search: SearchParams | null | undefined,
  door: unknown,
  asUserId?: string | null,
): string | null {
  const base = navBase(asUserId);
  const q = queryOf(search);
  if (oldSuffix === "") {
    const tile = search?.tile;
    const t = typeof tile === "string" ? TILE_ENTRY[tile] : undefined;
    const href = t ? entryHref(t, asUserId) : null;
    return `${href ?? homeHref(door, asUserId)}${q}`;
  }
  const map = asUserId ? LEGACY_ADMIN_PATHS : LEGACY_TENANT_PATHS;
  const to = Object.prototype.hasOwnProperty.call(map, oldSuffix) ? map[oldSuffix] : undefined;
  return to === undefined ? null : `${base}/${to}${q}`;
}
