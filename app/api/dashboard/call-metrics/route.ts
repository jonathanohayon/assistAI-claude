import { and, desc, eq, gte, lte, SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

// GET /api/dashboard/call-metrics?period=24h|7d|30d&since=<iso>&until=<iso>&asUserId=<uuid>
//
// Renvoie les events `call_metrics` du tenant authentifié, filtrés par
// période. Utilisé par le LatencyChart de l'onglet Monitoring.
//
// `asUserId` permet à un admin d'auditer le monitoring d'un tenant cible
// (cf. /admin/users/[userId]/logs). Ignoré si le caller n'est pas admin.
//
// Format renvoyé : array de points latence — un par appel terminé, avec
// les 8 dimensions de latence (setup × 4, runtime × 4) + le total E2E.

const PERIOD_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

// Forme partielle des metadata d'un event call_metrics — on lit
// défensivement, tout est optional pour gérer les appels où certaines
// métriques sont vides (greeting interrompu, transcription manquante…).
interface CallMetricsMetadata {
  setupMs?: {
    total?: number;
    connect?: number;
    sipWait?: number;
    configFetch?: number;
    sessionStart?: number;
  };
  greetingMs?: number;
  ttfaMs?: { mean?: number | null; p95?: number | null };
  serverEouDelayMs?: { mean?: number | null };
  serverFirstAudioDelayMs?: { mean?: number | null };
  transcriptionDelayMs?: { mean?: number | null };
  // Arrays par tour de conversation — utilisés par le drill-down chart.
  rawTtftMs?: number[];
  rawServerEouMs?: number[];
  rawServerTransMs?: number[];
  rawServerFirstAudioMs?: number[];
  toNumber?: string;
  fromNumber?: string;
  topology?: {
    twilio?: string;
    worker?: string;
    web?: string;
    livekit?: string;
    openai?: string;
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const period = url.searchParams.get("period") ?? "24h";
  const sinceRaw = url.searchParams.get("since");
  const untilRaw = url.searchParams.get("until");
  const asUserId = url.searchParams.get("asUserId");

  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId,
  });
  if ("forbidden" in scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Construit la fenêtre temporelle. Priorité : since/until explicites,
  // sinon period preset, sinon 24h par défaut.
  const now = new Date();
  let sinceDate: Date;
  let untilDate: Date | null = null;
  if (sinceRaw) {
    const d = new Date(sinceRaw);
    sinceDate = Number.isNaN(d.getTime())
      ? new Date(now.getTime() - PERIOD_MS["24h"]!)
      : d;
  } else {
    const windowMs = PERIOD_MS[period] ?? PERIOD_MS["24h"]!;
    sinceDate = new Date(now.getTime() - windowMs);
  }
  if (untilRaw) {
    const d = new Date(untilRaw);
    if (!Number.isNaN(d.getTime())) untilDate = d;
  }

  const conditions: SQL[] = [
    eq(events.userId, scope.userId),
    eq(events.event, "call_metrics"),
    gte(events.createdAt, sinceDate),
  ];
  if (untilDate) conditions.push(lte(events.createdAt, untilDate));

  const rows = await db
    .select({
      id: events.id,
      createdAt: events.createdAt,
      metadata: events.metadata,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(500);

  const points = rows.map((row) => {
    const m = (row.metadata ?? {}) as CallMetricsMetadata;
    const setup = m.setupMs ?? {};
    const ttfa = m.ttfaMs?.mean ?? null;
    const ttfaP95 = m.ttfaMs?.p95 ?? null;
    const eou = m.serverEouDelayMs?.mean ?? null;
    const firstAudio = m.serverFirstAudioDelayMs?.mean ?? null;
    const trans = m.transcriptionDelayMs?.mean ?? null;
    const greeting = m.greetingMs ?? null;

    // Total E2E = TTFA mean (latence perçue par l'utilisateur, moyennée
    // sur les tours de l'appel). Si pas mesuré (appel court sans turn
    // user), on retombe sur greetingMs (latence init).
    const totalE2eMs = ttfa ?? greeting ?? null;

    return {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      // Origin SIP vs Web inférée depuis la présence d'un toNumber SIP
      origin: m.toNumber ? "sip" : "web",
      // 8 hops + total
      latencies: {
        // 1. SIP/web → worker (LiveKit signaling propagation)
        twilioToWorker: setup.sipWait ?? null,
        // 2. Worker → LiveKit (room.connect handshake)
        workerToLivekit: setup.connect ?? null,
        // 3. Worker → web (HTTP /api/agent/config)
        workerToWebConfig: setup.configFetch ?? null,
        // 4. Worker → OpenAI Realtime (WS handshake)
        workerToOpenai: setup.sessionStart ?? null,
        // 5. Greeting full latency (config done → 1st audio chunk audible)
        greeting: greeting,
        // 6. Transcription (user speech committed → STT done)
        transcription: trans,
        // 7. EOU (user speech stopped → response.created LLM start)
        endOfUtterance: eou,
        // 8. First audio (response.created → 1st audio chunk OpenAI)
        firstAudio: firstAudio,
      },
      // Métriques candidates pour l'axe Y (sélectionnable côté UI)
      yMetrics: {
        ttfa,
        p95: ttfaP95,
        greeting,
      },
      // Per-turn raw arrays — pour le drill-down line chart.
      // Indice = numéro de tour, ordre chronologique.
      perTurn: {
        ttft: Array.isArray(m.rawTtftMs) ? m.rawTtftMs : [],
        eou: Array.isArray(m.rawServerEouMs) ? m.rawServerEouMs : [],
        transcription: Array.isArray(m.rawServerTransMs)
          ? m.rawServerTransMs
          : [],
        firstAudio: Array.isArray(m.rawServerFirstAudioMs)
          ? m.rawServerFirstAudioMs
          : [],
      },
      // Défaut : TTFA mean = ce qu'on affiche actuellement
      totalE2eMs,
      // Topologie infra — où tourne chaque composant. Fallback sur les
      // env vars locales si l'event n'a pas été emis avec topology
      // (anciens appels pré-2026-05-18).
      topology: m.topology ?? {
        twilio: process.env.INFRA_TWILIO_EDGE ?? "unknown",
        worker: process.env.INFRA_WORKER_REGION ?? "unknown",
        web: process.env.INFRA_WEB_REGION ?? "unknown",
        livekit: process.env.INFRA_LIVEKIT_REGION ?? "unknown",
        openai: process.env.INFRA_OPENAI_REGION ?? "unknown",
      },
    };
  });

  return NextResponse.json({
    points: points.reverse(), // chrono ascending pour le chart
    serverTime: now.toISOString(),
    sinceMs: sinceDate.getTime(),
    untilMs: (untilDate ?? now).getTime(),
  });
}

