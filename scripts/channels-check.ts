// C1 proof tool: the Channels adapters/loader give, for every seed account,
// agent and call origin, exactly the numbers and channel today's code paths
// use. Throwaway Postgres seeded with mock rows (…0a/…0b/…0c accounts,
// …c1/…c2 outbound agents, …d1/…d2 campaigns, …e1/…e2 contacts):
//   DATABASE_URL=<throwaway> npx tsx scripts/channels-check.ts
import { asc, eq } from "drizzle-orm";

import { db } from "../lib/db";
import { campaigns, outboundAgents, phoneNumbers } from "../lib/db/schema";
import { legacyChannelNumber } from "../lib/channels/adapters";
import { callChannel, loadChannels } from "../lib/channels/load";
import { resolveTenantByPhone } from "../lib/tenant";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

async function main() {
  for (const u of ["a", "b", "c"]) {
    const uid = id(u);
    // /api/dashboard/channels — the route's own query + former inline mapping.
    const rows = await db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, uid));
    const formerRoute = rows.map((row) => {
      const wa = row.phoneNumber.startsWith("whatsapp:");
      return { id: row.id, phoneNumber: wa ? row.phoneNumber.slice(9) : row.phoneNumber, channel: wa ? "whatsapp" : "pstn", label: row.label, countryCode: row.countryCode };
    });
    const ch = await loadChannels(uid, null);
    ok(`account ${u}: receptionist numbers = /api/dashboard/channels`, !!ch && JSON.stringify(byId(ch.numbers.map(legacyChannelNumber))) === JSON.stringify(byId(formerRoute)), `${rows.length} number(s)`);
    // Each number reaches THIS account (lib/tenant resolveTenantByPhone).
    for (const n of ch?.numbers ?? []) {
      const t = await resolveTenantByPhone(n.number);
      ok(`  ${n.channel} …${n.number.slice(-3)} reaches account ${u}`, t?.user.id === uid);
    }
    // call_me — the route's query: oldest number.
    const [line] = await db.select({ p: phoneNumbers.phoneNumber }).from(phoneNumbers).where(eq(phoneNumbers.userId, uid)).orderBy(asc(phoneNumbers.createdAt)).limit(1);
    const cm = await callChannel({ kind: "call_me", userId: uid });
    ok(`call_me ${u}: caller id = call-me route`, cm?.agentNumber === (line?.p ?? null) && cm?.direction === "outbound", String(cm?.agentNumber));
    const web = await callChannel({ kind: "web", userId: uid });
    ok(`web ${u}: no number`, web?.channel === "web" && web.agentNumber === null);
  }

  for (const ph of ["+97220000000", "+97220000001", "+97229999999"]) {
    const c = await callChannel({ kind: "phone", calledNumber: ph });
    ok(`phone …${ph.slice(-3)}: pstn, dialed number`, c?.channel === "pstn" && c.agentNumber === ph);
  }

  for (const [c, k] of [["d1", "e1"], ["d2", "e2"]]) {
    const [row] = await db.select({ f: campaigns.fromNumber }).from(campaigns).where(eq(campaigns.id, id(c)));
    const got = await callChannel({ kind: "campaign", campaignId: id(c), contactId: id(k) });
    // dispatch.ts: fromNumber: job.fromNumber || undefined (undefined = trunk default)
    ok(`campaign ${c}: caller id = dispatch`, got?.agentNumber === (row.f || null) && got?.channel === "pstn", JSON.stringify(row.f));
  }
  ok("campaign missing → null", (await callChannel({ kind: "campaign", campaignId: id("ff"), contactId: id("e1") })) === null);

  for (const a of ["c1", "c2"]) {
    const [row] = await db.select({ userId: outboundAgents.userId, channels: outboundAgents.channels }).from(outboundAgents).where(eq(outboundAgents.id, id(a)));
    const ch = await loadChannels(row.userId, id(a));
    const raw = (row.channels ?? {}) as { phone?: boolean; whatsappVoice?: boolean };
    ok(`outbound ${a}: switches as stored`, !!ch && ch.outbound?.phone === (raw.phone !== false) && ch.outbound?.whatsappVoice === (raw.whatsappVoice === true) && ch.numbers.length === 0, JSON.stringify(row.channels));
    const other = row.userId === id("a") ? id("b") : id("a");
    ok(`outbound ${a}: another account → null`, (await loadChannels(other, id(a))) === null);
    ok(`outbound_test ${a}: web`, (await callChannel({ kind: "outbound_test", agentId: id(a) }))?.channel === "web");
  }
  ok("vox → null (external)", (await callChannel({ kind: "vox", calledNumber: "+97220000000" })) === null);

  console.log(failed ? `${failed} FAILED` : "ALL CHANNELS CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
