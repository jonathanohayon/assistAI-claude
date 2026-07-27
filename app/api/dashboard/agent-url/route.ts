import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  ensureAgentToken,
  generateAgentToken,
  revokeAgentToken,
} from "@/lib/agent-tokens";
import { logEvent } from "@/lib/logger";

/**
 * URL publique de l'agent du tenant, affichée dans son dashboard.
 *
 * Contrairement à la clé API, le jeton est réaffichable : c'est une URL à
 * recopier dans un service tiers, pas un secret saisi une fois. Le GET la
 * crée à la volée si elle n'existe pas encore — l'utilisateur ne devrait pas
 * avoir à cliquer sur « générer » pour découvrir que son agent est joignable.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await ensureAgentToken(session.user.id);
  return NextResponse.json({ token });
}

/** Régénère : l'ancienne URL cesse immédiatement de répondre. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await generateAgentToken(session.user.id);
  await logEvent({
    source: "auth",
    event: "agent_url_rotated",
    message: "URL publique de l'agent régénérée (l'ancienne est révoquée)",
    userId: session.user.id,
  });
  return NextResponse.json({ token });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await revokeAgentToken(session.user.id);
  await logEvent({
    source: "auth",
    event: "agent_url_revoked",
    message: "URL publique de l'agent révoquée",
    userId: session.user.id,
  });
  return NextResponse.json({ ok: true });
}
