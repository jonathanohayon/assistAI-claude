// T3 proof tool: the Tools store against a throwaway Postgres seeded with
// mock rows (…0a/…0b accounts, …c1 outbound agent of …0a, +97220000000 = …0a).
//   DATABASE_URL=<throwaway> INTERNAL_SECRET=mock npx tsx scripts/tools-store-check.ts
// Checks: identical read-back when never written; transfer OFF keeps the
// number / ON restores it; a tools write commits toggles + columns in ONE
// transaction (forced failure rolls both back); invalid writes change
// nothing; legacy writes refresh the store; outbound stored only; the call
// routes serve today's bytes after a round trip; outbound writes pass the
// T4 gate only when OUTBOUND_TOOLS allows the account.
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "../lib/db";
import { agentConfigs, appSettings, outboundAgents } from "../lib/db/schema";
import { getTileToggles } from "../lib/tile-toggles";
import { toolsFromTileToggles } from "../lib/tools/adapters";
import { legacyTransferWriteUpdates, setTileTogglesSyncingTools } from "../lib/tools/legacy-sync";
import { currentReceptionistTools, parseTools } from "../lib/tools/store";
import { writeTools } from "../lib/tools/write";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
const A = id("a");
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};

async function main() {
  const H = { "x-internal-secret": process.env.INTERNAL_SECRET! };
  const { GET: config } = await import("../app/api/agent/config/route");
  const { GET: otest } = await import("../app/api/agent/outbound-test-config/route");
  const callA = async () => mask(await (await config(new NextRequest("http://l/x?phone=%2B97220000000", { headers: H }))).text());
  const otestC1 = async () => mask(await (await otest(new NextRequest(`http://l/x?agentId=${id("c1")}`, { headers: H }))).text());
  const rowA = async () =>
    (await db
      .select({ toolsConfig: agentConfigs.toolsConfig, transferNumber: agentConfigs.transferNumber, transferNumberParked: agentConfigs.transferNumberParked })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, A)))[0];
  const settings = async () => (await db.select().from(appSettings).where(eq(appSettings.key, "tenant_tile_toggles")))[0]?.value ?? null;

  // 1. Never written: identical read-back for every account.
  for (const u of ["a", "b", "c"]) {
    const [r] = await db
      .select({ toolsConfig: agentConfigs.toolsConfig, transferNumber: agentConfigs.transferNumber, transferNumberParked: agentConfigs.transferNumberParked })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, id(u)));
    const t = await getTileToggles(id(u));
    ok(`read-back ${u}`, r.toolsConfig === null && JSON.stringify(currentReceptionistTools(r, t)) === JSON.stringify(toolsFromTileToggles(t)));
  }

  const before = await callA();
  const number = (await rowA()).transferNumber;
  ok("seed: account a has a transfer number", number !== "");

  // 2. Transfer OFF keeps the number, ON restores it.
  ok("write OFF", (await writeTools(A, null, { transfer: { enabled: false } })).ok);
  let r = await rowA();
  ok("OFF: nothing served, number parked", r.transferNumber === "" && r.transferNumberParked === number);
  ok("OFF: the call gets no transfer number", JSON.parse(await callA()).transferNumber === "");
  ok("OFF: legacy re-send of '' changes nothing", JSON.stringify(await legacyTransferWriteUpdates(A, "")) === "{}");
  ok("write ON", (await writeTools(A, null, { transfer: { enabled: true } })).ok);
  r = await rowA();
  ok("ON: number restored, nothing parked", r.transferNumber === number && r.transferNumberParked === null);
  ok("ON: the call is byte-identical to before", (await callA()) === before);

  // 3. Switches write the toggles (the calls' read source).
  ok("write switches", (await writeTools(A, null, { booking: { enabled: false }, orders: { enabled: true } })).ok);
  ok("toggles written", JSON.stringify(await getTileToggles(A)) === JSON.stringify({ calendar: false, customers: true, orders: true }));
  const off = JSON.parse(await callA());
  ok("call: calendar off, orders per plan", off.features.calendar === false && off.ordersEnabled === Boolean(off.features.crm));
  ok("restore switches", (await writeTools(A, null, { booking: { enabled: true }, orders: { enabled: false } })).ok);
  ok("restored: call byte-identical to before", (await callA()) === before);
  ok("stored tools valid", parseTools((await rowA()).toolsConfig).ok);

  // 4. Invalid writes change nothing.
  const [rowBefore, setBefore] = [JSON.stringify(await rowA()), await settings()];
  const bad = await writeTools(A, null, { booking: { enabled: "yes" }, plan: { calendar: true } });
  ok("invalid → 400 invalid_tools", !bad.ok && bad.status === 400 && bad.body.error === "invalid_tools", JSON.stringify(!bad.ok && bad.body.fields));
  ok("invalid: nothing written", JSON.stringify(await rowA()) === rowBefore && (await settings()) === setBefore);

  // 5. ONE transaction: a failing column update rolls the toggles back too.
  await db.execute(sql.raw(`create or replace function t3_fail() returns trigger as $$ begin raise exception 't3 forced failure'; end $$ language plpgsql;
    create trigger t3_fail before update on agent_configs for each row execute function t3_fail();`));
  let threw = false;
  try {
    await writeTools(A, null, { contacts: { enabled: false } });
  } catch {
    threw = true;
  }
  await db.execute(sql.raw(`drop trigger t3_fail on agent_configs; drop function t3_fail();`));
  ok("forced failure: write throws", threw);
  ok("forced failure: toggles rolled back", (await settings()) === setBefore && (await getTileToggles(A)).customers === true);

  // 6. Legacy writes refresh the store.
  await setTileTogglesSyncingTools(A, { customers: false });
  ok("legacy toggle → stored contacts off", parseTools((await rowA()).toolsConfig).ok && (await rowA() as { toolsConfig: { contacts: { enabled: boolean } } }).toolsConfig.contacts.enabled === false);
  await setTileTogglesSyncingTools(A, { customers: true });
  await writeTools(A, null, { transfer: { enabled: false } });
  const legacy = await legacyTransferWriteUpdates(A, "+97250000009");
  ok("legacy new number while OFF → unpark + store ON", (legacy as { transferNumberParked?: null }).transferNumberParked === null && "toolsConfig" in legacy);
  await writeTools(A, null, { transfer: { enabled: true } });
  ok("round trip: call byte-identical to before", (await callA()) === before);

  // 7. Outbound: stored only, owner-checked, call unchanged.
  const ob = await otestC1();
  // T4: with OUTBOUND_TOOLS off for the account, turning a tool on is refused…
  const gated = await writeTools(A, id("c1"), { booking: { enabled: true }, transfer: { enabled: true } });
  ok("outbound write, switch off → 403", !gated.ok && gated.status === 403 && gated.body.error === "outbound_tools_disabled");
  // …and allowed when the switch is on for it (the stored value; the call
  // below still has no tool: OUTBOUND_TOOLS is unset in this process).
  ok("outbound write", (await writeTools(A, id("c1"), { booking: { enabled: true }, transfer: { enabled: true } }, true)).ok);
  const [c1] = await db.select({ t: outboundAgents.toolsConfig }).from(outboundAgents).where(eq(outboundAgents.id, id("c1")));
  ok("outbound stored", parseTools(c1.t).ok && (c1.t as { booking: { enabled: boolean } }).booking.enabled === true);
  ok("outbound call unchanged (still no tools)", (await otestC1()) === ob);
  const other = await writeTools(id("b"), id("c1"), { booking: { enabled: true } });
  ok("another account's agent → 404", !other.ok && other.status === 404);

  console.log(failed ? `${failed} FAILED` : "ALL TOOLS-STORE CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
