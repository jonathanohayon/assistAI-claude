import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { REALTIME_MODELS } from "@/lib/realtime";

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
          }}
          isAdmin={isAdmin}
          modelIds={isAdmin ? REALTIME_MODELS.map((m) => m.id) : undefined}
        />
      </section>
    </main>
  );
}
