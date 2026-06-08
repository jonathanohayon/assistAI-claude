import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import type { CampaignStatus } from "@/lib/campaigns/constants";

interface Ctx {
  params: Promise<{ id: string }>;
}

// Transitions autorisées par action.
const TRANSITIONS: Record<string, { from: CampaignStatus[]; to: CampaignStatus }> = {
  start: { from: ["draft", "paused"], to: "running" },
  pause: { from: ["running"], to: "paused" },
  complete: { from: ["running", "paused", "draft"], to: "completed" },
  archive: { from: ["completed", "draft", "paused"], to: "archived" },
};

// POST { action: "start"|"pause"|"complete"|"archive" } — change le statut.
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? "";
  const rule = TRANSITIONS[action];
  if (!rule)
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!rule.from.includes(campaign.status as CampaignStatus))
    return NextResponse.json(
      { error: "invalid_transition", from: campaign.status, action },
      { status: 409 },
    );

  const patch: Record<string, unknown> = {
    status: rule.to,
    updatedAt: sql`now()`,
  };
  if (rule.to === "running" && !campaign.startedAt) patch.startedAt = sql`now()`;
  if (rule.to === "completed") patch.completedAt = sql`now()`;

  const [updated] = await db
    .update(campaigns)
    .set(patch)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .returning();

  await logEvent({
    source: "web",
    event: `campaign_${action}`,
    message: `Campagne ${campaign.name} → ${rule.to}`,
    userId: r.userId,
    metadata: { campaignId: id, action, status: rule.to },
  });

  return NextResponse.json({ campaign: updated });
}
