// POST /api/calls/end — the REAL route handler against a THROWAWAY Postgres,
// with mock tool events: the client WhatsApp confirm goes out only after a
// proven book / cancel / reschedule, its text comes from the event, the caps
// hold, and the OWNER recap payload is byte-identical to origin/main's route
// for the same input.
//
// Nothing leaves the process: global fetch is replaced BEFORE any module loads
// and answers only the two URLs the route may call (Twilio Messages, OpenAI
// chat completions) with canned replies; any other URL throws. The Twilio and
// OpenAI "credentials" below are in-process fakes so the real sender and the
// real summarizer run up to the network boundary.
// Skipped in a plain `npm test`. Run with:
//   bash scripts/client-confirm-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read.
// Mock data only (+1555…, "Demo Salon").

import assert from "node:assert/strict";

const url = process.env.CLIENT_CONFIRM_DB_URL;
if (!url) {
  console.log("SKIPPED client-confirm-db (set CLIENT_CONFIRM_DB_URL — see scripts/client-confirm-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
// In-process fakes only (the harness runs with env -i).
Object.assign(process.env, {
  INTERNAL_SECRET: "test-internal-secret",
  WHATSAPP_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-not-a-token",
  TWILIO_WHATSAPP_FROM: "+15555550000",
  WHATSAPP_CLIENT_TEMPLATE_SID_FR: "HXclientfr",
  WHATSAPP_CLIENT_TEMPLATE_SID_HE: "HXclienthe",
  WHATSAPP_CLIENT_TEMPLATE_SID_EN: "HXclienten",
  WHATSAPP_OWNER_TEMPLATE_SID: "HXowner",
  REALTIME_API_KEY: "test-not-a-key",
  GOOGLE_CLIENT_ID: "test-google-client",
  GOOGLE_CLIENT_SECRET: "test-not-a-secret",
});
delete process.env.OPENAI_API_KEY;

// Toggled by the tests below: a failing summarizer (OpenAI 500).
const mockState = { openaiFails: false };
type Sent = { to: string; contentSid: string | null; vars: Record<string, string> | null; body: string | null; raw: string };
const sent: Sent[] = [];
const RECAP_CLIENT = "Merci Dana ! Votre RDV est pris pour demain 18h, offert par la maison.";
const RECAP_OWNER = "Dana a appelé. RDV jeudi 10:30. Tel +15555550101.";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith("https://api.openai.com/v1/chat/completions")) {
    if (mockState.openaiFails) return new Response(JSON.stringify({ error: { message: "mock outage" } }), { status: 500 });
    const content = JSON.stringify({ summary: "Mock summary", for_client: RECAP_CLIENT, for_owner: RECAP_OWNER });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACtest0+\/Messages\.json$/.test(u) && init?.method === "POST") {
    const raw = String(init.body);
    const p = new URLSearchParams(raw);
    const cv = p.get("ContentVariables");
    sent.push({ to: p.get("To") ?? "", contentSid: p.get("ContentSid"), vars: cv ? JSON.parse(cv) : null, body: p.get("Body"), raw });
    return new Response(JSON.stringify({ sid: `SMtest${sent.length}` }), { status: 201 });
  }
  if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACtest0+\/Messages\/SMtest\d+\.json$/.test(u)) {
    return new Response(JSON.stringify({ status: "delivered" }), { status: 200 });
  }
  throw new Error(`test: unexpected network call to ${u}`);
}) as typeof fetch;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const branch = await import("../../app/api/calls/end/route");
  const mainRoutePath = process.env.CLIENT_CONFIRM_MAIN_ROUTE;
  if (!mainRoutePath) throw new Error("CLIENT_CONFIRM_MAIN_ROUTE not set");
  const mainRoute = (await import(mainRoutePath)) as typeof branch;
  // The routes as on main just before this branch (cancel date + confirm order).
  const prevEndPath = process.env.CLIENT_CONFIRM_PREV_END_ROUTE;
  const prevCancelPath = process.env.CLIENT_CONFIRM_PREV_CANCEL_ROUTE;
  if (!prevEndPath || !prevCancelPath) throw new Error("CLIENT_CONFIRM_PREV_END_ROUTE / CLIENT_CONFIRM_PREV_CANCEL_ROUTE not set");
  const prevEnd = (await import(prevEndPath)) as typeof branch;
  const cancelBranch = await import("../../app/api/calendar/cancel/route");
  const prevCancel = (await import(prevCancelPath)) as typeof cancelBranch;
  const { hashCallId } = await import("../../lib/calls/core");

  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = <T>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
  const USER = "00000000-0000-4000-8000-0000000000c1";
  const CALLER = "+15555550101";
  const LINE = "+15555550199";
  const OWNER = "+15555550188";
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM app_settings`);
  await exec(sql`DELETE FROM users`);
  await exec(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${USER}, 'demo-salon@example.com', 'x', 'user')`);
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, owner_whatsapp, primary_language, business)
    VALUES (${USER}, 'x', 'x', ${OWNER}, 'fr', ${JSON.stringify({ identity: { name: "Demo Salon" } })}::jsonb)`);
  await exec(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${USER}, ${LINE})`);

  const reset = async () => {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM calls`);
    await exec(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
    sent.length = 0;
  };
  const toolEvent = (event: string, room: string, metadata: Record<string, unknown>) =>
    exec(sql`INSERT INTO events (source, event, message, level, user_id, metadata)
      VALUES ('calendar', ${event}, 'mock', 'info', ${USER}, ${JSON.stringify({ callId: hashCallId(room), ...metadata })}::jsonb)`);
  const TRANSCRIPT = [
    { role: "assistant", text: "Bonjour, Demo Salon, je vous écoute." },
    { role: "user", text: "Envoyez-moi un message gratuit pour demain 18h." },
  ];
  let seq = 0;
  const post = async (route: typeof branch, over: Record<string, unknown> = {}) => {
    const room = (over.room as string) ?? `room-${++seq}`;
    const body = { fromNumber: CALLER, toNumber: LINE, transcript: TRANSCRIPT, durationSeconds: 90, callId: hashCallId(room), ...over };
    delete (body as Record<string, unknown>).room;
    const req = new NextRequest("http://localhost/api/calls/end", {
      method: "POST",
      headers: { "x-internal-secret": "test-internal-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await route.POST(req);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const client = () => sent.filter((s) => s.to === `whatsapp:${CALLER}`);
  const owner = () => sent.filter((s) => s.to === `whatsapp:${OWNER}`);
  const callLine = "📞 Une question ? Appelez-nous : +15555550199";

  // ── A booking → one confirm, text from the event (template {{1}} only) ──
  await reset();
  await toolEvent("book_success", "room-book", { eventId: "gcal-1", date: "2026-11-19", time: "10:30", location: "Demo Salon Centre" });
  let r = await post(branch, { room: "room-book" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.delivered, { client: true, owner: true });
  assert.equal(client().length, 1);
  assert.equal(client()[0].contentSid, "HXclientfr", "same per-language SID as before");
  // Twilio's sender flattens newlines inside {{1}} to " · " (unchanged).
  assert.deepEqual(client()[0].vars, {
    "1": `Votre rendez-vous du jeudi 19 novembre à 10:30 est confirmé. · Lieu : Demo Salon Centre · — Demo Salon · ${callLine}`,
  });
  assert.ok(!client()[0].raw.includes("gratuit") && !client()[0].raw.includes("offert"), "nothing from the caller's words or the recap");

  // ── Cancel / reschedule → their texts ──
  await reset();
  await toolEvent("book_success", "room-old", { eventId: "gcal-2", date: "2026-11-21", time: "09:00" });
  await toolEvent("cancel_success", "room-cancel", { eventId: "gcal-2" });
  await post(branch, { room: "room-cancel" });
  assert.equal(client()[0].vars!["1"], `Votre rendez-vous du samedi 21 novembre à 09:00 est annulé. · — Demo Salon · ${callLine}`);
  await reset();
  await toolEvent("reschedule_success", "room-move", { eventId: "gcal-3", newDate: "2026-11-24", newTime: "16:15" });
  await post(branch, { room: "room-move" });
  assert.equal(client()[0].vars!["1"], `Votre rendez-vous a été déplacé au mardi 24 novembre à 16:15. · — Demo Salon · ${callLine}`);

  // ── NON-EMPTY transcript, NO tool event → NO client message (owner recap still sent) ──
  await reset();
  await toolEvent("call_transfer", "room-talk", { ok: true });
  // A booking stamped with ANOTHER call's id never leaks in.
  await toolEvent("book_success", "room-someone-else", { eventId: "gcal-9", date: "2026-11-19", time: "11:00" });
  r = await post(branch, { room: "room-talk" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.delivered, { client: false, owner: true });
  assert.equal(client().length, 0, "no client message without a proven event");
  assert.equal(owner().length, 1);
  const [skipEv] = rows<{ metadata: Record<string, unknown> }>(
    await exec(sql`SELECT metadata FROM events WHERE event = 'whatsapp_skipped_client'`),
  );
  assert.equal(skipEv.metadata.reason, "no_proven_event");

  // ── The 4th confirm to one number in a day → skipped ──
  await reset();
  for (let i = 1; i <= 4; i++) {
    await toolEvent("book_success", `room-cap-${i}`, { eventId: `gcal-c${i}`, date: "2026-11-19", time: "10:30" });
    await post(branch, { room: `room-cap-${i}` });
  }
  assert.equal(client().length, 3, "at most 3 per number per day");
  const capSkips = rows<{ metadata: Record<string, unknown> }>(
    await exec(sql`SELECT metadata FROM events WHERE event = 'whatsapp_skipped_client'`),
  );
  assert.deepEqual(capSkips.map((e) => [e.metadata.reason, e.metadata.scope]), [["rate_limited", "account"]]);

  // ── One confirm per destination per call (the worker retries the same call) ──
  await reset();
  await toolEvent("book_success", "room-retry", { eventId: "gcal-r", date: "2026-11-19", time: "10:30" });
  await post(branch, { room: "room-retry" });
  await post(branch, { room: "room-retry" });
  assert.equal(client().length, 1);

  // ── Nothing stored names the caller: confirm events and the ledgers ──
  const evs = rows<{ event: string; message: string; m: string }>(
    await exec(sql`SELECT event, message, metadata::text AS m FROM events WHERE event LIKE 'whatsapp_%client'`),
  );
  assert.ok(evs.length > 0);
  for (const e of evs) {
    assert.doesNotMatch(`${e.message} ${e.m}`, /5555550101/, e.event);
    assert.ok(!`${e.message} ${e.m}`.includes("Votre rendez-vous"), `no message text in ${e.event}`);
  }
  const ledgers = rows<{ key: string; value: string }>(await exec(sql`SELECT key, value FROM app_settings WHERE key LIKE 'rate_limit:client_confirm%'`));
  assert.deepEqual(ledgers.map((l) => l.key).sort(), ["rate_limit:client_confirm", "rate_limit:client_confirm_call"]);
  for (const l of ledgers) assert.doesNotMatch(l.value, /5555550101/);

  // ── whatsapp_confirm=false → nothing, as before ──
  await reset();
  const off: Record<string, Record<string, boolean>> = {};
  for (const plan of ["whatsapp", "global", "premium"]) off[plan] = { whatsapp_confirm: false };
  await exec(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('plan_features', ${JSON.stringify(off)}, now())`);
  await toolEvent("book_success", "room-off", { eventId: "gcal-o", date: "2026-11-19", time: "10:30" });
  await post(branch, { room: "room-off" });
  assert.equal(client().length, 0);
  await exec(sql`DELETE FROM app_settings WHERE key = 'plan_features'`);

  // ── Web live test (userId, no fromNumber) → nothing, as before ──
  await reset();
  await toolEvent("book_success", "room-web", { eventId: "gcal-w", date: "2026-11-19", time: "10:30" });
  r = await post(branch, { room: "room-web", fromNumber: "", toNumber: "", userId: USER });
  assert.equal(r.status, 200);
  assert.equal(client().length, 0);

  // ── WhatsApp channel: free-form Body = the same built text, no template ──
  await reset();
  await toolEvent("book_success", "room-wa", { eventId: "gcal-wa", date: "2026-11-19", time: "10:30" });
  await post(branch, { room: "room-wa", channel: "whatsapp" });
  assert.equal(client().length, 1);
  assert.equal(client()[0].contentSid, null);
  assert.equal(client()[0].body, `Votre rendez-vous du jeudi 19 novembre à 10:30 est confirmé.\n\n— Demo Salon\n\n${callLine}`);

  // ── OWNER recap byte-identical to origin/main's route, for the same input ──
  for (const scenario of ["booking", "no_tool_event", "whatsapp_channel"] as const) {
    const ownerPayload = async (route: typeof branch) => {
      await reset();
      if (scenario !== "no_tool_event") {
        await toolEvent("book_success", "room-same", { eventId: "gcal-s", date: "2026-11-19", time: "10:30" });
      }
      await post(route, { room: "room-same", ...(scenario === "whatsapp_channel" ? { channel: "whatsapp" } : {}) });
      assert.equal(owner().length, 1, scenario);
      return owner()[0].raw;
    };
    const onMain = await ownerPayload(mainRoute);
    const onBranch = await ownerPayload(branch);
    assert.equal(onBranch, onMain, `owner payload differs (${scenario})`);
    console.log(`owner recap byte-identical (${scenario}): ${onBranch.length} bytes`);
  }
  // And main DID send the LLM recap to the caller for a call that proved nothing.
  await reset();
  await post(mainRoute, { room: "room-main-talk" });
  assert.equal(client().length, 1, "main: recap sent with no tool event (the flaw)");
  assert.ok(client()[0].vars!["1"].startsWith(RECAP_CLIENT));

  // ═══ B. The confirm no longer waits for the transcript or the summary ═══
  // Same route response as main's route before this branch (callId = the new
  // row's id, differs per call → normalised); the owner recap is still skipped.
  const norm = (j: Record<string, unknown>) => JSON.stringify({ ...j, callId: "<row>" });
  for (const scenario of ["empty_transcript", "summary_failed"] as const) {
    const over = scenario === "empty_transcript" ? { transcript: [] } : {};
    const run = async (route: typeof branch, proven: boolean) => {
      await reset();
      if (proven) await toolEvent("book_success", "room-early", { eventId: "gcal-e", date: "2026-11-19", time: "10:30" });
      mockState.openaiFails = scenario === "summary_failed";
      try {
        return await post(route, { room: "room-early", ...over });
      } finally {
        mockState.openaiFails = false;
      }
    };
    // Proven booking → the confirm goes out, the owner recap does not.
    const onPrev = await run(prevEnd, true);
    assert.equal(client().length, 0, `main: nothing sent (${scenario})`);
    const onBranch = await run(branch, true);
    assert.equal(client().length, 1, `confirm sent (${scenario})`);
    assert.equal(client()[0].vars!["1"], `Votre rendez-vous du jeudi 19 novembre à 10:30 est confirmé. · — Demo Salon · ${callLine}`);
    assert.equal(owner().length, 0, `owner recap still skipped (${scenario})`);
    assert.equal(onBranch.status, onPrev.status, scenario);
    assert.equal(norm(onBranch.json), norm(onPrev.json), `same route response (${scenario})`);
    const [row] = rows<{ s: string | null; e: string | null }>(
      await exec(sql`SELECT whatsapp_client_sid AS s, whatsapp_error AS e FROM calls`),
    );
    assert.match(row.s ?? "", /^SMtest\d+$/, "the confirm SID is stored on the call row");
    if (scenario === "summary_failed") assert.match(row.e ?? "", /^summary: /, "summary error kept");
    console.log(`proven booking + ${scenario}: confirm sent, owner skipped, response ${onBranch.status} identical`);
    // No tool event → nothing at all, same response.
    const quietPrev = await run(prevEnd, false);
    const quiet = await run(branch, false);
    assert.equal(sent.length, 0, `nothing sent without a proven event (${scenario})`);
    assert.equal(quiet.status, quietPrev.status);
    assert.equal(norm(quiet.json), norm(quietPrev.json));
  }

  // ═══ A. The cancel stores the appointment's date; the confirm states it ═══
  // Google is mocked at gaxios' fetch (it uses window.fetch when a window
  // exists, node-fetch otherwise): token refresh, events.get, events.delete.
  // Set only for this section; any other Google URL throws.
  const google = { getFails: false, deleteFails: false, calls: [] as string[] };
  const G_EVENT = {
    id: "gcal-x",
    summary: "RDV Demo Salon Centre — Dana",
    description: `Rendez-vous\nLieu : Demo Salon Centre\nTel : ${CALLER}`,
    start: { dateTime: "2026-11-26T11:45:00+02:00", timeZone: "Asia/Jerusalem" },
    end: { dateTime: "2026-11-26T12:15:00+02:00", timeZone: "Asia/Jerusalem" },
  };
  const googleFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    google.calls.push(`${method} ${u.split("?")[0]}`);
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "test-access", expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.split("?")[0] === "https://www.googleapis.com/calendar/v3/calendars/primary/events/gcal-x") {
      if (method === "GET") {
        return google.getFails
          ? new Response(JSON.stringify({ error: { code: 403, message: "mock read failure" } }), { status: 403, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify(G_EVENT), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "DELETE") {
        return google.deleteFails
          ? new Response(JSON.stringify({ error: { code: 410, message: "Resource has been deleted" } }), { status: 410, headers: { "content-type": "application/json" } })
          : new Response(null, { status: 204 });
      }
    }
    throw new Error(`test: unexpected Google call ${method} ${u}`);
  };
  const g = globalThis as unknown as { window?: unknown };
  g.window = { fetch: googleFetch };
  await exec(sql`UPDATE users SET google_refresh_token = 'test-refresh-token' WHERE id = ${USER}`);
  const cancel = async (route: typeof cancelBranch, room: string) => {
    const req = new NextRequest("http://localhost/api/calendar/cancel", {
      method: "POST",
      headers: {
        "x-internal-secret": "test-internal-secret",
        "x-tenant-phone": LINE,
        "x-call-id": hashCallId(room),
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId: "gcal-x" }),
    });
    const res = await route.POST(req);
    return { status: res.status, text: await res.text() };
  };
  const cancelMeta = async () =>
    rows<{ metadata: Record<string, unknown> }>(await exec(sql`SELECT metadata FROM events WHERE event = 'cancel_success'`)).map((r) => r.metadata);
  try {
    // The cancel response to the worker is byte-identical to main's, in every case.
    for (const c of [{ name: "success" }, { name: "read_failed", getFails: true }, { name: "delete_failed", deleteFails: true }]) {
      google.getFails = !!c.getFails;
      google.deleteFails = !!c.deleteFails;
      await reset();
      const before = await cancel(prevCancel, "room-cx");
      await reset();
      google.calls.length = 0;
      const after = await cancel(cancelBranch, "room-cx");
      assert.equal(after.status, before.status, c.name);
      assert.equal(after.text, before.text, `cancel response byte-identical (${c.name})`);
      assert.deepEqual(
        google.calls.filter((x) => !x.includes("oauth2")),
        ["GET https://www.googleapis.com/calendar/v3/calendars/primary/events/gcal-x", "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/gcal-x"],
        `one read, then the delete (${c.name})`,
      );
      console.log(`cancel response byte-identical (${c.name}): ${after.status} ${after.text}`);
    }
    google.getFails = false;
    google.deleteFails = false;

    // Success: cancel_success carries date/time/place only, and the confirm states them.
    await reset();
    await cancel(cancelBranch, "room-cancel-dated");
    const [m] = await cancelMeta();
    assert.deepEqual(m, { callId: hashCallId("room-cancel-dated"), eventId: "gcal-x", date: "2026-11-26", time: "11:45", location: "Demo Salon Centre" });
    assert.doesNotMatch(JSON.stringify(m), /5555550101|Dana/, "no caller number or name in the cancel event");
    await post(branch, { room: "room-cancel-dated" });
    assert.equal(client().length, 1);
    assert.equal(client()[0].vars!["1"], `Votre rendez-vous du jeudi 26 novembre à 11:45 est annulé. · Lieu : Demo Salon Centre · — Demo Salon · ${callLine}`);

    // Read failure: the event has no date → the old fallback (no book event here → no date).
    google.getFails = true;
    await reset();
    await cancel(cancelBranch, "room-cancel-blind");
    const [m2] = await cancelMeta();
    assert.deepEqual(m2, { callId: hashCallId("room-cancel-blind"), eventId: "gcal-x" }, "logged without the date, as before");
    await post(branch, { room: "room-cancel-blind" });
    assert.equal(client()[0].vars!["1"], `Votre rendez-vous est annulé. · — Demo Salon · ${callLine}`);
    // ...and with an earlier booking of that event, its date (the old lookup).
    await reset();
    await toolEvent("book_success", "room-old-x", { eventId: "gcal-x", date: "2026-11-21", time: "09:00" });
    await cancel(cancelBranch, "room-cancel-blind2");
    await post(branch, { room: "room-cancel-blind2" });
    assert.equal(client()[0].vars!["1"], `Votre rendez-vous du samedi 21 novembre à 09:00 est annulé. · — Demo Salon · ${callLine}`);
    console.log("cancel stores its date; read failure falls back to the old chain");
  } finally {
    delete g.window;
    await exec(sql`UPDATE users SET google_refresh_token = NULL WHERE id = ${USER}`);
  }

  console.log("ALL CLIENT-CONFIRM-DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
