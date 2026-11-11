// Atomic claim on the admin alert ledger — SERVER-ONLY.
//
// The ledger is one app_settings row (key "admin_alert_ledger", value = a JSON
// object key → epoch ms of the last send). The previous read → check → write
// in JS let two concurrent ticks (two cron ticks, two replicas, two events)
// both read the old ledger and both send, and the second write could drop the
// first one's entry for another key (lost update).
//
// claimAlertSlot does the check AND the write in ONE statement:
// INSERT … ON CONFLICT DO UPDATE … WHERE. Postgres locks the row, and a
// concurrent claim waits for the first to commit, then re-evaluates the WHERE
// against the new value — so exactly one caller per dedup window gets a row
// back, and every update merges into the latest ledger (no lost keys).
// Same semantics as shouldSendAlert + recordAlert (lib/alert-dedup.ts):
// send when the key has no numeric entry or `now - last >= dedupMs`; on a
// claim, drop non-numeric entries and entries older than `keepMs`.
// No migration: app_settings.value stays text holding the same JSON.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const LEDGER_SETTING = "admin_alert_ledger";

type Rows = unknown[] | { rows: unknown[] };
const rowsOf = (r: Rows): unknown[] => (Array.isArray(r) ? r : r.rows);

async function claimOnce(key: string, now: number, dedupMs: number, keepMs: number): Promise<boolean> {
  // `led` = the stored value as a JSON object ('{}' if it is any other JSON type).
  // CASEs (not AND chains) so a non-numeric entry is never cast to numeric.
  const led = sql`(CASE WHEN jsonb_typeof(s.value::jsonb) = 'object' THEN s.value::jsonb ELSE '{}'::jsonb END)`;
  const r = (await db.execute(sql`
    INSERT INTO app_settings AS s (key, value, updated_at)
    VALUES (${LEDGER_SETTING}, jsonb_build_object(${key}::text, ${now}::bigint)::text, now())
    ON CONFLICT (key) DO UPDATE SET
      value = (
        COALESCE(
          (SELECT jsonb_object_agg(e.key, e.value)
             FROM jsonb_each(${led}) e
            WHERE CASE WHEN jsonb_typeof(e.value) = 'number'
                       THEN ${now}::bigint - (e.value)::numeric < ${keepMs}::bigint
                       ELSE false END),
          '{}'::jsonb
        ) || jsonb_build_object(${key}::text, ${now}::bigint)
      )::text,
      updated_at = now()
    WHERE CASE WHEN jsonb_typeof(${led} -> ${key}::text) = 'number'
               THEN ${now}::bigint - (${led} ->> ${key}::text)::numeric >= ${dedupMs}::bigint
               ELSE true END
    RETURNING s.key
  `)) as Rows;
  return rowsOf(r).length > 0;
}

/**
 * Atomically claims the right to send the alert `key` at `now`.
 * Returns true for exactly one caller per `dedupMs` window, and records the
 * send (BEFORE the caller sends) in the same statement.
 */
export async function claimAlertSlot(
  key: string,
  now: number,
  dedupMs: number,
  keepMs: number,
): Promise<boolean> {
  try {
    return await claimOnce(key, now, dedupMs, keepMs);
  } catch (e) {
    // The only expected failure is a stored value that is not valid JSON
    // (the ::jsonb cast throws). The old code treated it as an empty ledger;
    // do the same: reset it to '{}' — compare-and-swap on the exact bad text,
    // so a concurrent caller that already repaired and claimed is not wiped —
    // then claim again.
    const raw = await getSetting(LEDGER_SETTING);
    let corrupt = false;
    if (raw !== null) {
      try {
        JSON.parse(raw);
      } catch {
        corrupt = true;
      }
    }
    if (!corrupt) throw e;
    await db.execute(sql`
      UPDATE app_settings SET value = '{}', updated_at = now()
       WHERE key = ${LEDGER_SETTING} AND value = ${raw}
    `);
    return claimOnce(key, now, dedupMs, keepMs);
  }
}
