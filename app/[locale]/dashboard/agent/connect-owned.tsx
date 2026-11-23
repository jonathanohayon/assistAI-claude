import type { ReactNode } from "react";

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";

import { AgentUrlCard } from "../settings/agent-url-section";

import { AdminBrainSectionLazy } from "./admin-brain-lazy";

/** The older "who answers" card's copy: built by the page for an admin only. */
export type AdminBrainCopy = { label: string; title: string; desc: ReactNode };

export type ConnectOwnedViewProps = {
  title: string;
  isAdmin: boolean;
  /** CLIENT_AGENT is on for this viewer (decided by the page on the server). */
  showClientAgent: boolean;
  /** null for a tenant: the older card is not in the tree at all. */
  adminBrain: AdminBrainCopy | null;
};

/**
 * "Connecter votre agent", owned. A server component (no "use client"): a
 * tenant gets ONE agent-address setting, the "Votre agent IA" brick
 * (ClientAgentBrick). The older "who answers" card (AgentBrainSection) is an
 * admin setting: it renders only when the page passes its copy, which the
 * page does for an admin session only, so a tenant's HTML and flight payload
 * never reference it, and its code is a dynamic chunk (admin-brain-lazy.tsx)
 * that a tenant's browser never fetches.
 */
export function ConnectOwnedView({ title, isAdmin, showClientAgent, adminBrain }: ConnectOwnedViewProps) {
  return (
    <section className="mb-8 space-y-5">
      <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{title}</h1>
      {showClientAgent && <ClientAgentBrick />}
      <AgentUrlCard isAdmin={isAdmin} />
      {adminBrain && <AdminBrainCard {...adminBrain} />}
    </section>
  );
}

/** The older card under its admin label (admins only, see ConnectOwnedView). */
export function AdminBrainCard({ label, title, desc }: AdminBrainCopy) {
  return (
    <div data-admin-brain="" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</p>
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-lg text-[var(--color-foreground)]">{title}</h2>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{desc}</p>
        <AdminBrainSectionLazy />
      </div>
    </div>
  );
}
