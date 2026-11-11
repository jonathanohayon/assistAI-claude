import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { isUuid } from "@/lib/calls/core";
import { getCallDetail } from "@/lib/calls/query";

interface Ctx {
  params: Promise<{ id: string }>;
}

// GET /api/dashboard/calls/[id][?asUserId] — one inbound call of the tenant:
// line + summary + transcript + plain-fact actions. Shape:
// lib/calls/contract.ts CallDetailResponse. Read-only: no LLM, no network, no
// write. Another tenant's call, an outbound/test call or a bad id → 404.
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const call = await getCallDetail(r.userId, id);
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(call);
}
