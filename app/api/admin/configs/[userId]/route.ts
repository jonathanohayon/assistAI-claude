import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { parseDisclosureText } from "@/lib/ai-disclosure";
import { logEvent } from "@/lib/logger";
import { clamp } from "@/lib/numbers";
import { sanitizePersonality } from "@/lib/personality";
import { voicesFor } from "@/lib/realtime";
import { inboundVoiceConfigAfterLegacy, inboundVoiceConfigUpdates } from "@/lib/voice/route-writes";
import { currentInboundVoice } from "@/lib/voice/store";
import { currentInboundPersona, inboundPersonaAfterLegacy, inboundPersonaUpdates } from "@/lib/persona/store";
import { parseRealtimeProvider } from "@/lib/realtime-provider";
import { parseTransferNumber } from "@/lib/transfer-number";
import { legacyTransferWriteUpdates } from "@/lib/tools/legacy-sync";
import { withoutToolsStore } from "@/lib/tools/store";
import { mergeVoiceProfile } from "@/lib/voice-profile";

interface Ctx {
  params: Promise<{ userId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

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

  // Voice contract (V5): stored voice or derived from the columns (admin: full).
  return NextResponse.json({
    user,
    config: cfg
      ? {
          ...withoutToolsStore(cfg),
          voiceConfig: currentInboundVoice(cfg.voiceConfig, cfg),
          personaConfig: currentInboundPersona(cfg.personaConfig, cfg),
        }
      : null,
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  const { userId } = await ctx.params;
  // body optionnel : tous les champs sont facultatifs (body vide = touch
  // updatedAt seulement), on garde donc le fallback {} silencieux.
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
    reminderEnabled: boolean;
    inheritAdminGlobals: boolean;
    personality: Record<string, number>;
    agentName: string;
    realtimeProvider: string | null;
    voiceProfile: unknown;
    transferNumber: string | null;
    aiDisclosureEnabled: boolean;
    aiDisclosureText: string | null;
    ownerDigestEnabled: boolean;
  }>;

  // Model accepted as-is — picker is fed by live OpenAI catalog
  // (/api/realtime/catalog), and OpenAI validates at session-create time.
  // Hardcoded allowlist drift was rejecting valid new aliases.
  if (body.model != null && body.model.trim() === "") {
    return NextResponse.json({ error: "Empty model" }, { status: 400 });
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
  // temperature is no longer written: OpenAI Realtime GA rejects it and the
  // worker never sent it. The column stays (read by nothing) until dropped.
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
  if (body.reminderEnabled != null) {
    updates.reminderEnabled = Boolean(body.reminderEnabled);
  }
  if (body.inheritAdminGlobals != null) {
    updates.inheritAdminGlobals = Boolean(body.inheritAdminGlobals);
  }
  if ("personality" in body) {
    const cleaned = sanitizePersonality(body.personality);
    if (cleaned !== undefined) updates.personality = cleaned;
  }
  if (body.agentName != null) {
    updates.agentName = String(body.agentName).trim().slice(0, 80);
  }
  if ("transferNumber" in body) {
    const tn = parseTransferNumber(body.transferNumber);
    if (!tn.ok) return NextResponse.json({ error: tn.error }, { status: 400 });
    updates.transferNumber = tn.value;
    // Tools T3: nothing stays parked; a stored `tools` is refreshed.
    Object.assign(updates, await legacyTransferWriteUpdates(userId, tn.value));
  }
  if ("aiDisclosureEnabled" in body) {
    updates.aiDisclosureEnabled = body.aiDisclosureEnabled !== false;
  }
  if ("aiDisclosureText" in body) {
    const dt = parseDisclosureText(body.aiDisclosureText);
    if (!dt.ok) return NextResponse.json({ error: dt.error }, { status: 400 });
    updates.aiDisclosureText = dt.value;
  }
  if ("ownerDigestEnabled" in body) {
    updates.ownerDigestEnabled = body.ownerDigestEnabled !== false;
  }
  if ("voiceProfile" in body) {
    const [current] = await db
      .select({ voiceProfile: agentConfigs.voiceProfile })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .limit(1);
    const vp = mergeVoiceProfile(current?.voiceProfile ?? null, body.voiceProfile);
    if (!vp.ok) return NextResponse.json({ error: vp.error }, { status: 400 });
    updates.voiceProfile = vp.value;
  }
  if ("realtimeProvider" in body) {
    const rp = parseRealtimeProvider(body.realtimeProvider);
    if (!rp.ok) return NextResponse.json({ error: rp.error }, { status: 400 });
    updates.realtimeProvider = rp.value;
  }

  // Voice contract (V5, write-alongside), same rules as the tenant route.
  const [currentRow] = await db.select().from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1);
  if (!currentRow) return NextResponse.json({ error: "not found" }, { status: 404 });
  const voiceWrite = inboundVoiceConfigUpdates(body as Record<string, unknown>, currentRow, true, voicesFor);
  if (voiceWrite && "error" in voiceWrite) {
    return NextResponse.json(voiceWrite.error.body, { status: voiceWrite.error.status });
  }
  if (voiceWrite) Object.assign(updates, voiceWrite.updates);
  else updates.voiceConfig = inboundVoiceConfigAfterLegacy(currentRow, updates);
  // Persona contract (P3, write-alongside), same rules as the tenant route.
  const personaWrite = inboundPersonaUpdates(body as Record<string, unknown>, currentRow, true);
  if (personaWrite && "error" in personaWrite) {
    return NextResponse.json(personaWrite.error.body, { status: personaWrite.error.status });
  }
  if (personaWrite) Object.assign(updates, personaWrite.updates);
  else updates.personaConfig = inboundPersonaAfterLegacy(currentRow, updates);

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

  // Pré-génère l'audio d'accueil du tenant édité (fire-and-forget).
  void warmGreetingAudioForUser(userId);

  return NextResponse.json({
    ...withoutToolsStore(updated),
    voiceConfig: currentInboundVoice(updated.voiceConfig, updated),
    personaConfig: currentInboundPersona(updated.personaConfig, updated),
  });
}
