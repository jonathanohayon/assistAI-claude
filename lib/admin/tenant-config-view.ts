// What GET /api/admin/configs/[userId] sends to the admin's browser. No
// query runs here, so a test runs the route's own handler on mock rows
// (scripts/tests/admin-configs-no-secrets.test.ts). Production wiring of the
// loaders: lib/admin/tenant-config-deps.ts.
//
// - users: an explicit PICK (ADMIN_USER_FIELDS). A column added to `users`
//   later is NOT sent until it is named here, so the password hash, the HYP
//   card token and the Google refresh token never leave the server.
// - agent_configs: the row minus its stored records that carry secrets or
//   private state (tools_config holds the sealed client-agent secret,
//   contact_confirmations the confirmation records). The test fills every
//   column of both tables and fails on any column whose NAME looks secret.
import { withoutContactConfirmations } from "@/lib/contact-confirmation";
import type { agentConfigs, users } from "@/lib/db/schema";
import { resolveDoor } from "@/lib/door";
import { currentInboundPersona } from "@/lib/persona/store";
import { withoutToolsStore } from "@/lib/tools/store";
import { currentInboundVoice } from "@/lib/voice/store";

type UserRow = typeof users.$inferSelect;
type ConfigRow = typeof agentConfigs.$inferSelect;

/** The only `users` columns the admin config response carries (identity + display). */
export const ADMIN_USER_FIELDS = [
  "id",
  "email",
  "role",
  "displayName",
  "subscriptionStatus",
  "subscriptionPlan",
  "trialEndsAt",
  "paidUntil",
  "emailVerified",
  "locale",
  "developerMode",
  // Returned resolved ("reception" for NULL), read-only here: writes go
  // through PUT /api/dashboard/account?asUserId=.
  "door",
  "createdAt",
] as const satisfies readonly (keyof UserRow)[];

export type AdminUserField = (typeof ADMIN_USER_FIELDS)[number];
export type AdminUserView = Pick<UserRow, AdminUserField>;

/** Copies exactly ADMIN_USER_FIELDS out of a row, whatever else the row holds. */
export function adminUserView(row: Pick<UserRow, AdminUserField> & Record<string, unknown>): AdminUserView {
  const out = {} as Record<AdminUserField, unknown>;
  for (const k of ADMIN_USER_FIELDS) out[k] = row[k];
  out.door = resolveDoor(row.door);
  return out as AdminUserView;
}

export interface AdminConfigGetDeps {
  /** May return more columns than ADMIN_USER_FIELDS: the view picks. */
  loadUser(userId: string): Promise<(Pick<UserRow, AdminUserField> & Record<string, unknown>) | null>;
  loadConfig(userId: string): Promise<ConfigRow | null>;
  /** lib/voice/choice-load.ts voiceChoiceFor(cfg, true) in production. */
  voiceChoice(cfg: ConfigRow): Promise<unknown>;
}

/** GET /api/admin/configs/[userId] after the admin guard. */
export async function handleAdminConfigGet(
  userId: string,
  deps: AdminConfigGetDeps,
): Promise<{ status: number; body: unknown }> {
  const user = await deps.loadUser(userId);
  if (!user) return { status: 404, body: { error: "not found" } };
  const cfg = await deps.loadConfig(userId);
  return {
    status: 200,
    body: {
      user: adminUserView(user),
      config: cfg
        ? {
            // N1: the confirmation record is never returned (N2 adds its own view).
            // T3: the stored tools (sealed client-agent secret) are never returned.
            ...withoutContactConfirmations(withoutToolsStore(cfg)),
            // Voice contract (V5): stored voice or derived from the columns (admin: full).
            voiceConfig: currentInboundVoice(cfg.voiceConfig, cfg),
            voiceChoice: await deps.voiceChoice(cfg),
            personaConfig: currentInboundPersona(cfg.personaConfig, cfg),
          }
        : null,
    },
  };
}
