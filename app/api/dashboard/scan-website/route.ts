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
 * Scoped with resolveTargetUserId (?asUserId= for admins), so the scan is
 * logged for the tenant it was made for.
 *
 * Location cap (lib/locations-cap.ts): the scan is never refused. Its
 * `result` event also carries `locationCap` (the tenant's plan cap) and
 * `centresTruncated` (true when the site lists more NEW locations than the
 * room left under the cap, against the stored ones); the proposal then adds
 * only the first ones that fit and never removes an existing location.
 */

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { sanitizeBusinessConfig } from "@/lib/business";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { extractSheetDraft, type ScanEvent } from "@/lib/knowledge/learn";
import { scanResultWithCap } from "@/lib/locations-cap";

// Node runtime (cheerio + dns + fetch streaming). Jamais caché (POST).
export const dynamic = "force-dynamic";
// Le crawl multi-pages (rendu JS via Jina) peut prendre 30-90 s.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Scoped like the other dashboard routes: an admin scanning with
  // ?asUserId= acts on (and logs for) that tenant.
  const scope = await resolveTargetUserId(req);
  if ("unauthorized" in scope) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in scope) return Response.json({ error: "Forbidden" }, { status: 403 });
  const userId = scope.userId;

  const parsed = await parseJsonBody<{ url?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const url = (parsed.data.url ?? "").trim();
  if (!url) {
    return Response.json({ error: "URL manquante" }, { status: 400 });
  }

  const [account] = await db
    .select({ business: agentConfigs.business, plan: users.subscriptionPlan })
    .from(users)
    .leftJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  const storedCentres = sanitizeBusinessConfig(account?.business).centres;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: ScanEvent) => {
        const ev = obj.type === "result" ? scanResultWithCap(obj, storedCentres, account?.plan) : obj;
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
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
