/**
 * Petits helpers purs du formulaire de configuration (/dashboard) :
 * formatage prix/durée, labels des jours de la semaine (i18n), génération
 * d'IDs locaux, validation email/horaires, clone profond compatible.
 *
 * Utilisé par : voice-panel, business-panel, centres-section,
 * services-section, service-edit-modal (tous sous dashboard/config/).
 */

import type { DayHours, Translator, WeekDay } from "./types";

// Capitalize first letter for i18n key construction (key "vitesse" → "Vitesse").
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WEEKDAY_KEY: Record<WeekDay, { short: string; long: string }> = {
  sun: { short: "businessDaySunShort", long: "businessDaySunLong" },
  mon: { short: "businessDayMonShort", long: "businessDayMonLong" },
  tue: { short: "businessDayTueShort", long: "businessDayTueLong" },
  wed: { short: "businessDayWedShort", long: "businessDayWedLong" },
  thu: { short: "businessDayThuShort", long: "businessDayThuLong" },
  fri: { short: "businessDayFriShort", long: "businessDayFriLong" },
  sat: { short: "businessDaySatShort", long: "businessDaySatLong" },
};

/** Labels traduits (court + long) d'un jour de la semaine. */
export const weekdayLabel = (t: Translator, d: WeekDay) => ({
  short: t(WEEKDAY_KEY[d].short as Parameters<typeof t>[0]),
  long: t(WEEKDAY_KEY[d].long as Parameters<typeof t>[0]),
});

/** ID local unique pour un centre/soin créé côté client (ex. "ctr_…"). */
export const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Un jour fermé est toujours valide ; un jour ouvert doit avoir open < close. */
export const isHoursValid = (h: DayHours) => !h.open || h.openTime < h.closeTime;

export const formatPriceILS = (n: number) =>
  Number.isFinite(n) ? `${Math.round(n)} ₪` : "—";

export const formatDuration = (min: number) => {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}`;
};

/** structuredClone avec fallback JSON pour les environnements anciens. */
export function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
