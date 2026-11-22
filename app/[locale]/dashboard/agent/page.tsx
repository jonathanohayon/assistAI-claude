import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { TenantConfigPage } from "../config/config-page";
import { AgentBrainSection } from "../settings/agent-brain-section";
import { AgentUrlCard } from "../settings/agent-url-section";

export const dynamic = "force-dynamic";

/**
 * Menu entry "Votre agent" (connect): the customer's own agent. Its address
 * and its test, as they exist today:
 *   - who answers (Tamara or the account's own agent) and its probe
 *     (AgentBrainSection, formerly in the settings);
 *   - the agent's public URL for a voice client (AgentUrlCard, level-3,
 *     formerly in the settings);
 *   - "Ask your agent" (the row of the tools brick holding the agent's URL and
 *     its test): the tools tile, shown only where the screen shows that row
 *     (CLIENT_AGENT, read here on the server: one boolean decides).
 * Gate: a signed-in tenant (the cards' own APIs scope to the session).
 */
export default async function ConnectPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id)).limit(1);
  const isAdmin = me?.role === "admin";
  const t = await getTranslations({ locale, namespace: "DashboardNav" });
  const tBrain = await getTranslations({ locale, namespace: "AgentBrain" });

  const cards = (
    <section className="mb-8 space-y-5">
      <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{t("connect")}</h1>
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-lg text-[var(--color-foreground)]">{tBrain("title")}</h2>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{tBrain("desc")}</p>
        <AgentBrainSection />
      </div>
      <AgentUrlCard isAdmin={isAdmin} />
    </section>
  );

  if (clientAgentEnabled(clientAgentMode(), isAdmin)) {
    return <TenantConfigPage locale={locale} section="connect" before={cards} />;
  }
  return <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">{cards}</main>;
}
