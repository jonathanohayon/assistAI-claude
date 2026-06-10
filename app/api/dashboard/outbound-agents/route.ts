import { desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { db } from "@/lib/db";
import { campaigns, outboundAgents } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { normalizeAgentFields } from "@/lib/outbound-agents/validate";

// GET — liste des agents sortants du tenant + nb de campagnes qui les utilisent.
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(outboundAgents)
    .where(eq(outboundAgents.userId, r.userId))
    .orderBy(desc(outboundAgents.createdAt));

  const ids = rows.map((a) => a.id);
  const usageRows = ids.length
    ? await db
        .select({
          agentId: campaigns.agentId,
          count: sql<number>`count(*)::int`,
        })
        .from(campaigns)
        .where(inArray(campaigns.agentId, ids))
        .groupBy(campaigns.agentId)
    : [];
  const usage = new Map(usageRows.map((u) => [u.agentId, u.count]));

  return NextResponse.json({
    agents: rows.map((a) => ({ ...a, campaignCount: usage.get(a.id) ?? 0 })),
  });
}

// POST — création d'un agent sortant.
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // body optionnel : normalizeAgentFields applique des défauts sur tout.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = normalizeAgentFields(body);

  const [created] = await db
    .insert(outboundAgents)
    .values({ userId: r.userId, ...fields })
    .returning();

  await logEvent({
    source: "web",
    event: "outbound_agent_created",
    message: `Agent sortant créé: ${created.name}`,
    userId: r.userId,
    metadata: { agentId: created.id },
  });

  return NextResponse.json(
    { agent: { ...created, campaignCount: 0 } },
    { status: 201 },
  );
}
