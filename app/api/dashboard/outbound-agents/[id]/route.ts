import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { db } from "@/lib/db";
import { campaigns, outboundAgents } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { normalizeAgentFields } from "@/lib/outbound-agents/validate";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function loadOwned(userId: string, id: string) {
  const [a] = await db
    .select()
    .from(outboundAgents)
    .where(and(eq(outboundAgents.id, id), eq(outboundAgents.userId, userId)))
    .limit(1);
  return a ?? null;
}

async function countCampaigns(agentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(eq(campaigns.agentId, agentId));
  return row?.count ?? 0;
}

// GET — détail d'un agent.
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const agent = await loadOwned(r.userId, id);
  if (!agent)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    agent: { ...agent, campaignCount: await countCampaigns(agent.id) },
  });
}

// PATCH — mise à jour des champs éditables d'un agent.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const agent = await loadOwned(r.userId, id);
  if (!agent)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = normalizeAgentFields({ ...agent, ...body });

  const [updated] = await db
    .update(outboundAgents)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(eq(outboundAgents.id, agent.id))
    .returning();

  return NextResponse.json({
    agent: { ...updated, campaignCount: await countCampaigns(agent.id) },
  });
}

// DELETE — suppression d'un agent. Les campagnes liées voient leur `agentId`
// passer à NULL (onDelete: set null) ; on les compte pour info dans la réponse.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const agent = await loadOwned(r.userId, id);
  if (!agent)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const detached = await countCampaigns(agent.id);
  await db.delete(outboundAgents).where(eq(outboundAgents.id, agent.id));

  await logEvent({
    source: "web",
    event: "outbound_agent_deleted",
    message: `Agent sortant supprimé: ${agent.name}`,
    userId: r.userId,
    metadata: { agentId: agent.id, detachedCampaigns: detached },
  });

  return NextResponse.json({ ok: true, detachedCampaigns: detached });
}
