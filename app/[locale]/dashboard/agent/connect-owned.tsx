import type { ReactNode } from "react";

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";

export type ConnectOwnedViewProps = {
  title: string;
  /** The active-trial line (F4), rendered under the title; null when no trial is running. */
  trialNote?: ReactNode;
  /** CLIENT_AGENT is on for this viewer (decided by the page on the server). */
  showClientAgent: boolean;
  /** Admin tenant view: the brick is scoped to this account. */
  asUserId?: string | null;
};

/**
 * "Connecter votre agent", owned. A server component (no "use client"): the
 * title, the running trial's line, and ONE agent-address setting, the "Votre
 * agent IA" brick (ClientAgentBrick). Nothing else, for a tenant and an admin
 * alike (founder, 23/11: the older "who answers" card is gone, and the
 * agent's public URL card lives in Réglages, developer mode). Rendered only
 * through ConnectPageContent (connect-view.tsx), which never mounts it without
 * the brick (lib/connect-page-view.ts).
 */
export function ConnectOwnedView({ title, trialNote, showClientAgent, asUserId = null }: ConnectOwnedViewProps) {
  return (
    <section className="mb-8 space-y-5">
      <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{title}</h1>
      {trialNote}
      {showClientAgent && <ClientAgentBrick asUserId={asUserId} />}
    </section>
  );
}
