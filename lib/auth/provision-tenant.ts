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

  return created;
}
