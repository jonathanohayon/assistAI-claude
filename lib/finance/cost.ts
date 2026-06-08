// Moteur de calcul des coûts (admin Finance) — SERVER-ONLY.
//
// Agrège l'usage RÉEL déjà persisté (durées d'appels inbound/outbound,
// messages WhatsApp via events, nombre de numéros loués) et le multiplie par
// la rate card (lib/finance/rates.ts) pour produire un coût par catégorie,
// par bucket temporel (jour/mois/an), global ou par tenant. Le revenu vient
// de paymentOrders (payé) converti en USD → marge.
//
// OpenAI : si des events `openai_usage` existent (tokens réels streamés par
// le worker), on facture aux taux par token ; sinon on ESTIME via les
// minutes d'appel × openaiUsdPerMinute. `estimated` reflète ce fallback.

import { and, type AnyColumn, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  calls,
  campaignCalls,
  events,
  paymentOrders,
  phoneNumbers,
  users,
} from "@/lib/db/schema";
import { type CostRates } from "@/lib/finance/rates";

export type Granularity = "day" | "month" | "year";

const WHATSAPP_SENT_EVENTS = [
  "whatsapp_sent_client",
  "whatsapp_sent_owner",
] as const;
const OPENAI_USAGE_EVENT = "openai_usage";

export interface CategoryCost {
  openai: number;
  twilioVoice: number;
  twilioNumbers: number;
  whatsapp: number;
  infra: number;
  total: number;
}

export interface CostBucket extends CategoryCost {
  /** Début du bucket, format "YYYY-MM-DD" (parsable côté chart). */
  period: string;
  revenueUsd: number;
  marginUsd: number;
}

export interface TenantCost {
  userId: string;
  email: string;
  displayName: string;
  plan: string;
  cost: CategoryCost;
  revenueUsd: number;
  marginUsd: number;
}

export interface UsageTotals {
  inboundMinutes: number;
  outboundMinutes: number;
  whatsappMessages: number;
  activeNumbers: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  /** true si des tokens OpenAI réels ont été trouvés (sinon coût estimé). */
  tokensTracked: boolean;
}

export interface FinanceStats {
  scope: "global" | "user";
  currency: "USD";
  range: { from: string; to: string };
  granularity: Granularity;
  /** true tant que le coût OpenAI est estimé depuis les minutes. */
  estimated: boolean;
  totals: CategoryCost;
  revenueUsd: number;
  marginUsd: number;
  series: CostBucket[];
  byCategory: { category: string; amount: number }[];
  byPlan: { plan: string; amount: number }[];
  tenants: TenantCost[];
  usage: UsageTotals;
}

// ── Helpers ─────────────────────────────────────────────────────────

const DAYS_PER_MONTH = 30.4;

function monthsForGranularity(g: Granularity): number {
  if (g === "year") return 12;
  if (g === "month") return 1;
  return 1 / DAYS_PER_MONTH; // day
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function periodKey(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear();
  if (g === "year") return `${y}-01-01`;
  if (g === "month") return `${y}-${pad(d.getUTCMonth() + 1)}-01`;
  return `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Liste ordonnée des clés de bucket couvrant [from, to). */
function buildBucketKeys(from: Date, to: Date, g: Granularity): string[] {
  const keys: string[] = [];
  const cur = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  if (g === "month") cur.setUTCDate(1);
  if (g === "year") {
    cur.setUTCMonth(0);
    cur.setUTCDate(1);
  }
  let guard = 0;
  while (cur < to && guard++ < 5000) {
    keys.push(periodKey(cur, g));
    if (g === "day") cur.setUTCDate(cur.getUTCDate() + 1);
    else if (g === "month") cur.setUTCMonth(cur.getUTCMonth() + 1);
    else cur.setUTCFullYear(cur.getUTCFullYear() + 1);
  }
  return keys;
}

interface RawUsage {
  inboundSeconds: number;
  outboundSeconds: number;
  whatsappMessages: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiCachedTokens: number;
  openaiUsageRows: number;
  numbersActive: number;
}

const ZERO_USAGE: RawUsage = {
  inboundSeconds: 0,
  outboundSeconds: 0,
  whatsappMessages: 0,
  openaiInputTokens: 0,
  openaiOutputTokens: 0,
  openaiCachedTokens: 0,
  openaiUsageRows: 0,
  numbersActive: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Coût par catégorie pour un usage donné sur `months` mois. */
function costFromUsage(
  u: RawUsage,
  rates: CostRates,
  months: number,
  opts: { includeInfra: boolean },
): CategoryCost {
  const inboundMin = u.inboundSeconds / 60;
  const outboundMin = u.outboundSeconds / 60;

  const openai =
    u.openaiUsageRows > 0
      ? u.openaiInputTokens * rates.openaiUsdPerInputToken +
        u.openaiOutputTokens * rates.openaiUsdPerOutputToken +
        u.openaiCachedTokens * rates.openaiUsdPerCachedInputToken
      : (inboundMin + outboundMin) * rates.openaiUsdPerMinute;

  const twilioVoice =
    inboundMin * rates.twilioInboundUsdPerMinute +
    outboundMin * rates.twilioOutboundUsdPerMinute;
  const twilioNumbers = u.numbersActive * rates.twilioNumberUsdPerMonth * months;
  const whatsapp = u.whatsappMessages * rates.whatsappUsdPerMessage;
  const infra = opts.includeInfra ? rates.infraUsdPerMonth * months : 0;

  const total = openai + twilioVoice + twilioNumbers + whatsapp + infra;
  return {
    openai: round2(openai),
    twilioVoice: round2(twilioVoice),
    twilioNumbers: round2(twilioNumbers),
    whatsapp: round2(whatsapp),
    infra: round2(infra),
    total: round2(total),
  };
}

function revenueToUsd(
  amount: number,
  currency: string,
  rates: CostRates,
): number {
  if (currency === "EUR") return amount * rates.eurToUsd;
  if (currency === "ILS") return amount * rates.ilsToUsd;
  return amount; // suppose déjà USD
}

// ── Engine ──────────────────────────────────────────────────────────

export async function computeFinanceStats(args: {
  rates: CostRates;
  from: Date;
  to: Date;
  granularity: Granularity;
  userId?: string | null;
}): Promise<FinanceStats> {
  const { rates, from, to, granularity } = args;
  const userId = args.userId ?? null;
  const scope: "global" | "user" = userId ? "user" : "global";

  const truncExpr = (col: AnyColumn) =>
    sql<string>`to_char(date_trunc(${granularity}, ${col}), 'YYYY-MM-DD')`;

  const callConds = [gte(calls.createdAt, from), lt(calls.createdAt, to)];
  if (userId) callConds.push(eq(calls.userId, userId));
  const ccConds = [
    gte(campaignCalls.createdAt, from),
    lt(campaignCalls.createdAt, to),
  ];
  if (userId) ccConds.push(eq(campaignCalls.userId, userId));
  const waConds = [
    gte(events.createdAt, from),
    lt(events.createdAt, to),
    inArray(events.event, [...WHATSAPP_SENT_EVENTS]),
  ];
  if (userId) waConds.push(eq(events.userId, userId));
  const usageConds = [
    gte(events.createdAt, from),
    lt(events.createdAt, to),
    eq(events.event, OPENAI_USAGE_EVENT),
  ];
  if (userId) usageConds.push(eq(events.userId, userId));

  // Requêtes groupées par bucket (parallèles).
  const [
    inboundRows,
    outboundRows,
    waRows,
    usageRows,
    numberRows,
    paymentRows,
  ] = await Promise.all([
    db
      .select({
        period: truncExpr(calls.createdAt),
        seconds: sql<number>`coalesce(sum(jsonb_array_length(${calls.transcript}) * 6),0)::int`,
      })
      .from(calls)
      .where(and(...callConds))
      .groupBy(sql`1`),
    db
      .select({
        period: truncExpr(campaignCalls.createdAt),
        seconds: sql<number>`coalesce(sum(${campaignCalls.durationSeconds}),0)::int`,
      })
      .from(campaignCalls)
      .where(and(...ccConds))
      .groupBy(sql`1`),
    db
      .select({
        period: truncExpr(events.createdAt),
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(and(...waConds))
      .groupBy(sql`1`),
    db
      .select({
        period: truncExpr(events.createdAt),
        rows: sql<number>`count(*)::int`,
        inTok: sql<number>`coalesce(sum((${events.metadata}->>'inputTokens')::numeric),0)::bigint`,
        outTok: sql<number>`coalesce(sum((${events.metadata}->>'outputTokens')::numeric),0)::bigint`,
        cachedTok: sql<number>`coalesce(sum((${events.metadata}->>'cachedTokens')::numeric),0)::bigint`,
      })
      .from(events)
      .where(and(...usageConds))
      .groupBy(sql`1`),
    db
      .select({
        userId: phoneNumbers.userId,
        createdAt: phoneNumbers.createdAt,
      })
      .from(phoneNumbers)
      .where(userId ? eq(phoneNumbers.userId, userId) : undefined),
    db
      .select({
        userId: paymentOrders.userId,
        amount: paymentOrders.expectedAmount,
        currency: paymentOrders.currency,
        planKey: paymentOrders.planKey,
        paidAt: paymentOrders.paidAt,
      })
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.status, "paid"),
          gte(paymentOrders.paidAt, from),
          lt(paymentOrders.paidAt, to),
          ...(userId ? [eq(paymentOrders.userId, userId)] : []),
        ),
      ),
  ]);

  // Index par bucket.
  const map = new Map<string, RawUsage>();
  const ensure = (k: string): RawUsage => {
    let u = map.get(k);
    if (!u) {
      u = { ...ZERO_USAGE };
      map.set(k, u);
    }
    return u;
  };
  for (const r of inboundRows) ensure(r.period).inboundSeconds += Number(r.seconds);
  for (const r of outboundRows)
    ensure(r.period).outboundSeconds += Number(r.seconds);
  for (const r of waRows) ensure(r.period).whatsappMessages += Number(r.count);
  for (const r of usageRows) {
    const u = ensure(r.period);
    u.openaiUsageRows += Number(r.rows);
    u.openaiInputTokens += Number(r.inTok);
    u.openaiOutputTokens += Number(r.outTok);
    u.openaiCachedTokens += Number(r.cachedTok);
  }

  const months = monthsForGranularity(granularity);
  const keys = buildBucketKeys(from, to, granularity);

  // Numéros actifs par bucket = créés avant la fin du bucket (approx :
  // les numéros relâchés sont supprimés, donc léger biais sur l'historique).
  function activeNumbersAt(bucketStart: string): number {
    const end = bucketEndDate(bucketStart, granularity);
    let n = 0;
    for (const row of numberRows) {
      if (row.createdAt && new Date(row.createdAt) < end) n++;
    }
    return n;
  }

  // Revenu par bucket.
  const revenueByBucket = new Map<string, number>();
  let revenueTotal = 0;
  for (const p of paymentRows) {
    if (!p.paidAt) continue;
    const key = periodKey(new Date(p.paidAt), granularity);
    const usd = revenueToUsd(Number(p.amount), p.currency, rates);
    revenueByBucket.set(key, (revenueByBucket.get(key) ?? 0) + usd);
    revenueTotal += usd;
  }

  const series: CostBucket[] = keys.map((k) => {
    const u = map.get(k) ?? { ...ZERO_USAGE };
    u.numbersActive = activeNumbersAt(k);
    const cost = costFromUsage(u, rates, months, { includeInfra: !userId });
    const rev = round2(revenueByBucket.get(k) ?? 0);
    return {
      period: k,
      ...cost,
      revenueUsd: rev,
      marginUsd: round2(rev - cost.total),
    };
  });

  // Totaux = somme des buckets (cohérent avec la série affichée).
  const totals: CategoryCost = {
    openai: 0,
    twilioVoice: 0,
    twilioNumbers: 0,
    whatsapp: 0,
    infra: 0,
    total: 0,
  };
  for (const b of series) {
    totals.openai += b.openai;
    totals.twilioVoice += b.twilioVoice;
    totals.twilioNumbers += b.twilioNumbers;
    totals.whatsapp += b.whatsapp;
    totals.infra += b.infra;
    totals.total += b.total;
  }
  for (const k of Object.keys(totals) as (keyof CategoryCost)[])
    totals[k] = round2(totals[k]);

  // Usage agrégé (pour les KPI).
  const usageAgg = [...map.values()].reduce(
    (acc, u) => {
      acc.inboundSeconds += u.inboundSeconds;
      acc.outboundSeconds += u.outboundSeconds;
      acc.whatsappMessages += u.whatsappMessages;
      acc.openaiInputTokens += u.openaiInputTokens;
      acc.openaiOutputTokens += u.openaiOutputTokens;
      acc.openaiUsageRows += u.openaiUsageRows;
      return acc;
    },
    { ...ZERO_USAGE },
  );
  const tokensTracked = usageAgg.openaiUsageRows > 0;

  // Breakdown par tenant (scope global uniquement).
  const tenants = userId
    ? []
    : await computeTenantBreakdown({ rates, from, to });

  const byPlan = aggregateByPlan(tenants);
  const byCategory = [
    { category: "openai", amount: totals.openai },
    { category: "twilioVoice", amount: totals.twilioVoice },
    { category: "twilioNumbers", amount: totals.twilioNumbers },
    { category: "whatsapp", amount: totals.whatsapp },
    { category: "infra", amount: totals.infra },
  ];

  return {
    scope,
    currency: "USD",
    range: { from: from.toISOString(), to: to.toISOString() },
    granularity,
    estimated: !tokensTracked,
    totals,
    revenueUsd: round2(revenueTotal),
    marginUsd: round2(revenueTotal - totals.total),
    series,
    byCategory,
    byPlan,
    tenants,
    usage: {
      inboundMinutes: round2(usageAgg.inboundSeconds / 60),
      outboundMinutes: round2(usageAgg.outboundSeconds / 60),
      whatsappMessages: usageAgg.whatsappMessages,
      activeNumbers: numberRows.length,
      openaiInputTokens: usageAgg.openaiInputTokens,
      openaiOutputTokens: usageAgg.openaiOutputTokens,
      tokensTracked,
    },
  };
}

function bucketEndDate(bucketStart: string, g: Granularity): Date {
  const d = new Date(`${bucketStart}T00:00:00.000Z`);
  if (g === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (g === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

function aggregateByPlan(
  tenants: TenantCost[],
): { plan: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const t of tenants) m.set(t.plan, (m.get(t.plan) ?? 0) + t.cost.total);
  return [...m.entries()].map(([plan, amount]) => ({
    plan,
    amount: round2(amount),
  }));
}

/** Coût + revenu agrégés par tenant sur toute la fenêtre (table admin). */
async function computeTenantBreakdown(args: {
  rates: CostRates;
  from: Date;
  to: Date;
}): Promise<TenantCost[]> {
  const { rates, from, to } = args;
  const months =
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH);

  const [
    userRows,
    inboundByUser,
    outboundByUser,
    waByUser,
    usageByUser,
    numbersByUser,
    revenueByUser,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        plan: users.subscriptionPlan,
      })
      .from(users),
    db
      .select({
        userId: calls.userId,
        seconds: sql<number>`coalesce(sum(jsonb_array_length(${calls.transcript}) * 6),0)::int`,
      })
      .from(calls)
      .where(and(gte(calls.createdAt, from), lt(calls.createdAt, to)))
      .groupBy(calls.userId),
    db
      .select({
        userId: campaignCalls.userId,
        seconds: sql<number>`coalesce(sum(${campaignCalls.durationSeconds}),0)::int`,
      })
      .from(campaignCalls)
      .where(
        and(gte(campaignCalls.createdAt, from), lt(campaignCalls.createdAt, to)),
      )
      .groupBy(campaignCalls.userId),
    db
      .select({
        userId: events.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(
        and(
          gte(events.createdAt, from),
          lt(events.createdAt, to),
          inArray(events.event, [...WHATSAPP_SENT_EVENTS]),
        ),
      )
      .groupBy(events.userId),
    db
      .select({
        userId: events.userId,
        rows: sql<number>`count(*)::int`,
        inTok: sql<number>`coalesce(sum((${events.metadata}->>'inputTokens')::numeric),0)::bigint`,
        outTok: sql<number>`coalesce(sum((${events.metadata}->>'outputTokens')::numeric),0)::bigint`,
        cachedTok: sql<number>`coalesce(sum((${events.metadata}->>'cachedTokens')::numeric),0)::bigint`,
      })
      .from(events)
      .where(
        and(
          gte(events.createdAt, from),
          lt(events.createdAt, to),
          eq(events.event, OPENAI_USAGE_EVENT),
        ),
      )
      .groupBy(events.userId),
    db
      .select({
        userId: phoneNumbers.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(phoneNumbers)
      .groupBy(phoneNumbers.userId),
    db
      .select({
        userId: paymentOrders.userId,
        amount: paymentOrders.expectedAmount,
        currency: paymentOrders.currency,
      })
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.status, "paid"),
          gte(paymentOrders.paidAt, from),
          lt(paymentOrders.paidAt, to),
        ),
      ),
  ]);

  const byUser = new Map<string, RawUsage>();
  const ensure = (id: string): RawUsage => {
    let u = byUser.get(id);
    if (!u) {
      u = { ...ZERO_USAGE };
      byUser.set(id, u);
    }
    return u;
  };
  for (const r of inboundByUser)
    if (r.userId) ensure(r.userId).inboundSeconds += Number(r.seconds);
  for (const r of outboundByUser)
    if (r.userId) ensure(r.userId).outboundSeconds += Number(r.seconds);
  for (const r of waByUser)
    if (r.userId) ensure(r.userId).whatsappMessages += Number(r.count);
  for (const r of usageByUser) {
    if (!r.userId) continue;
    const u = ensure(r.userId);
    u.openaiUsageRows += Number(r.rows);
    u.openaiInputTokens += Number(r.inTok);
    u.openaiOutputTokens += Number(r.outTok);
    u.openaiCachedTokens += Number(r.cachedTok);
  }
  for (const r of numbersByUser)
    if (r.userId) ensure(r.userId).numbersActive += Number(r.count);

  const revByUser = new Map<string, number>();
  for (const r of revenueByUser) {
    if (!r.userId) continue;
    revByUser.set(
      r.userId,
      (revByUser.get(r.userId) ?? 0) + revenueToUsd(Number(r.amount), r.currency, rates),
    );
  }

  const out: TenantCost[] = [];
  for (const user of userRows) {
    const u = byUser.get(user.id) ?? { ...ZERO_USAGE };
    // Infra non attribuée par tenant (coût plateforme global).
    const cost = costFromUsage(u, rates, months, { includeInfra: false });
    const rev = round2(revByUser.get(user.id) ?? 0);
    // Skip les tenants sans aucune activité ni revenu pour garder la table lisible.
    if (cost.total === 0 && rev === 0) continue;
    out.push({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      plan: user.plan,
      cost,
      revenueUsd: rev,
      marginUsd: round2(rev - cost.total),
    });
  }
  out.sort((a, b) => b.cost.total - a.cost.total);
  return out;
}
