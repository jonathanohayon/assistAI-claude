import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";

// Read-only endpoint consumed by the LiveKit agent worker at session start.
// Phase 1 = single user / single config row. For phase 2, accept ?phone=...
// and look up the matching tenant.
export async function GET() {
  const [config] = await db.select().from(agentConfigs).limit(1);
  if (!config) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }

  // Strip internal IDs — the agent only needs the runtime values.
  const { id: _id, userId: _userId, updatedAt, ...runtime } = config;
  void _id;
  void _userId;
  return NextResponse.json({ ...runtime, updatedAt });
}
