import { NextRequest, NextResponse } from "next/server";

import { resolveAgentToken } from "@/lib/agent-tokens";
import { resolveTenantByUserId } from "@/lib/tenant";

/**
 * Webhook public d'un agent tenant — l'URL que l'utilisateur copie depuis son
 * dashboard et colle dans tamaravox (ou n'importe quel client vocal).
 *
 * Contrat Tamara :
 *   POST { call_id, turn_id, language, transcript, history[] }
 *   → 200 { reply }   dans un budget de 2 s
 *
 * L'agent répond avec la persona réelle du tenant (celle configurée dans son
 * dashboard), pas avec un script générique : c'est bien SON agent qui est
 * joignable.
 *
 * Le jeton est dans le chemin, pas dans un header, pour que l'URL soit
 * autoportante — un service tiers ne peut coller qu'une URL. Il est distinct
 * de la clé API v1, qui donne accès aux transcripts : exposer cette URL ne
 * doit ouvrir que la parole.
 */

// Budget interne, calibré sur la PRODUCTION et non sur une machine de dev.
//
// Mesuré depuis Railway (europe-west4) vers OpenAI (US) : ~1,53 s de bout en
// bout, là où le local tournait à ~1,1 s. Un budget de 1,3 s faisait donc
// retomber CHAQUE tour sur la phrase d'attente en prod — la fonctionnalité
// avait l'air de marcher et ne disait jamais rien d'utile.
//
// 1,75 s laisse la marge dont le worker a besoin : il coupe à 2 s, et le
// trajet worker→web est intra-région (quelques ms).
const INTERNAL_BUDGET_MS = 1750;
const MAX_TRANSCRIPT = 600;
const MAX_HISTORY = 10;

type Lang = "en" | "fr" | "he";

const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  fr: "French",
  he: "Hebrew",
};

/** Repli quand le modèle est indisponible — jamais de silence sur un appel. */
const STALL: Record<Lang, string> = {
  fr: "Un instant, je vérifie cela pour vous.",
  he: "רגע אחד, אני בודקת עבורך.",
  en: "One moment, let me check that for you.",
};

function pickLanguage(value: unknown): Lang {
  return value === "fr" || value === "he" ? value : "en";
}

/**
 * Cache d'accueil, par tenant et par langue.
 *
 * La phrase d'ouverture ne dépend pas de l'appelant : la recalculer à chaque
 * appel, c'est jouer à pile ou face avec le budget du tour (mesuré entre 1,2 s
 * et 1,6 s pour un budget de 1,3 s — un appel sur trois démarrait sur la
 * phrase d'attente). Une fois chaude, l'ouverture part instantanément.
 */
const GREETING_TTL_MS = 10 * 60 * 1000;
const greetingCache = new Map<string, { text: string; expiresAt: number }>();

function cachedGreeting(key: string): string | null {
  const hit = greetingCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    greetingCache.delete(key);
    return null;
  }
  return hit.text;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const userId = await resolveAgentToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Unknown agent." }, { status: 404 });
  }
  const tenant = await resolveTenantByUserId(userId);
  return NextResponse.json({
    ok: true,
    service: "tamara-agent",
    agent: tenant?.config?.agentName || "agent",
    contract:
      "POST { call_id, turn_id, language, transcript, history[] } -> { reply }",
    languages: ["en", "fr", "he"],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const userId = await resolveAgentToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Unknown agent." }, { status: 404 });
  }

  const tenant = await resolveTenantByUserId(userId);
  if (!tenant) {
    return NextResponse.json({ error: "Agent not configured." }, { status: 404 });
  }

  let body: {
    transcript?: unknown;
    language?: unknown;
    history?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const language = pickLanguage(body.language ?? tenant.config.primaryLanguage);
  const transcript =
    typeof body.transcript === "string"
      ? body.transcript.slice(0, MAX_TRANSCRIPT).trim()
      : "";
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role?: unknown; text?: unknown }>)
        .filter((t) => typeof t?.text === "string")
        .slice(-MAX_HISTORY)
    : [];

  // La persona du tenant, telle qu'il l'a écrite dans son dashboard. On la
  // borne : un prompt de plusieurs milliers de tokens ferait dépasser le
  // budget du tour.
  //
  // Le tour d'ouverture n'en prend qu'un extrait. Envoyer la persona entière
  // pour produire « bonjour » coûtait ~1,6 s et retombait sur la phrase
  // d'attente — soit un appel qui démarre sur « un instant, je vérifie »
  // avant que l'appelant ait dit un mot. Un accueil n'a pas besoin des
  // horaires ni du catalogue.
  const fullPersona = (tenant.config.instructions ?? "").slice(0, 6000);
  const persona = transcript ? fullPersona : fullPersona.slice(0, 700);

  const agentName = tenant.config.agentName?.trim();
  const system = transcript
    ? `${persona}\n\n` +
      `CANAL : téléphone. Réponds en ${LANG_LABEL[language]}. ` +
      `Une à deux phrases courtes, dites à voix haute. ` +
      `Pas de markdown, pas de listes, pas d'emoji.`
    : `${persona}\n\n` +
      `CANAL : téléphone, tout début de l'appel. ` +
      `Accueille l'appelant en ${LANG_LABEL[language]} en UNE phrase courte` +
      (agentName ? `, en te présentant comme ${agentName}` : "") +
      `. Pas de markdown, pas d'emoji.`;

  // Ouverture déjà connue pour ce tenant/langue → on répond sans réseau.
  const greetingKey = `${userId}:${language}`;
  if (!transcript) {
    const hit = cachedGreeting(greetingKey);
    if (hit) {
      return NextResponse.json({ reply: hit, source: "cached", language });
    }
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ reply: STALL[language], source: "fallback" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_BUDGET_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 70,
        messages: [
          { role: "system", content: system },
          ...history.map((turn) => ({
            role: turn.role === "agent" ? "assistant" : "user",
            content: String(turn.text).slice(0, 300),
          })),
          ...(transcript ? [{ role: "user", content: transcript }] : []),
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ reply: STALL[language], source: "fallback" });
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const reply = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (reply && !transcript) {
      greetingCache.set(greetingKey, {
        text: reply,
        expiresAt: Date.now() + GREETING_TTL_MS,
      });
    }
    return NextResponse.json({
      reply: reply ?? STALL[language],
      source: reply ? "model" : "fallback",
      language,
    });
  } catch {
    // Timeout ou panne fournisseur. Sur un appel, une phrase d'attente à
    // l'heure vaut mieux qu'une réponse parfaite hors budget.
    return NextResponse.json({ reply: STALL[language], source: "fallback" });
  } finally {
    clearTimeout(timer);
  }
}
