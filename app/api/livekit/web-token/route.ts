import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

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
export async function POST(_req: NextRequest) {
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

  const userId = session.user.id;
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

  const token = await at.toJwt();

  return NextResponse.json({ url, token, roomName, identity });
}
