// Post-deploy smoke test for production. See docs/runbook-smoke-test.md.
//
//   BASE_URL=https://aitamara.com INTERNAL_SECRET=… OPENAI_API_KEY=… \
//     npx tsx scripts/smoke-prod.ts [--rate-limit]
//
// Read-only by design: no booking, no cancellation, no config change. Two
// unavoidable traces: the unknown-number probe logs one
// `unknown_dialed_number` error event, and --rate-limit mints up to 6
// anonymous demo sessions (free until used) and spends this IP's demo quota
// for 10 minutes.

type Check = { name: string; run: () => Promise<string | null> };

const BASE = (process.env.BASE_URL ?? "https://aitamara.com").replace(/\/$/, "");
const SECRET = process.env.INTERNAL_SECRET ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const KNOWN_PHONE = process.env.KNOWN_PHONE ?? "+97223764700";
// A number that is certainly not ours (reserved fictional range).
const UNKNOWN_PHONE = process.env.UNKNOWN_PHONE ?? "+15555550100";
const withRateLimit = process.argv.includes("--rate-limit");

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
/** null = pass, string = why it failed. */
const expect = (cond: boolean, why: string) => (cond ? null : why);

const checks: Check[] = [
  {
    name: "landing page answers 200",
    run: async () => {
      const r = await call("/");
      return expect(r.status === 200, `GET / → ${r.status}`);
    },
  },
  {
    name: `agent config for ${KNOWN_PHONE} = 200`,
    run: async () => {
      if (!SECRET) return "INTERNAL_SECRET not set";
      const r = await call(`/api/agent/config?phone=${encodeURIComponent(KNOWN_PHONE)}`, {
        headers: { "x-internal-secret": SECRET },
      });
      return expect(r.status === 200, `→ ${r.status}`);
    },
  },
  {
    name: "unknown dialed number refused (404 unknown_number)",
    run: async () => {
      if (!SECRET) return "INTERNAL_SECRET not set";
      const r = await call(`/api/agent/config?phone=${encodeURIComponent(UNKNOWN_PHONE)}`, {
        headers: { "x-internal-secret": SECRET },
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return expect(
        r.status === 404 && body.error === "unknown_number",
        `→ ${r.status} ${JSON.stringify(body).slice(0, 80)} (a 200 means the default-tenant fallback is back)`,
      );
    },
  },
  {
    name: "anonymous calendar find/cancel refused (401)",
    run: async () => {
      // A fake phone/eventId: even if the sandbox were missing, nothing matches.
      const find = await call("/api/calendar/find", json({ phone: "+15555550100" }));
      const cancel = await call("/api/calendar/cancel", json({ eventId: "smoke-test-nonexistent" }));
      return expect(
        find.status === 401 && cancel.status === 401,
        `find → ${find.status}, cancel → ${cancel.status}`,
      );
    },
  },
  {
    name: "OpenAI key valid (GET /v1/models = 200)",
    run: async () => {
      if (!OPENAI_KEY) return "OPENAI_API_KEY not set";
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      return expect(r.status === 200, `→ ${r.status}`);
    },
  },
];

if (withRateLimit) {
  checks.push({
    name: "anonymous /api/session rate-limited (429 by the 6th call)",
    run: async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await call("/api/session", json({ instructions: "smoke test" }));
        statuses.push(r.status);
        if (r.status === 429) break;
      }
      return expect(statuses.includes(429), `statuses ${statuses.join(",")}`);
    },
  });
}

async function main() {
  console.log(`Smoke test → ${BASE}\n`);
  let failed = 0;
  for (const c of checks) {
    let why: string | null;
    try {
      why = await c.run();
    } catch (e) {
      why = `threw: ${(e as Error).message}`;
    }
    if (why) failed++;
    console.log(`${why ? "FAIL" : "PASS"}  ${c.name}${why ? `  — ${why}` : ""}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}

void main();
