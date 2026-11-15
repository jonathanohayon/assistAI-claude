import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { captureMode } from "@/lib/campaigns/capture-mode";
import { runCampaignCaptureCatchUp } from "@/lib/campaigns/capture-runtime";
import { runCampaignAnalysisCatchUp } from "@/lib/campaigns/analysis-runtime";
import { dispatchDueJobs } from "@/lib/campaigns/dispatch";

// GET /api/cron/campaign-dispatch?limit=N  (x-internal-secret)
// Tourne périodiquement (Railway cron) : réclame les contacts dus et compose
// les appels. Borné par `limit`.
//
// CAMPAIGN_CAPTURE on (lib/campaigns/capture-mode.ts): the same tick also runs
// one bounded capture catch-up pass (calls after() missed), INDEPENDENT of
// CAMPAIGN_DISPATCH (it runs when dispatch is off or dry too) and it never
// dials. The response then gains one counts-only `capture` field. OFF: the
// pre-catch-up response bytes.
//
// Every tick (no switch) also runs one bounded post-call ANALYSIS catch-up
// pass (lib/campaigns/analysis.ts: calls after() missed), independent of
// CAMPAIGN_DISPATCH and CAMPAIGN_CAPTURE, never dials. Its counts go to the
// `campaign_analysis_catchup` event only: the response bytes are unchanged.

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1),
    50,
  );
  // Started first, awaited before the response (or before a dispatch error
  // surfaces); it never rejects.
  const analysis = runCampaignAnalysisCatchUp();
  try {
    if (captureMode() !== "on") {
      const result = await dispatchDueJobs(limit);
      return NextResponse.json({ ok: true, ...result });
    }
    // Both run; a dispatch failure still lets the catch-up finish, then
    // surfaces exactly as before (the catch-up itself never rejects).
    const [dispatch, capture] = await Promise.allSettled([dispatchDueJobs(limit), runCampaignCaptureCatchUp()]);
    if (dispatch.status === "rejected") throw dispatch.reason;
    return NextResponse.json({
      ok: true,
      ...dispatch.value,
      capture: capture.status === "fulfilled" ? capture.value : { claimed: 0, written: 0, skipped: 0, failed: 0 },
    });
  } finally {
    await analysis;
  }
}
