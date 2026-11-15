import { NextRequest } from "next/server";

import { agentWebhookDeps } from "@/lib/agent-webhook/deps";
import { handleAgentWebhookGet, handleAgentWebhookPost } from "@/lib/agent-webhook/handler";

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
 *
 * The logic lives in lib/agent-webhook/handler.ts (I/O injected, so it is
 * tested without the LLM provider), including the shared DB rate limit on
 * both GET and POST: per IP, per token, and a global ceiling
 * (lib/agent-webhook/policy.ts).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleAgentWebhookGet(req, token, agentWebhookDeps);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleAgentWebhookPost(req, token, agentWebhookDeps);
}
