// Owner's morning WhatsApp digest — pure helpers (no I/O): which day,
// the message text, and whether to send at all.

export type DigestLang = "fr" | "he" | "en";

export interface DigestStats {
  calls: number;
  minutes: number; // rounded up
  bookings: number;
  messages: number;
  transfers: number;
}

const TZ = "Asia/Jerusalem";

/** Offset (ms) of Asia/Jerusalem from UTC at instant `d`. */
function tzOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Local midnight (Asia/Jerusalem) of the calendar day `YYYY-MM-DD`, as a UTC instant. */
function jerusalemMidnight(day: string): Date {
  const [y, m, dd] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, dd));
  // Two passes handle the DST switch days.
  let t = guess.getTime() - tzOffsetMs(guess);
  t = guess.getTime() - tzOffsetMs(new Date(t));
  return new Date(t);
}

/** Yesterday in Asia/Jerusalem: `day` (YYYY-MM-DD) and its [start, end) UTC window. */
export function yesterdayWindow(now: Date): { day: string; start: Date; end: Date } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now); // YYYY-MM-DD
  const [y, m, d] = today.split("-").map(Number);
  const yd = new Date(Date.UTC(y, m - 1, d - 1));
  const day = yd.toISOString().slice(0, 10);
  return { day, start: jerusalemMidnight(day), end: jerusalemMidnight(today) };
}

export function shouldSendDigest(stats: DigestStats): boolean {
  return stats.calls > 0;
}

function dayLabel(day: string, lang: DigestLang): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL" : lang === "en" ? "en-GB" : "fr-FR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Message body (the owner template's {{1}}). Plain text, no markdown. */
export function formatOwnerDigest(
  language: string,
  day: string,
  stats: DigestStats,
  opts: { businessName?: string; dashboardUrl?: string } = {},
): string {
  const lang: DigestLang = language === "he" ? "he" : language === "en" ? "en" : "fr";
  const label = dayLabel(day, lang);
  const biz = opts.businessName?.trim() ? ` — ${opts.businessName.trim()}` : "";
  const link = opts.dashboardUrl ? `\n\n${opts.dashboardUrl}` : "";
  const s = stats;
  if (lang === "he") {
    return [
      `☀️ סיכום אתמול (${label})${biz}`,
      `📞 שיחות: ${s.calls} (${s.minutes} דק׳)`,
      `📅 תורים שנקבעו: ${s.bookings}`,
      `✉️ הודעות לטיפול: ${s.messages}`,
      `↪️ שיחות שהועברו: ${s.transfers}`,
    ].join("\n") + link;
  }
  if (lang === "en") {
    return [
      `☀️ Yesterday (${label})${biz}`,
      `📞 Calls: ${s.calls} (${s.minutes} min)`,
      `📅 Bookings: ${s.bookings}`,
      `✉️ Messages to handle: ${s.messages}`,
      `↪️ Calls transferred: ${s.transfers}`,
    ].join("\n") + link;
  }
  return [
    `☀️ Bilan d'hier (${label})${biz}`,
    `📞 Appels : ${s.calls} (${s.minutes} min)`,
    `📅 RDV pris : ${s.bookings}`,
    `✉️ Messages à traiter : ${s.messages}`,
    `↪️ Appels transférés : ${s.transfers}`,
  ].join("\n") + link;
}
