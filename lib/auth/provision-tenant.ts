import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { getInitialInstructionsForPlan } from "@/lib/initial-config";
import { type PlanKey } from "@/lib/plans";
import { getOnboardingTemplateByPlan } from "@/lib/settings";
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

  // passwordHash est notNull en DB. Pour un compte OAuth sans mot de passe on
  // stocke le hash d'un secret aleatoire jamais communique → bcrypt.compare
  // renverra toujours false cote Credentials, donc le login email/mdp reste
  // impossible tant que l'user n'a pas defini de mot de passe.
  const passwordHash =
    input.passwordHash ?? (await bcrypt.hash(randomUUID(), 12));

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
  const templatesByPlan = await getOnboardingTemplateByPlan();
  const defaults = getInitialInstructionsForPlan(plan);
  const adminTemplate = templatesByPlan[plan]?.trim() ?? "";
  const seedInstructions = adminTemplate || defaults.instructions;

  await db.insert(agentConfigs).values({
    userId: created.id,
    instructions: seedInstructions,
    greetingInstructions: defaults.greeting,
  });

  return created;
}
