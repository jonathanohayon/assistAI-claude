import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { currentOutboundVoice, voiceForViewer } from "@/lib/voice/store";
import { currentOutboundPersona } from "@/lib/persona/store";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { db } from "@/lib/db";
import { campaigns, outboundAgents } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { withoutToolsStore } from "@/lib/tools/store";
import { currentAgentMission, withoutMissionStore } from "@/lib/mission/store";
import { planOutboundAgentPatch } from "@/lib/outbound-agents/patch";

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
    agent: {
      ...withoutMissionStore(withoutToolsStore(agent)),
      voiceConfig: voiceForViewer(currentOutboundVoice(agent.voiceConfig, agent), await sessionIsAdmin()),
      personaConfig: currentOutboundPersona(agent.personaConfig, agent),
      // M2a: the stored sales mission (null when unset). Only this GET and the
      // PATCH below return it; every other route strips it.
      mission: currentAgentMission(agent.mission),
      campaignCount: await countCampaigns(agent.id),
    },
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

  // body optionnel : patch partiel mergé sur l'agent existant.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // The raw body → the stored columns (legacy fields, voice, persona, and
  // the M2a mission): one pure function, also run by the gate tests.
  const isAdmin = await sessionIsAdmin();
  const plan = planOutboundAgentPatch(body, agent, isAdmin);
  if ("error" in plan) {
    return NextResponse.json(plan.error.body, { status: plan.error.status });
  }

  const [updated] = await db
    .update(outboundAgents)
    .set({ ...plan.set, updatedAt: sql`now()` })
    .where(eq(outboundAgents.id, agent.id))
    .returning();

  return NextResponse.json({
    agent: {
      ...withoutMissionStore(withoutToolsStore(updated)),
      voiceConfig: voiceForViewer(currentOutboundVoice(updated.voiceConfig, updated), isAdmin),
      personaConfig: currentOutboundPersona(updated.personaConfig, updated),
      // Same key and shape as the GET, so the screen re-reads the stored mission after a save.
      mission: currentAgentMission(updated.mission),
      campaignCount: await countCampaigns(agent.id),
    },
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
