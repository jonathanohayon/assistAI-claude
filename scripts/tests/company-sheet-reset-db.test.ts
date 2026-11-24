// The admin company-sheet reset against a THROWAWAY Postgres, through the real
// routes (app/api/admin/users/[userId]/reset-company-sheet/{route,undo/route}.ts):
//   1. gate cases: signed out 401, a tenant 403 (GET, POST, undo), nothing
//      written; an admin 200;
//   2. the reset writes DEFAULT_BUSINESS, knowledge = [] and company_sheet =
//      NULL; every other agent_configs column (instructions, greeting, agent
//      name...) and the users row (company_sheet aside) are byte-identical;
//      another account untouched; the event carries ids only;
//   3. PINNED: a sheet full of first-customer facts + a legacy knowledge array
//      → after the reset, the INBOUND session-config prompt holds NO
//      first-customer fact (the legacy array does not come back);
//   4. undo: bad body 400, unknown / another account's 404, restores the exact
//      jsonb (byte-equal, phone + email inside text kept), a NULL sheet comes
//      back as SQL NULL, second undo 409; edited since → 409 naming the
//      fields, force restores; only the latest reset;
//   5. kinds independent: a persona reset never blocks a sheet undo nor the
//      reverse; a reset id of the other kind is 404 on each side;
//   6. the persona routes unchanged: they only see kind 'persona' and still
//      restore the persona exactly, without touching the sheet.
// The session is a test double (scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs).
// Plain `npm test` skips it. Run it with:  bash scripts/company-sheet-reset-db.sh
// Only a 127.0.0.1/localhost URL is accepted; mock data only (example.test).

import assert from "node:assert/strict";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const url = process.env.COMPANY_SHEET_RESET_DB_TEST_URL;
if (!url) {
  console.log("skip: company sheet reset DB part (no COMPANY_SHEET_RESET_DB_TEST_URL — see scripts/company-sheet-reset-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/company-sheet-reset-db.sh");
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const TENANT = "00000000-0000-4000-8000-000000000071";
const TARGET = "00000000-0000-4000-8000-000000000072";
const OTHER = "00000000-0000-4000-8000-000000000073";
const NOSHEET = "00000000-0000-4000-8000-000000000074";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

// Mock first-customer-like content (every piece matches FIRST_CUSTOMER_FACTS),
// with a phone number and an email inside the text: the snapshot keeps them.
const allWeek = (open: boolean) =>
  Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, { open, openTime: "09:00", closeTime: "18:00" }]));
const BUSINESS = {
  identity: { name: "Prestige Mock", tagline: "Soins à Ashdod", email: "owner@example.test" },
  centres: [
    { id: "c-ashdod", name: "Ashdod", address: "Mock street 1, Ashdod", hours: allWeek(true) },
    { id: "c-natanya", name: "Natanya", address: "Mock street 2, Natanya", hours: allWeek(false) },
  ],
  services: [{ id: "s-1", name: "Épilation mock", durationMinutes: 60, priceILS: 250, centreIds: "all", description: "Soin de 60 min" }],
  centresRules: "Lundi = Ashdod, mercredi = Natanya, autres jours = Jérusalem. Tél +972500000000.",
  knowledgeBase: "Épilation laser, soins visage. Contact owner@example.test ou +972500000000.",
};
const SHEET = {
  version: 1,
  identity: BUSINESS.identity,
  locations: BUSINESS.centres,
  services: [{ id: "s-1", name: "Épilation mock", durationMinutes: 60, priceILS: 250, locationIds: "all", description: "Soin de 60 min" }],
  locationRules: BUSINESS.centresRules,
  notes: BUSINESS.knowledgeBase,
  faq: [{ q: "Où êtes-vous le lundi ?", a: "À Ashdod, appelez le +972500000000." }],
  sources: [{ url: "https://prestige.example.test", learnedAt: null }],
};
const LEGACY = [
  { id: "k1", toolName: "info_ashdod", businessName: "Prestige Ashdod", openingHours: "lundi 9h-18h", description: "Soins 60 min, épilation. owner@example.test" },
];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { DEFAULT_BUSINESS } = await import("../../lib/business");
  const { neutralSeed, DEFAULT_AGENT_NAME } = await import("../../lib/neutral-seed");
  const sheetRoute = await import("../../app/api/admin/users/[userId]/reset-company-sheet/route");
  const sheetUndoRoute = await import("../../app/api/admin/users/[userId]/reset-company-sheet/undo/route");
  const personaRoute = await import("../../app/api/admin/users/[userId]/reset-persona/route");
  const personaUndoRoute = await import("../../app/api/admin/users/[userId]/reset-persona/undo/route");
  const sessionRoute = await import("../../app/api/agent/session-config/route");

  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
  const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });
  const as = (id: string | null) => (g.__campgateSession = id ? { user: { id } } : null);
  const jreq = (body?: unknown) =>
    new NextRequest("http://localhost/api/admin/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : typeof body === "string" ? body : JSON.stringify(body),
    });
  type R = { status: number; body: Record<string, unknown> };
  const res = async (r: Response): Promise<R> => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
  const post = async (userId: string) => res(await sheetRoute.POST(new Request("http://localhost/x", { method: "POST" }), ctx(userId)));
  const get = async (userId: string) => res(await sheetRoute.GET(new Request("http://localhost/x"), ctx(userId)));
  const undo = async (userId: string, body?: unknown) => res(await sheetUndoRoute.POST(jreq(body), ctx(userId)));
  const pPost = async (userId: string) => res(await personaRoute.POST(new Request("http://localhost/x", { method: "POST" }), ctx(userId)));
  const pGet = async (userId: string) => res(await personaRoute.GET(new Request("http://localhost/x"), ctx(userId)));
  const pUndo = async (userId: string, body?: unknown) => res(await personaUndoRoute.POST(jreq(body), ctx(userId)));
  // The inbound prompt the worker receives (web origin), as the worker reads it.
  const inboundPrompt = async (userId: string) => {
    const r = await sessionRoute.GET(
      new NextRequest(`http://localhost/x?origin=web&userId=${userId}`, { headers: { "x-internal-secret": "mock-internal-secret" } }),
    );
    assert.equal(r.status, 200, `session-config ${userId}`);
    const j = (await r.json()) as { instructions: string };
    assert.equal(typeof j.instructions, "string");
    return j.instructions;
  };

  // Rows as exact text (jsonb's canonical output), optionally without some columns.
  const cfgRow = async (userId: string, drop: string[] = []) => {
    const [r] = await rows<{ j: Record<string, unknown> }>(sql`SELECT to_jsonb(a) AS j FROM agent_configs a WHERE user_id = ${userId}`);
    const j = { ...r.j };
    for (const k of drop) delete j[k];
    return JSON.stringify(j);
  };
  const userRow = async (userId: string, drop: string[] = []) => {
    const [r] = await rows<{ j: Record<string, unknown> }>(sql`SELECT to_jsonb(u) AS j FROM users u WHERE id = ${userId}`);
    const j = { ...r.j };
    for (const k of drop) delete j[k];
    return JSON.stringify(j);
  };
  const sheetText = async (userId: string) => {
    const [r] = await rows<{ business: string; knowledge: string; company_sheet: string | null; is_null: boolean }>(sql`
      SELECT a.business::text AS business, a.knowledge::text AS knowledge, u.company_sheet::text AS company_sheet,
             u.company_sheet IS NULL AS is_null
      FROM agent_configs a JOIN users u ON u.id = a.user_id WHERE a.user_id = ${userId}`);
    return r;
  };
  const resetCount = async () => Number((await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM persona_resets WHERE user_id IN (${TARGET}, ${TENANT})`))[0].n);
  const SHEET_CFG_COLS = ["business", "knowledge", "updated_at"];
  const PERSONA_COLS = ["instructions", "greeting_instructions", "agent_name", "persona_config", "updated_at"];

  // ── Mock accounts ────────────────────────────────────────────────────────
  await db.execute(sql`INSERT INTO users (id, email, password_hash, role, locale, subscription_plan, display_name, company_sheet) VALUES
    (${ADMIN}, 'admin@sheet-reset.example.test', 'x', 'admin', 'fr', 'global', '', NULL),
    (${TENANT}, 'tenant@sheet-reset.example.test', 'x', 'user', 'fr', 'global', '', NULL),
    (${TARGET}, 'target@sheet-reset.example.test', 'x', 'user', 'fr', 'premium', 'Mock Display', ${JSON.stringify(SHEET)}::jsonb),
    (${OTHER}, 'other@sheet-reset.example.test', 'x', 'user', 'en', 'global', '', ${JSON.stringify(SHEET)}::jsonb),
    (${NOSHEET}, 'nosheet@sheet-reset.example.test', 'x', 'user', 'fr', 'global', '', NULL)`);
  // The target's persona is neutral mock text (no first-customer fact), so the
  // pinned prompt check isolates the sheet.
  const PERSONA = { instructions: "Mock neutral persona. Be brief.", greeting: "Bonjour, Mocka à votre écoute.", agentName: "Mocka" };
  await db.execute(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, agent_name, voice, primary_language, owner_whatsapp, transfer_number, business, knowledge) VALUES
    (${TARGET}, ${PERSONA.instructions}, ${PERSONA.greeting}, ${PERSONA.agentName}, 'cedar', 'fr', '+972500000001', '+97230000002', ${JSON.stringify(BUSINESS)}::jsonb, ${JSON.stringify(LEGACY)}::jsonb),
    (${OTHER}, 'Other mock prompt', 'Other mock greeting', 'Otto', 'marin', 'en', '', '', ${JSON.stringify(BUSINESS)}::jsonb, ${JSON.stringify(LEGACY)}::jsonb),
    (${NOSHEET}, 'No sheet mock prompt', 'No sheet greeting', 'Nora', 'marin', 'fr', '', '', ${JSON.stringify({ identity: { name: "Mock Bakery", tagline: "", email: "" }, centres: [], services: [] })}::jsonb, '[]'::jsonb)`);

  const before = await cfgRow(TARGET);
  const beforeUser = await userRow(TARGET);
  const beforeSheet = await sheetText(TARGET);
  const otherBefore = [await cfgRow(OTHER), await userRow(OTHER)].join("|");

  // ── 1. Gate cases ────────────────────────────────────────────────────────
  for (const [who, code] of [[null, 401], [TENANT, 403]] as const) {
    as(who);
    assert.equal((await post(TARGET)).status, code, `reset as ${who ?? "signed out"}`);
    assert.equal((await get(TARGET)).status, code, `GET as ${who ?? "signed out"}`);
    assert.equal((await undo(TARGET, { resetId: MISSING })).status, code, `undo as ${who ?? "signed out"}`);
    assert.equal(await cfgRow(TARGET), before, "nothing written");
    assert.equal(await userRow(TARGET), beforeUser, "nothing written");
    assert.equal(await resetCount(), 0, "no reset row");
  }
  as(TENANT);
  assert.equal((await post(TENANT)).status, 403, "a tenant clearing ITS OWN sheet is refused too");
  console.log("ok 1 gate cases (401 signed out, 403 tenant, nothing written)");

  // ── 3 (pre). The prompt carries the facts before the reset ──────────────
  // (proves the pinned check below can see them: business + legacy).
  const promptBefore = await inboundPrompt(TARGET);
  assert.match(promptBefore, FIRST_CUSTOMER_FACTS, "the mock sheet reaches the prompt before the reset");

  // ── 2. The reset (admin 200) ─────────────────────────────────────────────
  as(ADMIN);
  assert.deepEqual((await get(TARGET)).body, { undo: null });
  assert.equal((await post(MISSING)).status, 404);
  assert.equal((await post("not-a-uuid")).status, 404);
  const r1 = await post(TARGET);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const after = await sheetText(TARGET);
  assert.deepEqual(JSON.parse(after.business), DEFAULT_BUSINESS, "business = DEFAULT_BUSINESS");
  assert.equal(after.knowledge, "[]", "knowledge = [] (the column default)");
  assert.equal(after.is_null, true, "company_sheet = SQL NULL (what sign-up leaves)");
  // Every other column untouched, incl. instructions / greeting / agentName.
  const strip = (row: string, drop: string[]) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(row)).filter(([k]) => !drop.includes(k))));
  assert.equal(await cfgRow(TARGET, SHEET_CFG_COLS), strip(before, SHEET_CFG_COLS), "other agent_configs columns untouched");
  const [p] = await rows<{ i: string; g: string; n: string }>(sql`SELECT instructions AS i, greeting_instructions AS g, agent_name AS n FROM agent_configs WHERE user_id = ${TARGET}`);
  assert.deepEqual(p, { i: PERSONA.instructions, g: PERSONA.greeting, n: PERSONA.agentName });
  assert.equal(await userRow(TARGET, ["company_sheet"]), strip(beforeUser, ["company_sheet"]), "users row untouched apart from company_sheet");
  assert.equal([await cfgRow(OTHER), await userRow(OTHER)].join("|"), otherBefore, "another account untouched");
  const [stored] = await rows<{ id: string; kind: string; previous: Record<string, unknown>; by_admin: string; undone_at: string | null }>(
    sql`SELECT id, kind, previous, by_admin, undone_at FROM persona_resets WHERE user_id = ${TARGET}`,
  );
  assert.equal(stored.id, r1.body.resetId);
  assert.equal(stored.kind, "company_sheet");
  assert.equal(stored.by_admin, ADMIN);
  assert.deepEqual(Object.keys(stored.previous).sort(), ["business", "companySheet", "knowledge"]);
  const ev = await rows<{ source: string; message: string; metadata: Record<string, unknown> }>(sql`SELECT source, message, metadata FROM events WHERE event = 'company_sheet_reset'`);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].source, "admin");
  assert.deepEqual(ev[0].metadata, { targetUserId: TARGET, resetId: stored.id, by: ADMIN }, "event = ids only");
  assert.doesNotMatch(ev[0].message, FIRST_CUSTOMER_FACTS);
  console.log("ok 2 reset: DEFAULT_BUSINESS + [] + NULL; every other column (persona incl.), the users row and other accounts unchanged; event = ids only");

  // ── 3. PINNED: no first-customer fact in the inbound prompt ──────────────
  const promptAfter = await inboundPrompt(TARGET);
  assert.doesNotMatch(promptAfter, FIRST_CUSTOMER_FACTS, "no first-customer fact after the reset");
  assert.ok(!promptAfter.includes("INFOS LEGACY"), "the legacy knowledge block does not come back");
  for (const t of ["Prestige", "Ashdod", "Natanya", "owner@example.test", "+972500000000"]) assert.ok(!promptAfter.includes(t), `no ${t}`);
  console.log("ok 3 PINNED: the inbound session-config prompt holds no first-customer fact (legacy array not resurrected)");

  // ── 4. Undo ──────────────────────────────────────────────────────────────
  const avail = (await get(TARGET)).body.undo as { resetId: string; editedSinceReset: string[] };
  assert.equal(avail.resetId, stored.id);
  assert.deepEqual(avail.editedSinceReset, []);
  assert.equal((await undo(TARGET, "not json")).status, 400);
  assert.deepEqual((await undo(TARGET, {})).body, { error: "invalid_reset_id" });
  assert.deepEqual((await undo(TARGET, { resetId: stored.id, force: "yes" })).body, { error: "invalid_force" });
  assert.equal((await undo(TARGET, { resetId: MISSING })).status, 404);
  assert.equal((await undo(OTHER, { resetId: stored.id })).status, 404, "another account's reset");
  const u1 = await undo(TARGET, { resetId: stored.id });
  assert.equal(u1.status, 200, JSON.stringify(u1.body));
  assert.deepEqual(await sheetText(TARGET), beforeSheet, "business / knowledge / company_sheet byte-equal");
  assert.ok((await sheetText(TARGET)).company_sheet!.includes("+972500000000") && (await sheetText(TARGET)).business.includes("owner@example.test"), "phone + email kept verbatim");
  assert.equal(await cfgRow(TARGET, ["updated_at"]), strip(before, ["updated_at"]), "agent_configs row identical");
  assert.equal(await userRow(TARGET), beforeUser, "users row identical");
  assert.equal(await inboundPrompt(TARGET), promptBefore, "the prompt is back exactly");
  assert.deepEqual((await undo(TARGET, { resetId: stored.id })).body, { error: "already_undone" });
  assert.deepEqual((await get(TARGET)).body, { undo: null });
  assert.equal((await rows(sql`SELECT 1 FROM events WHERE event = 'company_sheet_reset_undone'`)).length, 1);
  console.log("ok 4a undo restores byte-exact jsonb (phone + email kept); bad body 400; unknown / other account 404; second undo 409");

  // A NULL sheet comes back as SQL NULL (not JSON null).
  const nsBefore = await sheetText(NOSHEET);
  const rn = await post(NOSHEET);
  assert.equal(rn.status, 200);
  const [nsPrev] = await rows<{ has: boolean }>(sql`SELECT previous ? 'companySheet' AS has FROM persona_resets WHERE id = ${rn.body.resetId as string}`);
  assert.equal(nsPrev.has, false, "a NULL sheet is stored as an absent key");
  assert.equal((await undo(NOSHEET, { resetId: rn.body.resetId })).status, 200);
  assert.deepEqual(await sheetText(NOSHEET), nsBefore);
  assert.equal((await sheetText(NOSHEET)).is_null, true, "SQL NULL restored");
  console.log("ok 4b a NULL sheet is restored as SQL NULL");

  // Edited since the reset → refused, then forced.
  const r2 = await post(TARGET);
  assert.equal(r2.status, 200);
  // Writing the legacy array back shows why it must be cleared: it is served again.
  await db.execute(sql`UPDATE agent_configs SET knowledge = ${JSON.stringify(LEGACY)}::jsonb WHERE user_id = ${TARGET}`);
  assert.match(await inboundPrompt(TARGET), /INFOS LEGACY/, "with an empty business, a legacy array IS served");
  await db.execute(sql`UPDATE users SET company_sheet = '{"version":1}'::jsonb WHERE id = ${TARGET}`);
  assert.deepEqual(((await get(TARGET)).body.undo as { editedSinceReset: string[] }).editedSinceReset, ["knowledge", "companySheet"]);
  assert.deepEqual((await undo(TARGET, { resetId: r2.body.resetId })).body, { error: "edited_since_reset", fields: ["knowledge", "companySheet"] });
  const [still] = await rows<{ s: string }>(sql`SELECT company_sheet::text AS s FROM users WHERE id = ${TARGET}`);
  assert.equal(still.s, '{"version": 1}', "a refused undo writes nothing");
  const u2 = await undo(TARGET, { resetId: r2.body.resetId, force: true });
  assert.equal(u2.status, 200);
  assert.deepEqual(u2.body.overwritten, ["knowledge", "companySheet"]);
  assert.equal(u2.body.forced, true);
  assert.deepEqual(await sheetText(TARGET), beforeSheet);
  console.log("ok 4c edited since the reset → 409 naming the fields; force restores");

  // Only the latest reset.
  const r3 = await post(TARGET);
  const r4 = await post(TARGET);
  assert.deepEqual((await undo(TARGET, { resetId: r3.body.resetId })).body, { error: "not_latest_reset" });
  assert.equal((await undo(TARGET, { resetId: r4.body.resetId })).status, 200);
  // r4 replaced r3's output (already cleared): undoing r4 gives the cleared sheet; r3 is not the latest, so it stays.
  assert.deepEqual((await undo(TARGET, { resetId: r3.body.resetId })).body, { error: "not_latest_reset" });
  await db.execute(sql`UPDATE agent_configs SET business = ${JSON.stringify(BUSINESS)}::jsonb, knowledge = ${JSON.stringify(LEGACY)}::jsonb WHERE user_id = ${TARGET}`);
  await db.execute(sql`UPDATE users SET company_sheet = ${JSON.stringify(SHEET)}::jsonb WHERE id = ${TARGET}`);
  assert.deepEqual(await sheetText(TARGET), beforeSheet, "mock sheet put back for the next steps");
  console.log("ok 4d only the latest reset can be undone");

  // ── 5. Kinds independent ─────────────────────────────────────────────────
  const personaBefore = await cfgRow(TARGET, ["updated_at"]);
  const p1 = await pPost(TARGET);
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const s1 = await post(TARGET);
  assert.equal(s1.status, 200);
  // Each GET sees its own kind only.
  assert.equal(((await pGet(TARGET)).body.undo as { resetId: string }).resetId, p1.body.resetId);
  assert.equal(((await get(TARGET)).body.undo as { resetId: string }).resetId, s1.body.resetId);
  // A reset id of the other kind is unknown on each side.
  assert.deepEqual((await pUndo(TARGET, { resetId: s1.body.resetId })).body, { error: "reset_not_found" });
  assert.deepEqual((await undo(TARGET, { resetId: p1.body.resetId })).body, { error: "reset_not_found" });
  // The sheet reset is more recent than the persona one, yet the persona undo
  // is still the latest of ITS kind, and neither undo blocks the other.
  const pu = await pUndo(TARGET, { resetId: p1.body.resetId });
  assert.equal(pu.status, 200, JSON.stringify(pu.body));
  assert.deepEqual(pu.body.overwritten, [], "the sheet reset does not count as a persona edit");
  const su = await undo(TARGET, { resetId: s1.body.resetId });
  assert.equal(su.status, 200, JSON.stringify(su.body));
  assert.deepEqual(su.body.overwritten, [], "the persona reset does not count as a sheet edit");
  assert.equal(await cfgRow(TARGET, ["updated_at"]), personaBefore, "both undone → the row is back exactly");
  assert.deepEqual(await sheetText(TARGET), beforeSheet);
  console.log("ok 5 kinds independent (own latest, own GET, other kind's id 404, neither blocks the other)");

  // ── 6. The persona routes unchanged ──────────────────────────────────────
  const p2 = await pPost(TARGET);
  assert.equal(p2.status, 200);
  const [pk] = await rows<{ kind: string }>(sql`SELECT kind FROM persona_resets WHERE id = ${p2.body.resetId as string}`);
  assert.equal(pk.kind, "persona", "a persona reset is stored as kind 'persona'");
  const [np] = await rows<{ i: string; n: string }>(sql`SELECT instructions AS i, agent_name AS n FROM agent_configs WHERE user_id = ${TARGET}`);
  assert.equal(np.i, neutralSeed("fr").instructions);
  assert.equal(np.n, DEFAULT_AGENT_NAME);
  assert.deepEqual(await sheetText(TARGET), beforeSheet, "a persona reset leaves the sheet alone");
  assert.equal(await cfgRow(TARGET, PERSONA_COLS), strip(before, PERSONA_COLS), "a persona reset writes only the persona columns");
  // A sheet reset in between does not make the persona one "not latest".
  const s2 = await post(TARGET);
  assert.equal((await pUndo(TARGET, { resetId: p2.body.resetId })).status, 200);
  assert.deepEqual((await pUndo(TARGET, { resetId: p2.body.resetId })).body, { error: "already_undone" });
  assert.deepEqual((await pGet(TARGET)).body, { undo: null });
  assert.equal((await undo(TARGET, { resetId: s2.body.resetId })).status, 200);
  assert.equal(await cfgRow(TARGET, ["updated_at"]), strip(before, ["updated_at"]), "everything back exactly");
  console.log("ok 6 persona routes unchanged (kind 'persona', persona columns only, own undo rule)");

  assert.equal([await cfgRow(OTHER), await userRow(OTHER)].join("|"), otherBefore, "another account untouched throughout");
  console.log("ALL COMPANY SHEET RESET DB TESTS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
