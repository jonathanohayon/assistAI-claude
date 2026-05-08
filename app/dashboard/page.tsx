import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { REALTIME_MODELS, voicesFor } from "@/lib/realtime";

import { ConfigForm } from "./config-form";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  if (!config) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
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

  const modelIds = REALTIME_MODELS.map((m) => m.id);
  const voices = voicesFor(config.model);

  async function handleLogout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <p className="hidden text-sm text-[var(--color-muted-foreground)] sm:block">
              Configuration de la secrétaire
            </p>
          </div>
          <div className="flex items-center gap-3">
            {me?.role === "admin" && (
              <Link
                href="/admin"
                className="hidden rounded-full bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 sm:inline-flex"
              >
                Admin
              </Link>
            )}
            <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
              {session.user.email}
            </span>
            <form action={handleLogout}>
              <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Page hero */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Dashboard
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

      {/* Form */}
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
          modelIds={modelIds}
          initialVoices={voices}
        />
      </section>
    </main>
  );
}
