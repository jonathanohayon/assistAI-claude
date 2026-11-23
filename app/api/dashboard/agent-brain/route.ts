import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId, sessionIsAdmin } from "@/lib/api/auth-guards";
import { AgentBrainAddressRequiredError, getAgentBrain, setAgentBrain } from "@/lib/agent-brain";
import { brainActor, brainScope, brainTargetNeedsLookup } from "@/lib/agent-brain-scope";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sealedSecretRefusal } from "@/lib/crypto/secret-box";
import { agentBrainSaveDecision, brainView, enabledToSave, urlToSave } from "@/lib/agent-brain-guard";
import { logEvent } from "@/lib/logger";

/**
 * Réglage par tenant : la persona Tamara répond, ou l'agent externe du tenant.
 *
 * Le changement prend effet au prochain appel — le worker relit
 * `/api/agent/config` à chaque session, il n'y a rien à redéployer.
 *
 * A tenant may only switch the own agent OFF: switching it on, a new or
 * changed `url`, a new or changed `secret` are admin-only (403 admin_only
 * { fields }, nothing written); an unchanged re-send passes and writes nothing.
 * SSRF guard (lib/agent-brain-guard.ts): a url saved or enabled must pass
 * checkAgentUrl (400 unsafe_url + one plain message). Enabling with no address
 * at all → 400 address_required (no message), before the url check; the
 * store never silently stores enabled:false for an enabled:true request.
 * `urlEditable` tells the
 * screen whether this viewer may change the url.
 *
 * Scope (lib/agent-brain-scope.ts): an admin with ?asUserId=<id> reads and
 * writes that tenant's brain; a non-admin with a foreign asUserId → 403; an
 * unknown target → 404 not_found. The CALLER's role decides the powers and
 * the view: an admin acting as a tenant has the admin's powers; admin_only
 * applies to a non-admin caller.
 */

async function scope(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  let targetExists = true;
  if (brainTargetNeedsLookup(r)) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, r.userId)).limit(1);
    targetExists = Boolean(u);
  }
  return brainScope(r, targetExists);
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if (!s.ok) return NextResponse.json(s.body, { status: s.status });
  const [brain, isAdmin] = await Promise.all([getAgentBrain(s.userId), sessionIsAdmin()]);
  // Never the secret's value (nor the url) to a tenant: brainView.
  return NextResponse.json({ brain: brainView(brain, isAdmin), urlEditable: isAdmin });
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if (!s.ok) return NextResponse.json(s.body, { status: s.status });

  let body: { enabled?: unknown; url?: unknown; secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  // E1: a secret already in the sealed format is refused (same as tools).
  const sealedLooking = sealedSecretRefusal(body.secret, "secret");
  if (sealedLooking) return NextResponse.json(sealedLooking, { status: 400 });

  const [current, isAdmin] = await Promise.all([getAgentBrain(s.userId), sessionIsAdmin()]);
  // An absent `enabled` keeps the stored value (a partial save never turns the agent off).
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  // A tenant's screen doesn't carry the url: absent / "" keeps the stored one.
  const url = urlToSave(body.url, current.url, isAdmin);
  const decision = await agentBrainSaveDecision({
    currentUrl: current.url,
    currentEnabled: current.enabled,
    currentSecret: current.secret,
    currentSecretUnreadable: current.secretUnreadable,
    secret: body.secret,
    url,
    wantsEnabled,
    isAdmin,
  });
  if (!decision.ok) {
    await logEvent({
      source: "tenant",
      event: "agent_brain_refused",
      // The code only: never the url nor what it resolves to.
      message: `Agent externe refusé (${decision.body.error})`,
      level: "warn",
      userId: s.userId,
      metadata: { error: decision.body.error, ...brainActor(s, isAdmin) },
    });
    return NextResponse.json(decision.body, { status: decision.status });
  }
  // A tenant save that changes nothing: nothing written (no secret generated).
  if (decision.noop) return NextResponse.json({ brain: brainView(current, isAdmin), urlEditable: isAdmin });

  let brain;
  try {
    brain = await setAgentBrain(s.userId, {
      enabled: wantsEnabled,
      url,
      // A tenant never writes a secret (an unchanged one isn't re-sealed).
      ...(isAdmin && typeof body.secret === "string" ? { secret: body.secret } : {}),
    });
  } catch (e) {
    // Unreachable after agentBrainSaveDecision; kept so the store's refusal
    // can never surface as a 500 (nothing was written).
    if (e instanceof AgentBrainAddressRequiredError) {
      return NextResponse.json({ error: "address_required" }, { status: 400 });
    }
    throw e;
  }

  await logEvent({
    source: "tenant",
    event: "agent_brain_updated",
    message: brain.enabled
      ? `Agent externe activé → ${brain.url}`
      : "Agent externe désactivé (retour à la persona Tamara)",
    userId: s.userId,
    metadata: { enabled: brain.enabled, url: brain.url, ...brainActor(s, isAdmin) },
  });

  return NextResponse.json({ brain: brainView(brain, isAdmin), urlEditable: isAdmin });
}
