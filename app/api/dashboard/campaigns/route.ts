import { desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  campaignContacts,
  campaigns,
  phoneNumbers,
} from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import {
  normalizeCallWindow,
  normalizeConcurrency,
  normalizeExtractionSchema,
  normalizeGoalPreset,
  normalizePersona,
  normalizeRetryRules,
} from "@/lib/campaigns/validate";

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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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
      status: "draft",
      fromNumber,
      persona: normalizePersona(body.persona),
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
