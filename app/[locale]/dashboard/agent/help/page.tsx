import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { AgentHelpView } from "./help-view";

export const dynamic = "force-dynamic";

const MAIN = "mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8";

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "AgentHelp" });
  return { title: t("title") };
}

/**
 * "Comment obtenir l'adresse de votre agent", under "Connecter votre agent"
 * (/dashboard/agent): same layout and the same gate as that page (a
 * signed-in account). The content never depends on a switch; only the test
 * area does: CLIENT_AGENT for this viewer, the same decision as the Connect
 * page's brick (clientAgentEnabled(clientAgentMode(), isAdmin)).
 */
export default async function AgentHelpPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const [isAdmin, [cfg]] = await Promise.all([
    sessionIsAdmin(),
    // The test question's language: the account's, as the test route picks it.
    db.select({ primaryLanguage: agentConfigs.primaryLanguage }).from(agentConfigs).where(eq(agentConfigs.userId, session.user.id)).limit(1),
  ]);
  return (
    <main className={MAIN}>
      <AgentHelpView locale={locale} testOpen={clientAgentEnabled(clientAgentMode(), isAdmin)} testLanguage={cfg?.primaryLanguage ?? null} />
    </main>
  );
}
