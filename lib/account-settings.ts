// Account display preferences on /api/dashboard/account: pure body parsing
// and the body→stored mapping the route writes (unit-tested).
// PUT is PARTIAL: { developerMode?: boolean, door?: Door }. An omitted key
// leaves its column unchanged. A body with neither key keeps the historical
// error (400 invalid_developer_mode), so a developerMode-only client sees
// exactly the behaviour it had before the door existed.

import { parseDeveloperModeBody } from "@/lib/developer-mode";
import type { Door } from "@/lib/door-values";
import { toDoor } from "@/lib/door";

export type AccountPatch = { developerMode?: boolean; door?: Door };
export type AccountBodyError = "invalid_developer_mode" | "invalid_door";

export function parseAccountBody(raw: unknown): { ok: true; value: AccountPatch } | { ok: false; error: AccountBodyError } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const hasDev = o !== null && o.developerMode !== undefined;
  const hasDoor = o !== null && o.door !== undefined;
  // Nothing to change (no body, junk, {}): today's developerMode error.
  if (!hasDev && !hasDoor) return { ok: false, error: "invalid_developer_mode" };
  const value: AccountPatch = {};
  if (hasDev) {
    const dev = parseDeveloperModeBody(o);
    if (!dev.ok) return dev;
    value.developerMode = dev.value;
  }
  if (hasDoor) {
    const door = toDoor(o!.door);
    if (!door) return { ok: false, error: "invalid_door" };
    value.door = door;
  }
  return { ok: true, value };
}

/**
 * The columns the PUT writes: ONLY the keys present in the patch, so an
 * omitted key never reaches the UPDATE and its stored value is kept.
 */
export function accountUpdateSet(patch: AccountPatch): { developerMode?: boolean; door?: Door } {
  const set: { developerMode?: boolean; door?: Door } = {};
  if (patch.developerMode !== undefined) set.developerMode = patch.developerMode;
  if (patch.door !== undefined) set.door = patch.door;
  return set;
}
