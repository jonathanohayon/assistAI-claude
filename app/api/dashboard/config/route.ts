import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api/auth-guards";
import { sanitizeBusinessConfig } from "@/lib/business";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { parseDisclosureText } from "@/lib/ai-disclosure";
import { logEvent } from "@/lib/logger";
import { clamp } from "@/lib/numbers";
import { sanitizePersonality } from "@/lib/personality";
import { voicesFor } from "@/lib/realtime";
import { adminOnlyProviderUpdate, withoutAdminOnlyFields } from "@/lib/realtime-provider";
import { parseTransferNumber } from "@/lib/transfer-number";
import { mergeVoiceProfile } from "@/lib/voice-profile";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const [row] = await db
    .select({ config: agentConfigs, role: users.role })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(eq(agentConfigs.userId, guard.userId))
    .limit(1);
  // The speech engine is admin-only: tenants never see it, even in the API.
  const config = row
    ? row.role === "admin"
      ? row.config
      : withoutAdminOnlyFields(row.config)
    : undefined;

  if (!config) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  // body optionnel : tous les champs sont facultatifs, un body vide est un
  // no-op valide (seul updatedAt bouge).
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
    transferNumber: string | null;
    aiDisclosureEnabled: boolean;
    aiDisclosureText: string | null;
    noiseReductionLevel: number;
    knowledge: Array<{
      id?: string;
      toolName?: string;
      businessName?: string;
      openingHours?: string;
      description?: string;
    }>;
    business: unknown;
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
    .where(eq(agentConfigs.userId, guard.userId))
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
  // temperature: no longer written (OpenAI Realtime GA rejects it).
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
    // Trim + clamp 80 chars. Vide accepté (facultatif). Pas de regex stricte
    // pour permettre les noms internationalisés (Sarah, יוהנה, محمد, etc.).
    updates.agentName = String(body.agentName).trim().slice(0, 80);
  }
  // Call-transfer number: the tenant's own setting (not admin-only).
  if ("transferNumber" in body) {
    const tn = parseTransferNumber(body.transferNumber);
    if (!tn.ok) return NextResponse.json({ error: tn.error }, { status: 400 });
    updates.transferNumber = tn.value;
  }
  if ("aiDisclosureEnabled" in body) {
    updates.aiDisclosureEnabled = body.aiDisclosureEnabled !== false;
  }
  if ("aiDisclosureText" in body) {
    const dt = parseDisclosureText(body.aiDisclosureText);
    if (!dt.ok) return NextResponse.json({ error: dt.error }, { status: 400 });
    updates.aiDisclosureText = dt.value;
  }
  const providerUpdate = adminOnlyProviderUpdate(body as Record<string, unknown>, isAdmin);
  if ("error" in providerUpdate) {
    return NextResponse.json({ error: providerUpdate.error }, { status: 400 });
  }
  Object.assign(updates, providerUpdate.update);
  // Voice profile: admin-only, silently ignored for tenants (like the engine).
  if (isAdmin && "voiceProfile" in (body as Record<string, unknown>)) {
    const [cur] = await db
      .select({ voiceProfile: agentConfigs.voiceProfile })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, guard.userId))
      .limit(1);
    const vp = mergeVoiceProfile(cur?.voiceProfile ?? null, (body as Record<string, unknown>).voiceProfile);
    if (!vp.ok) return NextResponse.json({ error: vp.error }, { status: 400 });
    updates.voiceProfile = vp.value;
  }
  if (body.noiseReductionLevel != null) {
    // Slider 1-10 → enhancementLevel 0.1-1.0 côté worker. On stocke 1-10
    // pour rester user-friendly côté UI/admin lectures.
    updates.noiseReductionLevel = Math.round(
      clamp(body.noiseReductionLevel, 1, 10),
    );
  }
  if (Array.isArray(body.knowledge)) {
    // Sanitize : trim strings, cap lengths, drop empty entries, ensure id.
    // toolName est sanitize en identifiant valide (a-z, 0-9, _, lead letter)
    // car il devient le NOM RÉEL d'un tool LLM côté worker.
    const sanitizeTool = (raw: string): string =>
      raw
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
    const cleaned = body.knowledge
      .map((entry, idx) => {
        const rawTool = String(entry?.toolName ?? "").trim().slice(0, 60);
        const toolName = sanitizeTool(rawTool);
        return {
          id: String(entry?.id ?? `${Date.now()}-${idx}`).slice(0, 64),
          toolName,
          businessName: String(entry?.businessName ?? "").trim().slice(0, 120),
          openingHours: String(entry?.openingHours ?? "").trim().slice(0, 500),
          description: String(entry?.description ?? "").trim().slice(0, 4000),
        };
      })
      .filter(
        (e) =>
          e.businessName.length > 0 ||
          e.toolName.length > 0 ||
          e.description.length > 0,
      )
      .slice(0, 30); // garde-fou : max 30 entrées par tenant
    // Cast SQL explicite ::jsonb car postgres-js sérialise les arrays JS en
    // ARRAY Postgres natif (text[]) par défaut, ce qui ne matche pas la
    // colonne jsonb. Le cast force le bon type d'entrée même si Drizzle
    // ne le détecte pas via $type<Array<...>>. Symptôme sans le cast :
    // UPDATE silently no-op, colonne reste à `[]` même avec data envoyée.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updates as any).knowledge = sql`${JSON.stringify(cleaned)}::jsonb`;
  }
  if ("business" in body) {
    // Sanitization complète (cf. lib/business.ts) — toujours renvoie un
    // objet valide (jamais throw). Cast ::jsonb explicite à cause du
    // bug postgres-js sur les objets/arrays JS qui se serialisent en
    // text[] par défaut (cf. fix knowledge column).
    const cleaned = sanitizeBusinessConfig(body.business);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updates as any).business = sql`${JSON.stringify(cleaned)}::jsonb`;
  }

  const [updated] = await db
    .update(agentConfigs)
    .set(updates)
    .where(eq(agentConfigs.userId, guard.userId))
    .returning();

  await logEvent({
    source: "web",
    event: "config_updated",
    message: `Config mise à jour (${Object.keys(updates).length - 1} champs)`,
    userId: guard.userId,
    metadata: {
      changedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
    },
  });

  // Pré-génère l'audio d'accueil en arrière-plan (greeting/voix/langue ont pu
  // changer) → 1er appel instantané. Fire-and-forget, ne bloque pas la réponse.
  void warmGreetingAudioForUser(guard.userId);

  return NextResponse.json(updated);
}
