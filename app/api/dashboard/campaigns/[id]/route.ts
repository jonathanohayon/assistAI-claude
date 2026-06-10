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
import {
  normalizeCallWindow,
  normalizeConcurrency,
  normalizeExtractionSchema,
  normalizeGoalPreset,
  normalizeRetryRules,
} from "@/lib/campaigns/validate";

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
    .select()
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

  return NextResponse.json({ campaign, agent, contacts, calls, counts });
}

// PATCH — mise à jour partielle (champs structurels seulement si draft/paused).
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
  const editable = campaign.status === "draft" || campaign.status === "paused";

  const patch: Record<string, unknown> = { updatedAt: sql`now()` };
  if (typeof body.name === "string" && body.name.trim())
    patch.name = body.name.trim().slice(0, 160);

  // Les champs structurels (qui changent le comportement de dialing) ne sont
  // modifiables que tant que la campagne n'a pas démarré ou est en pause.
  if (editable) {
    if (body.goalPreset !== undefined)
      patch.goalPreset = normalizeGoalPreset(body.goalPreset);
    if (typeof body.objective === "string")
      patch.objective = body.objective.slice(0, 4000);
    if (typeof body.successCriteria === "string")
      patch.successCriteria = body.successCriteria.slice(0, 4000);
    if (body.agentId !== undefined) {
      // null explicite = détacher l'agent ; sinon valider l'appartenance.
      if (body.agentId === null) patch.agentId = null;
      else if (typeof body.agentId === "string" && body.agentId) {
        const [a] = await db
          .select({ id: outboundAgents.id })
          .from(outboundAgents)
          .where(
            and(
              eq(outboundAgents.id, body.agentId),
              eq(outboundAgents.userId, r.userId),
            ),
          )
          .limit(1);
        patch.agentId = a?.id ?? null;
      }
    }
    if (body.extractionSchema !== undefined)
      patch.extractionSchema = normalizeExtractionSchema(body.extractionSchema);
    if (body.concurrency !== undefined)
      patch.concurrency = normalizeConcurrency(body.concurrency);
    if (body.retryRules !== undefined)
      patch.retryRules = normalizeRetryRules(body.retryRules);
    if (body.callWindow !== undefined)
      patch.callWindow = normalizeCallWindow(body.callWindow);
    if (typeof body.fromNumber === "string")
      patch.fromNumber = body.fromNumber.trim();
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
