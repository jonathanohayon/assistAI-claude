// lib/demo-tools.ts: the home demo's canned tool answers, and the demo
// session's route table that points at them. Mock values only.
// Run with:  npx tsx scripts/tests/demo-tools.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEMO_TOOL_ROUTES } from "../../lib/demo-session";
import {
  DEMO_OPEN_DAYS,
  DEMO_SLOTS,
  DEMO_TOOL_NAMES,
  DEMO_TOOLS_BASE,
  DEMO_TOOLS_GLOBAL,
  DEMO_TOOLS_PER_IP,
  cannedSlots,
  isDemoToolName,
  jerusalemDateAt,
  runDemoTool,
} from "../../lib/demo-tools";
import { jerusalemToUTCISO } from "../../lib/tz";
import { REPO_ROOT } from "./helpers/source-scan";

const ROOT = REPO_ROOT;
const at = (date: string, time: string) => new Date(jerusalemToUTCISO(date, `${time}:00`)).getTime();

// No network during any canned answer: a Google or DB call would go through fetch or a socket.
let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  return new Response("{}");
}) as typeof fetch;

// Fixed clock: Wednesday 2026-11-11, 10:00 in Asia/Jerusalem.
const NOW = at("2026-11-11", "10:00");
assert.equal(jerusalemDateAt(NOW), "2026-11-11");

// 1. Availability: shape of a day with slots, exactly the legacy demo fields.
{
  const a = runDemoTool("check_availability", { date: "2026-11-12" }, NOW);
  assert.equal(a.status, 200);
  assert.deepEqual(Object.keys(a.body).sort(), ["available_slots", "center", "date", "label"]);
  assert.equal(a.body.date, "2026-11-12");
  assert.equal(typeof a.body.center, "string");
  assert.equal(typeof a.body.label, "string");
  assert.deepEqual(a.body.available_slots, [...DEMO_SLOTS]);
  // Deterministic for a fixed clock.
  assert.deepEqual(runDemoTool("check_availability", { date: "2026-11-12" }, NOW), a);
}

// 2. Today: a slot starting within 30 min is hidden, a past one too.
assert.deepEqual(cannedSlots("2026-11-11", 30, NOW), ["11:30", "15:00"]);
assert.deepEqual(cannedSlots("2026-11-11", 30, at("2026-11-11", "11:01")), ["15:00"]);
assert.deepEqual(cannedSlots("2026-11-11", 30, at("2026-11-11", "14:31")), []);

// 3. No slot left: same shape plus reason and suggested_dates ({ date, weekday }).
{
  const closed = runDemoTool("check_availability", { date: "2026-11-13" }, NOW); // Friday
  assert.equal(closed.status, 200);
  assert.deepEqual(Object.keys(closed.body).sort(), ["available_slots", "center", "date", "label", "reason", "suggested_dates"]);
  assert.deepEqual(closed.body.available_slots, []);
  assert.equal(typeof closed.body.reason, "string");
  assert.deepEqual(closed.body.suggested_dates, [
    { date: "2026-11-15", weekday: "dimanche" },
    { date: "2026-11-16", weekday: "lundi" },
    { date: "2026-11-17", weekday: "mardi" },
  ]);
  // A past date suggests from today on, never before.
  const past = runDemoTool("check_availability", { date: "2026-11-02" }, NOW);
  assert.deepEqual(past.body.available_slots, []);
  assert.deepEqual(
    (past.body.suggested_dates as { date: string }[]).map((d) => d.date),
    ["2026-11-12", "2026-11-15", "2026-11-16"],
  );
}

// 4. Never in the past, whatever the clock and the date (and only open days).
for (let i = 0; i < 2000; i++) {
  const now = at("2026-01-01", "00:00") + Math.floor((i * 791_935_123) % (400 * 86_400_000));
  const day = new Date(now + ((i % 21) - 7) * 86_400_000).toISOString().slice(0, 10);
  const r = runDemoTool("check_availability", { date: day }, now);
  for (const t of r.body.available_slots as string[]) {
    assert.ok(at(day, t) > now, `${day} ${t} is in the past at ${new Date(now).toISOString()}`);
  }
  if ((r.body.available_slots as string[]).length > 0) {
    assert.ok(DEMO_OPEN_DAYS.includes(new Date(`${day}T00:00:00Z`).getUTCDay()), `${day} is not an open day`);
  }
  for (const s of (r.body.suggested_dates as { date: string }[] | undefined) ?? []) {
    assert.ok(s.date >= jerusalemDateAt(now), `suggested ${s.date} before today`);
  }
}

// 5. Duration: the service must end by 18:00; none fits → no suggestion either.
assert.deepEqual(cannedSlots("2026-11-12", 240, NOW), ["10:00", "11:30"]);
assert.deepEqual(runDemoTool("check_availability", { date: "2026-11-12", duration: 600 }, NOW).body.suggested_dates, []);

// 6. Availability errors: { error } with a 400, as the legacy route.
for (const args of [{}, { date: "" }, { date: "tomorrow" }, { date: "2026-02-31" }, null, "x"]) {
  const r = runDemoTool("check_availability", args, NOW);
  assert.equal(r.status, 400, JSON.stringify(args));
  assert.deepEqual(Object.keys(r.body), ["error"]);
}

// 7. Booking: the legacy demo confirmation, nothing stored.
{
  const b = runDemoTool(
    "book_appointment",
    { name: "Mock Client", phone: "+15555550100", date: "2026-11-12", time: "11:30", duration: 30 },
    NOW,
  );
  assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(b.body).sort(), ["center", "simulated", "success", "summary"]);
  assert.equal(b.body.success, true);
  assert.equal(b.body.simulated, true);
  assert.match(b.body.summary as string, /^RDV confirmé le 2026-11-12 à 11:30 pour Mock Client à .+$/);
  // Invalid request, past slot: { error } with a 400.
  assert.equal(runDemoTool("book_appointment", { name: "Mock", date: "2026-11-12", time: "11:30" }, NOW).status, 400);
  assert.equal(runDemoTool("book_appointment", { name: "Mock", phone: "1", date: "2026-11-12", time: "25:00" }, NOW).status, 400);
  const past = runDemoTool("book_appointment", { name: "Mock", phone: "1", date: "2026-11-10", time: "10:00" }, NOW);
  assert.equal(past.status, 400);
  assert.match(past.body.error as string, /déjà passé/);
}

// 8. Contact: acknowledged, nothing stored.
assert.deepEqual(runDemoTool("save_contact", { name: "Mock Client", phone: "+15555550100", notes: "mock" }, NOW), {
  status: 200,
  body: { success: true, simulated: true },
});
assert.equal(runDemoTool("save_contact", { name: "Mock Client" }, NOW).status, 400);

assert.equal(fetches, 0, "a canned answer made a network call");

// 9. The demo session's route table points only at the demo endpoint.
for (const [name, route] of Object.entries(DEMO_TOOL_ROUTES)) {
  if (!("endpoint" in route)) {
    assert.equal(name, "end_call");
    continue;
  }
  assert.equal(route.endpoint, `${DEMO_TOOLS_BASE}/${name}`, name);
  assert.ok(isDemoToolName(name), name);
  assert.doesNotMatch(route.endpoint, /\/api\/(calendar|sheets)\//, name);
}
assert.deepEqual(
  Object.keys(DEMO_TOOL_ROUTES).filter((n) => n !== "end_call").sort(),
  [...DEMO_TOOL_NAMES].sort(),
);
assert.ok(existsSync(join(ROOT, "app/api/demo/tools/[tool]/route.ts")), "the endpoint the table points at exists");
assert.ok(DEMO_TOOLS_PER_IP > 0 && DEMO_TOOLS_GLOBAL >= DEMO_TOOLS_PER_IP);

// 10. Import guard: lib/demo-tools.ts and everything it imports (transitively)
// reach no Google client, no DB, no logger.
const FORBIDDEN = /(^|\/)(google|db|logger|rate-limit-db)(\.ts)?$|googleapis|drizzle|postgres|next-auth|^@\/auth$/;
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

// 11. The endpoint resolves no caller: no session, no Google, so a signed-in
// visitor gets the same canned answers as an anonymous one.
{
  const route = readFileSync(join(ROOT, "app/api/demo/tools/[tool]/route.ts"), "utf8");
  const specs = importsOf(join(ROOT, "app/api/demo/tools/[tool]/route.ts"));
  assert.deepEqual(specs.filter((s) => /google|@\/auth$|lib\/db$|lib\/tenant/.test(s)), []);
  assert.doesNotMatch(route, /\bauth\(|resolveAgentCallerGoogle|getCalendar|getSheets/);
  assert.match(route, /consumeRateLimit\(/, "the public endpoint is rate limited");
}

console.log("demo-tools: ok");
