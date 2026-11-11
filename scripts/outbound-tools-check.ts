// T4 proof tool: tools on OUTBOUND calls against a throwaway Postgres seeded
// with mock rows (…0a/…0b/…0c accounts, …c1 outbound agent of …0a, …c2 of
// …0b, …d1 campaign of …0a with …c1, …e1 its contact, +97220000000 = …0a,
// +97220000001 = …0c, …0a transfer number set, …0b none).
//   DATABASE_URL=<throwaway> INTERNAL_SECRET=mock npx tsx scripts/outbound-tools-check.ts
// It WRITES to that database (mock Google token, roles, tools) — never run it
// on a real one. OUTBOUND_TOOLS is set in-process per case (never a deploy).
// Checks:
//   ON  — switch "all" + booking/transfer toggled: the campaign and agent-test
//         payloads serve the receptionist's calendar + transfer, routed by
//         the campaign owner's id (whatever the campaign's caller id);
//         "admin" enables only an admin owner; off again = the first bytes.
//   GATE — writeTools refuses turning a tool on when the switch is off.
//   IDENTITY — an outbound-marked tool request routes by x-tenant-user-id
//         only; a phone alone is refused at every tool route.
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "../lib/db";
import { campaigns, outboundAgents, users } from "../lib/db/schema";
import { resolveAgentCallerGoogle } from "../lib/google";
import { OUTBOUND_TOOLS } from "../lib/tools/adapters";
import { capabilityInputsFor } from "../lib/tools/load";
import { writeTools } from "../lib/tools/write";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
const [A, Bacct, C1, C2] = [id("a"), id("b"), id("c1"), id("c2")];
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const setSwitch = (v: string | undefined) => {
  if (v === undefined) delete process.env.OUTBOUND_TOOLS;
  else process.env.OUTBOUND_TOOLS = v;
};
const toolsJson = (booking: boolean, transfer: boolean) => ({
  ...OUTBOUND_TOOLS,
  booking: { ...OUTBOUND_TOOLS.booking, enabled: booking },
  transfer: { ...OUTBOUND_TOOLS.transfer, enabled: transfer },
});
const setAgentTools = (agentId: string, v: unknown) =>
  db.update(outboundAgents).set({ toolsConfig: v } as never).where(eq(outboundAgents.id, agentId));

async function main() {
  const SECRET = process.env.INTERNAL_SECRET!;
  const H = { "x-internal-secret": SECRET };
  const { GET: config } = await import("../app/api/agent/config/route");
  const { GET: camp } = await import("../app/api/agent/campaign-config/route");
  const { GET: otest } = await import("../app/api/agent/outbound-test-config/route");
  const { GET: single } = await import("../app/api/agent/session-config/route");
  const get = async (h: (r: NextRequest) => Promise<Response>, q: string) =>
    mask(await (await h(new NextRequest(`http://localhost/x?${q}`, { headers: H }))).text());
  const qCamp = `campaignId=${id("d1")}&contactId=${id("e1")}`;
  const snap = async () => ({
    camp: await get(camp, qCamp),
    otestC1: await get(otest, `agentId=${C1}`),
    otestC2: await get(otest, `agentId=${C2}`),
    single: await get(single, `origin=campaign&${qCamp}`),
  });

  // Mock prerequisites: …0a has Google (mock token, never used on the network).
  await db.update(users).set({ googleRefreshToken: "mock-refresh-token" } as never).where(eq(users.id, A));
  await setAgentTools(C1, toolsJson(true, true));
  await setAgentTools(C2, toolsJson(true, true));

  // ── OFF (switch unset): no tool, no added field ───────────────────────
  setSwitch(undefined);
  const off = await snap();
  for (const [k, t] of Object.entries(off)) {
    const j = JSON.parse(t);
    ok(`off ${k}: no tool`, j.features.calendar === false && !("accountId" in j) && !("transferNumber" in j));
  }

  // ── ON ("all"): the receptionist's calendar + transfer ────────────────
  setSwitch("all");
  const rec = JSON.parse(await get(config, `userId=${A}`));
  ok("receptionist a: calendar on, transfer number served", rec.features.calendar === true && rec.transferNumber !== "", rec.transferNumber);
  for (const [k, t] of Object.entries(await snap())) {
    if (k === "otestC2") continue;
    const j = JSON.parse(t);
    ok(`all ${k}: calendar = receptionist's`, j.features.calendar === rec.features.calendar);
    ok(`all ${k}: crm off (no contacts outbound)`, j.features.crm === false);
    ok(`all ${k}: transferNumber = receptionist's`, j.transferNumber === rec.transferNumber);
    ok(`all ${k}: accountId = the owner`, j.accountId === A);
  }
  {
    // …0b has no transfer number: booking only, no transferNumber field.
    const j = JSON.parse((await snap()).otestC2);
    ok("all c2 (no number): booking on, no transferNumber", j.features.calendar === true && j.accountId === Bacct && !("transferNumber" in j));
  }
  // Booking only → accountId, no transfer number.
  await setAgentTools(C1, toolsJson(true, false));
  {
    const j = JSON.parse(await get(camp, qCamp));
    ok("all, booking only: accountId, no transferNumber", j.features.calendar === true && j.accountId === A && !("transferNumber" in j));
  }
  // Transfer only → no calendar, transfer number.
  await setAgentTools(C1, toolsJson(false, true));
  {
    const j = JSON.parse(await get(camp, qCamp));
    ok("all, transfer only: no calendar, transfer number", j.features.calendar === false && j.transferNumber === rec.transferNumber && j.accountId === A);
  }
  await setAgentTools(C1, toolsJson(true, true));

  // A campaign whose caller id is ANOTHER account's number (…0c's): the
  // served account is still the campaign owner — nothing comes from it.
  await db.update(campaigns).set({ fromNumber: "+97220000001" } as never).where(eq(campaigns.id, id("d1")));
  {
    const j = JSON.parse(await get(camp, qCamp));
    ok("all, caller id of another account: accountId = owner", j.accountId === A && j.transferNumber === rec.transferNumber);
  }
  await db.update(campaigns).set({ fromNumber: "" } as never).where(eq(campaigns.id, id("d1")));
  {
    const j = JSON.parse(await get(camp, qCamp));
    ok("all, campaign without fromNumber: accountId = owner", j.accountId === A);
  }

  // ── "admin": only an admin owner ──────────────────────────────────────
  setSwitch("admin");
  ok("admin, owner not admin: = off bytes", JSON.stringify(await snap()) === JSON.stringify(off));
  await db.update(users).set({ role: "admin" } as never).where(eq(users.id, A));
  {
    const s = await snap();
    ok("admin, owner admin: campaign tools on", JSON.parse(s.camp).accountId === A && JSON.parse(s.camp).features.calendar === true);
    ok("admin, owner admin: agent test tools on", JSON.parse(s.otestC1).accountId === A);
    ok("admin: another (non-admin) account stays off", s.otestC2 === off.otestC2);
    ok("admin: screen/PUT input for the admin owner", (await capabilityInputsFor(A)).account.outboundToolsEnabled === true);
    ok("admin: screen/PUT input for a non-admin", (await capabilityInputsFor(Bacct)).account.outboundToolsEnabled === false);
  }
  await db.update(users).set({ role: "user" } as never).where(eq(users.id, A));

  // ── Off again: byte-identical to the first OFF snapshot ──────────────
  setSwitch(undefined);
  ok("switch unset again: bytes = first off", JSON.stringify(await snap()) === JSON.stringify(off));

  // ── GATE: the outbound PUT path (writeTools) ──────────────────────────
  await setAgentTools(C1, toolsJson(false, false));
  const readC1 = async () => JSON.stringify((await db.select({ t: outboundAgents.toolsConfig }).from(outboundAgents).where(eq(outboundAgents.id, C1)))[0].t);
  const before = await readC1();
  const r1 = await writeTools(A, C1, { booking: { enabled: true } }, false);
  ok("gate off: booking on → 403 outbound_tools_disabled naming the field",
    !r1.ok && r1.status === 403 && r1.body.error === "outbound_tools_disabled" && JSON.stringify(r1.body.fields) === '["tools.booking.enabled"]', JSON.stringify(!r1.ok && r1.body));
  ok("gate off: refused write changed nothing", (await readC1()) === before);
  ok("gate off: unchanged re-send passes", (await writeTools(A, C1, { booking: { enabled: false } }, false)).ok);
  ok("gate off: another field passes", (await writeTools(A, C1, { booking: { defaultDurationMinutes: 45 } }, false)).ok);
  await setAgentTools(C1, toolsJson(true, true));
  ok("gate off: turning one OFF passes", (await writeTools(A, C1, { transfer: { enabled: false } }, false)).ok);
  ok("gate on: booking/transfer can be turned on", (await writeTools(A, C1, { transfer: { enabled: true } }, true)).ok);
  const r2 = await writeTools(A, C1, { contacts: { enabled: true }, orders: { enabled: true } }, true);
  ok("gate on: contacts/orders refused outbound", !r2.ok && r2.status === 403 && JSON.stringify(r2.body.fields) === '["tools.contacts.enabled","tools.orders.enabled"]');

  // ── IDENTITY ──────────────────────────────────────────────────────────
  const hdr = (o: Record<string, string>) => ({ headers: new Headers({ "x-internal-secret": SECRET, ...o }) });
  const mode = async (o: Record<string, string>) => {
    const r = await resolveAgentCallerGoogle(hdr(o));
    return r.mode === "tenant" ? `tenant:${r.userId}` : r.mode === "unknown_tenant" ? `unknown:${r.dialedPhone}` : r.mode;
  };
  const OUT = { "x-call-direction": "outbound" };
  ok("outbound + a's phone only → refused", (await mode({ ...OUT, "x-tenant-phone": "+97220000000" })) === "unknown:");
  ok("outbound + nothing → refused", (await mode(OUT)) === "unknown:");
  ok("outbound + user id a + c's phone → a (phone ignored)", (await mode({ ...OUT, "x-tenant-user-id": A, "x-tenant-phone": "+97220000001" })) === `tenant:${A}`);
  ok("outbound + user id b + a's phone → b's (no Google), never a", (await mode({ ...OUT, "x-tenant-user-id": Bacct, "x-tenant-phone": "+97220000000" })) === "user_no_google");
  {
    const r = await resolveAgentCallerGoogle({ headers: new Headers({ ...OUT, "x-tenant-user-id": A }) });
    ok("outbound without the secret → refused (no session / demo fallback)", r.mode === "unknown_tenant");
  }
  ok("inbound a's phone → a", (await mode({ "x-tenant-phone": "+97220000000" })) === `tenant:${A}`);
  ok("inbound phone wins over user id (as before)", (await mode({ "x-tenant-phone": "+97220000000", "x-tenant-user-id": Bacct })) === `tenant:${A}`);
  ok("inbound unknown phone → unknown_tenant with the phone", (await mode({ "x-tenant-phone": "+97229999999" })) === "unknown:+97229999999");

  // Every tool route refuses an outbound request carrying only a phone
  // (a's number: inbound, it would resolve to a).
  const post = async (path: string, body: unknown, o: Record<string, string>) => {
    const { POST } = await import(`../app/api/${path}/route`);
    const res: Response = await POST(new NextRequest(`http://localhost/api/${path}`, { method: "POST", ...hdr(o), body: JSON.stringify(body) }));
    return { status: res.status, body: await res.text() };
  };
  const phoneOnly = { ...OUT, "x-tenant-phone": "+97220000000", "content-type": "application/json" };
  const routes: Array<[string, unknown]> = [
    ["calendar/availability", { date: "2030-01-07" }],
    ["calendar/book", { name: "Mock", phone: "+972500000000", date: "2030-01-07", time: "10:00" }],
    ["calendar/cancel", { eventId: "mock-event" }],
    ["calendar/find", { phone: "+972500000000" }],
    ["calendar/reschedule", { eventId: "mock-event", newDate: "2030-01-07", newTime: "10:00" }],
    ["sheets/contact", { name: "Mock", phone: "+972500000000" }],
    ["sheets/call-log", { phone: "+972500000000", summary: "mock" }],
    ["orders/record", { name: "Mock", phone: "+972500000000", item: "mock" }],
    ["whatsapp/notify", { message: "mock" }],
  ];
  for (const [path, body] of routes) {
    const r = await post(path, body, phoneOnly);
    ok(`route ${path}: outbound phone-only → 4xx refused`, r.status >= 400 && r.status < 500 && /inconnu|unknown_tenant/i.test(r.body), `${r.status} ${r.body.slice(0, 80)}`);
  }
  // With the account id, orders/whatsapp resolve a (then stop on a's own settings).
  const withId = { ...OUT, "x-tenant-user-id": A, "x-tenant-phone": "+97220000001", "content-type": "application/json" };
  {
    const r = await post("orders/record", { name: "Mock", item: "mock" }, withId);
    ok("orders/record: outbound + user id a → a's toggle (orders off)", r.status === 403 && r.body.includes("orders_disabled"), `${r.status} ${r.body}`);
    const w = await post("whatsapp/notify", { message: "mock" }, withId);
    ok("whatsapp/notify: outbound + user id a → a (no owner WhatsApp)", w.status === 409, `${w.status}`);
  }

  console.log(failed ? `${failed} FAILED` : "ALL OUTBOUND-TOOLS CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
