import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import {
  INITIAL_GREETING_INSTRUCTIONS,
  INITIAL_INSTRUCTIONS,
} from "@/lib/initial-config";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

// Internal-only: overwrite a tenant's instructions + greeting with the
// canonical Johana persona from lib/initial-config.ts. Used when a tenant
// row was customized BEFORE the strict-rules version landed and we need
// to bring it back in sync. Gated by INTERNAL_SECRET.
//
// POST { email?: string; userId?: string; clearGlobal?: boolean }
// clearGlobal=true also wipes the admin app_settings.global_instructions
// (which is prepended to every tenant prompt by /api/agent/config) — useful
// when an outdated global block is shadowing the new canonical persona.
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    userId?: string;
    clearGlobal?: boolean;
  };

  let userId = body.userId;
  if (!userId && body.email) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);
    if (!u) {
      return NextResponse.json({ error: "user introuvable" }, { status: 404 });
    }
    userId = u.id;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "userId ou email requis" },
      { status: 400 },
    );
  }

  const [before] = await db
    .select({
      id: agentConfigs.id,
      lenBefore: agentConfigs.instructions,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!before) {
    return NextResponse.json(
      { error: "agent_config introuvable pour ce user" },
      { status: 404 },
    );
  }

  const [updated] = await db
    .update(agentConfigs)
    .set({
      instructions: INITIAL_INSTRUCTIONS,
      greetingInstructions: INITIAL_GREETING_INSTRUCTIONS,
      updatedAt: new Date(),
    })
    .where(eq(agentConfigs.userId, userId))
    .returning();

  let globalCleared = false;
  if (body.clearGlobal) {
    await setSetting(SETTING_KEYS.GLOBAL_INSTRUCTIONS, "");
    globalCleared = true;
  }

  return NextResponse.json({
    ok: true,
    userId,
    lenBefore: before.lenBefore.length,
    lenAfter: updated.instructions.length,
    globalCleared,
  });
}
