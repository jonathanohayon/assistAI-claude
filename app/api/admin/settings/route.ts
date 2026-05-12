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
import {
  SETTING_KEYS,
  getGlobalInstructionsByPlan,
  getOnboardingTemplateByPlan,
  getSetting,
  setGlobalInstructionsByPlan,
  setOnboardingTemplateByPlan,
  setSetting,
  type GlobalInstructionsByPlan,
  type OnboardingTemplateByPlan,
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
  return NextResponse.json({
    globalInstructions,
    globalInstructionsByPlan,
    onboardingTemplate,
    onboardingTemplateByPlan,
    planFeatures,
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
