import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { seedForNewAccount } from "@/lib/neutral-seed";
import { PLANS, type PlanKey } from "@/lib/plans";
import { SETTING_KEYS, getOnboardingGreetingByPlan, getOnboardingTemplateByPlan, setSetting } from "@/lib/settings";

// Internal-only: reset a tenant's instructions + greeting to what a NEW
// account of the same plan and language gets today (seedForNewAccount: the
// admin's per-plan template/greeting, else the neutral persona of
// lib/neutral-seed.ts — no customer's business fact). Gated by
// INTERNAL_SECRET. Running it rewrites that tenant's agent: an ops action.
//
// POST { email?: string; userId?: string; clearGlobal?: boolean }
// clearGlobal=true also wipes the admin app_settings.global_instructions
// (which is prepended to every tenant prompt by /api/agent/config) — useful
// when an outdated global block is shadowing the new canonical persona.
export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<{
    email?: string;
    userId?: string;
    clearGlobal?: boolean;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  let userId = body.userId;
  let resolvedUser: { id: string; subscriptionPlan: string; locale: string } | null = null;
  if (body.userId) {
    const [u] = await db
      .select({ id: users.id, subscriptionPlan: users.subscriptionPlan, locale: users.locale })
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (u) resolvedUser = u;
  } else if (body.email) {
    const [u] = await db
      .select({ id: users.id, subscriptionPlan: users.subscriptionPlan, locale: users.locale })
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (u) resolvedUser = u;
  }
  if (!resolvedUser) {
    return NextResponse.json({ error: "user introuvable" }, { status: 404 });
  }
  userId = resolvedUser.id;

  const [before] = await db
    .select({
      id: agentConfigs.id,
      lenBefore: agentConfigs.instructions,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!before) {
    return NextResponse.json(
      { error: "agent_config introuvable pour ce user" },
      { status: 404 },
    );
  }

  // Same seed as a new account of this plan and language (provision-tenant).
  // Language stays as the tenant set it: only instructions + greeting reset.
  const plan: PlanKey = PLANS.some((p) => p.key === resolvedUser.subscriptionPlan)
    ? (resolvedUser.subscriptionPlan as PlanKey)
    : PLANS[0].key;
  const [templatesByPlan, greetingsByPlan] = await Promise.all([getOnboardingTemplateByPlan(), getOnboardingGreetingByPlan()]);
  const defaults = seedForNewAccount(plan, resolvedUser.locale, templatesByPlan, greetingsByPlan);
  const [updated] = await db
    .update(agentConfigs)
    .set({
      instructions: defaults.instructions,
      greetingInstructions: defaults.greeting,
      updatedAt: new Date(),
    })
    .where(eq(agentConfigs.userId, userId))
    .returning();

  let globalCleared = false;
  if (body.clearGlobal) {
    await setSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS, "");
    globalCleared = true;
  }

  return NextResponse.json({
    ok: true,
    userId,
    lenBefore: before.lenBefore.length,
    lenAfter: updated.instructions.length,
    globalCleared,
  });
}
