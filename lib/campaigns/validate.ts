// Validation + normalisation des contacts importés. CLIENT-SAFE (réutilisé
// dans l'UI de preview ET dans les routes serveur d'import/insert).

import { normalizePhoneStrict } from "@/lib/phone-utils";

import {
  CALL_OUTCOMES,
  CAMPAIGN_STATUSES,
  CONTACT_STATUSES,
  DEFAULT_CALL_WINDOW,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY_RULES,
  EXTRACTION_FIELD_TYPES,
  GOAL_PRESETS,
  MAX_CONCURRENCY,
  type CallWindow,
  type CampaignStatus,
  type ContactStatus,
  type ExtractionField,
  type GoalPreset,
  type RetryRules,
} from "./constants";

// Re-export rétro-compatible : l'implémentation vit désormais dans
// lib/phone-utils.ts (source unique des 3 niveaux de normalisation).
export { normalizePhoneStrict as normalizePhone };

/** True si la saisie est normalisable en E.164 valide. */
export function isValidPhone(raw: string): boolean {
  return normalizePhoneStrict(raw) !== null;
}

export type RawContact = {
  phoneNumber: string;
  contactName?: string;
  vars?: Record<string, string>;
};

export type NormalizedContact = {
  phoneNumber: string;
  contactName: string;
  vars: Record<string, string>;
};

export type RejectedRow = { row: number; phone: string; reason: string };

// Valide + dédupe une liste de contacts bruts. Renvoie les lignes acceptées
// (normalisées) et les rejetées (avec la raison + l'index 1-based).
export function validateContacts(raw: RawContact[]): {
  accepted: NormalizedContact[];
  rejected: RejectedRow[];
} {
  const accepted: NormalizedContact[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  raw.forEach((c, i) => {
    const row = i + 1;
    const phone = normalizePhoneStrict(c.phoneNumber ?? "");
    if (!phone) {
      rejected.push({
        row,
        phone: c.phoneNumber ?? "",
        reason: "invalid_phone",
      });
      return;
    }
    if (seen.has(phone)) {
      rejected.push({ row, phone, reason: "duplicate" });
      return;
    }
    seen.add(phone);
    const vars: Record<string, string> = {};
    if (c.vars) {
      for (const [k, v] of Object.entries(c.vars)) {
        if (typeof v === "string" && v.trim()) vars[k] = v.trim();
      }
    }
    accepted.push({
      phoneNumber: phone,
      contactName: (c.contactName ?? "").trim().slice(0, 120),
      vars,
    });
  });

  return { accepted, rejected };
}

// ─── Normalisation des champs de campagne (côté serveur, anti-garbage) ──────

/** Preset d'objectif connu (GOAL_PRESETS) — sinon "custom". */
export function normalizeGoalPreset(v: unknown): GoalPreset {
  return GOAL_PRESETS.includes(v as GoalPreset) ? (v as GoalPreset) : "custom";
}

/** Statut de campagne connu (CAMPAIGN_STATUSES) — sinon "draft". */
export function normalizeStatus(v: unknown): CampaignStatus {
  return CAMPAIGN_STATUSES.includes(v as CampaignStatus)
    ? (v as CampaignStatus)
    : "draft";
}

/** Type guard : true si v est un statut de contact connu (CONTACT_STATUSES). */
export function isContactStatus(v: unknown): v is ContactStatus {
  return CONTACT_STATUSES.includes(v as ContactStatus);
}

/** Entier clampé dans [1, MAX_CONCURRENCY] — défaut DEFAULT_CONCURRENCY si non numérique. */
export function normalizeConcurrency(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(n, MAX_CONCURRENCY);
}

/** Règles de retry : maxAttempts ∈ [1, 5], backoffMinutes ∈ [1, 1440], retryOn ⊆ outcomes ≠ "connected". */
export function normalizeRetryRules(v: unknown): RetryRules {
  if (!v || typeof v !== "object") return { ...DEFAULT_RETRY_RULES };
  const r = v as Record<string, unknown>;
  const allowed = CALL_OUTCOMES.filter((o) => o !== "connected");
  const retryOn = Array.isArray(r.retryOn)
    ? (r.retryOn.filter((x) => allowed.includes(x as never)) as RetryRules["retryOn"])
    : [];
  const maxAttempts = Math.min(Math.max(Math.round(Number(r.maxAttempts) || 1), 1), 5);
  const backoffMinutes = Math.min(
    Math.max(Math.round(Number(r.backoffMinutes) || 60), 1),
    1440,
  );
  return { maxAttempts, retryOn, backoffMinutes };
}

/** Fenêtre d'appel : days ∈ [0, 6] dédupliqués, heures ∈ [0, 23], timezone ≤ 64 chars — défauts DEFAULT_CALL_WINDOW. */
export function normalizeCallWindow(v: unknown): CallWindow {
  if (!v || typeof v !== "object") return { ...DEFAULT_CALL_WINDOW };
  const w = v as Record<string, unknown>;
  const days = Array.isArray(w.days)
    ? Array.from(
        new Set(
          w.days
            .map((d) => Math.round(Number(d)))
            .filter((d) => d >= 0 && d <= 6),
        ),
      )
    : DEFAULT_CALL_WINDOW.days;
  const hour = (x: unknown, fallback: number) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
  };
  return {
    timezone:
      typeof w.timezone === "string" && w.timezone
        ? w.timezone.slice(0, 64)
        : DEFAULT_CALL_WINDOW.timezone,
    days: days.length ? days : DEFAULT_CALL_WINDOW.days,
    startHour: hour(w.startHour, DEFAULT_CALL_WINDOW.startHour),
    endHour: hour(w.endHour, DEFAULT_CALL_WINDOW.endHour),
    respectDnc: w.respectDnc !== false,
  };
}

/** Schéma d'extraction : ≤ 30 champs, key ≤ 60 chars, label ≤ 120, options enum ≤ 20 × 60 chars. */
export function normalizeExtractionSchema(v: unknown): ExtractionField[] {
  if (!Array.isArray(v)) return [];
  const out: ExtractionField[] = [];
  for (const item of v.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = typeof f.key === "string" ? f.key.trim().slice(0, 60) : "";
    if (!key) continue;
    const type = EXTRACTION_FIELD_TYPES.includes(f.type as never)
      ? (f.type as ExtractionField["type"])
      : "string";
    const field: ExtractionField = {
      key,
      label: typeof f.label === "string" && f.label ? f.label.slice(0, 120) : key,
      type,
    };
    if (type === "enum" && Array.isArray(f.options)) {
      field.options = f.options
        .filter((o): o is string => typeof o === "string" && !!o.trim())
        .map((o) => o.trim().slice(0, 60))
        .slice(0, 20);
    }
    if (f.required === true) field.required = true;
    out.push(field);
  }
  return out;
}
