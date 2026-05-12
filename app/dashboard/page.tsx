import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

import { ConfigForm } from "./config-form";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const isAdmin = me?.role === "admin";

  // Numéro Twilio principal du tenant — mis en avant en bandeau rose
  // gradient en haut du dashboard. Premier truc que le user voit après
  // login. Si pas de numéro (compte fraîchement créé pas encore en
  // onboarding/provision), on n'affiche pas la bannière du tout.
  const [primaryPhone] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);

  if (!config) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted-foreground)]">
          Aucune config trouvée. Lance{" "}
          <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-xs">
            npm run db:seed
          </code>{" "}
          pour initialiser ta secrétaire.
        </div>
      </main>
    );
  }

  return (
    <main>
      {primaryPhone?.phoneNumber && (
        <section className="mx-auto w-full max-w-5xl px-6 pt-8">
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500 via-fuchsia-500 to-rose-500 p-6 shadow-lg sm:p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
                  Votre numéro
                </p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
                  {primaryPhone.phoneNumber}
                </p>
                <p className="mt-2 text-xs text-white/90 sm:text-sm">
                  Appelez ce numéro pour tester votre assistante en direct.
                </p>
              </div>
              <a
                href={`tel:${primaryPhone.phoneNumber}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Appeler
              </a>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Configuration
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Donnez sa voix à votre secrétaire.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          Modifiez la persona, le ton et les paramètres techniques de l&apos;agent.
          Les changements s&apos;appliquent au prochain appel — l&apos;agent recharge la
          configuration en début de chaque session.
        </p>
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          Dernière mise à jour ·{" "}
          {new Date(config.updatedAt).toLocaleString("fr-FR", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        <ConfigForm
          initial={{
            instructions: config.instructions,
            greetingInstructions: config.greetingInstructions,
            model: config.model,
            voice: config.voice,
            temperature: config.temperature,
            speed: config.speed,
            maxResponseTokens: config.maxResponseTokens,
            ownerWhatsapp: config.ownerWhatsapp,
            primaryLanguage: config.primaryLanguage ?? "fr",
          }}
          isAdmin={isAdmin}
        />
      </section>
    </main>
  );
}
