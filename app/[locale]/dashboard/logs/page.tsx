import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { LogsView } from "./logs-view";

export const dynamic = "force-dynamic";

export default async function LogsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "DashboardLogs" });
  // Engine/model per call is admin-only (supplier names never reach tenants;
  // the events API strips that data for them too).
  const session = await auth();
  const [me] = session?.user?.id
    ? await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id)).limit(1)
    : [];
  const isAdmin = me?.role === "admin";

  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {t("subtitle")}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        <LogsView showEngine={isAdmin} />
      </section>
    </main>
  );
}
