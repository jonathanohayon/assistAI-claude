// Matrice "feature × plan" éditable par l'admin depuis Réglages partagés.
// CE FICHIER EST CLIENT-SAFE — aucune dépendance DB/server-only (cf. issue
// build : plan-features-form.tsx est "use client" et bundle ses imports).
// La persistance vit dans lib/plan-features-storage.ts (server-only).
//
// Ajouter une nouvelle feature ici (+ la default) suffit — la matrice
// UI itère sur FEATURE_DEFS. Le worker ignore les clés inconnues.

import { PLANS, type PlanKey } from "@/lib/plans";

export const FEATURE_DEFS = [
  {
    key: "calendar",
    label: "Calendrier",
    description:
      "Onglet Calendrier + tools agent : check_availability, book_appointment, find_appointment, cancel_appointment, reschedule_appointment.",
  },
  {
    key: "crm",
    label: "CRM / Contacts",
    description:
      "Onglet Contacts + tool save_contact + sync Google Sheet.",
  },
  {
    key: "whatsapp_confirm",
    label: "Confirmations WhatsApp",
    description:
      "Envoi auto de la confirmation WhatsApp à la cliente après book_appointment.",
  },
  {
    key: "whatsapp_recap",
    label: "Recap WhatsApp owner",
    description:
      "Recap d'appel envoyé au numéro WhatsApp owner après chaque conversation.",
  },
] as const;

export type FeatureKey = (typeof FEATURE_DEFS)[number]["key"];

export type PlanFeatures = Record<FeatureKey, boolean>;
export type PlanFeatureMatrix = Record<PlanKey, PlanFeatures>;

// Défaut conservateur : reproduit l'état actuel hard-codé (whatsapp = pas
// de calendar/crm, global+premium = tout). Sert de fallback si le setting
// n'a jamais été enregistré OU si le JSON stocké est corrompu.
export const DEFAULT_MATRIX: PlanFeatureMatrix = {
  whatsapp: {
    calendar: false,
    crm: false,
    whatsapp_confirm: true,
    whatsapp_recap: true,
  },
  global: {
    calendar: true,
    crm: true,
    whatsapp_confirm: true,
    whatsapp_recap: true,
  },
  premium: {
    calendar: true,
    crm: true,
    whatsapp_confirm: true,
    whatsapp_recap: true,
  },
};

export function normalizeMatrix(input: unknown): PlanFeatureMatrix {
  const out: PlanFeatureMatrix = JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  if (!input || typeof input !== "object") return out;
  const parsed = input as Partial<Record<PlanKey, Partial<PlanFeatures>>>;
  for (const plan of PLANS) {
    const stored = parsed[plan.key];
    if (!stored || typeof stored !== "object") continue;
    for (const def of FEATURE_DEFS) {
      const v = stored[def.key];
      if (typeof v === "boolean") {
        out[plan.key][def.key] = v;
      }
    }
  }
  return out;
}

// Helper côté consommateurs : récupère les features actives pour un plan
// donné (avec fallback défaut si plan inconnu — ex. legacy "essential"
// du seed admin → défaut le plus permissif = premium).
export function featuresForPlan(
  matrix: PlanFeatureMatrix,
  plan: string | null | undefined,
): PlanFeatures {
  if (plan && plan in matrix) return matrix[plan as PlanKey];
  return matrix.premium;
}
