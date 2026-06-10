import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  campaignContacts,
  campaigns,
  outboundAgents,
  phoneNumbers,
} from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import {
  normalizeCallWindow,
  normalizeConcurrency,
  normalizeExtractionSchema,
  normalizeGoalPreset,
  normalizeRetryRules,
} from "@/lib/campaigns/validate";

// Valide qu'un agentId fourni appartient bien au tenant. Renvoie l'id si OK,
// sinon null (campagne sans agent → le worker retombera sur la persona
// embarquée tant que la Phase 3 n'a pas retiré la colonne).
async function validateAgentId(
  userId: string,
  raw: unknown,
): Promise<string | null> {
  if (typeof raw !== "string" || !raw) return null;
  const [a] = await db
    .select({ id: outboundAgents.id })
    .from(outboundAgents)
    .where(and(eq(outboundAgents.id, raw), eq(outboundAgents.userId, userId)))
    .limit(1);
  return a?.id ?? null;
}

// GET — liste des campagnes du tenant + stats agrégées par campagne.
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, r.userId))
    .orderBy(desc(campaigns.createdAt));

  const ids = rows.map((c) => c.id);
  // Rollup des contacts par campagne (total / file / terminés / connectés).
  const statRows = ids.length
    ? await db
        .select({
          campaignId: campaignContacts.campaignId,
          total: sql<number>`count(*)::int`,
          queued: sql<number>`count(*) filter (where status = 'queued')::int`,
          inFlight: sql<number>`count(*) filter (where status in ('claimed','calling'))::int`,
          done: sql<number>`count(*) filter (where status in ('completed','failed','no_answer','voicemail','busy','skipped'))::int`,
          connected: sql<number>`count(*) filter (where status = 'completed')::int`,
        })
        .from(campaignContacts)
        .where(inArray(campaignContacts.campaignId, ids))
        .groupBy(campaignContacts.campaignId)
    : [];
  const statMap = new Map(statRows.map((s) => [s.campaignId, s]));

  const result = rows.map((c) => {
    const s = statMap.get(c.id);
    const total = s?.total ?? 0;
    const connected = s?.connected ?? 0;
    return {
      ...c,
      stats: {
        total,
        queued: s?.queued ?? 0,
        inFlight: s?.inFlight ?? 0,
        done: s?.done ?? 0,
        connected,
        conversion: total > 0 ? Math.round((connected / total) * 100) : 0,
      },
    };
  });

  return NextResponse.json({ campaigns: result });
}

// POST — création d'une campagne (status draft).
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 160)
      : "";
  if (!name)
    return NextResponse.json({ error: "name_required" }, { status: 400 });

  // Le caller-id doit appartenir au tenant (sinon vide → worker utilisera le
  // numéro par défaut). On valide contre phone_numbers.
  let fromNumber = "";
  if (typeof body.fromNumber === "string" && body.fromNumber.trim()) {
    const candidate = body.fromNumber.trim();
    const owned = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, r.userId));
    if (owned.some((p) => p.phoneNumber === candidate)) fromNumber = candidate;
  }

  const [created] = await db
    .insert(campaigns)
    .values({
      userId: r.userId,
      name,
      goalPreset: normalizeGoalPreset(body.goalPreset),
      objective:
        typeof body.objective === "string" ? body.objective.slice(0, 4000) : "",
      successCriteria:
        typeof body.successCriteria === "string"
          ? body.successCriteria.slice(0, 4000)
          : "",
      status: "draft",
      fromNumber,
      agentId: await validateAgentId(r.userId, body.agentId),
      extractionSchema: normalizeExtractionSchema(body.extractionSchema),
      concurrency: normalizeConcurrency(body.concurrency),
      retryRules: normalizeRetryRules(body.retryRules),
      callWindow: normalizeCallWindow(body.callWindow),
    })
    .returning();

  await logEvent({
    source: "web",
    event: "campaign_created",
    message: `Campagne créée: ${name}`,
    userId: r.userId,
    metadata: { campaignId: created.id, goalPreset: created.goalPreset },
  });

  return NextResponse.json({ campaign: created }, { status: 201 });
}
