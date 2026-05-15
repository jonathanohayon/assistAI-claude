import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { sanitizePersonality } from "@/lib/personality";
import { voicesFor } from "@/lib/realtime";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  if (!config) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    inheritAdminGlobals: boolean;
    personality: Record<string, number>;
    agentName: string;
  }>;

  // Look up current config + user role. Tenants can only change persona,
  // voice, speed, and WhatsApp number. Admin-only fields (model, temperature,
  // maxResponseTokens) are silently ignored when posted by a non-admin so the
  // UI stays simple — they're not exposed to tenants in the form.
  const [current] = await db
    .select({
      model: agentConfigs.model,
      role: users.role,
    })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);
  if (!current) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }
  const isAdmin = current.role === "admin";

  // Model (admin only). Non-admins ignored. We don't validate against a
  // hardcoded allowlist anymore — the dashboard picker is fed by the live
  // OpenAI catalog (/api/realtime/catalog), and OpenAI itself validates
  // when a session is created. Hardcoded allowlists drift behind OpenAI's
  // releases and silently reject valid new aliases (e.g. gpt-realtime-2).
  // We still enforce a minimal sanity check (non-empty string).
  let nextModel = current.model;
  if (isAdmin && body.model) {
    const candidate = body.model.trim();
    if (!candidate) {
      return NextResponse.json({ error: "Empty model" }, { status: 400 });
    }
    nextModel = candidate;
  }
  // Voice must be valid for the (potentially-updated) model.
  if (body.voice && !voicesFor(nextModel).includes(body.voice)) {
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
  if (isAdmin && nextModel !== current.model) updates.model = nextModel;
  if (body.voice != null) updates.voice = body.voice;
  if (isAdmin && body.temperature != null)
    updates.temperature = clamp(body.temperature, 0, 1.5);
  if (body.speed != null) updates.speed = clamp(body.speed, 0.5, 1.5);
  if (isAdmin && body.maxResponseTokens != null)
    updates.maxResponseTokens = Math.round(
      clamp(body.maxResponseTokens, 50, 4000),
    );
  if (body.ownerWhatsapp != null) {
    // Light normalization: strip spaces / dashes; accept E.164 or empty.
    const cleaned = body.ownerWhatsapp.replace(/[\s()-]/g, "");
    if (cleaned && !/^\+?\d{6,15}$/.test(cleaned)) {
      return NextResponse.json(
        { error: "WhatsApp invalide (format E.164 attendu, ex: +972585001007)" },
        { status: 400 },
      );
    }
    updates.ownerWhatsapp = cleaned ? (cleaned.startsWith("+") ? cleaned : `+${cleaned}`) : "";
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
  if (body.inheritAdminGlobals != null) {
    updates.inheritAdminGlobals = Boolean(body.inheritAdminGlobals);
  }
  if ("personality" in body) {
    const cleaned = sanitizePersonality(body.personality);
    if (cleaned !== undefined) updates.personality = cleaned;
  }
  if (body.agentName != null) {
    // Trim + clamp 80 chars. Vide accepté (facultatif). Pas de regex stricte
    // pour permettre les noms internationalisés (Sarah, יוהנה, محمد, etc.).
    updates.agentName = String(body.agentName).trim().slice(0, 80);
  }

  const [updated] = await db
    .update(agentConfigs)
    .set(updates)
    .where(eq(agentConfigs.userId, session.user.id))
    .returning();

  await logEvent({
    source: "web",
    event: "config_updated",
    message: `Config mise à jour (${Object.keys(updates).length - 1} champs)`,
    userId: session.user.id,
    metadata: {
      changedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
    },
  });

  return NextResponse.json(updated);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
