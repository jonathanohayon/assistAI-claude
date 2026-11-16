// The account's "door" (server side): which landing page the visitor signed
// up from, "reception" | "sales" | "connect". It changes ONLY what the
// dashboard shows first; it grants no right and is never served to the
// worker. Stored in users.door (NULL = "reception", resolved at read time).
// Client components import lib/door-values.ts, never this file.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DEFAULT_DOOR, DOORS, type Door } from "@/lib/door-values";

export { DEFAULT_DOOR, DOORS, type Door };

/** The door named by `x` (trimmed, lower-cased), or null when it names none. */
export function toDoor(x: unknown): Door | null {
  if (typeof x !== "string") return null;
  const v = x.trim().toLowerCase();
  return (DOORS as readonly string[]).includes(v) ? (v as Door) : null;
}

/** Lenient parse (sign-up query/form/cookie): anything unknown is "reception". */
export function parseDoor(x: unknown): Door {
  return toDoor(x) ?? DEFAULT_DOOR;
}

/** A stored users.door value as the app reads it: NULL (or junk) = "reception". */
export function resolveDoor(stored: string | null): Door {
  return parseDoor(stored);
}

/** The account's door; "reception" for an unknown account too. */
export async function getAccountDoor(userId: string): Promise<Door> {
  const [u] = await db.select({ door: users.door }).from(users).where(eq(users.id, userId)).limit(1);
  return resolveDoor(u?.door ?? null);
}

/**
 * `door=<door>` for a sign-up URL, or "" for "reception" (the default needs
 * no parameter, so a reception URL stays exactly as it is today).
 */
export function doorQuery(door: Door): string {
  return door === DEFAULT_DOOR ? "" : `door=${door}`;
}

/** Appends the door to a path that may already carry a query string. */
export function withDoor(path: string, door: Door): string {
  const q = doorQuery(door);
  if (!q) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
}
