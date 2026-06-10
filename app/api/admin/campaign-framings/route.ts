import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import {
  getCampaignGoalFramings,
  setCampaignGoalFramings,
  type CampaignGoalFramings,
} from "@/lib/settings";
import { DEFAULT_GOAL_FRAMINGS } from "@/lib/campaigns/prompt";

// GET — framings actuels (admin override mergé sur les défauts) + les défauts
// (pour le bouton "réinitialiser").
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const framings = await getCampaignGoalFramings();
  return NextResponse.json({ framings, defaults: DEFAULT_GOAL_FRAMINGS });
}

// PUT { framings: Partial<Record<preset,string>> } — sauvegarde.
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const parsed = await parseJsonBody<{
    framings?: Partial<CampaignGoalFramings>;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.framings || typeof body.framings !== "object")
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await setCampaignGoalFramings(body.framings);
  return NextResponse.json({ ok: true, framings: await getCampaignGoalFramings() });
}
