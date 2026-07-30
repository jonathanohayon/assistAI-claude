import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getAgentBrain, setAgentBrain } from "@/lib/agent-brain";
import { logEvent } from "@/lib/logger";

/**
 * Réglage par tenant : la persona Tamara répond, ou l'agent externe du tenant.
 *
 * Le changement prend effet au prochain appel — le worker relit
 * `/api/agent/config` à chaque session, il n'y a rien à redéployer.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ brain: await getAgentBrain(session.user.id) });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { enabled?: unknown; url?: unknown; secret?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const wantsEnabled = body.enabled === true;

  // Message explicite plutôt qu'un enregistrement silencieusement désactivé :
  // l'utilisateur qui cochait la case sans URL valide devait comprendre
  // pourquoi rien ne changeait.
  if (wantsEnabled && !url.startsWith("http")) {
    return NextResponse.json(
      {
        error:
          "Renseignez une URL commençant par http(s) avant d'activer l'agent externe.",
      },
      { status: 400 },
    );
  }

  const brain = await setAgentBrain(session.user.id, {
    enabled: wantsEnabled,
    url,
    ...(typeof body.secret === "string" ? { secret: body.secret } : {}),
  });

  await logEvent({
    source: "tenant",
    event: "agent_brain_updated",
    message: brain.enabled
      ? `Agent externe activé → ${brain.url}`
      : "Agent externe désactivé (retour à la persona Tamara)",
    userId: session.user.id,
    metadata: { enabled: brain.enabled, url: brain.url },
  });

  return NextResponse.json({ brain });
}
