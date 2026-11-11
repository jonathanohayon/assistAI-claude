// Proof tool for the claim fixes (lib/campaigns/claim.ts), on a throwaway
// Postgres seeded with mock rows (campaign …d1 of account …0a, …d2 of …0b).
//   DATABASE_URL=<throwaway> npx tsx scripts/campaign-claim-check.ts
// (a) 2 accounts × 2 running campaigns: a START of A dials only A's contacts;
// (b) concurrency 2, 0 in flight, 4 due → at most 2 claimed in one tick;
// (c) within its concurrency, a campaign is dialled as before (the cron).
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { campaignContacts, campaigns } from "../lib/db/schema";
import { dispatchDueJobs } from "../lib/campaigns/dispatch";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const OPEN = { timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 };
const ON = { CAMPAIGN_DISPATCH: "on" };

/** Fresh state: 4 running campaigns (2 per account), N queued contacts each. */
async function reset(perCampaign: number, concurrency: number) {
  await db.delete(campaignContacts);
  const [d1] = await db.select().from(campaigns).where(eq(campaigns.id, id("d1")));
  const [d2] = await db.select().from(campaigns).where(eq(campaigns.id, id("d2")));
  for (const [cid, base] of [["d3", d1], ["d4", d2]] as const) {
    await db.insert(campaigns).values({ ...base, id: id(cid), name: `mock ${cid}` } as never).onConflictDoNothing();
  }
  await db.update(campaigns).set({ status: "running", concurrency, callWindow: OPEN } as never);
  const owner: Record<string, string> = { d1: id("a"), d3: id("a"), d2: id("b"), d4: id("b") };
  for (const c of ["d1", "d2", "d3", "d4"]) {
    for (let i = 0; i < perCampaign; i++) {
      await db.insert(campaignContacts).values({
        id: id(`${c}${i}`.replace("d", "f")),
        campaignId: id(c),
        userId: owner[c],
        phoneNumber: `+97250000${c.slice(1)}${i}0`,
        contactName: "",
        status: "queued",
      } as never);
    }
  }
}

async function main() {
  // (a) A START of d1 (account a) dials only d1 — not d3 (same account), not d2/d4 (account b).
  await reset(2, 5);
  const dialled: string[] = [];
  const dial = (async (o: { campaignId?: string }) => {
    dialled.push(o.campaignId ?? "?");
    return {} as never;
  }) as never;
  const a = await dispatchDueJobs(5, "start", { env: ON, dial }, { campaignId: id("d1") });
  ok("(a) a start of A dials only A's contacts", dialled.length === 2 && dialled.every((c) => c === id("d1")), `${a.dialed} dialled: ${[...new Set(dialled)].map((c) => c.slice(-2))}`);
  const others = await db.select().from(campaignContacts).where(inArray(campaignContacts.campaignId, [id("d2"), id("d3"), id("d4")]));
  ok("(a) …every other campaign's contacts untouched (queued, 0 attempts)", others.length === 6 && others.every((c) => c.status === "queued" && c.attempts === 0));
  // The cron still serves every running campaign.
  dialled.length = 0;
  await dispatchDueJobs(50, "cron", { env: ON, dial });
  ok("(a) the cron still dials every running campaign", new Set(dialled).size === 3, `${new Set(dialled).size} campaigns`);

  // (b) concurrency 2, 0 in flight, 4 due → 2 per campaign in ONE tick (was: up to the limit).
  await reset(4, 2);
  dialled.length = 0;
  const b = await dispatchDueJobs(50, "cron", { env: ON, dial });
  const per = Object.values(dialled.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}));
  ok("(b) at most the concurrency per campaign in one tick", b.claimed === 8 && per.length === 4 && per.every((n) => n === 2), JSON.stringify(per));
  const inFlight = await db.execute(sql`select campaign_id, count(*)::int n from campaign_contacts where status in ('claimed','calling') group by 1`);
  const rows = (Array.isArray(inFlight) ? inFlight : (inFlight as { rows: unknown[] }).rows) as Array<{ n: number }>;
  ok("(b) in flight never above concurrency", rows.every((r) => r.n <= 2));
  // A second tick adds nothing (all slots taken).
  dialled.length = 0;
  await dispatchDueJobs(50, "cron", { env: ON, dial });
  ok("(b) a second tick, slots full → 0", dialled.length === 0);
  // Dry agrees with on.
  await reset(4, 2);
  const dry = await dispatchDueJobs(50, "cron", { env: { CAMPAIGN_DISPATCH: "dry" }, dial });
  ok("(b) dry predicts the same", "wouldDial" in dry && dry.wouldDial.contactsDue === 8 && dry.wouldDial.skippedConcurrency === 8, JSON.stringify("wouldDial" in dry && dry.wouldDial));

  console.log(failed ? `${failed} FAILED` : "ALL CAMPAIGN-CLAIM CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
