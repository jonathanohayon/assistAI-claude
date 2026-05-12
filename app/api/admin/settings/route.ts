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
  getSetting,
  setSetting,
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
  const onboardingTemplate =
    (await getSetting(SETTING_KEYS.ONBOARDING_TEMPLATE)) ?? "";
  const planFeatures = await getPlanFeatureMatrix();
  return NextResponse.json({
    globalInstructions,
    onboardingTemplate,
    planFeatures,
  });
}

// PUT — update one or more settings.
export async function PUT(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    globalInstructions?: string;
    onboardingTemplate?: string;
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
  if (typeof body.onboardingTemplate === "string") {
    await setSetting(
      SETTING_KEYS.ONBOARDING_TEMPLATE,
      body.onboardingTemplate,
    );
    changed.push("onboarding_persona_template");
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
