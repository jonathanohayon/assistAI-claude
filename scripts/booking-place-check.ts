// Proof tool for the generic booking place (lib/booking-place.ts), against a
// throwaway Postgres seeded with mock rows (+97220000000 = account …0a, no
// Google connected).
//   OUT=/tmp/x.json DATABASE_URL=<throwaway> INTERNAL_SECRET=mock npx tsx scripts/booking-place-check.ts
// - LEGACY requests (no `location` key): written to OUT — run on main and
//   on the branch and diff (must be byte-identical).
// - NEW requests (with `location`) + the company-sheet rule reaching the
//   agent's instructions: asserted (branch only, CHECK_NEW=1).
import { writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "../lib/db";
import { agentConfigs, events, users } from "../lib/db/schema";
import { currentCompanySheet, planSheetWrite } from "../lib/knowledge/store";

const A = "00000000-0000-0000-0000-00000000000a";
const H = () => ({
  "x-internal-secret": process.env.INTERNAL_SECRET!,
  "x-tenant-phone": "+97220000000",
  "content-type": "application/json",
});
const MON = "2030-01-07"; // a Monday (legacy rule: Ashdod only)
const TUE = "2030-01-08";

async function main() {
  const book = (await import("../app/api/calendar/book/route")).POST;
  const avail = (await import("../app/api/calendar/availability/route")).POST;
  const resched = (await import("../app/api/calendar/reschedule/route")).POST;
  const call = async (h: (r: NextRequest) => Promise<Response>, body: unknown) => {
    const res = await h(new NextRequest("http://l/x", { method: "POST", headers: H(), body: JSON.stringify(body) }));
    return { status: res.status, text: await res.text() };
  };
  const booking = { name: "Dana", phone: "+97250000000", time: "10:00", duration: 30 };

  const legacy = {
    bookWrongCentre: await call(book, { ...booking, date: MON, center: "jerusalem" }),
    bookRightCentre: await call(book, { ...booking, date: MON, center: "ashdod" }),
    bookNoCentre: await call(book, { ...booking, date: TUE }),
    availWrong: await call(avail, { date: MON, center: "natanya" }),
    availNoCentre: await call(avail, { date: TUE }),
    reschedWrong: await call(resched, { eventId: "e1", newDate: MON, newTime: "10:00", center: "jerusalem" }),
    reschedBadDate: await call(resched, { eventId: "e1", newDate: "nope", newTime: "10:00" }),
  };
  writeFileSync(process.env.OUT!, JSON.stringify(legacy, null, 1));
  if (!process.env.CHECK_NEW) process.exit(0);

  let failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failed++;
  };
  const wrongCentreEvents = async () =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(events).where(eq(events.event, "book_wrong_center")))[0].n;

  ok("legacy: wrong centre refused", legacy.bookWrongCentre.status === 400 && legacy.bookWrongCentre.text.includes("wrong_day_for_center"));
  // NEW: a `location` — the weekday rule no longer applies; the request goes
  // on to the calendar (409 = this mock account has no Google connected).
  const before = await wrongCentreEvents();
  const nb = await call(book, { ...booking, date: MON, center: "jerusalem", location: "Salon Rivoli" });
  ok("new: Monday + any place → not refused by a weekday rule", nb.status === 409 && !nb.text.includes("wrong_day"), `${nb.status} ${nb.text}`);
  ok("new: no book_wrong_center event", (await wrongCentreEvents()) === before);
  const na = await call(avail, { date: MON, center: "natanya", location: null });
  ok("new: availability not refused by a weekday rule", na.status === 409 && !na.text.includes("wrong_day"), `${na.status} ${na.text}`);
  const nr = await call(resched, { eventId: "e1", newDate: MON, newTime: "10:00", center: "jerusalem", location: "Salon Rivoli" });
  ok("new: reschedule not refused by a weekday rule", nr.status === 409 && !nr.text.includes("wrong_day"), `${nr.status} ${nr.text}`);
  const nbad = await call(book, { ...booking, date: "2030-02-30", location: null });
  ok("new: invalid date still refused", nbad.status === 400, nbad.text);

  // The tenant's OWN rule, written in the company sheet's "location rules"
  // (what the Knowledge screen saves), reaches the agent's instructions.
  const RULE = "Lundi → uniquement à Ashdod. Mercredi → uniquement à Natanya.";
  const [row] = await db
    .select({ companySheet: users.companySheet, business: agentConfigs.business })
    .from(users)
    .innerJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, A));
  const plan = planSheetWrite(currentCompanySheet(row.companySheet, row.business), { locationRules: RULE });
  ok("sheet write planned", plan.ok);
  if (plan.ok) {
    await db.transaction(async (tx) => {
      await tx.update(agentConfigs).set({ business: sql`${JSON.stringify(plan.business)}::jsonb` } as never).where(eq(agentConfigs.userId, A));
      await tx.update(users).set({ companySheet: sql`${JSON.stringify(plan.sheet)}::jsonb` } as never).where(and(eq(users.id, A)));
    });
  }
  const { GET: config } = await import("../app/api/agent/config/route");
  const res = await config(new NextRequest("http://l/x?phone=%2B97220000000", { headers: { "x-internal-secret": process.env.INTERNAL_SECRET! } }));
  const instructions = String((await res.json()).instructions);
  const at = instructions.indexOf(RULE);
  ok("rule reaches the instructions", at >= 0);
  ok("…in the business block's strict rules section", at > instructions.indexOf("Centers and Days Rules (STRICT"), String(at));

  console.log(failed ? `${failed} FAILED` : "ALL BOOKING-PLACE CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
