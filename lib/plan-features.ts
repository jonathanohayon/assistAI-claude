// Matrice "feature × plan" éditable par l'admin depuis Réglages partagés.
// Stockée en JSON dans app_settings(key='plan_features') pour éviter une
// migration DB juste pour 3 lignes × 4 colonnes.
//
// Source de vérité utilisée par :
//   - app/dashboard/_nav.tsx       (affichage onglets Calendrier/Contacts)
//   - app/api/agent/config         (worker reçoit `features` → expose tools)
//   - app/admin/plan-features-form (UI d'édition)
//
// Ajouter une nouvelle feature ici (+ la default) suffit — la matrice
// UI itère sur FEATURE_DEFS. Le worker ignore les clés inconnues.

import { PLANS, type PlanKey } from "@/lib/plans";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

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

function normalize(input: unknown): PlanFeatureMatrix {
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

export async function getPlanFeatureMatrix(): Promise<PlanFeatureMatrix> {
  const raw = await getSetting(SETTING_KEYS.PLAN_FEATURES);
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  try {
    return normalize(JSON.parse(raw));
  } catch {
    // JSON corrompu — log pas nécessaire ici, le getter est appelé à
    // chaque appel API. On retombe sur le défaut.
    return JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  }
}

export async function setPlanFeatureMatrix(
  matrix: PlanFeatureMatrix,
): Promise<void> {
  const normalized = normalize(matrix);
  await setSetting(SETTING_KEYS.PLAN_FEATURES, JSON.stringify(normalized));
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
