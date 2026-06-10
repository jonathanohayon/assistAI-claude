// Persistance server-only de la matrice plan-features. Séparé de
// lib/plan-features.ts pour éviter que lib/db (postgres) ne soit pulled
// dans le bundle client de plan-features-form.tsx.

import {
  DEFAULT_MATRIX,
  normalizeMatrix,
  type PlanFeatureMatrix,
} from "@/lib/plan-features";
import { SETTING_KEYS, getJsonSetting, setSetting } from "@/lib/settings";

export async function getPlanFeatureMatrix(): Promise<PlanFeatureMatrix> {
  // getJsonSetting gère absent/corrompu → copie de DEFAULT_MATRIX.
  return getJsonSetting(SETTING_KEYS.PLAN_FEATURES, DEFAULT_MATRIX, normalizeMatrix);
}

export async function setPlanFeatureMatrix(
  matrix: PlanFeatureMatrix,
): Promise<void> {
  const normalized = normalizeMatrix(matrix);
  await setSetting(SETTING_KEYS.PLAN_FEATURES, JSON.stringify(normalized));
}
