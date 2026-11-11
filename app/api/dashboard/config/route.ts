import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { inboundLegacyVoiceUpdates, inboundVoiceConfigUpdates } from "@/lib/voice/route-writes";
import { currentInboundVoice, voiceForViewer } from "@/lib/voice/store";
import { currentInboundPersona, inboundPersonaAfterLegacy, inboundPersonaUpdates } from "@/lib/persona/store";
import { sheetAfterBusinessWrite } from "@/lib/knowledge/store";
import { planConfigBusinessWrite } from "@/lib/locations-cap";
import { inheritAdminGlobalsWrite } from "@/lib/admin-gates";
import { parseDisclosureText } from "@/lib/ai-disclosure";
import { logEvent } from "@/lib/logger";
import { clamp } from "@/lib/numbers";
import { sanitizePersonality } from "@/lib/personality";
import { voicesFor } from "@/lib/realtime";
import { adminOnlyProviderUpdate, withoutAdminOnlyFields } from "@/lib/realtime-provider";
import { parseTransferNumber } from "@/lib/transfer-number";
import { legacyTransferWriteUpdates } from "@/lib/tools/legacy-sync";
import { withoutToolsStore } from "@/lib/tools/store";
import { voiceChoiceFor } from "@/lib/voice/choice-load";
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

  if (!config || !row) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }

  // Voice contract (V5): the stored voice, or derived from the columns;
  // admin-only paths removed for tenants (no provider trace).
  return NextResponse.json({
    ...withoutToolsStore(config),
    voiceConfig: voiceForViewer(currentInboundVoice(row.config.voiceConfig, row.config), row.role === "admin"),
    // V8b: the voice choice as OUR ids for the account's engine (no engine
    // name, no engine voice name) — what the picker sends back as voiceId.
    voiceChoice: await voiceChoiceFor(row.config, row.role === "admin"),
    personaConfig: currentInboundPersona(row.config.personaConfig, row.config),
  });
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
    ownerDigestEnabled: boolean;
    noiseReductionLevel: number;
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
      // Voice columns: V5 stores `voiceConfig` alongside them.
      voice: agentConfigs.voice,
      speed: agentConfigs.speed,
      realtimeProvider: agentConfigs.realtimeProvider,
      voiceProfile: agentConfigs.voiceProfile,
      noiseReductionLevel: agentConfigs.noiseReductionLevel,
      voiceConfig: agentConfigs.voiceConfig,
      // Persona columns: P3 stores `personaConfig` alongside them.
      agentName: agentConfigs.agentName,
      primaryLanguage: agentConfigs.primaryLanguage,
      greetingInstructions: agentConfigs.greetingInstructions,
      aiDisclosureEnabled: agentConfigs.aiDisclosureEnabled,
      aiDisclosureText: agentConfigs.aiDisclosureText,
      personaConfig: agentConfigs.personaConfig,
      inheritAdminGlobals: agentConfigs.inheritAdminGlobals,
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
        { error: "WhatsApp invalide (format E.164 attendu, ex: +972500000000)" },
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
  // Admin-only since 11/11 (product change): a tenant CHANGE → 403;
  // existing values are kept.
  const inherit = inheritAdminGlobalsWrite(body, current.inheritAdminGlobals !== false, isAdmin);
  if (!inherit.ok) return NextResponse.json({ error: inherit.error, fields: inherit.fields }, { status: 403 });
  if (inherit.value !== undefined) updates.inheritAdminGlobals = inherit.value;
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
    // Tools T3: nothing stays parked; a stored `tools` is refreshed.
    Object.assign(updates, await legacyTransferWriteUpdates(guard.userId, tn.value));
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
  // Deprecated inbound `knowledge` array (Knowledge S6a): no longer written.
  // The facts live in `business` / the account company sheet. Refused
  // explicitly rather than ignored, so a caller knows nothing was saved.
  if ("knowledge" in body) {
    return NextResponse.json(
      { error: "knowledge_field_removed", fields: ["knowledge"], use: "PUT /api/dashboard/company-sheet" },
      { status: 400 },
    );
  }
  if ("business" in body) {
    // Sanitization complète (cf. lib/business.ts) — toujours renvoie un
    // objet valide (jamais throw). Cast ::jsonb explicite à cause du
    // bug postgres-js sur les objets/arrays JS qui se serialisent en
    // text[] par défaut (cf. fix knowledge column).
    // Location cap (lib/locations-cap.ts): a `business` without `centres`
    // keeps the stored ones; ADDING beyond the plan's cap → 403.
    const [stored] = await db
      .select({ business: agentConfigs.business, plan: users.subscriptionPlan })
      .from(agentConfigs)
      .innerJoin(users, eq(users.id, agentConfigs.userId))
      .where(eq(agentConfigs.userId, guard.userId))
      .limit(1);
    const write = planConfigBusinessWrite(body.business, stored?.business, stored?.plan);
    if (!write.ok) return NextResponse.json(write.body, { status: write.status });
    const cleaned = write.business;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updates as any).business = sql`${JSON.stringify(cleaned)}::jsonb`;
    // Knowledge S4 (write-alongside): refresh the account's company sheet
    // from the saved business, keeping its FAQ and sources.
    const [acct] = await db.select({ companySheet: users.companySheet }).from(users).where(eq(users.id, guard.userId)).limit(1);
    await db
      .update(users)
      .set({ companySheet: sql`${JSON.stringify(sheetAfterBusinessWrite(acct?.companySheet ?? null, cleaned))}::jsonb` } as never)
      .where(eq(users.id, guard.userId));
  }

  // Voice contract (V5, write-alongside): a `voiceConfig` patch writes the
  // legacy voice columns it maps to; any other save refreshes the stored
  // voice from the columns. Readers still use the legacy columns.
  const voiceWrite = inboundVoiceConfigUpdates(body as Record<string, unknown>, current, isAdmin, voicesFor);
  if (voiceWrite && "error" in voiceWrite) {
    return NextResponse.json(voiceWrite.error.body, { status: voiceWrite.error.status });
  }
  if (voiceWrite) Object.assign(updates, voiceWrite.updates);
  // V8e: an admin engine switch carries the voice to its equivalent.
  else Object.assign(updates, inboundLegacyVoiceUpdates(current, updates));

  // Persona contract (P3, write-alongside), same pattern. "Automatic" keeps
  // the customer's sentence in personaConfig while the column gets ''.
  const personaWrite = inboundPersonaUpdates(body as Record<string, unknown>, current, isAdmin);
  if (personaWrite && "error" in personaWrite) {
    return NextResponse.json(personaWrite.error.body, { status: personaWrite.error.status });
  }
  if (personaWrite) Object.assign(updates, personaWrite.updates);
  else updates.personaConfig = inboundPersonaAfterLegacy(current, updates);

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

  return NextResponse.json({
    ...withoutToolsStore(updated),
    voiceConfig: voiceForViewer(currentInboundVoice(updated.voiceConfig, updated), isAdmin),
    // V8c: recomputed after the write — which of OUR ids is now selected.
    voiceChoice: await voiceChoiceFor(updated, isAdmin),
    personaConfig: currentInboundPersona(updated.personaConfig, updated),
  });
}
