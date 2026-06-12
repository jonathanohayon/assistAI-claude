import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { generateApiKey, getApiKeyMeta, revokeApiKey } from "@/lib/api-keys";
import { logEvent } from "@/lib/logger";

// Gestion de la clé API tenant (API publique v1 /api/v1/transcripts).
// Session-auth (dashboard). La clé en clair n'est renvoyée qu'au POST
// (génération) — jamais en GET.

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meta = await getApiKeyMeta(session.user.id);
  return NextResponse.json({ meta });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { key, prefix, createdAt } = await generateApiKey(session.user.id);
  await logEvent({
    source: "auth",
    event: "api_key_generated",
    message: `Clé API (re)générée (prefix ${prefix})`,
    userId: session.user.id,
  });
  // key renvoyée UNE seule fois.
  return NextResponse.json({ key, meta: { prefix, createdAt } });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await revokeApiKey(session.user.id);
  await logEvent({
    source: "auth",
    event: "api_key_revoked",
    message: "Clé API révoquée",
    userId: session.user.id,
  });
  return NextResponse.json({ ok: true });
}
