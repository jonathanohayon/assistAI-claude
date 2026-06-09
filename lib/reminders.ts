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
