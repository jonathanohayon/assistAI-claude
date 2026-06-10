import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";

// Internal-only setter so an admin (or me, with INTERNAL_SECRET) can update
// any tenant's owner_whatsapp without going through the dashboard. Gated by
// INTERNAL_SECRET because admin login may not be available headless.
export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<{
    email?: string;
    userId?: string;
    ownerWhatsapp?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.ownerWhatsapp) {
    return NextResponse.json(
      { error: "ownerWhatsapp manquant" },
      { status: 400 },
    );
  }

  // Resolve user by email or userId.
  let userId = body.userId;
  if (!userId && body.email) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!u) {
      return NextResponse.json({ error: "user introuvable" }, { status: 404 });
    }
    userId = u.id;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "userId ou email requis" },
      { status: 400 },
    );
  }

  const cleaned = body.ownerWhatsapp.replace(/[\s()-]/g, "");
  const e164 = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;

  const [updated] = await db
    .update(agentConfigs)
    .set({ ownerWhatsapp: e164, updatedAt: new Date() })
    .where(eq(agentConfigs.userId, userId))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "agent_config introuvable pour ce user" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    userId,
    ownerWhatsapp: updated.ownerWhatsapp,
  });
}
