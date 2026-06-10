import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

// Internal-only setter pour piloter agent_configs.instructions /
// greetingInstructions / voice / primaryLanguage d'un tenant sans passer
// par l'UI admin (utile en autonome via INTERNAL_SECRET, scripts ops).
// Resolves user par phone OR email OR userId.
export async function POST(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody<{
    phone?: string;
    email?: string;
    userId?: string;
    instructions?: string;
    greetingInstructions?: string;
    voice?: string;
    primaryLanguage?: string;
    inheritAdminGlobals?: boolean;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  let userId = body.userId;
  if (!userId && body.phone) {
    const clean = body.phone.replace(/[\s()-]/g, "");
    const e164 = clean.startsWith("+") ? clean : `+${clean}`;
    const [pn] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.phoneNumber, e164))
      .limit(1);
    if (!pn) {
      return NextResponse.json(
        { error: `phone introuvable: ${e164}` },
        { status: 404 },
      );
    }
    userId = pn.userId;
  }
  if (!userId && body.email) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!u) {
      return NextResponse.json({ error: "email introuvable" }, { status: 404 });
    }
    userId = u.id;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "phone, email ou userId requis" },
      { status: 400 },
    );
  }

  const updates: Partial<typeof agentConfigs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.instructions != null) updates.instructions = body.instructions;
  if (body.greetingInstructions != null)
    updates.greetingInstructions = body.greetingInstructions;
  if (body.voice != null) updates.voice = body.voice;
  if (body.primaryLanguage != null) {
    if (!["fr", "he", "en"].includes(body.primaryLanguage)) {
      return NextResponse.json(
        { error: "primaryLanguage invalide (fr|he|en)" },
        { status: 400 },
      );
    }
    updates.primaryLanguage = body.primaryLanguage;
  }
  if (body.inheritAdminGlobals != null) {
    updates.inheritAdminGlobals = Boolean(body.inheritAdminGlobals);
  }

  const [updated] = await db
    .update(agentConfigs)
    .set(updates)
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
    updatedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
  });
}
