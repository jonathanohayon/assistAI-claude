/**
 * POST /api/dashboard/scan-website
 *
 * Scanne le site web d'un tenant et extrait sa config business via plusieurs
 * sous-agents LLM en parallèle. Renvoie un flux NDJSON (un objet JSON par
 * ligne) pour que le wizard affiche la progression de chaque agent EN DIRECT.
 *
 * Cet endpoint ne touche AUCUNE donnée tenant en base : il fetch une URL et
 * appelle OpenAI, puis renvoie un brouillon. L'application au formulaire (et la
 * sauvegarde via PUT /api/dashboard/config) se fait côté client après revue.
 * → une simple session authentifiée suffit (pas de resolveScopeUserId).
 */

import { NextRequest } from "next/server";

import { auth } from "@/auth";
import { logEvent } from "@/lib/logger";
import {
  hoursAgent,
  identityAgent,
  knowledgeAgent,
  languagesAgent,
  locationAgent,
  servicesAgent,
  type AgentKey,
} from "@/lib/website-scan/agents";
import { ScanError, crawlSite, pagesToContext } from "@/lib/website-scan/crawl";
import { assembleDraft, type AgentOutputs } from "@/lib/website-scan/merge";

// Node runtime (cheerio + dns + fetch streaming). Jamais caché (POST).
export const dynamic = "force-dynamic";
// Le crawl multi-pages (rendu JS via Jina) peut prendre 30-90 s.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url) {
    return Response.json({ error: "URL manquante" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        // 1. Crawl
        send({ type: "crawl", status: "start" });
        const pages = await crawlSite(url);
        const pageMeta = pages.map((p) => ({ url: p.url, title: p.title }));
        send({ type: "crawl", status: "done", pages: pageMeta });

        const ctx = pagesToContext(pages);

        // 2. Sous-agents en parallèle. Chaque agent émet running puis done/error
        //    dès qu'il se résout — pas de barrière entre eux.
        const outputs: AgentOutputs = {};
        const runAgent = async <K extends AgentKey>(
          key: K,
          fn: () => Promise<AgentOutputs[K]>,
        ) => {
          send({ type: "agent", agent: key, status: "running" });
          try {
            const result = await fn();
            outputs[key] = result;
            send({
              type: "agent",
              agent: key,
              status: "done",
              confidence: (result as { confidence?: number })?.confidence ?? 0,
            });
          } catch (e) {
            send({
              type: "agent",
              agent: key,
              status: "error",
              error: e instanceof Error ? e.message : "Erreur agent",
            });
          }
        };

        await Promise.all([
          runAgent("identity", () => identityAgent(ctx)),
          runAgent("hours", () => hoursAgent(ctx)),
          runAgent("location", () => locationAgent(ctx)),
          runAgent("services", () => servicesAgent(ctx)),
          runAgent("languages", () => languagesAgent(ctx)),
          runAgent("knowledge", () => knowledgeAgent(ctx)),
        ]);

        // 3. Assemblage + sanitize
        const draft = assembleDraft(outputs, pageMeta);
        send({ type: "result", ...draft });

        void logEvent({
          source: "web",
          event: "website_scanned",
          message: `Scan site web (${pageMeta.length} pages)`,
          userId,
          metadata: {
            url,
            pages: pageMeta.length,
            confidence: draft.confidence,
          },
        });
      } catch (e) {
        const message =
          e instanceof ScanError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Échec du scan.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
