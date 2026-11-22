// The LEGACY single-plan payment, captured end to end through the real
// routes (no new module imported here, so the same file runs on a tree
// without P4): for each case, the `{ plan, period, locale }` body →
//   1. the create-payment response and the exact APISign SIGN request sent
//      to HYP (every param; mock credentials);
//   2. the payment_orders row and the users fields it touched;
//   3. the callback: the VERIFY request, the response, the users row, the
//      order row, the events written, the confirmation email (mock sender);
//   4. a replayed callback (nothing new);
//   5. the billing-stats response.
// Ids and clock-dependent values are normalized to placeholders or to exact
// relations (e.g. paidUntil = addPeriod(paidAt)). The result is compared to
// the recorded fixture legacy-capture.json (scripts/tests/hyp-orders-db.test.ts).
// Needs: the hooks (hooks.mjs), installMockHyp(), mock HYP env, a migrated
// local database in DATABASE_URL.

import { hypRequests, verifyAnswers } from "./mock-hyp";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const LEGACY_CASES = [
  { user: "00000000-0000-4000-8000-00000000c001", email: "legacy-fr@example.test", displayName: "Salon Exemple", userLocale: "fr", body: { plan: "global", period: "monthly", locale: "fr" } },
  { user: "00000000-0000-4000-8000-00000000c002", email: "legacy-he@example.test", displayName: "", userLocale: "he", body: { plan: "premium", period: "annual", locale: "he" } },
  { user: "00000000-0000-4000-8000-00000000c003", email: "legacy-en@example.test", displayName: "Clinic Example Two", userLocale: "en", body: { plan: "premium", period: "monthly", locale: "xx" } },
] as const;

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;

export function normalize(x: unknown, subs: Array<[string, string]>): Json {
  if (x instanceof Date) return "<date>";
  if (typeof x === "string") {
    if (ISO.test(x)) return "<date>";
    let s = x;
    for (const [from, to] of subs) s = s.split(from).join(to);
    return s;
  }
  if (Array.isArray(x)) return x.map((v) => normalize(v, subs));
  if (x && typeof x === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(x)) out[k] = normalize(v, subs);
    return out;
  }
  return (x ?? null) as Json;
}

export async function captureLegacy(): Promise<Record<string, Json>> {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../../../lib/db");
  const create = await import("../../../../app/api/dashboard/hyp/create-payment/route");
  const callback = await import("../../../../app/api/dashboard/hyp/callback/route");
  const stats = await import("../../../../app/api/dashboard/billing-stats/route");
  const { addPeriod } = await import("../../../../lib/billing-activation");

  const g = globalThis as { __campgateSession?: { user: { id: string } } | null; __sentEmails?: unknown[] };
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
  };
  const USER_COLS = sql.raw(
    "subscription_status, subscription_plan, subscription_period, paid_until, trial_ends_at, trial_warning_sent_at, deletion_locked_until, auto_renew, cancelled_at, hyp_token, hyp_token_exp, card_last4, card_brand, products",
  );
  const ORDER_COLS = sql.raw(
    "id, user_id, plan_key, period, kind, currency, coin, expected_amount, status, hyp_transaction_id, raw_response, created_at, expires_at, paid_at",
  );
  const out: Record<string, Json> = {};

  for (const c of LEGACY_CASES) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, display_name, locale, subscription_status, subscription_plan, trial_ends_at)
      VALUES (${c.user}, ${c.email}, 'x', ${c.displayName}, ${c.userLocale}, 'trialing', 'essential', now() + interval '1 day')`);
    g.__campgateSession = { user: { id: c.user } };
    const mark = { hyp: hypRequests.length, mail: (g.__sentEmails ?? []).length };

    // 1. create-payment
    const res = await create.POST(
      new NextRequest("http://localhost/api/dashboard/hyp/create-payment", {
        method: "POST",
        body: JSON.stringify(c.body),
        headers: { "content-type": "application/json" },
      }),
    );
    const createBody = (await res.json()) as Record<string, unknown>;
    const [order] = await rows(sql`SELECT ${ORDER_COLS} FROM payment_orders WHERE user_id = ${c.user}`);
    const orderId = String(order.id);
    const subs: Array<[string, string]> = [[orderId, "<order>"], [c.user, "<user>"]];
    const sign = hypRequests.slice(mark.hyp).filter((r) => r.what === "SIGN");
    const [afterCreate] = await rows(sql`SELECT ${USER_COLS} FROM users WHERE id = ${c.user}`);
    const created = new Date(String(order.created_at));
    const expires = new Date(String(order.expires_at));
    const lock = afterCreate.deletion_locked_until ? new Date(String(afterCreate.deletion_locked_until)) : null;

    // 3. callback (HYP success redirect) with a mock VERIFY answer
    const amount = Number(order.expected_amount).toFixed(2);
    const txn = `mock-txn-${c.user.slice(-4)}`;
    verifyAnswers[orderId] = { CCode: "0", Id: txn, Order: orderId, Amount: amount, Coin: String(order.coin), L4digit: "4242", Brand: "2" };
    const cbUrl = `http://localhost/api/dashboard/hyp/callback?locale=${c.body.locale}&Order=${orderId}&Id=${txn}&CCode=0&Amount=${amount}&Sign=mock`;
    const cb = await callback.GET(new NextRequest(cbUrl));
    const cbText = await cb.text();
    const verify = hypRequests.slice(mark.hyp).filter((r) => r.what === "VERIFY");
    const [userAfter] = await rows(sql`SELECT ${USER_COLS}, xmin::text AS xmin FROM users WHERE id = ${c.user}`);
    const [orderAfter] = await rows(sql`SELECT ${ORDER_COLS}, xmin::text AS xmin FROM payment_orders WHERE id = ${orderId}`);
    const evs = await rows(sql`SELECT source, event, level, message, metadata FROM events WHERE user_id = ${c.user} ORDER BY created_at, event`);
    const mails = (g.__sentEmails ?? []).slice(mark.mail);
    const paidAt = new Date(String(orderAfter.paid_at));
    const paidUntil = new Date(String(userAfter.paid_until));

    // 4. replay
    const cb2 = await callback.GET(new NextRequest(cbUrl));
    const cb2Text = await cb2.text();
    const [userReplay] = await rows(sql`SELECT xmin::text AS xmin FROM users WHERE id = ${c.user}`);
    const [orderReplay] = await rows(sql`SELECT xmin::text AS xmin FROM payment_orders WHERE id = ${orderId}`);
    const evs2 = await rows(sql`SELECT count(*)::int AS n FROM events WHERE user_id = ${c.user}`);

    // 5. billing-stats
    const st = await stats.GET(new NextRequest("http://localhost/api/dashboard/billing-stats"));
    const stText = await st.text();

    const { xmin: _ux, ...userAfterCols } = userAfter;
    const { xmin: _ox, ...orderAfterCols } = orderAfter;
    out[`${c.body.plan}/${c.body.period}/${c.body.locale}`] = normalize(
      {
        createStatus: res.status,
        createBody,
        signRequests: sign.map((r) => r.params),
        orderRow: order,
        orderTimes: { expiresMinusCreatedMinutes: Math.round((expires.getTime() - created.getTime()) / 60000), lockMinusExpiresMs: lock ? lock.getTime() - expires.getTime() : null },
        userAfterCreate: { ...afterCreate, deletion_locked_until: lock ? "<set>" : null },
        callback: { status: cb.status, contentType: cb.headers.get("content-type"), body: cbText },
        verifyRequests: verify.map((r) => r.params),
        userAfterCallback: userAfterCols,
        paidUntilIsPaidAtPlusPeriod: addPeriod(paidAt, c.body.period).getTime() === paidUntil.getTime(),
        orderAfterCallback: orderAfterCols,
        events: evs,
        emails: mails as Json,
        replay: {
          status: cb2.status,
          body: cb2Text,
          usersUnchanged: userReplay.xmin === userAfter.xmin,
          orderUnchanged: orderReplay.xmin === orderAfter.xmin,
          newEvents: Number(evs2[0].n) - evs.length,
          newEmails: (g.__sentEmails ?? []).length - mark.mail - mails.length,
        },
        billingStats: { status: st.status, body: JSON.parse(stText) },
        billingStatsBytesLength: stText.length,
      },
      subs,
    );
  }
  g.__campgateSession = null;
  return out;
}
