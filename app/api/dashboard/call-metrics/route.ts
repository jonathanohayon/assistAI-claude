import { and, desc, eq, gte, lte, SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

// GET /api/dashboard/call-metrics?period=24h|7d|30d&since=<iso>&until=<iso>
//
// Renvoie les events `call_metrics` du tenant authentifié, filtrés par
// période. Utilisé par le LatencyChart de l'onglet Monitoring.
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
  ttfaMs?: { mean?: number | null };
  serverEouDelayMs?: { mean?: number | null };
  serverFirstAudioDelayMs?: { mean?: number | null };
  transcriptionDelayMs?: { mean?: number | null };
  toNumber?: string;
  fromNumber?: string;
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
    eq(events.userId, session.user.id),
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
    const eou = m.serverEouDelayMs?.mean ?? null;
    const firstAudio = m.serverFirstAudioDelayMs?.mean ?? null;
    const trans = m.transcriptionDelayMs?.mean ?? null;
    const greeting = m.greetingMs ?? null;

    // Total E2E = max user-perceived latency observée pendant l'appel.
    // C'est ttfaMs.mean (= temps moyen entre "user finit de parler" et
    // "agent commence à répondre") qui est le meilleur proxy d'une
    // expérience temps-réel. Si pas mesuré (appel court sans turn user),
    // on retombe sur greetingMs.
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
      // Y axis principal
      totalE2eMs,
    };
  });

  return NextResponse.json({
    points: points.reverse(), // chrono ascending pour le chart
    serverTime: now.toISOString(),
    sinceMs: sinceDate.getTime(),
    untilMs: (untilDate ?? now).getTime(),
  });
}

