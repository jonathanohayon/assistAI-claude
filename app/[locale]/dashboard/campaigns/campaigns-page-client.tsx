"use client";

import { useRouter } from "@/i18n/navigation";

import { CampaignsWorkspace } from "./campaigns-workspace";

/**
 * Hôte client de l'onglet « Appels sortants ». Rend le workspace campagnes en
 * mode page (inline sous la nav, sans backdrop). Le X / fermeture ramène vers
 * la config entrante (/dashboard).
 */
export function CampaignsPageClient({ asUserId }: { asUserId?: string }) {
  const router = useRouter();
  return (
    <CampaignsWorkspace
      open
      variant="page"
      asUserId={asUserId}
      onClose={() => router.push("/dashboard")}
    />
  );
}
