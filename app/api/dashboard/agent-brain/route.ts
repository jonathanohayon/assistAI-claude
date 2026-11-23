import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { sessionIsAdmin } from "@/lib/api/auth-guards";
import { AgentBrainAddressRequiredError, getAgentBrain, setAgentBrain } from "@/lib/agent-brain";
import { sealedSecretRefusal } from "@/lib/crypto/secret-box";
import {
  agentBrainRetiredDecision,
  agentBrainSaveDecision,
  brainView,
  enabledToSave,
  urlToSave,
} from "@/lib/agent-brain-guard";
import { logEvent } from "@/lib/logger";

/**
 * Réglage par tenant : la persona Tamara répond, ou l'agent externe du tenant.
 *
 * RETIRED (replaced by the "Tamara only lends her voice" brick): for
 * EVERYONE, admin included, the only write left is switching it OFF.
 * Switching it on, or changing the url or the secret (row on or off) →
 * 409 { error: "agent_brain_retired" } (the code only), nothing written
 * (agentBrainRetiredDecision, run before the rules below; the tenant's 403
 * admin_only below is now a subset of it, kept as a second line). An unchanged
 * re-send → 200, nothing written. GET is unchanged; a row still on keeps
 * being served to the worker until it is switched off.
 *
 * Le changement prend effet au prochain appel — le worker relit
 * `/api/agent/config` à chaque session, il n'y a rien à redéployer.
 *
 * Before the retirement: a tenant may only switch the own agent OFF: switching it on, a new or
 * changed `url`, a new or changed `secret` are admin-only (403 admin_only
 * { fields }, nothing written); an unchanged re-send passes and writes nothing.
 * SSRF guard (lib/agent-brain-guard.ts): a url saved or enabled must pass
 * checkAgentUrl (400 unsafe_url + one plain message). Enabling with no address
 * at all → 400 address_required (no message), before the url check; the
 * store never silently stores enabled:false for an enabled:true request.
 * `urlEditable` tells the
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

  const [current, isAdmin] = await Promise.all([getAgentBrain(session.user.id), sessionIsAdmin()]);
  // An absent `enabled` keeps the stored value (a partial save never turns the agent off).
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  // A tenant's screen doesn't carry the url: absent / "" keeps the stored one.
  const url = urlToSave(body.url, current.url, isAdmin);
  const retired = agentBrainRetiredDecision({
    currentUrl: current.url,
    currentEnabled: current.enabled,
    currentSecret: current.secret,
    currentSecretUnreadable: current.secretUnreadable,
    secret: body.secret,
    url,
    wantsEnabled,
  });
  if (!retired.ok) {
    await logEvent({
      source: "tenant",
      event: "agent_brain_refused",
      // The code only: never the url nor the secret.
      message: `Agent externe refusé (${retired.body.error})`,
      level: "warn",
      userId: session.user.id,
      metadata: { error: retired.body.error },
    });
    return NextResponse.json(retired.body, { status: retired.status });
  }
  // Only ON → OFF writes; an unchanged re-send writes nothing (no secret generated).
  if (!retired.write) return NextResponse.json({ brain: brainView(current, isAdmin), urlEditable: isAdmin });

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
      userId: session.user.id,
      metadata: { error: decision.body.error },
    });
    return NextResponse.json(decision.body, { status: decision.status });
  }
  // A tenant save that changes nothing: nothing written (no secret generated).
  if (decision.noop) return NextResponse.json({ brain: brainView(current, isAdmin), urlEditable: isAdmin });

  let brain;
  try {
    brain = await setAgentBrain(session.user.id, {
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
    userId: session.user.id,
    metadata: { enabled: brain.enabled, url: brain.url },
  });

  return NextResponse.json({ brain: brainView(brain, isAdmin), urlEditable: isAdmin });
}
