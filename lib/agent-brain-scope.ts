/**
 * Who GET / PUT /api/dashboard/agent-brain act on, and who acted. Pure: the
 * route feeds it resolveTargetUserId's answer and whether the target row
 * exists, so the status codes are testable without a session or a DB.
 *   anonymous                          → 401 { error: "Unauthorized" }
 *   a non-admin with a foreign asUserId → 403 { error: "Forbidden" }
 *   an admin with an unknown asUserId   → 404 { error: "not_found" } (nothing read nor written:
 *                                        the brain map would otherwise grow an orphan entry)
 *   otherwise                           → the target's id + the caller's id
 * The CALLER's role (sessionIsAdmin) decides the powers and the view, never the target's.
 */
export type ResolvedTarget =
  | { unauthorized: true }
  | { forbidden: true }
  | { userId: string; sessionUserId: string };

export type BrainScope =
  | { ok: true; userId: string; callerId: string }
  | { ok: false; status: 401 | 403 | 404; body: { error: string } };

export function brainScope(r: ResolvedTarget, targetExists: boolean): BrainScope {
  if ("unauthorized" in r) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  if ("forbidden" in r) return { ok: false, status: 403, body: { error: "Forbidden" } };
  if (!targetExists) return { ok: false, status: 404, body: { error: "not_found" } };
  return { ok: true, userId: r.userId, callerId: r.sessionUserId };
}

/** True when the target row must be looked up: only for another user's id (one's own session row exists). */
export function brainTargetNeedsLookup(r: ResolvedTarget): r is { userId: string; sessionUserId: string } {
  return "userId" in r && r.userId !== r.sessionUserId;
}

/**
 * Audit fields of an agent-brain event: who acted (role) and, when an admin
 * acted on another tenant, the admin's id. Ids only: no PII, never the secret.
 */
export function brainActor(scope: { userId: string; callerId: string }, isAdmin: boolean) {
  return {
    actedBy: isAdmin ? ("admin" as const) : ("tenant" as const),
    ...(scope.callerId !== scope.userId ? { triggeredBy: scope.callerId } : {}),
  };
}
