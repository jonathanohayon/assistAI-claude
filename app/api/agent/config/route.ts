import { NextRequest, NextResponse } from "next/server";

import { logEvent } from "@/lib/logger";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS, type PlanKey } from "@/lib/plans";
import { getGlobalInstructionsByPlan } from "@/lib/settings";
import {
  resolveDefaultTenant,
  resolveTenantByPhone,
} from "@/lib/tenant";

// Read-only endpoint consumed by the LiveKit agent worker at session start.
// Routes by `?phone=<called number>` to load the right tenant's config.
//
// Effective instructions = [global system prompt set by admin] + [tenant persona]
// — that way every tenant inherits cross-cutting rules (anti-silence, tool
// description, response length, etc.) without each having to re-paste them.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  // Inline resolution so we can log WHICH path was taken — silent fallback
  // to default tenant has burned us before (calendar tools used the wrong
  // user's Google credentials → "Google not connected" symptom).
  let tenant = phone ? await resolveTenantByPhone(phone) : null;
  const resolution: "phone_match" | "default_fallback" | "no_phone" =
    tenant ? "phone_match" : phone ? "default_fallback" : "no_phone";
  if (!tenant) tenant = await resolveDefaultTenant();
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 });
  }

  await logEvent({
    source: "tenant",
    event: "agent_config_loaded",
    message: `Config chargée pour ${tenant.user.email} via ${resolution} (called=${phone ?? "(none)"}, googleConnected=${Boolean(tenant.user.googleRefreshToken)})`,
    level: resolution === "phone_match" ? "info" : "warn",
    userId: tenant.user.id,
    metadata: {
      resolution,
      calledPhone: phone,
      hasGoogle: Boolean(tenant.user.googleRefreshToken),
      hasCalendarId: Boolean(tenant.user.googleCalendarId),
    },
  });

  const { config } = tenant;
  // Préfixe global per-plan : permet d'avoir des règles transverses
  // différentes selon Basique / Globale / Premium (ex. ton commercial
  // différent, mentions légales spécifiques). Fallback sur le préfixe du
  // plan whatsapp/Basique si plan inconnu (ex. legacy admin "essential").
  const globalByPlan = await getGlobalInstructionsByPlan();
  const planKey: PlanKey =
    tenant.user.subscriptionPlan &&
    PLANS.some((p) => p.key === tenant.user.subscriptionPlan)
      ? (tenant.user.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const globalInstructions = globalByPlan[planKey] ?? "";
  // Features activées pour le plan de ce tenant (matrice admin). Le worker
  // utilise cette map pour décider quels tools enregistrer (cf. recent
  // session : règles métier déterministes côté tools, pas dans le prompt).
  const planMatrix = await getPlanFeatureMatrix();
  const features = featuresForPlan(planMatrix, tenant.user.subscriptionPlan);

  const langLabel: Record<string, string> = {
    fr: "français",
    he: "hébreu",
    en: "anglais (US)",
  };
  const primary = config.primaryLanguage ?? "fr";
  const languageDirective = `LANGUE PAR DÉFAUT DU TENANT : ${langLabel[primary] ?? "français"} (code: ${primary}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que la cliente parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- Si elle bascule à une autre langue, suis-la immédiatement.`;

  const mergedInstructions = [globalInstructions, languageDirective, config.instructions]
    .filter(Boolean)
    .join("\n\n──────────────────────────────────────────\n\n");

  // Strip internal IDs — the agent only needs the runtime values.
  const { id: _id, userId: _userId, updatedAt, ...runtime } = config;
  void _id;
  void _userId;
  return NextResponse.json({
    ...runtime,
    instructions: mergedInstructions,
    features,
    updatedAt,
  });
}
