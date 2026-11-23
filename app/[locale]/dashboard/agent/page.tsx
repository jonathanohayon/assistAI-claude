import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { ProductTrialNote } from "@/components/dashboard/ProductTrialNote";
import { ConnectPreview } from "@/components/preview/ConnectPreview";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { loadProductPage } from "@/lib/product-gates";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { ConnectOwnedView } from "./connect-owned";

export const dynamic = "force-dynamic";

const MAIN = "mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8";

/**
 * Menu entry "Connecter votre agent" (connect): the customer's own agent.
 *   - Owned: the title, the running trial's line (F4), then "Votre agent IA"
 *     (ClientAgentBrick: the agent's address, its mode, secret and test, with
 *     its own save), shown only where CLIENT_AGENT is on for the account (read
 *     here on the server: isAdmin feeds that one boolean; the brick also
 *     follows the server's clientAgentTool.visible). Nothing else, for a
 *     tenant and an admin alike: the older "who answers" card is gone
 *     (founder, 23/11) and the agent's public URL card (AgentUrlCard) lives in
 *     Réglages, developer mode (/dashboard/settings#agent-url).
 *   - Not owned (menu preview): the product's header, then the client-agent
 *     brick read-only over sample data (ConnectPreview): no request at all.
 * Gate: a signed-in tenant (the brick's own APIs scope to the session).
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

  const isAdmin = await sessionIsAdmin();
  const t = await getTranslations({ locale, namespace: "DashboardNav" });

  return (
    <main className={MAIN}>
      <ConnectOwnedView
        title={t("connect")}
        trialNote={<ProductTrialNote trial={trials.connect} inline />}
        showClientAgent={clientAgentEnabled(clientAgentMode(), isAdmin)}
      />
    </main>
  );
}
