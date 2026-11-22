import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import type { Door } from "@/lib/door-values";
import { seedForNewAccount } from "@/lib/neutral-seed";
import { type PlanKey } from "@/lib/plans";
import { TRIAL_CAPS_ENFORCED } from "@/lib/product-trial-caps";
import { signupDoorTrial } from "@/lib/product-trials";
import { insertProductTrial } from "@/lib/product-trials-start";
import type { AccountProductsRecord } from "@/lib/product-values";
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
  /**
   * The landing page's door (lib/door.ts), set ONCE here at account creation.
   * Omitted / null = NULL in the DB, read as "reception".
   */
  door?: Door | null;
}

/**
 * Cree un nouveau tenant : ligne `users` (trialing + plan + locale) puis
 * `agentConfigs` bootstrap avec la persona du PLAN choisi (cascade
 * admin-template par plan → persona hardcodee par plan). Factorise depuis le
 * server action signup classique ET le callback signIn Google pour garantir
 * un setup identique quel que soit le mode d'inscription.
 */
/** users.products written for every new account (P3). */
export const SIGNUP_PRODUCTS: AccountProductsRecord = { base: "reception_multi", addons: [] };

export async function provisionTenant(
  input: ProvisionTenantInput,
  /** Test seam: the env productTrialStartable reads (default process.env). */
  opts: { env?: Record<string, string | undefined> } = {},
) {
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
      door: input.door ?? null,
      // P3: every NEW account, whatever its door, starts on reception_multi
      // (what the trial rule granted before). Existing accounts are never
      // written: this is the only place users.products is set at sign-up.
      products: SIGNUP_PRODUCTS,
    })
    .returning();

  // P3: the door's product, when it is not reception, gets its per-product
  // trial (7 days / 30 min) — only if that trial is startable now (flag on
  // AND cap enforced). Otherwise no row: it stays "available" for later.
  const doorTrial = signupDoorTrial(input.door ?? null, opts.env ?? process.env, TRIAL_CAPS_ENFORCED);
  if (doorTrial) await insertProductTrial(created.id, doorTrial, new Date());

  // Bootstrap agent_config. Cascade: the admin's per-plan template/greeting
  // (/admin → Persona template) → else a NEUTRAL persona in the account's
  // language (lib/neutral-seed.ts: no customer's business fact — the
  // business reaches the agent through its own company sheet).
  const [templatesByPlan, greetingsByPlan] = await Promise.all([
    getOnboardingTemplateByPlan(),
    getOnboardingGreetingByPlan(),
  ]);
  const seed = seedForNewAccount(plan, locale, templatesByPlan, greetingsByPlan);

  await db.insert(agentConfigs).values({
    userId: created.id,
    instructions: seed.instructions,
    greetingInstructions: seed.greeting,
    primaryLanguage: seed.primaryLanguage,
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
