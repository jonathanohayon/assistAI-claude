// Normalisation serveur des champs d'un agent sortant (anti-garbage). Reflète
// les caps appliqués à la persona de campagne (cf. lib/campaigns/validate.ts).

import type { NewOutboundAgent } from "@/lib/db/schema";

import type { AgentChannels, AgentNotifications } from "./types";

const str = (x: unknown, cap = 4000): string =>
  typeof x === "string" ? x.slice(0, cap) : "";

function normalizeNotifications(v: unknown): AgentNotifications {
  if (!v || typeof v !== "object") return {};
  const n = v as Record<string, unknown>;
  const out: AgentNotifications = {};
  if (typeof n.whatsapp === "string" && n.whatsapp.trim())
    out.whatsapp = n.whatsapp.trim().slice(0, 32);
  if (typeof n.email === "string" && n.email.trim())
    out.email = n.email.trim().slice(0, 200);
  return out;
}

function normalizeChannels(v: unknown): AgentChannels {
  if (!v || typeof v !== "object") return { phone: true };
  const c = v as Record<string, unknown>;
  const out: AgentChannels = { phone: c.phone !== false };
  if (c.whatsappVoice === true) out.whatsappVoice = true;
  return out;
}

function normalizeKnowledgeSources(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && !!s.trim())
    .map((s) => s.trim().slice(0, 300))
    .slice(0, 10);
}

function normalizePersonality(v: unknown): {
  vitesse?: number;
  creativite?: number;
  reactivite?: number;
} {
  if (!v || typeof v !== "object") return {};
  const p = v as Record<string, unknown>;
  const dim = (x: unknown): number | undefined => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n >= 1 && n <= 10 ? n : undefined;
  };
  const out: { vitesse?: number; creativite?: number; reactivite?: number } = {};
  const vi = dim(p.vitesse);
  if (vi !== undefined) out.vitesse = vi;
  const cr = dim(p.creativite);
  if (cr !== undefined) out.creativite = cr;
  const re = dim(p.reactivite);
  if (re !== undefined) out.reactivite = re;
  return out;
}

// Champs éditables d'un agent → valeurs prêtes pour insert/update Drizzle.
// `name` est garanti non-vide (fallback sur agentName ou "Agent").
export function normalizeAgentFields(
  body: Record<string, unknown>,
): Omit<NewOutboundAgent, "id" | "userId" | "createdAt" | "updatedAt"> {
  const agentName = str(body.agentName, 120).trim() || "Sarah";
  const name = str(body.name, 160).trim() || agentName || "Agent";
  return {
    name,
    agentName,
    voice: str(body.voice, 60).trim() || "marin",
    language: str(body.language, 12).trim() || "fr",
    instructions: str(body.instructions, 4000),
    greeting: str(body.greeting, 1000),
    // Fiche métier : cap large (on garde tous les prix/détails).
    knowledge:
      typeof body.knowledge === "string" ? body.knowledge.slice(0, 12_000) : "",
    knowledgeSources: normalizeKnowledgeSources(body.knowledgeSources),
    notifications: normalizeNotifications(body.notifications),
    channels: normalizeChannels(body.channels),
    personality: normalizePersonality(body.personality),
    noiseReductionLevel: (() => {
      const n = Math.round(Number(body.noiseReductionLevel));
      return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 8;
    })(),
  };
}
