import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, outboundAgents, users } from "@/lib/db/schema";
import { decideInboundEngine, decideSalesEngine, getClientSalesOverride, NO_ENGINE_ALERT } from "@/lib/engine-override-load";
import { parseEngineOverride, salesOverrideWrite, type EngineForCall } from "@/lib/engine-override";
import { perMinuteUsdFor } from "@/lib/finance/rates";
import { getCostRates } from "@/lib/finance/rates-storage";
import { accountProducts } from "@/lib/products";
import { entryOf, type Product, type ProductEntry } from "@/lib/product-values";
import { outboundModel } from "@/lib/voice/serve";

// GET /api/admin/users/[userId]/engine — ADMIN ONLY. The engine each of the
// account's products runs on, for the tenant banner, plus the account's own
// sales override (E2b) as stored. Computed with the SAME
// decide* functions the session-config handlers call (lib/engine-override-load.ts),
// so the screen and the call can't disagree. Read-only: no alert is raised
// here (the call path raises it). Explicit column picks only.
//
// Response: { userId, salesOverride, products: [{ entry, product, language, resolved, ignored?, costPerMinUsd, byLanguage? }] }
//   resolved  { engine, model, source: "client" | "product" | "default" } | null (connect: not resolved here)
//   ignored   { reason: "language" | "not_honoured", wanted: { source, engine, model } } — the override skipped
//   costPerMinUsd  the per-minute rate card value for the resolved engine/model, null = unknown
//   byLanguage     sales only, when the account's outbound agents speak several languages: one row per language
//   salesOverride  { engine, model } | null — users.sales_engine_override (ranked above the sales
//                  product override; the sales entry's source is "client" when it applies)
//
// PUT /api/admin/users/[userId]/engine — ADMIN ONLY. Body { salesOverride }:
//   { engine, model } sets it, null clears it, omitted = unchanged. A malformed
//   value or one the worker doesn't honour for sales (today: OpenAI only) →
//   400 { error: "invalid_engine_override", fields: [...] }, nothing written.
//   Unknown keys → 400 naming them. An unchanged value rewrites nothing.
//   Response: { ok: true, salesOverride }.
type Row = {
  language: string;
  resolved: { engine: string; model: string; source: string };
  ignored?: EngineForCall["ignored"];
  costPerMinUsd: number | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const ent = await accountProducts(userId);
  const products: Product[] = ent.base ? [ent.base, ...ent.addons] : [...ent.addons];
  const rates = await getCostRates();
  const row = (language: string, d: EngineForCall): Row => ({
    language,
    resolved: { engine: d.engine, model: d.model, source: d.source },
    ...(d.ignored ? { ignored: d.ignored } : {}),
    costPerMinUsd: perMinuteUsdFor(rates, d.engine, d.model),
  });

  const out: Array<{ entry: ProductEntry; product: Product } & (Row | { resolved: null; costPerMinUsd: null }) & { byLanguage?: Row[] }> = [];
  for (const product of products) {
    const entry = entryOf(product);
    if (product === "reception" || product === "reception_multi") {
      const [cfg] = await db
        .select({ realtimeProvider: agentConfigs.realtimeProvider, model: agentConfigs.model, primaryLanguage: agentConfigs.primaryLanguage })
        .from(agentConfigs)
        .where(eq(agentConfigs.userId, userId))
        .limit(1);
      const config = cfg ?? { realtimeProvider: null, model: "gpt-realtime-2", primaryLanguage: "fr" };
      const { decision } = await decideInboundEngine(userId, config, NO_ENGINE_ALERT);
      out.push({ entry, product, ...row(config.primaryLanguage || "fr", decision) });
    } else if (product === "sales") {
      // The call path uses each agent's language (fallback "fr", as campaign.ts).
      const agents = await db.select({ language: outboundAgents.language }).from(outboundAgents).where(eq(outboundAgents.userId, userId));
      const counts = new Map<string, number>();
      for (const a of agents) counts.set(a.language || "fr", (counts.get(a.language || "fr") ?? 0) + 1);
      const langs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
      if (!langs.length) langs.push("fr");
      const rows: Row[] = [];
      for (const l of langs) {
        const { decision } = await decideSalesEngine("campaign", userId, l, { engine: "openai", model: outboundModel() }, NO_ENGINE_ALERT);
        rows.push(row(l, decision));
      }
      out.push({ entry, product, ...rows[0]!, ...(rows.length > 1 ? { byLanguage: rows } : {}) });
    } else {
      // connect: the client's own agent answers; no engine override applies.
      out.push({ entry, product, resolved: null, costPerMinUsd: null });
    }
  }
  return NextResponse.json({ userId, salesOverride: await getClientSalesOverride(userId), products: out });
}

export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const body = (await req.json().catch(() => undefined)) as unknown;
  const w = salesOverrideWrite(body);
  if (!w.ok) return NextResponse.json({ error: "invalid_engine_override", fields: w.fields }, { status: 400 });
  const [u] = await db.select({ salesEngineOverride: users.salesEngineOverride }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  const stored = u.salesEngineOverride == null ? null : parseEngineOverride(u.salesEngineOverride);
  if (w.value === undefined) return NextResponse.json({ ok: true, salesOverride: stored });
  // An unchanged value rewrites nothing (a malformed stored value is replaced).
  const same = u.salesEngineOverride == null ? w.value === null : stored !== null && w.value !== null && stored.engine === w.value.engine && stored.model === w.value.model;
  if (!same) {
    await db
      .update(users)
      .set({ salesEngineOverride: w.value === null ? null : { engine: w.value.engine, model: w.value.model } })
      .where(eq(users.id, userId));
  }
  return NextResponse.json({ ok: true, salesOverride: w.value });
}
