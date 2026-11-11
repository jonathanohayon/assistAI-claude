import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  campaignContacts,
  campaignCalls,
  campaigns,
  outboundAgents,
} from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { withoutToolsStore } from "@/lib/tools/store";
import { planCampaignPatch } from "@/lib/campaigns/patch-plan";
import { campaignCallPublicColumns } from "@/lib/campaigns/campaign-call-row";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Charge une campagne en s'assurant qu'elle appartient au tenant scopé.
async function loadOwned(userId: string, id: string) {
  const [c] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  return c ?? null;
}

// GET — détail campagne + contacts (paginés) + résumé des appels.
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const campaign = await loadOwned(r.userId, id);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 200, 1),
    1000,
  );

  const contacts = await db
    .select()
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, id))
    .orderBy(desc(campaignContacts.createdAt))
    .limit(limit);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where status = 'queued')::int`,
      inFlight: sql<number>`count(*) filter (where status in ('claimed','calling'))::int`,
      done: sql<number>`count(*) filter (where status in ('completed','failed','no_answer','voicemail','busy','skipped'))::int`,
      connected: sql<number>`count(*) filter (where status = 'completed')::int`,
    })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, id));

  const calls = await db
    .select(campaignCallPublicColumns)
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .orderBy(desc(campaignCalls.createdAt))
    .limit(limit);

  // Agent associé (Phase 2) — sert au preflight (connaissance métier) et à
  // l'affichage. null si la campagne n'a pas encore d'agent.
  const agent = campaign.agentId
    ? ((
        await db
          .select()
          .from(outboundAgents)
          .where(eq(outboundAgents.id, campaign.agentId))
          .limit(1)
      )[0] ?? null)
    : null;

  // Never the raw Tools store: it holds the "ask your agent" secret (T5a).
  return NextResponse.json({ campaign, agent: agent ? withoutToolsStore(agent) : null, contacts, calls, counts });
}

// PATCH — partial update. What may change depends on the status
// (lib/campaigns/patch-plan.ts): everything while draft/paused, only the call
// window while running (applied on the next dispatcher tick). A refused
// change returns 409 and applies NOTHING — never a silent 200.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const campaign = await loadOwned(r.userId, id);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  // body optionnel : tous les champs sont facultatifs (patch partiel).
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const plan = planCampaignPatch(campaign, body);
  if (!plan.ok) {
    return NextResponse.json(
      { error: plan.error, fields: plan.fields, status: campaign.status },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = { updatedAt: sql`now()`, ...plan.changes };
  if (typeof body.name === "string" && body.name.trim())
    patch.name = body.name.trim().slice(0, 160);

  // A changed agent must belong to the tenant (null = detach).
  if (typeof plan.changes.agentId === "string") {
    const [a] = await db
      .select({ id: outboundAgents.id })
      .from(outboundAgents)
      .where(
        and(
          eq(outboundAgents.id, plan.changes.agentId),
          eq(outboundAgents.userId, r.userId),
        ),
      )
      .limit(1);
    patch.agentId = a?.id ?? null;
  }

  if (campaign.status === "running" && plan.changes.callWindow) {
    await logEvent({
      source: "web",
      event: "campaign_call_window_changed",
      message: "Call window changed on a running campaign (applies on the next dispatcher tick)",
      userId: r.userId,
      metadata: { campaignId: id, callWindow: plan.changes.callWindow },
    });
  }

  const [updated] = await db
    .update(campaigns)
    .set(patch)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .returning();

  return NextResponse.json({ campaign: updated });
}

// DELETE — supprime la campagne (cascade contacts + calls via FK).
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const campaign = await loadOwned(r.userId, id);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)));

  await logEvent({
    source: "web",
    event: "campaign_deleted",
    message: `Campagne supprimée: ${campaign.name}`,
    userId: r.userId,
    metadata: { campaignId: id },
  });

  return NextResponse.json({ ok: true });
}
