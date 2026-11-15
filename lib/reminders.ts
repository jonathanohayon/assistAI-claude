import { JERUSALEM_TZ } from "@/lib/tz";

// Rappel de RDV J-1 — utilitaires partagés par le cron
// /api/cron/appointment-reminders. WhatsApp uniquement (on ne capture que le
// téléphone du client). Les RDV vivent dans Google Calendar : on parse le
// contact + le centre depuis le summary/description de l'événement.

export type ReminderLang = "fr" | "he" | "en";

/** Normalise un numéro client en E.164 (heuristique Israël pour les locaux). */
export function normalizeClientPhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s()\-.]/g, "");
  if (s.startsWith("+")) return /^\+\d{8,15}$/.test(s) ? s : null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+972${s.slice(1)}`; // local IL → +972
  else s = `+${s}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/**
 * Extrait nom / téléphone / centre d'un événement Google Calendar produit par
 * /api/calendar/book. Summary = "RDV <centre> — <nom>", description contient
 * "Centre : ..." et "Tel : ...".
 */
export function parseEventContact(ev: {
  summary?: string | null;
  description?: string | null;
}): { name: string; phone: string | null; center: string } {
  const summary = ev.summary ?? "";
  const description = ev.description ?? "";

  // Nom : après le " — " du summary "RDV <centre> — <nom>".
  const nameMatch = summary.split(/—|–|-/).pop()?.trim() ?? "";
  const name = nameMatch && nameMatch !== summary ? nameMatch : "";

  const phoneMatch = description.match(
    /(?:tel|t[ée]l[ée]phone|phone)\s*[:：]\s*([+\d\s()\-.]+)/i,
  );
  const phone = phoneMatch ? normalizeClientPhone(phoneMatch[1]) : null;

  const centerMatch = description.match(/(?:centre|center)\s*[:：]\s*(.+)/i);
  const center = centerMatch ? centerMatch[1].trim() : "";

  return { name, phone, center };
}

/** Date "YYYY-MM-DD" → libellé localisé court (ex. "jeudi 12 juin"). */
export function formatDateLabel(date: string, lang: ReminderLang): string {
  const [Y, M, D] = date.split("-").map(Number);
  const localeTag = lang === "he" ? "he-IL" : lang === "en" ? "en-US" : "fr-FR";
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: JERUSALEM_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(Y, M - 1, D, 12)));
}

/** Texte du rappel (variable {{1}} du template WhatsApp). */
export function reminderText(
  lang: ReminderLang,
  opts: { name: string; dateLabel: string; time: string; center: string },
): string {
  const name = opts.name ? ` ${opts.name}` : "";
  const center = opts.center ? ` (${opts.center})` : "";
  if (lang === "he") {
    return `שלום${name}, תזכורת לתור שלך מחר ${opts.dateLabel} בשעה ${opts.time}${center}. נתראה! 😊`;
  }
  if (lang === "en") {
    return `Hi${name}, a friendly reminder of your appointment tomorrow ${opts.dateLabel} at ${opts.time}${center}. See you then! 😊`;
  }
  return `Bonjour${name}, petit rappel de votre rendez-vous demain ${opts.dateLabel} à ${opts.time}${center}. À demain ! 😊`;
}

/** One appointment of a number's day: its time ("HH:MM") and place. */
export interface ReminderSlot {
  time: string;
  center: string;
}

/** At most this many times are listed; the rest become "and N more". */
export const REMINDER_MAX_LISTED_SLOTS = 5;
/** Length cap of one place inside the list, and of the whole times label. */
export const REMINDER_CENTER_MAX = 60;
export const REMINDER_TIMES_LABEL_MAX = 300;

const LIST_LOCALE: Record<ReminderLang, string> = { fr: "fr-FR", en: "en-US", he: "he-IL" };

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function moreLabel(lang: ReminderLang, n: number): string {
  if (lang === "he") return `עוד ${n}`;
  if (lang === "en") return `${n} more`;
  return n > 1 ? `${n} autres` : "1 autre";
}

/**
 * Times of several appointments as one localised list, plus the place:
 * - same place for all (or none) → "10:00 et 15:30", place once at the end;
 * - different places → each time carries its own: "10:00 (A) et 15:30 (B)".
 * Lists at most REMINDER_MAX_LISTED_SLOTS times; the label is capped at
 * REMINDER_TIMES_LABEL_MAX chars. Conjunction from Intl.ListFormat
 * (fr "et", en "and", he "ו-").
 */
export function reminderTimesLabel(
  lang: ReminderLang,
  slots: ReminderSlot[],
): { times: string; center: string } {
  const centers = slots.map((s) => clip(s.center.trim(), REMINDER_CENTER_MAX));
  const sameCenter = centers.every((c) => c === centers[0]);
  const shown = slots.slice(0, REMINDER_MAX_LISTED_SLOTS).map((s, i) =>
    !sameCenter && centers[i] ? `${s.time} (${centers[i]})` : s.time,
  );
  const extra = slots.length - shown.length;
  if (extra > 0) shown.push(moreLabel(lang, extra));
  const times = new Intl.ListFormat(LIST_LOCALE[lang], { type: "conjunction" }).format(shown);
  return { times: clip(times, REMINDER_TIMES_LABEL_MAX), center: sameCenter ? centers[0] : "" };
}

/**
 * Reminder text for a number with SEVERAL appointments tomorrow (value of
 * the template variable {{1}}; the template itself is unchanged). One
 * appointment → use reminderText, unchanged.
 */
export function reminderTextMany(
  lang: ReminderLang,
  opts: { name: string; dateLabel: string; slots: ReminderSlot[] },
): string {
  const { times, center: c } = reminderTimesLabel(lang, opts.slots);
  const name = opts.name ? ` ${opts.name}` : "";
  const center = c ? ` (${c})` : "";
  if (lang === "he") {
    return `שלום${name}, תזכורת לתורים שלך מחר ${opts.dateLabel} בשעות ${times}${center}. נתראה! 😊`;
  }
  if (lang === "en") {
    return `Hi${name}, a friendly reminder of your appointments tomorrow ${opts.dateLabel} at ${times}${center}. See you then! 😊`;
  }
  return `Bonjour${name}, petit rappel de vos rendez-vous demain ${opts.dateLabel} à ${times}${center}. À demain ! 😊`;
}

/**
 * SID du template Twilio Content pour le rappel, par langue, avec fallback :
 * REMINDER_<LANG> → REMINDER → CLIENT_<LANG> → CLIENT (le template client
 * récap est déjà approuvé Meta et n'a qu'une variable libre {{1}} → réutilisable).
 */
export function resolveReminderTemplateSid(lang: ReminderLang): string | undefined {
  const L = lang.toUpperCase();
  return (
    process.env[`WHATSAPP_REMINDER_TEMPLATE_SID_${L}`] ||
    process.env.WHATSAPP_REMINDER_TEMPLATE_SID ||
    process.env[`WHATSAPP_CLIENT_TEMPLATE_SID_${L}`] ||
    process.env.WHATSAPP_CLIENT_TEMPLATE_SID ||
    undefined
  );
}
