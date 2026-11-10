"use client";

import { OutboundHome } from "./outbound-home";

/**
 * Hôte client de l'onglet « Appels sortants ». Rend l'accueil 2-boxes
 * (Agents | Campagnes), chacun ouvrant son workspace en mode page.
 */
export function CampaignsPageClient({ asUserId, isAdmin = false }: { asUserId?: string; isAdmin?: boolean }) {
  return <OutboundHome asUserId={asUserId} isAdmin={isAdmin} />;
}
