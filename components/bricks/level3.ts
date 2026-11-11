// Shared rule for level-3 (engineering-facing) content, used by every brick
// and by account settings. Pure and client-safe.

/** Level 3 for tenants follows their developer mode; admins always see it. */
export function showLevel3(opts: { isAdmin: boolean; developerMode: boolean }): boolean {
  return opts.isAdmin || opts.developerMode;
}
