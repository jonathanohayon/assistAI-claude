import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import NextLink from "next/link";

import { auth } from "@/auth";
import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { ProductTrialNote } from "@/components/dashboard/ProductTrialNote";
import { ConnectPreview } from "@/components/preview/ConnectPreview";
import { Link } from "@/i18n/navigation";
import { entryHref } from "@/lib/dashboard-nav";
import { loadProductPage } from "@/lib/product-gates";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { AgentBrainSection } from "../settings/agent-brain-section";
import { AgentUrlCard } from "../settings/agent-url-section";

export const dynamic = "force-dynamic";

const LINK = "font-medium text-[#be185d] underline underline-offset-2 hover:text-[#9d174d]";
const MAIN = "mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8";

/** "Mon agent" inside AgentBrain's line: the menu's own URL (admin view: /admin/users/<id>/my-agent). */
function myAgentLink(asUserId?: string | null) {
  const href = entryHref("myAgent", asUserId)!;
  function MyAgentLink(chunks: React.ReactNode) {
    return asUserId ? (
      <NextLink href={href} className={LINK}>
        {chunks}
      </NextLink>
    ) : (
      <Link href={href} className={LINK}>
        {chunks}
      </Link>
    );
  }
  return MyAgentLink;
}

/**
 * Menu entry "Connecter votre agent" (connect): the customer's own agent.
 *   - Owned: who answers (Tamara or the account's own agent) and its probe
 *     (AgentBrainSection); "Ask your agent" (ClientAgentBrick: the agent's
 *     address, its mode, secret and test, with its own save), shown only
 *     where CLIENT_AGENT is on for the account (read here on the server: one
 *     boolean decides; the brick also follows the server's
 *     clientAgentTool.visible); the agent's public URL for a voice client
 *     (AgentUrlCard, level-3).
 *   - Not owned (menu preview): the product's header, then the client-agent
 *     brick read-only over sample data (ConnectPreview): no request at all.
 * Gate: a signed-in tenant (the cards' own APIs scope to the session).
 */
export default async function ConnectPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const { menu, notifyRequested, trials, trialTerms } = await loadProductPage(session.user.id);
  const state = menu.connect;
  if (state.state === "preview") {
    return (
      <main className={MAIN}>
        <ProductPreviewHeader entry="connect" cta={state.cta} notifyRequested={notifyRequested.includes("connect")} trial={trials.connect} trialTerms={trialTerms} />
        <ConnectPreview />
      </main>
    );
  }

  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id)).limit(1);
  const isAdmin = me?.role === "admin";
  const t = await getTranslations({ locale, namespace: "DashboardNav" });
  const tBrain = await getTranslations({ locale, namespace: "AgentBrain" });

  return (
    <main className={MAIN}>
      <section className="mb-8 space-y-5">
        <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{t("connect")}</h1>
        <ProductTrialNote trial={trials.connect} inline />
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-display text-lg text-[var(--color-foreground)]">{tBrain("title")}</h2>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{tBrain.rich("desc", { link: myAgentLink() })}</p>
          <AgentBrainSection />
        </div>
        {clientAgentEnabled(clientAgentMode(), isAdmin) && <ClientAgentBrick />}
        <AgentUrlCard isAdmin={isAdmin} />
      </section>
    </main>
  );
}
