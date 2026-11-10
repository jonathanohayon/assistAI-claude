// Outbound agents read the ACCOUNT's company sheet (Knowledge S5). Pure.
// SHIPPED OFF: the switch is server-side (env OUTBOUND_COMPANY_SHEET), never
// tenant-writable:
//   ""  (unset, default) → off for everyone = today's prompts, byte-identical
//   "all"                → on for every account
//   "<id>,<id>"          → on for these accounts only (Jonathan's campaign
//                          test call), off elsewhere
// On: the agent's knowledge block = the account sheet (identity, locations
// and hours, services and prices, rules, notes, FAQ) + the agent's own
// learned text, so a price or an hour is corrected in ONE place.

import type { CompanySheet } from "@/lib/knowledge/contract";

export function outboundSheetEnabled(accountId: string, env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.OUTBOUND_COMPANY_SHEET ?? "").trim();
  if (!v) return false;
  if (v.toLowerCase() === "all") return true;
  return v.split(",").map((x) => x.trim()).filter(Boolean).includes(accountId);
}

const DAYS: Array<[keyof CompanySheet["locations"][number]["hours"], string]> = [
  ["sun", "Dim"], ["mon", "Lun"], ["tue", "Mar"], ["wed", "Mer"], ["thu", "Jeu"], ["fri", "Ven"], ["sat", "Sam"],
];

/** The sheet as plain facts for an outbound call ('' when the sheet is empty). */
export function renderSheetForOutbound(s: CompanySheet): string {
  const parts: string[] = [];
  const id = s.identity;
  if (id.name || id.tagline || id.email) {
    parts.push(["ENTREPRISE :", id.name && `- Nom : ${id.name}`, id.tagline && `- Slogan : ${id.tagline}`, id.email && `- Email : ${id.email}`].filter(Boolean).join("\n"));
  }
  if (s.locations.length) {
    parts.push(
      `ÉTABLISSEMENTS (${s.locations.length}) :\n` +
        s.locations
          .map((l) => {
            const hours = DAYS.map(([d, label]) => `${label} ${l.hours[d].open ? `${l.hours[d].openTime}–${l.hours[d].closeTime}` : "fermé"}`).join(", ");
            return `- ${l.name}${l.address ? ` (${l.address})` : ""} : ${hours}`;
          })
          .join("\n"),
    );
  }
  if (s.locationRules.trim()) parts.push(`RÈGLES PAR ÉTABLISSEMENT :\n${s.locationRules.trim()}`);
  if (s.services.length) {
    const name = (lid: string) => s.locations.find((l) => l.id === lid)?.name;
    parts.push(
      `PRESTATIONS ET TARIFS (${s.services.length}) :\n` +
        s.services
          .map((x) => {
            const where = x.locationIds === "all" ? "" : ` — ${x.locationIds.map(name).filter(Boolean).join(", ") || "(aucun établissement)"}`;
            return `- ${x.name} : ${x.priceILS} ₪, ${x.durationMinutes} min${where}${x.description ? ` — ${x.description}` : ""}`;
          })
          .join("\n"),
    );
  }
  if (s.notes.trim()) parts.push(`NOTES :\n${s.notes.trim()}`);
  if (s.faq.length) parts.push(`QUESTIONS FRÉQUENTES :\n${s.faq.map((f) => `- Q : ${f.q}\n  R : ${f.a}`).join("\n")}`);
  return parts.join("\n\n");
}

/**
 * The knowledge text the outbound prompt embeds. `sheet` null (switch off)
 * → the agent's own text, unchanged.
 */
export function outboundKnowledgeText(agentText: string, sheet: CompanySheet | null): string {
  if (!sheet) return agentText;
  const facts = renderSheetForOutbound(sheet);
  if (!facts) return agentText;
  return agentText.trim() ? `${facts}\n\nCONNAISSANCES PROPRES À CET AGENT :\n${agentText.trim()}` : facts;
}
