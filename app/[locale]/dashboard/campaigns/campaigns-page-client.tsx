"use client";

import { OutboundHome } from "./outbound-home";

/**
 * Hôte client de l'onglet « Appels sortants ». Rend l'accueil 2-boxes
 * (Agents | Campagnes), chacun ouvrant son workspace en mode page.
 */
export function CampaignsPageClient({ asUserId }: { asUserId?: string }) {
  return <OutboundHome asUserId={asUserId} />;
}
