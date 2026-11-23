import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductTrialNote } from "@/components/dashboard/ProductTrialNote";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { connectPageView } from "@/lib/connect-page-view";
import { loadProductPage } from "@/lib/product-gates";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { ConnectPageContent } from "./connect-view";

export const dynamic = "force-dynamic";

const MAIN = "mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8";

/**
 * Menu entry "Connecter votre agent" (connect): the customer's own agent.
 * What it shows is ONE decision (lib/connect-page-view.ts), from the menu
 * state, whether CLIENT_AGENT lets the "Votre agent IA" brick show for the
 * account (read here on the server), and whether the viewer is an admin:
 *   - brick: owned AND the brick can show: the title, the running trial's
 *     line (F4), then ClientAgentBrick (the agent's address, its mode, secret
 *     and test, with its own save). Nothing else, for a tenant and an admin
 *     alike (founder, 23/11; the public URL card lives in Réglages).
 *   - preview: anything else, including owned while the brick can't show (an
 *     admin owns every entry, even with CLIENT_AGENT unset): the product's
 *     header, then the client-agent brick read-only over sample data
 *     (ConnectPreview), no request at all. An admin gets no "Prévenez-moi"
 *     and one line saying when the card shows. Never a title alone.
 * Gate: a signed-in tenant (the brick's own APIs scope to the session).
 */
export default async function ConnectPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const { menu, notifyRequested, trials, trialTerms } = await loadProductPage(session.user.id);
  const isAdmin = await sessionIsAdmin();
  const t = await getTranslations({ locale, namespace: "DashboardNav" });
  const view = connectPageView({
    menu: menu.connect,
    showClientAgent: clientAgentEnabled(clientAgentMode(), isAdmin),
    isAdmin,
  });

  return (
    <main className={MAIN}>
      <ConnectPageContent
        view={view}
        title={t("connect")}
        trialNote={<ProductTrialNote trial={trials.connect} inline />}
        notifyRequested={notifyRequested.includes("connect")}
        trial={trials.connect}
        trialTerms={trialTerms}
      />
    </main>
  );
}
