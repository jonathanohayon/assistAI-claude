// Proof tool for CAMPAIGN_DISPATCH (lib/campaigns/dispatch-mode.ts), on a
// throwaway Postgres seeded with mock rows (campaigns …d1/…d2, contacts …e1/…e2).
//   DATABASE_URL=<throwaway> npx tsx scripts/campaign-dispatch-check.ts
// - off and dry: EVERY table byte-identical before/after, the dialer never called;
// - dry: the counts of what it would dial (no number / name / title);
// - a campaign start with the switch off: "running" set, 0 dialled;
// - on: dials (mock dialer) exactly what's due.
import { eq, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { campaignContacts, campaigns } from "../lib/db/schema";
import { dispatchDueJobs } from "../lib/campaigns/dispatch";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};

/** md5 of every public table's full content. */
async function snapshot(): Promise<Record<string, string>> {
  const t = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by 1`);
  const names = ((Array.isArray(t) ? t : (t as { rows: unknown[] }).rows) as Array<{ tablename: string }>).map((r) => r.tablename);
  const out: Record<string, string> = {};
  for (const n of names) {
    const r = await db.execute(sql.raw(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${n}" x`));
    out[n] = String(((Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Array<{ h: string }>)[0].h);
  }
  return out;
}
const diff = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

async function main() {
  // Setup: d1 running, open 24/7 (UTC), concurrency 2, 3 contacts due;
  //        d2 running, closed hours (0–0), 1 contact due.
  const allDays = { timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 };
  await db.update(campaigns).set({ status: "running", concurrency: 2, callWindow: allDays } as never).where(eq(campaigns.id, id("d1")));
  await db.update(campaigns).set({ status: "running", callWindow: { ...allDays, startHour: 0, endHour: 0 } } as never).where(eq(campaigns.id, id("d2")));
  await db.update(campaignContacts).set({ status: "queued", nextAttemptAt: null, claimedAt: null } as never);
  const [e1] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, id("e1")));
  for (const n of ["f1", "f2"]) {
    await db.insert(campaignContacts).values({ ...e1, id: id(n), phoneNumber: `+9725000000${n.slice(1)}` } as never).onConflictDoNothing();
  }

  let dials = 0;
  let dryWould = -1;
  const dial = (async () => {
    dials++;
    return {} as never;
  }) as never;

  // OFF (unset) and anything unknown.
  for (const env of [{}, { CAMPAIGN_DISPATCH: "" }, { CAMPAIGN_DISPATCH: "yes" }]) {
    const before = await snapshot();
    const r = await dispatchDueJobs(10, "cron", { env, dial });
    const after = await snapshot();
    ok(`off ${JSON.stringify(env)}: no row touched`, diff(before, after).length === 0, diff(before, after).join(","));
    ok(`off ${JSON.stringify(env)}: 0 dialled, reason given`, dials === 0 && "mode" in r && r.mode === "off" && r.claimed === 0, JSON.stringify(r));
  }

  // DRY: nothing written, nothing dialled, counts right, no personal data.
  {
    const before = await snapshot();
    const r = await dispatchDueJobs(10, "cron", { env: { CAMPAIGN_DISPATCH: "dry" }, dial });
    const after = await snapshot();
    ok("dry: no row touched", diff(before, after).length === 0, diff(before, after).join(","));
    ok("dry: 0 dialled", dials === 0 && r.claimed === 0);
    const w = "wouldDial" in r ? r.wouldDial : null;
    ok("dry: counts", JSON.stringify(w) === JSON.stringify({ campaignsDue: 1, contactsDue: 3, skippedCallHours: 1, skippedConcurrency: 0 }), JSON.stringify(w));
    dryWould = w?.contactsDue ?? -1;
    ok("dry: no number, name or title in the response", !/\+972|\d{8,}|[A-Za-z]{3,} [A-Za-z]{3,}/.test(JSON.stringify(w)));
    const limited = await dispatchDueJobs(1, "cron", { env: { CAMPAIGN_DISPATCH: "dry" }, dial });
    ok("dry: the limit applies", "wouldDial" in limited && limited.wouldDial.contactsDue === 1);
  }

  // A campaign START with the switch off: "running" set (the route's update), 0 dialled.
  {
    await db.update(campaigns).set({ status: "paused" } as never).where(eq(campaigns.id, id("d1")));
    await db.update(campaigns).set({ status: "running" } as never).where(eq(campaigns.id, id("d1"))); // what the status route does
    const before = await snapshot();
    const r = await dispatchDueJobs(2, "start", { env: {}, dial });
    const [c] = await db.select({ s: campaigns.status }).from(campaigns).where(eq(campaigns.id, id("d1")));
    ok("start, switch off: campaign running, 0 dialled, nothing else written", c.s === "running" && dials === 0 && r.dialed === 0 && diff(before, await snapshot()).length === 0);
  }

  // ON: dials what's due (mock dialer), today's path.
  {
    const r = await dispatchDueJobs(10, "cron", { env: { CAMPAIGN_DISPATCH: "on" }, dial });
    // Today's claim checks concurrency once per batch: all 3 of d1 go in one tick
    // (concurrency 2) — known issue, boarded. None of d2 (outside call hours).
    ok("on: dialled exactly what dry predicted", dials === dryWould && r.claimed === dryWould && r.dialed === dryWould && !("mode" in r), `${dials} vs dry ${dryWould}: ${JSON.stringify(r)}`);
    const calling = await db.select().from(campaignContacts).where(eq(campaignContacts.status, "calling"));
    ok("on: those contacts are 'calling', none of the closed campaign", calling.length === dryWould && calling.every((c) => c.campaignId === id("d1")));
  }

  console.log(failed ? `${failed} FAILED` : "ALL CAMPAIGN-DISPATCH CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
