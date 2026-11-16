import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { accountUpdateSet, parseAccountBody } from "@/lib/account-settings";
import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { resolveDoor } from "@/lib/door";

// Account display preferences. Tenant-editable; an admin with ?asUserId=
// reads/writes that tenant's values (same scope rule as the other dashboard
// routes). `developerMode` and `door` only change what the dashboard SHOWS;
// admin-only settings (the engine) stay gated on the role, and the door
// grants no right.
//   GET → { developerMode, door }            (door resolved, never null)
//   PUT { developerMode?, door? } (partial; an omitted key is unchanged)
//     → { developerMode, door } | 400 invalid_developer_mode | 400 invalid_door

async function scope(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: r.userId };
}

const returned = { developerMode: users.developerMode, door: users.door };

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const [u] = await db.select(returned).from(users).where(eq(users.id, s.userId)).limit(1);
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ developerMode: u.developerMode, door: resolveDoor(u.door) });
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const parsed = parseAccountBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const [u] = await db
    .update(users)
    .set(accountUpdateSet(parsed.value))
    .where(eq(users.id, s.userId))
    .returning(returned);
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ developerMode: u.developerMode, door: resolveDoor(u.door) });
}
