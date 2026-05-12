// Persistance server-only de la matrice plan-features. Séparé de
// lib/plan-features.ts pour éviter que lib/db (postgres) ne soit pulled
// dans le bundle client de plan-features-form.tsx.

import {
  DEFAULT_MATRIX,
  normalizeMatrix,
  type PlanFeatureMatrix,
} from "@/lib/plan-features";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

export async function getPlanFeatureMatrix(): Promise<PlanFeatureMatrix> {
  const raw = await getSetting(SETTING_KEYS.PLAN_FEATURES);
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  try {
    return normalizeMatrix(JSON.parse(raw));
  } catch {
    // JSON corrompu — pas de log ici, le getter est appelé à chaque
    // requête API. On retombe silencieusement sur le défaut.
    return JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  }
}

export async function setPlanFeatureMatrix(
  matrix: PlanFeatureMatrix,
): Promise<void> {
  const normalized = normalizeMatrix(matrix);
  await setSetting(SETTING_KEYS.PLAN_FEATURES, JSON.stringify(normalized));
}
