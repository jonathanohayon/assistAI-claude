export const JERUSALEM_TZ = "Asia/Jerusalem";

/**
 * Convert a wall-clock date/time in Asia/Jerusalem to a UTC ISO string,
 * regardless of the host machine's TZ. Handles DST.
 */
export function jerusalemToUTCISO(date: string, time: string): string {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m, s = 0] = time.split(":").map(Number);

  const asIfUTC = Date.UTC(Y, M - 1, D, h, m, s);

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(asIfUTC)).map((p) => [p.type, p.value]),
  );
  const reinterpreted = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour === 24 ? 0 : +parts.hour,
    +parts.minute,
    +parts.second,
  );
  const offsetMs = reinterpreted - asIfUTC;

  return new Date(asIfUTC - offsetMs).toISOString();
}

/**
 * Date du jour (en Asia/Jerusalem) décalée de `dayOffset` jours, au format
 * "YYYY-MM-DD". dayOffset=1 → demain à Jérusalem, indépendamment du TZ machine.
 */
export function jerusalemDateOffset(dayOffset: number): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → "YYYY-MM-DD". On part de la date du jour à Jérusalem.
  const today = dtf.format(new Date());
  const [Y, M, D] = today.split("-").map(Number);
  const shifted = new Date(Date.UTC(Y, M - 1, D + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

/** Add `minutes` to a Jerusalem wall-clock date+time, returning new wall-clock parts. */
export function addMinutesJerusalem(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m] = time.split(":").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D, h, m + minutes));
  return {
    date: dt.toISOString().slice(0, 10),
    time: dt.toISOString().slice(11, 16),
  };
}
