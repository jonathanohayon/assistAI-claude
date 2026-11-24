import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { ProductPreviewHeader, type TrialTerms } from "@/components/dashboard/ProductPreviewHeader";
import { ConnectPreview } from "@/components/preview/ConnectPreview";
import type { ConnectPageView } from "@/lib/connect-page-view";
import type { ConnectorsMount } from "@/lib/connectors/mount";
import type { TrialCtaTrial } from "@/lib/trial-cta";

import { ConnectOwnedView } from "./connect-owned";

export type ConnectPageContentProps = {
  /** lib/connect-page-view.ts connectPageView(...). */
  view: ConnectPageView;
  title: string;
  /** Owned only: the active-trial line (F4). */
  trialNote?: ReactNode;
  notifyRequested?: boolean;
  trial?: TrialCtaTrial;
  trialTerms?: TrialTerms;
  /** Admin tenant view: the header's POSTs carry ?asUserId; the list and its editor are scoped to it. */
  asUserId?: string | null;
  /** C1b: the owned view's connectors, read on the server (only when view.kind is "brick"). */
  connectors?: ConnectorsMount | null;
};

/**
 * The body of "Connecter vos agents", from the ONE decision of
 * lib/connect-page-view.ts: the owned view with the connectors list, or the closed
 * product's preview (header + sample brick), plus the admin line. Never a
 * title alone.
 */
export function ConnectPageContent({
  view,
  title,
  trialNote,
  notifyRequested = false,
  trial,
  trialTerms,
  asUserId = null,
  connectors = null,
}: ConnectPageContentProps) {
  const t = useTranslations("DashboardNav");
  if (view.kind === "brick")
    return <ConnectOwnedView title={title} trialNote={trialNote} showClientAgent asUserId={asUserId} connectors={connectors} />;
  return (
    <>
      <ProductPreviewHeader
        entry="connect"
        cta={view.cta}
        notifyRequested={notifyRequested}
        notify={view.notify}
        trial={trial}
        trialTerms={trialTerms}
        asUserId={asUserId}
      />
      {view.adminNote && (
        <p className="-mt-4 mb-6 text-sm text-[#475569]" data-admin-note="connect">
          {t("connectAdminClosed")}
        </p>
      )}
      <ConnectPreview />
    </>
  );
}
