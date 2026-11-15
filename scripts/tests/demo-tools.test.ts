// lib/demo-tools.ts: the home demo's canned tool answers, and the demo
// session's route table that points at them. Mock values only.
// Run with:  npx tsx scripts/tests/demo-tools.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEMO_TOOL_ROUTES, demoSessionResponse, demoToolRoutes } from "../../lib/demo-session";
import {
  DEMO_LANGS,
  DEMO_OPEN_DAYS,
  DEMO_PLACE,
  DEMO_SLOTS,
  DEMO_TOOL_NAMES,
  DEMO_TOOLS_BASE,
  DEMO_TOOLS_GLOBAL,
  DEMO_TOOLS_PER_IP,
  cannedSlots,
  demoDateText,
  demoEndpointText,
  demoLang,
  demoTimeText,
  demoWeekday,
  isDemoToolName,
  jerusalemDateAt,
  runDemoTool,
} from "../../lib/demo-tools";
import { CENTERS, labelFor } from "../../lib/schedule";
import { jerusalemToUTCISO } from "../../lib/tz";
import { REPO_ROOT } from "./helpers/source-scan";

const ROOT = REPO_ROOT;
const at = (date: string, time: string) => new Date(jerusalemToUTCISO(date, `${time}:00`)).getTime();
const slotsOf = (r: { body: Record<string, unknown> }) => r.body.available_slots as string[];

// No network during any canned answer: a Google or DB call would go through fetch or a socket.
let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  return new Response("{}");
}) as typeof fetch;

// Every answer produced below, for the "no real business" scan (section 12).
const answers: unknown[] = [];
const run = (...a: Parameters<typeof runDemoTool>) => {
  const r = runDemoTool(...a);
  answers.push(r);
  return r;
};

// Fixed clock: Wednesday 2026-11-11, 10:00 in Asia/Jerusalem.
const NOW = at("2026-11-11", "10:00");
assert.equal(jerusalemDateAt(NOW), "2026-11-11");

// 1. Availability: shape of a day with slots, the legacy demo field names,
// with the one fictional place as values.
for (const lang of DEMO_LANGS) {
  const a = run("check_availability", { date: "2026-11-12" }, NOW, lang); // Thursday: open everywhere
  assert.equal(a.status, 200);
  assert.deepEqual(Object.keys(a.body).sort(), ["available_slots", "center", "date", "label"]);
  assert.equal(a.body.date, "2026-11-12");
  assert.equal(a.body.center, "demo_salon");
  assert.equal(a.body.label, DEMO_PLACE[lang]);
  assert.deepEqual(a.body.available_slots, [...DEMO_SLOTS]);
  // Deterministic for a fixed clock.
  assert.deepEqual(runDemoTool("check_availability", { date: "2026-11-12" }, NOW, lang), a);
}
assert.equal(DEMO_PLACE.fr, "notre salon du centre-ville");
assert.equal(DEMO_PLACE.en, "our downtown salon");
assert.equal(DEMO_PLACE.he, "הסלון שלנו במרכז העיר");

// 2. The working week follows the language: Friday open in fr/en, closed in
// he; Sunday the reverse. Saturday closed everywhere.
const FRIDAY = "2026-11-13";
const SATURDAY = "2026-11-14";
const SUNDAY = "2026-11-15";
for (const lang of ["fr", "en"] as const) {
  assert.deepEqual(slotsOf(run("check_availability", { date: FRIDAY }, NOW, lang)), [...DEMO_SLOTS], `${lang} Friday`);
  assert.deepEqual(slotsOf(run("check_availability", { date: SUNDAY }, NOW, lang)), [], `${lang} Sunday`);
}
assert.deepEqual(slotsOf(run("check_availability", { date: FRIDAY }, NOW, "he")), [], "he Friday");
assert.deepEqual(slotsOf(run("check_availability", { date: SUNDAY }, NOW, "he")), [...DEMO_SLOTS], "he Sunday");
for (const lang of DEMO_LANGS) assert.deepEqual(slotsOf(run("check_availability", { date: SATURDAY }, NOW, lang)), []);
// Unknown or missing language: French.
assert.equal(demoLang("de"), "fr");
assert.equal(demoLang(null), "fr");
assert.equal(demoLang("he"), "he");
assert.deepEqual(runDemoTool("check_availability", { date: FRIDAY }, NOW, "xx"), runDemoTool("check_availability", { date: FRIDAY }, NOW, "fr"));
assert.deepEqual(runDemoTool("check_availability", { date: FRIDAY }, NOW), runDemoTool("check_availability", { date: FRIDAY }, NOW, "fr"));

// 3. Today: a slot starting within 30 min is hidden, a past one too.
assert.deepEqual(cannedSlots("2026-11-11", 30, NOW), ["11:30", "15:00"]);
assert.deepEqual(cannedSlots("2026-11-11", 30, at("2026-11-11", "11:01")), ["15:00"]);
assert.deepEqual(cannedSlots("2026-11-11", 30, at("2026-11-11", "14:31")), []);

// 4. No slot left: same shape plus reason and suggested_dates ({ date, weekday }),
// the next open days of the visitor's week.
{
  const closed = run("check_availability", { date: SATURDAY }, NOW, "fr");
  assert.equal(closed.status, 200);
  assert.deepEqual(Object.keys(closed.body).sort(), ["available_slots", "center", "date", "label", "reason", "suggested_dates"]);
  assert.equal(typeof closed.body.reason, "string");
  assert.deepEqual(closed.body.suggested_dates, [
    { date: "2026-11-16", weekday: "lundi" },
    { date: "2026-11-17", weekday: "mardi" },
    { date: "2026-11-18", weekday: "mercredi" },
  ]);
  assert.deepEqual((run("check_availability", { date: SATURDAY }, NOW, "en").body.suggested_dates as { weekday: string }[]).map((d) => d.weekday), [
    "Monday",
    "Tuesday",
    "Wednesday",
  ]);
  const closedHe = run("check_availability", { date: FRIDAY }, NOW, "he");
  assert.deepEqual(
    (closedHe.body.suggested_dates as { date: string }[]).map((d) => d.date),
    ["2026-11-15", "2026-11-16", "2026-11-17"],
  );
  // A past date suggests from today on, never before.
  const past = run("check_availability", { date: "2026-11-02" }, NOW, "fr");
  assert.deepEqual(past.body.available_slots, []);
  assert.deepEqual(
    (past.body.suggested_dates as { date: string }[]).map((d) => d.date),
    ["2026-11-12", "2026-11-13", "2026-11-16"],
  );
}

// 5. Never in the past, whatever the clock, the date and the language (and only open days).
for (let i = 0; i < 2000; i++) {
  const lang = DEMO_LANGS[i % 3]!;
  const now = at("2026-01-01", "00:00") + Math.floor((i * 791_935_123) % (400 * 86_400_000));
  const day = new Date(now + ((i % 21) - 7) * 86_400_000).toISOString().slice(0, 10);
  const r = run("check_availability", { date: day }, now, lang);
  for (const t of slotsOf(r)) {
    assert.ok(at(day, t) > now, `${day} ${t} is in the past at ${new Date(now).toISOString()}`);
  }
  if (slotsOf(r).length > 0) {
    assert.ok(DEMO_OPEN_DAYS[lang].includes(new Date(`${day}T00:00:00Z`).getUTCDay()), `${day} is not an open day in ${lang}`);
  }
  for (const s of (r.body.suggested_dates as { date: string }[] | undefined) ?? []) {
    assert.ok(s.date >= jerusalemDateAt(now), `suggested ${s.date} before today`);
  }
}

// 6. Duration: the service must end by 18:00; none fits → no suggestion either.
assert.deepEqual(cannedSlots("2026-11-12", 240, NOW), ["10:00", "11:30"]);
assert.deepEqual(runDemoTool("check_availability", { date: "2026-11-12", duration: 600 }, NOW).body.suggested_dates, []);

// 7. Availability errors: { error } with a 400, as the legacy route.
for (const args of [{}, { date: "" }, { date: "tomorrow" }, { date: "2026-02-31" }, null, "x"]) {
  const r = run("check_availability", args, NOW);
  assert.equal(r.status, 400, JSON.stringify(args));
  assert.deepEqual(Object.keys(r.body), ["error"]);
}

// 8. Booking: the legacy demo confirmation, at the fictional place, nothing stored.
for (const lang of DEMO_LANGS) {
  const b = run(
    "book_appointment",
    { name: "Mock Client", phone: "+15555550100", date: "2026-11-12", time: "11:30", duration: 30, center: "ashdod" },
    NOW,
    lang,
  );
  assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(b.body).sort(), ["center", "simulated", "success", "summary"]);
  assert.equal(b.body.success, true);
  assert.equal(b.body.simulated, true);
  assert.equal(b.body.center, "demo_salon");
  assert.equal(typeof b.body.summary, "string");
  assert.ok((b.body.summary as string).includes("Mock Client"), lang);
}
// Invalid request, past slot: { error } with a 400.
assert.equal(run("book_appointment", { name: "Mock", date: "2026-11-12", time: "11:30" }, NOW).status, 400);
assert.equal(run("book_appointment", { name: "Mock", phone: "1", date: "2026-11-12", time: "25:00" }, NOW).status, 400);
{
  const past = run("book_appointment", { name: "Mock", phone: "1", date: "2026-11-10", time: "10:00" }, NOW);
  assert.equal(past.status, 400);
  assert.equal(past.body.error, "Le créneau du mardi 10 novembre à 10h est déjà passé. Propose un horaire à venir.");
}

// 9. Contact: acknowledged, nothing stored.
assert.deepEqual(run("save_contact", { name: "Mock Client", phone: "+15555550100", notes: "mock" }, NOW), {
  status: 200,
  body: { success: true, simulated: true },
});
assert.equal(run("save_contact", { name: "Mock Client" }, NOW).status, 400);

assert.equal(fetches, 0, "a canned answer made a network call");

// 10. The demo session's route table points only at the demo endpoint, with
// the server-chosen language in the query.
for (const lang of [...DEMO_LANGS, "de", undefined]) {
  const table = demoToolRoutes(lang);
  const expected = demoLang(lang);
  for (const [name, route] of Object.entries(table)) {
    if (!("endpoint" in route)) {
      assert.equal(name, "end_call");
      continue;
    }
    assert.equal(route.endpoint, `${DEMO_TOOLS_BASE}/${name}?lang=${expected}`, `${name} ${String(lang)}`);
    assert.ok(isDemoToolName(name), name);
    assert.doesNotMatch(route.endpoint, /\/api\/(calendar|sheets)\//, name);
  }
  assert.deepEqual(Object.keys(table).filter((n) => n !== "end_call").sort(), [...DEMO_TOOL_NAMES].sort());
  const out = demoSessionResponse({ value: "ek_mock" }, { webrtcUrl: "u", model: "m", transport: "webrtc", lang });
  assert.deepEqual(out?.tools, table);
}
assert.deepEqual(DEMO_TOOL_ROUTES, demoToolRoutes("fr"));
assert.ok(existsSync(join(ROOT, "app/api/demo/tools/[tool]/route.ts")), "the endpoint the table points at exists");
assert.ok(DEMO_TOOLS_PER_IP > 0 && DEMO_TOOLS_GLOBAL >= DEMO_TOOLS_PER_IP);
// /api/session hands the page's language to the table.
assert.match(read("app/api/session/route.ts"), /demoSessionResponse\([\s\S]*?lang: body\.primaryLanguage/);

// 11. Import guard: lib/demo-tools.ts and everything it imports (transitively)
// reach no Google client, no DB, no logger.
const FORBIDDEN = /(^|\/)(google|db|logger|rate-limit-db)(\.ts)?$|googleapis|drizzle|postgres|next-auth|^@\/auth$/;
function read(p: string) {
  return readFileSync(join(ROOT, p), "utf8");
}
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g), ...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}
function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && c.match(/\.tsx?$/)) return c;
  return null;
}
{
  const seen = new Set<string>();
  const queue = [join(ROOT, "lib/demo-tools.ts")];
  const all: string[] = [];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(f)) {
      all.push(spec);
      const local = resolveLocal(spec, f);
      if (local) queue.push(local);
      else assert.ok(!spec.startsWith("@/") && !spec.startsWith("."), `unresolved import ${spec} in ${f}`);
    }
  }
  assert.ok(seen.size > 1, "the scan followed the imports");
  const bad = all.filter((s) => FORBIDDEN.test(s));
  assert.deepEqual(bad, [], `lib/demo-tools.ts reaches ${bad.join(", ")}`);
  // Only node-free, provider-free modules: every bare import is forbidden.
  assert.deepEqual(all.filter((s) => !s.startsWith("@/") && !s.startsWith(".")), []);
}

// 12. No real business in any answer: no centre id or town name from lib/schedule.
{
  const text = JSON.stringify(answers).toLowerCase();
  assert.ok(answers.length > 30, "the scan covers the answers above");
  const towns = [...CENTERS, ...CENTERS.map(labelFor), "jerusalem", "ירושלים", "אשדוד", "נתניה", "netanya"];
  for (const t of towns) assert.ok(!text.includes(t.toLowerCase()), `an answer names "${t}"`);
}

// 13. The endpoint resolves no caller: no session, no Google, so a signed-in
// visitor gets the same canned answers as an anonymous one.
{
  const route = read("app/api/demo/tools/[tool]/route.ts");
  const specs = importsOf(join(ROOT, "app/api/demo/tools/[tool]/route.ts"));
  assert.deepEqual(specs.filter((s) => /google|@\/auth$|lib\/db$|lib\/tenant/.test(s)), []);
  assert.doesNotMatch(route, /\bauth\(|resolveAgentCallerGoogle|getCalendar|getSheets/);
  assert.match(route, /consumeRateLimit\(/, "the public endpoint is rate limited");
  assert.match(route, /searchParams\.get\("lang"\)/, "the endpoint reads the table's language");
}

// 14. Every text the model reads is in the visitor's language, with dates and
// times written for the locale; field names and value types stay the same.
{
  type Body = Record<string, unknown>;
  const typesOf = (b: Body) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Array.isArray(v) ? "array" : typeof v]));
  const call = (name: Parameters<typeof runDemoTool>[0], args: unknown, lang: string, now = NOW) =>
    run(name, args, now, lang).body;
  const BOOK = { name: "Mock Client", phone: "+15555550100", date: "2026-11-12", time: "11:30", duration: 30 };

  // Every reachable text, per language (the endpoint's own 404/429 included).
  const texts = (lang: string) => {
    const t = demoEndpointText(lang);
    return {
      dateRequired: call("check_availability", {}, lang).error,
      dateInvalid: call("check_availability", { date: "2026-02-31" }, lang).error,
      noSlot: call("check_availability", { date: SATURDAY }, lang).reason,
      noSlotNoDate: call("check_availability", { date: "2026-11-12", duration: 600 }, lang).reason,
      weekday: (call("check_availability", { date: SATURDAY }, lang).suggested_dates as { weekday: string }[])[0]!.weekday,
      summary: call("book_appointment", BOOK, lang).summary,
      bookMissing: call("book_appointment", { name: "Mock" }, lang).error,
      bookDate: call("book_appointment", { ...BOOK, date: "2026-13-01" }, lang).error,
      bookTime: call("book_appointment", { ...BOOK, time: "25:00" }, lang).error,
      bookDuration: call("book_appointment", { ...BOOK, duration: 9999 }, lang).error,
      slotPast: call("book_appointment", { ...BOOK, date: "2026-11-10", time: "10:00" }, lang).error,
      contactRequired: call("save_contact", { name: "Mock Client" }, lang).error,
      unknownTool: t.unknownTool("mock_tool"),
      rateLimited: t.rateLimited,
    };
  };

  assert.deepEqual(texts("fr"), {
    dateRequired: "Date requise (format YYYY-MM-DD).",
    dateInvalid: "Date invalide : 2026-02-31 (format attendu YYYY-MM-DD).",
    noSlot: "Plus de créneau disponible le samedi 14 novembre. Prochaines dates disponibles : lundi 16 novembre, mardi 17 novembre et mercredi 18 novembre.",
    noSlotNoDate: "Plus de créneau disponible le jeudi 12 novembre, ni dans les 60 jours qui suivent.",
    weekday: "lundi",
    summary: "Rendez-vous confirmé le jeudi 12 novembre à 11h30 pour Mock Client, à notre salon du centre-ville.",
    bookMissing: "Il manque le nom, le téléphone, la date ou l'heure du rendez-vous.",
    bookDate: "Date invalide : 2026-13-01 (format attendu YYYY-MM-DD).",
    bookTime: "Heure invalide : 25:00 (format attendu HH:MM, de 00:00 à 23:59).",
    bookDuration: "Durée invalide : 9999 (en minutes, un entier entre 5 et 480).",
    slotPast: "Le créneau du mardi 10 novembre à 10h est déjà passé. Propose un horaire à venir.",
    contactRequired: "Le nom et le téléphone sont requis.",
    unknownTool: "Outil inconnu : mock_tool.",
    rateLimited: "Trop de demandes pour la démo, réessaie plus tard.",
  });
  assert.deepEqual(texts("en"), {
    dateRequired: "A date is required (format YYYY-MM-DD).",
    dateInvalid: "Invalid date: 2026-02-31 (expected YYYY-MM-DD).",
    noSlot: "No slot left on Saturday, November 14. Next available dates: Monday, November 16, Tuesday, November 17, and Wednesday, November 18.",
    noSlotNoDate: "No slot left on Thursday, November 12, nor in the 60 days after it.",
    weekday: "Monday",
    summary: "Appointment confirmed on Thursday, November 12 at 11:30 AM for Mock Client, at our downtown salon.",
    bookMissing: "The booking needs a name, a phone number, a date and a time.",
    bookDate: "Invalid date: 2026-13-01 (expected YYYY-MM-DD).",
    bookTime: "Invalid time: 25:00 (expected HH:MM, 00:00 to 23:59).",
    bookDuration: "Invalid duration: 9999 (minutes, a whole number from 5 to 480).",
    slotPast: "The 10:00 AM slot on Tuesday, November 10 has already passed. Offer a time that is still ahead.",
    contactRequired: "A name and a phone number are required.",
    unknownTool: "Unknown tool: mock_tool.",
    rateLimited: "Too many demo requests, try again later.",
  });
  // [HE] to confirm: the wording; the checks below hold whatever it becomes.
  const he = texts("he");
  assert.equal(he.weekday, "יום ראשון", "he week: Saturday's next open day is Sunday");
  assert.equal(he.summary, "התור אושר ליום חמישי, 12 בנובמבר בשעה 11:30 עבור Mock Client, בסלון שלנו במרכז העיר.");
  assert.ok((he.noSlot as string).includes("יום ראשון, 15 בנובמבר"), he.noSlot as string);

  // No French left in an en or he answer, and every he text is in Hebrew.
  const FRENCH =
    /[àâçéèêëîïôûùüœ]|\b(le|la|les|du|des|pour|à|et|ni|requis|requise|invalide|créneau|disponibles?|rendez-vous|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|novembre|décembre|attendu|minutes?\s+un)\b|\d+h\d*\b/i;
  for (const lang of ["en", "he"] as const) {
    for (const [k, v] of Object.entries(texts(lang))) {
      assert.equal(typeof v, "string", `${lang} ${k}`);
      assert.doesNotMatch(v as string, FRENCH, `${lang} ${k}: ${v}`);
      if (lang === "he") assert.match(v as string, /[֐-׿]/, `he ${k} is not Hebrew: ${v}`);
      else assert.doesNotMatch(v as string, /[֐-׿]/, `en ${k} has Hebrew: ${v}`);
    }
  }
  for (const [k, v] of Object.entries(texts("fr"))) assert.doesNotMatch(v as string, /[֐-׿]/, `fr ${k}`);

  // The weekday follows the language on every suggestion.
  for (const lang of DEMO_LANGS) {
    for (const s of call("check_availability", { date: "2026-11-02" }, lang).suggested_dates as { date: string; weekday: string }[]) {
      assert.equal(s.weekday, demoWeekday(s.date, lang));
      assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  assert.equal(demoWeekday("2026-11-16", "fr"), "lundi");
  assert.equal(demoWeekday("2026-11-16", "en"), "Monday");
  assert.equal(demoWeekday("2026-11-16", "he"), "יום שני");
  // The year appears only when it is not this year's; times per locale.
  assert.equal(demoDateText("2027-01-04", "fr", "2026-11-11"), "lundi 4 janvier 2027");
  assert.equal(demoDateText("2027-01-04", "en", "2026-11-11"), "Monday, January 4, 2027");
  assert.equal(demoTimeText("15:00", "fr"), "15h");
  assert.equal(demoTimeText("15:00", "en"), "3:00 PM");
  assert.equal(demoTimeText("15:00", "he"), "15:00");

  // Field names and value types are the same in every language.
  const shapes = (lang: string) => ({
    open: typesOf(call("check_availability", { date: "2026-11-12" }, lang)),
    closed: typesOf(call("check_availability", { date: SATURDAY }, lang)),
    suggestion: typesOf((call("check_availability", { date: SATURDAY }, lang).suggested_dates as Body[])[0]!),
    book: typesOf(call("book_appointment", BOOK, lang)),
    bookError: typesOf(call("book_appointment", {}, lang)),
    availabilityError: typesOf(call("check_availability", {}, lang)),
    contact: typesOf(call("save_contact", { name: "Mock Client", phone: "+15555550100" }, lang)),
    contactError: typesOf(call("save_contact", {}, lang)),
  });
  const expectedShapes = {
    open: { date: "string", center: "string", label: "string", available_slots: "array" },
    closed: { date: "string", center: "string", label: "string", available_slots: "array", reason: "string", suggested_dates: "array" },
    suggestion: { date: "string", weekday: "string" },
    book: { success: "boolean", simulated: "boolean", center: "string", summary: "string" },
    bookError: { error: "string" },
    availabilityError: { error: "string" },
    contact: { success: "boolean", simulated: "boolean" },
    contactError: { error: "string" },
  };
  for (const lang of DEMO_LANGS) assert.deepEqual(shapes(lang), expectedShapes, lang);
  // Machine values stay language-free.
  for (const lang of DEMO_LANGS) {
    const a = call("check_availability", { date: "2026-11-12" }, lang);
    assert.deepEqual(a.available_slots, [...DEMO_SLOTS]);
    assert.equal(a.center, "demo_salon");
  }
}

// 15. The endpoint words its own errors with the same table.
{
  const route = read("app/api/demo/tools/[tool]/route.ts");
  assert.match(route, /demoEndpointText\(lang\)\.unknownTool/);
  assert.match(route, /demoEndpointText\(lang\)\.rateLimited/);
  assert.doesNotMatch(route, /Outil inconnu|Too many demo requests/);
}

console.log("demo-tools: ok");
