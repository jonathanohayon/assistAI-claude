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
import { type BlockId } from "@/lib/agent-prompt-defaults";
import {
  SETTING_KEYS,
  getConfigBlocksDirective,
  getGlobalInstructionsByPlan,
  getHangupDirective,
  getOnboardingTemplateByPlan,
  getPerCallContextTemplate,
  getPromptBlockOrder,
  getSetting,
  getSpokenPhoneDirective,
  getSpokenTimeDirective,
  getSummaryPromptByPlan,
  setConfigBlocksDirective,
  setGlobalInstructionsByPlan,
  setHangupDirective,
  setOnboardingTemplateByPlan,
  setPerCallContextTemplate,
  setPromptBlockOrder,
  setSetting,
  setSpokenPhoneDirective,
  setSpokenTimeDirective,
  setSummaryPromptByPlan,
  type GlobalInstructionsByPlan,
  type OnboardingTemplateByPlan,
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
  const summaryPromptByPlan = await getSummaryPromptByPlan();
  const spokenTimeDirective = await getSpokenTimeDirective();
  const spokenPhoneDirective = await getSpokenPhoneDirective();
  const hangupDirective = await getHangupDirective();
  const perCallContextTemplate = await getPerCallContextTemplate();
  const configBlocksDirective = await getConfigBlocksDirective();
  const promptBlockOrder = await getPromptBlockOrder();
  return NextResponse.json({
    globalInstructions,
    globalInstructionsByPlan,
    onboardingTemplate,
    onboardingTemplateByPlan,
    planFeatures,
    summaryPromptByPlan,
    spokenTimeDirective,
    spokenPhoneDirective,
    hangupDirective,
    perCallContextTemplate,
    configBlocksDirective,
    promptBlockOrder,
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
    summaryPromptByPlan?: Partial<SummaryPromptByPlan>;
    spokenTimeDirective?: string;
    spokenPhoneDirective?: string;
    hangupDirective?: string;
    perCallContextTemplate?: string;
    configBlocksDirective?: string;
    promptBlockOrder?: BlockId[];
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
  if (
    body.summaryPromptByPlan &&
    typeof body.summaryPromptByPlan === "object"
  ) {
    await setSummaryPromptByPlan(body.summaryPromptByPlan);
    changed.push("summary_prompt_by_plan");
  }
  if (typeof body.spokenTimeDirective === "string") {
    await setSpokenTimeDirective(body.spokenTimeDirective);
    changed.push("spoken_time_directive");
  }
  if (typeof body.spokenPhoneDirective === "string") {
    await setSpokenPhoneDirective(body.spokenPhoneDirective);
    changed.push("spoken_phone_directive");
  }
  if (typeof body.hangupDirective === "string") {
    await setHangupDirective(body.hangupDirective);
    changed.push("hangup_directive");
  }
  if (typeof body.perCallContextTemplate === "string") {
    await setPerCallContextTemplate(body.perCallContextTemplate);
    changed.push("per_call_context_template");
  }
  if (typeof body.configBlocksDirective === "string") {
    await setConfigBlocksDirective(body.configBlocksDirective);
    changed.push("config_blocks_directive");
  }
  if (Array.isArray(body.promptBlockOrder)) {
    await setPromptBlockOrder(body.promptBlockOrder);
    changed.push("prompt_block_order");
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
