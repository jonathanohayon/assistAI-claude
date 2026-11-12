// Owner recap email settings (agent_configs.owner_recap_email[_enabled]):
// the load / save the dashboard route calls with the parsed body, so the
// DB test drives the SAME path (scripts/tests/owner-recap-email-db.test.ts).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { ownerRecapEmailWrite, type OwnerRecapEmailSettings } from "@/lib/owner-recap-email";

export async function loadOwnerRecapEmail(userId: string): Promise<OwnerRecapEmailSettings | null> {
  const [row] = await db
    .select({
      ownerRecapEmail: agentConfigs.ownerRecapEmail,
      ownerRecapEmailEnabled: agentConfigs.ownerRecapEmailEnabled,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  return row ?? null;
}

export type SaveResult =
  | { status: 200; body: OwnerRecapEmailSettings & { changedFields: string[] } }
  | { status: 400; body: { error: string; fields: string[] } }
  | { status: 404; body: { error: "no_config" } };

/** Validates the body, writes only the fields it carries, returns the stored values. */
export async function saveOwnerRecapEmail(userId: string, body: unknown): Promise<SaveResult> {
  const write = ownerRecapEmailWrite(body);
  if (!write.ok) return { status: 400, body: write.body };
  const current = await loadOwnerRecapEmail(userId);
  if (!current) return { status: 404, body: { error: "no_config" } };
  const changedFields = Object.keys(write.updates);
  if (changedFields.length === 0) return { status: 200, body: { ...current, changedFields } };
  const [updated] = await db
    .update(agentConfigs)
    .set({ ...write.updates, updatedAt: new Date() })
    .where(eq(agentConfigs.userId, userId))
    .returning({
      ownerRecapEmail: agentConfigs.ownerRecapEmail,
      ownerRecapEmailEnabled: agentConfigs.ownerRecapEmailEnabled,
    });
  return { status: 200, body: { ...updated, changedFields } };
}
