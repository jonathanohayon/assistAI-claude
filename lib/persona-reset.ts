// Admin "reset persona to neutral" + its undo, against the DB. The rules
// (what is written, when an undo is refused) are in lib/persona-reset-rules.ts.
//
// Both run in ONE transaction with the agent_configs row locked (FOR UPDATE),
// so two concurrent resets or a reset racing an undo can't interleave: the
// snapshot stored is always the exact value that was replaced.
// Only instructions, greetingInstructions, agentName and personaConfig (kept
// in step with the legacy columns, as the admin configs PUT does) are written;
// every other column of the account is left as is.
// persona_resets also holds company-sheet resets (kind 'company_sheet',
// lib/company-sheet-reset.ts): every read here is limited to kind 'persona',
// so the two kinds never see each other's rows.

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, personaResets, users } from "@/lib/db/schema";
import { inboundPersonaAfterLegacy } from "@/lib/persona/store";
import { editedSinceReset, neutralPersona, parseSnapshot, type PersonaSnapshot } from "@/lib/persona-reset-rules";

const PERSONA = eq(personaResets.kind, "persona");

export type PersonaResetResult = { status: number; body: Record<string, unknown> };

const personaCols = {
  id: agentConfigs.id,
  instructions: agentConfigs.instructions,
  greetingInstructions: agentConfigs.greetingInstructions,
  agentName: agentConfigs.agentName,
  personaConfig: agentConfigs.personaConfig,
  primaryLanguage: agentConfigs.primaryLanguage,
  aiDisclosureEnabled: agentConfigs.aiDisclosureEnabled,
  aiDisclosureText: agentConfigs.aiDisclosureText,
};

export async function resetPersonaToNeutral(userId: string, adminId: string): Promise<PersonaResetResult> {
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { status: 404, body: { error: "user_not_found" } };
  return db.transaction(async (tx): Promise<PersonaResetResult> => {
    const [row] = await tx.select(personaCols).from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1).for("update");
    if (!row) return { status: 404, body: { error: "agent_config_not_found" } };
    const previous: PersonaSnapshot = {
      instructions: row.instructions,
      greetingInstructions: row.greetingInstructions,
      agentName: row.agentName,
      personaConfig: row.personaConfig ?? null,
    };
    const neutral = neutralPersona(row.primaryLanguage, u.locale);
    const personaConfig = inboundPersonaAfterLegacy(row, neutral);
    const applied: PersonaSnapshot = { ...neutral, personaConfig };
    const [reset] = await tx
      .insert(personaResets)
      .values({ userId, kind: "persona", previous, applied, byAdmin: adminId })
      .returning({ id: personaResets.id, createdAt: personaResets.createdAt });
    await tx
      .update(agentConfigs)
      .set({ ...neutral, personaConfig, updatedAt: new Date() })
      .where(eq(agentConfigs.id, row.id));
    return { status: 200, body: { ok: true, resetId: reset.id, createdAt: reset.createdAt, applied: neutral } };
  });
}

export async function undoPersonaReset(userId: string, resetId: string, force: boolean): Promise<PersonaResetResult> {
  return db.transaction(async (tx): Promise<PersonaResetResult> => {
    const [row] = await tx.select(personaCols).from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1).for("update");
    if (!row) return { status: 404, body: { error: "agent_config_not_found" } };
    const [reset] = await tx
      .select()
      .from(personaResets)
      .where(and(eq(personaResets.id, resetId), eq(personaResets.userId, userId), PERSONA))
      .limit(1);
    if (!reset) return { status: 404, body: { error: "reset_not_found" } };
    if (reset.undoneAt) return { status: 409, body: { error: "already_undone" } };
    const [latest] = await tx
      .select({ id: personaResets.id })
      .from(personaResets)
      .where(and(eq(personaResets.userId, userId), PERSONA))
      .orderBy(desc(personaResets.createdAt), desc(personaResets.id))
      .limit(1);
    if (latest?.id !== reset.id) return { status: 409, body: { error: "not_latest_reset" } };
    const previous = parseSnapshot(reset.previous);
    if (!previous) return { status: 500, body: { error: "snapshot_unreadable" } };
    const edited = editedSinceReset(row, reset.applied);
    if (edited.length && !force) return { status: 409, body: { error: "edited_since_reset", fields: edited } };
    const marked = await tx
      .update(personaResets)
      .set({ undoneAt: new Date() })
      .where(and(eq(personaResets.id, reset.id), isNull(personaResets.undoneAt)))
      .returning({ id: personaResets.id });
    if (!marked.length) return { status: 409, body: { error: "already_undone" } };
    await tx
      .update(agentConfigs)
      .set({
        instructions: previous.instructions,
        greetingInstructions: previous.greetingInstructions,
        agentName: previous.agentName,
        personaConfig: previous.personaConfig,
        updatedAt: new Date(),
      })
      .where(eq(agentConfigs.id, row.id));
    return { status: 200, body: { ok: true, resetId: reset.id, forced: edited.length > 0, overwritten: edited } };
  });
}

/** The reset an admin can undo now (the latest, not undone), and whether the account was edited since. */
export async function undoableReset(
  userId: string,
): Promise<{ resetId: string; createdAt: Date; editedSinceReset: string[] } | null> {
  const [latest] = await db
    .select({ id: personaResets.id, createdAt: personaResets.createdAt, applied: personaResets.applied, undoneAt: personaResets.undoneAt })
    .from(personaResets)
    .where(and(eq(personaResets.userId, userId), PERSONA))
    .orderBy(desc(personaResets.createdAt), desc(personaResets.id))
    .limit(1);
  if (!latest || latest.undoneAt) return null;
  const [row] = await db
    .select({ instructions: agentConfigs.instructions, greetingInstructions: agentConfigs.greetingInstructions, agentName: agentConfigs.agentName })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!row) return null;
  return { resetId: latest.id, createdAt: latest.createdAt, editedSinceReset: editedSinceReset(row, latest.applied) };
}
