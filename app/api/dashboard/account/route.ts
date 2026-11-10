import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { parseDeveloperModeBody } from "@/lib/developer-mode";

// Account display preferences. Tenant-editable; an admin with ?asUserId=
// reads/writes that tenant's flag (same scope rule as the other dashboard
// routes). `developerMode` only changes what the dashboard SHOWS; admin-only
// settings (the engine) stay gated on the role, not on this flag.
//   GET → { developerMode }
//   PUT { developerMode: boolean } → { developerMode } | 400 invalid_developer_mode

async function scope(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: r.userId };
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const [u] = await db.select({ developerMode: users.developerMode }).from(users).where(eq(users.id, s.userId)).limit(1);
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ developerMode: u.developerMode });
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const parsed = parseDeveloperModeBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const [u] = await db
    .update(users)
    .set({ developerMode: parsed.value })
    .where(eq(users.id, s.userId))
    .returning({ developerMode: users.developerMode });
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ developerMode: u.developerMode });
}
