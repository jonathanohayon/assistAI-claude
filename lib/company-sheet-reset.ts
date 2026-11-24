// Admin "clear the company sheet" + its undo, against the DB. The rules
// (what is written, when an undo is refused) are in
// lib/company-sheet-reset-rules.ts.
//
// Both run in ONE transaction with the agent_configs AND users rows locked
// (FOR UPDATE), so two concurrent resets or a reset racing an undo can't
// interleave. The snapshot is built, compared and restored in SQL, jsonb to
// jsonb: what an undo writes back is byte-identical to what the reset
// replaced. Only agent_configs.business, agent_configs.knowledge and
// users.company_sheet are written (plus agent_configs.updated_at).

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clearedSheet, isSheetSnapshot, RESET_KIND, sheetEditedSinceReset, type SheetField } from "@/lib/company-sheet-reset-rules";

export type SheetResetResult = { status: number; body: Record<string, unknown> };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rowsOf = <T>(r: unknown) => r as T[];

/** Locks the account's agent_configs + users rows; null when either is missing. */
async function lockAccount(tx: Tx, userId: string): Promise<{ id: string } | null> {
  const [row] = rowsOf<{ id: string }>(
    await tx.execute(sql`
      SELECT a.id FROM agent_configs a JOIN users u ON u.id = a.user_id
      WHERE a.user_id = ${userId} ORDER BY a.id LIMIT 1 FOR UPDATE`),
  );
  return row ?? null;
}

/** Per field: is the current value exactly what reset `resetId` wrote? */
async function sameAsApplied(tx: Tx | typeof db, configId: string, resetId: string): Promise<Record<SheetField, boolean>> {
  const [r] = rowsOf<{ business: boolean; knowledge: boolean; company_sheet: boolean }>(
    await tx.execute(sql`
      SELECT a.business = r.applied->'business' AS business,
             a.knowledge = r.applied->'knowledge' AS knowledge,
             u.company_sheet IS NOT DISTINCT FROM r.applied->'companySheet' AS company_sheet
      FROM agent_configs a JOIN users u ON u.id = a.user_id, persona_resets r
      WHERE a.id = ${configId} AND r.id = ${resetId}`),
  );
  return { business: r?.business === true, knowledge: r?.knowledge === true, companySheet: r?.company_sheet === true };
}

async function latestResetId(tx: Tx | typeof db, userId: string): Promise<string | null> {
  const [r] = rowsOf<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM persona_resets WHERE user_id = ${userId} AND kind = ${RESET_KIND}
      ORDER BY created_at DESC, id DESC LIMIT 1`),
  );
  return r?.id ?? null;
}

export async function resetCompanySheet(userId: string, adminId: string): Promise<SheetResetResult> {
  const [u] = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM users WHERE id = ${userId}`));
  if (!u) return { status: 404, body: { error: "user_not_found" } };
  return db.transaction(async (tx): Promise<SheetResetResult> => {
    const row = await lockAccount(tx, userId);
    if (!row) return { status: 404, body: { error: "agent_config_not_found" } };
    const applied = clearedSheet();
    // previous = the exact current jsonb values; companySheet omitted when NULL.
    const [reset] = rowsOf<{ id: string; created_at: string }>(
      await tx.execute(sql`
        INSERT INTO persona_resets (user_id, kind, previous, applied, by_admin)
        SELECT ${userId}, ${RESET_KIND},
               jsonb_build_object('business', a.business, 'knowledge', a.knowledge)
                 || CASE WHEN u.company_sheet IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('companySheet', u.company_sheet) END,
               ${JSON.stringify(applied)}::jsonb, ${adminId}
        FROM agent_configs a JOIN users u ON u.id = a.user_id
        WHERE a.id = ${row.id}
        RETURNING id, created_at`),
    );
    await tx.execute(sql`
      UPDATE agent_configs a SET business = r.applied->'business', knowledge = r.applied->'knowledge', updated_at = now()
      FROM persona_resets r WHERE a.id = ${row.id} AND r.id = ${reset.id}`);
    await tx.execute(sql`UPDATE users SET company_sheet = NULL WHERE id = ${userId}`);
    return { status: 200, body: { ok: true, resetId: reset.id, createdAt: reset.created_at } };
  });
}

export async function undoCompanySheetReset(userId: string, resetId: string, force: boolean): Promise<SheetResetResult> {
  return db.transaction(async (tx): Promise<SheetResetResult> => {
    const row = await lockAccount(tx, userId);
    if (!row) return { status: 404, body: { error: "agent_config_not_found" } };
    const [reset] = rowsOf<{ id: string; previous: unknown; undone_at: string | null }>(
      await tx.execute(sql`
        SELECT id, previous, undone_at FROM persona_resets
        WHERE id = ${resetId} AND user_id = ${userId} AND kind = ${RESET_KIND}`),
    );
    if (!reset) return { status: 404, body: { error: "reset_not_found" } };
    if (reset.undone_at) return { status: 409, body: { error: "already_undone" } };
    if ((await latestResetId(tx, userId)) !== reset.id) return { status: 409, body: { error: "not_latest_reset" } };
    if (!isSheetSnapshot(reset.previous)) return { status: 500, body: { error: "snapshot_unreadable" } };
    const edited = sheetEditedSinceReset(await sameAsApplied(tx, row.id, reset.id));
    if (edited.length && !force) return { status: 409, body: { error: "edited_since_reset", fields: edited } };
    const marked = rowsOf<{ id: string }>(
      await tx.execute(sql`UPDATE persona_resets SET undone_at = now() WHERE id = ${reset.id} AND undone_at IS NULL RETURNING id`),
    );
    if (!marked.length) return { status: 409, body: { error: "already_undone" } };
    await tx.execute(sql`
      UPDATE agent_configs a SET business = r.previous->'business', knowledge = r.previous->'knowledge', updated_at = now()
      FROM persona_resets r WHERE a.id = ${row.id} AND r.id = ${reset.id}`);
    await tx.execute(sql`
      UPDATE users u SET company_sheet = r.previous->'companySheet'
      FROM persona_resets r WHERE u.id = ${userId} AND r.id = ${reset.id}`);
    return { status: 200, body: { ok: true, resetId: reset.id, forced: edited.length > 0, overwritten: edited } };
  });
}

/** The company-sheet reset an admin can undo now (the latest of that kind, not undone), and whether the account was edited since. */
export async function undoableSheetReset(
  userId: string,
): Promise<{ resetId: string; createdAt: string; editedSinceReset: SheetField[] } | null> {
  const id = await latestResetId(db, userId);
  if (!id) return null;
  const [latest] = rowsOf<{ id: string; created_at: string; undone_at: string | null }>(
    await db.execute(sql`SELECT id, created_at, undone_at FROM persona_resets WHERE id = ${id}`),
  );
  if (!latest || latest.undone_at) return null;
  const [cfg] = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM agent_configs WHERE user_id = ${userId} ORDER BY id LIMIT 1`));
  if (!cfg) return null;
  return {
    resetId: latest.id,
    createdAt: latest.created_at,
    editedSinceReset: sheetEditedSinceReset(await sameAsApplied(db, cfg.id, latest.id)),
  };
}
