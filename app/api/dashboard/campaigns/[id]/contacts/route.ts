import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignContacts, campaigns } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { MAX_CONTACTS_PER_IMPORT } from "@/lib/campaigns/constants";
import { validateContacts, type RawContact } from "@/lib/campaigns/validate";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST — ajoute des contacts à la file de la campagne (saisie manuelle / paste
// / résultat du mapping d'import). Valide E.164, dédup (intra-payload ET
// vs contacts déjà en base), bulk insert status 'queued'.
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    contacts?: RawContact[];
  };
  const raw = Array.isArray(body.contacts) ? body.contacts : [];
  if (!raw.length)
    return NextResponse.json({ error: "no_contacts" }, { status: 400 });
  if (raw.length > MAX_CONTACTS_PER_IMPORT)
    return NextResponse.json(
      { error: "too_many", max: MAX_CONTACTS_PER_IMPORT },
      { status: 400 },
    );

  const { accepted, rejected } = validateContacts(raw);

  // Dédup vs contacts déjà présents dans la campagne.
  let inserted = 0;
  let duplicates = 0;
  if (accepted.length) {
    const phones = accepted.map((c) => c.phoneNumber);
    const existing = await db
      .select({ phoneNumber: campaignContacts.phoneNumber })
      .from(campaignContacts)
      .where(
        and(
          eq(campaignContacts.campaignId, id),
          inArray(campaignContacts.phoneNumber, phones),
        ),
      );
    const existingSet = new Set(existing.map((e) => e.phoneNumber));
    const toInsert = accepted.filter((c) => !existingSet.has(c.phoneNumber));
    duplicates = accepted.length - toInsert.length;

    if (toInsert.length) {
      await db.insert(campaignContacts).values(
        toInsert.map((c) => ({
          campaignId: id,
          userId: r.userId,
          phoneNumber: c.phoneNumber,
          contactName: c.contactName,
          vars: c.vars,
          status: "queued" as const,
        })),
      );
      inserted = toInsert.length;
    }
  }

  await logEvent({
    source: "web",
    event: "campaign_contacts_added",
    message: `${inserted} contacts ajoutés à la campagne`,
    userId: r.userId,
    metadata: { campaignId: id, inserted, rejected: rejected.length, duplicates },
  });

  return NextResponse.json({
    inserted,
    duplicates,
    rejected,
  });
}
