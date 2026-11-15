// /api/v1/agent/[token] — the public agent webhook, with every I/O injected:
// the route wires the real ones (lib/agent-webhook/deps.ts), tests inject
// fakes (no test ever reaches the LLM provider).
//
// Contract and persona handling are unchanged (see the route). What this adds
// is the SHARED rate limit (lib/agent-webhook/policy.ts), in this order:
//   1. per IP (sha256 of clientIp), before the token is resolved, so unknown
//      tokens guessed from one address count too;
//   2. resolve the token → 404 "Unknown agent." as before;
//   3. per token (accountId = the tenant id, never the raw token).
// Each bucket carries its own global ceiling. Over a limit:
//   429 { error: "rate_limited", scope: "ip" | "token" | "global" } + Retry-After
// Limiter unavailable → 503 { error: "unavailable" } (fails closed).
// Under the limits, responses are byte-identical to the previous route.
//
// Nothing sensitive is stored or logged: limiter rows hold hashes / tenant
// ids and timestamps only; the token and the IP are never logged.

import { NextResponse, type NextRequest } from "next/server";

import {
  AGENT_WEBHOOK_GET_GLOBAL,
  AGENT_WEBHOOK_GET_IP_BUCKET,
  AGENT_WEBHOOK_GET_PER_IP,
  AGENT_WEBHOOK_GET_PER_TOKEN,
  AGENT_WEBHOOK_GET_TOKEN_BUCKET,
  AGENT_WEBHOOK_GET_WINDOW_MS,
  AGENT_WEBHOOK_POST_GLOBAL,
  AGENT_WEBHOOK_POST_IP_BUCKET,
  AGENT_WEBHOOK_POST_PER_IP,
  AGENT_WEBHOOK_POST_PER_TOKEN,
  AGENT_WEBHOOK_POST_TOKEN_BUCKET,
  AGENT_WEBHOOK_POST_WINDOW_MS,
  type AgentWebhookLimitScope,
} from "@/lib/agent-webhook/policy";
import { clientIp } from "@/lib/rate-limit";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import type { ResolvedTenant } from "@/lib/tenant";
import { limiterKey } from "@/lib/verification-limits/policy";

export interface ConsumeRateLimitInput {
  bucket: string;
  accountId: string;
  windowMs: number;
  perAccount: number;
  global: number;
}

export interface AgentWebhookDeps {
  /** lib/agent-tokens.ts resolveAgentToken: the tenant id, or null. */
  resolveToken(token: string): Promise<string | null>;
  /** lib/tenant.ts resolveTenantByUserId. */
  resolveTenant(userId: string): Promise<ResolvedTenant | null>;
  /** lib/rate-limit-db.ts consumeRateLimit. */
  consume(input: ConsumeRateLimitInput): Promise<RateLimitResult>;
  /** The LLM provider key, or undefined (→ stall phrase, as before). */
  openaiKey(): string | undefined;
  /** HTTP client for the LLM call (global fetch in production). */
  fetch: typeof fetch;
  /** Server-side log of a limiter failure (no token, no IP). */
  logLimiterError(e: unknown): void;
}

type Method = "get" | "post";

const RULES = {
  get: {
    windowMs: AGENT_WEBHOOK_GET_WINDOW_MS,
    global: AGENT_WEBHOOK_GET_GLOBAL,
    ip: { bucket: AGENT_WEBHOOK_GET_IP_BUCKET, perAccount: AGENT_WEBHOOK_GET_PER_IP },
    token: { bucket: AGENT_WEBHOOK_GET_TOKEN_BUCKET, perAccount: AGENT_WEBHOOK_GET_PER_TOKEN },
  },
  post: {
    windowMs: AGENT_WEBHOOK_POST_WINDOW_MS,
    global: AGENT_WEBHOOK_POST_GLOBAL,
    ip: { bucket: AGENT_WEBHOOK_POST_IP_BUCKET, perAccount: AGENT_WEBHOOK_POST_PER_IP },
    token: { bucket: AGENT_WEBHOOK_POST_TOKEN_BUCKET, perAccount: AGENT_WEBHOOK_POST_PER_TOKEN },
  },
} as const;

/** null = allowed (already counted); otherwise the response to send. */
async function limit(
  deps: AgentWebhookDeps,
  method: Method,
  key: "ip" | "token",
  accountId: string,
): Promise<NextResponse | null> {
  const rule = RULES[method];
  let rl: RateLimitResult;
  try {
    rl = await deps.consume({
      bucket: rule[key].bucket,
      accountId,
      windowMs: rule.windowMs,
      perAccount: rule[key].perAccount,
      global: rule.global,
    });
  } catch (e) {
    deps.logLimiterError(e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (rl.ok) return null;
  const scope: AgentWebhookLimitScope = rl.scope === "global" ? "global" : key;
  return NextResponse.json(
    { error: "rate_limited", scope },
    { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
  );
}

/** Steps 1–3 above: the tenant id, or the response to send. */
async function admit(
  req: NextRequest,
  token: string,
  method: Method,
  deps: AgentWebhookDeps,
): Promise<{ userId: string } | { response: NextResponse }> {
  const byIp = await limit(deps, method, "ip", limiterKey(clientIp(req.headers)));
  if (byIp) return { response: byIp };
  const userId = await deps.resolveToken(token);
  if (!userId) {
    return { response: NextResponse.json({ error: "Unknown agent." }, { status: 404 }) };
  }
  // Keyed by tenant, not by token string: regenerating the URL does not reset it.
  const byToken = await limit(deps, method, "token", userId);
  if (byToken) return { response: byToken };
  return { userId };
}

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

export async function handleAgentWebhookGet(
  req: NextRequest,
  token: string,
  deps: AgentWebhookDeps,
): Promise<NextResponse> {
  const admitted = await admit(req, token, "get", deps);
  if ("response" in admitted) return admitted.response;
  const tenant = await deps.resolveTenant(admitted.userId);
  return NextResponse.json({
    ok: true,
    service: "tamara-agent",
    agent: tenant?.config?.agentName || "agent",
    contract:
      "POST { call_id, turn_id, language, transcript, history[] } -> { reply }",
    languages: ["en", "fr", "he"],
  });
}

export async function handleAgentWebhookPost(
  req: NextRequest,
  token: string,
  deps: AgentWebhookDeps,
): Promise<NextResponse> {
  const admitted = await admit(req, token, "post", deps);
  if ("response" in admitted) return admitted.response;
  const { userId } = admitted;

  const tenant = await deps.resolveTenant(userId);
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

  const key = deps.openaiKey();
  if (!key) {
    return NextResponse.json({ reply: STALL[language], source: "fallback" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_BUDGET_MS);

  try {
    const res = await deps.fetch("https://api.openai.com/v1/chat/completions", {
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
