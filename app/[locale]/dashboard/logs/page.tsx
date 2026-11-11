import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { CallsView } from "./calls-view";
import { DeveloperConsole } from "./developer-console";

export const dynamic = "force-dynamic";

// The tab is "Calls" (the route stays /dashboard/logs).
export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "DashboardLogs" });
  return { title: t("metaTitle") };
}

export default async function LogsPage() {
  const session = await auth();
  const [me] = session?.user?.id
    ? await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id)).limit(1)
    : [];
  const isAdmin = me?.role === "admin";

  return (
    <main>
      {/* The plain Calls view is the page's content (its title is the h1).
          The engineering console follows only in developer mode (admins
          always): see DeveloperConsole. */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-10 sm:px-6">
        <CallsView headingLevel={1} />
      </section>

      <div className="mx-auto w-full max-w-5xl px-6">
        <DeveloperConsole isAdmin={isAdmin} />
      </div>
    </main>
  );
}
