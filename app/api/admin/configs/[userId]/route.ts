import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { REALTIME_MODELS, voicesFor } from "@/lib/realtime";

const requireAdmin = async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return me?.role === "admin" ? me : null;
};

interface Ctx {
  params: Promise<{ userId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { userId } = await ctx.params;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);

  return NextResponse.json({ user, config: cfg ?? null });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { userId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    instructions: string;
    greetingInstructions: string;
    model: string;
    voice: string;
    temperature: number;
    speed: number;
    maxResponseTokens: number;
    ownerWhatsapp: string;
    primaryLanguage: string;
  }>;

  const modelIds = REALTIME_MODELS.map((m) => m.id);
  if (body.model && !modelIds.includes(body.model)) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }
  if (body.model && body.voice && !voicesFor(body.model).includes(body.voice)) {
    return NextResponse.json(
      { error: "Voice not supported by this model" },
      { status: 400 },
    );
  }

  const updates: Partial<typeof agentConfigs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.instructions != null) updates.instructions = body.instructions;
  if (body.greetingInstructions != null)
    updates.greetingInstructions = body.greetingInstructions;
  if (body.model != null) updates.model = body.model;
  if (body.voice != null) updates.voice = body.voice;
  if (body.temperature != null)
    updates.temperature = clamp(body.temperature, 0, 1.5);
  if (body.speed != null) updates.speed = clamp(body.speed, 0.5, 1.5);
  if (body.maxResponseTokens != null)
    updates.maxResponseTokens = Math.round(
      clamp(body.maxResponseTokens, 50, 4000),
    );
  if (body.ownerWhatsapp != null) {
    const cleaned = body.ownerWhatsapp.replace(/[\s()-]/g, "");
    if (cleaned && !/^\+?\d{6,15}$/.test(cleaned)) {
      return NextResponse.json(
        { error: "WhatsApp invalide (format E.164 attendu, ex: +972585001007)" },
        { status: 400 },
      );
    }
    updates.ownerWhatsapp = cleaned
      ? cleaned.startsWith("+")
        ? cleaned
        : `+${cleaned}`
      : "";
  }
  if (body.primaryLanguage != null) {
    if (!["fr", "he", "en"].includes(body.primaryLanguage)) {
      return NextResponse.json(
        { error: "Langue invalide (fr, he ou en attendus)" },
        { status: 400 },
      );
    }
    updates.primaryLanguage = body.primaryLanguage;
  }

  const [updated] = await db
    .update(agentConfigs)
    .set(updates)
    .where(eq(agentConfigs.userId, userId))
    .returning();

  await logEvent({
    source: "web",
    event: "admin_config_updated",
    message: `Admin ${me.email} a édité la config de ${userId}`,
    userId: me.id,
    metadata: {
      targetUserId: userId,
      changedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
    },
  });

  return NextResponse.json(updated);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
