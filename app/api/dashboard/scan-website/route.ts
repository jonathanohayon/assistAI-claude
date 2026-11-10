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

import { requireSession } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { extractSheetDraft } from "@/lib/knowledge/learn";

// Node runtime (cheerio + dns + fetch streaming). Jamais caché (POST).
export const dynamic = "force-dynamic";
// Le crawl multi-pages (rendu JS via Jina) peut prendre 30-90 s.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const userId = guard.userId;

  const parsed = await parseJsonBody<{ url?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const url = (parsed.data.url ?? "").trim();
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
        // The one learning service (Knowledge S2): crawl + extraction agents.
        await extractSheetDraft(url, userId, send);
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
