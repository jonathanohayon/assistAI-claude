import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  getCampaignGoalFramings,
  setCampaignGoalFramings,
  type CampaignGoalFramings,
} from "@/lib/settings";
import { DEFAULT_GOAL_FRAMINGS } from "@/lib/campaigns/prompt";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return me?.role === "admin";
}

// GET — framings actuels (admin override mergé sur les défauts) + les défauts
// (pour le bouton "réinitialiser").
export async function GET() {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const framings = await getCampaignGoalFramings();
  return NextResponse.json({ framings, defaults: DEFAULT_GOAL_FRAMINGS });
}

// PUT { framings: Partial<Record<preset,string>> } — sauvegarde.
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    framings?: Partial<CampaignGoalFramings>;
  };
  if (!body.framings || typeof body.framings !== "object")
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await setCampaignGoalFramings(body.framings);
  return NextResponse.json({ ok: true, framings: await getCampaignGoalFramings() });
}
