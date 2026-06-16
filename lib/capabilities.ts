/**
 * Rendu du bloc "capacités" : substitue les placeholders {calendar}, {crm},
 * {orders} d'un template (éditable par plan depuis /admin) par le statut réel
 * du tenant (ACTIVÉE / DÉSACTIVÉE + consignes). Partagé par /api/agent/config
 * (prompt live) ET l'aperçu prompt (dashboard + admin) pour cohérence.
 */
export interface CapabilityFlags {
  calendar: boolean;
  crm: boolean;
  orders: boolean;
}

export function renderCapabilitiesDirective(
  template: string,
  flags: CapabilityFlags,
): string {
  const calendar = flags.calendar
    ? "ACTIVÉE."
    : "DÉSACTIVÉE — ne propose JAMAIS de rendez-vous et n'utilise aucun outil de calendrier.";
  const crm = flags.crm
    ? "ACTIVÉE."
    : "DÉSACTIVÉE — n'enregistre pas de fiche client.";
  const orders = flags.orders
    ? "ACTIVÉE — enregistre via record_order ; le numéro de l'appelant est rempli automatiquement, le nom est optionnel (suis ta persona pour savoir quoi demander)."
    : "DÉSACTIVÉE — ne prends pas de commande.";
  return template
    .replaceAll("{calendar}", calendar)
    .replaceAll("{crm}", crm)
    .replaceAll("{orders}", orders);
}
