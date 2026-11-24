import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { logEvent } from "@/lib/logger";
import { resetPersonaToNeutral, undoableReset } from "@/lib/persona-reset";
import { isUuid } from "@/lib/persona-reset-rules";

// ADMIN ONLY. Resets an account's persona to the neutral default
// (lib/persona-reset-rules.ts): instructions + greetingInstructions =
// neutralSeed(language), agentName = DEFAULT_AGENT_NAME. Never the per-plan
// onboarding template. The replaced values are stored first in
// persona_resets, so POST …/reset-persona/undo can restore them exactly.
// Every other field of the account (voice, language, tools, company sheet...)
// is untouched.
//
// GET  → { undo: { resetId, createdAt, editedSinceReset: string[] } | null }
// POST → 200 { ok, resetId, createdAt, applied } | 404 user_not_found / agent_config_not_found
interface Ctx {
  params: Promise<{ userId: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await ctx.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  return NextResponse.json({ undo: await undoableReset(userId) });
}

export async function POST(_req: Request, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await ctx.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  const r = await resetPersonaToNeutral(userId, guard.admin.id);
  if (r.status === 200) {
    // No prompt text in the event: the exact values live in persona_resets.
    await logEvent({
      source: "admin",
      event: "persona_reset_neutral",
      message: `Admin ${guard.admin.id} reset the persona of ${userId} to the neutral default`,
      userId: guard.admin.id,
      metadata: { targetUserId: userId, resetId: r.body.resetId, by: guard.admin.id },
    });
    void warmGreetingAudioForUser(userId);
  }
  return NextResponse.json(r.body, { status: r.status });
}
