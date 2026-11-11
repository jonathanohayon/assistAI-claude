import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { getAgentBrain, setAgentBrain } from "@/lib/agent-brain";
import { sealedSecretRefusal } from "@/lib/crypto/secret-box";
import { agentBrainSaveDecision, brainView, urlToSave } from "@/lib/agent-brain-guard";
import { logEvent } from "@/lib/logger";

/**
 * Réglage par tenant : la persona Tamara répond, ou l'agent externe du tenant.
 *
 * Le changement prend effet au prochain appel — le worker relit
 * `/api/agent/config` à chaque session, il n'y a rien à redéployer.
 *
 * SSRF guard (lib/agent-brain-guard.ts): a new or changed `url` is admin-only
 * (403 admin_only { fields: ["url"] }); a url saved or enabled must pass
 * checkAgentUrl (400 unsafe_url + one plain message). `urlEditable` tells the
 * screen whether this viewer may change the url.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [brain, isAdmin] = await Promise.all([getAgentBrain(session.user.id), sessionIsAdmin()]);
  // Never the secret's value (nor the url) to a tenant: brainView.
  return NextResponse.json({ brain: brainView(brain, isAdmin), urlEditable: isAdmin });
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
  // E1: a secret already in the sealed format is refused (same as tools).
  const sealedLooking = sealedSecretRefusal(body.secret, "secret");
  if (sealedLooking) return NextResponse.json(sealedLooking, { status: 400 });

  const wantsEnabled = body.enabled === true;

  const [current, isAdmin] = await Promise.all([getAgentBrain(session.user.id), sessionIsAdmin()]);
  // A tenant's screen doesn't carry the url: absent / "" keeps the stored one.
  const url = urlToSave(body.url, current.url, isAdmin);
  const decision = await agentBrainSaveDecision({ currentUrl: current.url, url, wantsEnabled, isAdmin });
  if (!decision.ok) {
    await logEvent({
      source: "tenant",
      event: "agent_brain_refused",
      // The code only: never the url nor what it resolves to.
      message: `Agent externe refusé (${decision.body.error})`,
      level: "warn",
      userId: session.user.id,
      metadata: { error: decision.body.error },
    });
    return NextResponse.json(decision.body, { status: decision.status });
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

  return NextResponse.json({ brain: brainView(brain, isAdmin), urlEditable: isAdmin });
}
