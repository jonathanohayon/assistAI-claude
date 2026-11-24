import type { ReactNode } from "react";

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { ConnectorsPanel } from "@/components/connectors/ConnectorsPanel";
import type { ConnectorsMount } from "@/lib/connectors/mount";

export type ConnectOwnedViewProps = {
  title: string;
  /** The active-trial line (F4), rendered under the title; null when no trial is running. */
  trialNote?: ReactNode;
  /** CLIENT_AGENT is on for this viewer (decided by the page on the server). */
  showClientAgent: boolean;
  /** Admin tenant view: the list and its editor are scoped to this account. */
  asUserId?: string | null;
  /**
   * C1b: the account's connectors (lib/connectors/mount.ts, read on the
   * server). null = not read (the account vanished): today's brick alone.
   */
  connectors?: ConnectorsMount | null;
};

/**
 * "Connecter vos agents", owned. A server component (no "use client"): the
 * title, the running trial's line, then the account's connectors list
 * (C1b, ConnectorsPanel): the derived legacy card or the empty card, whose
 * "Modifier" / "Commencer" open today's "Votre agent IA" editor
 * (ClientAgentBrick) in place. Nothing else, for a tenant and an admin alike
 * (founder, 23/11: the agent's public URL card lives in Réglages). Rendered
 * only through ConnectPageContent (connect-view.tsx), which mounts it only
 * when the brick can show (lib/connect-page-view.ts).
 */
export function ConnectOwnedView({ title, trialNote, showClientAgent, asUserId = null, connectors = null }: ConnectOwnedViewProps) {
  return (
    <section className="mb-8 space-y-5">
      <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{title}</h1>
      {trialNote}
      {showClientAgent &&
        (connectors ? (
          <ConnectorsPanel
            page={connectors.page}
            extraPrice={connectors.extraPrice}
            basePrice={connectors.basePrice}
            now={connectors.now}
            asUserId={asUserId}
          />
        ) : (
          <ClientAgentBrick asUserId={asUserId} />
        ))}
    </section>
  );
}
