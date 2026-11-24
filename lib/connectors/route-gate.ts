// The gate every connector WRITE route runs first (B4), SERVER-ONLY:
//   no session → 401; ?asUserId by a non-admin → 403 (resolveTargetUserId,
//   the GET's pattern); then CONNECTORS_WRITE closed for this session →
//   404 { error: "connectors_write_off" }, before anything is read or written.
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId, sessionIsAdmin } from "@/lib/api/auth-guards";

import type { ConnectorActor, WriteOutcome } from "./write";
import { CONNECTORS_WRITE_OFF, connectorsWriteAllowed, connectorsWriteMode } from "./write-switch";

export async function connectorsWriteGate(
  req: NextRequest,
): Promise<{ ok: true; actor: ConnectorActor } | { ok: false; response: NextResponse }> {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const isAdmin = await sessionIsAdmin();
  if (!connectorsWriteAllowed(connectorsWriteMode(), isAdmin)) {
    return { ok: false, response: NextResponse.json(CONNECTORS_WRITE_OFF.body, { status: CONNECTORS_WRITE_OFF.status }) };
  }
  return { ok: true, actor: { userId: r.userId, sessionIsAdmin: isAdmin, viaAsUserId: req.nextUrl.searchParams.has("asUserId") } };
}

export const respond = (o: WriteOutcome) => NextResponse.json(o.body, { status: o.status });

/** The JSON body, or undefined when it isn't JSON. */
export async function jsonBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => undefined);
}
