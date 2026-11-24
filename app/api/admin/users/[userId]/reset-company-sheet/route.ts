import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { resetCompanySheet, undoableSheetReset } from "@/lib/company-sheet-reset";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { logEvent } from "@/lib/logger";
import { isUuid } from "@/lib/persona-reset-rules";

// ADMIN ONLY. Clears an account's company sheet (lib/company-sheet-reset-rules.ts):
// agent_configs.business = DEFAULT_BUSINESS, agent_configs.knowledge = [] (the
// deprecated array, which calls would otherwise serve again) and
// users.company_sheet = NULL. The replaced values are stored first in
// persona_resets (kind 'company_sheet'), so POST …/reset-company-sheet/undo can
// restore them exactly. Every other field (persona, voice, tools...) is untouched.
//
// GET  → { undo: { resetId, createdAt, editedSinceReset: string[] } | null }
// POST → 200 { ok, resetId, createdAt } | 404 user_not_found / agent_config_not_found
interface Ctx {
  params: Promise<{ userId: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await ctx.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  return NextResponse.json({ undo: await undoableSheetReset(userId) });
}

export async function POST(_req: Request, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await ctx.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  const r = await resetCompanySheet(userId, guard.admin.id);
  if (r.status === 200) {
    // No sheet content in the event: the exact values live in persona_resets.
    await logEvent({
      source: "admin",
      event: "company_sheet_reset",
      message: `Admin ${guard.admin.id} cleared the company sheet of ${userId}`,
      userId: guard.admin.id,
      metadata: { targetUserId: userId, resetId: r.body.resetId, by: guard.admin.id },
    });
    void warmGreetingAudioForUser(userId);
  }
  return NextResponse.json(r.body, { status: r.status });
}
