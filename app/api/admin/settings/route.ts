import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { type PlanFeatureMatrix } from "@/lib/plan-features";
import {
  getPlanFeatureMatrix,
  setPlanFeatureMatrix,
} from "@/lib/plan-features-storage";
import { type PlanPricingMap } from "@/lib/plan-pricing";
import {
  getPlanPricingMap,
  setPlanPricingMap,
} from "@/lib/plan-pricing-storage";
import {
  SETTING_KEYS,
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getGreetingFallbackTemplateByPlan,
  getHangupDirectiveByPlan,
  getOnboardingTemplateByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSetting,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
  getSummaryPromptByPlan,
  setConfigBlocksDirectiveByPlan,
  setGlobalInstructionsByPlan,
  setGreetingFallbackTemplateByPlan,
  setHangupDirectiveByPlan,
  setOnboardingTemplateByPlan,
  setPerCallContextTemplateByPlan,
  setPromptBlockOrderByPlan,
  setSetting,
  setSpokenPhoneDirectiveByPlan,
  setSpokenTimeDirectiveByPlan,
  setSummaryPromptByPlan,
  type ConfigBlocksDirectiveByPlan,
  type GlobalInstructionsByPlan,
  type GreetingFallbackTemplateByPlan,
  type HangupDirectiveByPlan,
  type OnboardingTemplateByPlan,
  type PerCallContextTemplateByPlan,
  type PromptBlockOrderByPlan,
  type SpokenPhoneDirectiveByPlan,
  type SpokenTimeDirectiveByPlan,
  type SummaryPromptByPlan,
} from "@/lib/settings";

const requireAdmin = async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return me?.role === "admin" ? me : null;
};

// GET — return all known settings.
export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const globalInstructions =
    (await getSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS)) ?? "";
  const globalInstructionsByPlan = await getGlobalInstructionsByPlan();
  const onboardingTemplate =
    (await getSetting(SETTING_KEYS.ONBOARDING_TEMPLATE)) ?? "";
  const onboardingTemplateByPlan = await getOnboardingTemplateByPlan();
  const planFeatures = await getPlanFeatureMatrix();
  const planPricing = await getPlanPricingMap();
  const summaryPromptByPlan = await getSummaryPromptByPlan();
  const spokenTimeDirectiveByPlan = await getSpokenTimeDirectiveByPlan();
  const spokenPhoneDirectiveByPlan = await getSpokenPhoneDirectiveByPlan();
  const hangupDirectiveByPlan = await getHangupDirectiveByPlan();
  const perCallContextTemplateByPlan =
    await getPerCallContextTemplateByPlan();
  const configBlocksDirectiveByPlan =
    await getConfigBlocksDirectiveByPlan();
  const promptBlockOrderByPlan = await getPromptBlockOrderByPlan();
  const greetingFallbackTemplateByPlan =
    await getGreetingFallbackTemplateByPlan();
  return NextResponse.json({
    globalInstructions,
    globalInstructionsByPlan,
    onboardingTemplate,
    onboardingTemplateByPlan,
    planFeatures,
    planPricing,
    summaryPromptByPlan,
    spokenTimeDirectiveByPlan,
    spokenPhoneDirectiveByPlan,
    hangupDirectiveByPlan,
    perCallContextTemplateByPlan,
    configBlocksDirectiveByPlan,
    promptBlockOrderByPlan,
    greetingFallbackTemplateByPlan,
  });
}

// PUT — update one or more settings.
export async function PUT(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    globalInstructions?: string;
    globalInstructionsByPlan?: Partial<GlobalInstructionsByPlan>;
    onboardingTemplate?: string;
    onboardingTemplateByPlan?: Partial<OnboardingTemplateByPlan>;
    planFeatures?: PlanFeatureMatrix;
    planPricing?: Partial<PlanPricingMap>;
    summaryPromptByPlan?: Partial<SummaryPromptByPlan>;
    spokenTimeDirectiveByPlan?: Partial<SpokenTimeDirectiveByPlan>;
    spokenPhoneDirectiveByPlan?: Partial<SpokenPhoneDirectiveByPlan>;
    hangupDirectiveByPlan?: Partial<HangupDirectiveByPlan>;
    perCallContextTemplateByPlan?: Partial<PerCallContextTemplateByPlan>;
    configBlocksDirectiveByPlan?: Partial<ConfigBlocksDirectiveByPlan>;
    promptBlockOrderByPlan?: Partial<PromptBlockOrderByPlan>;
    greetingFallbackTemplateByPlan?: Partial<GreetingFallbackTemplateByPlan>;
  };

  const changed: string[] = [];

  if (typeof body.globalInstructions === "string") {
    await setSetting(
      SETTING_KEYS.GLOBAL_INSTRUCTIONS,
      body.globalInstructions,
    );
    changed.push("global_instructions");
  }
  if (
    body.globalInstructionsByPlan &&
    typeof body.globalInstructionsByPlan === "object"
  ) {
    await setGlobalInstructionsByPlan(body.globalInstructionsByPlan);
    changed.push("global_instructions_by_plan");
  }
  if (typeof body.onboardingTemplate === "string") {
    await setSetting(
      SETTING_KEYS.ONBOARDING_TEMPLATE,
      body.onboardingTemplate,
    );
    changed.push("onboarding_persona_template");
  }
  if (
    body.onboardingTemplateByPlan &&
    typeof body.onboardingTemplateByPlan === "object"
  ) {
    await setOnboardingTemplateByPlan(body.onboardingTemplateByPlan);
    changed.push("onboarding_template_by_plan");
  }
  if (body.planFeatures && typeof body.planFeatures === "object") {
    // Le helper normalise les clés inconnues + fillna les manquantes.
    await setPlanFeatureMatrix(body.planFeatures);
    changed.push("plan_features");
  }
  if (body.planPricing && typeof body.planPricing === "object") {
    // normalizePlanPricing coerce/borne les montants + complète les manquants.
    await setPlanPricingMap(body.planPricing);
    changed.push("plan_pricing");
  }
  if (
    body.summaryPromptByPlan &&
    typeof body.summaryPromptByPlan === "object"
  ) {
    await setSummaryPromptByPlan(body.summaryPromptByPlan);
    changed.push("summary_prompt_by_plan");
  }
  if (
    body.spokenTimeDirectiveByPlan &&
    typeof body.spokenTimeDirectiveByPlan === "object"
  ) {
    await setSpokenTimeDirectiveByPlan(body.spokenTimeDirectiveByPlan);
    changed.push("spoken_time_directive_by_plan");
  }
  if (
    body.spokenPhoneDirectiveByPlan &&
    typeof body.spokenPhoneDirectiveByPlan === "object"
  ) {
    await setSpokenPhoneDirectiveByPlan(body.spokenPhoneDirectiveByPlan);
    changed.push("spoken_phone_directive_by_plan");
  }
  if (
    body.hangupDirectiveByPlan &&
    typeof body.hangupDirectiveByPlan === "object"
  ) {
    await setHangupDirectiveByPlan(body.hangupDirectiveByPlan);
    changed.push("hangup_directive_by_plan");
  }
  if (
    body.perCallContextTemplateByPlan &&
    typeof body.perCallContextTemplateByPlan === "object"
  ) {
    await setPerCallContextTemplateByPlan(body.perCallContextTemplateByPlan);
    changed.push("per_call_context_template_by_plan");
  }
  if (
    body.configBlocksDirectiveByPlan &&
    typeof body.configBlocksDirectiveByPlan === "object"
  ) {
    await setConfigBlocksDirectiveByPlan(body.configBlocksDirectiveByPlan);
    changed.push("config_blocks_directive_by_plan");
  }
  if (
    body.promptBlockOrderByPlan &&
    typeof body.promptBlockOrderByPlan === "object"
  ) {
    await setPromptBlockOrderByPlan(body.promptBlockOrderByPlan);
    changed.push("prompt_block_order_by_plan");
  }
  if (
    body.greetingFallbackTemplateByPlan &&
    typeof body.greetingFallbackTemplateByPlan === "object"
  ) {
    await setGreetingFallbackTemplateByPlan(
      body.greetingFallbackTemplateByPlan,
    );
    changed.push("greeting_fallback_template_by_plan");
  }

  if (changed.length > 0) {
    await logEvent({
      source: "web",
      event: "admin_settings_updated",
      message: `Admin ${me.email} a édité ${changed.join(", ")}`,
      userId: me.id,
      metadata: { keys: changed },
    });
  }

  return NextResponse.json({ ok: true });
}
