"use client";

import { OutboundHome } from "./outbound-home";

/**
 * Hôte client de l'onglet « Appels sortants ». Rend l'accueil 2-boxes
 * (Agents | Campagnes), chacun ouvrant son workspace en mode page.
 */
export function CampaignsPageClient({
  asUserId,
  isAdmin = false,
  captureOn = false,
}: {
  asUserId?: string;
  isAdmin?: boolean;
  /** The server's CAMPAIGN_CAPTURE switch as one boolean (never the env name or value). */
  captureOn?: boolean;
}) {
  return <OutboundHome asUserId={asUserId} isAdmin={isAdmin} captureOn={captureOn} />;
}
