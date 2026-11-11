import { desc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { outboundVoiceConfigAfterLegacy, outboundVoiceConfigUpdates } from "@/lib/voice/route-writes";
import { currentOutboundVoice, voiceForViewer } from "@/lib/voice/store";
import { currentOutboundPersona, outboundPersonaAfterLegacy, outboundPersonaUpdates } from "@/lib/persona/store";
import { db } from "@/lib/db";
import { campaigns, outboundAgents } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { withoutToolsStore } from "@/lib/tools/store";
import { withoutMissionStore } from "@/lib/mission/store";
import { normalizeAgentFields } from "@/lib/outbound-agents/validate";

// GET — liste des agents sortants du tenant + nb de campagnes qui les utilisent.
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(outboundAgents)
    .where(eq(outboundAgents.userId, r.userId))
    .orderBy(desc(outboundAgents.createdAt));

  const ids = rows.map((a) => a.id);
  const usageRows = ids.length
    ? await db
        .select({
          agentId: campaigns.agentId,
          count: sql<number>`count(*)::int`,
        })
        .from(campaigns)
        .where(inArray(campaigns.agentId, ids))
        .groupBy(campaigns.agentId)
    : [];
  const usage = new Map(usageRows.map((u) => [u.agentId, u.count]));

  const isAdmin = await sessionIsAdmin();
  return NextResponse.json({
    agents: rows.map((a) => ({
      ...withoutMissionStore(withoutToolsStore(a)),
      voiceConfig: voiceForViewer(currentOutboundVoice(a.voiceConfig, a), isAdmin),
      personaConfig: currentOutboundPersona(a.personaConfig, a),
      campaignCount: usage.get(a.id) ?? 0,
    })),
  });
}

// POST — création d'un agent sortant.
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // body optionnel : normalizeAgentFields applique des défauts sur tout.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = normalizeAgentFields(body);

  // Voice contract (V5, write-alongside): a `voiceConfig` sets the legacy
  // voice columns too; otherwise the voice is derived from them.
  const voiceCols = {
    voice: fields.voice ?? null,
    personality: fields.personality ?? null,
    noiseReductionLevel: fields.noiseReductionLevel ?? null,
    voiceConfig: null,
  };
  const voiceWrite = outboundVoiceConfigUpdates(body, voiceCols, await sessionIsAdmin());
  if (voiceWrite && "error" in voiceWrite) {
    return NextResponse.json(voiceWrite.error.body, { status: voiceWrite.error.status });
  }
  const voiceFields = voiceWrite ? voiceWrite.updates : { voiceConfig: outboundVoiceConfigAfterLegacy(voiceCols, {}) };

  // Persona contract (P3, write-alongside), same rules as the receptionist.
  const personaCols = {
    agentName: fields.agentName ?? null,
    language: fields.language ?? null,
    greeting: fields.greeting ?? null,
    personaConfig: null,
  };
  const personaWrite = outboundPersonaUpdates(body, personaCols, await sessionIsAdmin());
  if (personaWrite && "error" in personaWrite) {
    return NextResponse.json(personaWrite.error.body, { status: personaWrite.error.status });
  }
  const personaFields = personaWrite
    ? personaWrite.updates
    : { personaConfig: outboundPersonaAfterLegacy(personaCols, {}) };

  const [created] = await db
    .insert(outboundAgents)
    .values({ userId: r.userId, ...fields, ...voiceFields, ...personaFields })
    .returning();

  await logEvent({
    source: "web",
    event: "outbound_agent_created",
    message: `Agent sortant créé: ${created.name}`,
    userId: r.userId,
    metadata: { agentId: created.id },
  });

  const isAdmin = await sessionIsAdmin();
  return NextResponse.json(
    {
      agent: {
        ...withoutMissionStore(withoutToolsStore(created)),
        voiceConfig: voiceForViewer(currentOutboundVoice(created.voiceConfig, created), isAdmin),
        personaConfig: currentOutboundPersona(created.personaConfig, created),
        campaignCount: 0,
      },
    },
    { status: 201 },
  );
}
