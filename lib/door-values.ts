// The account's "door" values: constants and types ONLY, safe to import from
// client components. Nothing here may import the database, a server module or
// any other app module (the tenant bundle check reads what this pulls in).
// Server helpers (parsing, DB read) live in lib/door.ts.

export const DOORS = ["reception", "sales", "connect"] as const;

export type Door = (typeof DOORS)[number];

/** The door of an account with no stored door (NULL) or an unknown one. */
export const DEFAULT_DOOR: Door = "reception";
