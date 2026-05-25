import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";

/**
 * Nom de l'agent enregistré côté worker (`config.ts:AGENT_NAME` dans le
 * repo `~/Desktop/assistAI-claude-agent`). C'est celui qui doit être
 * dispatché quand le navigateur joint une room livetest. Sans ça,
 * LiveKit Cloud ne déclenche pas le worker (les SIP rooms ont une
 * dispatch rule, les rooms web n'en ont pas → on le force ici via le
 * JWT roomConfig.agents).
 */
const WORKER_AGENT_NAME = "appointment-agent";

// Génère un JWT LiveKit pour qu'un user web joigne une room côté worker.
// Le worker (qui tourne déjà pour les appels SIP) sera auto-dispatché sur
// cette room et appliquera la même pipeline QVF 2.1 L + OpenAI Realtime.
//
// Auth : NextAuth requis — c'est l'outil de test du dashboard, pas une
// démo publique. Le userId est dérivé de la session, pas du body, pour
// éviter qu'un user A puisse pré-configurer une session sur le tenant B.
//
// Le `participant.metadata` stocke `{ source: "web", userId }` — le
// worker le lit pour résoudre la config du bon tenant (au lieu du chemin
// SIP `sip.trunkPhoneNumber → resolveTenantByPhone`).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LiveKit not configured" },
      { status: 500 },
    );
  }

  // Optionnel : admin peut tester en tant qu'un autre tenant via `asUserId`.
  // Bloqué (403) si le caller n'est pas admin. Sinon → userId = target.
  const body = (await req.json().catch(() => ({}))) as { asUserId?: string };
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId: body.asUserId ?? null,
  });
  if ("forbidden" in scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = scope.userId;
  // Unique-ish room name. Worker dispatch is per-room ; on a un room
  // dédié par session test, ce qui évite les collisions si l'user
  // ré-ouvre l'onglet ou teste depuis 2 appareils.
  const roomName = `livetest-${userId}-${Date.now().toString(36)}`;
  const identity = `web-${userId}-${Math.random().toString(36).slice(2, 8)}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: session.user.email ?? identity,
    // Metadata côté participant — lue par le worker dans
    // ctx.room.remoteParticipants pour identifier le tenant.
    metadata: JSON.stringify({ source: "web", userId }),
    ttl: 15 * 60, // 15 minutes : largement assez pour un test live
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Force LiveKit Cloud à dispatcher le worker `appointment-agent` quand
  // l'utilisateur joint cette room. Sans ça, le worker ne reçoit aucun
  // job (les rooms web n'ont pas de SIP dispatch rule comme les
  // appels Twilio). Cf. lk sip dispatch-rule list pour le pendant SIP.
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: WORKER_AGENT_NAME,
        // Metadata passée au worker via ctx.job — pas utilisée pour le
        // moment côté agent.ts (on lit participant.metadata), mais utile
        // pour le debug et au cas où le worker veuille filtrer.
        metadata: JSON.stringify({ source: "web", userId }),
      }),
    ],
  });

  const token = await at.toJwt();

  return NextResponse.json({ url, token, roomName, identity });
}
