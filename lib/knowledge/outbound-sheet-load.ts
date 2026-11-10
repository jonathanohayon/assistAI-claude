// S5 — SERVER-ONLY: the account sheet for an outbound call, only when the
// switch is on for that account (no extra query when off).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import type { CompanySheet } from "@/lib/knowledge/contract";
import { outboundSheetEnabled } from "@/lib/knowledge/outbound-sheet";
import { currentCompanySheet } from "@/lib/knowledge/store";

export async function accountSheetForOutbound(accountId: string | null | undefined): Promise<CompanySheet | null> {
  if (!accountId || !outboundSheetEnabled(accountId)) return null;
  const [row] = await db
    .select({ companySheet: users.companySheet, business: agentConfigs.business })
    .from(users)
    .leftJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, accountId))
    .limit(1);
  return row ? currentCompanySheet(row.companySheet, row.business) : null;
}
