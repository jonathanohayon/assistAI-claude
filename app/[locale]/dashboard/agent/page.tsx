import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import NextLink from "next/link";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { ConnectPreview } from "@/components/preview/ConnectPreview";
import { Link } from "@/i18n/navigation";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { entryHref } from "@/lib/dashboard-nav";
import { loadProductPage } from "@/lib/product-gates";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

import { ConnectOwnedView } from "./connect-owned";

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
 *   - Owned: "Ask your agent" (ClientAgentBrick: the agent's
 *     address, its mode, secret and test, with its own save), shown only
 *     where CLIENT_AGENT is on for the account (read here on the server: one
 *     boolean decides; the brick also follows the server's
 *     clientAgentTool.visible); the agent's public URL for a voice client
 *     (AgentUrlCard, level-3). For an ADMIN only (decided here, on the
 *     server, with the same check as the agent-brain route: sessionIsAdmin),
 *     the older "who answers" card (AgentBrainSection) under the label
 *     "Réglage admin (ancien branchement)". A tenant's tree never holds it
 *     (VP, 23/11: one agent-address setting for a tenant).
 *   - Not owned (menu preview): the product's header, then the client-agent
 *     brick read-only over sample data (ConnectPreview): no request at all.
 * Gate: a signed-in tenant (the cards' own APIs scope to the session).
 */
export default async function ConnectPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const { menu, notifyRequested } = await loadProductPage(session.user.id);
  const state = menu.connect;
  if (state.state === "preview") {
    return (
      <main className={MAIN}>
        <ProductPreviewHeader entry="connect" cta={state.cta} notifyRequested={notifyRequested.includes("connect")} />
        <ConnectPreview />
      </main>
    );
  }

  const isAdmin = await sessionIsAdmin();
  const t = await getTranslations({ locale, namespace: "DashboardNav" });
  const tBrain = await getTranslations({ locale, namespace: "AgentBrain" });

  return (
    <main className={MAIN}>
      <ConnectOwnedView
        title={t("connect")}
        isAdmin={isAdmin}
        showClientAgent={clientAgentEnabled(clientAgentMode(), isAdmin)}
        adminBrain={
          isAdmin
            ? { label: tBrain("adminLabel"), title: tBrain("title"), desc: tBrain.rich("desc", { link: myAgentLink() }) }
            : null
        }
      />
    </main>
  );
}
