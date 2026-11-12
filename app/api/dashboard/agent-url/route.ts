import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  generateAgentToken,
  getAgentTokenStatus,
  revokeAgentToken,
} from "@/lib/agent-tokens";
import { logEvent } from "@/lib/logger";

/**
 * The tenant's public agent URL, managed from the dashboard.
 *
 * The token is shown ONCE: in the POST response that creates or regenerates
 * it. It is stored hashed (lib/agent-tokens.ts), so the GET can only return
 * non-secret status — whether a token exists, when it was made, and a short
 * hint ("agt_…1a2b"). The GET never creates a token and never returns one.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // { exists, createdAt, hint } — never the token, never a URL.
  return NextResponse.json(await getAgentTokenStatus(session.user.id));
}

/**
 * Creates the token, or regenerates it: the old URL (legacy or hashed) stops
 * working immediately. The response is the only place the token ever appears.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { token, createdAt, hint } = await generateAgentToken(session.user.id);
  await logEvent({
    source: "auth",
    event: "agent_url_rotated",
    message: "URL publique de l'agent régénérée (l'ancienne est révoquée)",
    userId: session.user.id,
  });
  return NextResponse.json({ token, exists: true, createdAt, hint });
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
