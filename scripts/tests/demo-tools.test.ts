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
  demoLang,
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
  assert.equal(b.body.summary, `RDV confirmé le 2026-11-12 à 11:30 pour Mock Client à ${DEMO_PLACE[lang]}`);
}
// Invalid request, past slot: { error } with a 400.
assert.equal(run("book_appointment", { name: "Mock", date: "2026-11-12", time: "11:30" }, NOW).status, 400);
assert.equal(run("book_appointment", { name: "Mock", phone: "1", date: "2026-11-12", time: "25:00" }, NOW).status, 400);
{
  const past = run("book_appointment", { name: "Mock", phone: "1", date: "2026-11-10", time: "10:00" }, NOW);
  assert.equal(past.status, 400);
  assert.match(past.body.error as string, /déjà passé/);
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

console.log("demo-tools: ok");
