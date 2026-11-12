// The public home demo speaks no stored text of any account: not the demo
// account's business block, instructions, agent name or greeting.
// Against a THROWAWAY Postgres: the demo account is seeded with a
// recognisable fake centre, rule, service, address, price, persona name,
// greeting, brand line and a line naming a real town; demo sessions are minted
// through the real POST /api/session against a local recorder standing in for
// the provider (REALTIME_API_BASE, placeholder key), in fr, en and he, with a
// configured demo account and with none.
//   DEMO_SHEET_PHASE=main    run from origin/main's tree: records the payloads;
//   DEMO_SHEET_PHASE=branch  this tree: no seeded string and no lib/schedule
//                            place in any payload, the fixed Tamara persona
//                            and the fictional sheet in all of them, every
//                            field but the instructions identical to main's;
//                            a regular tenant still gets its own business and
//                            persona.
// The session is a test double (module hooks, fixtures/demo-sheet). Skipped
// in a plain `npm test`. Run with:  bash scripts/demo-sheet-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (example.test, Zzyzx).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import type { agentConfigs as AgentConfigs } from "../../lib/db/schema";
import { SCHEDULE_PLACES } from "./fixtures/demo-sheet/real-places";

const url = process.env.DEMO_SHEET_DB_URL;
if (!url) {
  console.log("SKIPPED demo-sheet-db (set DEMO_SHEET_DB_URL — see scripts/demo-sheet-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (!(globalThis as { __demoSheetHooks?: boolean }).__demoSheetHooks) {
  throw new Error("module hooks missing: run through scripts/demo-sheet-db.sh");
}
const PHASE = process.env.DEMO_SHEET_PHASE;
if (PHASE !== "main" && PHASE !== "branch") throw new Error("DEMO_SHEET_PHASE must be main or branch");
const SNAPSHOT: string = process.env.DEMO_SHEET_SNAPSHOT ?? "";
if (!SNAPSHOT) throw new Error("DEMO_SHEET_SNAPSHOT is required");
process.env.DATABASE_URL = url;

const LANGS = ["fr", "en", "he"] as const;
// Seeded business facts.
const FAKE_CENTRE = "Centre Zzyzx-Mock";
const FAKE_RULE = "uniquement le mardi Zzyzx";
const FAKE_SERVICE = "Soin Zzyzx-Service";
const FAKE_ADDRESS = "1 rue Zzyzx-Adresse";
const FAKE_NAME = "Salon Zzyzx-Identity";
const FAKE_PRICE = 7771;
// Seeded persona text: instructions, agent name, greeting.
const PERSONA_NAME = "Zzyzx-Persona";
const GREETING = "Bonjour Zzyzx-Greeting";
const BRAND_LINE = "Prestige Zzyzx-Brand";
const PLACE_LINE = "Rappelle que nous sommes à Ashdod le lundi.";
const STORED_INSTRUCTIONS = `Tu es ${PERSONA_NAME}, la voix d'accueil. Ton chaleureux et posé.\n${BRAND_LINE}\n${PLACE_LINE}`;
// None of these may reach the demo provider.
const LEAKS = [
  FAKE_CENTRE, FAKE_RULE, FAKE_SERVICE, FAKE_ADDRESS, FAKE_NAME, String(FAKE_PRICE),
  PERSONA_NAME, GREETING, BRAND_LINE, PLACE_LINE, "Zzyzx", "Prestige",
];

// Partial on purpose (one open day): sanitizeBusinessConfig fills the rest.
const BUSINESS = {
  identity: { name: FAKE_NAME, tagline: "", email: "" },
  centres: [
    {
      id: "ctr_zzyzx",
      name: FAKE_CENTRE,
      address: FAKE_ADDRESS,
      hours: { tue: { open: true, openTime: "09:00", closeTime: "17:00" } },
    },
  ],
  services: [{ id: "svc_zzyzx", name: FAKE_SERVICE, durationMinutes: 40, priceILS: FAKE_PRICE, centreIds: "all", description: "" }],
  centresRules: FAKE_RULE,
} as unknown as (typeof AgentConfigs.$inferInsert)["business"];

type Sent = { session: Record<string, unknown> };
type Snapshot = { payloads: Record<string, Sent>; fallbackPersona: string };

async function main() {
  // The provider stand-in: records every client_secrets body, answers a mock token.
  const received: Sent[] = [];
  const recorder = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.endsWith("/realtime/client_secrets")) received.push(JSON.parse(raw) as Sent);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ value: "ek_mock", expires_at: 1900000000 }));
    });
  });
  await new Promise<void>((r) => recorder.listen(0, "127.0.0.1", r));
  const port = (recorder.address() as AddressInfo).port;
  process.env.REALTIME_API_BASE = `http://127.0.0.1:${port}/v1`;
  process.env.REALTIME_API_KEY = "placeholder-key";
  delete process.env.OPENAI_API_KEY;

  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { agentConfigs, users } = await import("../../lib/db/schema");
  const { setDemoUserId } = await import("../../lib/settings");
  const { POST } = await import("../../app/api/session/route");

  const DEMO = "00000000-0000-4000-8000-0000000000d1";
  const TENANT = "00000000-0000-4000-8000-0000000000e1";
  await db.execute(sql`DELETE FROM app_settings`);
  await db.execute(sql`DELETE FROM agent_configs`);
  await db.execute(sql`DELETE FROM users`);
  await db.insert(users).values([
    { id: DEMO, email: "demo@example.test", passwordHash: "x", role: "user" },
    { id: TENANT, email: "tenant@example.test", passwordHash: "x", role: "user", subscriptionPlan: "premium" },
  ]);
  await db.insert(agentConfigs).values([
    {
      userId: DEMO,
      instructions: STORED_INSTRUCTIONS,
      greetingInstructions: GREETING,
      agentName: PERSONA_NAME,
      // Non-textual choices the demo still takes from the account.
      voice: "coral",
      model: "gpt-realtime",
      primaryLanguage: "fr",
      business: BUSINESS,
    },
    {
      userId: TENANT,
      instructions: `Tu es ${PERSONA_NAME}, la voix du tenant mock.`,
      greetingInstructions: GREETING,
      agentName: PERSONA_NAME,
      business: BUSINESS,
    },
  ]);

  const g = globalThis as { __demoSheetSession?: { user: { id: string } } | null };
  let ip = 0;
  const mint = async (body: Record<string, unknown>, signedInAs: string | null = null): Promise<Sent> => {
    g.__demoSheetSession = signedInAs ? { user: { id: signedInAs } } : null;
    const before = received.length;
    const res = await POST(
      new NextRequest("http://localhost/api/session", {
        method: "POST",
        // A fresh client IP per call: the per-IP demo cap is not under test here.
        headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(res.status, 200, `session ${JSON.stringify(body)} → ${res.status} ${await res.clone().text()}`);
    assert.equal(received.length, before + 1, "one client_secrets call per session");
    return received[received.length - 1]!;
  };

  const now: Record<string, Sent> = {};
  await setDemoUserId(DEMO);
  for (const lang of LANGS) now[`configured:${lang}`] = await mint({ demo: true, primaryLanguage: lang });
  // The signed-in home demo (body.demo) takes the same path.
  now["configured-signed-in:fr"] = await mint({ demo: true, primaryLanguage: "fr" }, TENANT);
  await setDemoUserId(null);
  for (const lang of LANGS) now[`fallback:${lang}`] = await mint({ demo: true, primaryLanguage: lang });

  if (PHASE === "main") {
    // main's built-in persona, for the branch's before/after comparison.
    const mainInstr = (await import("../../lib/demo-instructions")) as unknown as Record<string, unknown>;
    const snap: Snapshot = { payloads: now, fallbackPersona: String(mainInstr.DEMO_FALLBACK_PERSONA) };
    writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
    recorder.close();
    console.log(`main payloads recorded (${Object.keys(now).length})`);
    process.exit(0);
  }

  // ---- branch ----
  const main = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const { DEMO_PLACE, DEMO_SERVICES, demoSheetBlock } = await import("../../lib/demo-place");
  const { DEMO_PERSONA, anonymousDemoInstructions } = await import("../../lib/demo-instructions");
  const { REALTIME_INSTRUCTIONS } = await import("../../lib/realtime");
  // Sanity: main did speak the seeded text (this is the bug).
  const mainConfigured = String(main.payloads["configured:fr"]!.session.instructions);
  for (const s of [FAKE_CENTRE, FAKE_RULE, PERSONA_NAME, BRAND_LINE, PLACE_LINE]) {
    assert.ok(mainConfigured.includes(s), `main snapshot should carry the seeded "${s}"`);
  }

  for (const key of Object.keys(main.payloads)) {
    const lang = key.split(":")[1] as (typeof LANGS)[number];
    const sent = now[key]!;
    const text = JSON.stringify(sent);
    // Seed and scan: no seeded string, in any language, on any demo path.
    for (const leak of LEAKS) assert.ok(!text.includes(leak), `${key}: payload carries the seeded "${leak}"`);
    // Standing scan: no lib/schedule centre or town.
    assert.doesNotMatch(text, SCHEDULE_PLACES, `${key}: payload names a lib/schedule centre or town`);
    // The fixed persona and the fictional sheet, in the page's language.
    const instructions = String(sent.session.instructions);
    assert.ok(instructions.startsWith(DEMO_PERSONA), `${key}: fixed persona first`);
    assert.match(instructions, /tu t'appelles Tamara/, `${key}: Tamara`);
    assert.ok(instructions.includes(DEMO_PLACE[lang]), `${key}: fictional place present`);
    for (const s of DEMO_SERVICES) assert.ok(instructions.includes(s.name[lang]), `${key}: ${s.name[lang]} present`);
    // One prompt, all in code, configured account or not.
    assert.equal(instructions, anonymousDemoInstructions(lang), `${key}: not the code-built prompt`);

    // Unchanged parts: every field but the instructions is identical to main.
    const { instructions: mainInstr, ...mainRest } = main.payloads[key]!.session;
    const { instructions: _ignored, ...rest } = sent.session;
    void _ignored;
    assert.deepEqual(rest, mainRest, `${key}: model/voice/tools/audio differ from main`);
    // Without a demo account, main's prompt was already all code: the branch's
    // differs only by the persona's TON paragraph and the sheet.
    if (key.startsWith("fallback")) {
      const expected = String(mainInstr)
        .replace(main.fallbackPersona, DEMO_PERSONA)
        .replace(`${REALTIME_INSTRUCTIONS}\n\n`, `${REALTIME_INSTRUCTIONS}\n\n${demoSheetBlock(lang)}\n\n`);
      assert.equal(instructions, expected, `${key}: instructions differ from main beyond persona + sheet`);
    }
  }
  // The account's voice and model still apply.
  assert.equal((now["configured:fr"]!.session.audio as { output: { voice: string } }).output.voice, "coral");
  assert.equal(now["configured:fr"]!.session.model, "gpt-realtime");

  // Non-demo path: a tenant with the same stored text still gets its own
  // business and persona (dashboard prompt preview = /api/agent/config builder).
  const { resolveTenantByUserId } = await import("../../lib/tenant");
  const { loadInboundInstructionsInput } = await import("../../lib/agent/session-instructions-load");
  const { inboundSessionInstructions } = await import("../../lib/agent/session-instructions");
  const tenant = await resolveTenantByUserId(TENANT);
  assert.ok(tenant);
  const { input } = await loadInboundInstructionsInput(tenant);
  const tenantPrompt = inboundSessionInstructions(input);
  for (const fact of [FAKE_CENTRE, FAKE_RULE, FAKE_SERVICE, FAKE_ADDRESS, String(FAKE_PRICE), `Tu es ${PERSONA_NAME}, la voix du tenant mock.`]) {
    assert.ok(tenantPrompt.includes(fact), `tenant prompt lost its own "${fact}"`);
  }
  assert.ok(!tenantPrompt.includes(DEMO_PLACE.fr), "tenant prompt must not carry the demo sheet");
  assert.ok(!tenantPrompt.includes(DEMO_PERSONA), "tenant prompt must not carry the demo persona");

  recorder.close();
  console.log(`ALL DEMO-SHEET-DB TESTS PASSED (${Object.keys(main.payloads).length} demo payloads vs main, tenant path)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
