import { NextRequest, NextResponse } from "next/server";

import { resolveTenant } from "@/lib/tenant";

// Read-only endpoint consumed by the LiveKit agent worker at session start.
// Phase 2: routes by `?phone=<called number>` to load the right tenant's
// config. If phone is missing or unmatched, falls back to the first tenant.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  const tenant = await resolveTenant(phone);
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 });
  }

  const { config } = tenant;
  // Strip internal IDs — the agent only needs the runtime values.
  const { id: _id, userId: _userId, updatedAt, ...runtime } = config;
  void _id;
  void _userId;
  return NextResponse.json({ ...runtime, updatedAt });
}
