// The admin "reset persona to neutral" rules (pure: no DB, no network).
// The DB side is lib/persona-reset.ts; the routes are
// app/api/admin/users/[userId]/reset-persona/{route,undo/route}.ts.
//
// - What a reset writes: neutralSeed(language) (lib/neutral-seed.ts) into
//   instructions + greetingInstructions, and DEFAULT_AGENT_NAME into agentName.
//   NEVER seedForNewAccount: its per-plan onboarding template wins over the
//   neutral text and can carry a customer's persona back.
//   The language is the one the agent SPEAKS (agent_configs.primary_language),
//   else the account's locale: the prompt must be in the agent's language.
// - Undo rule: only the account's MOST RECENT reset, once, and only while
//   instructions, greetingInstructions and agentName are still exactly what
//   that reset wrote. Otherwise 409 `edited_since_reset` naming the fields;
//   `force: true` restores anyway (the later edit is then lost). Other columns
//   (voice, language, tools, ...) are never compared nor written.

import { DEFAULT_AGENT_NAME, neutralSeed } from "@/lib/neutral-seed";

/** The persona fields a reset replaces, as stored in persona_resets.previous / .applied. */
export type PersonaSnapshot = {
  instructions: string;
  greetingInstructions: string;
  agentName: string;
  personaConfig: unknown;
};

export const COMPARED_FIELDS = ["instructions", "greetingInstructions", "agentName"] as const;

/** The neutral persona text for an agent speaking `primaryLanguage` (account locale as fallback). */
export function neutralPersona(primaryLanguage: string | null | undefined, locale: string | null | undefined): {
  instructions: string;
  greetingInstructions: string;
  agentName: string;
} {
  const s = neutralSeed(primaryLanguage || locale);
  return { instructions: s.instructions, greetingInstructions: s.greeting, agentName: DEFAULT_AGENT_NAME };
}

/** The compared fields whose current value differs from what the reset wrote. */
export function editedSinceReset(
  current: Pick<PersonaSnapshot, (typeof COMPARED_FIELDS)[number]>,
  applied: unknown,
): string[] {
  const a = parseSnapshot(applied);
  if (!a) return [...COMPARED_FIELDS];
  return COMPARED_FIELDS.filter((f) => current[f] !== a[f]);
}

/** A stored snapshot, or null if malformed (a malformed row is never restored). */
export function parseSnapshot(v: unknown): PersonaSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.instructions !== "string" || typeof o.greetingInstructions !== "string" || typeof o.agentName !== "string") return null;
  return {
    instructions: o.instructions,
    greetingInstructions: o.greetingInstructions,
    agentName: o.agentName,
    personaConfig: o.personaConfig ?? null,
  };
}

export type UndoBody = { ok: true; resetId: string; force: boolean } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** POST …/reset-persona/undo body: { resetId: uuid, force?: boolean }. */
export function parseUndoBody(body: unknown): UndoBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.resetId)) return { ok: false, error: "invalid_reset_id" };
  if ("force" in b && typeof b.force !== "boolean") return { ok: false, error: "invalid_force" };
  return { ok: true, resetId: b.resetId, force: b.force === true };
}
