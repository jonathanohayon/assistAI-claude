// Production wiring of handleAdminConfigGet (lib/admin/tenant-config-view.ts).
// The users query selects ADMIN_USER_FIELDS only: secret columns are not even
// read from the database for this route.
import { eq } from "drizzle-orm";

import { ADMIN_USER_FIELDS, type AdminConfigGetDeps, type AdminUserField } from "@/lib/admin/tenant-config-view";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { voiceChoiceFor } from "@/lib/voice/choice-load";

const adminUserColumns = Object.fromEntries(ADMIN_USER_FIELDS.map((k) => [k, users[k]])) as {
  [K in AdminUserField]: (typeof users)[K];
};

export const adminConfigGetDeps: AdminConfigGetDeps = {
  loadUser: async (userId) => {
    const [u] = await db.select(adminUserColumns).from(users).where(eq(users.id, userId)).limit(1);
    return u ?? null;
  },
  loadConfig: async (userId) => {
    const [cfg] = await db.select().from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1);
    return cfg ?? null;
  },
  voiceChoice: (cfg) => voiceChoiceFor(cfg, true),
};
