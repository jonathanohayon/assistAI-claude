import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { voicesFor } from "@/lib/realtime";

import { AdminTenantConfigForm } from "./tenant-config-form";

export const dynamic = "force-dynamic";

export default async function AdminTenantPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me || me.role !== "admin") redirect("/dashboard");

  const { userId } = await params;
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) {
    return (
      <main className="mx-auto w-full max-w-5xl p-12">
        <Link
          href="/admin"
          className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          ← Admin
        </Link>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Tenant introuvable.
        </div>
      </main>
    );
  }

  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  const phones = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId));

  async function handleLogout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const voices = cfg ? voicesFor(cfg.model) : [];

  return (
    <main className="min-h-screen">
      <IdleWatcher />
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <Link
              href="/admin"
              className="hidden text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:block"
            >
              ← Admin
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
              {me.email}
            </span>
            <form action={handleLogout}>
              <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Tenant
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {target.displayName || target.email}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
          <span>📧 {target.email}</span>
          <span>
            🛡 rôle :{" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {target.role}
            </span>
          </span>
          <span>
            📞 numéros :{" "}
            <span className="font-mono text-xs text-[var(--color-foreground)]">
              {phones.length === 0
                ? "(aucun)"
                : phones.map((p) => p.phoneNumber).join(", ")}
            </span>
          </span>
          <span>
            ⏳ statut : {target.subscriptionStatus}
            {target.trialEndsAt &&
              ` jusqu'au ${new Date(target.trialEndsAt).toLocaleDateString("fr-FR")}`}
          </span>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {cfg ? (
          <AdminTenantConfigForm
            userId={target.id}
            initial={{
              instructions: cfg.instructions,
              greetingInstructions: cfg.greetingInstructions,
              model: cfg.model,
              voice: cfg.voice,
              temperature: cfg.temperature,
              speed: cfg.speed,
              maxResponseTokens: cfg.maxResponseTokens,
              ownerWhatsapp: cfg.ownerWhatsapp,
              primaryLanguage: cfg.primaryLanguage ?? "fr",
            }}
            initialVoices={voices}
          />
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            Ce tenant n&apos;a pas encore de config agent.
          </div>
        )}
      </section>
    </main>
  );
}
