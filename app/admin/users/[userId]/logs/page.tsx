import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import frMessages from "@/messages/fr.json";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { LogsView } from "@/app/[locale]/dashboard/logs/logs-view";

export const dynamic = "force-dynamic";

export default async function AdminTenantLogsPage({
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
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return (
      <main className="mx-auto w-full max-w-5xl p-12">
        <Link
          href={`/admin/users/${userId}`}
          className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          ← Tenant
        </Link>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Tenant introuvable.
        </div>
      </main>
    );
  }

  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <main>
        <section className="mx-auto w-full max-w-5xl px-6 pt-10">
          <Link
            href={`/admin/users/${userId}`}
            className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            ← {target.displayName || target.email}
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Admin · monitoring tenant
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            {target.displayName || target.email}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
            Logs et latence en temps réel — vue identique au monitoring du
            tenant, scopée sur son user_id côté API.
          </p>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
          <LogsView asUserId={target.id} />
        </section>
      </main>
    </NextIntlClientProvider>
  );
}
