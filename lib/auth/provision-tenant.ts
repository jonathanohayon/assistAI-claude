import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { getInitialInstructionsForPlan } from "@/lib/initial-config";
import { type PlanKey } from "@/lib/plans";
import {
  getOnboardingGreetingByPlan,
  getOnboardingTemplateByPlan,
} from "@/lib/settings";
import { computeTrialEndsAt } from "@/lib/trial";

interface ProvisionTenantInput {
  email: string;
  displayName: string;
  plan: PlanKey;
  locale: string;
  /** true pour les comptes OAuth (Google verifie deja l'email). */
  emailVerified: boolean;
  /**
   * Hash bcrypt pour le provider Credentials. Omis pour les comptes OAuth
   * sans mot de passe — un hash d'un secret aleatoire est alors stocke.
   */
  passwordHash?: string | null;
}

/**
 * Cree un nouveau tenant : ligne `users` (trialing + plan + locale) puis
 * `agentConfigs` bootstrap avec la persona du PLAN choisi (cascade
 * admin-template par plan → persona hardcodee par plan). Factorise depuis le
 * server action signup classique ET le callback signIn Google pour garantir
 * un setup identique quel que soit le mode d'inscription.
 */
export async function provisionTenant(input: ProvisionTenantInput) {
  const { email, displayName, plan, locale, emailVerified } = input;

  // passwordHash est notNull en DB. Pour un compte OAuth (Google) sans mot de
  // passe, on stocke la SENTINELLE "" — un marqueur explicite « aucun mot de
  // passe défini ». Ça permet de détecter de façon fiable un compte Google
  // (vs un compte email) pour afficher le bon message ("connectez-vous avec
  // Google") au lieu d'un "identifiants incorrects" trompeur. Le login
  // email/mdp reste impossible (authorize refuse explicitement passwordHash
  // vide) tant que l'user n'a pas défini de mot de passe (cf. /set-password).
  const passwordHash = input.passwordHash ?? "";

  // Free trial demarre a la creation, duree definie dans lib/trial.ts.
  const trialEndsAt = computeTrialEndsAt();

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      displayName,
      role: "user",
      subscriptionStatus: "trialing",
      subscriptionPlan: plan,
      trialEndsAt,
      emailVerified,
      locale,
    })
    .returning();

  // Bootstrap agent_config avec la persona du PLAN choisi.
  // Cascade : template/greeting admin per-plan (/admin → Persona template)
  // → sinon valeurs hardcodées per-plan de lib/initial-config.
  const [templatesByPlan, greetingsByPlan] = await Promise.all([
    getOnboardingTemplateByPlan(),
    getOnboardingGreetingByPlan(),
  ]);
  const defaults = getInitialInstructionsForPlan(plan);
  const adminTemplate = templatesByPlan[plan]?.trim() ?? "";
  const adminGreeting = greetingsByPlan[plan]?.trim() ?? "";
  const seedInstructions = adminTemplate || defaults.instructions;
  const seedGreeting = adminGreeting || defaults.greeting;

  await db.insert(agentConfigs).values({
    userId: created.id,
    instructions: seedInstructions,
    greetingInstructions: seedGreeting,
  });

  // The founder calls every new trial within 48 h (2026-11 plan): one
  // WhatsApp per signup (and email when Resend is set). Best-effort, never
  // blocks the signup; alertAdmins never throws.
  await alertAdmins({
    key: `trial_signup:${created.id}`,
    subject: "New trial signup",
    body: signupNotice({ email, displayName, plan, locale, trialEndsAt }),
    dedupMs: 365 * 24 * 3600_000,
  });

  return created;
}

/** Founder notification text for a new trial (internal, never shown to tenants). */
export function signupNotice(u: {
  email: string;
  displayName?: string | null;
  plan: string;
  locale?: string | null;
  trialEndsAt: Date;
}): string {
  return [
    `${u.displayName?.trim() || "(no name)"} <${u.email}>`,
    `Plan: ${u.plan} · language: ${u.locale ?? "?"}`,
    `Trial ends: ${u.trialEndsAt.toISOString().slice(0, 10)} (14 days / 100 min)`,
    "Call them within 48 h.",
  ].join("\n");
}
